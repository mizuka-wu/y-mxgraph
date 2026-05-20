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

### Core Design

- **Server**: Runs on the parent page, holds the single `Y.Doc` and `Awareness` instance, connects to the network via y-webrtc / y-websocket / etc. Each iframe gets its own Server instance bound directly to the target iframe
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

// Create bridge server, bound directly to the target iframe
const iframe = document.getElementById('editor-iframe') as HTMLIFrameElement;
const bridge = createIframeBridgeServer(iframe, doc, provider.awareness);

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
| Provider → Server | `awareness-local-state` | `object` (raw state) | Local awareness state, Server applies via `setLocalState` |
| Bidirectional | `awareness-update` | `Uint8Array` | Incremental awareness update |
| Provider → Server | `ping` | none | Get serverClientId |
| Server → Provider | `pong` | `serverClientId` | Response to ping |
| Provider → Server | `undo` | none | Request undo |
| Provider → Server | `redo` | none | Request redo |
| Server → Provider | `undo-state` | `canUndo`, `canRedo`, `undoStackSize`, `redoStackSize` | Sync undo stack state |

### Baseline Data

When the Provider initializes for the first time (e.g. data produced by `xml2ydoc`), it sends `ydoc-update` with `isBaseline: true`. The Server applies these updates with `BASELINE_ORIGIN`, ensuring they **do not enter the UndoManager's stack**.

Regular edits use `IFRAME_ORIGIN` and are correctly tracked by the UndoManager.

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

## Undo/Redo

iframe Bridge supports cross-iframe undo/redo. The core idea: **undo/redo actually executes on the Server's shared `Y.UndoManager`; iframes only send commands and receive state syncs**.

### Architecture

```text
User presses Ctrl+Z in Iframe
  → draw.io calls editor.undoManager.undo()
  → MxLike shim sends { type: "undo" } via postMessage to parent
  → Server receives message → calls shared UndoManager.undo()
  → Y.UndoManager pops stack → fires "stack-item-popped" event
  → Server sends "undo-state" to iframe (includes canUndo/canRedo/stack sizes)
  → iframe's MxLike rebuilds history/indexOfNextAdd based on state
  → fires synthetic events to notify draw.io to update UI (toolbar, cursor, etc.)
```

### Server-side Setup

Create a `Y.UndoManager` on the parent page and pass it to `createIframeBridgeServer`:

```ts
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { LOCAL_ORIGIN } from 'y-mxgraph';
import { IFRAME_ORIGIN } from 'y-mxgraph/iframe-bridge';
import { createIframeBridgeServer } from 'y-mxgraph/iframe-bridge/server';

const doc = new Y.Doc();
const provider = new WebrtcProvider(roomName, doc, { signaling });
const awareness = provider.awareness;

// Create UndoManager, tracking local and iframe-originated transactions
const undoManager = new Y.UndoManager(doc, {
  trackedOrigins: new Set([LOCAL_ORIGIN, IFRAME_ORIGIN]),
});

// Pass to bridge server, binding directly to the iframe.
// If the UndoManager implementation supports addTrackedOrigin/removeTrackedOrigin,
// the bridge will automatically manage IFRAME_ORIGIN on create/destroy.
// If not, keep IFRAME_ORIGIN in trackedOrigins manually.
const bridge = createIframeBridgeServer(iframeElement, doc, awareness, { undoManager });

// Can call undo/redo directly on the parent page
document.getElementById('undo-btn')!.onclick = () => {
  if (undoManager.canUndo()) undoManager.undo();
};
document.getElementById('redo-btn')!.onclick = () => {
  if (undoManager.canRedo()) undoManager.redo();
};
```

> **`trackedOrigins` note**: `Y.UndoManager` defaults to tracking only `LOCAL_ORIGIN` transactions. In the iframe scenario, updates from iframes are applied to the Server's Y.Doc with `IFRAME_ORIGIN` as the origin.
> If the UndoManager implementation supports `addTrackedOrigin`/`removeTrackedOrigin`, `createIframeBridgeServer` automatically manages `IFRAME_ORIGIN` on start/stop.
> Otherwise, add `IFRAME_ORIGIN` to `trackedOrigins` manually so iframe edits enter the undo stack.

