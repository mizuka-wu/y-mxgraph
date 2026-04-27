# 使用 Yjs Provider

## 什么是 Provider？

`y-mxgraph` 本身只负责将 draw.io 的文件状态与 **Yjs `Y.Doc`** 保持同步，并不关心数据如何在网络上传输。  
真正负责网络同步的部分是 **Yjs Provider** —— 它们将 `Y.Doc` 的更新广播给其他客户端，并在本地应用远端的变更。

你可以根据自己的部署需求选择合适的 Provider，而无需修改任何 `y-mxgraph` 相关代码。

## 常用 Provider

Yjs 官方及社区维护了多种 Provider，完整列表见：  
👉 [https://github.com/yjs/yjs#providers](https://github.com/yjs/yjs#providers)

常用的包括：

- **[y-websocket](https://github.com/yjs/y-websocket)** — 基于 WebSocket，官方维护，适合大多数场景，需自建服务端
- **[y-webrtc](https://github.com/yjs/y-webrtc)** — 基于 WebRTC P2P，无需专用服务器（仅需信令服务器），适合小规模协作
- **[y-indexeddb](https://github.com/yjs/y-indexeddb)** — 本地持久化，将文档存储在浏览器 IndexedDB 中
- **[Hocuspocus](https://tiptap.dev/docs/hocuspocus/introduction)** — 功能完整的协作后端，支持鉴权、持久化、插件体系

## y-websocket 示例

以下是使用 `y-websocket` 与 `y-mxgraph` 集成的最基础示例。

### 安装

```bash
pnpm add y-mxgraph yjs y-protocols y-websocket
```

### 客户端代码

```ts
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Binding, LOCAL_ORIGIN } from 'y-mxgraph';

const doc = new Y.Doc();

// 连接到 y-websocket 服务端
// 第一个参数是 WebSocket 服务器地址，第二个参数是房间名
const provider = new WebsocketProvider('ws://localhost:1234', 'my-room', doc);

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

### 启动服务端

`y-websocket` 提供了一个开箱即用的 Node.js 服务端：

```bash
# 使用 npx 直接启动，默认监听 1234 端口
HOST=localhost PORT=1234 npx y-websocket
```

也可以作为依赖集成到自己的 Node.js 项目中，详见 [y-websocket 文档](https://github.com/yjs/y-websocket)。

### 销毁

组件卸载时记得同时销毁 binding 和 provider：

```ts
binding.destroy(true);
provider.destroy();
```
