# Getting Started

## Installation

```bash
pnpm add y-mxgraph yjs y-protocols
```

`yjs` and `y-protocols` are peer dependencies and must be installed separately.

## Basic Usage

```ts
import * as Y from 'yjs';
import { Binding } from 'y-mxgraph';

const doc = new Y.Doc();

// Inside the draw.io App.main callback
App.main((app) => {
  const file = app.currentFile;

  const binding = new Binding(file, { doc });
});
```

## Multi-user Collaboration

`y-mxgraph` does not handle network transport itself — real-time collaboration requires pairing it with a **Yjs Provider**.  
Yjs offers a variety of providers (WebSocket, WebRTC, IndexedDB, etc.) that you can choose based on your needs.

➡️ See [Using Yjs Providers](./providers) for an overview of common providers and a complete y-websocket example.

## Destroying the Binding

Call `destroy()` when unmounting the component or switching files:

```ts
// React example
useEffect(() => {
  const binding = new Binding(file, { doc, awareness });
  return () => binding.destroy(true); // fully clean up on unmount
}, [file, doc]);

// Vue example
const binding = new Binding(file, { doc, awareness });
onUnmounted(() => {
  binding.destroy(true);
});
```

## Important Notes

### ⚠️ diagram `id` in the initial XML must be stable

When `Binding` is initialized, draw.io first renders the pages from `file.data` (the provided XML). If the Y.Doc **already contains data from another client** (`docHasData = true`) and the local XML contains a diagram `id` that differs from what is in the doc, the following problems occur:

- draw.io shows two pages: one from the local XML (orphaned, not synced) and one from the Y.Doc (synced normally)
- The orphaned page is never written to the Y.Doc and is invisible to other collaborators

**y-mxgraph does not automatically remove orphaned pages** — this is a known limitation. Always use a fixed, stable diagram `id` in the initial XML.

`Binding.generateFileTemplate(diagramId)` provides a standardized minimal template. Use the same `diagramId` on every client to avoid this issue.

#### ❌ Incorrect

```ts
// id changes on every render — late joiners may see a temporary orphaned page
const xml = `<mxfile>
  <diagram name="Page-1" id="${Math.random()}">
    ...
  </diagram>
</mxfile>`;
```

#### ✅ Correct

```ts
import { Binding } from 'y-mxgraph';

// Use generateFileTemplate to create a consistent starting XML
const xml = Binding.generateFileTemplate("room-123-main");
```

### How to set the default file in draw.io

Before collaboration starts, ensure **all clients have the same XML in `currentFile.data`**. Depending on draw.io's API and initialization timing, there are two common approaches:

#### Approach 1: via `#R` hash parameter (recommended, simplest)

draw.io supports loading raw XML via the `#R` prefix in the URL hash. Set it before draw.io initializes:

```ts
const xml = Binding.generateFileTemplate("my-diagram");
window.location.hash = "#R" + encodeURIComponent(xml);
```

draw.io will parse the hash on startup, create `currentFile`, and populate `file.data`. When `App.main` fires, `app.currentFile` already carries the unified data.

**Note**: If the URL already carries other hash parameters (e.g. OAuth callbacks), clear them first to avoid conflicts.

#### Approach 2: manually replace `file.data` inside the `App.main` callback

If draw.io is already initialized by other means (e.g. user manually opened a default file), override `file.data` in the `App.main` callback:

```ts
const xml = Binding.generateFileTemplate("my-diagram");

App.main(
  (ui) => {
    const file = ui.currentFile;

    if (file && file.data !== xml) {
      // Replace file.data with the unified starting XML
      file.data = xml;
      // Notify draw.io to re-parse the pages (exact API depends on your draw.io version)
      // e.g. file.ui.setCurrentFile(file) or file.ui.editor.setModified(true)
      file.ui.setCurrentFile(file);
    }

    const binding = new Binding(file, { doc });
  },
  // UI factory function if needed
);
```

**Key points**:

- `file.data` must be replaced **before** `new Binding(file, { doc })`
- After replacement, notify draw.io to re-parse the pages (exact method depends on your draw.io version API)
- If `currentFile` does not exist yet, wait for the `editor`'s `fileLoaded` event

Both approaches share the same goal: **ensure that when each client calls `new Binding(file, { doc })` for the first time, `file.data` contains the exact same diagram `id`**.

---

## Local Development

```bash
# Clone the repo
git clone https://github.com/mizuka-wu/y-mxgraph.git
cd y-mxgraph

# Install dependencies
pnpm install

# Start the demo
pnpm --filter @y-mxgraph/demo dev

# Start the docs
pnpm --filter @y-mxgraph/docs dev
```
