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
  // 确保多端初始文件一致；draw.io 默认创建时 diagram id 是随机的，
  // 若各客户端起点不同会导致协同异常。可用 generateFileTemplate 生成统一模板。
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

# Demo

```bash
# 单页模式（draw.io 直接加载在当前页面）
pnpm --filter @y-mxgraph/demo dev

# iframe 模式（父页运行 WebRTC Provider，两个 iframe 各跑一套 draw.io + y-mxgraph，通过 postMessage 同步）
# 访问 http://localhost:5173/iframe-mode.html
```

# Docs

pnpm --filter @y-mxgraph/docs dev

```

## License

MIT
