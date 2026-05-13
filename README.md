# y-mxgraph

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

`@y-mxgraph/iframe-bridge` enables collaborative editing in iframe-isolated environments. The **server** (parent page) manages the network connection (y-webrtc, y-websocket, etc.) and syncs Y.Doc + Awareness to one or more **providers** (iframe children) via `postMessage`.

```text
┌─────────────────────────────────────────────────────────────┐
│  Server (parent page)                                       │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────────────┐ │
│  │  Y.Doc   │  │ Awareness │  │ Provider (y-webrtc, etc) │ │
│  └────┬─────┘  └─────┬─────┘  └──────────────────────────┘ │
│       │              │                                      │
│       └──────┬───────┘                                      │
│              ▼                                              │
│   createIframeBridgeServer(doc, awareness)                  │
│              │ postMessage                                  │
└──────────────│──────────────────────────────────────────────┘
               │
    ┌──────────┴──────────┐
    ▼                     ▼
┌─────────────┐     ┌─────────────┐
│ Iframe A    │     │ Iframe B    │
│ create...   │     │ create...   │
│ Provider()  │     │ Provider()  │
│             │     │             │
│ local Y.Doc │     │ local Y.Doc │
│ + draw.io   │     │ + draw.io   │
└─────────────┘     └─────────────┘
```

```ts
// Server (parent page)
import { createIframeBridgeServer } from 'y-mxgraph/iframe-bridge/server';

const doc = new Y.Doc();
const provider = new WebrtcProvider(roomName, doc, { signaling });
const bridge = createIframeBridgeServer(doc, provider.awareness);
bridge.addIframe(iframeElement, 'child-1');

// Provider (iframe child)
import { createIframeBridgeProvider } from 'y-mxgraph/iframe-bridge/provider';

const doc = new Y.Doc();
const awareness = new Awareness(doc);
const bridge = createIframeBridgeProvider(doc, awareness);
// awareness states are automatically synced with the server
```

See [iframe Bridge documentation](https://mizuka-wu.github.io/y-mxgraph/en/guide/iframe-bridge) for details.

## Docs

```bash
pnpm --filter @y-mxgraph/docs dev
```

## License

MIT
