# y-mxgraph

[English](README.en.md) | [中文](README.md)

A toolkit that binds and converts between draw.io (mxGraph) documents and Yjs collaborative structures, plus a runnable demo (entry: `src/main.ts`).

- Library entry: `src/yjs/index.ts`
- Demo entry: `src/main.ts`
- Demo page: `index.html`

This library provides:

- Convert native draw.io `mxfile`/`mxGraphModel` XML to `Y.Doc` (`xml2doc`)
- Convert `Y.Doc` back to draw.io XML (`doc2xml`)
- Bind draw.io editor file object to `Y.Doc` (`bindDrawioFile`), optionally with `awareness` for collaborative cursors/selections

> GitHub Actions included in this repo:
>
> - Pages deployment for Demo (`.github/workflows/pages.yml`)
> - Library build (`.github/workflows/lib-build.yml`)

## Features

- Map draw.io document to Yjs for incremental sync and conflict-free merging
- Supports both `mxfile` (multi-page) and `mxGraphModel` (single model) XML forms
- Simple API: `xml2doc`, `doc2xml`, `bindDrawioFile`
- Optional collaboration via `y-protocols/awareness` and `y-webrtc`

## Structure (key parts)

```text
.
├─ index.html                 # Demo page, loads draw.io and injects main.ts
├─ src/
│  ├─ main.ts                # Demo entry (recommended reading)
│  ├─ bootstrap.js           # Startup glue with draw.io
│  └─ yjs/
│     ├─ index.ts            # Public entry: export bindDrawioFile, xml2doc, doc2xml
│     ├─ binding/            # Binding layer (patch/collaborator)
│     ├─ models/             # Yjs data models
│     ├─ helper/             # XML/util helpers
│     └─ transformer/        # xml2doc / doc2xml implementation
├─ vite.lib.config.ts        # Library build config (ES/CJS/UMD)
└─ .github/workflows/
   ├─ pages.yml              # Build and deploy Demo to GitHub Pages
   └─ lib-build.yml          # Build library and upload artifact
```

## Getting Started (local)

- Node.js 20+
- pnpm 10+

```bash
pnpm install
# Dev server (optional, quick preview)
pnpm dev

# Build demo (for static hosting)
pnpm vite build --base "/<your-repo>/"

# Build library (outputs to dist/)
pnpm vite build --config vite.lib.config.ts
```

Dev server default URL: `http://localhost:5173/y-mxgraph/`.

> GitHub Pages path is usually `https://<user>.github.io/<repo>/`, hence `--base "/<repo>/"` for demo.
> If your repo is `<user>.github.io` or you use a custom domain, set base to `/`.

## Online Demo (GitHub Pages)

Pages workflow is included. Pushing to the default branch (`master`) will build and deploy automatically. For the first time, confirm Pages Source is GitHub Actions in repo Settings -> Pages.

- `index.html` uses relative paths (`./drawio/...`, `./src/...`) to work under `/<repo>/`.
- `.github/workflows/pages.yml` checks out submodules recursively to include `public/drawio/`.

## Demo (`src/main.ts`)

The demo shows how to:

- Load a minimal demo `mxfile` XML
- Bind draw.io internal `file` object to a Yjs `doc` via `bindDrawioFile`
- Create a collaboration room via `y-webrtc` (no signaling servers configured; good for local/single-user testing)
- Serialize graph model to XML, compare with `Y.Doc` XML and visualize diff in console

Example snippet:

```ts
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { bindDrawioFile, doc2xml } from './yjs';

const doc = new Y.Doc();
const roomName = 'demo';
const provider = new WebrtcProvider(roomName, doc, { signaling: [] });

// After draw.io App is ready
bindDrawioFile(file, {
  doc,
  awareness: provider.awareness, // optional: show remote cursors/selections
});

// Convert Y.Doc back to XML for persistence/export
const xml = doc2xml(doc, /* spaces */ 2);
```

