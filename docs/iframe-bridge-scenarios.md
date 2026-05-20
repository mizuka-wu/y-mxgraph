# iframe-bridge 场景文档

## 概述

iframe-bridge 实现了标准的 server-client 协同模式：

- **Server**（父页面 `iframe-container.ts`）：持有 `Y.Doc` + `WebrtcProvider`，负责网络同步和 iframe 桥接
- **Client**（子页面 iframe 内）：通过 `createIframeBridgeProvider` 连接到 server，本地也有独立的 `Y.Doc`

核心设计：**draw.io 编辑器先加载就绪，overlay 保持半透明 waiting 状态，等 connect 后才显示编辑器并 bind**。这让用户在等待 server 时能看到背后已加载的编辑器界面。

### Awareness 同步说明

iframe provider 的默认实现会将本地用户信息通过 `awareness.setLocalState()` 发送到父页面桥接层。父页面的 awareness 状态被视为权威来源，server 端会接收 `awareness-local-state` 消息并同步到 bridge awareness，再将更新下发给 iframe。这样可以保证 iframe 内部的用户元信息与父容器和网络 provider 之间保持一致。

---

## 连接时序与状态定义

### Server 状态

| 状态 | 含义 |
|------|------|
| `created` | `createIframeBridgeServer()` 已调用，`ydoc` 已创建，正在监听 `init` 消息 |
| `ready` | 收到 iframe 的 `init` 消息，已发送 `ydoc-sync` 和 `awareness-sync` |
| `destroyed` | `destroy()` 已调用，已发送 `disconnect` 给 iframe |

### Client 状态（`IframeBridgeProvider.connected`）

| 状态 | 含义 |
|------|------|
| `false`（初始）| 尚未收到 server 的 `ydoc-sync`，iframe 显示 "等待服务器连接..." |
| `false`（断开后）| 收到 `disconnect` 或连接中断，开始每 1 秒自动重试 `init` |
| `true` | 收到 `ydoc-sync`，可以初始化编辑器，停止重试 |

---

## 四种核心场景

### 场景 1：Server 先创建，Client 后初始化（正常流程）

```
时间轴 ──────────────────────────────►

[iframe] load iframe.html            │
       ├─ loadDrawioScript() ────────┤  draw.io 加载中...
       ├─ draw.io 就绪              │  editor 已初始化
       ├─ create Y.Doc              │
       ├─ createIframeBridgeProvider()│
       ├─ post "init" ─────────────►│
                                    │
[Parent] initBridge()               │
       ├─ create Provider ─────────┤  Webrtc 连接其他 tab
       ├─ create Server ──────────►│  server 收到 init
       │                            │  server 发送 ydoc-sync
       ├─ receive "ydoc-sync" ◄─────┘
       ├─ connected = true
       ├─ overlay 消失
       └─ bindDrawioFile()
```

**数据状态**：server 的 ydoc 为空 → client 收到空状态的 sync → draw.io 以空白画布初始化 → 双方通过 bridge 实时同步编辑内容。

**验证要点**：

- ✅ draw.io 先加载，editor 在后台已就绪
- ✅ overlay 半透明遮挡，文字 "Waiting for server..."
- ✅ connect 后 overlay 消失，bind 触发，开始协同
- ✅ 编辑内容通过 `ydoc-update` 双向同步

---

### 场景 2：Server 晚创建（模拟 serverDelay）

```
时间轴 ──────────────────────────────►

[iframe] load iframe.html            │
       ├─ loadDrawioScript() ────────┤  draw.io 加载中...
       ├─ draw.io 就绪              │  editor 已初始化
       ├─ create Y.Doc              │
       ├─ createIframeBridgeProvider()│
       ├─ overlay 半透明             │  "Waiting for server..."
       ├─ 每 1s 重试 "init" ────────►│  无人响应
       │                            │
[Parent] initBridge(room, 5000)     │
       ├─ create Provider ─────────┤  立即开始 Webrtc 同步
       │  ├─ 与其他 tab 同步中...    │
       │                            │
       ├─ setTimeout(5000)          │
       │                            │
       └─ create Server ───────────►│  5秒后 server 才创建
                                    │  server 收到最新的 init
                                    │  server 发送 ydoc-sync
       ├─ receive "ydoc-sync" ◄─────┘
       ├─ connected = true
       ├─ overlay 消失
       └─ bindDrawioFile()
```

**关键区别**：Provider（Webrtc）在 `initBridge` 第一步就创建了，server 延迟 5 秒后才创建。这意味着：

- 在 delay 的 5 秒内，ydoc 已经通过 Webrtc 与其他 tab 同步了数据
- 5 秒后 server 创建时，ydoc 可能已经有来自其他 peer 的数据
- server 发送的 `ydoc-sync` 包含的是**已同步后的数据**

**验证要点**：

- ✅ draw.io 先加载，editor 在后台可见
- ✅ provider 立即开始 Webrtc 同步（server 尚未创建）
- ✅ server 延迟创建后立即响应 client 的 `init`
- ✅ client 收到 sync 后 bind，editor 显示远端数据

