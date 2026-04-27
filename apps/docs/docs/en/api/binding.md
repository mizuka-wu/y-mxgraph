# Binding

The `Binding` class manages the bidirectional binding between a draw.io file and a `Y.Doc`.

## Constructor

```ts
new Binding(file: any, options: BindDrawioFileOptions)
```

## Parameters

### `file`

The draw.io editor's internal file object, obtained via `App.main((app) => app.currentFile)`.

### `options`

```ts
interface BindDrawioFileOptions {
  doc: Y.Doc;                  // required — externally provided Y.Doc
  awareness?: Awareness;       // optional — y-protocols awareness (cursors/selections)
  undoManager?: Y.UndoManager; // optional — enables undo/redo when provided
  mouseMoveThrottle?: number;  // optional — cursor throttle in ms, default 100
  cursor?:                     // optional — remote cursor rendering config
    | boolean
    | {
        userNameKey?: string;  // awareness field for user name, default 'user.name'
        userColorKey?: string; // awareness field for color, default 'user.color'
      };
}
```

## Instance Properties

### `doc: Y.Doc`

The bound Y.Doc instance. Read-only.

## Instance Methods

### `destroy(deep?: boolean): void`

Destroys the binding and removes all listeners.

**Parameters**:

- `deep` — whether to perform a full cleanup, defaults to `false`
  - `false`: removes only the core binding listeners (`mxGraphModel` change, `Y.Doc` observeDeep)
  - `true`: full cleanup including Awareness/UndoManager subsystems and restores the original undoManager

**Recommendations**:

- Call `destroy()` on page unload/close
- Call `destroy(true)` when dynamically switching draw.io files

## Examples

### Basic Usage

```ts
import * as Y from 'yjs';
import { Binding, LOCAL_ORIGIN } from 'y-mxgraph';

const doc = new Y.Doc();

App.main((app) => {
  const binding = new Binding(app.currentFile, { doc });

  window.addEventListener('beforeunload', () => {
    binding.destroy();
  });
});
```

### With React / Vue

```ts
// React
useEffect(() => {
  const binding = new Binding(file, { doc, awareness });
  return () => binding.destroy(true);
}, [file, doc]);

// Vue
const binding = new Binding(file, { doc, awareness });
onUnmounted(() => {
  binding.destroy(true);
});
```

## About UndoManager

`Binding` no longer creates a `Y.UndoManager` internally. To enable undo/redo, create one externally and pass it in:

```ts
const undoManager = new Y.UndoManager(doc, {
  trackedOrigins: new Set([LOCAL_ORIGIN]),
});

const binding = new Binding(file, { doc, undoManager });
```

`LOCAL_ORIGIN` is a static marker object exported by `y-mxgraph` used to distinguish local transactions from remote ones.
