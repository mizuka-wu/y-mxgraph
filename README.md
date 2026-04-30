# y-mxgraph

[中文文档](./README.zh-CN.md)

Yjs binding for draw.io (mxGraph) documents, enabling real-time collaborative editing.

## Features

- **Bidirectional binding** between draw.io files and Y.Doc
- **Real-time collaboration** via y-webrtc, y-websocket, or any Yjs provider
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
import { Binding, LOCAL_ORIGIN } from 'y-mxgraph';

const doc = new Y.Doc();

App.main((app) => {
  // Ensure consistent initial files across clients. draw.io generates random diagram ids by default,
  // which can cause sync issues if clients start from different states. Use generateFileTemplate to create a unified template.
  if (!app.currentFile.data) {
    app.currentFile.data = Binding.generateFileTemplate('diagram-0');
  }

  const binding = new Binding(app.currentFile, { doc });

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

# iframe mode (parent page runs WebRTC Provider, two iframes each run draw.io + y-mxgraph, synced via postMessage)
# Visit http://localhost:5173/iframe-mode.html
```

## Docs

```bash
pnpm --filter @y-mxgraph/docs dev
```

## License

MIT
