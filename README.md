# y-mxgraph

[English](README.en.md) | [中文](README.md)

将 draw.io（mxGraph）文档与 Yjs 协同数据结构进行绑定与互相转换的工具库，并附带可运行的 Demo（以 `src/main.ts` 为入口）。

- 入口（库）：`src/yjs/index.ts`
- 入口（Demo）：`src/main.ts`
- Demo 页面：`index.html`

本库提供：

- 将 draw.io 原生 `mxfile`/`mxGraphModel` XML 转为 `Y.Doc` 的能力（`xml2doc`）
- 将 `Y.Doc` 还原为 draw.io XML 的能力（`doc2xml`）
- 将 draw.io 的编辑器文件对象与 `Y.Doc` 进行双向绑定（`bindDrawioFile`），可选接入 `awareness` 实现协作游标/选区渲染

> 本仓库已包含 GitHub Actions：
>
> - Pages 部署 Demo（`.github/workflows/pages.yml`）
> - 库构建（`.github/workflows/lib-build.yml`）

## 特性

- 将 draw.io 文档映射为 Yjs 结构，增量同步、冲突自动合并
- 支持 `mxfile` 多页面与 `mxGraphModel` 单模型两种 XML 形态
- 简洁 API：`xml2doc`、`doc2xml`、`bindDrawioFile`
- 可选协作能力（基于 `y-protocols/awareness` 与 `y-webrtc`）

## 目录结构（关键部分）

```text
.
├─ index.html                 # Demo 页面，加载 draw.io 资源并注入 main.ts
├─ src/
│  ├─ main.ts                # Demo 入口（建议阅读）
│  ├─ bootstrap.js           # 与 draw.io 集成的启动脚本
│  └─ yjs/
│     ├─ index.ts            # 库对外入口：export bindDrawioFile, xml2doc, doc2xml
│     ├─ binding/            # 绑定层（patch/collaborator 等）
│     ├─ models/             # Yjs 层的数据模型
│     ├─ helper/             # XML/工具函数
│     └─ transformer/        # xml2doc / doc2xml 实现
├─ vite.lib.config.ts        # 库打包配置（ES/CJS/UMD）
└─ .github/workflows/
   ├─ pages.yml              # 构建并部署 Demo 到 GitHub Pages
   └─ lib-build.yml          # 构建库产物并上传 artifact
```

## 快速开始（本地）

- Node.js 20+
- pnpm 10+

```bash
pnpm install
# 运行开发服务器（如需，仅供快速查看）
pnpm dev

# 构建 Demo（用于静态部署）
pnpm vite build --base "/<你的仓库名>/"

# 构建库（产物在 dist/）
pnpm vite build --config vite.lib.config.ts
```

开发服务器默认地址：`http://localhost:5173/y-mxgraph/`。

> GitHub Pages 部署路径通常是 `https://<user>.github.io/<repo>/`，因此 Demo 构建时需要 `--base "/<repo>/"`。
> 如果你的仓库就是 `<user>.github.io` 或使用自定义域名，可以将 base 设为 `/`。

## 在线 Demo（GitHub Pages）

仓库已内置 Pages 工作流。推送到主分支（`master`）后会自动构建并部署。首次需在仓库 Settings -> Pages 中确认 Source 为 GitHub Actions。

- `index.html` 中对 draw.io 资源与本地源码的路径均已改为相对路径（`./drawio/...`、`./src/...`），以兼容 `/<repo>/` 子路径。
- `.github/workflows/pages.yml` 开启了递归 submodules，以确保 `public/drawio/` 子模块也会被拉取。

## Demo 说明（`src/main.ts`）

Demo 展示了如何：

- 载入一个最小的 demo `mxfile` XML
- 通过 `bindDrawioFile` 将 draw.io 的 `file`（编辑器内部对象）与 Yjs `doc` 绑定
- 使用 `y-webrtc` 创建一个协作房间（示例中未配置信令服务器，适合本地单人/对照调试）
- 将图模型变更序列化为 XML，与 `Y.Doc` 生成的 XML 做对比并在控制台可视化 diff

关键片段（伪代码示意）：

```ts
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { bindDrawioFile, doc2xml } from './yjs';

const doc = new Y.Doc();
const roomName = 'demo';
const provider = new WebrtcProvider(roomName, doc, { signaling: [] });

// draw.io 内部 App ready 后
bindDrawioFile(file, {
  doc,
  awareness: provider.awareness, // 可选：开启后可显示远端光标/选区
});

// 将 Y.Doc 转回 XML 供持久化或导出
const xml = doc2xml(doc, /* spaces */ 2);
```

