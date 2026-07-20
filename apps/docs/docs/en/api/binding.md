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
  undoManager?: Y.UndoManager | false; // optional — pass instance to enable undo/redo; pass false to explicitly skip (e.g. iframe-bridge scenario)
  mouseMoveThrottle?: number;  // optional — cursor throttle in ms, default 100
  cursor?:                     // optional — remote cursor rendering config
    | boolean
    | {
        userNameKey?: string;  // awareness field for user name, default 'user.name'
        userColorKey?: string; // awareness field for color, default 'user.color'
      };
  initialContent?: InitialContentStrategy; // optional — default 'replace'
  applyFileData?: (file, xml) => void;     // optional — custom file data apply
  disableBeforeUnload?: boolean;           // optional — default true
  transformPatch?: (patch: FilePatch) => FilePatch | null | undefined; // optional — transform/filter local patches before syncing
}
```

#### `initialContent`

Controls how the file and Y.Doc are aligned when binding. Default is `'replace'`.

| Strategy | Behavior |
|----------|----------|
| `replace` | If doc has data, overwrite file with doc; if doc is empty, keep file as-is |
| `merge-remote` | Union by diagram id; on conflict, doc wins (remote authoritative) |
| `merge-client` | Union by diagram id; on conflict, file wins (local authoritative) |

#### `applyFileData`

Custom function to apply XML to the draw.io file. Default only calls `file.ui.setFileData(xml)` (rebuilds UI/pages), intentionally **not** calling `file.setData(xml)` to avoid marking the file as "modified" which triggers draw.io's "Save diagrams to:" storage dialog.

If you need to sync `file.data` (e.g., for custom CollabFile or `file.save()`), provide a custom implementation:

```ts
new Binding(file, {
  doc,
  applyFileData: (f, xml) => {
    f.ui.setFileData(xml);
    f.setData(xml);
  },
});
```

#### `disableBeforeUnload`

Whether to disable draw.io's `beforeunload` dialog. Default is `true`.

After Yjs takes over persistence, draw.io's native save state is no longer meaningful. However, draw.io internally shows "All changes will be lost" or "Ensure your data has been saved" dialogs under certain conditions (e.g., LocalFile without fileHandle, non-empty diagram, etc.).

Set to `true` (default) to completely disable these dialogs — suitable for pure Yjs collaboration scenarios. Set to `false` to preserve native behavior (e.g., when using File System Access API).

#### `transformPatch`

Optional callback to transform or filter local patches before syncing to Y.Doc. Useful for scenarios like external image storage.

**Signature**: `(patch: FilePatch) => FilePatch | null | undefined`

**Return value**:
- `undefined` or original patch: no filtering, sync as-is
- Modified `FilePatch`: use the modified patch for syncing
- `null`: skip this sync entirely

**Example — Image storage optimization**:

```ts
import { Binding } from 'y-mxgraph';

// Extract base64 images to IndexedDB, sync only img:<uuid> references
const binding = new Binding(file, {
  doc,
  transformPatch: (patch) => {
    // Detect and remove base64 images from patch
    // Upload images to storage asynchronously
    // Return modified patch with img:<uuid> references
    return transformedPatch;
  },
});
```

See [IMAGE-STORAGE.md](https://github.com/mizuka-wu/y-mxgraph/blob/main/apps/demo/src/helpers/IMAGE-STORAGE.md) for a complete implementation.

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

### `forceSync(direction?: "ydoc-to-file" | "file-to-ydoc"): void`

Force sync ydoc and file to fix detected inconsistencies.

**Parameters**:

- `direction` — sync direction, defaults to `"ydoc-to-file"`
  - `"ydoc-to-file"`: overwrite file with ydoc data (cleans invalid cellOrder)
  - `"file-to-ydoc"`: overwrite ydoc with file data

**Invalid cellOrder cleanup**:

In the `ydoc-to-file` direction, automatically cleans cell ids that don't exist in the cellsMap. This fixes the order and map inconsistency that can be caused by undo operations.

**Note**: Cleanup only executes during `forceSync`, doesn't affect the undo stack, and doesn't clean data received from the server.

```ts
// Fix data inconsistency
binding.forceSync("ydoc-to-file");

// Overwrite remote with local data
binding.forceSync("file-to-ydoc");
```

### `validateDocIntegrity(): number`

Manually trigger a document integrity check with self-healing. Checks consistency between cellsOrder and cellsMap, automatically fixing issues when found.

**Returns**: Number of issues fixed, `0` means the document is healthy.

**Checks**:

1. Cell 0/1 existence
2. Duplicate ids in cellsOrder (auto-deduplicated)
3. cellsOrder vs cellsMap consistency (auto-patched)
4. Parent chain completeness (warn only, no auto-fix)

**Excluded from undo stack**: All self-healing operations use `INTEGRITY_ORIGIN` for their transaction origin, which is not in `trackedOrigins` and won't be recorded by the UndoManager.

```ts
const issues = binding.validateDocIntegrity();
if (issues > 0) {
  console.log(`Fixed ${issues} issues`);
}
```

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
