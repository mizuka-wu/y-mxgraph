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

## Why Manually Sync doc to file

draw.io's `file.patch()` method only updates internal data structure, **does not trigger UI re-rendering**.

This means:
- Data is correctly synced to Y.Doc
- But draw.io UI still shows old data

Therefore, before creating Binding, we need to manually convert Y.Doc data to XML and set it to file:

```typescript
import { doc2xml } from 'y-mxgraph';

if (docHasData) {
  const xml = doc2xml(doc);
  file.ui.setFileData(xml);  // Update UI display
  file.setData(xml);         // Update data
}
```

This is a limitation of draw.io API. [ws-demo](https://github.com/mizuka-wu/y-mxgraph/tree/main/apps/simple-y-websocket-server-demo) uses the same approach.

## Complete Flow

```typescript
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { Binding, doc2xml } from 'y-mxgraph';

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

    // 1. Check if Y.Doc has data
    const mxfileMap = doc.getMap('mxfile');
    const diagramMap = mxfileMap.get('diagram');
    const docHasData = diagramMap && diagramMap.size > 0;

    // 2. Manually sync data to file
    if (docHasData) {
      file.ui.setFileData(doc2xml(doc));
      file.setData(doc2xml(doc));
    } else if (!file.data) {
      file.data = Binding.generateFileTemplate('diagram-0');
    }

    // 3. Create Binding
    const binding = new Binding(file, { doc });

    // 4. Refresh UI
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
| Data sync | Manual doc2xml + setFileData | Manual doc2xml + setFileData |
| Timeout fallback | 500ms | None (WebSocket reliable) |

Both use manual sync approach due to draw.io API limitations.

## Common Issues

### New window doesn't show data from old window

**Cause**: Binding created before Y.Doc received remote data.

**Solution**: Wait for Y.Doc to have data before creating Binding (see code above).

### Data synced but UI not updated

**Cause**: `file.patch()` doesn't trigger UI re-rendering.

**Solution**: Manually call `file.ui.setFileData(xml)` and `file.setData(xml)` before creating Binding.

### Orphaned pages appear

**Cause**: Local template's diagram ID inconsistent with remote data.

**Solution**: Use `Binding.generateFileTemplate(diagramId)` to generate unified template.
