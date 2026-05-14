# 实现原理

本文档介绍 `y-mxgraph` 的核心实现机制。

## 整体架构

y-mxgraph 作为**适配层**，将 Yjs 的变更转换为 draw.io **原生协同系统**可识别的 patch 格式，让 draw.io 误以为是其内置协同功能在同步。

```
┌─────────────────────────────────────────────────────────────┐
│                         draw.io                             │
│  ┌─────────────┐      ┌──────────────────────────────┐     │
│  │   mxGraph   │◄────►│  draw.io 原生协同系统        │     │
│  │  (UI/画布)  │      │  (file.patch / diffPages)    │     │
│  └─────────────┘      └──────────────┬─────────────────┘     │
└──────────────────────────────────────│───────────────────────┘
                                       │
                              模拟原生协同 API
                                       │
                              ┌────────▼────────┐
                              │   y-mxgraph     │
                              │  (适配/转换层)  │
                              └────────┬────────┘
                                       │
                              ┌────────▼────────┐
                              │     Y.Doc       │
                              │    (CRDT)       │
                              └────────┬────────┘
                                       │
                              ┌────────▼────────┐
                              │  Provider       │
                              │ (y-webrtc等)    │
                              └─────────────────┘
```

## 核心思想

draw.io 本身具备成熟的实时协同功能（基于 WebSocket 的原生协同）。y-mxgraph 不替换 draw.io 的协同逻辑，而是**复用**它：

| 方向 | 操作 | 说明 |
|------|------|------|
| 本地变更 | `diffPages()` → Y.Doc | 劫持 draw.io 的 diff 输出，转存到 Yjs |
| 远端变更 | Y.Doc → `patch()` | 生成 draw.io 能识别的 patch，注入其协同系统 |

**优势**：

- 无需深入修改 draw.io 内部绘图逻辑
- 自动继承 draw.io 的冲突处理、选区同步、光标协作等能力
- Yjs 作为 CRDT 解决方案，提供强一致性和高性能的实时协同能力

### draw.io → Y.Doc（本地变更捕获）

复用 draw.io **原生协同的 diff 机制**：

```ts
mxGraphModel.addListener("change", () => {
  const patch = file.ui.diffPages(file.shadowPages, file.ui.pages);
  file.setShadowPages(file.ui.clonePages(file.ui.pages));
  applyFilePatch(doc, patch, { origin: LOCAL_ORIGIN });
});
```

**流程**：

1. 用户操作触发 mxGraph `change` 事件
2. `diffPages()` 是 draw.io **内置**的协同 diff 算法
3. 对比 `shadowPages`（上次同步状态）与当前 `pages` 生成 patch
4. `applyFilePatch()` 将 patch 转换为 Yjs 的 CRDT 操作
5. 更新 `shadowPages` 保持同步基准
6. 使用 `LOCAL_ORIGIN` 标记，避免回环

### Y.Doc → draw.io（远端变更注入）

将 Yjs 变更**伪装成 draw.io 原生协同的 patch**：

```ts
doc.getMap(mxfileKey).observeDeep((events, transaction) => {
  if (transaction.local && transaction.origin === LOCAL_ORIGIN) {
    generatePatch(events);  // 仅更新快照，不应用到 UI
    return;
  }
  const patch = generatePatch(events);  // 生成 draw.io 原生 patch 格式
  file.patch([patch]);  // 调用 draw.io 内置的协同 apply 方法
  file.setShadowPages(file.ui.clonePages(file.ui.pages));
});
```

**流程**：

1. Provider 同步远端 Yjs 变更
2. `observeDeep` 监听到 Y.Map/Y.Array 变化
3. 跳过本地事务（避免回环）
4. `generatePatch()` 生成符合 draw.io **原生格式**的 patch
5. `file.patch()` 是 draw.io **内置**的协同 apply 方法
6. draw.io 按原生协同逻辑渲染变更，无需特殊处理

## Patch 结构

```ts
interface FilePatch {
  // 删除的 diagram id 列表
  r?: string[];
  
  // 插入的 diagram 列表
  i?: Array<{
    data: string;      // XML 内容
    id: string;        // diagram id
    previous: string;  // 前一个 diagram id（用于排序）
  }>;
  
  // 更新的 diagram
  u?: {
    [diagramId: string]: {
      name?: string;        // 重命名
      previous?: string;    // 调整顺序
      cells?: {
        r?: string[];                    // 删除 cells
        i?: Array<Record<string, string>>; // 插入 cells
        u?: {                            // 更新 cell 属性
          [cellId: string]: Record<string, string>;
        };
      };
    };
  };
}
```

**字段说明**：

- `r` (remove): 删除操作，值为 id 数组
- `i` (insert): 插入操作，包含 XML 数据和位置信息
- `u` (update): 更新操作，支持属性修改和排序

## 顺序维护

### Diagram 顺序

使用 `Y.Array<string>` 存储 diagram id 的顺序：

```ts
// mxfile 结构
{
  diagrams: Y.Map<YDiagram>,     // id -> diagram 映射
  [diagramOrderKey]: Y.Array<string>  // id 顺序数组
}
```

插入时通过 `previous` 字段确定位置，支持并发插入的冲突解决。

### Cell 顺序

