# Integrating draw.io

`y-mxgraph` does not include the draw.io (mxGraph) editor itself — you need to load it into your page first. This chapter covers several integration approaches, from the simplest to the most complete, and explains what each draw.io configuration option means.

---

## Option 1: Load from CDN (Recommended, Simplest)

draw.io's core is a single `app.min.js` file (~3 MB) plus a few CSS and asset files. You can load everything directly from a CDN without any local deployment.

### Standard Load Order

The production boot sequence is:

1. **PreConfig.js** — pre-configuration script
2. **app.min.js** — the editor itself
3. **PostConfig.js** — post-configuration (loaded internally by `app.min.js` via `mxscript()`)

```html
<script>
  // 1. Set base paths (pointing to the CDN)
  window.mxBasePath = 'https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/mxgraph';
  window.mxImageBasePath = 'https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/mxgraph/images';
  window.RESOURCES_PATH = 'https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/resources';
  window.RESOURCE_BASE = 'https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/resources/dia';
  window.STENCIL_PATH = 'https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/stencils';
  window.SHAPES_PATH = 'https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/shapes';
  window.PLUGINS_BASE_PATH = 'https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/';

  // 2. Flag as non-Electron
  window.mxIsElectron = false;

  // 3. Load PreConfig.js
  const pre = document.createElement('script');
  pre.src = 'https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/js/PreConfig.js';
  document.head.appendChild(pre);

  pre.onload = () => {
    // 4. Load app.min.js
    const app = document.createElement('script');
    app.src = 'https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/js/app.min.js';
    document.head.appendChild(app);

    app.onload = () => {
      // 5. App is ready; you can now initialize y-mxgraph
      console.log('draw.io loaded');
    };
  };
</script>
```

### Why Inject CSS Manually

When you set `window.mxLoadStylesheets = false`, draw.io will not inject stylesheets automatically. You must load the two core CSS files yourself:

```html
<link rel="stylesheet"
      href="https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/mxgraph/css/common.css" />
<link rel="stylesheet"
      href="https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/styles/grapheditor.css" />
```

If you leave `mxLoadStylesheets` as `true` (default), draw.io tries to insert `<link>` tags via `document.write()`. This often fails in modern bundlers or under strict CSP.

### Pin a Version

The `latest` tag follows the newest commit in the draw.io repo. For production, pin a version:

```js
const VERSION = '29.7.9';
const BASE = `https://cdn.jsdelivr.net/gh/jgraph/drawio@${VERSION}/src/main/webapp/`;

window.mxBasePath = BASE + 'mxgraph';
// ... set other paths accordingly
```

### The `mxscript` Interceptor

Inside `app.min.js`, draw.io calls `mxscript(src)` to load sub-modules (e.g. `PostConfig.js`, `js/extensions.min.js`). These calls use **relative paths** (`js/PostConfig.js`). In a CDN setup this resolves to `https://your-site.com/js/PostConfig.js`, causing 404s.

**Override `mxscript` globally before loading `app.min.js`** and redirect relative URLs back to the CDN:

```js
window.mxscript = function (src, onLoad, id) {
  const fullSrc = src.startsWith('http') ? src : `${BASE}${src}`;
  const s = document.createElement('script');
  s.src = fullSrc;
  if (id) s.id = id;
  if (onLoad) s.onload = onLoad;
  document.head.appendChild(s);
};
```

### Using the jsDelivr `app.min.js` Directly

If you want to skip path juggling, you can load the minified bundle directly:

```html
<script src="https://cdn.jsdelivr.net/gh/jgraph/drawio@29.7.9/src/main/webapp/js/app.min.js"></script>
```

However, icons, stencil XMLs, language packs and other **static assets** are still fetched separately, so `mxBasePath` and related settings remain required.

---

## Option 2: Clone the Repo and Host Locally

Consider local hosting when you need:

- **Source modifications**: hide menus, change skins, inject custom stencils
- **Offline / Intranet**: no external internet access
- **CSP restrictions**: cannot load external scripts or images
- **Performance**: serve static assets from your own Nginx / CDN edge

### Steps

```bash
# 1. Clone the repo
git clone https://github.com/jgraph/drawio.git
cd drawio

# 2. Checkout a stable tag (optional)
git checkout v29.7.9

# 3. Key directory structure
drawio/
└── src/main/webapp/
    ├── index.html              # official full entry
    ├── js/
    │   ├── PreConfig.js        # pre-config
    │   ├── app.min.js          # editor bundle
    │   └── PostConfig.js       # post-config
    ├── mxgraph/               # mxGraph core + CSS
    ├── resources/             # i18n files
    ├── stencils/              # stencil XMLs
    └── styles/                # grapheditor.css etc.
```

### Local Dev Server

The `webapp` folder is a plain static site; any HTTP server works:

```bash
# Python
cd src/main/webapp && python3 -m http.server 8080

# Node.js
npx serve src/main/webapp

# Vite (if you want draw.io inside a Vite project)
# Place src/main/webapp under public/drawio/
```

### Using with y-mxgraph

Replace the CDN base with your local path:

```js
const BASE = '/drawio/'; // or http://localhost:8080/

window.mxBasePath = BASE + 'mxgraph';
window.RESOURCES_PATH = BASE + 'resources';
// ... remaining setup identical
```

---

## Option 3: iframe Embed (Best Isolation)

If you do not want to pollute the current page's global namespace (`App`, `Editor`, `mxGraph` are all globals), run draw.io inside a dedicated iframe.

### Approach

1. The parent page creates an iframe whose `src` points to a child page that hosts draw.io
2. The child page loads draw.io and `y-mxgraph` normally
3. The child page forwards Yjs updates and awareness state to the parent via `window.parent.postMessage`
4. The parent acts as a bridge, relaying messages to other iframes or a network Provider

### Parent Page

```html
<div id="iframe-container">
  <iframe src="./drawio-child.html?iframeId=1"></iframe>
  <iframe src="./drawio-child.html?iframeId=2"></iframe>
</div>

<script>
  window.addEventListener('message', (e) => {
    if (e.data.type === 'ydoc-update') {
      document.querySelectorAll('iframe').forEach((iframe) => {
        if (iframe.contentWindow !== e.source) {
          iframe.contentWindow.postMessage(e.data, '*');
        }
      });
    }
  });
</script>
```

### Child Page (drawio-child.html)

```ts
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { loadDrawioScript } from './drawio-loader.js';
import { bindDrawioFile } from './collaboration.js';

const ydoc = new Y.Doc();
const awareness = new Awareness(ydoc);

let applyingParentUpdate = false;

bindDrawioFile(ydoc, awareness, () => {
  window.parent.postMessage({ type: 'init' }, '*');
});

ydoc.on('update', (update) => {
  if (applyingParentUpdate) return;
  window.parent.postMessage(
    { type: 'ydoc-update', payload: Array.from(update) },
    '*'
  );
});

window.addEventListener('message', (e) => {
  if (e.data.type === 'ydoc-update') {
    applyingParentUpdate = true;
    Y.applyUpdate(ydoc, new Uint8Array(e.data.payload));
    applyingParentUpdate = false;
  }
});
```

iframe pros:

- Multiple draw.io instances do not share the same `window.Editor`
- Crash isolation: one iframe failure does not break the parent
- Sandbox-ready: you can restrict permissions further with `sandbox="allow-scripts"`

iframe cons:

- You must build the cross-iframe message bridge yourself
- Awareness cursor coordinates need offset translation (iframe vs. parent viewport)

---

## Core Configuration Reference

All variables below must be attached to `window` **before** `app.min.js` is loaded.

### `mxBasePath` / `mxImageBasePath`

| Variable | Meaning | Example |
|----------|---------|---------|
| `mxBasePath` | mxGraph core library root | `.../mxgraph` |
| `mxImageBasePath` | Images, cursors, handles | `.../mxgraph/images` |

These paths tell mxGraph where to load `toolbar.png`, `cursor.png`, etc. If misconfigured, you will see broken-image icons in the toolbar.

### `RESOURCES_PATH` / `RESOURCE_BASE`

| Variable | Meaning |
|----------|---------|
| `RESOURCES_PATH` | Directory containing `.properties` language files |
| `RESOURCE_BASE` | Prefix for concrete resources (e.g. `dia_zh.txt`) |

draw.io fetches the language pack matching `urlParams.lang`. Wrong paths fall back to English.

### `STENCIL_PATH` / `SHAPES_PATH`

| Variable | Meaning |
|----------|---------|
| `STENCIL_PATH` | Stencil XML directory (basic flowcharts, UML, network diagrams) |
| `SHAPES_PATH` | JS shape definitions (advanced custom graphics) |

Wrong paths result in an empty or nearly-empty shape sidebar.

### `PLUGINS_BASE_PATH`

Base path for the draw.io plugin system. Safe to ignore if you do not use plugins. Required if you rely on `js/extensions.min.js` features such as math-formula support.

### `DRAW_MATH_URL`

Math rendering relies on MathJax. If you do not need formulas, set `urlParams.math = '0'` to skip MathJax entirely.

```js
window.DRAW_MATH_URL = 'https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/math/MathJax.js';
```

### `mxLoadStylesheets`

- `true` (default): `mxClient` injects `<link>` tags via `document.write()` during init
- `false`: you must manually import `common.css` and `grapheditor.css`

In Vite, Next.js and similar modern frameworks `document.write()` throws `Failed to execute 'write' on 'Document'`. **It is strongly recommended to set this to `false` and load CSS yourself.**

