# y-mxgraph

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/mizuka-wu/y-mxgraph)

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

`@y-mxgraph/iframe-bridge` 支持在 iframe 隔离环境中进行协同编辑。**Server**（父页面）管理网络连接（y-webrtc、y-websocket 等），通过 `postMessage` 将 Y.Doc 和 Awareness 同步到 **Provider**（iframe 子页面）。

```text
┌─────────────────────────────────────────────────────────────┐
│  Server（父页面）                                            │
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

### 完整示例

#### 1. 父页面（Server）

```html
<!DOCTYPE html>
<html>
<head>
  <title>iframe Bridge Server</title>
</head>
<body>
  <div>
    <label>用户名: <input id="username" value="Alice" /></label>
    <label>颜色: <input id="usercolor" type="color" value="#2563eb" /></label>
    <button id="undo-btn" disabled>撤销</button>
    <button id="redo-btn" disabled>重做</button>
    <span id="status">未连接</span>
  </div>
  <iframe id="editor-iframe" src="./editor.html" style="width:100%;height:80vh;border:1px solid #ccc"></iframe>
  
  <script type="module">
    import * as Y from 'yjs';
    import { WebrtcProvider } from 'y-webrtc';
    import { LOCAL_ORIGIN } from 'y-mxgraph';
    import { IFRAME_ORIGIN } from 'y-mxgraph/iframe-bridge';
    import { createIframeBridgeServer } from 'y-mxgraph/iframe-bridge/server';

    const iframe = document.getElementById('editor-iframe');
    const statusEl = document.getElementById('status');
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');

    // 1. 创建 Y.Doc 和网络 Provider
    const doc = new Y.Doc();
    const provider = new WebrtcProvider('my-collab-room', doc);
    const awareness = provider.awareness;

    // 2. 在父容器 awareness 上设置用户信息（自动同步到 iframe）
    const updateUserInfo = () => {
      awareness.setLocalState({
        user: {
          name: document.getElementById('username').value,
          color: document.getElementById('usercolor').value,
        }
      });
    };
    updateUserInfo();
    document.getElementById('username').onchange = updateUserInfo;
    document.getElementById('usercolor').onchange = updateUserInfo;

    // 3. 创建支持跨 iframe 的 UndoManager
    const undoManager = new Y.UndoManager(doc, {
      trackedOrigins: new Set([LOCAL_ORIGIN, IFRAME_ORIGIN]),
    });

    // 4. 创建 bridge server
    const bridge = createIframeBridgeServer(iframe, doc, awareness, {
      undoManager,
      debug: true, // 启用控制台日志
    });

    // 5. 监听连接状态
    bridge.onConnect(() => {
      statusEl.textContent = '已连接';
      statusEl.style.color = 'green';
    });
    bridge.onDisconnect(() => {
      statusEl.textContent = '未连接';
      statusEl.style.color = 'red';
    });

    // 6. 监听在线人数
    awareness.on('update', () => {
      const count = awareness.getStates().size;
      statusEl.textContent = `已连接 (${count} 人在线)`;
    });

    // 7. 从父页面执行撤销/重做
    const updateUndoRedoButtons = () => {
      undoBtn.disabled = !undoManager.canUndo();
      redoBtn.disabled = !undoManager.canRedo();
    };
    undoManager.on('stack-item-added', updateUndoRedoButtons);
    undoManager.on('stack-item-popped', updateUndoRedoButtons);
    undoManager.on('stack-cleared', updateUndoRedoButtons);
    
    undoBtn.onclick = () => undoManager.canUndo() && undoManager.undo();
    redoBtn.onclick = () => undoManager.canRedo() && undoManager.redo();

    // 8. 页面卸载时清理
    window.addEventListener('beforeunload', () => {
      bridge.destroy();
      provider.disconnect();
      provider.destroy();
      undoManager.destroy();
    });
  </script>
