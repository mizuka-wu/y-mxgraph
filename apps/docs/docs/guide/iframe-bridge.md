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
│   createIframeBridgeServer(iframe, doc, awareness)          │
│              │ postMessage                                  │
└──────────────│──────────────────────────────────────────────┘
               │
               ▼
        ┌─────────────┐
        │   Iframe    │
        │             │
        │ 本地 Y.Doc  │
        │ + Awareness │
        │ + draw.io   │
        └─────────────┘
```

### 核心设计

- **Server**：运行在父页面，持有唯一的 `Y.Doc` 和 `Awareness` 实例，通过 y-webrtc / y-websocket 等 Provider 连接网络。每个 iframe 对应一个 Server 实例，直接绑定到目标 iframe
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

// 创建 bridge server，直接绑定到目标 iframe
const iframe = document.getElementById('editor-iframe') as HTMLIFrameElement;
const bridge = createIframeBridgeServer(iframe, doc, provider.awareness);

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
| Provider → Server | `undo` | 无 | 请求撤销 |
| Provider → Server | `redo` | 无 | 请求重做 |
| Server → Provider | `undo-state` | `canUndo`, `canRedo`, `undoStackSize`, `redoStackSize` | 同步撤销栈状态 |

### 基线数据（Baseline）

Provider 在首次初始化时（如 `xml2ydoc` 产生的初始数据），会通过 `ydoc-update` 附带 `isBaseline: true` 标记。Server 使用 `BASELINE_ORIGIN` 应用这类更新，确保它们**不进入 UndoManager 的撤销栈**。

普通编辑数据则使用 `IFRAME_ORIGIN`，会被 UndoManager 正确追踪。

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

## Undo/Redo

iframe Bridge 支持跨 iframe 的撤销/重做。核心思路是：**撤销/重做的实际执行发生在 Server 端的共享 `Y.UndoManager` 上，iframe 只负责发送命令和接收状态同步**。

### 架构

```text
用户在 Iframe 按下 Ctrl+Z
  → draw.io 调用 editor.undoManager.undo()
  → MxLike shim 通过 postMessage 发送 { type: "undo" } 到父页面
  → Server 收到消息 → 调用共享 UndoManager.undo()
  → Y.UndoManager 弹出栈 → 触发 "stack-item-popped" 事件
  → Server 发送 "undo-state" 到 iframe（包含 canUndo/canRedo/栈大小）
  → iframe 的 MxLike 根据状态重建 history/indexOfNextAdd
  → 触发合成事件通知 draw.io 更新 UI（工具栏、光标位置等）
```

### Server 端配置

在父页面创建 `Y.UndoManager` 并传入 `createIframeBridgeServer`：

```ts
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { LOCAL_ORIGIN } from 'y-mxgraph';
import { IFRAME_ORIGIN } from 'y-mxgraph/iframe-bridge';
import { createIframeBridgeServer } from 'y-mxgraph/iframe-bridge/server';

const doc = new Y.Doc();
const provider = new WebrtcProvider(roomName, doc, { signaling });
const awareness = provider.awareness;

// 创建 UndoManager，追踪本地和 iframe 来源的事务
const undoManager = new Y.UndoManager(doc, {
  trackedOrigins: new Set([LOCAL_ORIGIN, IFRAME_ORIGIN]),
});

// 传入 bridge server，直接绑定 iframe。
// 如果 UndoManager 支持 addTrackedOrigin/removeTrackedOrigin，桥接会在创建/销毁时自动管理 IFRAME_ORIGIN。
// 如果不支持，请继续在 trackedOrigins 中保留 IFRAME_ORIGIN。
const bridge = createIframeBridgeServer(iframeElement, doc, awareness, { undoManager });