> 注意：`signaling: []` 表示未配置信令服务器，通常只适合单机演示或在同一网络中的点对点尝试。若需稳定的多端实时协作，请提供可达的信令服务器列表。

## 与不同 yProvider 绑定示例

> 下述示例仅展示如何创建不同 Provider 并将其 `awareness` 交给 `bindDrawioFile`。请根据自身项目按需安装依赖、配置服务端。

### 通用绑定模式

```ts
import * as Y from 'yjs';
import { bindDrawioFile } from './yjs';

const doc = new Y.Doc();
// 1) 创建 provider（示例见下）
// 2) 将 provider.awareness 传入绑定
bindDrawioFile(file, { doc, awareness: provider.awareness });
```

### y-webrtc（去中心化/P2P）

已在 `src/main.ts` 演示：

```ts
import { WebrtcProvider } from 'y-webrtc';

const doc = new Y.Doc();
const provider = new WebrtcProvider('roomName', doc, {
  signaling: [
    // 推荐配置至少 1~2 个可达的信令服务器
    // 'wss://signaling.yjs.dev',
  ],
});

bindDrawioFile(file, { doc, awareness: provider.awareness });
```

### y-websocket（中心化服务端）

安装（可选）：

```bash
pnpm add y-websocket
```

示例：

```ts
import { WebsocketProvider } from 'y-websocket';

const doc = new Y.Doc();
// 你的 y-websocket 服务端地址（例：wss://your-server:1234）
const provider = new WebsocketProvider('wss://your-server', 'roomName', doc, {
  // params: { token: '...' }, // 可选：鉴权等
  // connect: true,            // 可选：延迟连接
});

// 初次同步完成后再绑定，避免本地初始状态覆盖远端
provider.on('sync', (isSynced: boolean) => {
  if (isSynced) {
    bindDrawioFile(file, { doc, awareness: provider.awareness });
  }
});

// 可选：连接状态
provider.on('status', (e: { status: 'connected' | 'disconnected' }) => {
  console.log('ws status:', e.status);
});
```

### IndexedDB 本地离线持久化（可与任意 Provider 组合）

安装（可选）：

```bash
pnpm add y-indexeddb
```

示例（单机离线）：

```ts
import { IndexeddbPersistence } from 'y-indexeddb';

const doc = new Y.Doc();
const idb = new IndexeddbPersistence('y-mxgraph-demo', doc);

idb.once('synced', () => {
  // 本地数据已读取，可安全绑定
  bindDrawioFile(file, { doc }); // 无 provider 也可运行（单机模式）
});
```

### 组合：IndexedDB + y-websocket

建议先等待本地 IndexedDB 读取完成，再连接/绑定，减少首次覆盖风险：

```ts
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';

const doc = new Y.Doc();
const idb = new IndexeddbPersistence('roomName', doc);
const ws = new WebsocketProvider('wss://your-server', 'roomName', doc);

idb.once('synced', () => {
  bindDrawioFile(file, { doc, awareness: ws.awareness });
});
```

### 无 Provider（单机纯本地）

```ts
const doc = new Y.Doc();
bindDrawioFile(file, { doc });
```

> 提示：
> - 上述示例未将相关依赖加入本仓库默认依赖中，请按需自行安装。
> - `bindDrawioFile` 只关心同一个 `Y.Doc` 与可选 `awareness`，无需关心具体 Provider 类型。
> - 首次绑定时机：对中心化 Provider（如 `y-websocket`）建议在初次 `sync` 完成后再绑定，避免覆盖远端。

## API 文档

从库入口 `src/yjs/index.ts` 导出：

### `bindDrawioFile(file, options)`

- 作用：将 draw.io 的 `file` 对象与 `Y.Doc` 双向绑定。
- 参数：
  - `file: any` draw.io 编辑器文件对象（来自 `App.main((app) => app.currentFile)`）
  - `options?: {
      mouseMoveThrottle?: number;           // 光标移动节流，默认 100ms
      doc?: Y.Doc | null;                   // 传入现有 Doc；不传则内部创建
      awareness?: Awareness;                // 协作状态（用于光标/选区）
      cursor?: boolean | {                  // 是否渲染远端光标/选区
        userNameKey?: string;               // awareness 中用户名字段，默认 'user.name'
        userColorKey?: string;              // awareness 中颜色字段，默认 'user.color'
      };
      debug?: boolean;                      // 预留调试开关
    }`
