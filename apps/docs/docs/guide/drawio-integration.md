# 集成 draw.io

`y-mxgraph` 本身不包含 draw.io（mxGraph）编辑器，你需要在页面中先加载它。本章节介绍从最简单到最完整的几种集成方式，以及 draw.io 各项配置的含义。

---

## 方式一：通过 CDN 加载（推荐，最简单）

draw.io 的核心是一个单文件 `app.min.js`（约 3 MB），加上少量 CSS 和资源文件。你可以直接从 CDN 加载，无需本地部署。

### 最简单的加载顺序

draw.io 生产环境的标准启动顺序为：

1. **PreConfig.js** — 预配置脚本
2. **app.min.js** — 编辑器主程序
3. **PostConfig.js** — 后配置脚本（由 `app.min.js` 内部通过 `mxscript()` 自动加载）

```html
<script>
  // 1. 设置基础路径（指向 CDN）
  window.mxBasePath = 'https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/mxgraph';
  window.mxImageBasePath = 'https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/mxgraph/images';
  window.RESOURCES_PATH = 'https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/resources';
  window.RESOURCE_BASE = 'https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/resources/dia';
  window.STENCIL_PATH = 'https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/stencils';
  window.SHAPES_PATH = 'https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/shapes';
  window.PLUGINS_BASE_PATH = 'https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/';

  // 2. 标记为非 Electron 环境
  window.mxIsElectron = false;

  // 3. 加载 PreConfig.js
  const pre = document.createElement('script');
  pre.src = 'https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/js/PreConfig.js';
  document.head.appendChild(pre);

  pre.onload = () => {
    // 4. 加载 app.min.js
    const app = document.createElement('script');
    app.src = 'https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/js/app.min.js';
    document.head.appendChild(app);

    app.onload = () => {
      // 5. App 已就绪，可以初始化 y-mxgraph
      console.log('draw.io loaded');
    };
  };
</script>
```

### 为什么要手动引入 CSS

当设置 `window.mxLoadStylesheets = false` 时，draw.io 不会自动注入 CSS。你需要手动引入两个核心样式：

```html
<link rel="stylesheet"
      href="https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/mxgraph/css/common.css" />
<link rel="stylesheet"
      href="https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/styles/grapheditor.css" />
```

如果不关闭 `mxLoadStylesheets`，draw.io 会尝试通过 `document.write()` 插入样式，这在现代 bundler 或严格 CSP 环境下可能报错。

### 锁定版本

上面的 `latest` 会跟随 draw.io 仓库的最新提交。生产环境建议锁定版本号：

```js
const VERSION = '29.7.9';
const BASE = `https://cdn.jsdelivr.net/gh/jgraph/drawio@${VERSION}/src/main/webapp/`;

window.mxBasePath = BASE + 'mxgraph';
// ... 其他路径同理
```

### mxscript 拦截器

`app.min.js` 内部使用 `mxscript(src)` 加载子模块（如 `PostConfig.js`、`js/extensions.min.js`）。这些调用默认使用**相对路径**（如 `js/PostConfig.js`），在 CDN 场景下会变成 `https://your-site.com/js/PostConfig.js`，导致 404。

**必须在加载 `app.min.js` 之前**覆盖全局 `mxscript` 函数，将相对路径重定向回 CDN：

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

### 使用 jsDelivr 的 min.js 直链

如果你不想自己处理路径拼接，可以直接使用 jsdelivr 编译好的单文件入口（内部已经打包了大部分资源）：

```html
<script src="https://cdn.jsdelivr.net/gh/jgraph/drawio@29.7.9/src/main/webapp/js/app.min.js"></script>
```

但即使如此，图标、形状模板、语言包等**静态资源**仍然需要从 CDN 下载，所以 `mxBasePath` 等配置依然需要正确设置。

---

## 方式二：Clone 仓库并本地部署

当需要以下场景时，建议把 draw.io 仓库 clone 到本地：

- **修改源码**：关闭某些菜单项、更换皮肤、注入自定义形状库
- **内网环境**：无法访问外网 CDN
- **CSP 限制**：无法加载外部脚本/图片
- **性能优化**：静态资源走本地 Nginx/CDN，减少延迟

### 步骤

```bash
# 1. clone 仓库
git clone https://github.com/jgraph/drawio.git
cd drawio

# 2. 切到稳定标签（可选）
git checkout v29.7.9

# 3. 关键目录结构
drawio/
└── src/main/webapp/
    ├── index.html              # 官方完整入口
    ├── js/
    │   ├── PreConfig.js        # 预配置
    │   ├── app.min.js          # 编辑器主程序
    │   └── PostConfig.js       # 后配置
    ├── mxgraph/               # mxGraph 核心库 + CSS
    ├── resources/             # 多语言资源
    ├── stencils/              # 形状模板 XML
    └── styles/                # grapheditor.css 等
```

### 本地开发服务器

`webapp` 目录是一个纯静态站点，任意 HTTP 服务器均可：

```bash
# Python
cd src/main/webapp && python3 -m http.server 8080

# Node.js
npx serve src/main/webapp

# Vite（如果你希望把 draw.io 集成到 Vite 项目里）
# 将 src/main/webapp 放在 public/drawio/ 下
```

### 与 y-mxgraph 配合使用

本地部署时，只需把上面的 CDN 基础地址替换为本地路径：

```js
const BASE = '/drawio/';  // 或 http://localhost:8080/

window.mxBasePath = BASE + 'mxgraph';
window.RESOURCES_PATH = BASE + 'resources';
// ... 其余配置同上
```

---

## 方式三：iframe 嵌入（隔离性最好）

