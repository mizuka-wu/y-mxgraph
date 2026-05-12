# Sync Strategy

This document explains the synchronization strategy when integrating y-mxgraph with draw.io, helping you understand why a specific initialization flow is required.

## Background

When multiple clients collaborate on the same draw.io file, we need to ensure:

1. **Consistent initial data** — All clients use the same diagram IDs
2. **Correct sync timing** — New clients get remote data before creating Binding
3. **Proper UI rendering** — draw.io UI should display synced data correctly

## Why Wait for Sync

When a new client joins a room, Y.Doc is empty. Creating Binding immediately:

```typescript
// ❌ Wrong approach
const binding = new Binding(file, { doc });
```

Will cause:

1. Binding detects Y.Doc is empty, initializes with local template
2. Remote data arrives, conflicts with local data
3. Data inconsistency across clients, "orphaned pages" appear

**Correct approach** is to wait for Y.Doc to receive remote data before creating Binding:

```typescript
const mxfileMap = doc.getMap('mxfile');
const diagramMap = mxfileMap.get('diagram');
const hasData = diagramMap && diagramMap.size > 0;

if (hasData) {
  // Has data, bind immediately
  setTimeout(tryBind, 300);
} else {
  const peerCount = provider.awareness.getStates().size;
  if (peerCount <= 1) {
    // Solo mode, bind immediately
    setTimeout(tryBind, 300);
  } else {
    // Has other peers, wait for remote data sync
    doc.on('update', () => {
      if (diagramMap && diagramMap.size > 0) {
        tryBind();
      }
    });
  }
}
```

## How Binding Reconciles doc and file

draw.io's `file.patch()` only updates internal data structure and **does not trigger UI re-rendering**. To repaint the canvas you must call `file.ui.setFileData(xml)`; to keep `file.data` in sync you also need `file.setData(xml)`.

Previous versions required callers to do this manually before constructing `Binding`. The current `Binding` handles it automatically via the `initialContent` option (default `replace`):

```typescript
// default 'replace': overwrite file UI with doc XML if doc is non-empty
new Binding(file, { doc });

// 'merge-remote': union by diagram id; doc wins on conflicts
new Binding(file, { doc, initialContent: 'merge-remote' });

// 'merge-client': union by diagram id; file wins on conflicts
new Binding(file, { doc, initialContent: 'merge-client' });
```

For custom `DrawioFile` subclasses (e.g. `CollabFile` / `DriveFile`) whose `setData` triggers an auto-save, supply the `applyFileData` hook to override the default behaviour:

```typescript
new Binding(file, {
  doc,
  applyFileData: (f, xml) => {
    // refresh UI only, skip setData to avoid triggering auto-save
    f.ui.setFileData(xml);
  },
});
```

## Complete Flow

```typescript
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { Binding } from 'y-mxgraph';

const doc = new Y.Doc();
const provider = new WebrtcProvider('my-room', doc);

function bindDrawio() {
  const App = (window as any).App;
  if (!App) {
    setTimeout(bindDrawio, 500);
    return;
  }

  App.main((ui: any) => {
    const file = ui.currentFile;

    // Binding internally calls file.ui.setFileData(xml) + file.setData(xml)
    // according to the initialContent strategy (default 'replace').
    const binding = new Binding(file, { doc });

    ui.refresh();
    window.dispatchEvent(new Event('resize'));
  }, () => {
    // UI factory function
    const Editor = (window as any).Editor;
    const container = document.getElementById('drawio-container')!;
    const editor = new Editor(false, null, null, null, true);
    return new App(editor, container);
  });
}

// Wait for sync before binding
const mxfileMap = doc.getMap('mxfile');
const diagramMap = mxfileMap.get('diagram');
if (diagramMap && diagramMap.size > 0) {
  setTimeout(bindDrawio, 300);
} else {
  doc.on('update', () => {
    const dm = mxfileMap.get('diagram');
    if (dm && dm.size > 0) {
      bindDrawio();
    }
  });
}
```

## Comparison with ws-demo

| Feature | demo (WebRTC) | ws-demo (WebSocket) |
|---------|---------------|---------------------|
| Sync strategy | Wait for Y.Doc update event | Wait for provider synced event |
| Data sync | Binding handles automatically (replace) | Binding handles automatically (replace) |
| Timeout fallback | 500ms | None (WebSocket reliable) |

## Common Issues

### New window doesn't show data from old window

**Cause**: Binding created before Y.Doc received remote data.

**Solution**: Wait for Y.Doc to have data before creating Binding (see code above).

### Data synced but UI not updated

**Cause**: Neither `file.patch()` nor `file.setData()` repaints the canvas; only `file.ui.setFileData(xml)` rebuilds pages and mxGraphModel.

**Solution**: Use Binding v0.2+ which calls both `setFileData` and `setData` automatically during initialization. If you only need to refresh UI without touching `file.data`, override via the `applyFileData` hook.

### Orphaned pages appear

**Cause**: Local template's diagram ID inconsistent with remote data.

**Solution**: Use `Binding.generateFileTemplate(diagramId)` to generate unified template.
