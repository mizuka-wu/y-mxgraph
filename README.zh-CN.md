# y-mxgraph

[English](./README.md)

Yjs 与 draw.io (mxGraph) 文档的双向绑定库，让 draw.io 支持实时多人协同编辑。

## 特性

- **双向绑定** draw.io 文件与 Y.Doc
- **实时协作** 支持 y-webrtc、y-websocket 及任意 Yjs Provider
- **iframe 桥接** — 因 draw.io 常被嵌入 `<iframe>`（如 CMS、白板、低代码平台），`y-mxgraph` 内置了基于 `postMessage` 的 iframe 桥接模块（`y-mxgraph/iframe-bridge`），无需额外依赖即可在父子窗口间同步 Y.Doc 与 Awareness
- **撤销/重做** 集成 Y.UndoManager
- **协同光标** 基于 y-protocols Awareness 渲染远端光标与选区
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

  const binding = new Binding(app.currentFile, {
    doc,
    // initialContent 初始化策略（默认 'replace'）：
    //   'replace'      : Y.Doc 优先；用 doc XML 覆盖 file UI
    //   'merge-remote' : 按 diagram id 取并集，冲突以 doc 为准
    //   'merge-client' : 按 diagram id 取并集，冲突以 file 为准
    initialContent: 'replace',
  });

  window.addEventListener('beforeunload', () => binding.destroy());
});
```

## 文档

- [快速开始](https://mizuka-wu.github.io/y-mxgraph/guide/getting-started)
- [API 参考](https://mizuka-wu.github.io/y-mxgraph/api/)
- [实现原理](https://mizuka-wu.github.io/y-mxgraph/guide/architecture)

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

# 启动 Demo (WebRTC 单页模式)
pnpm --filter @y-mxgraph/demo dev

# iframe 模式（父页托管两个 iframe；每个 iframe 拥有独立的 Y.Doc + WebRTC Provider，
# 通过 y-mxgraph 内置的 iframe bridge 与父页同步）
# 访问 http://localhost:5173/iframe-mode.html

# 启动 WebSocket 服务器 Demo (支持文件持久化)
pnpm --filter @y-mxgraph/ws-demo server  # 启动服务器 (端口 1234)
pnpm --filter @y-mxgraph/ws-demo dev     # 启动客户端 (端口 5174)

# 启动文档
pnpm --filter @y-mxgraph/docs dev
```

### 使用 iframe bridge

因 draw.io 常被嵌入 `<iframe>` 使用（如 CMS、白板、低代码平台等场景），`y-mxgraph` 提供了开箱即用的 **iframe 桥接模块**，无需自行实现 `postMessage` 协议。

### 父页（Host）

```ts
import { YMxGraphBridgeProvider } from 'y-mxgraph/iframe-bridge/provider';

const doc = new Y.Doc();
const provider = new WebrtcProvider('my-room', doc);

const bridge = new YMxGraphBridgeProvider(iframeElement, doc, {
  awareness: provider.awareness,
});
```

### iframe 内（Guest）

```ts
import { YMxGraphBridgeClient } from 'y-mxgraph/iframe-bridge/client';

const bridge = new YMxGraphBridgeClient();
// bridge.doc 与 bridge.awareness 会自动与父页保持同步

const binding = new Binding(file, {
  doc: bridge.doc,
  awareness: bridge.awareness,
  // initialContent 初始化策略（默认 'replace'）：
  //   'replace'      : Y.Doc 优先；用 doc XML 覆盖 file UI
  //   'merge-remote' : 按 diagram id 取并集，冲突以 doc 为准
  //   'merge-client' : 按 diagram id 取并集，冲突以 file 为准
  initialContent: 'replace',
});
```

## License

MIT