> Note: `signaling: []` means no signaling servers configured, suitable for local/small tests. For reliable multi-party collaboration, provide accessible signaling servers.

## Binding Examples with Different yProviders

> The following snippets show how to create different providers and pass their `awareness` to `bindDrawioFile`. Install optional deps and configure servers as needed for your project.

### General binding pattern

```ts
import * as Y from 'yjs';
import { bindDrawioFile } from './yjs';

const doc = new Y.Doc();
// 1) Create a provider (see examples below)
// 2) Pass provider.awareness into the binding
bindDrawioFile(file, { doc, awareness: provider.awareness });
```

### y-webrtc (decentralized/P2P)

Already shown in `src/main.ts`:

```ts
import { WebrtcProvider } from 'y-webrtc';

const doc = new Y.Doc();
const provider = new WebrtcProvider('roomName', doc, {
  signaling: [
    // Provide at least 1-2 accessible signaling servers
    // 'wss://signaling.yjs.dev',
  ],
});

bindDrawioFile(file, { doc, awareness: provider.awareness });
```

### y-websocket (centralized server)

Install (optional):

```bash
pnpm add y-websocket
```

Example:

```ts
import { WebsocketProvider } from 'y-websocket';

const doc = new Y.Doc();
// Your y-websocket server URL (e.g., wss://your-server:1234)
const provider = new WebsocketProvider('wss://your-server', 'roomName', doc, {
  // params: { token: '...' }, // Optional: auth, etc.
  // connect: true,            // Optional: delay connect
});

// Bind after initial sync to avoid overwriting remote state with local initial state
provider.on('sync', (isSynced: boolean) => {
  if (isSynced) {
    bindDrawioFile(file, { doc, awareness: provider.awareness });
  }
});

// Optional: connection status
provider.on('status', (e: { status: 'connected' | 'disconnected' }) => {
  console.log('ws status:', e.status);
});
```

### IndexedDB offline persistence (can be combined with any provider)

Install (optional):

```bash
pnpm add y-indexeddb
```

Standalone (single-machine) example:

```ts
import { IndexeddbPersistence } from 'y-indexeddb';

const doc = new Y.Doc();
const idb = new IndexeddbPersistence('y-mxgraph-demo', doc);

idb.once('synced', () => {
  // Local data loaded, safe to bind
  bindDrawioFile(file, { doc }); // Works without provider (single-machine mode)
});
```

### Combo: IndexedDB + y-websocket

Prefer waiting for local IndexedDB to load before connecting/binding to reduce first-time overwrite risk:

```ts
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';

const doc = new Y.Doc();
const idb = new IndexeddbPersistence('roomName', doc);
const ws = new WebsocketProvider('wss://your-server', 'roomName', doc);

idb.once('synced', () => {
  bindDrawioFile(file, { doc, awareness: ws.awareness });
});
```

### No provider (pure local)

```ts
const doc = new Y.Doc();
bindDrawioFile(file, { doc });
```

> Tip:

> - These deps are not included by default in this repo; install as needed.
> - `bindDrawioFile` only cares about the same `Y.Doc` instance and optional `awareness`, not the specific provider type.
> - For centralized providers (like `y-websocket`), bind after the first `sync` to avoid overwriting remote state.

## API

Exported from `src/yjs/index.ts`:

### `bindDrawioFile(file, options)`
- Purpose: bidirectionally bind draw.io `file` and `Y.Doc`.
- Params:
  - `file: any` draw.io editor file object (from `App.main((app) => app.currentFile)`)
  - `options?: {
      mouseMoveThrottle?: number;           // cursor move throttle (default 100ms)
      doc?: Y.Doc | null;                   // existing Doc; created internally if omitted
      awareness?: Awareness;                // collaboration state (cursor/selection)
      cursor?: boolean | {
        userNameKey?: string;               // username key in awareness (default 'user.name')
        userColorKey?: string;              // color key in awareness (default 'user.color')
      };
      debug?: boolean;                      // reserved for debugging
    }`
