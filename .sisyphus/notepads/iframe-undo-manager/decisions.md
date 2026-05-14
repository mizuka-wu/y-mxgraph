# Decisions

## Dual UndoManager Design

- **Decision**: Server maintains its own Y.UndoManager tracking child-originated changes. Provider (child) has its own local UndoManager for local undo/redo in the iframe.
- **Rationale**: The server needs to know which changes came from children (via BRIDGE_ORIGIN) to avoid tracking its own network-synced changes. The child needs its own UndoManager for local undo/redo before changes are propagated to the server.
- **Alternative considered**: Single UndoManager on server shared across all children — rejected because each child's undo stack is independent (different editing contexts).
- **origin.ts filename/location**: Placed in `packages/iframe-bridge/src/origin.ts` alongside provider.ts and server.ts, consistent with the package's self-contained architecture.

## BRIDGE_ORIGIN transaction wrapping

- **Decision**: `ydoc-update` from children is wrapped in `ydoc.transact(() => Y.applyUpdate(...), BRIDGE_ORIGIN)`.
- **Rationale**: Ensures the UndoManager on the server can track which changes originate from iframe children. Without the origin marker, the UndoManager would mix network-synced changes with child-synced changes, making undo behavior unpredictable.
