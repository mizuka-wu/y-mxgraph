# @y-mxgraph/demo

y-mxgraph 的在线演示应用，展示 draw.io 与 Yjs 实时协作的完整集成。

## 启动

```bash
pnpm --filter @y-mxgraph/demo dev
```

浏览器访问 `http://localhost:5173`。

## Demo 入口

本项目提供两个演示入口：

| 入口            | 地址                  | 说明                                                                                        |
| --------------- | --------------------- | ------------------------------------------------------------------------------------------- |
| **单页模式**    | `/index.html`         | draw.io 直接加载在当前页面，适合常规部署                                                    |
| **iframe 模式** | `/iframe-mode.html`   | 父页运行 WebRTC Provider，两个 iframe 各跑一套 draw.io + y-mxgraph，通过 `postMessage` 与父页 bridge ydoc 双向同步，适合 iframe 隔离部署场景                          |

## 功能

- 选择不同版本的 draw.io（latest / 指定版本 / 自定义 URL）
- 通过 URL 参数 `?room=<name>` 或页面输入框设置协作房间
- 多人实时协作编辑，同一房间内的操作实时同步
- 加载过程分步进度显示
- iframe 模式下父页集中管理 WebRTC 连接，iframe 内部通过 `postMessage` 同步 ydoc 和 awareness 状态
- **图片存储优化**：base64 图片自动提取到 IndexedDB，Y.Doc 只同步 `img:<uuid>` 引用（详见 [IMAGE-STORAGE.md](./src/helpers/IMAGE-STORAGE.md)）

## URL 参数

| 参数      | 说明                                          | 示例              |
| --------- | --------------------------------------------- | ----------------- |
| `version` | draw.io 版本，对应 `DRAWIO_VERSIONS` 中的 key | `?version=29.7.9` |
| `room`    | 协作房间名                                    | `?room=my-room`   |

## 源码结构

```text
src/
├── main.ts              # 入口：初始化、版本切换、加载流程编排（单页模式）
├── iframe-parent.ts     # 入口：父容器逻辑，bridge ydoc + WebRTC Provider + postMessage 路由（iframe 模式）
├── iframe-child.ts      # 入口：iframe 内部逻辑，加载 draw.io + 通过 postMessage 与父页同步
├── config.ts            # 常量：版本列表、信令服务器、默认房间、示例文件
├── drawio-loader.ts     # draw.io CDN 加载器
├── collaboration.ts     # Yjs 协作：创建连接、绑定 draw.io 文件
├── ui.ts                # DOM 操作工具函数
└── helpers/
    ├── image-storage.ts # 图片存储：base64 → IndexedDB，Y.Doc 同步 img:<uuid>
    └── IMAGE-STORAGE.md # 图片存储模块文档
```

### `config.ts`

集中管理所有配置常量：

- `DRAWIO_VERSIONS` — 版本名 → `app.min.js` CDN URL 的映射表
- `SIGNALING_SERVERS` — WebRTC 信令服务器列表（空数组时使用 y-webrtc 默认服务器）
- `DEFAULT_ROOM` — 默认协作房间名
- `Binding.generateFileTemplate()` — 通过 `y-mxgraph` 生成标准化初始模板（取代硬编码 XML）

### `drawio-loader.ts`

负责以生产模式从 CDN 加载 draw.io，解决 Vite dev 环境下无法加载本地 draw.io 资源的问题。

**关键设计：**

1. **禁用 dev 模式** — 不设置 `urlParams.dev = "1"`，避免 draw.io 尝试加载本地相对路径资源
2. **CDN 路径全覆盖** — 在加载前将 `mxBasePath`、`RESOURCES_PATH`、`STENCIL_PATH` 等全局变量指向 jsDelivr CDN
3. **`mxscript` 拦截器** — 注入全局 `mxscript` 函数，将 `app.min.js` 内部调用的相对路径（如 `js/PostConfig.js`）自动补全为 CDN 绝对地址
4. **两阶段加载** — 先加载 `PreConfig.js`，成功后再加载 `app.min.js`，与 draw.io 官方 `bootstrap.js` 生产流程一致
5. **`onProgress` 回调** — 在 `preconfig` / `app` / `init` 三个阶段分别回调，驱动 loading overlay 的步骤进度 UI

```typescript
loadDrawioScript(version, {
  onLoading:  () => { /* 开始加载 */ },
  onProgress: (step) => { /* "preconfig" | "app" | "init" */ },
  onReady:    (version) => { /* 加载完成 */ },
  onError:    (message) => { /* 加载失败 */ },
});
```

### `collaboration.ts`

封装 Yjs + y-webrtc 协作逻辑，是整个 demo 的核心。

#### `createCollaboration(roomName, callbacks)`

创建 `Y.Doc` 和 `WebrtcProvider`，监听连接状态和 peer 数量变化，返回 `CollabState`。

#### `bindDrawioFile(doc, awareness, onBind)`

将 draw.io 文件绑定到 Y.Doc，实现双向同步。

**图片存储集成：**

创建 Binding 时配置 `transformPatch` 和图片存储钩子：

```typescript
import { transformImagePatch, configureImageStorage, injectImageStorageHooks } from "./helpers/image-storage.js";

const binding = new Binding(file, {
  doc,
  transformPatch: transformImagePatch,  // 拦截 base64 图片
});

configureImageStorage({ graph });  // 配置 graph 引用
injectImageStorageHooks();         // 注入渲染钩子
```

**同步策略（为什么需要等待）：**

当新客户端加入房间时，Y.Doc 是空的。如果立即创建 Binding，会导致：
1. Binding 用本地空模板初始化 Y.Doc
2. 远端数据到达后，与本地数据冲突
3. 两端数据不一致

