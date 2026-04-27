# Binding

`Binding` 类管理 draw.io 文件与 `Y.Doc` 的双向绑定。

## 构造函数

```ts
new Binding(file: any, options: BindDrawioFileOptions)
```

## 参数

### `file`

draw.io 编辑器内部的文件对象，通过 `App.main((app) => app.currentFile)` 获取。

### `options`

```ts
interface BindDrawioFileOptions {
  doc: Y.Doc;                  // 必填，外部传入的 Y.Doc
  awareness?: Awareness;       // 可选，y-protocols awareness（协作光标/选区）
  undoManager?: Y.UndoManager; // 可选，外部传入后启用撤销/重做绑定
  mouseMoveThrottle?: number;  // 可选，光标移动节流 ms，默认 100
  cursor?:                     // 可选，远端光标渲染配置
    | boolean
    | {
        userNameKey?: string;  // awareness 中用户名字段，默认 'user.name'
        userColorKey?: string; // awareness 中颜色字段，默认 'user.color'
      };
}
```

## 实例属性

### `doc: Y.Doc`

绑定的 Y.Doc 实例，只读。

## 实例方法

### `destroy(deep?: boolean): void`

销毁绑定，解除所有监听器。

**参数**:

- `deep` - 是否深度清理，默认 `false`
  - `false`: 只解除核心绑定监听器（mxGraphModel change, Y.Doc observeDeep）
  - `true`: 完全清理，包括 Awareness/UndoManager 子系统，恢复原始 undoManager

**使用建议**:

- 页面刷新/关闭时调用 `destroy()` 即可
- 动态切换 draw.io 文件时调用 `destroy(true)` 完全清理

## 示例

### 基础用法

```ts
import * as Y from 'yjs';
import { bindDrawioFile, LOCAL_ORIGIN } from 'y-mxgraph';

const doc = new Y.Doc();

App.main((app) => {
  const binding = bindDrawioFile(app.currentFile, { doc });
  
  // 卸载时清理
  window.addEventListener('beforeunload', () => {
    binding.destroy();
  });
});
```

### 配合 React/Vue 使用

```ts
// React
useEffect(() => {
  const binding = new Binding(file, { doc, awareness });
  // 组件卸载时完全清理
  return () => binding.destroy(true);
}, [file, doc]);

// Vue
const binding = new Binding(file, { doc, awareness });
onUnmounted(() => {
  binding.destroy(true);
});
```

## 关于 UndoManager

`Binding` 不再内部自动创建 `Y.UndoManager`。如需撤销/重做，请在外部创建后传入：

```ts
const undoManager = new Y.UndoManager(doc, {
  trackedOrigins: new Set([LOCAL_ORIGIN]),
});

const binding = new Binding(file, { doc, undoManager });
```

`LOCAL_ORIGIN` 是 `y-mxgraph` 导出的静态标识对象，用于区分本地事务和远端事务。
