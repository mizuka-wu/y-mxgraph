# 当前实现与原始实现差异

本文档列出重构后的 `y-mxgraph` 与原始实现的主要差异。

## API 变更

| 项目 | 原始实现 | 当前实现 | 说明 |
|------|----------|----------|------|
| `options.doc` | 可选，默认 `new Y.Doc()` | **必填** | 外部必须传入 Y.Doc，便于与 Provider 共享 |
| `options.trackLocalUndoOnly` | 存在 | **已移除** | undoManager 完全由外部控制，无需内部配置 |
| `options.undoManager` | 支持内部创建 | **仅支持外部传入** | 简化 API，用户自行配置 trackedOrigins |
| API 形式 | 工厂函数 | **`Binding` 类** | 推荐 `new Binding()`，自带 `destroy()` 方法 |
| `destroy()` 方法 | 无 | **有** | 解除所有监听器，恢复原始 undoManager |

## 功能差异

### 调试输出

| 位置 | 原始实现 | 当前实现 |
|------|----------|----------|
| `binding/index.ts` | `console.log("local patch", patch)` | **已删除** |
| `binding/index.ts` | `console.log("undoManager/remote patch", patch)` | **已删除** |
| `patch.ts` | `console.log(mxfile.toJSON(), patch)` | **已删除** |
| `transformer/index.ts` | `console.warn("无支持的文件类型")` | **已删除** |

### UndoManager 行为

```ts
// 原始实现
bindUndoManager(doc, file, {
  undoManager?: Y.UndoManager;
  trackLocalUndoOnly?: boolean;  // 可配置
})

// 当前实现  
bindUndoManager(doc, file, yUndo: Y.UndoManager)  // 直接使用外部实例
```

**差异说明**：

- 原始实现支持 `trackLocalUndoOnly: false`（追踪所有事务）
- 当前实现强制只追踪 `LOCAL_ORIGIN` 标记的本地事务
- 这是**有意为之的设计简化**：undoManager 由外部创建，应在外部配置 `trackedOrigins`

### 数据同步机制

| 方向 | 机制 | 说明 |
|------|------|------|
| draw.io → Y.Doc | `file.ui.diffPages()` → `applyFilePatch()` | 与原版一致 |
| Y.Doc → draw.io | `observeDeep()` → `generatePatch()` → `file.patch()` | 与原版一致 |

### 协作功能

| 功能 | 原始实现 | 当前实现 |
|------|----------|----------|
| 光标同步 | `bindCursor()` | ✅ 保留 |
| 选区同步 | `bindSelection()` | ✅ 保留 |
| 用户颜色生成 | `generateColor()` | ✅ 保留 |
| 随机用户名 | `generateRandomName()` | ✅ 保留 |

## 导出差异

| 导出项 | 原始实现 | 当前实现 | 状态 |
|--------|----------|----------|------|
| `bindDrawioFile` | ✅ | ✅ | 保留 |
| `xml2doc` | ✅ | ✅ | 保留 |
| `doc2xml` | ✅ | ✅ | 保留 |
| `LOCAL_ORIGIN` | ✅ | ✅ | 保留 |
| `DEFAULT_USER_NAME_KEY` | ✅ (binding/index.ts) | ✅ (binding/collaborator) | 保留 |
| `DEFAULT_USER_COLOR_KEY` | ✅ (binding/index.ts) | ✅ (binding/collaborator) | 保留 |
| `BindDrawioFileOptions` | 内联类型 | 独立 interface | 改进 |

## 类型定义改进

```ts
// 当前实现：独立的 options interface
export interface BindDrawioFileOptions {
  doc: Y.Doc;                  // 必填
  awareness?: Awareness;
  undoManager?: Y.UndoManager;
  mouseMoveThrottle?: number;
  cursor?: boolean | { userNameKey?: string; userColorKey?: string };
}

// 原始实现：内联在函数参数中
function bindDrawioFile(file: any, options: { ... } = {})
```

## 代码清理

| 项目 | 状态 |
|------|------|
| TODO 注释 | 已删除（功能已实现） |
| 死代码 (`docObserver`) | 已删除 |
| 多余的事务嵌套 | 已清理 |

## 未变更的核心逻辑

以下模块与原始实现基本一致：

- `transformer/` - XML ↔ Y.Doc 转换
- `models/` - Yjs 数据模型定义
- `helper/xml.ts` - XML 序列化/反序列化
- `helper/awarenessStateValue.ts` - Awareness 状态管理
- `binding/patch.ts` - Patch 生成与应用
- `binding/collaborator/` - 光标与选区协作

## 迁移指南

### 从原始实现迁移

```ts
// 原始实现
const doc = bindDrawioFile(file, {
  doc: new Y.Doc(),  // 可选
  undoManager: myUndoManager,  // 内部会配置 trackedOrigins
  trackLocalUndoOnly: true,  // 已移除
});

// 当前实现（推荐 Class API）
const yDoc = new Y.Doc();
const undoManager = new Y.UndoManager(yDoc, {
  trackedOrigins: new Set([LOCAL_ORIGIN]),  // 需要外部配置
});

const binding = new Binding(file, {
  doc: yDoc,  // 必填
  undoManager,  // 直接使用外部创建的实例
});

// 卸载时清理
binding.destroy(true);

// 或者使用兼容的工厂函数
const binding2 = bindDrawioFile(file, { doc: yDoc, undoManager });
```

### 关键注意点

1. **必须外部创建 Y.Doc** - 不再内部创建，便于与 Provider 共享
2. **必须外部配置 trackedOrigins** - 使用 `LOCAL_ORIGIN` 常量
3. **记得调用 destroy()** - 组件卸载或页面关闭时清理，防止内存泄漏
