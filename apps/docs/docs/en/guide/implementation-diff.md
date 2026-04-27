# Migration Guide

This document lists the key differences between the current `y-mxgraph` implementation and the original.

## API Changes

| Item | Original | Current | Notes |
|------|----------|---------|-------|
| `options.doc` | optional, defaults to `new Y.Doc()` | **required** | Must be provided externally to share with a Provider |
| `options.trackLocalUndoOnly` | present | **removed** | UndoManager is fully controlled externally |
| `options.undoManager` | supports internal creation | **external only** | Simplified API; configure `trackedOrigins` yourself |
| API shape | factory function | **`Binding` class** | Recommended: `new Binding()`, includes `destroy()` |
| `destroy()` | absent | **present** | Removes all listeners and restores the original undoManager |

## Feature Differences

### Debug Output

| Location | Original | Current |
|----------|----------|---------|
| `binding/index.ts` | `console.log("local patch", patch)` | **removed** |
| `binding/index.ts` | `console.log("undoManager/remote patch", patch)` | **removed** |
| `patch.ts` | `console.log(mxfile.toJSON(), patch)` | **removed** |
| `transformer/index.ts` | `console.warn("unsupported file type")` | **removed** |

### UndoManager Behavior

```ts
// Original
bindUndoManager(doc, file, {
  undoManager?: Y.UndoManager;
  trackLocalUndoOnly?: boolean;  // configurable
})

// Current
bindUndoManager(doc, file, yUndo: Y.UndoManager)  // use external instance directly
```

**Difference**:

- The original supported `trackLocalUndoOnly: false` (track all transactions)
- The current implementation only tracks transactions tagged with `LOCAL_ORIGIN`
- This is an **intentional design simplification**: the UndoManager is created externally and `trackedOrigins` should be configured there

### Data Sync Mechanism

| Direction | Mechanism | Notes |
|-----------|-----------|-------|
| draw.io → Y.Doc | `file.ui.diffPages()` → `applyFilePatch()` | Same as original |
| Y.Doc → draw.io | `observeDeep()` → `generatePatch()` → `file.patch()` | Same as original |

### Collaboration Features

| Feature | Original | Current |
|---------|----------|---------|
| Cursor sync | `bindCursor()` | ✅ retained |
| Selection sync | `bindSelection()` | ✅ retained |
| Color generation | `generateColor()` | ✅ retained |
| Random username | `generateRandomName()` | ✅ retained |

## Export Differences

| Export | Original | Current | Status |
|--------|----------|---------|--------|
| `Binding` | ❌ (function) | ✅ (class) | Changed to class |
| `xml2doc` | ✅ | ✅ | Retained |
| `doc2xml` | ✅ | ✅ | Retained |
| `LOCAL_ORIGIN` | ✅ | ✅ | Retained |
| `DEFAULT_USER_NAME_KEY` | ✅ (binding/index.ts) | ✅ (binding/collaborator) | Retained |
| `DEFAULT_USER_COLOR_KEY` | ✅ (binding/index.ts) | ✅ (binding/collaborator) | Retained |
| `BindDrawioFileOptions` | inline type | standalone interface | Improved |

## Type Improvements

```ts
// Current: standalone options interface
export interface BindDrawioFileOptions {
  doc: Y.Doc;                  // required
  awareness?: Awareness;
  undoManager?: Y.UndoManager;
  mouseMoveThrottle?: number;
  cursor?: boolean | { userNameKey?: string; userColorKey?: string };
}

// Original: inlined in function parameters
function bindDrawioFile(file: any, options: { ... } = {})
```

## Code Cleanup

| Item | Status |
|------|--------|
| TODO comments | Removed (features implemented) |
| Dead code (`docObserver`) | Removed |
| Redundant transaction nesting | Cleaned up |

## Unchanged Core Logic

The following modules are essentially identical to the original:

- `transformer/` — XML ↔ Y.Doc conversion
- `models/` — Yjs data model definitions
- `helper/xml.ts` — XML serialization/deserialization
- `helper/awarenessStateValue.ts` — Awareness state management
- `binding/patch.ts` — Patch generation and application
- `binding/collaborator/` — Cursor and selection collaboration

## Migration from the Original

```ts
// Original
const binding = bindDrawioFile(file, {
  doc: new Y.Doc(),  // optional
  undoManager: myUndoManager,  // trackedOrigins configured internally
  trackLocalUndoOnly: true,    // removed
});

// Current (recommended class API)
const yDoc = new Y.Doc();
const undoManager = new Y.UndoManager(yDoc, {
  trackedOrigins: new Set([LOCAL_ORIGIN]),  // configure externally
});

const binding = new Binding(file, {
  doc: yDoc,       // required
  undoManager,
});

// Clean up when done
binding.destroy(true);
```

### Key Points

1. **Y.Doc must be created externally** — no longer created internally, so it can be shared with a Provider
2. **Configure `trackedOrigins` externally** — use the `LOCAL_ORIGIN` constant
3. **Always call `destroy()`** — prevents memory leaks on unmount or page close
