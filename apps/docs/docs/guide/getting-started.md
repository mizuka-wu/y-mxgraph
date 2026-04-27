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

## 多端协作

`y-mxgraph` 本身不处理网络传输，需要搭配 **Yjs Provider** 实现多端实时协作。  
Yjs 提供了多种 Provider（WebSocket、WebRTC、IndexedDB 等），你可以根据场景自由选择。

➡️ 查看 [使用 Yjs Provider](./providers) 了解常用 Provider 介绍及 y-websocket 完整示例。

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

## 接入注意事项

### ⚠️ 初始化 XML 的 diagram id 必须稳定

`Binding` 初始化时，draw.io 会先渲染 `file.data`（即传入的 XML）中的页面。如果此时 Y.Doc **已有其他客户端的数据**（`docHasData = true`），本地 XML 中的 diagram id 与 doc 中的 id 不一致，会导致：

- draw.io 出现两个 page：一个来自本地 XML（孤立，未同步），一个来自 Y.Doc（正常同步）
- 孤立的 page 不会写入 Y.Doc，也不会同步给其他协作者

**y-mxgraph 目前不会自动清除孤立 page**，这是一个已知风险点。请务必确保初始化 XML 使用固定、稳定的 diagram id。

#### ❌ 错误示例

```ts
// 每次渲染 id 都不同，后进房间者可能看到短暂的孤立 page
const xml = `<mxfile>
  <diagram name="Page-1" id="${Math.random()}">
    ...
  </diagram>
</mxfile>`;
```

#### ✅ 正确示例

```ts
// 使用固定 id，与房间/项目绑定，保证所有客户端一致
const xml = `<mxfile>
  <diagram name="Page-1" id="page-main">
    ...
  </diagram>
</mxfile>`;
```

---

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
