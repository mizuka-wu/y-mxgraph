---
layout: home

hero:
  name: y-mxgraph
  text: Yjs × draw.io 实时协作绑定
  tagline: 将 draw.io (mxGraph) 文档与 Yjs CRDT 数据结构进行双向绑定，轻松实现多人实时协作。
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: API 参考
      link: /api/

features:
  - icon: 🔄
    title: 双向同步
    details: 将 draw.io 文档映射为 Yjs 结构，增量同步、冲突自动合并，无需额外服务端逻辑。
  - icon: 📦
    title: 简洁 API
    details: 核心只需一个 Binding 类，配合 xml2ydoc / ydoc2xml 即可完成全部集成，还支持 iframe 隔离部署。
  - icon: 🤝
    title: Provider 无关
    details: 支持 y-webrtc、y-websocket、y-indexeddb 等任意 Yjs Provider，按需组合。
  - icon: 🖱️
    title: 协作光标 & 选区
    details: 基于 y-protocols/awareness 渲染远端用户光标和选区，开箱即用。
---
