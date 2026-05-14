# Learnings

## BRIDGE_ORIGIN + UndoManager in iframe-bridge

### Task: Add dual UndoManager support to iframe-bridge

- BRIDGE_ORIGIN follows the same pattern as LOCAL_ORIGIN in `packages/y-mxgraph/src/helper/origin.ts` — an empty object `{}` used as a Yjs transaction origin marker.
- The UndoManager on the server side uses `trackedOrigins: new Set([BRIDGE_ORIGIN])` to track only changes that originate from iframe children (via ydoc-update messages wrapped in `ydoc.transact(() => ..., BRIDGE_ORIGIN)`).
- The server's own Y.Doc updates (from network providers like y-webrtc) are NOT wrapped in BRIDGE_ORIGIN, so the parent UndoManager correctly distinguishes remote-from-child vs remote-from-network changes.
- The provider (iframe child) reports undo-state via postMessage events (`stack-item-added`, `stack-item-popped`, `stack-item-updated`, `stack-cleared`) so the server can query canUndo/canRedo per child.
- `undo-state` messages are handled by `undoStateCallbacks` map keyed by iframeId.
- `onUndoState` is exposed on IframeBridgeServer for external listeners (e.g., UI buttons).

### Task (T2/T3): Wire undo/redo buttons in demo

- The server's `bridgeServer.undoManager` is a Y.UndoManager tracking BRIDGE_ORIGIN — it captures changes from iframe children.
- Parent page (`iframe-container.ts`) wires undo/redo buttons directly to `bridgeServer.undoManager` via `.undo()` / `.redo()` calls and listens to `stack-item-added`, `stack-item-popped`, `stack-cleared` events for button state (canUndo/canRedo).
- Even though `onUndoState(iframeId, callback)` exists for per-child undo state, the parent's buttons use the aggregate server undoManager for simplicity.
- Child page (`main.ts` `initIframeChild`) creates a separate `Y.UndoManager` with `trackedOrigins: new Set([LOCAL_ORIGIN])` — this is distinct from the one created by `bindDrawioFile` internally. The external one is ONLY for bridge undo-state reporting via `createIframeBridgeProvider(ydoc, awareness, undoManager)`.
- When passing `undoManager` to `createIframeBridgeProvider`, the provider auto-registers undo-state listeners and sends `undo-state` messages via postMessage to the parent on each stack change.
- Button disabled state must be reset (`disabled = true`) at the start of `initBridge` when destroying/recreating the bridge, since the old bridge's state is stale.
- TypeScript caveat: `win` declared later with `const` can't be referenced before its declaration in the same function scope. Use `(window as any)` instead when adding debug exposures earlier in the function flow.