- Returns: `Y.Doc` (same instance if passed in)
- Behavior:
  - Listen to local `mxGraphModel` changes -> generate patch -> apply to `Y.Doc`
  - Listen to remote `Y.Doc` changes -> generate patch -> apply back to draw.io `file`
  - If `awareness` is provided, bind collaborative cursor/selection

### `xml2doc(xml: string, doc?: Y.Doc)`
- Purpose: parse draw.io XML into `Y.Doc`
- Supports: `<mxfile>` (multi-page) and `<mxGraphModel>` (single model)
- Returns: `Y.Doc` (reuse if provided; otherwise created)

### `doc2xml(doc: Y.Doc, spaces = 0): string`
- Purpose: serialize `Y.Doc` back to draw.io XML
- Matches the two supported forms from `xml2doc`
- Params:
  - `spaces`: indentation for readability
- Returns: XML string

## Patch and Ordering Rules (Important)

To stay consistent with draw.io semantics, the binding layer follows explicit ordering and anchoring rules when generating/applying patches (see `src/yjs/binding/patch.ts` for `applyFilePatch()` and `insertAfterUnique()`):

- __Diagram level (pages)__:
  - Processing order: delete -> insert -> reorder (based on `previous`).
  - Before reordering, `ensureUniqueOrder()` is applied to deduplicate IDs to avoid index issues.

- __Cells level (mxCell)__:
  - Processing order: delete -> insert -> attribute update -> reorder (based on `previous`).
  - __Anchor rules__ (for both insert and move):
    - Prefer `previous`. When `previous === ""`, it means the cell is the "first sibling" under its parent.
    - If `previous === ""` and `parent` exists, the cell is inserted right after its parent (so the first child follows the parent).
      - Example: parent `-3`, child1 `-1` (previous empty), child2 `-2` (previous `-1`) => final order: `-3 -> -1 -> -2`.
    - If `previous` is not provided but `parent` is, the cell will follow the parent.
    - If the specified anchor does not exist (e.g., deleted concurrently), cells typically fall back to the end; when no anchor is available at all, insertion may go to the head to keep order stable.
  - `insertAfterUnique()` is used universally to ensure unique insertion and correct index handling during moves.

> Note: The above focuses on structure/order. Attribute updates are applied before order changes (to avoid losses), with event-based collection plus snapshot-based diff as a fallback.

## Use in Your Project

This repo hasn’t published to npm yet. You can:

- Import from source (development)
  - `import { bindDrawioFile, xml2doc, doc2xml } from "./src/yjs";`
- Use built artifacts (after build)
  - Run `pnpm vite build --config vite.lib.config.ts`
  - Find `y-mxgraph.es.js` / `y-mxgraph.cjs.js` / `y-mxgraph.umd.js` in `dist/`

> `vite.lib.config.ts` externalizes `lodash-es`, `yjs`, `y-protocols`, `xml-js`, `colord`, `diff`. Ensure globals when using UMD, or bundle them appropriately.

## CI/CD & Release

- Pages (Demo deploy): `.github/workflows/pages.yml`
  - Triggers: push to `master`, manual dispatch
  - Steps: install -> Vite build -> upload & deploy to GitHub Pages
  - Note: `submodules: recursive` is enabled to include `public/drawio/`
- Library build: `.github/workflows/lib-build.yml`
  - Triggers: push tag (`v*`), manual dispatch
  - Steps: install -> `vite.lib.config.ts` build -> upload artifact (`y-mxgraph-lib`)

## FAQ

- Q: 404 on GitHub Pages?
  - A: Build demo with `--base "/<repo>/"` and use relative static paths in `index.html` (already configured).

- Q: Collaboration doesn’t connect?
  - A: The demo uses `signaling: []`, which is suitable for local tests only. Provide signaling servers for stable multi-user sessions.

- Q: Can I only do conversion without binding the editor?
  - A: Yes. Use `xml2doc`/`doc2xml` standalone on server/tooling.

## License

TBD. Add a `LICENSE` file in the repo root and update this section accordingly.
