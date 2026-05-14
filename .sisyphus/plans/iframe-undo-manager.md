# iframe-bridge UndoManager 双同步

## Context

**用户需求**: 父容器创建自己的 Y.UndoManager，iframe-bridge 同步两个 UndoManager，让父页面可以撤销子 iframe 的操作。

**核心设计**: 
- `BRIDGE_ORIGIN` 常量标记从 bridge 同步的事务
- server.ts: `Y.applyUpdate()` → `doc.transact(() => { Y.applyUpdate(...) }, BRIDGE_ORIGIN)`
- 父容器 UndoManager: `trackedOrigins: [BRIDGE_ORIGIN]` — 追踪从子 iframe 来的操作
- 子 iframe UndoManager: `trackedOrigins: [LOCAL_ORIGIN]` — 追踪本地操作
- undo/redo 效果通过 Y.Doc 更新自动传播

## TODOs

- [x] 1. 添加 BRIDGE_ORIGIN + 扩展 iframe-bridge 包

  ### What to do
  - 新建 `packages/iframe-bridge/src/origin.ts`: 导出 `BRIDGE_ORIGIN: object = {}`
  - 修改 `provider.ts`: `createIframeBridgeProvider` 新增可选 `undoManager?: Y.UndoManager` 参数
    - 如果传入 undoManager: 监听 stack-item-added/popped/updated/cleared，发送 `undo-state` 消息
    - 初始连接后发送一次 undo-state
    - `destroy()` 清理监听
  - 修改 `server.ts`:
    - Import BRIDGE_ORIGIN
    - 修改 `onMessage` 的 `ydoc-update` 处理: `ydoc.transact(() => { Y.applyUpdate(ydoc, ...) }, BRIDGE_ORIGIN)`
    - 创建父容器 UndoManager: `new Y.UndoManager(ydoc, { trackedOrigins: new Set([BRIDGE_ORIGIN]) })`
    - `IframeBridgeServer` 接口新增: `undoManager: Y.UndoManager`, `onUndoState(iframeId, callback)`
    - 处理 `undo-state` 消息: 调用注册的回调
    - `destroy()` 清理 UndoManager
  - 修改 `index.ts`: 导出 `BRIDGE_ORIGIN`

  ### Must NOT do
  - 不修改 packages/y-mxgraph/ 下文件
  - 不添加 undo-command/redo-command 消息
  - 不修改现有消息处理逻辑

- [x] 2. 更新 demo 创建双 UndoManager

  ### What to do
  - `iframe-container.ts` (`initBridge`): 获取 `bridgeServer.undoManager`，监听状态，暴露调试
  - `main.ts` (`initIframeChild`): 创建 `Y.UndoManager(ydoc, { trackedOrigins: [LOCAL_ORIGIN] })`
    - 传给 `createIframeBridgeProvider(ydoc, awareness, undoManager)`
    - 传给 Binding（通过 bindDrawioFile 内部创建的 undoManager）

- [x] 3. 添加 undo/redo 按钮到 iframe 容器 UI

  ### What to do
  - `iframe.html`: 添加 #undo-btn 和 #redo-btn（SVG 图标）+ CSS 样式
  - `iframe-container.ts`: 按钮点击 → `undoManager.undo()/redo()`，监听状态更新 disabled

- [x] 4. 单元测试

  ### What to do
  - `packages/iframe-bridge/tests/undo-manager.test.ts`
  - 测试 BRIDGE_ORIGIN, server 端 transact 包裹, parent UndoManager 追踪, provider undo-state

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** — oracle
- [x] F2. **Code Quality Review** — unspecified-high
- [x] F3. **Real Manual QA** — unspecified-high
- [x] F4. **Scope Fidelity Check** — deep
