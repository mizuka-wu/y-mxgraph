# Architecture

This document describes the core implementation of `y-mxgraph`.

## Overview

y-mxgraph acts as an **adapter layer** that translates Yjs changes into the native patch format recognized by draw.io's built-in collaboration system, making draw.io behave as if its own real-time collaboration feature is running.

```text
┌─────────────────────────────────────────────────────────────┐
│                         draw.io                             │
│  ┌─────────────┐      ┌──────────────────────────────┐     │
│  │   mxGraph   │◄────►│  draw.io native collab        │     │
│  │  (UI/canvas)│      │  (file.patch / diffPages)     │     │
│  └─────────────┘      └──────────────┬────────────────┘     │
└──────────────────────────────────────│───────────────────────┘
                                       │
                              Emulates native collab API
                                       │
                              ┌────────▼────────┐
                              │   y-mxgraph     │
                              │  (adapter layer)│
                              └────────┬────────┘
                                       │
                              ┌────────▼────────┐
                              │     Y.Doc       │
                              │    (CRDT)       │
                              └────────┬────────┘
                                       │
                              ┌────────▼────────┐
                              │  Provider       │
                              │ (y-webrtc, etc) │
                              └─────────────────┘
```

## Core Idea

draw.io ships with a mature real-time collaboration system (WebSocket-based). y-mxgraph does not replace it — it **reuses** it:

| Direction | Operation | Description |
|-----------|-----------|-------------|
| Local change | `diffPages()` → Y.Doc | Intercepts draw.io's diff output and stores it in Yjs |
| Remote change | Y.Doc → `patch()` | Generates a draw.io-compatible patch and injects it into the collab system |

**Advantages**:

- No need to modify draw.io's internal drawing logic
- Inherits draw.io's conflict handling, selection sync, and cursor collaboration
- Yjs provides strong-consistency CRDT-based real-time collaboration

### draw.io → Y.Doc (Local Change Capture)

Reuses draw.io's **native diff mechanism**:

```ts
mxGraphModel.addListener("change", () => {
  const patch = file.ui.diffPages(file.shadowPages, file.ui.pages);
  file.setShadowPages(file.ui.clonePages(file.ui.pages));
  applyFilePatch(doc, patch, { origin: LOCAL_ORIGIN });
});
```

**Flow**:

1. User action triggers the mxGraph `change` event
2. `diffPages()` is draw.io's **built-in** diff algorithm
3. Compares `shadowPages` (last synced state) against current `pages` to produce a patch
4. `applyFilePatch()` converts the patch to Yjs CRDT operations
5. Updates `shadowPages` to maintain the sync baseline
6. Tagged with `LOCAL_ORIGIN` to prevent feedback loops

### Y.Doc → draw.io (Remote Change Injection)

Disguises Yjs changes as **draw.io native collaboration patches**:

```ts
doc.getMap(mxfileKey).observeDeep((events, transaction) => {
  if (transaction.local && transaction.origin === LOCAL_ORIGIN) {
    generatePatch(events);  // update snapshot only, don't apply to UI
    return;
  }
  const patch = generatePatch(events);  // produce draw.io-native patch
  file.patch([patch]);                  // call draw.io's built-in apply method
  file.setShadowPages(file.ui.clonePages(file.ui.pages));
});
```

**Flow**:

1. Provider syncs remote Yjs changes
2. `observeDeep` detects Y.Map/Y.Array mutations
3. Skips local transactions (prevents feedback loops)
4. `generatePatch()` produces a patch in draw.io's **native format**
5. `file.patch()` is draw.io's **built-in** collaboration apply method
6. draw.io renders the changes using its own collaboration logic

## Patch Structure

```ts
interface FilePatch {
  // Diagram ids to remove
  r?: string[];

  // Diagrams to insert
  i?: Array<{
    data: string;      // XML content
    id: string;        // diagram id
    previous: string;  // preceding diagram id (for ordering)
  }>;

  // Diagrams to update
  u?: {
    [diagramId: string]: {
      name?: string;        // rename
      previous?: string;    // reorder
      cells?: {
        r?: string[];                      // remove cells
        i?: Array<Record<string, string>>; // insert cells
        u?: {                              // update cell attributes
          [cellId: string]: Record<string, string>;
        };
      };
    };
  };
}
```

**Field names**:

- `r` (remove): ids to delete
- `i` (insert): items to add, including XML data and position
- `u` (update): attribute changes and reorder operations

## Order Maintenance

### Diagram Order

Uses `Y.Array<string>` to store diagram id order:

```ts
// mxfile structure
{
  diagrams: Y.Map<YDiagram>,
  [diagramOrderKey]: Y.Array<string>
}
```