因此需要等待 Y.Doc 收到远端数据后再创建 Binding。

```typescript
// 检查 Y.Doc 是否已有数据
const diagramMap = mxfileMap.get("diagram");
const hasData = diagramMap && diagramMap.size > 0;

if (hasData) {
  // 有数据，直接绑定
  setTimeout(tryBind, 300);
} else {
  const peerCount = provider.awareness.getStates().size;
  if (peerCount <= 1) {
    // 单人模式，直接绑定
    setTimeout(tryBind, 300);
  } else {
    // 有其他 peer，等待远端数据同步
    doc.on("update", onDocUpdate);
    setTimeout(tryBind, 500); // 超时兜底
  }
}
```

**为什么需要手动同步 doc 到 file：**

draw.io 的 `file.patch()` 只更新内部数据结构，不触发 UI 重新渲染。因此在创建 Binding 前，需要手动把 Y.Doc 数据转成 XML 并设置到 file：

```typescript
if (docHasData) {
  const xml = ydoc2xml(doc);
  file.ui.setFileData(xml);
  file.setData(xml);
}
```

这是 draw.io API 的限制，[ws-demo](../simple-y-websocket-server-demo) 也采用相同方案。

**绑定流程：**

1. 等待 `window.App` 就绪
2. 调用 `App.main` 双回调模式：
   - 第二个回调（UI 工厂）：创建 `Editor` 和 `App` 实例，挂载到 `#drawio-container`
   - 第一个回调（就绪回调）：检查 Y.Doc 数据，手动同步到 file，创建 Binding
3. 调用 `app.refresh()` 刷新 UI

调试时可通过 `window.__doc__`、`window.__binding__` 访问运行时对象。

#### `disconnectCollaboration(state)`

销毁 Binding、Provider、Doc，清理调试引用。

### `iframe-parent.ts`

iframe 模式父页入口，集中管理 WebRTC Provider 和 bridge Y.Doc：

1. 创建 bridge `Y.Doc` 和 `WebrtcProvider`，连接信令服务器
2. 监听两个 iframe 的 `postMessage`：
   - `init` — 向该 iframe 发送当前 bridge ydoc 和 awareness 的完整状态快照
   - `ydoc-update` — 应用到 bridge ydoc，再广播给所有 iframe
   - `awareness-update` — 应用到 bridge awareness，再广播给所有 iframe
3. 监听 bridge ydoc/awareness 的 `update` 事件，将增量同步到所有 iframe

### `iframe-child.ts`

iframe 模式子页入口，每个 iframe 独立加载 draw.io：

1. `loadDrawioScript` 加载 draw.io 脚本
2. 创建独立的 `Y.Doc` 和 `Awareness`（**不连接 Provider**）
3. `bindDrawioFile` 绑定 draw.io 文件到本地 ydoc/awareness
4. 向父页发送 `init` 请求初始状态
5. 监听父页 `postMessage`：
   - `ydoc-sync` / `ydoc-update` — `Y.applyUpdate()` 应用到本地 ydoc
   - `awareness-sync` / `awareness-update` — `applyAwarenessUpdate()` 应用到本地 awareness
6. 监听本地 ydoc/awareness 的 `update` 事件，通过 `postMessage` 发给父页

> **关键防循环设计**：通过 `applyingParentUpdate` flag 抑制从父页接收并应用 update 时触发本地 `update` 事件回发，避免循环同步。

### HTML 入口文件

| 文件 | 说明 |
| ---- | ---- |
| `index.html` | 单页模式入口，包含 toolbar、状态栏和 `#drawio-container` |
| `iframe-mode.html` | iframe 模式入口，包含 toolbar、状态栏和左右两个 `<iframe>` |
| `iframe.html` | iframe 子页入口，精简结构（无 toolbar），只保留 `#drawio-container` 和加载遮罩 |

### `ui.ts`

纯 DOM 操作，无业务逻辑。提供：

- `getUIElements()` — 统一获取所有 DOM 引用，返回类型化对象
- `updateDrawioStatus` / `updateCollabStatus` / `updatePeerCount` — 状态栏更新
- `showLoading(elements, message)` — 显示加载遮罩，用 `style.removeProperty("display")` 而非 `display = "block"`，避免覆盖 `grapheditor.css` 的 `display: grid` 布局
- `showReady(elements)` — 隐藏加载遮罩
- `toggleCustomUrl` — 自定义 URL 输入框显隐
- `restoreRoomFromURL` — 从 URL 参数 `?room=` 恢复房间名

### `main.ts`

应用入口，编排初始化流程：

1. `restoreRoomFromURL` 恢复房间
2. 从 URL 参数 `?version=` 读取版本，回填到下拉框
3. `showLoading` 显示遮罩
4. `loadDrawioScript` 加载 draw.io，`onProgress` 驱动步骤进度 UI
5. `onReady` 后调用 `connectCollaboration`：创建协作连接 → 绑定文件

## CSS 架构说明

draw.io 新版（v26+）使用 **CSS Grid** 布局（`.geEditor { display: grid }`），由 `grapheditor.css` 定义。

注意事项：

- 不要用 `element.style.display = "block/none"` 操作 `#drawio-container`（inline style 优先级会覆盖 grid），统一用 `style.removeProperty("display")`
- 应用的自定义样式（按钮、输入框等）应加 `#toolbar` 前缀限定作用域，避免污染 draw.io 内部同类元素
- `#drawio-container` 本身就是 `.geEditor` 容器，`position: absolute; inset: 0` 填满父级即可，宽高由 CSS 继承