### `mxIsElectron`

Set to `false` to tell draw.io this is not the desktop version. Otherwise draw.io may attempt to call Node.js APIs (`process`, `require`) and crash in a browser.

### `urlParams`

draw.io inspects both the URL query string and `window.urlParams` to adjust behaviour. Pre-define it before loading:

```js
window.urlParams = window.urlParams || {};

window.urlParams['math'] = '0';       // disable MathJax
window.urlParams['stealth'] = '1';    // do not load external fonts (privacy mode)
window.urlParams['chrome'] = '0';     // hide Chrome App hints
window.urlParams['lang'] = 'zh';      // UI language
```

Common parameters:

| Parameter | Values | Description |
|-----------|--------|-------------|
| `math` | `0` / `1` | Enable math formulas |
| `stealth` | `1` | Skip Google Fonts and other external resources |
| `chrome` | `0` / `1` | Chrome App mode |
| `lang` | `zh` / `en` / `de` ... | UI language |
| `dev` | `1` | Development mode (loads uncompressed js/css, ignores CDN) |

**Caution**: never set `dev=1` when loading from a CDN, or draw.io will try to load `./js/mxClient.js` via relative paths and 404.

---

## Full Integration Example (CDN + y-mxgraph)

```ts
import * as Y from 'yjs';
import { Binding } from 'y-mxgraph';

const VERSION = '29.7.9';
const BASE = `https://cdn.jsdelivr.net/gh/jgraph/drawio@${VERSION}/src/main/webapp/`;

function setupPaths() {
  window.mxIsElectron = false;
  window.mxBasePath = BASE + 'mxgraph';
  window.mxImageBasePath = BASE + 'mxgraph/images';
  window.RESOURCES_PATH = BASE + 'resources';
  window.RESOURCE_BASE = BASE + 'resources/dia';
  window.STENCIL_PATH = BASE + 'stencils';
  window.SHAPES_PATH = BASE + 'shapes';
  window.PLUGINS_BASE_PATH = BASE;
  window.DRAW_MATH_URL = BASE + 'math/MathJax.js';
  window.mxLoadStylesheets = false;

  window.urlParams = {
    math: '0',
    stealth: '1',
    chrome: '0',
  };
}

function injectStyles() {
  const link = (href: string) => {
    const el = document.createElement('link');
    el.rel = 'stylesheet';
    el.href = href;
    document.head.appendChild(el);
  };
  link(BASE + 'mxgraph/css/common.css');
  link(BASE + 'styles/grapheditor.css');
}

function interceptMxScript() {
  window.mxscript = function (src, onLoad, id) {
    const fullSrc = src.startsWith('http') ? src : BASE + src;
    const s = document.createElement('script');
    s.src = fullSrc;
    if (id) s.id = id;
    if (onLoad) s.onload = onLoad;
    document.head.appendChild(s);
  };
}

function loadDrawio(): Promise<void> {
  return new Promise((resolve, reject) => {
    const pre = document.createElement('script');
    pre.src = BASE + 'js/PreConfig.js';

    pre.onload = () => {
      const app = document.createElement('script');
      app.src = BASE + 'js/app.min.js';
      app.onload = () => setTimeout(resolve, 1500);
      app.onerror = reject;
      document.head.appendChild(app);
    };

    pre.onerror = reject;
    document.head.appendChild(pre);
  });
}

async function init() {
  setupPaths();
  injectStyles();
  interceptMxScript();
  await loadDrawio();

  const doc = new Y.Doc();
  const App = (window as any).App;

  App.main((ui: any) => {
    const file = ui.currentFile;
    if (!file.data) {
      file.data = Binding.generateFileTemplate('my-diagram');
    }
    const binding = new Binding(file, { doc });
  });
}

init();
```

---

## FAQ

### Icons show as broken images

Check that `mxBasePath` and `mxImageBasePath` point to the correct directories. Open the browser Network panel, filter for `.png`, and verify the request URLs contain the full CDN / local path.

### `document.write is not allowed`

Under React / Vite / Next.js strict mode, draw.io's default CSS injection fails. Set `window.mxLoadStylesheets = false` and import the CSS manually.

### `App.main is not a function`

`app.min.js` has not finished loading yet. Use the `onload` callback or poll for `window.App`.

```ts
function waitForApp(callback: () => void) {
  const timer = setInterval(() => {
    if ((window as any).App) {
      clearInterval(timer);
      callback();
    }
  }, 300);
}
```

### CORS errors

jsDelivr allows cross-origin requests by default. If you use your own CDN or Nginx, ensure the response headers include `Access-Control-Allow-Origin: *` (or your origin). This is especially important for font files (`.woff2`) and worker scripts.
