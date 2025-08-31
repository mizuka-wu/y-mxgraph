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

```
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
