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

## Full Example: WebSocket Server with File Persistence

We provide a complete WebSocket server example (`@y-mxgraph/ws-demo`) that includes:

- Custom Node.js server with file system persistence
- Automatic client synchronization with server data
- Real-time multi-client collaboration

### Quick Start

```bash
# 1. Start the WebSocket server (default port 1234)
pnpm --filter @y-mxgraph/ws-demo server

# 2. In another terminal, start the client (default port 5174)
pnpm --filter @y-mxgraph/ws-demo dev

# 3. Open http://localhost:5174 in your browser
```

### How It Works

```text
┌──────────┐     WebSocket     ┌───────────────────┐
│ Client A ├───────────────────┤                   │
└──────────┘                   │  y-websocket      │
                               │  server (:1234)   │──── yjs-docs/
┌──────────┐     WebSocket     │                   │     (file persistence)
│ Client B ├───────────────────┤                   │
└──────────┘                   └───────────────────┘
```

### Comparison with WebRTC

| Feature | WebRTC (demo) | WebSocket (ws-demo) |
| --- | --- | --- |
| Connection | P2P | Centralized server |
| Data persistence | None | File system |
| Server required | Signaling only | WebSocket server |
| Use case | Public demo | Enterprise deployment |

### Key Implementation

The server uses `setupWSConnection` and `setPersistence` from `y-websocket/bin/utils`:

```ts
import { setupWSConnection, setPersistence } from 'y-websocket/bin/utils';

setPersistence({
  bindState: async (docName, ydoc) => {
    // Load document state from file
    const data = await fs.readFile(`yjs-docs/${docName}.yjs`);
    Y.applyUpdate(ydoc, new Uint8Array(data));
  },
  writeState: async (docName, ydoc) => {
    // Save document state to file
    const state = Y.encodeStateAsUpdate(ydoc);
    await fs.writeFile(`yjs-docs/${docName}.yjs`, state);
  },
});
```

The client uses `doc2xml` to load server data into draw.io after `provider.synced`:

```ts
provider.on('sync', (isSynced) => {
  if (isSynced) {
    // Binding handles file.ui.setFileData(xml) + file.setData(xml) internally
    // according to the initialContent strategy (default 'replace').
    const binding = new Binding(file, { doc, awareness, undoManager });
  }
});
```

For the full implementation, see the `apps/simple-y-websocket-server-demo` directory.

## iframe Bridge (Built-in)

Because draw.io is frequently embedded in `<iframe>` elements — for example inside CMS editors, whiteboard apps, or low-code platforms — `y-mxgraph` ships a **dedicated iframe bridge** so you don't have to invent your own `postMessage` protocol.

### Why a dedicated bridge?

When draw.io runs inside an iframe, the parent page and the iframe are in **different browsing contexts**. A standard Yjs Provider (e.g., `y-webrtc`) cannot cross that boundary directly. The typical work-around is:

1. Create a `Y.Doc` in the parent.
2. Manually broadcast every `update` and `awareness` change to all iframes via `postMessage`.
3. Inside each iframe, apply those updates to a local `Y.Doc` and forward local changes back.

This is tedious and error-prone (echo loops, message scoping, heartbeat / disconnect detection, etc.). The `y-mxgraph/iframe-bridge` module handles all of that for you.

### Architecture

```text
┌──────────────────────┐                    ┌──────────────────────┐
│   Parent Page        │   postMessage      │   iframe A           │
│  ┌──────────────┐    │ ◄────────────────► │  ┌──────────────┐    │
│  │ Y.Doc +     │    │   Y.Doc updates    │  │ YMxGraph      │    │
│  │ WebrtcProv  │◄───┤   Awareness sync   │  │ BridgeClient  │    │
│  │ (room: r1)  │    │                    │  └──────────────┘    │
│  └──────────────┘    │                    │       ↓              │
│         ↑            │                    │   ┌──────────┐       │
│  ┌──────────────┐    │                    │   │ draw.io  │       │
│  │ YMxGraph     │    │                    │   │ Binding  │       │
│  │ BridgeProv   │────┘                    │   └──────────┘       │
│  │ (iframe A)   │                         └──────────────────────┘
│  └──────────────┘
│  ┌──────────────┐
│  │ YMxGraph     │    ┌──────────────────────┐
│  │ BridgeProv   │───►│   iframe B           │
│  │ (iframe B)   │    │  ┌──────────────┐    │
│  └──────────────┘    │  │ YMxGraph      │    │
│                      │  │ BridgeClient  │    │
│  (two independent    │  └──────────────┘    │
│   Y.Doc + Provider   │         ↓              │
│   pairs, same room)  │     ┌──────────┐     │
│                      │     │ draw.io  │     │
└──────────────────────┘     │ Binding  │     │
                            └──────────┘     │
                            └──────────────────────┘
```

- Each iframe gets **its own** `Y.Doc` + `WebrtcProvider` (or any other provider).
- The parent page creates one `YMxGraphBridgeProvider` per iframe.
- The iframe creates one `YMxGraphBridgeClient`.
- Bridge messages are scoped (`scope: "y-mxgraph"`) so they won't collide with your own `postMessage` traffic.
- Built-in **heartbeat** (PING / PONG) and **disconnect detection** keep the UI status accurate.

### Installation & Setup

The bridge is included in `y-mxgraph`; no extra package is required.

```bash
pnpm add y-mxgraph yjs y-protocols
```

### Host (Parent Page)

```ts
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { YMxGraphBridgeProvider } from 'y-mxgraph/iframe-bridge/provider';

const doc = new Y.Doc();
const provider = new WebrtcProvider('my-room', doc);

const bridge = new YMxGraphBridgeProvider(iframeElement, doc, {
  awareness: provider.awareness,
  // optional: tighten security
  // targetOrigin: 'https://my-drawio-domain.com',
  // expectedOrigin: 'https://my-drawio-domain.com',
});

// bridge.destroy() when the iframe is removed
```

### Guest (Inside iframe)

```ts
import { YMxGraphBridgeClient } from 'y-mxgraph/iframe-bridge/client';
import { Binding } from 'y-mxgraph';

const bridge = new YMxGraphBridgeClient();

// Wait for the first sync so draw.io doesn't start from an empty doc
if (bridge.isSynced()) {
  bindDrawio();
} else {
  bridge.once('synced', bindDrawio);
}

function bindDrawio() {
  App.main((app) => {
    const file = app.currentFile;
    const binding = new Binding(file, {
      doc: bridge.doc,
      awareness: bridge.awareness as any, // AwarenessStub is duck-typed
      // initialContent strategy (default 'replace'):
      //   'replace'      : Y.Doc wins; file UI is replaced with doc XML
      //   'merge-remote' : union by diagram id; doc wins on conflicts
      //   'merge-client' : union by diagram id; file wins on conflicts
      initialContent: 'replace',
    });
  });
}
```

### Exports

| Sub-path | Export | Description |
| --- | --- | --- |
| `y-mxgraph/iframe-bridge` | `AwarenessStub`, `isBridgeMsg`, `makeMsg`, types | Shared types & utilities |
| `y-mxgraph/iframe-bridge/provider` | `YMxGraphBridgeProvider` | Host-side bridge |
| `y-mxgraph/iframe-bridge/client` | `YMxGraphBridgeClient` | Guest-side bridge |
