# iframe Bridge

`y-mxgraph/iframe-bridge` 提供了一种在 iframe 隔离环境中进行协同编辑的方案。适用于需要将 draw.io 实例与其他页面逻辑隔离的场景。

## 架构概览

```text
┌─────────────────────────────────────────────────────────────┐
│  Server（父页面）                                            │
│                                                             │
│  唯一的网络连接点，管理 Y.Doc 和 Awareness                    │
│                                                             │
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
│             │     │             │
│ 本地 Y.Doc  │     │ 本地 Y.Doc  │
│ + Awareness │     │ + Awareness │
│ + draw.io   │     │ + draw.io   │
└─────────────┘     └─────────────┘
```

### 核心设计

- **Server**：运行在父页面，持有唯一的 `Y.Doc` 和 `Awareness` 实例，通过 y-webrtc / y-websocket 等 Provider 连接网络
- **Provider**：运行在 iframe 内部，持有本地 `Y.Doc` 和 `Awareness`，通过 `postMessage` 与 Server 同步
- **单连接**：只有 Server 维护网络连接，iframe 可以被沙盒化且无需网络访问
- **ID 映射**：Provider 自动将 Server 的 `clientID` 映射为本地 `clientID`，确保协同光标正确识别"自己"

## 安装

```bash
pnpm add y-mxgraph yjs y-protocols
```

## 基本用法

### Server（父页面）

```ts
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { createIframeBridgeServer } from 'y-mxgraph/iframe-bridge/server';

const doc = new Y.Doc();
const provider = new WebrtcProvider('my-room', doc, {
  signaling: ['wss://y-webrtc-eu.fly.dev'],
});

// 创建 bridge server
const bridge = createIframeBridgeServer(doc, provider.awareness);

// 注册 iframe
const iframe = document.getElementById('editor-iframe') as HTMLIFrameElement;
bridge.addIframe(iframe, 'editor-1');

// 清理
// bridge.destroy();
```

### Provider（iframe 子页面）

```ts
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createIframeBridgeProvider } from 'y-mxgraph/iframe-bridge/provider';

const doc = new Y.Doc();
const awareness = new Awareness(doc);

// 创建 bridge provider，自动请求初始同步
const bridge = createIframeBridgeProvider(doc, awareness);

// 可以访问 server 的 clientID
console.log(bridge.serverClientId);

// 清理
// bridge.destroy();
```

## 消息协议

Server 和 Provider 通过 `postMessage` 通信，支持以下消息类型：

| 方向 | 类型 | 载荷 | 说明 |
|------|------|------|------|
| Provider → Server | `init` | 无 | 请求全量同步 |
| Server → Provider | `ydoc-sync` | `Uint8Array` | Y.Doc 全量状态 |
| Server → Provider | `awareness-sync` | `Uint8Array` + `serverClientId` | Awareness 全量状态 |
| 双向 | `ydoc-update` | `Uint8Array` | Y.Doc 增量更新 |
| 双向 | `awareness-update` | `Uint8Array` | Awareness 增量更新 |
| Provider → Server | `ping` | 无 | 获取 serverClientId |
| Server → Provider | `pong` | `serverClientId` | 响应 ping |

## Awareness clientID 映射

### 问题

`awareness.clientID` 直接来自 `doc.clientID`。当 Server 和 Provider 各自拥有独立的 `Y.Doc` 时，它们的 `clientID` 不同。如果不做映射，Server 的光标状态会被 Provider 当作"远程光标"渲染，导致自己的光标重复显示。

### 解决方案

Provider 在初始化时接收 Server 的 `clientID`，并在同步时进行双向映射：

```text
Server awareness: { serverClientId: cursorA, peerB: cursorB }
                            │
                            ▼  映射 serverClientId → localClientId
Provider awareness: { localClientId: cursorA, peerB: cursorB }
                            │
                            ▼  collaborator 跳过 localClientId
渲染结果: 只显示 peerB 的光标（正确）
```

- **接收时**：`serverClientId → localClientId`，Server 的自身状态在 Provider 中被识别为"本地"
- **发送时**：`localClientId → serverClientId`，Provider 的状态在 Server 中被识别为同一个客户端

## 与 draw.io 集成

### Server 端

```ts
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { createIframeBridgeServer } from 'y-mxgraph/iframe-bridge/server';

const doc = new Y.Doc();
const provider = new WebrtcProvider(roomName, doc, { signaling });
const bridge = createIframeBridgeServer(doc, provider.awareness);

bridge.addIframe(document.getElementById('iframe-1')!, 'editor-1');
bridge.addIframe(document.getElementById('iframe-2')!, 'editor-2');
```

### Provider 端（iframe 内部）

```ts
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { Binding } from 'y-mxgraph';
import { createIframeBridgeProvider } from 'y-mxgraph/iframe-bridge/provider';

const doc = new Y.Doc();
const awareness = new Awareness(doc);
const bridge = createIframeBridgeProvider(doc, awareness);

// 加载 draw.io 后创建 Binding
App.main((app) => {
  const file = app.currentFile;
  const binding = new Binding(file, { doc, awareness });
});
```

## Ping/Pong 机制

Provider 可以通过 `ping` 消息获取 Server 的 `clientID`：

```ts
// Provider 发送 ping
window.parent.postMessage({ type: 'ping' }, '*');

// 监听 pong 响应
window.addEventListener('message', (event) => {
  if (event.data.type === 'pong') {
    console.log('Server clientID:', event.data.serverClientId);
  }
});
```

`createIframeBridgeProvider` 内部会在初始化时自动发送 `init` 请求，`awareness-sync` 响应中已包含 `serverClientId`。`ping/pong` 机制可用于后续动态获取。

## API 参考

### `createIframeBridgeServer(doc, awareness)`

创建 Server 端 bridge。

**参数**：

- `doc: Y.Doc` — Server 的 Y.Doc 实例
- `awareness: Awareness` — Server 的 Awareness 实例

**返回**：`IframeBridgeServer`

**方法**：

- `addIframe(iframe: HTMLIFrameElement, iframeId: string)` — 注册 iframe
- `removeIframe(iframeId: string)` — 移除 iframe
- `destroy()` — 清理所有监听器

### `createIframeBridgeProvider(doc, awareness)`

创建 Provider 端 bridge。

**参数**：

- `doc: Y.Doc` — 本地 Y.Doc 实例
- `awareness: Awareness` — 本地 Awareness 实例

**返回**：`IframeBridgeProvider`

**属性**：

- `serverClientId: number | null` — Server 的 clientID，初始化同步后可用

**方法**：

- `destroy()` — 清理所有监听器

## SharedWorker 模式

除了 iframe Bridge，项目还提供了 SharedWorker 模式用于跨标签页同步。两种模式的对比：

| 特性 | iframe Bridge | SharedWorker |
|------|---------------|--------------|
| 隔离级别 | iframe 沙盒 | 浏览器标签页 |
| 网络连接 | Server 页面 | SharedWorker |
| 适用场景 | draw.io 隔离部署 | 跨标签页协作 |
| 通信方式 | postMessage | MessagePort |

SharedWorker 实现见 `apps/demo/src/shared-worker.ts`。