// 可以在父页面直接调用 undo/redo
document.getElementById('undo-btn')!.onclick = () => {
  if (undoManager.canUndo()) undoManager.undo();
};
document.getElementById('redo-btn')!.onclick = () => {
  if (undoManager.canRedo()) undoManager.redo();
};
```

> **`trackedOrigins` 说明**：`Y.UndoManager` 默认只追踪 `LOCAL_ORIGIN` 的事务。在 iframe 场景下，来自 iframe 的更新以 `IFRAME_ORIGIN` 作为 origin 应用到 Server 的 Y.Doc。
> 如果 UndoManager 支持 `addTrackedOrigin`/`removeTrackedOrigin`，`createIframeBridgeServer` 会在创建/销毁时自动管理 `IFRAME_ORIGIN`。
> 否则仍需手动将 `IFRAME_ORIGIN` 加入 `trackedOrigins`，否则 iframe 的编辑不会进入撤销栈。

### Provider 端接管 draw.io UndoManager

在 iframe 内部，需要调用 `bridge.takeoverUndoManager(file)` 将 draw.io 原生的 `editor.undoManager` 替换为兼容层。这样 draw.io 的撤销/重做操作会通过 postMessage 委托给 Server 执行：

```ts
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

  // 接管 draw.io 的 UndoManager
  const restoreUndoManager = bridge.takeoverUndoManager(file);

  // 如需恢复原生 UndoManager（通常在 destroy 时自动处理）
  // restoreUndoManager();
});
```

`takeoverUndoManager` 返回一个清理函数，调用后会恢复 draw.io 原生的 `editor.undoManager`。`bridge.destroy()` 时会自动调用此清理函数。

### 工作原理

`takeoverUndoManager` 做了以下事情：

1. **保存原始状态**：备份 draw.io 的 `editor.undoManager` 及其事件监听器
2. **替换为 MxLike shim**：一个模拟 `mxUndoManager` 接口的兼容层，包含：
   - `history[]` + `indexOfNextAdd`：本地维护的撤销栈光标（仅用于 UI 状态，不存储实际数据）
   - `undo()` / `redo()`：通过 postMessage 委托给 Server
   - `canUndo()` / `canRedo()`：基于本地光标判断
   - `fireEvent()`：触发 draw.io 监听的事件（`"add"`, `"clear"`, `"undo"`, `"redo"`）
3. **监听 Server 状态同步**：接收 `"undo-state"` 消息，根据 server 的真实撤销栈状态重建本地 history 和 indexOfNextAdd，并触发对应事件
4. **保留原始监听器**：将 draw.io 原有的事件监听器迁移到 shim 上

## 与 draw.io 集成

### Server 端

每个 iframe 对应一个独立的 Server 实例：

```ts
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { createIframeBridgeServer } from 'y-mxgraph/iframe-bridge/server';

const doc = new Y.Doc();
const provider = new WebrtcProvider(roomName, doc, { signaling });

// iframe-1
const bridge1 = createIframeBridgeServer(
  document.getElementById('iframe-1')!,
  doc,
  provider.awareness,
);

// iframe-2（共享同一个 doc 和 awareness）
const bridge2 = createIframeBridgeServer(
  document.getElementById('iframe-2')!,
  doc,
  provider.awareness,
);
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

### `createIframeBridgeServer(iframe, doc, awareness, options?)`

创建 Server 端 bridge，直接与单个 iframe 绑定。

**参数**：

- `iframe: HTMLIFrameElement` — 目标 iframe 元素
- `doc: Y.Doc` — Server 的 Y.Doc 实例
- `awareness: Awareness` — Server 的 Awareness 实例
- `options?` — 可选配置
  - `undoManager?: Y.UndoManager` — 共享的 UndoManager 实例，传入后支持跨 iframe 撤销/重做
  - `debug?: boolean` — 启用 iframe-bridge 消息调试日志

**返回**：`IframeBridgeServer`

**方法**：

- `destroy()` — 清理所有监听器（包括 UndoManager 事件监听）

### `createIframeBridgeProvider(doc, awareness, options?)`

创建 Provider 端 bridge。

**参数**：

- `doc: Y.Doc` — 本地 Y.Doc 实例
- `awareness: Awareness` — 本地 Awareness 实例
- `options?` — 可选配置
  - `debug?: boolean` — 启用 iframe-bridge 消息调试日志


**返回**：`IframeBridgeProvider`

**属性**：

- `serverClientId: number | null` — Server 的 clientID，初始化同步后可用

**方法**：

- `takeoverUndoManager(file: DrawioFile) => () => void` — 接管 draw.io 的 `editor.undoManager`，返回清理函数。详见 [Undo/Redo](#undoredo) 章节
- `destroy()` — 清理所有监听器（包括接管的 UndoManager）