### Provider-side UndoManager Takeover

Inside the iframe, call `bridge.takeoverUndoManager(file)` to replace draw.io's native `editor.undoManager` with a compatibility shim. This makes draw.io's undo/redo operations delegate to the Server via postMessage:

```ts
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { Binding } from 'y-mxgraph';
import { createIframeBridgeProvider } from 'y-mxgraph/iframe-bridge/provider';

const doc = new Y.Doc();
const awareness = new Awareness(doc);
const bridge = createIframeBridgeProvider(doc, awareness);

App.main((app) => {
  const file = app.currentFile;
  const binding = new Binding(file, { doc, awareness });

  // Takeover draw.io's UndoManager
  const restoreUndoManager = bridge.takeoverUndoManager(file);

  // To restore native UndoManager (usually handled automatically by destroy)
  // restoreUndoManager();
});
```

`takeoverUndoManager` returns a cleanup function that restores draw.io's native `editor.undoManager`. This cleanup is automatically called by `bridge.destroy()`.

### How It Works

`takeoverUndoManager` does the following:

1. **Preserves original state**: Backs up draw.io's `editor.undoManager` and its event listeners
2. **Replaces with MxLike shim**: A compatibility layer implementing the `mxUndoManager` interface, including:
   - `history[]` + `indexOfNextAdd`: Local undo stack cursor (for UI state only, not storing actual data)
   - `undo()` / `redo()`: Delegates to Server via postMessage
   - `canUndo()` / `canRedo()`: Based on local cursor position
   - `fireEvent()`: Fires events draw.io listens to (`"add"`, `"clear"`, `"undo"`, `"redo"`)
3. **Listens for Server state sync**: Receives `"undo-state"` messages and rebuilds local history / indexOfNextAdd based on the server's real undo stack state, then fires corresponding events
4. **Preserves original listeners**: Migrates draw.io's existing event listeners to the shim

## Integration with draw.io

### Server Side

Each iframe gets its own Server instance:

```ts
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { createIframeBridgeServer } from 'y-mxgraph/iframe-bridge/server';

const doc = new Y.Doc();
const provider = new WebrtcProvider(roomName, doc, { signaling });

// iframe-1
const bridge1 = createIframeBridgeServer(
  document.getElementById('iframe-1')!,
  doc,
  provider.awareness,
);

// iframe-2 (shares the same doc and awareness)
const bridge2 = createIframeBridgeServer(
  document.getElementById('iframe-2')!,
  doc,
  provider.awareness,
);
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

### `createIframeBridgeServer(iframe, doc, awareness, options?)`

Creates the Server-side bridge, bound directly to a single iframe.

**Parameters**:

- `iframe: HTMLIFrameElement` — Target iframe element
- `doc: Y.Doc` — Server's Y.Doc instance
- `awareness: Awareness` — Server's Awareness instance
- `options?` — Optional configuration
  - `undoManager?: Y.UndoManager` — Shared UndoManager instance, enables cross-iframe undo/redo

**Methods**:

- `destroy()` — Clean up all listeners (including UndoManager event listeners)

### `createIframeBridgeProvider(doc, awareness, options?)`

Creates the Provider-side bridge.

**Parameters**:

- `doc: Y.Doc` — Local Y.Doc instance
- `awareness: Awareness` — Local Awareness instance
- `options?` — Optional configuration
  - `awarenessSyncMode?: "binary" \| "local-state"` — Awareness sync mode. Default `"binary"` sends binary updates from iframe→server via `applyAwarenessUpdate`; `"local-state"` sends raw state objects applied via `setLocalState`, suitable for `awarenessLike` implementations relying on `setLocalState` side effects

**Returns**: `IframeBridgeProvider`

**Properties**:

- `serverClientId: number | null` — Server's clientID, available after initial sync

**Methods**:

- `takeoverUndoManager(file: DrawioFile) => () => void` — Takeover draw.io's `editor.undoManager`, returns cleanup function. See [Undo/Redo](#undoredo) section
- `destroy()` — Clean up all listeners (including takeover'd UndoManager)
