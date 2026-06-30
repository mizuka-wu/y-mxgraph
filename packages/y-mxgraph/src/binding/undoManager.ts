/**
 * 绑定 Y.UndoManager 到 draw.io 的 editor.undoManager，提供 mxUndoManager 兼容层。
 * 仅在外部传入 undoManager 时调用。
 */
import * as Y from "yjs";
import { LOCAL_ORIGIN } from "../helper/origin";
import type { DrawioFile } from "../types/drawio";

type ListenerFn = (sender: unknown, evt?: unknown) => void;

function createMxEventObject(name: string, props?: Record<string, unknown>) {
  const _props = props || {};
  return {
    name,
    getName: () => name,
    getProperty: (k: string) => _props[k],
  };
}

export function bindUndoManager(doc: Y.Doc, file: DrawioFile, yUndo: Y.UndoManager) {
  const editor = file.getUi().editor;
  const originUndoManager = editor.undoManager;

  let lastTxnLocalOrigin = false;
  const beforeTxnHandler = (t: Y.Transaction) => {
    lastTxnLocalOrigin = !!(t.local || t.origin === LOCAL_ORIGIN);
  };
  const afterTxnHandler = (t: Y.Transaction) => {
    lastTxnLocalOrigin = !!(t.local || t.origin === LOCAL_ORIGIN);
  };
  doc.on("beforeTransaction", beforeTxnHandler);
  doc.on("afterTransaction", afterTxnHandler);

  const pairs: Array<[string, ListenerFn]> = [];
  const raw = Array.isArray(originUndoManager?.eventListeners)
    ? (originUndoManager.eventListeners as unknown[])
    : [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const key = String(raw[i]);
    const fn = raw[i + 1] as ListenerFn;
    pairs.push([key, fn]);
  }

  const mxLike: Record<string, unknown> & {
    eventListeners: Array<string | ListenerFn>;
    history: unknown[];
    indexOfNextAdd: number;
    _y: Y.UndoManager;
    addListener(name: string, fn: ListenerFn): void;
    fireEvent(evt: unknown): void;
    clear(): void;
    canUndo(): boolean;
    canRedo(): boolean;
    undo(): void;
    redo(): void;
    undoableEditHappened(_edit: unknown): void;
  } = {
    eventListeners: [] as Array<string | ListenerFn>,
    history: [] as unknown[],
    indexOfNextAdd: 0,
    _y: yUndo,

    addListener(name: string, fn: ListenerFn) {
      this.eventListeners.push(name, fn);
    },

    fireEvent(evt: unknown) {
      const eventName: string =
        (evt as { name?: string } | undefined)?.name ||
        ((evt as { getName?: () => string } | undefined)?.getName?.() ?? "");
      for (let i = 0; i + 1 < this.eventListeners.length; i += 2) {
        const key = this.eventListeners[i];
        const listener = this.eventListeners[i + 1] as ListenerFn;
        if (key === eventName) {
          try {
            listener(this, evt);
          } catch (e) {
            console.warn("[y-mxgraph] undoManager event listener error:", e);
          }
        }
      }
    },

    clear() {
      if (typeof this._y.clear === "function") {
        this._y.clear();
      } else {
        while (this._y.canUndo && this._y.canUndo()) this._y.undo();
        while (this._y.canRedo && this._y.canRedo()) this._y.redo();
      }
      this.history = [];
      this.indexOfNextAdd = 0;
      this.fireEvent(createMxEventObject("clear"));
    },

    canUndo(): boolean {
      return typeof this._y.canUndo === "function" && this._y.canUndo();
    },

    canRedo(): boolean {
      return typeof this._y.canRedo === "function" && this._y.canRedo();
    },

    undo() {
      this._y.undo();
    },

    redo() {
      this._y.redo();
    },

    undoableEditHappened() {
      // no-op: 让 yjs 基于事务决定是否入栈
    },
  };

  type YUndoEventName = "stack-item-added" | "stack-cleared" | "stack-item-popped" | "stack-item-updated";
  const bridgeHandlers: Array<[YUndoEventName, () => void]> = [];
  const bridge = (mxEventName: "add" | "clear", yEventName: YUndoEventName) => {
    const handler = () => {
      if (mxEventName !== "clear" && !lastTxnLocalOrigin) {
        return;
      }
      switch (mxEventName) {
        case "add": {
          if (mxLike.indexOfNextAdd < mxLike.history.length) {
            mxLike.history.splice(
              mxLike.indexOfNextAdd,
              mxLike.history.length - mxLike.indexOfNextAdd,
            );
          }
          mxLike.history.push({});
          mxLike.indexOfNextAdd = mxLike.history.length;
          break;
        }
        case "clear": {
          mxLike.history = [];
          mxLike.indexOfNextAdd = 0;
          break;
        }
      }

      const evt = createMxEventObject(mxEventName, { edit: { changes: [] } });
      mxLike.fireEvent(evt);
    };
    yUndo.on(yEventName, handler);
    bridgeHandlers.push([yEventName, handler]);
  };

  bridge("add", "stack-item-added");
  bridge("clear", "stack-cleared");

  const poppedHandler = (e: { type?: string; reason?: string; kind?: string; stackItem?: unknown }) => {
    const t = e && (e.type || e.reason || e.kind);
    if (t === "undo") {
      if (mxLike.indexOfNextAdd > 0) mxLike.indexOfNextAdd--;
      const evt = createMxEventObject("undo", { edit: { changes: [] } });
      mxLike.fireEvent(evt);
    } else if (t === "redo") {
      if (mxLike.indexOfNextAdd < mxLike.history.length)
        mxLike.indexOfNextAdd++;
      const evt = createMxEventObject("redo", { edit: { changes: [] } });
      mxLike.fireEvent(evt);
    }
  };
  yUndo.on("stack-item-popped", poppedHandler);

  const updatedHandler = () => {
    const evt = createMxEventObject("redo", { edit: { changes: [] } });
    mxLike.fireEvent(evt);
  };
  yUndo.on("stack-item-updated", updatedHandler);

  pairs.forEach(([key, fn]) => {
    const k = key.toLowerCase();
    if (k === "add" || k === "clear" || k === "undo" || k === "redo") {
      mxLike.addListener(k, fn);
    }
  });

  editor.undoManager = mxLike;

  editor.undoListener = function () {
    // no-op in yjs mode
  };

  const destroy = () => {
    doc.off("beforeTransaction", beforeTxnHandler);
    doc.off("afterTransaction", afterTxnHandler);
    bridgeHandlers.forEach(([event, handler]) => {
      yUndo.off(event, handler);
    });
    yUndo.off("stack-item-popped", poppedHandler);
    yUndo.off("stack-item-updated", updatedHandler);
    // 恢复原始 undoManager
    editor.undoManager = originUndoManager;
    editor.undoListener = originUndoManager?.undoListener;
  };

  return destroy;
}
