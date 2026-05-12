# @y-mxgraph/iframe-bridge

> 1:1 iframe collaboration bridge for [`y-mxgraph`](https://github.com/mizuka-wu/y-mxgraph).

实现了《y-mxgraph-iframe-bridge》v1.3 设计文档中的协议：父容器（Host）作为唯一数据源，通过 `postMessage` 把 `Y.Doc` 增量更新和 `Awareness` 快照转发到一个对应的 `iframe`（Guest）。子页面只负责渲染，不持有真实的 `Awareness` 实例。

## 安装

```bash
pnpm add @y-mxgraph/iframe-bridge yjs y-protocols
```

`yjs` 和 `y-protocols` 是 peer dependencies。

## 父容器（Host）

```ts
import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { YMxGraphBridgeProvider } from "@y-mxgraph/iframe-bridge";

const doc = new Y.Doc();
// Awareness 由外部的 Yjs Provider 管理（y-webrtc / y-websocket / ...）。
// 注意：`Y.Doc` 本身不持有 awareness，使用 `provider.awareness`。
const rtc = new WebrtcProvider("room-1", doc);

const iframe = document.querySelector("iframe#editor") as HTMLIFrameElement;
const provider = new YMxGraphBridgeProvider(iframe, doc, {
  awareness: rtc.awareness,
  // 生产环境建议指定为 iframe 的真实 origin
  targetOrigin: "https://app.example.com",
  expectedOrigin: "https://app.example.com",
  onDisconnect: () => {
    // 子页面失联 15s 后触发；这里可以提示用户或重载 iframe
    iframe.src = iframe.src;
  },
});

provider.on("connected", () => console.log("iframe online"));
provider.on("disconnected", () => console.log("iframe offline"));

// 卸载
window.addEventListener("beforeunload", () => provider.destroy());
```

## 子页面（Guest）

```ts
import { YMxGraphBridgeClient } from "@y-mxgraph/iframe-bridge";
import { Binding } from "y-mxgraph";

const bridge = new YMxGraphBridgeClient({
  expectedOrigin: "https://parent.example.com",
});

// bridge.awareness 是 AwarenessStub，公开 API 与 y-protocols 的 Awareness 一致，
// 可以直接传给 y-mxgraph 的 Binding。
bridge.once("synced", () => {
  // file 来自 draw.io 的 App.main 回调
  new Binding(file, { doc: bridge.doc, awareness: bridge.awareness });
});
```

## 消息协议

详见 `y-mxgraph-iframe-bridge-doc.md`。所有消息都包含 `scope: "y-mxgraph"`。

| 类型 | 方向 | 说明 |
|---|---|---|
| `PING` / `PONG` | 双向 | 5s 心跳，15s 超时判定断线 |
| `SYNC_REQUEST` | Guest → Host | 子页面请求同步（携带 stateVector） |
| `SYNC_UPDATE` | 双向 | Yjs 增量，使用 Transferable 零拷贝传输 |
| `AWARENESS_PUSH` | Host → Guest | 全量 Awareness 快照（默认 50ms 防抖） |
| `AWARENESS_SET` | Guest → Host | 子页面要求父端设置 local state |

## 设计要点

- **1:1 强绑定**：每个 Provider 只绑定一个 iframe，每个 Client 只对话于一个 parent。
- **回环保护**：通过 `BRIDGE_REMOTE_ORIGIN` 作为 `Y.applyUpdate` 的 origin，避免循环回发。
- **Origin 校验**：`expectedOrigin` 可校验入站消息，`targetOrigin` 可锁定出站目标。
- **Awareness 集中**：真实 `Awareness` 始终在父容器；子页面 `AwarenessStub` 仅维护快照副本。
- **Transferable**：`SYNC_UPDATE` 通过 `postMessage` 的 transferable 列表零拷贝传递 `ArrayBuffer`。
- **防抖广播**：`AWARENESS_PUSH` 默认 50ms 防抖，可通过 `awarenessDebounce` 配置。

## License

MIT
