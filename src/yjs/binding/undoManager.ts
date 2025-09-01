/**
 * 绑定undoManager
 */
import * as Y from "yjs";

export function bindUndoManager(
  doc: Y.Doc,
  file: any,
  options: {
    undoManager?: Y.UndoManager;
  }
) {
  const yUndoManager =
    options?.undoManager ||
    new Y.UndoManager(doc, {
      trackedOrigins: new Set([null]),
    });

  const originUndoManager = file.getUi().editor.undoManager;
  // 将 origin 的 eventListeners 两个两个分组：第一个是 key，第二个是 listener
  const currentListeners: any[] = Array.isArray(
    originUndoManager?.eventListeners
  )
    ? originUndoManager.eventListeners
    : [];
  const listenerPairs: Array<[string, Function]> = [];
  for (let i = 0; i + 1 < currentListeners.length; i += 2) {
    const key = currentListeners[i] as string;
    const listener = currentListeners[i + 1] as Function;
    listenerPairs.push([key, listener]);
  }
  file.getUi().editor.undoManager = yUndoManager;

  Object.defineProperty(yUndoManager, "history", {
    value: [],
  });

  // 绑定代理
  listenerPairs.forEach(([key, listener]) => {
    switch (key as "undo" | "redo" | "add" | "clear") {
      case "add":
        yUndoManager.on("stack-item-added", listener as any);
        break;
      case "clear":
        yUndoManager.on("stack-cleared", listener as any);
        break;
      case "undo": {
        // 需要转换
        yUndoManager.on("stack-item-popped", listener as any);
        break;
      }
      case "redo": {
        // 需要转换
        yUndoManager.on("stack-item-updated", listener as any);
        break;
      }
      default:
        break;
    }
  });

  return yUndoManager;
}