如果你不想在当前页面污染全局命名空间（`App`、`Editor`、`mxGraph` 等都挂在 `window` 上），可以把 draw.io 放在一个独立 iframe 中运行。

### 实现思路

1. 父页面创建 iframe，src 指向托管 draw.io 的子页面
2. 子页面内部正常加载 draw.io 和 `y-mxgraph`
3. 子页面通过 `window.parent.postMessage` 把 Yjs updates 和 awareness 状态传出
4. 父页面作为桥梁，把消息转发给其他 iframe 或网络 Provider

### 父页面

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

### 子页面（drawio-child.html）

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

iframe 模式的优势：

- 多个 draw.io 实例互不影响，不会共享全局 `window.Editor`
- 崩溃隔离：一个 iframe 异常不会影响主页面
- 天然支持沙箱：`sandbox="allow-scripts"` 可进一步限制权限

劣势：

- 需要自行实现跨 iframe 通信桥
- Awareness 光标位置需要坐标转换（iframe 相对父页面的偏移）

---

## 核心配置项详解

以下变量均需在**加载 `app.min.js` 之前**挂载到 `window` 上。

### `mxBasePath` / `mxImageBasePath`

| 变量 | 含义 | 示例值 |
|------|------|--------|
| `mxBasePath` | mxGraph 核心库根目录 | `.../mxgraph` |
| `mxImageBasePath` | 图片、光标、边框图标 | `.../mxgraph/images` |

这两个路径决定了 mxGraph 内部如何加载 `toolbar.png`、`cursor.png` 等静态资源。如果设置错误，你会看到工具栏图标变成裂图。

### `RESOURCES_PATH` / `RESOURCE_BASE`

| 变量 | 含义 |
|------|------|
| `RESOURCES_PATH` | 多语言 `.properties` 文件所在目录 |
| `RESOURCE_BASE` | 具体资源文件前缀（如 `dia_zh.txt`） |

draw.io 根据 `urlParams.lang` 自动请求对应语言包。如果路径错误，编辑器会回退到英文。

### `STENCIL_PATH` / `SHAPES_PATH`

| 变量 | 含义 |
|------|------|
| `STENCIL_PATH` | 形状模板 XML 目录（基本流程图、UML、网络拓扑等） |
| `SHAPES_PATH` | JS 形状定义（进阶自定义图形） |

路径错误会导致左侧形状面板空白或只显示基础图形。

### `PLUGINS_BASE_PATH`

draw.io 插件系统的基础路径。如果你不使用插件，可以忽略。但如果需要加载 `js/extensions.min.js` 中的功能（如数学公式支持），该路径必须正确。

### `DRAW_MATH_URL`

数学公式渲染依赖 MathJax。如果不需要数学公式，设置 `urlParams.math = '0'` 可以完全跳过 MathJax 加载。

```js
window.DRAW_MATH_URL = 'https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/math/MathJax.js';
```

### `mxLoadStylesheets`

- `true`（默认）：`mxClient` 初始化时通过 `document.write()` 写入 `<link>` 标签加载 CSS
- `false`：你需要手动引入 `common.css` 和 `grapheditor.css`

在 Vite、Next.js 等现代框架中，`document.write()` 会报 `Failed to execute 'write' on 'Document'` 错误，因此**强烈建议设为 `false` 并手动引入 CSS**。

### `mxIsElectron`

设为 `false` 明确告诉 draw.io 这不是桌面端。否则 draw.io 可能尝试调用 Node.js API（如 `process`、`require`），导致浏览器环境报错。

### `urlParams`

draw.io 内部通过解析 URL query string 和 `window.urlParams` 对象来调整行为。你可以在加载之前预定义它：

```js
window.urlParams = window.urlParams || {};

window.urlParams['math'] = '0';       // 禁用 MathJax
window.urlParams['stealth'] = '1';    // 不加载外部字体（隐私模式）
window.urlParams['chrome'] = '0';     // 隐藏 Chrome 应用相关提示
window.urlParams['lang'] = 'zh';      // 指定语言
```

常用参数：

| 参数 | 值 | 说明 |
|------|-----|------|
| `math` | `0` / `1` | 是否启用数学公式 |
| `stealth` | `1` | 不加载 Google Fonts 等外部资源 |
| `chrome` | `0` / `1` | Chrome App 模式 |
| `lang` | `zh` / `en` / `de` ... | 界面语言 |
| `dev` | `1` | 开发模式（加载未压缩的 js/css，不走 CDN） |

**注意**：不要在你通过 CDN 加载时设置 `dev=1`，否则 draw.io 会尝试加载 `./js/mxClient.js` 等本地相对路径，导致 404。

---

## 完整集成示例（CDN + y-mxgraph）

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

## 常见问题

### 图标全部显示为裂图

检查 `mxBasePath` 和 `mxImageBasePath` 是否指向正确目录。浏览器 Network 面板里搜索 `.png`，确认请求 URL 是否包含完整的 CDN/本地路径。

### `document.write is not allowed`

在 React/Vite/Next.js 等严格模式下，draw.io 默认的 CSS 注入方式会报错。设置 `window.mxLoadStylesheets = false` 并手动引入 CSS。

### `App.main is not a function`

`app.min.js` 尚未加载完成。使用 `onload` 回调或轮询检查 `window.App` 是否存在。

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

### 跨域 CORS 报错

jsDelivr 默认支持跨域，但如果你使用自己的 CDN 或 Nginx，需要确保响应头包含 `Access-Control-Allow-Origin: *`（或你的域名）。特别是字体文件（`.woff2`）和 worker 脚本。
