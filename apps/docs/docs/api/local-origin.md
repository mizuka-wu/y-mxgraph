# LOCAL_ORIGIN

用于标记「本地事务」的静态标识对象。

## 类型

```ts
const LOCAL_ORIGIN: Record<string, never>
```

一个静态空对象 `{}`，作为 Yjs 事务的 `origin` 参数使用。

## 用途

`bindDrawioFile` 内部会将本地变更事务以 `LOCAL_ORIGIN` 为 origin 提交到 `Y.Doc`，从而与远端同步事务区分。

如果你使用外部的 `Y.UndoManager`，应将 `LOCAL_ORIGIN` 加入 `trackedOrigins`，使撤销仅作用于本地操作：

```ts
import { LOCAL_ORIGIN } from 'y-mxgraph';
import * as Y from 'yjs';

const undoManager = new Y.UndoManager(doc, {
  trackedOrigins: new Set([LOCAL_ORIGIN]),
});
```

## 注意

`LOCAL_ORIGIN` 是一个模块级别的单例对象（`{}`），同一个应用实例中引用相同。
不要在多个 `Y.Doc` 间共用它来区分不同 binding 的来源。
