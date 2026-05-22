# y-mxgraph

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/mizuka-wu/y-mxgraph)

[中文文档](./README.zh-CN.md)

Yjs binding for draw.io (mxGraph) documents, enabling real-time collaborative editing.

## Features

- **Bidirectional binding** between draw.io files and Y.Doc
- **Real-time collaboration** via y-webrtc, y-websocket, or any Yjs provider
- **Undo/Redo support** with Y.UndoManager
- **Collaborative cursors** via y-protocols Awareness
- **iframe Bridge** for isolated draw.io instances synced via postMessage
- **Full TypeScript** support

## Installation

```bash
pnpm add y-mxgraph yjs y-protocols
```

`yjs` and `y-protocols` are peer dependencies.

## Quick Start

```ts
import * as Y from 'yjs';
import { Binding } from 'y-mxgraph';

const doc = new Y.Doc();

App.main((app) => {
  const file = app.currentFile;

  // Binding automatically reconciles file and Y.Doc based on
  // `initialContent` strategy (default: 'replace').
  //   - 'replace'      : Y.Doc wins; file UI is replaced with doc XML
  //   - 'merge-remote' : union by diagram id; doc wins on conflicts
  //   - 'merge-client' : union by diagram id; file wins on conflicts
  //
  // By default only `file.ui.setFileData(xml)` is called (rebuilds UI).
  // `file.setData(xml)` is intentionally NOT called so draw.io does not
  // mark the file as modified and pop up the "Save diagrams to:" dialog.
  // Override via `applyFileData` if you need to sync `file.data` too.
  //
  // `disableBeforeUnload` (default: true) disables draw.io's native
  // "All changes will be lost" dialog since Yjs handles persistence.
  const binding = new Binding(file, { doc });

  window.addEventListener('beforeunload', () => binding.destroy());
});
```

## Documentation

