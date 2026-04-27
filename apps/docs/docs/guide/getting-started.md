# 快速开始

## 安装

```bash
pnpm add y-mxgraph yjs y-protocols
```

`yjs` 和 `y-protocols` 是 peer dependencies，需要单独安装。

## 基本用法

```ts
import * as Y from 'yjs';
import { Binding } from 'y-mxgraph';

const doc = new Y.Doc();

// draw.io App.main 回调中
App.main((app) => {
  const file = app.currentFile;

  const binding = new Binding(file, { doc });
});
```

## 配合 y-webrtc 实现多端协作

```ts
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { Binding, LOCAL_ORIGIN } from 'y-mxgraph';

const doc = new Y.Doc();
const provider = new WebrtcProvider('my-room', doc, {
  signaling: ['wss://signaling.yjs.dev'],
});

App.main((app) => {
  const file = app.currentFile;

  const undoManager = new Y.UndoManager(doc, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
  });

  const binding = new Binding(file, {
    doc,
    awareness: provider.awareness,
    undoManager,
  });
});
```

## 销毁绑定

组件卸载或切换文件时，调用 `destroy()` 方法清理监听器：

```ts
// React 示例
useEffect(() => {
  const binding = new Binding(file, { doc, awareness });
  return () => binding.destroy(true); // 组件卸载时完全清理
}, [file, doc]);

// Vue 示例
const binding = new Binding(file, { doc, awareness });
onUnmounted(() => {
  binding.destroy(true);
});
```

## 本地开发

```bash
# 克隆仓库
git clone https://github.com/mizuka-wu/y-mxgraph.git
cd y-mxgraph

# 安装依赖
pnpm install

# 启动 demo
pnpm --filter @y-mxgraph/demo dev

# 启动文档
pnpm --filter @y-mxgraph/docs dev
```