**测试方式**：打开 `iframe.html`，在顶部工具栏的 **"Server Delay (ms)"** 输入框输入 `5000`，按回车。URL 自动更新为 `?serverDelay=5000`。

---

### 场景 3：Server 有数据（已有 peer 协作），Client 新加入

```
时间轴 ──────────────────────────────►

[Peer A] ──Webrtc──► [Server Y.Doc] 已有 mxfile 数据
                          │
[iframe] 新窗口打开     │
       ├─ loadDrawioScript()  draw.io 就绪
       ├─ create Y.Doc        │
       ├─ createIframeBridgeProvider()
       ├─ overlay 半透明       │ "Waiting for server..."
       ├─ 每 1s post "init" ─►│
                         │ server 发送现有 ydoc 的完整 state
       ├─ receive "ydoc-sync" ◄─┘
       ├─ connected = true
       ├─ overlay 消失
       └─ bindDrawioFile()  ← 已有数据初始化
```

**数据状态**：server 的 ydoc 非空（已有 diagram 数据）→ client 收到完整的 state update → `Y.applyUpdate` 后 client 的 ydoc 与 server 一致 → draw.io 以这些数据 bind。

**验证要点**：

- ✅ draw.io 先加载，overlay 半透明遮挡
- ✅ client 的 ydoc 在 apply sync 后与 server 完全一致
- ✅ bind 后直接显示已有 diagram，而非空白画布
- ✅ 后续编辑双向实时同步

---

### 场景 4：Provider 先同步，Server 后创建（推荐架构）

```
时间轴 ──────────────────────────────►

[Parent] initBridge(room, delay)    │
       ├─ create Y.Doc            │
       ├─ create Provider ─────────┤  Webrtc 立即连接
       │  ├─ 同步其他 tab 数据 ────►│
       │  └─ ydoc 已有数据        │
       │                            │
       ├─ setTimeout(delay)        │
       │                            │
       └─ create Server ──────────►│  delay 后创建
                                    │  server 的 ydoc 已有数据
                                    │  发送给 iframe
[iframe] load iframe.html            │
       ├─ loadDrawioScript()        │  editor 就绪
       ├─ create bridgeProvider      │
       ├─ overlay 半透明             │
       ├─ 重试 init ──────────────►│  server 收到 init
       ├─ receive ydoc-sync ◄──────┘  （含远端数据）
       ├─ connected = true
       ├─ overlay 消失
       └─ bindDrawioFile() ← 显示远端 diagram
```

**核心设计**：`initBridge` 内部**先创建 Provider（Webrtc）同步数据，后创建 Server** 绑定 iframe。这样 server 创建时 ydoc 已经可能包含其他 peer 的数据。

**验证要点**：

- ✅ Provider 总是先于 Server 创建
- ✅ delay 期间 ydoc 通过 Webrtc 同步远端数据
- ✅ server 创建时 ydoc 已有数据，sync 发送给 iframe
- ✅ iframe 以远端数据初始化 editor，而非空白画布

---

### 场景 5：Server 重建 / 切换房间（Client 断连重连）

```
时间轴 ──────────────────────────────►

[Parent] 切换房间                    │
       ├─ oldBridge.destroy()       │  发送 "disconnect"
       ├─ oldProvider.destroy()      │
       ├─ 创建新的 Y.Doc + Provider  │  新 Provider 立即 Webrtc 同步
       ├─ create Server             │  （可延迟）
                                    │
[iframe] receive "disconnect"       │
       ├─ connected = false         │
       ├─ overlay 半透明恢复        │  "Waiting for server..."
       ├─ 每 1s 重试 "init" ───────►│  新 server 收到 init
                                    │  新 server 发送 ydoc-sync
       ├─ receive "ydoc-sync" ◄─────┘
       ├─ connected = true
       ├─ overlay 消失
       └─ 以新房间数据 bind
```

**数据状态**：新 Provider 先与其他 tab 同步 → server 创建后发送已同步的数据 → client 以新数据 bind。

**验证要点**：

- ✅ `disconnect` 消息正确到达 iframe
- ✅ client 正确进入 waiting 状态并开始重试
- ✅ 新 Provider 先同步，新 server 发送同步后的数据
- ✅ 新 server 响应后 client 正常 re-connect

---

## 状态变更事件

### 当前 API

```ts
const provider = createIframeBridgeProvider(ydoc, awareness);

// 读取当前连接状态
console.log(provider.connected); // boolean

// 方式 1：专用回调（推荐，语义清晰）
const unsubConnect = provider.onConnect(() => {
  console.log("Connected to server!");
});

const unsubDisconnect = provider.onDisconnect(() => {
  console.log("Disconnected from server!");
});

// 方式 2：EventEmitter 风格（统一事件接口）
const unsubConnect2 = provider.on("connect", () => {
  console.log("Connected via on('connect')");
});

const unsubDisconnect2 = provider.on("disconnect", () => {
  console.log("Disconnected via on('disconnect')");
});

// 取消监听
unsubConnect();
unsubDisconnect();
unsubConnect2();
unsubDisconnect2();
```

