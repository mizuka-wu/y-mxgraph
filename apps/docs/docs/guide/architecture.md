# 实现原理

本文档介绍 `y-mxgraph` 的核心实现机制。

## 整体架构

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   draw.io   │◄────►│  y-mxgraph  │◄────►│   Y.Doc     │
│  (mxGraph)  │      │  (binding)  │      │   (CRDT)    │
└─────────────┘      └─────────────┘      └──────┬──────┘
                                                  │
                       ┌─────────────┐          │
                       │  Provider     │◄─────────┘
                       │ (y-webrtc等) │
                       └─────────────┘
```

## 双向绑定机制

### draw.io → Y.Doc（本地变更）

```ts
mxGraphModel.addListener("change", () => {
  const patch = file.ui.diffPages(file.shadowPages, file.ui.pages);
  file.setShadowPages(file.ui.clonePages(file.ui.pages));
  applyFilePatch(doc, patch, { origin: LOCAL_ORIGIN });
});
```

**流程**：
1. 用户操作触发 mxGraph `change` 事件
2. `diffPages()` 对比 `shadowPages` 与当前 `pages` 生成 patch
3. `applyFilePatch()` 将 patch 应用到 Y.Doc
4. 更新 `shadowPages` 为当前状态（避免重复 diff）
5. 使用 `LOCAL_ORIGIN` 标记，区分本地/远端事务

### Y.Doc → draw.io（远端变更）

```ts
doc.getMap(mxfileKey).observeDeep((events, transaction) => {
  if (transaction.local && transaction.origin === LOCAL_ORIGIN) {
    generatePatch(events);  // 仅更新快照
    return;
  }
  const patch = generatePatch(events);
  file.patch([patch]);  // 应用到 UI
  file.setShadowPages(file.ui.clonePages(file.ui.pages));
});
```

**流程**：
1. Yjs 检测到远端变更（通过 Provider 同步）
2. `observeDeep` 监听到 Y.Map/Y.Array 变化
3. 跳过本地事务（`origin === LOCAL_ORIGIN`）
4. `generatePatch()` 对比快照生成 patch
5. `file.patch()` 应用到 draw.io UI
6. 更新 `shadowPages` 保持同步

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

- **节流**: `mouseMoveThrottle` 默认 100ms
- **坐标**: 相对于 draw.io 画布的 x/y 坐标
- **页面**: 包含 `pageId` 区分多页文档

### 选区同步

- **added**: 新选中的 cell id 列表
- **removed**: 取消选中的 cell id 列表
- **高亮**: 使用 `renderRemoteSelections()` 渲染

## XML 转换

### xml2doc

```
mxfile XML → xml-js → Y.Map/Y.Array/Y.XmlElement → Y.Doc
```

**关键点**：
- mxCell 转换为 `Y.XmlElement`，保留完整 XML 特性
- 顺序信息提取到 `Y.Array`
- diagram 结构扁平化存储

### doc2xml

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

1. **无销毁方法**: 当前实现不提供 `destroy()`，页面卸载时直接丢弃
2. **单文档**: 每个 draw.io file 绑定一个 Y.Doc，不支持多文档
3. **draw.io 依赖**: 依赖 `file.ui.diffPages()` 等内部 API，可能随 draw.io 版本变化