</body>
</html>
```

#### 2. iframe 子页面（Provider）

```html
<!DOCTYPE html>
<html>
<head>
  <title>draw.io 编辑器</title>
</head>
<body>
  <div id="drawio-container"></div>
  
  <script type="module">
    import * as Y from 'yjs';
    import { Binding, LOCAL_ORIGIN } from 'y-mxgraph';
    import { createIframeBridgeProvider } from 'y-mxgraph/iframe-bridge/provider';

    // 1. 创建本地 Y.Doc（不需要网络 Provider）
    const doc = new Y.Doc();

    // 2. 创建 iframe bridge provider
    //    - 不需要外部 awareness，provider 会创建自己的 AwarenessLike
    //    - 自动通过 postMessage 与父页面同步
    const bridge = createIframeBridgeProvider(doc, {
      debug: true, // 启用控制台日志
    });

    // 3. 监听与父页面的连接状态
    bridge.onConnect(() => {
      console.log('[iframe] 已连接到父页面 bridge');
    });
    bridge.onDisconnect(() => {
      console.log('[iframe] 已断开与父页面 bridge 的连接');
    });

    // 4. 初始化 draw.io
    App.main((app) => {
      const file = app.currentFile;

      // 5. 使用 bridge awareness 创建 binding
      const binding = new Binding(file, {
        doc,
        awareness: bridge.awareness,
      });

      // 6. 接管 draw.io 的 undo manager，使其通过父页面执行
      const cleanupUndo = bridge.takeoverUndoManager(file);

      // 7. 页面卸载时清理
      window.addEventListener('beforeunload', () => {
        binding.destroy();
        cleanupUndo();
        bridge.destroy();
      });
    });
  </script>
</body>
</html>
```

### 核心特性

- **自动同步**: Y.Doc 和 Awareness 状态在父页面和 iframe 之间自动同步
- **用户信息传播**: 在父页面 awareness 上设置用户信息，iframe 自动接收
- **跨 iframe 撤销/重做**: 父页面的 UndoManager 控制所有 iframe 的撤销/重做
- **连接生命周期**: `onConnect`/`onDisconnect` 回调用于状态监控
- **调试模式**: 设置 `debug: true` 记录所有 postMessage 通信

### API 参考

#### `createIframeBridgeServer(iframe, ydoc, awareness, options?)`

在父页面创建 bridge server。

**参数：**
- `iframe: HTMLIFrameElement` - 目标 iframe 元素
- `ydoc: Y.Doc` - 共享的 Yjs 文档
- `awareness: Awareness` - Awareness 实例（通常来自 provider.awareness）
- `options.undoManager?: Y.UndoManager` - 可选的 UndoManager，用于跨 iframe 撤销
- `options.debug?: boolean` - 启用调试日志（默认：false）

**返回：** `IframeBridgeServer`，包含：
- `connected: boolean` - 当前连接状态
- `onConnect(fn)` / `onDisconnect(fn)` - 连接生命周期回调
- `destroy()` - 清理所有监听器

#### `createIframeBridgeProvider(ydoc, options?)`

在 iframe 内创建 bridge provider。

**参数：**
- `ydoc: Y.Doc` - 本地 Yjs 文档
- `options.awareness?: Awareness` - 可选的外部 Awareness（省略则创建内部 AwarenessLike）
- `options.debug?: boolean` - 启用调试日志（默认：false）

**返回：** `IframeBridgeProvider`，包含：
- `connected: boolean` - 与父页面的连接状态
- `awareness: Awareness` - Awareness 实例（用于 Binding）
- `serverClientId: number | null` - 父页面的 client ID
- `setLocalFields(fields)` - 更新本地用户字段
- `takeoverUndoManager(file)` - 接管 draw.io 的 undo/redo 使其通过父页面执行
- `onConnect(fn)` / `onDisconnect(fn)` - 连接生命周期回调
- `destroy()` - 清理所有监听器

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