- [Getting Started](https://mizuka-wu.github.io/y-mxgraph/en/guide/getting-started)
- [API Reference](https://mizuka-wu.github.io/y-mxgraph/en/api/)
- [Architecture](https://mizuka-wu.github.io/y-mxgraph/en/guide/architecture)
- [iframe Bridge](https://mizuka-wu.github.io/y-mxgraph/en/guide/iframe-bridge)

## Development

```bash
# Clone
git clone https://github.com/mizuka-wu/y-mxgraph.git
cd y-mxgraph

# Install
pnpm install

# Build
pnpm --filter y-mxgraph build

# Test
pnpm --filter y-mxgraph test
```

## Demo

```bash
# Single-page mode (draw.io loaded directly in the current page)
pnpm --filter @y-mxgraph/demo dev

# iframe mode (server page runs WebRTC Provider, iframes each run draw.io + y-mxgraph, synced via postMessage)
# Visit http://localhost:5173/iframe.html

# WebSocket server mode (centralized server with file persistence)
pnpm --filter @y-mxgraph/ws-demo server  # Start server on port 1234
pnpm --filter @y-mxgraph/ws-demo dev     # Start client on port 5174
```

## iframe Bridge

`@y-mxgraph/iframe-bridge` enables collaborative editing in iframe-isolated environments. The **server** (parent page) manages the network connection (y-webrtc, y-websocket, etc.) and syncs Y.Doc + Awareness to **providers** (iframe children) via `postMessage`.

```text
┌─────────────────────────────────────────────────────────────┐
│  Server (parent page)                                       │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────────────┐ │
│  │  Y.Doc   │  │ Awareness │  │ Provider (y-webrtc, etc) │ │
│  └────┬─────┘  └─────┬─────┘  └──────────────────────────┘ │
│       │              │                                      │
│       └──────┬───────┘                                      │
│              ▼                                              │
│   createIframeBridgeServer(iframe, doc, awareness)          │
│              │ postMessage                                  │
└──────────────│──────────────────────────────────────────────┘
               │
               ▼
        ┌─────────────┐
        │   Iframe    │
        │             │
        │ local Y.Doc │
        │ + Awareness │
        │ + draw.io   │
        └─────────────┘
```

### Complete Example

#### 1. Parent Page (Server)

```html
<!DOCTYPE html>
<html>
<head>
  <title>iframe Bridge Server</title>
</head>
<body>
  <div>
    <label>User: <input id="username" value="Alice" /></label>
    <label>Color: <input id="usercolor" type="color" value="#2563eb" /></label>
    <button id="undo-btn" disabled>Undo</button>
    <button id="redo-btn" disabled>Redo</button>
    <span id="status">Disconnected</span>
  </div>
  <iframe id="editor-iframe" src="./editor.html" style="width:100%;height:80vh;border:1px solid #ccc"></iframe>
  
  <script type="module">
    import * as Y from 'yjs';
    import { WebrtcProvider } from 'y-webrtc';
    import { LOCAL_ORIGIN } from 'y-mxgraph';
    import { IFRAME_ORIGIN } from 'y-mxgraph/iframe-bridge';
    import { createIframeBridgeServer } from 'y-mxgraph/iframe-bridge/server';

    const iframe = document.getElementById('editor-iframe');
    const statusEl = document.getElementById('status');
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');

    // 1. Create Y.Doc and network provider
    const doc = new Y.Doc();
    const provider = new WebrtcProvider('my-collab-room', doc);
    const awareness = provider.awareness;

    // 2. Set user info on parent awareness (synced to iframe automatically)
    const updateUserInfo = () => {
      awareness.setLocalState({
        user: {
          name: document.getElementById('username').value,
          color: document.getElementById('usercolor').value,
        }
      });
    };
    updateUserInfo();
    document.getElementById('username').onchange = updateUserInfo;
    document.getElementById('usercolor').onchange = updateUserInfo;

    // 3. Create UndoManager with cross-iframe support
    const undoManager = new Y.UndoManager(doc, {
      trackedOrigins: new Set([LOCAL_ORIGIN, IFRAME_ORIGIN]),
    });

    // 4. Create bridge server
    const bridge = createIframeBridgeServer(iframe, doc, awareness, {
      undoManager,
      debug: true, // Enable console logging
    });

    // 5. Monitor connection status
    bridge.onConnect(() => {
      statusEl.textContent = 'Connected';
      statusEl.style.color = 'green';
    });
    bridge.onDisconnect(() => {
      statusEl.textContent = 'Disconnected';
      statusEl.style.color = 'red';
    });

    // 6. Monitor peer count
    awareness.on('update', () => {
      const count = awareness.getStates().size;
      statusEl.textContent = `Connected (${count} peers)`;
    });

    // 7. Undo/Redo from parent page
    const updateUndoRedoButtons = () => {
      undoBtn.disabled = !undoManager.canUndo();
      redoBtn.disabled = !undoManager.canRedo();
    };
    undoManager.on('stack-item-added', updateUndoRedoButtons);
    undoManager.on('stack-item-popped', updateUndoRedoButtons);
    undoManager.on('stack-cleared', updateUndoRedoButtons);
    
    undoBtn.onclick = () => undoManager.canUndo() && undoManager.undo();
    redoBtn.onclick = () => undoManager.canRedo() && undoManager.redo();

    // 8. Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      bridge.destroy();
      provider.disconnect();
      provider.destroy();
      undoManager.destroy();
    });
  </script>
</body>
</html>
```

#### 2. Iframe Child (Provider)

```html
<!DOCTYPE html>
<html>
<head>
  <title>draw.io Editor</title>
</head>
<body>
  <div id="drawio-container"></div>
  
  <script type="module">
    import * as Y from 'yjs';
    import { Binding, LOCAL_ORIGIN } from 'y-mxgraph';
    import { createIframeBridgeProvider } from 'y-mxgraph/iframe-bridge/provider';

    // 1. Create local Y.Doc (no network provider needed)
    const doc = new Y.Doc();

    // 2. Create iframe bridge provider
    //    - No external awareness needed, provider creates its own AwarenessLike
    //    - Automatically syncs with parent via postMessage
    const bridge = createIframeBridgeProvider(doc, {
      debug: true, // Enable console logging
    });

    // 3. Monitor connection to parent
    bridge.onConnect(() => {
      console.log('[iframe] Connected to parent bridge');
    });
    bridge.onDisconnect(() => {
      console.log('[iframe] Disconnected from parent bridge');
    });

    // 4. Initialize draw.io
    App.main((app) => {
      const file = app.currentFile;

      // 5. Create binding with bridge awareness
      const binding = new Binding(file, {
        doc,
        awareness: bridge.awareness,
      });

      // 6. Takeover draw.io's undo manager to route through parent
      const cleanupUndo = bridge.takeoverUndoManager(file);

      // 7. Cleanup on page unload
      window.addEventListener('beforeunload', () => {
        binding.destroy();
        cleanupUndo();
        bridge.destroy();
      });
    });
  </script>
</body>
</html>
```

### Key Features

- **Automatic sync**: Y.Doc and Awareness state automatically sync between parent and iframe
- **User info propagation**: Set user info on parent awareness, iframe receives it automatically
- **Cross-iframe undo/redo**: UndoManager in parent page controls undo/redo for all iframes
- **Connection lifecycle**: `onConnect`/`onDisconnect` callbacks for status monitoring
- **Debug mode**: Set `debug: true` to log all postMessage traffic

### API Reference

#### `createIframeBridgeServer(iframe, ydoc, awareness, options?)`

Creates a bridge server on the parent page.

**Parameters:**
- `iframe: HTMLIFrameElement` - Target iframe element
- `ydoc: Y.Doc` - Shared Yjs document
- `awareness: Awareness` - Awareness instance (usually from provider.awareness)
- `options.undoManager?: Y.UndoManager` - Optional UndoManager for cross-iframe undo
- `options.debug?: boolean` - Enable debug logging (default: false)

**Returns:** `IframeBridgeServer` with:
- `connected: boolean` - Current connection status
- `onConnect(fn)` / `onDisconnect(fn)` - Connection lifecycle callbacks
- `destroy()` - Cleanup all listeners

#### `createIframeBridgeProvider(ydoc, options?)`

Creates a bridge provider inside the iframe.

**Parameters:**
- `ydoc: Y.Doc` - Local Yjs document
- `options.awareness?: Awareness` - Optional external Awareness (creates internal AwarenessLike if omitted)
- `options.debug?: boolean` - Enable debug logging (default: false)

**Returns:** `IframeBridgeProvider` with:
- `connected: boolean` - Connection status to parent
- `awareness: Awareness` - Awareness instance (use for Binding)
- `serverClientId: number | null` - Parent's client ID
- `setLocalFields(fields)` - Update local user fields
- `takeoverUndoManager(file)` - Route draw.io undo/redo through parent
- `onConnect(fn)` / `onDisconnect(fn)` - Connection lifecycle callbacks
- `destroy()` - Cleanup all listeners

See [iframe Bridge documentation](https://mizuka-wu.github.io/y-mxgraph/en/guide/iframe-bridge) for details.

## Docs

```bash
pnpm --filter @y-mxgraph/docs dev
```

## License

MIT