- 返回：`Y.Doc`（若传入了 `doc` 则返回同一个）
- 行为：
  - 监听本地 `mxGraphModel` 的变更并生成 patch，应用到 `Y.Doc`
  - 监听 `Y.Doc` 的远端变更并生成 patch，应用回 draw.io 的 `file`
  - 若传入 `awareness`，将绑定协作光标/选区信息

### `xml2doc(xml: string, doc?: Y.Doc)`

- 作用：将 draw.io XML 解析并填充到 `Y.Doc` 中
- 支持：`<mxfile>`（多页面）或 `<mxGraphModel>`（单模型）
- 返回：`Y.Doc`（传入时复用，不传则内部创建）

### `doc2xml(doc: Y.Doc, spaces = 0): string`

- 作用：将 `Y.Doc` 序列化为 draw.io XML
- 兼容两种文档形态（对应 `xml2doc` 的解析）
- 参数：
  - `spaces`：缩进空格数，便于人类可读
- 返回：XML 字符串

## 补丁与顺序规则（重要）

为确保与 draw.io 的语义一致，绑定层在应用/生成补丁（patch）时遵循如下顺序与锚点规则（详见 `src/yjs/binding/patch.ts` 中 `applyFilePatch()` 与 `insertAfterUnique()`）：

- __diagram 层（页面）__：
  - 处理顺序：先删除 -> 后插入 -> 再重排（基于 `previous`）。
  - 在每次重排前会调用 `ensureUniqueOrder()` 去重，避免重复 id 影响位置计算。

- __cells 层（mxCell）__：
  - 处理顺序：先删除 -> 后插入 -> 再属性更新 -> 最后重排（基于 `previous`）。
  - __锚点规则__（插入或移动时确定位置）：
    - 优先使用 `previous`。当 `previous === ""` 时，表示该节点是其父的“第一个兄弟”。
    - 当 `previous === ""` 且存在 `parent` 时，节点会被插在父节点之后（即首个子节点紧随父节点）。
      - 示例：父 `-3`，子1 `-1`（previous 为空）、子2 `-2`（previous = `-1`）
        - 最终顺序：`-3 -> -1 -> -2`。
    - 若未提供 `previous` 但提供了 `parent`，亦会跟随父节点。
    - 当指定锚点不存在时（可能因同时删除等），cells 通常回退到末尾；若完全无锚点，则可能移动到头部以保持稳定。
  - 实现上统一使用 `insertAfterUnique()` 完成“唯一化插入”，既能去重也能正确处理移动时的索引漂移。

> 注：上述规则只描述顺序/结构层面的处理。属性变更会在顺序调整前写入（避免属性丢失），并通过事件与快照对比进行兜底。

## 在你自己的项目中使用

本仓库暂未发布 npm 包。你有两种方式：

- 直接引用源码（开发期）
  - `import { bindDrawioFile, xml2doc, doc2xml } from "./src/yjs";`
- 使用打包产物（构建后）
  - 运行 `pnpm vite build --config vite.lib.config.ts`
  - 在 `dist/` 下得到 `y-mxgraph.es.js` / `y-mxgraph.cjs.js` / `y-mxgraph.umd.js`

> `vite.lib.config.ts` 已将 `lodash-es`、`yjs`、`y-protocols`、`xml-js`、`colord`、`diff` 外部化，请确保在 UMD 使用场景提供相应全局或使用打包器处理。

## CI/CD 与发布

- Pages（Demo 部署）：`.github/workflows/pages.yml`
  - 触发：push 到 `master`、手动触发
  - 行为：安装依赖 -> Vite 构建 -> 上传并部署到 GitHub Pages
  - 注意：工作流启用了 `submodules: recursive`，以确保 `public/drawio/` 子模块被拉取
- 库构建：`.github/workflows/lib-build.yml`
  - 触发：推送 tag（`v*`）、手动触发
  - 行为：安装依赖 -> `vite.lib.config.ts` 构建 -> 上传 artifact（`y-mxgraph-lib`）

## 常见问题（FAQ）

- Q: 为什么我在 GitHub Pages 打开 Demo 出现 404？
  - A: 请确保构建时 `--base "/<repo>/"`，并且 `index.html` 中静态资源使用相对路径（本仓库已配置）。

- Q: 多端协作没有连上？
  - A: 示例中 `y-webrtc` `signaling: []`，仅适合本地单人/对照调试。需要稳定多端协作请配置可达的信令服务器列表。

- Q: 我可以只用转换能力，不绑定编辑器吗？
  - A: 可以。使用 `xml2doc`/`doc2xml` 即可在服务端或工具链中完成格式转换。

## 许可证

暂未指定（TBD）。如需开放协议请在根目录添加 `LICENSE` 并在此处补充说明。
