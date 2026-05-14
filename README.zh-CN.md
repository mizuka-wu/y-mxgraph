# y-mxgraph

[English](./README.md)

Yjs 与 draw.io (mxGraph) 文档的双向绑定库，让 draw.io 支持实时多人协同编辑。

## 特性

- **双向绑定** draw.io 文件与 Y.Doc
- **实时协作** 支持 y-webrtc、y-websocket 及任意 Yjs Provider
- **撤销/重做** 集成 Y.UndoManager
- **协同光标** 基于 y-protocols Awareness 渲染远端光标与选区
- **iframe Bridge** 通过 postMessage 同步隔离的 draw.io 实例
- **完整 TypeScript** 类型支持

## 安装

```bash
pnpm add y-mxgraph yjs y-protocols
```

`yjs` 和 `y-protocols` 为 peer dependencies，需单独安装。

## 快速开始

```ts
import * as Y from 'yjs';
import { Binding, LOCAL_ORIGIN } from 'y-mxgraph';

const doc = new Y.Doc();

App.main((app) => {
  // 必须保证多端初始文件一致；draw.io 默认新建 diagram 时 id 是随机的，
  // 若各客户端起点不同会导致协同异常。可用 generateFileTemplate 生成统一模板。
  if (!app.currentFile.data) {
    app.currentFile.data = Binding.generateFileTemplate('diagram-0');
  }

  // `disableBeforeUnload`（默认 true）禁用 draw.io 的 "All changes will be lost" 弹窗，
  // 因为 Yjs 已接管持久化。如需保留原生行为（如使用 File System Access API），设为 false。
  const binding = new Binding(app.currentFile, { doc });

  window.addEventListener('beforeunload', () => binding.destroy());
});
```

## 文档

- [快速开始](https://mizuka-wu.github.io/y-mxgraph/guide/getting-started)
- [API 参考](https://mizuka-wu.github.io/y-mxgraph/api/)
- [实现原理](https://mizuka-wu.github.io/y-mxgraph/guide/architecture)
- [iframe Bridge](https://mizuka-wu.github.io/y-mxgraph/guide/iframe-bridge)

## iframe Bridge

`@y-mxgraph/iframe-bridge` 支持在 iframe 隔离环境中进行协同编辑。**Server**（父页面）管理网络连接（y-webrtc、y-websocket 等），通过 `postMessage` 将 Y.Doc 和 Awareness 同步到一个或多个 **Provider**（iframe 子页面）。

```text
┌─────────────────────────────────────────────────────────────┐
│  Server（父页面）                                            │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────────────┐ │
│  │  Y.Doc   │  │ Awareness │  │ Provider (y-webrtc 等)   │ │
│  └────┬─────┘  └─────┬─────┘  └──────────────────────────┘ │
│       │              │                                      │
│       └──────┬───────┘                                      │
│              ▼                                              │
│   createIframeBridgeServer(doc, awareness)                  │
│              │ postMessage                                  │
└──────────────│──────────────────────────────────────────────┘
               │
    ┌──────────┴──────────┐
    ▼                     ▼
┌─────────────┐     ┌─────────────┐
│ Iframe A    │     │ Iframe B    │
│ create...   │     │ create...   │
│ Provider()  │     │ Provider()  │
│             │     │             │
│ 本地 Y.Doc  │     │ 本地 Y.Doc  │
│ + draw.io   │     │ + draw.io   │
└─────────────┘     └─────────────┘
```

```ts
// Server（父页面）
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { LOCAL_ORIGIN } from 'y-mxgraph';
import { IFRAME_ORIGIN } from 'y-mxgraph/iframe-bridge';
import { createIframeBridgeServer } from 'y-mxgraph/iframe-bridge/server';

const doc = new Y.Doc();
const provider = new WebrtcProvider(roomName, doc, { signaling });
const awareness = provider.awareness;

// 可选：启用跨 iframe 撤销/重做
const undoManager = new Y.UndoManager(doc, {
  trackedOrigins: new Set([LOCAL_ORIGIN, IFRAME_ORIGIN]),
});

const bridge = createIframeBridgeServer(doc, awareness, { undoManager });
bridge.addIframe(iframeElement, 'child-1');

// 从父页面执行撤销/重做
document.getElementById('undo-btn')!.onclick = () => {
  if (undoManager.canUndo()) undoManager.undo();
};

// Provider（iframe 子页面）
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
  // 接管 draw.io 的 undo manager，使其通过 Server 执行
  bridge.takeoverUndoManager(file);
});
```

详见 [iframe Bridge 文档](https://mizuka-wu.github.io/y-mxgraph/guide/iframe-bridge)。

## 本地开发

```bash
# 克隆仓库
git clone https://github.com/mizuka-wu/y-mxgraph.git
cd y-mxgraph

# 安装依赖
pnpm install

# 构建
pnpm --filter y-mxgraph build

# 测试
pnpm --filter y-mxgraph test

# 启动 Demo (WebRTC 模式)
pnpm --filter @y-mxgraph/demo dev

# 启动 WebSocket 服务器 Demo (支持文件持久化)
pnpm --filter @y-mxgraph/ws-demo server  # 启动服务器 (端口 1234)
pnpm --filter @y-mxgraph/ws-demo dev     # 启动客户端 (端口 5174)

# 启动文档
pnpm --filter @y-mxgraph/docs dev
```

## License

MIT
