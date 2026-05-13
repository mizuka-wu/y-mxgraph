# y‑mxgraph‑iframe‑bridge
**完整架构设计文档（v1.3）**

---
## 1. 概述
`y‑mxgraph‑iframe-bridge` 是一个 **1:1** 的 iframe 协同框架，专为将 `mxGraph` 与 `Yjs` 的 CRDT 绑定而生。
- **父容器（Host）**：唯一的数据源，负责文档同步、Awareness 管理与心跳保活。
- **子页面（Guest / iframe）**：仅做视图渲染与输入终端，通过鸭子类型代理将所有状态变更转发给父容器。

> 目标是 **简化同步、提升可靠性与性能**，同时保持实现的可维护性。

---
## 2. 设计目标
| 序号 | 目标 | 说明 |
|------|------|------|
| 1 | **1:1 强制绑定** | 每个父容器只持有一个 `iframe`，每个子页面只对应该 `iframe`。 |
| 2 | **Awareness 集中管理** | 父容器拥有 `Y.Awareness` 实例，子页面通过代理转发。 |
| 3 | **简化同步** | 只同步 `Y.Doc` 的增量更新，Awareness 独立同步。 |
| 4 | **高可靠性** | Ping/Pong 心跳检测，及时清理僵尸状态。 |
| 5 | **高性能** | 使用 `Transferable` 对象发送二进制增量；对 Awareness 广播做防抖。 |

---
## 3. 系统架构
```
┌───────────────────────────────────────────────┐
│          Parent Window (Host)                │
│                                               │
│  ┌───────────────────────────────┐             │
│  │ YMxGraphBridgeProvider        │             │
│  │   - iframe: HTMLIFrameElement│◄───────────┼─────持有单个 iframe 引用
│  │   - doc: Y.Doc                │             │
│  │   - awareness: Awareness      │             │
│  └───────────────────────────────┘             │
│                │                                │
│                ▼                                │
│  ┌───────────────────────────────┐             │
│  │ iframe.contentWindow          │             │
│  │   (子页面)                    │             │
│  │   - Y.Doc (Slave)            │             │
│  │   - AwarenessStub (Proxy)    │             │
│  └───────────────────────────────┘             │
└───────────────────────────────────────────────┘
```
- **Provider**：负责 `postMessage` 通讯、心跳、同步与 Awareness 转发。
- **Stub**：子页面的“鸭子类型”代理，内部不维护 `Awareness` 实例，仅在收到父容器的快照时更新本地 Map。

