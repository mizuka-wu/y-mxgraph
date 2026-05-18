# iframe-bridge 场景文档

## 概述

iframe-bridge 实现了标准的 server-client 协同模式：

- **Server**（父页面 `iframe-container.ts`）：持有 `Y.Doc` + `WebrtcProvider`，负责网络同步和 iframe 桥接
- **Client**（子页面 iframe 内）：通过 `createIframeBridgeProvider` 连接到 server，本地也有独立的 `Y.Doc`

核心设计：**Client 必须先连接上 Server 才能初始化编辑器**，未连接时处于 loading 状态。

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

[Parent] createIframeBridgeServer() ─┐
                                    │  server 就绪
[iframe] load iframe.html            │
       ├─ create Y.Doc              │
       ├─ createIframeBridgeProvider()│
       ├─ post "init" ─────────────►│  server 收到 init
                                    │  server 发送 ydoc-sync
       ├─ receive "ydoc-sync" ◄─────┘
       ├─ connected = true
       ├─ trigger onConnect
       └─ loadDrawioScript()
```

**数据状态**：server 的 ydoc 为空 → client 的 ydoc 也为空 → draw.io 初始化后默认空白画布 → 双方通过 bridge 实时同步编辑内容。

**验证要点**：

- ✅ client 收到 `ydoc-sync` 后 `connected` 变为 `true`
- ✅ `onConnect` 回调触发，开始加载 draw.io
- ✅ 编辑内容通过 `ydoc-update` 双向同步

---

### 场景 2：Server 晚创建（模拟 serverDelay）

```
时间轴 ──────────────────────────────►

[iframe] load iframe.html            │
       ├─ create Y.Doc              │
       ├─ createIframeBridgeProvider()│
       ├─ post "init" ─────────────►│  无人响应（server 还未创建）
       ├─ 显示 "Waiting for server..." │
       ├─ 每 1s 重试 "init"         │
                                    │
[Parent] setTimeout(5000)           │
       └─ initBridge(room) ─────────┤  5秒后 server 才创建
                                    │  server 收到最新的 init
                                    │  server 发送 ydoc-sync
       ├─ receive "ydoc-sync" ◄─────┘
       ├─ connected = true
       └─ loadDrawioScript()
```

**数据状态**：server 的 ydoc 为空（新建）→ client 收到空状态的 sync → 正常初始化 → 双方同步。

**验证要点**：

- ✅ client 在 server 创建前持续显示 waiting
- ✅ server 创建后立即响应 client 的 `init`
- ✅ client 收到 sync 后正常进入编辑器

**测试 URL**：`http://localhost:5174/iframe.html?serverDelay=5000`

---

### 场景 3：Server 有数据（已有 peer 协作），Client 新加入

```
时间轴 ──────────────────────────────►

[Peer A] ──Webrtc──► [Server Y.Doc] 已有 mxfile 数据
                          │
[iframe] 新窗口打开     │
       ├─ create Y.Doc  │
       ├─ createIframeBridgeProvider()
       ├─ post "init" ─►│
                         │ server 发送现有 ydoc 的完整 state
       ├─ receive "ydoc-sync" ◄─┘
       ├─ connected = true
       └─ loadDrawioScript() 并以现有数据初始化
```

**数据状态**：server 的 ydoc 非空（已有 diagram 数据）→ client 收到完整的 state update → `Y.applyUpdate` 后 client 的 ydoc 与 server 一致 → draw.io 以这些数据初始化。

**验证要点**：

- ✅ client 的 ydoc 在 apply sync 后与 server 完全一致
- ✅ draw.io 加载后直接显示已有 diagram，而非空白画布
- ✅ 后续编辑双向实时同步

---

### 场景 4：Client 和 Server 都有本地数据（需要合并）

```
时间轴 ──────────────────────────────►

[Parent] initBridge() 创建 server    │
       └─ server Y.Doc 有旧数据     │  来自 localStorage / 缓存
                                    │
[iframe] 同时有本地缓存数据           │
       ├─ create Y.Doc (有旧数据)    │
       ├─ createIframeBridgeProvider()
       ├─ post "init" ─────────────►│
                                    │ server 发送 ydoc-sync
                                    │ （server 的完整 state）
       ├─ receive "ydoc-sync" ◄─────┘
       ├─ Y.applyUpdate(clientYdoc, serverState)
       │   → Yjs CRDT 自动合并
       ├─ connected = true
       └─ loadDrawioScript()
```

**数据状态**：

- Server Y.Doc：本地旧数据 A
- Client Y.Doc：本地旧数据 B
- 收到 sync 后：`Y.applyUpdate(clientYdoc, serverState)` → Yjs 的 CRDT 机制自动合并 A + B
- 合并结果：双方最终一致

**验证要点**：

- ✅ `Y.applyUpdate` 不会覆盖 client 数据，而是 CRDT 合并
- ✅ 最终 server 和 client 的 ydoc state 一致
- ⚠️ 如果 A 和 B 在相同位置有冲突内容，Yjs 保留两个版本（通常表现为两个 diagram），这是 CRDT 的预期行为

---

### 场景 5：Server 重建 / 切换房间（Client 断连重连）

```
时间轴 ──────────────────────────────►

[Parent] 切换房间                    │
       ├─ oldBridge.destroy()       │  发送 "disconnect"
       ├─ oldProvider.destroy()      │
       ├─ 创建新的 Y.Doc + Provider  │
       └─ createIframeBridgeServer() │
                                    │
[iframe] receive "disconnect"       │
       ├─ connected = false         │
       ├─ 显示 "Waiting for server..." │
       ├─ 每 1s 重试 "init" ───────►│  新 server 收到 init
                                    │  新 server 发送 ydoc-sync
       ├─ receive "ydoc-sync" ◄─────┘
       ├─ connected = true
       └─ 编辑器以新房间数据刷新
```

**数据状态**：新 server 可能有不同房间的数据 → client 收到 sync 后刷新 ydoc → draw.io 数据刷新。

**验证要点**：

- ✅ `disconnect` 消息正确到达 iframe
- ✅ client 正确进入 waiting 状态并开始重试
- ✅ 新 server 响应后 client 正常 re-connect
- ⚠️ draw.io 需要重新绑定或刷新以加载新数据（当前实现中 `bindDrawioFile` 会处理）

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

## 测试检查清单

| 场景 | 测试步骤 | 预期结果 |
|------|----------|----------|
| Server 先创建 | 正常打开 `iframe.html` | iframe 短暂 waiting 后加载编辑器 |
| Server 晚创建 | `iframe.html?serverDelay=5000` | iframe waiting 5s 后加载编辑器 |
| Server 有数据 | 先在其他窗口编辑，再打开 iframe | iframe 加载后直接显示已有 diagram |
| 切换房间 | 在 iframe.html 修改房间名 | iframe 收到 disconnect，重新 waiting，然后加载新数据 |
| 网络中断恢复 | server 暂时断开再恢复 | iframe 收到 disconnect → 重试 init → 重新连接 |
