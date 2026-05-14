# iframe Bridge

`y-mxgraph/iframe-bridge` enables collaborative editing in iframe-isolated environments. It is ideal for scenarios where the draw.io instance needs to be sandboxed from other page logic.

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│  Server (parent page)                                       │
│                                                             │
│  Single network connection point, owns Y.Doc + Awareness    │
│                                                             │
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
│             │     │             │
│ local Y.Doc │     │ local Y.Doc │
│ + Awareness │     │ + Awareness │
│ + draw.io   │     │ + draw.io   │
└─────────────┘     └─────────────┘
```

### Core Design

- **Server**: Runs on the parent page, holds the single `Y.Doc` and `Awareness` instance, connects to the network via y-webrtc / y-websocket / etc.
- **Provider**: Runs inside iframes, holds local `Y.Doc` and `Awareness`, syncs with Server via `postMessage`
- **Single connection**: Only the Server maintains a network connection; iframes can be sandboxed with no network access
- **ID mapping**: Provider automatically maps the Server's `clientID` to its local `clientID`, ensuring collaborative cursors correctly identify "self"

## Installation

```bash
pnpm add y-mxgraph yjs y-protocols
```

## Basic Usage

### Server (parent page)

```ts
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { createIframeBridgeServer } from 'y-mxgraph/iframe-bridge/server';

const doc = new Y.Doc();
const provider = new WebrtcProvider('my-room', doc, {
  signaling: ['wss://y-webrtc-eu.fly.dev'],
});

// Create bridge server
const bridge = createIframeBridgeServer(doc, provider.awareness);

// Register iframe
const iframe = document.getElementById('editor-iframe') as HTMLIFrameElement;
bridge.addIframe(iframe, 'editor-1');

// Cleanup
// bridge.destroy();
```

### Provider (iframe child)

```ts
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createIframeBridgeProvider } from 'y-mxgraph/iframe-bridge/provider';

const doc = new Y.Doc();
const awareness = new Awareness(doc);

// Create bridge provider, automatically requests initial sync
const bridge = createIframeBridgeProvider(doc, awareness);

// Access the server's clientID
console.log(bridge.serverClientId);

// Cleanup
// bridge.destroy();
```

## Message Protocol

Server and Provider communicate via `postMessage` with the following message types:

| Direction | Type | Payload | Description |
|-----------|------|---------|-------------|
| Provider → Server | `init` | none | Request full sync |
| Server → Provider | `ydoc-sync` | `Uint8Array` | Full Y.Doc state |
| Server → Provider | `awareness-sync` | `Uint8Array` + `serverClientId` | Full awareness state |
| Bidirectional | `ydoc-update` | `Uint8Array` | Incremental Y.Doc update |
| Bidirectional | `awareness-update` | `Uint8Array` | Incremental awareness update |
| Provider → Server | `ping` | none | Get serverClientId |
| Server → Provider | `pong` | `serverClientId` | Response to ping |

## Awareness clientID Mapping

### The Problem

`awareness.clientID` comes directly from `doc.clientID`. When Server and Provider have independent `Y.Doc` instances, their `clientIDs` differ. Without mapping, the Server's cursor state would be rendered as a "remote cursor" in the Provider, causing duplicate cursor display.

### The Solution

Provider receives the Server's `clientID` during initialization and performs bidirectional mapping during sync:

```text
Server awareness: { serverClientId: cursorA, peerB: cursorB }
                            │
                            ▼  map serverClientId → localClientId
Provider awareness: { localClientId: cursorA, peerB: cursorB }
                            │
                            ▼  collaborator skips localClientId
Result: only peerB's cursor is rendered (correct)
```

- **Receiving**: `serverClientId → localClientId` — Server's self-state is identified as "local" in Provider
- **Sending**: `localClientId → serverClientId` — Provider's state is identified as the same client in Server

## Integration with draw.io

### Server Side

```ts
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { createIframeBridgeServer } from 'y-mxgraph/iframe-bridge/server';

const doc = new Y.Doc();
const provider = new WebrtcProvider(roomName, doc, { signaling });
const bridge = createIframeBridgeServer(doc, provider.awareness);

bridge.addIframe(document.getElementById('iframe-1')!, 'editor-1');
bridge.addIframe(document.getElementById('iframe-2')!, 'editor-2');
```

### Provider Side (inside iframe)

```ts
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { Binding } from 'y-mxgraph';
import { createIframeBridgeProvider } from 'y-mxgraph/iframe-bridge/provider';

const doc = new Y.Doc();
const awareness = new Awareness(doc);
const bridge = createIframeBridgeProvider(doc, awareness);

// After loading draw.io, create Binding
App.main((app) => {
  const file = app.currentFile;
  const binding = new Binding(file, { doc, awareness });
});
```

## Ping/Pong Mechanism

Provider can get the Server's `clientID` via `ping` message:

```ts
// Provider sends ping
window.parent.postMessage({ type: 'ping' }, '*');

// Listen for pong response
window.addEventListener('message', (event) => {
  if (event.data.type === 'pong') {
    console.log('Server clientID:', event.data.serverClientId);
  }
});
```

`createIframeBridgeProvider` automatically sends an `init` request during initialization, and the `awareness-sync` response already includes `serverClientId`. The `ping/pong` mechanism can be used for subsequent dynamic retrieval.

## API Reference

### `createIframeBridgeServer(doc, awareness)`

Creates the Server-side bridge.

**Parameters**:

- `doc: Y.Doc` — Server's Y.Doc instance
- `awareness: Awareness` — Server's Awareness instance

**Returns**: `IframeBridgeServer`

**Methods**:

- `addIframe(iframe: HTMLIFrameElement, iframeId: string)` — Register an iframe
- `removeIframe(iframeId: string)` — Remove an iframe
- `destroy()` — Clean up all listeners

### `createIframeBridgeProvider(doc, awareness)`

Creates the Provider-side bridge.

**Parameters**:

- `doc: Y.Doc` — Local Y.Doc instance
- `awareness: Awareness` — Local Awareness instance

**Returns**: `IframeBridgeProvider`

**Properties**:

- `serverClientId: number | null` — Server's clientID, available after initial sync

**Methods**:

- `destroy()` — Clean up all listeners

## SharedWorker Mode

In addition to iframe Bridge, the project also provides a SharedWorker mode for cross-tab synchronization. Comparison of the two modes:

| Feature | iframe Bridge | SharedWorker |
|---------|---------------|--------------|
| Isolation level | iframe sandbox | Browser tabs |
| Network connection | Server page | SharedWorker |
| Use case | draw.io isolated deployment | Cross-tab collaboration |
| Communication | postMessage | MessagePort |

SharedWorker implementation is in `apps/demo/src/shared-worker.ts`.
