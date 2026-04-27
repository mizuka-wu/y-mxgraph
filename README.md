# y-mxgraph

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
import { bindDrawioFile } from 'y-mxgraph';

const doc = new Y.Doc();

App.main((app) => {
  bindDrawioFile(app.currentFile, { doc });
});
```

## Documentation

- [Getting Started Guide](https://mizuka-wu.github.io/y-mxgraph/guide/getting-started)
- [API Reference](https://mizuka-wu.github.io/y-mxgraph/api/)

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

# Demo
pnpm --filter @y-mxgraph/demo dev
```

## License

MIT
