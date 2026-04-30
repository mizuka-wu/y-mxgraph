# y-mxgraph

[English](./README.md)

Yjs 与 draw.io (mxGraph) 文档的双向绑定库，让 draw.io 支持实时多人协同编辑。

## 特性

- **双向绑定** draw.io 文件与 Y.Doc
- **实时协作** 支持 y-webrtc、y-websocket 及任意 Yjs Provider
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

  const binding = new Binding(app.currentFile, { doc });

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

# 启动 Demo
pnpm --filter @y-mxgraph/demo dev

# 启动文档
pnpm --filter @y-mxgraph/docs dev
```

## License

MIT
