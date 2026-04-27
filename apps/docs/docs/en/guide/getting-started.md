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

## With y-webrtc for Multi-user Collaboration

```ts
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { Binding, LOCAL_ORIGIN } from 'y-mxgraph';

const doc = new Y.Doc();
const provider = new WebrtcProvider('my-room', doc, {
  signaling: ['wss://signaling.yjs.dev'],
});

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
// Fixed id tied to the room/project — consistent across all clients
const xml = `<mxfile>
  <diagram name="Page-1" id="page-main">
    ...
  </diagram>
</mxfile>`;
```

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
