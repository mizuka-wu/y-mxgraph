# y-mxgraph

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
  const binding = new Binding(file, { doc });
});
```

### iframe Mode

When draw.io runs inside an `<iframe>`, use the built-in bridge:

### Host (parent page)

```ts
import { YMxGraphBridgeProvider } from 'y-mxgraph/iframe-bridge/provider';

const bridge = new YMxGraphBridgeProvider(iframeElement, doc, {
  awareness: provider.awareness,
});
```

### Guest (inside iframe)

```ts
import { YMxGraphBridgeClient } from 'y-mxgraph/iframe-bridge/client';

const bridge = new YMxGraphBridgeClient();

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

See the full documentation at [https://mizuka-wu.github.io/y-mxgraph](https://mizuka-wu.github.io/y-mxgraph).

## License

MIT