### 事件触发时机

| 事件 | 触发条件 |
|------|----------|
| `connect` | 收到 `ydoc-sync` 消息，且之前 `connected === false` |
| `disconnect` | 收到 `disconnect` 消息（server destroy），或 `connected` 从 `true` 变为 `false` |

### 设计说明

提供两种订阅方式，功能等价：

- **专用回调**：`onConnect(fn) / onDisconnect(fn)` — 语义清晰，IDE 自动补全友好
- **EventEmitter**：`on('connect', fn) / on('disconnect', fn)` — 统一事件接口风格

两种方式底层共享同一组 listener 集合（`connectListeners` / `disconnectListeners`），互不冲突。返回值均为取消订阅函数。

### Server 侧状态事件

Server 侧（`createIframeBridgeServer`）同样支持状态事件：

```ts
const bridge = createIframeBridgeServer(iframe, ydoc, awareness, { undoManager });

// iframe client 已连接（收到 init 消息并发送了 sync）
bridge.onConnect(() => {
  console.log("iframe connected!");
});

// iframe client 断开（server 被 destroy，或 iframe 页面刷新）
bridge.onDisconnect(() => {
  console.log("iframe disconnected!");
});

// EventEmitter 风格同样支持
bridge.on("connect", () => { ... });
bridge.on("disconnect", () => { ... });
```

### Server 事件触发时机

| 事件 | 触发条件 |
|------|----------|
| `connect` | 收到 iframe 的 `init` 消息（client 首次连接或重试后首次连接） |
| `disconnect` | `destroy()` 被调用，iframe 重新加载导致 contentWindow 变化 |

### 两端状态对比

| | Provider (iframe 内) | Server (父页面) |
|---|------------------------|-----------------|
| 初始状态 | `connected = false` | `connected = false` |
| 连接成功 | 收到 `ydoc-sync` | 收到 `init` 消息 |
| 断开触发 | 收到 `disconnect` | `destroy()` 调用 |
| 自动重连 | 每 1 秒重试 `init` | 无（由业务方重建） |

---

## `initBridge` 架构

```ts
function initBridge(roomName: string, serverDelay: number = 0) {
  // 1. 先创建 Y.Doc + Provider（独立同步数据）
  const doc = new Y.Doc();
  const provider = new WebrtcProvider(roomName, doc, ...);
  // provider 立即开始与其他 tab 同步...

  // 2. 创建 Server（可延迟，让 provider 有时间同步）
  const createServer = () => {
    const undoManager = new Y.UndoManager(doc, ...);
    const bridgeServer = createIframeBridgeServer(ui.iframe, doc, awareness, ...);
    // server 绑定 iframe，发送 ydoc-sync
  };

  if (serverDelay > 0) {
    setTimeout(createServer, serverDelay);
  } else {
    createServer();
  }
}
```

**关键设计**：Provider 总是先于 Server 创建，且两者之间可以有时间差。这保证了：

1. 即使 server 延迟创建，ydoc 也能先与其他 tab 同步
2. server 创建后发送的 `ydoc-sync` 已经是同步后的数据
3. iframe 子页面以最新数据初始化 editor

---

## Server Delay UI

顶部工具栏新增了 **"Server Delay (ms)"** 输入框：

- 默认值 `0`：Provider 和 Server 同时创建
- 输入 `5000` 按回车：Provider 先创建，Server 延迟 5 秒后再创建
- 输入值自动同步到 URL（`?serverDelay=5000`），刷新后恢复
- 修改 delay 会重新加载 iframe 和重建 bridge

---

## Console 日志参考

**iframe 子页面 (main.ts)**：

```
[iframe 0] draw.io loading...
[iframe 0] draw.io loaded — editor ready
[iframe 0] bridgeProvider created — connected=false
[iframe 0] not connected — showing waiting overlay
[iframe 0] doBind — hiding overlay, binding draw.io
[iframe 0] draw.io bound to ydoc
```

**iframe 外层容器 (iframe-container.ts)**：

```
[iframe-container] createServer — ydoc hasData=true, diagramMap size=1
[iframe-container] server onConnect — iframe client connected
[iframe-container] server onDisconnect — iframe client disconnected
```

**server (server.ts)**：

```
[iframe-bridge server] received init — connected=false
[iframe-bridge server] sending ydoc-sync — docState bytes=247
```

---

## 测试检查清单

| 场景 | 测试步骤 | 预期结果 |
|------|----------|----------|
| Server 先创建 | 打开 `iframe.html`，delay=0 | draw.io 先加载，短暂 waiting 后 bind |
| Server 晚创建 | 在顶部输入框改 delay=5000，回车 | Provider 先同步，5s 后 server 创建，editor 显示远端数据 |
| Server 有数据 | 先在其他窗口编辑，再改 delay>0 打开 iframe | iframe 加载后直接显示已有 diagram |
| 切换房间 | 修改 Room 名称，回车 | iframe 收到 disconnect，重新 waiting，加载新房间数据 |
| 网络中断恢复 | server 暂时断开再恢复 | iframe 收到 disconnect → 重试 init → 重新连接 |
