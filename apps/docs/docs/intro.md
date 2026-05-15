# y-mxgraph 项目推介

## 让 draw.io 拥有真正的实时协作能力

`y-mxgraph` 是 **Yjs × draw.io (mxGraph)** 的实时协同绑定库。它将全球最流行的开源绘图工具 draw.io 与业界领先的 CRDT 协同框架 Yjs 深度结合，让你无需改动 draw.io 核心代码，就能赋予其多人实时协作编辑的能力。

---

## 为什么需要 y-mxgraph？

draw.io 本身确实内置了一套协同系统，但它**强依赖自研的 WebSocket 服务端**，部署和接入成本极高。而 Yjs 作为成熟的 CRDT（无冲突复制数据类型）库，已经解决了分布式协同的核心难题：

- **无需中心服务器** —— WebRTC P2P 即可跑通多人协作
- **自动冲突合并** —— 离线编辑后联网自动同步，无需锁机制
- **丰富的生态** —— WebSocket、IndexedDB、Hocuspocus 等 Provider 即插即用

`y-mxgraph` 作为连接层，让 draw.io **复用自身的协同 UI 和 diff 算法**，但将数据传输层替换为 Yjs，从而兼得 draw.io 的绘图能力和 Yjs 的协同灵活性。

---

## 五大核心亮点

### 1. 双向增量同步

不是全量替换，而是精确到 cell 级别的增量同步。本地编辑通过 draw.io 原生 `diffPages()` 生成 patch，转存到 Y.Doc；远端变更通过 Yjs 事件反转为 draw.io patch，调用 `file.patch()` 注入。冲突由 Yjs CRDT 自动合并，业务方零干预。

### 2. 协同光标与选区

基于 `y-protocols/awareness` 协议，开箱即支持：

- **实时光标** —— 显示远端用户鼠标位置，支持节流、页面隔离、离开自动隐藏
- **选区高亮** —— 同步显示其他用户选中的图形，增量更新，低流量消耗
- **用户信息** —— 可配置用户名和颜色字段

### 3. iframe 隔离部署

通过 `@y-mxgraph/iframe-bridge` 包，draw.io 可以运行在完全沙盒化的 iframe 中：

- **网络隔离** —— iframe 无需任何网络权限，所有同步由父页面代理
- **跨域安全** —— 适用于需要将 draw.io 与主站严格隔离的场景
- **Undo/Redo 穿透** —— 撤销/重做通过 Server 端共享 UndoManager 统一执行，多 iframe 状态完全一致

### 4. 灵活的初始内容策略

新用户加入时，支持三种数据对齐策略：

| 策略 | 行为 |
|------|------|
| `replace`（默认） | Y.Doc 非空则用远端数据覆盖本地 |
| `merge-remote` | 按 diagram id 取并集，冲突以远端为准 |
| `merge-client` | 按 diagram id 取并集，冲突以本地为准 |

配合 `Binding.generateFileTemplate()` 生成统一起点的 XML，彻底避免多端 diagram id 不一致导致的孤立页面问题。

### 5. 极低的接入成本

```ts
import * as Y from 'yjs';
import { Binding } from 'y-mxgraph';

const doc = new Y.Doc();

App.main((app) => {
  const binding = new Binding(app.currentFile, { doc });
});
```

只需几行代码即可建立绑定。Provider 选择、Awareness 配置、UndoManager 接入均为可选增强，按需渐进。

---

## 典型应用场景

- **在线白板 / 流程图工具** —— 多人同时编辑架构图、流程图、UML
- **文档内嵌绘图** —— 在 Wiki、知识库中嵌入可协同编辑的图表
- **低代码平台** —— 可视化编排页面的多人协作设计
- **教育场景** —— 教师与学生实时协作绘制思维导图

---

## 技术架构

```text
draw.io (mxGraph)
    │
    ├─ 本地变更 → file.ui.diffPages() → y-mxgraph patch → Y.Doc
    │
    └─ 远端变更 ← Y.Doc → y-mxgraph patch → file.patch() ←
                           │
                    Yjs Provider (y-webrtc / y-websocket / ...)
                           │
                    ┌──────┴──────┐
                    ▼             ▼
                 客户端 A      客户端 B
```

y-mxgraph 不替换 draw.io 的绘图引擎，也不替换 Yjs 的协同网络层。它做的是**精准的协议转换** —— 在 draw.io 的原生协同 API 和 Yjs 的数据结构之间搭起一座桥梁。

---

## 项目生态

| 包 | 说明 |
|---|---|
| `y-mxgraph` | 核心绑定库，导出 `Binding`、`xml2ydoc`、`ydoc2xml`、`LOCAL_ORIGIN` |
| `@y-mxgraph/iframe-bridge` | iframe 隔离场景专用，含 `createIframeBridgeServer` / `createIframeBridgeProvider` |
| `@y-mxgraph/demo` | WebRTC 实时协作 Demo（含 Playwright E2E 测试） |
| `@y-mxgraph/ws-demo` | WebSocket 服务器 Demo（支持文件持久化） |
| `@y-mxgraph/docs` | VitePress 文档站点 |

---

## 立即开始

```bash
pnpm add y-mxgraph yjs y-protocols
```

👉 [快速开始指南](/guide/getting-started) —— 5 分钟跑通首个协同编辑示例  
👉 [iframe Bridge 指南](/guide/iframe-bridge) —— 隔离部署的最佳实践  
👉 [实现原理](/guide/architecture) —— 深入了解 patch、快照与冲突解决机制

---

**开源协议**：MIT