Insertion position is determined by the `previous` field, supporting concurrent-insert conflict resolution.

### Cell Order

Each diagram independently maintains its own cell order:

```ts
// mxGraphModel structure
{
  [mxCellKey]: Y.Map<Y.XmlElement>,
  [mxCellOrderKey]: Y.Array<string>
}
```

## Snapshot Mechanism

```ts
type DocSnapshot = {
  diagramOrder: string[] | null;
  cellsOrder: Map<string, string[]>;
  cellAttrs: Map<string, Map<string, Record<string, string>>>;
};

const docSnapshots = new WeakMap<Y.Doc, DocSnapshot>();
```

**Purpose**:

- Records document state before each transaction
- Used by `generatePatch()` to compute diffs
- `WeakMap` prevents memory leaks

## Undo/Redo Integration

### Transaction Tagging

```ts
export const LOCAL_ORIGIN: object = {};

doc.transact(() => {
  // local change
}, LOCAL_ORIGIN);
```

### UndoManager Configuration

```ts
const undoManager = new Y.UndoManager(doc, {
  trackedOrigins: new Set([LOCAL_ORIGIN]),
});
```

**Key points**:

- Only transactions tagged with `LOCAL_ORIGIN` enter the undo stack
- Remote transactions are excluded
- `bindUndoManager()` provides an mxUndoManager compatibility shim

## Collaboration Features

### Awareness State

```ts
// Local state
awareness.setLocalState({
  'user.name': 'Alice',
  'user.color': '#ff0000',
  'cursor': { x: 100, y: 200, pageId: '0' },
  'selection': { added: ['1', '2'], removed: [], pageId: '0' },
});

// Listen for remote state
awareness.on('update', ({ updated }) => {
  for (const clientId of updated) {
    const state = awareness.getStates().get(clientId);
    // render remote cursor/selection
  }
});
```

### Cursor Sync

```text
mouse move ──────────────────────────────►
    │                                      │
    ▼                                      ▼
mouseMoveThrottle (100ms)           mouseleave
    │                                      │
    ▼                                      ▼
cursor: { x, y, pageId }      cursor: { x, y, pageId, hide: true }
    │                                      │
    └──────────────┬───────────────────────┘
                   ▼
          awareness.setLocalStateField()
                   │
                   ▼
            remote clients receive
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
    hide: false           hide: true
    create/update cursor   remove cursor DOM
```

**Key design decisions**:

- **Throttle**: `mouseMoveThrottle` defaults to 100 ms
- **Coordinate transform**: screen → canvas coordinates (accounts for scale/translate)
- **Page isolation**: includes `pageId`; cursors on other pages are hidden
- **Visibility**: `hide` field controls visibility when mouse leaves the canvas

### Selection Sync

```text
local selection change
    │
    ▼
selectionModel.addListener("change")
    │
    ▼
awareness.setLocalStateField("selection", {
  added: [...],    // newly selected cell ids
  removed: [...],  // deselected cell ids
  pageId,
})
    │
    ▼
remote clients receive
    │
    ▼
renderRemoteSelections()
    │
    ├─► added: graph.highlightCell(cell, userColor)
    │
    └─► removed: highlightCell.destroy()
```

**Key design decisions**:

- **Incremental**: only syncs the delta (added/removed), not the full selection
- **Page isolation**: only renders selections on the current page
- **Auto-cleanup**: destroys highlights when the user leaves or switches pages

## XML Conversion

### xml2ydoc

```text
mxfile XML → xml-js → Y.Map/Y.Array/Y.XmlElement → Y.Doc
```

- mxCell is converted to `Y.XmlElement`, preserving full XML semantics
- Order information is extracted into `Y.Array`
- Diagram structure is stored flat

### ydoc2xml

```text
Y.Doc → traverse Y data structures → xml-js → mxfile XML
```

- Reconstructs XML in order
- Restores hierarchy via `previous` relationships
- Supports indented formatting

## Conflict Resolution

### Concurrent Inserts

```ts
insertAfterUnique(orderArr, id, previous, fallbackToEnd);
```

**Strategy**:

1. Find the anchor position from `previous`
2. Compute depth (handles chained dependencies)
3. Sort by depth and order, then batch-insert

### Deduplication

```ts
function ensureUniqueOrder(orderArr: Y.Array<string>) {
  // removes duplicate ids, keeps the first occurrence
}
```

## Error Recovery

### Cell 0/1 Protection

Cell 0 (root node) and Cell 1 (default layer) are fundamental to draw.io's structure. If they are deleted from the Y.Doc, the entire diagram breaks. y-mxgraph provides multi-layer protection:

