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

## Static Methods

### `Binding.generateFileTemplate(diagramId?: string): string`

Generates a standardized mxfile XML template to ensure consistent collaboration starting data across all clients.

**Parameters**:

- `diagramId` — fixed diagram id, defaults to `"diagram-0"`

**Returns**: A minimal mxfile XML string

**Why this is needed**:

When draw.io creates a new diagram, it generates a random id (e.g., `DEMOabHTdChjKBf1yHdD`). If each client initializes with a different diagram id, the Y.Doc data cannot align with the local `file.data`, causing late-joining clients to see "orphan pages" and patch diffs to fail matching diagram/cell ids, breaking collaboration.

The consumer should use this method to generate a unified starting XML before initializing the draw.io file, then inject it into `currentFile.data` (see "Integration Notes" for details).

**Example**:

```ts
import { Binding } from 'y-mxgraph';

// Use default id "diagram-0"
const template = Binding.generateFileTemplate();

// Or specify a fixed id (e.g., bound to room/project)
const template = Binding.generateFileTemplate("room-123-main");
```

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
import { Binding } from 'y-mxgraph';

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
