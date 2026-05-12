# y-mxgraph

[中文文档](./README.zh-CN.md)

Yjs binding for draw.io (mxGraph) documents, enabling real-time collaborative editing.

## Features

- **Bidirectional binding** between draw.io files and Y.Doc
- **Real-time collaboration** via y-webrtc, y-websocket, or any Yjs provider
- **iframe bridge** — because draw.io is often embedded in iframes, `y-mxgraph` provides a dedicated postMessage bridge (`y-mxgraph/iframe-bridge`) to sync Y.Doc and Awareness across iframe boundaries without extra dependencies
- **Undo/Redo support** with Y.UndoManager
- **Collaborative cursors** via y-protocols Awareness
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
  const binding = new Binding(file, { doc /*, initialContent: 'merge-remote' */ });

  window.addEventListener('beforeunload', () => binding.destroy());
});
```

## Documentation

- [Getting Started](https://mizuka-wu.github.io/y-mxgraph/en/guide/getting-started)
- [API Reference](https://mizuka-wu.github.io/y-mxgraph/en/api/)
- [Architecture](https://mizuka-wu.github.io/y-mxgraph/en/guide/architecture)

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

# iframe mode (parent page hosts two iframes; each iframe gets its own Y.Doc + WebRTC provider,
# synced with the parent via y-mxgraph's built-in iframe bridge)
# Visit http://localhost:5173/iframe-mode.html

# WebSocket server mode (centralized server with file persistence)
pnpm --filter @y-mxgraph/ws-demo server  # Start server on port 1234
pnpm --filter @y-mxgraph/ws-demo dev     # Start client on port 5174
```

### Using the iframe bridge

Because draw.io is commonly embedded in `<iframe>` elements (e.g., in CMS, whiteboard, or low-code platforms), `y-mxgraph` ships a dedicated **iframe bridge** so you don't have to write your own `postMessage` protocol.

### Host (parent page)

```ts
import { YMxGraphBridgeProvider } from 'y-mxgraph/iframe-bridge/provider';

const doc = new Y.Doc();
const provider = new WebrtcProvider('my-room', doc);

const bridge = new YMxGraphBridgeProvider(iframeElement, doc, {
  awareness: provider.awareness,
});
```

### Guest (inside iframe)

```ts
import { YMxGraphBridgeClient } from 'y-mxgraph/iframe-bridge/client';

const bridge = new YMxGraphBridgeClient();
// bridge.doc and bridge.awareness are kept in sync with the host

const binding = new Binding(file, {
  doc: bridge.doc,
  awareness: bridge.awareness,
  // initialContent strategy (default 'replace'):
  //   'replace'      : Y.Doc wins; file UI is replaced with doc XML
  //   'merge-remote' : union by diagram id; doc wins on conflicts
  //   'merge-client' : union by diagram id; file wins on conflicts
  initialContent: 'replace',
});
```

## Docs

```bash
pnpm --filter @y-mxgraph/docs dev
```

## License

MIT
