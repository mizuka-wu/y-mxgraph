# Using Yjs Providers

## What is a Provider?

`y-mxgraph` is solely responsible for keeping the draw.io file state in sync with a **Yjs `Y.Doc`**. It does not care about how data is transported over the network.  
That transport layer is handled by **Yjs Providers** — they broadcast `Y.Doc` updates to other clients and apply remote changes locally.

You can choose any provider that fits your deployment requirements without changing any `y-mxgraph` code.

## Common Providers

Yjs and its community maintain a variety of providers. For the full list, see:  
👉 [https://github.com/yjs/yjs#providers](https://github.com/yjs/yjs#providers)

Popular options include:

- **[y-websocket](https://github.com/yjs/y-websocket)** — WebSocket-based, officially maintained, suitable for most use cases, requires a self-hosted server
- **[y-webrtc](https://github.com/yjs/y-webrtc)** — P2P via WebRTC, no dedicated server needed (only a signaling server), ideal for small-scale collaboration
- **[y-indexeddb](https://github.com/yjs/y-indexeddb)** — Local persistence, stores the document in the browser's IndexedDB
- **[Hocuspocus](https://tiptap.dev/docs/hocuspocus/introduction)** — Full-featured collaboration backend with authentication, persistence, and a plugin system

## y-websocket Example

Below is the minimal example for integrating `y-websocket` with `y-mxgraph`.

### Installation

```bash
pnpm add y-mxgraph yjs y-protocols y-websocket
```

### Client Code

```ts
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Binding, LOCAL_ORIGIN } from 'y-mxgraph';

const doc = new Y.Doc();

// Connect to the y-websocket server
// First argument: WebSocket server URL, second: room name
const provider = new WebsocketProvider('ws://localhost:1234', 'my-room', doc);

App.main((app) => {
  const file = app.currentFile;

  const undoManager = new Y.UndoManager(doc, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
  });

  const binding = new Binding(file, {
    doc,
    awareness: provider.awareness,
    undoManager,
  });
});
```

### Starting the Server

`y-websocket` ships a ready-to-use Node.js server:

```bash
# Start instantly with npx, listens on port 1234 by default
HOST=localhost PORT=1234 npx y-websocket
```

You can also embed it in your own Node.js project — see the [y-websocket docs](https://github.com/yjs/y-websocket) for details.

### Cleanup

Remember to destroy both the binding and the provider when unmounting:

```ts
binding.destroy(true);
provider.destroy();
```