| Defense Point | Mechanism | Scenario Covered |
|---------------|-----------|-----------------|
| `applyFilePatch` | Filters deletion list, skips `"0"` `"1"` | Accidental deletion in file→ydoc path |
| `generatePatch` | Filters diff detection, won't mark `"0"` `"1"` as deleted | False positive in diff detection |
| `docObserver` | Calls `ensureBasicCell()` after remote/undo-redo changes | Remote peer deletion |
| `cleanInvalidCellOrder` | Skips `"0"` `"1"` during forceSync cleanup | Cleanup logic false positive |
| `mxGraphModel.parse` | Fallback creation of cell 0/1 during XML parsing | Missing from XML |

### `ensureBasicCell` Function

```ts
export function ensureBasicCell(doc: Y.Doc): void {
  // Iterates all diagrams, ensures "0" and "1" exist in cellsMap and cellsOrder
  // Creates them if missing and inserts at the beginning of cellsOrder
  // Ensures 0 comes before 1
}
```

**Idempotent**: If cell 0/1 already exist, no operation is performed. Safe to call at any time.

### When It Runs

1. **`initBinding`**: Immediately restores missing cells when loading an existing ydoc (fixes historical data)
2. **`docObserver`**: Ensures cell 0/1 exist after remote sync or undo/redo changes
3. **`mxGraphModel.parse`**: Fallback creation during XML→ydoc conversion

### Protected Cells

```ts
export const PROTECTED_CELLS = new Set(["0", "1"]);
```

All deletion logic (`applyFilePatch`, `generatePatch`, `cleanInvalidCellOrder`) checks this set and skips protected cells.

### `validateDocIntegrity` Function

```ts
export function validateDocIntegrity(doc: Y.Doc): number {
  // Iterates all diagrams, checks cellsOrder vs cellsMap consistency
  // Auto-heals: deduplicates, patches missing ids, removes orphan ids
  // All modifications use INTEGRITY_ORIGIN transactions, excluded from undo stack
}
```

**Checks**:
1. Cell 0/1 existence (double-check after ensureBasicCell)
2. Duplicate ids in cellsOrder → auto-deduplicate
3. cellsOrder vs cellsMap consistency → auto-patch
4. Parent chain completeness → warn only, no auto-fix

**Usage**: Call via `binding.validateDocIntegrity()` public method. The caller decides when to trigger.

### Snapshot Recovery

When the ydoc is corrupted (missing cell 0/1), recovering from a historical snapshot follows this flow:

```
snapshot (has cell 0/1) → reset file.data → initDocSnapshot rebuilds baseline → diff → patch
```

**Problem before the fix**: `generatePatch` would detect missing cell 0/1 as "removed", generating a deletion patch. Even though cell 0/1 already didn't exist, this detection would affect subsequent diff logic, causing recovery to fail.

**After the fix**:
- `generatePatch` filters `"0"` `"1"`, won't mark them as deleted
- `applyFilePatch` filters `"0"` `"1"`, won't execute deletion
- `ensureBasicCell` restores missing cells in `initBinding` and `docObserver`

Therefore, the snapshot recovery path is safe: regardless of the ydoc's current state, as long as the snapshot is correct, recovery will succeed.

### Manual Recovery: `resetYdocFromFile()`

When automatic recovery fails (e.g., ydoc severely corrupted, remote sync unavailable), call `binding.resetYdocFromFile()` to force-rebuild the ydoc from file.data:

```ts
binding.resetYdocFromFile();
```

**Flow**: `file.data` (XML) → `xml2ydoc` → `mxGraphModel.parse` (fallback creates cell 0/1) → `ensureBasicCell` → ydoc complete

**Difference from `forceSync("file-to-ydoc")`**:
- `forceSync` is routine sync: cleans invalid cellOrder, resets drift counter
- `resetYdocFromFile` is destructive recovery: discards all ydoc data, rebuilds from file XML
- Use when ydoc is severely corrupted and other recovery methods have failed

## Performance

1. **Batched patch apply**: multiple changes in a single transaction
2. **Throttling**: cursor move throttled (default 100 ms)
3. **Lazy init**: snapshot initialized on first bind
4. **WeakMap storage**: automatic GC of unused doc snapshots

## Limitations & Notes

1. **Destroy**: call `destroy(true)` when unmounting to fully clean up
2. **Single doc**: each draw.io file is bound to one Y.Doc; multiple docs are not supported
3. **draw.io API dependency**: relies on internal APIs like `file.ui.diffPages()` which may change across draw.io versions
4. **Undo Stack Safety**:
   - Invalid cellOrder (cell ids not present in cellsMap) can be caused by undo operations
   - `generatePatch` filters out these invalid ids to prevent crashes
   - Cleanup only executes during `forceSync` to avoid affecting the undo stack
   - Does not clean data received from the server to avoid data inconsistency