---
## 4. 消息协议
### 4.1 通用信封
```ts
interface BridgeMsg<T = any> {
  type: string;        // 消息类型
  scope: 'y-mxgraph';  // 防止与其他 postMessage 混淆
  payload: T;          // 实际内容
}
```
### 4.2 消息类型表
| 类型 | 方向 | 说明 |
|------|------|------|
| PING | 双向 | 心跳探测 |
| PONG | 双向 | 心跳响应 |
| SYNC_REQUEST | Guest → Host | 子页面请求同步 |
| SYNC_UPDATE  | 双向 | Yjs 文档增量更新（Transferable） |
| AWARENESS_PUSH | Host → Guest | 父容器下发 Awareness 快照 |
| AWARENESS_SET  | Guest → Host | 子页面请求更新状态 |
### 4.3 负载示例
```json
// Ping/Pong
{ "timestamp": 1678888888888 }

// SYNC_UPDATE
{
  "update": "<Uint8Array ArrayBuffer>"
}

// AWARENESS_PUSH
{
  "states": [
    [12345, { "user": "Alice", "cursor": {"x":100,"y":200} }]
  ]
}

// AWARENESS_SET
{
  "state": { "cursor": {"x":100,"y":200} }
}
```
---
## 5. 核心流程
### 5.1 连接与同步
1. **挂载**：子页面加载后发送 `SYNC_REQUEST`。
2. **同步**：父容器回复 `SYNC_UPDATE`（当前文档增量）。
3. **保活**：双方启动 5 s 间隔 Ping，15 s 超时判定断线。
### 5.2 Awareness 流转
1. 子页面修改状态（如移动光标） → `AwarenessStub.setLocalState()`。
2. Stub 拦截并向父容器发送 `AWARENESS_SET`（含 clientID）。
3. 父容器调用真实 `awareness.setLocalState()` 并触发 `change`。
4. 父容器监听并广播 `AWARENESS_PUSH`（快照）。
5. 子页面接收快照 → 替换本地 `Map`，触发 mxGraph 渲染。
### 5.3 断线处理
| 场景 | 处理 |
|------|------|
| 子页面失去心跳 | 父容器删除对应 Awareness 状态 |
| 父容器失去心跳 | 子页面触发 `reload` 或 UI 错误提示 |
---
## 6. 代码实现要点
### 6.1 父容器 Provider（`@y-mxgraph/iframe-bridge-provider`）
```ts
export class YMxGraphBridgeProvider {
  private iframe: HTMLIFrameElement;
  private targetWindow: WindowProxy | null = null;
  private doc: Y.Doc;
  private awareness: Awareness;
  private pingTimer: number | null = null;
  private lastPong: number = Date.now();

  constructor(iframe: HTMLIFrameElement, doc: Y.Doc) {
    this.iframe = iframe;
    this.targetWindow = iframe.contentWindow!;
    this.doc = doc;
    this.awareness = doc.awareness;

    window.addEventListener('message', this.onMessage);
    this.startPing();
  }

  private onMessage = (e: MessageEvent) => {
    if (e.source !== this.targetWindow || e.origin !== this.expectedOrigin) return;
    const msg: BridgeMsg = e.data;
    if (msg.scope !== 'y-mxgraph') return;

    switch (msg.type) {
      case 'PING':
        this.send({ type: 'PONG', scope: 'y-mxgraph', payload: msg.payload });
        break;
      case 'SYNC_REQUEST':
        this.sendSyncUpdate();
        break;
      case 'AWARENESS_SET':
        this.awareness.setLocalState(msg.payload.state);
        break;
    }
  };

  private sendSyncUpdate() {
    const update = Y.encodeStateAsUpdate(this.doc);
    this.send({
      type: 'SYNC_UPDATE',
      scope: 'y-mxgraph',
      payload: { update }
    }, '*', [update.buffer]); // Transferable
  }

  private send(msg: BridgeMsg, targetOrigin = '*', transfer?: Transferable[]) {
    this.targetWindow?.postMessage(msg, targetOrigin, transfer ?? []);
  }

  private startPing() {
    this.pingTimer = window.setInterval(() => {
      if (Date.now() - this.lastPong > 15000) { // 超时
        this.handleDisconnect();
      } else {
        this.send({ type: 'PING', scope: 'y-mxgraph', payload: { timestamp: Date.now() } });
      }
    }, 5000);
  }

  private handleDisconnect() {
    this.destroy();
    // 可在此触发 UI 提示或重连逻辑
  }

  destroy() {
    window.removeEventListener('message', this.onMessage);
    if (this.pingTimer) clearInterval(this.pingTimer);
    // 进一步清理 iframe、Awareness 等
  }
}
```
### 6.2 子页面 Awareness Stub（`@y-mxgraph/iframe-bridge-client`）
```ts
class AwarenessStub {
  private states = new Map<any, any>();
  constructor(private bridge: BridgeClient) {}

  getStates() { return this.states; }

  setLocalState(state: any) {
    // 将 clientID 也一并发送，父容器会根据 clientID 更新
    this.bridge.send({
      type: 'AWARENESS_SET',
      scope: 'y-mxgraph',
      payload: { state }
    });
  }

  // 父容器调用，更新本地快照
  _applySnapshot(states: Map<any, any>) {
    this.states = states;
    // 触发 mxGraph 渲染
  }
}
```
### 6.3 性能优化：Transferable
```ts
// 父容器发送增量
const update = Y.encodeStateAsUpdate(doc);
parentWindow.postMessage({
  type: 'SYNC_UPDATE',
  scope: 'y-mxgraph',
  payload: { update }
}, '*', [update.buffer]); // 零拷贝
```
### 6.4 防抖广播
```ts
import { debounce } from 'lodash';
class BridgeProvider {
  constructor(awareness: Awareness) {
    awareness.on('change', debounce(() => {
      const states = Array.from(awareness.getStates().entries());
      this.send({ type: 'AWARENESS_PUSH', scope: 'y-mxgraph', payload: { states } });
    }, 50)); // 防抖
  }
}
```
---
## 7. 分包策略
| 包名 | 职责 |
|------|------|
| `@y-mxgraph/core` | mxGraph 与 Y.Doc 的绑定逻辑 |
| `@y-mxgraph/iframe-bridge-provider` | 父容器端：连接、同步、Awareness |
| `@y-mxgraph/iframe-bridge-client` | 子页面端：Bridge 客户端、Awareness Stub |
---
## 8. 注意事项
1. **ClientID 无关性**：子页面 Y.Doc 的 `clientID` 与父容器无关，Yjs 会自动合并。 |
2. **Undo/Redo**：建议将 `UndoManager` 放在父容器，子页面仅触发操作。 |
3. **渲染节流**：在接收 `SYNC_UPDATE` 时使用 `requestAnimationFrame` 或 `debounce`，避免卡顿。 |
4. **Origin 校验**：务必在 `message` 处理时校验 `event.origin` 与 `event.source`。 |
5. **清理**：销毁 iframe 时，Provider 必须停止定时器、移除事件监听并清理 Awareness。 |
6. **安全**：生产环境请将 `postMessage` 的目标 origin 明确为子页面的域名，避免信息泄露。 |
---
## 9. 文档版本
- **v1.3**（2026‑05‑12）
  - 加入安全、生命周期、同步细节与错误处理改进。
- **适用场景**：`y-mxgraph` 1:1 iframe 协同、多人编辑与实时视图共享。
