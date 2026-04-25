# bindDrawioFile

将 draw.io 的 `file` 对象与 `Y.Doc` 进行双向绑定。

## 签名

```ts
function bindDrawioFile(
  file: any,
  options: BindDrawioFileOptions
): { doc: Y.Doc; destroy: () => void }
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

## 返回值

```ts
{ doc: Y.Doc; destroy: () => void }
```

调用 `destroy()` 可解除所有监听器。

## 示例

```ts
import * as Y from 'yjs';
import { bindDrawioFile, LOCAL_ORIGIN } from 'y-mxgraph';

const doc = new Y.Doc();

App.main((app) => {
  const { destroy } = bindDrawioFile(app.currentFile, { doc });

  // 卸载时调用
  // destroy();
});
```

## 关于 UndoManager

`bindDrawioFile` 不再内部自动创建 `Y.UndoManager`。如需撤销/重做，请在外部创建后传入：

```ts
const undoManager = new Y.UndoManager(doc, {
  trackedOrigins: new Set([LOCAL_ORIGIN]),
});

bindDrawioFile(file, { doc, undoManager });
```

`LOCAL_ORIGIN` 是 `y-mxgraph` 导出的静态标识对象，用于区分本地事务和远端事务。