每个 diagram 内部独立维护 cell 顺序：

```ts
// mxGraphModel 结构
{
  [mxCellKey]: Y.Map<Y.XmlElement>,  // id -> mxCell 映射
  [mxCellOrderKey]: Y.Array<string>   // cell id 顺序
}
```

## 快照机制

```ts
type DocSnapshot = {
  diagramOrder: string[] | null;
  cellsOrder: Map<string, string[]>;
  cellAttrs: Map<string, Map<string, Record<string, string>>>;
};

const docSnapshots = new WeakMap<Y.Doc, DocSnapshot>();
```

**作用**：

- 记录每次事务前的文档状态
- 用于 `generatePatch()` 计算 diff
- 使用 `WeakMap` 避免内存泄漏

## Undo/Redo 集成

### 事务标记

```ts
export const LOCAL_ORIGIN: object = {};

doc.transact(() => {
  // 本地变更
}, LOCAL_ORIGIN);
```

### UndoManager 配置

```ts
const undoManager = new Y.UndoManager(doc, {
  trackedOrigins: new Set([LOCAL_ORIGIN]),
});
```

**关键逻辑**：

- 只有 `LOCAL_ORIGIN` 标记的事务进入撤销栈
- 远端事务不进入撤销栈
- `bindUndoManager()` 提供 mxUndoManager 兼容层

## 协作功能

### Awareness 状态

```ts
// 本地状态
awareness.setLocalState({
  'user.name': 'Alice',
  'user.color': '#ff0000',
  'cursor': { x: 100, y: 200, pageId: '0' },
  'selection': { added: ['1', '2'], removed: [], pageId: '0' },
});

// 监听远端状态
awareness.on('update', ({ updated }) => {
  for (const clientId of updated) {
    const state = awareness.getStates().get(clientId);
    // 渲染远端光标/选区
  }
});
```

### 光标同步

**状态转换**:

```
鼠标移动 ───────────────────────────────►
    │                                      │
    ▼                                      ▼
mouseMoveThrottle (100ms)      mouseleave
    │                                      │
    ▼                                      ▼
cursor: { x, y, pageId }      cursor: { x, y, pageId, hide: true }
    │                                      │
    └──────────────┬───────────────────────┘
                   ▼
          awareness.setLocalStateField()
                   │
                   ▼
            远端用户接收
                   │
        ┌──────────┴──────────┐
        ▼                       ▼
    hide: false            hide: true
    创建/更新光标            移除光标 DOM
```

**关键设计**:

- **节流**: `mouseMoveThrottle` 默认 100ms，避免频繁更新
- **坐标转换**: 屏幕坐标 → 画布坐标（考虑 scale/translate）
- **页面隔离**: 包含 `pageId`，非当前页的光标不显示
- **显隐状态**: `hide` 字段控制光标显隐，鼠标离开画布时自动隐藏

### 选区同步

```text
本地选区变更
    │
    ▼
selectionModel.addListener("change")
    │
    ▼
awareness.setLocalStateField("selection", {
  added: [...],    // 新增选中的 cell ids
  removed: [...],  // 取消选中的 cell ids
  pageId,          // 当前页 id
})
    │
    ▼
远端用户接收
    │
    ▼
renderRemoteSelections()
    │
    ├─► added: graph.highlightCell(cell, userColor)
    │
    └─► removed: highlightCell.destroy()
```

**关键设计**:

- **增量更新**: 只同步变更的选区（added/removed），而非全量
- **页面隔离**: 只渲染当前页的远端选区
- **自动清理**: 用户离开或切换页面时自动销毁高亮

## XML 转换

### xml2ydoc

```
mxfile XML → xml-js → Y.Map/Y.Array/Y.XmlElement → Y.Doc
```

**关键点**：

- mxCell 转换为 `Y.XmlElement`，保留完整 XML 特性
- 顺序信息提取到 `Y.Array`
- diagram 结构扁平化存储

### ydoc2xml

```
Y.Doc → 遍历 Y 数据结构 → xml-js → mxfile XML
```

**关键点**：

- 按顺序重建 XML 结构
- 处理 `previous` 关系恢复层级
- 支持缩进格式化

## 冲突解决

### 并发插入

```ts
// 通过 previous 字段确定相对位置
insertAfterUnique(orderArr, id, previous, fallbackToEnd);
```

**策略**：

1. 根据 `previous` 找到锚点位置
2. 计算深度（处理连锁依赖）
3. 按深度和顺序排序后批量插入

### 重复去重

```ts
function ensureUniqueOrder(orderArr: Y.Array<string>) {
  // 移除重复 id，保留首次出现位置
}
```

## 性能优化

1. **patch 批量应用**: 单次事务包含多个变更
2. **节流处理**: 光标移动节流（默认 100ms）
3. **懒加载**: 首次绑定后初始化快照
4. **WeakMap 存储**: 自动清理不再使用的文档快照

## 限制与注意事项

1. **销毁方法**: 提供 `destroy(deep?: boolean)`，建议组件卸载时调用 `destroy(true)` 完全清理
2. **单文档**: 每个 draw.io file 绑定一个 Y.Doc，不支持多文档
3. **draw.io 依赖**: 依赖 `file.ui.diffPages()` 等内部 API，可能随 draw.io 版本变化
