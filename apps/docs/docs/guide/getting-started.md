# 快速开始

## 安装

```bash
pnpm add y-mxgraph yjs y-protocols
```

`yjs` 和 `y-protocols` 是 peer dependencies，需要单独安装。

## 基本用法

```ts
import * as Y from 'yjs';
import { Binding, doc2xml } from 'y-mxgraph';

const doc = new Y.Doc();

// draw.io App.main 回调中
App.main((app) => {
  const file = app.currentFile;

  // 检查 Y.Doc 是否已有数据（其他客户端同步过来的）
  const mxfileMap = doc.getMap('mxfile');
  const diagramMap = mxfileMap.get('diagram');
  const docHasData = diagramMap && diagramMap.size > 0;

  if (docHasData) {
    // 优先使用远端数据，确保多端一致
    file.ui.setFileData(doc2xml(doc));
    file.setData(doc2xml(doc));
  } else if (!file.data) {
    // 本地初始化
    file.data = Binding.generateFileTemplate('diagram-0');
  }

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

`Binding.generateFileTemplate(diagramId)` 提供了标准化的最小化模板，所有客户端使用相同的 diagram id，即可避免此问题。

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
import { Binding } from 'y-mxgraph';

// 使用 generateFileTemplate 生成统一起点的 XML
const xml = Binding.generateFileTemplate("room-123-main");
```

### 如何在 draw.io 中设置默认文件

协同开始前，需要确保 **所有客户端的 `currentFile.data` 是同一套 XML**。根据 draw.io 的 API 和初始化时机，常见做法有两种：

#### 方式一：通过 `#R` hash 参数（推荐，最简单）

draw.io 支持通过 URL hash 的 `#R` 前缀直接加载 raw XML。在 draw.io 脚本加载前设置：

```ts
const xml = Binding.generateFileTemplate("my-diagram");
window.location.hash = "#R" + encodeURIComponent(xml);
```

draw.io 初始化时会自动解析 hash，创建 `currentFile` 并填充 `file.data`。后续 `App.main` 回调中拿到的 `app.currentFile` 已经带有统一的数据起点。

**注意**：如果 URL 已有其他 hash 参数（如 OAuth callback），需避免冲突，建议在用 `#R` 之前清理 hash。

#### 方式二：在 `App.main` 回调中手动替换 `file.data`

如果 draw.io 已经通过其他方式完成初始化（例如用户手动打开了默认文件），可在 `App.main` 回调中覆盖 `file.data`：

```ts
const xml = Binding.generateFileTemplate("my-diagram");

App.main(
  (ui) => {
    const file = ui.currentFile;

    if (file && file.data !== xml) {
      // 替换 file.data 为统一起点
      file.data = xml;
      // 通知 draw.io 重新解析页面（具体 API 以您使用的 draw.io 版本为准）
      // e.g. file.ui.setCurrentFile(file) 或 file.ui.editor.setModified(true)
      file.ui.setCurrentFile(file);
    }

    const binding = new Binding(file, { doc });
  },
  // UI 工厂函数（如有需要）
);
```

**关键点**：

- `file.data` 必须在 `new Binding()` 之前完成替换
- 替换后需要通知 draw.io 重新解析页面（具体方法以你使用的 draw.io 版本 API 为准）
- 如果 `currentFile` 尚未创建，可通过监听 `editor` 的 `fileLoaded` 事件等待时机

两种方式的核心目标一致：**确保所有客户端首次 `new Binding(file, { doc })` 时，`file.data` 的 diagram id 完全相同**。

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
