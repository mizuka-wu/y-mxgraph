# LOCAL_ORIGIN

A static marker object used to tag "local" Yjs transactions.

## Type

```ts
const LOCAL_ORIGIN: Record<string, never>
```

A static empty object `{}` used as the `origin` parameter for Yjs transactions.

## Purpose

`Binding` internally commits local-change transactions with `LOCAL_ORIGIN` as the origin, distinguishing them from remote sync transactions.

If you use an external `Y.UndoManager`, add `LOCAL_ORIGIN` to `trackedOrigins` so that undo only affects local operations:

```ts
import { LOCAL_ORIGIN } from 'y-mxgraph';
import * as Y from 'yjs';

const undoManager = new Y.UndoManager(doc, {
  trackedOrigins: new Set([LOCAL_ORIGIN]),
});
```

## Note

`LOCAL_ORIGIN` is a module-level singleton (`{}`). All references within the same application instance point to the same object.
Do not share it across multiple `Y.Doc` instances to distinguish different binding origins.
