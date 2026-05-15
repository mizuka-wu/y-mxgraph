# y-mxgraph Project Introduction

## Give draw.io Real-Time Collaboration

`y-mxgraph` is a real-time collaborative binding library for **Yjs × draw.io (mxGraph)**. It deeply integrates the world's most popular open-source diagramming tool, draw.io, with the industry-leading CRDT collaboration framework Yjs — enabling multi-user real-time collaborative editing without modifying draw.io's core code.

---

## Why y-mxgraph?

draw.io does have a built-in collaboration system, but it **heavily relies on a proprietary WebSocket server**, making deployment and integration costly. Yjs, as a mature CRDT (Conflict-free Replicated Data Type) library, has already solved the core challenges of distributed collaboration:

- **No central server required** — Multi-user collaboration works over WebRTC P2P
- **Automatic conflict merging** — Edit offline and sync automatically when reconnected, no locks needed
- **Rich ecosystem** — WebSocket, IndexedDB, Hocuspocus and other providers are plug-and-play

`y-mxgraph` acts as the connector layer: it lets draw.io **reuse its native collaborative UI and diff algorithms**, but replaces the transport layer with Yjs — giving you draw.io's drawing power and Yjs's collaboration flexibility at the same time.

---

## Five Core Highlights

### 1. Bidirectional Incremental Sync

Not full replacement, but cell-level incremental synchronization. Local edits generate patches via draw.io's native `diffPages()`, stored into Y.Doc; remote changes are converted from Yjs events back into draw.io patches and injected via `file.patch()`. Conflicts are automatically merged by Yjs CRDTs with zero business logic required.

### 2. Collaborative Cursors & Selections

Based on the `y-protocols/awareness` protocol, out-of-the-box support for:

- **Real-time cursors** — Show remote user mouse positions with throttling, page isolation, and auto-hide on leave
- **Selection highlighting** — Display shapes selected by other users, incremental updates, low bandwidth
- **User info** — Configurable user name and color fields

### 3. iframe Isolated Deployment

Through the `@y-mxgraph/iframe-bridge` package, draw.io can run in a fully sandboxed iframe:

- **Network isolation** — The iframe needs no network permissions; all syncing is proxied by the parent page
- **Cross-origin safety** — Ideal for scenarios where draw.io must be strictly isolated from the main site
- **Undo/Redo穿透** — Undo/redo is executed uniformly through the Server-side shared UndoManager, keeping multi-iframe states perfectly consistent

### 4. Flexible Initial Content Strategies

When a new user joins, three data alignment strategies are supported:

| Strategy | Behavior |
|----------|----------|
| `replace` (default) | If Y.Doc is non-empty, overwrite local with remote data |
| `merge-remote` | Union by diagram id; conflicts resolved in favor of remote |
| `merge-client` | Union by diagram id; conflicts resolved in favor of local |

Combined with `Binding.generateFileTemplate()` for generating consistent starting XML, orphaned page issues caused by inconsistent diagram ids across clients are completely eliminated.

### 5. Extremely Low Integration Cost

```ts
import * as Y from 'yjs';
import { Binding } from 'y-mxgraph';

const doc = new Y.Doc();

App.main((app) => {
  const binding = new Binding(app.currentFile, { doc });
});
```

Just a few lines of code to establish the binding. Provider selection, Awareness configuration, and UndoManager integration are all optional enhancements — adopt progressively as needed.

---

## Typical Use Cases

- **Online whiteboard / flowchart tools** — Multiple users simultaneously editing architecture diagrams, flowcharts, UML
- **Embedded diagrams in documents** — Collaborative editable charts in wikis and knowledge bases
- **Low-code platforms** — Multi-user collaborative visual orchestration design
- **Education** — Teachers and students collaboratively drawing mind maps in real time

---

## Technical Architecture

```text
draw.io (mxGraph)
    │
    ├─ Local changes → file.ui.diffPages() → y-mxgraph patch → Y.Doc
    │
    └─ Remote changes ← Y.Doc → y-mxgraph patch → file.patch() ←
                           │
                    Yjs Provider (y-webrtc / y-websocket / ...)
                           │
                    ┌──────┴──────┐
                    ▼             ▼
                 Client A      Client B
```

y-mxgraph does not replace draw.io's drawing engine, nor does it replace Yjs's collaborative network layer. What it does is **precise protocol translation** — building a bridge between draw.io's native collaborative APIs and Yjs's data structures.

---

## Project Ecosystem

| Package | Description |
|---------|-------------|
| `y-mxgraph` | Core binding library, exports `Binding`, `xml2ydoc`, `ydoc2xml`, `LOCAL_ORIGIN` |
| `@y-mxgraph/iframe-bridge` | For iframe isolation scenarios, includes `createIframeBridgeServer` / `createIframeBridgeProvider` |
| `@y-mxgraph/demo` | WebRTC real-time collaboration demo (with Playwright E2E tests) |
| `@y-mxgraph/ws-demo` | WebSocket server demo (with file persistence) |
| `@y-mxgraph/docs` | VitePress documentation site |

---

## Get Started

```bash
pnpm add y-mxgraph yjs y-protocols
```

👉 [Getting Started](/en/guide/getting-started) — Get your first collaborative editing example running in 5 minutes  
👉 [iframe Bridge Guide](/en/guide/iframe-bridge) — Best practices for isolated deployment  
👉 [Architecture](/en/guide/architecture) — Deep dive into patches, snapshots, and conflict resolution

---

**License**: MIT
