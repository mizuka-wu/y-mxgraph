/**
 * 绑定 Y.UndoManager 到 draw.io 的 editor.undoManager，提供 mxUndoManager 兼容层。
 * 仅在外部传入 undoManager 时调用。
 */
import * as Y from "yjs";
import { LOCAL_ORIGIN } from "../helper/origin";

type ListenerFn = (sender: any, evt?: any) => void;

function createMxEventObject(name: string, props?: Record<string, any>) {
  const _props = props || {};
  return {
    name,
    getName: () => name,
    getProperty: (k: string) => _props[k],
  };
}

export function bindUndoManager(doc: Y.Doc, file: any, yUndo: Y.UndoManager) {
  const editor = file.getUi().editor;
  const originUndoManager = editor.undoManager;

  let lastTxnLocalOrigin = false;
  doc.on("beforeTransaction", (t: Y.Transaction) => {
    lastTxnLocalOrigin = !!(t.local || t.origin === (LOCAL_ORIGIN as any));
  });
  doc.on("afterTransaction", (t: Y.Transaction) => {
    lastTxnLocalOrigin = !!(t.local || t.origin === (LOCAL_ORIGIN as any));
  });

  const pairs: Array<[string, ListenerFn]> = [];
  const raw = Array.isArray(originUndoManager?.eventListeners)
    ? (originUndoManager.eventListeners as any[])
    : [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const key = String(raw[i]);
    const fn = raw[i + 1] as ListenerFn;
    pairs.push([key, fn]);
  }

  const mxLike: any = {
    eventListeners: [] as Array<string | ListenerFn>,
    history: [] as any[],
    indexOfNextAdd: 0,
    _y: yUndo,

    addListener(name: string, fn: ListenerFn) {
      this.eventListeners.push(name, fn);
    },

    fireEvent(evt: any) {
      const eventName: string =
        evt?.name || (evt?.getName ? evt.getName() : "");
      for (let i = 0; i + 1 < this.eventListeners.length; i += 2) {
        const key = this.eventListeners[i];
        const listener = this.eventListeners[i + 1] as ListenerFn;
        if (key === eventName) {
          try {
            listener(this, evt);
          } catch (e) {
            // swallow
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

    undoableEditHappened(_edit: any) {
      // no-op: 让 yjs 基于事务决定是否入栈
    },
  };

  const bridge = (mxEventName: "add" | "clear", yEventName: string) => {
    yUndo.on(yEventName as any, () => {
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
    });
  };

  bridge("add", "stack-item-added");
  bridge("clear", "stack-cleared");

  yUndo.on("stack-item-popped" as any, (e: any) => {
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
  });

  yUndo.on("stack-item-updated" as any, () => {
    const evt = createMxEventObject("redo", { edit: { changes: [] } });
    mxLike.fireEvent(evt);
  });

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

  return mxLike;
}
