# @y-mxgraph/ws-demo

基于 y-websocket 的 y-mxgraph 协作演示，使用中心化 WebSocket 服务器 + 文件系统持久化。

> **仅用于本地开发**，不部署到 GitHub Pages。

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 启动 WebSocket 服务器

```bash
pnpm --filter @y-mxgraph/ws-demo server
```

服务器默认监听 `ws://localhost:1234`，文档数据持久化到 `yjs-docs/` 目录。

### 3. 启动客户端（另一个终端）

```bash
pnpm --filter @y-mxgraph/ws-demo dev
```

浏览器访问 `http://localhost:5174`。

## 工作原理

```text
┌──────────┐     WebSocket     ┌───────────────────┐
│ Client A ├───────────────────┤                   │
└──────────┘                   │  y-websocket      │
                               │  server (:1234)   │──── yjs-docs/
┌──────────┐     WebSocket     │                   │     (文件系统持久化)
│ Client B ├───────────────────┤                   │
└──────────┘                   └───────────────────┘
```

- 所有客户端通过 WebSocket 连接到同一个服务器
- Room 名称作为 document ID，相同 room 的客户端共享同一个 Y.Doc
- 服务器端通过文件系统持久化文档状态
- 新 room 自动创建空文档，客户端首次编辑时初始化
- 客户端断开后数据保留，重新连接时恢复

## 与 demo 的区别

| 特性 | demo (WebRTC) | ws-demo (WebSocket) |
| --- | --- | --- |
| 连接方式 | P2P (y-webrtc) | 中心化 (y-websocket) |
| 需要服务器 | 仅信令服务器 | WebSocket 服务器 |
| 数据持久化 | 无 | 文件系统 |
| 初始文件 | `#R` hash 注入 | 服务器自动管理 |
| 适用场景 | 公网演示 | 企业内部部署 |

## 配置

编辑 `src/config.ts` 可修改：

- `WS_URL` — WebSocket 服务器地址（默认 `ws://localhost:1234`）
- `DEFAULT_ROOM` — 默认房间名
- `DRAWIO_VERSIONS` — draw.io 版本列表

服务器端环境变量：

- `PORT` — 服务器端口（默认 1234）
- `HOST` — 监听地址（默认 localhost）

## URL 参数

| 参数 | 说明 | 示例 |
| --- | --- | --- |
| `version` | draw.io 版本 | `?version=29.7.9` |
| `room` | 协作房间名（= 服务器端 docName） | `?room=my-project` |
| `lang` | 界面语言（en / zh） | `?lang=zh` |
