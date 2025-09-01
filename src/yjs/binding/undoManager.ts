/**
 * 绑定 yjs UndoManager 到 draw.io 的 editor.undoManager，提供 mxUndoManager 兼容层。
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

export function bindUndoManager(
  doc: Y.Doc,
  file: any,
  options: {
    undoManager?: Y.UndoManager;
    trackLocalUndoOnly?: boolean;
  }
) {
  // 1) 准备 yjs 的 UndoManager（作用域为整个 doc）
  const trackLocalOnly = options?.trackLocalUndoOnly ?? true;
  let yUndo: Y.UndoManager;
  if (options?.undoManager) {
    yUndo = options.undoManager;
    if (trackLocalOnly) {
      try {
        const set = new Set<any>([LOCAL_ORIGIN as any]);
        (yUndo as any).trackedOrigins = set;
        if (typeof (yUndo as any).addTrackedOrigin === "function") {
          (yUndo as any).addTrackedOrigin(LOCAL_ORIGIN);
        }
      } catch (_e) {
        // 忽略，尽力而为
      }
    }
  } else {
    yUndo = trackLocalOnly
      ? new Y.UndoManager(doc, { trackedOrigins: new Set([LOCAL_ORIGIN as any]) })
      : new Y.UndoManager(doc);
  }

  const editor = file.getUi().editor;
  const originUndoManager = editor.undoManager;

  // 最近一次事务是否来自本地（我们打的 LOCAL_ORIGIN）
  let lastTxnLocalOrigin = false;
  doc.on("beforeTransaction", (t: Y.Transaction) => {
    lastTxnLocalOrigin = !!(t.local || t.origin === (LOCAL_ORIGIN as any));
  });
  doc.on("afterTransaction", (t: Y.Transaction) => {
    lastTxnLocalOrigin = !!(t.local || t.origin === (LOCAL_ORIGIN as any));
  });
  // 仅在 trackLocalOnly 模式下，通过 UndoManager 事件维护本地撤销/重做深度

  // 提取旧 undoManager 的监听器对（key, fn）
  const pairs: Array<[string, ListenerFn]> = [];
  const raw = Array.isArray(originUndoManager?.eventListeners)
    ? (originUndoManager.eventListeners as any[])
    : [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const key = String(raw[i]);
    const fn = raw[i + 1] as ListenerFn;
    pairs.push([key, fn]);
  }

  // 2) 构建 mx 兼容适配器
  const mxLike: any = {
    // 事件存储为 [name, fn, name, fn, ...]，保持与原生 mxUndoManager 一致
    eventListeners: [] as Array<string | ListenerFn>,

    // 与 draw.io 代码兼容的历史快照接口（仅用于 DrawioFile.patch 中的备份/恢复）
    history: [] as any[],
    indexOfNextAdd: 0,

    // yjs 原生对象
    _y: yUndo,

    // 本地撤销/重做深度，仅统计本地事务
    _localUndoDepth: 0,
    _localRedoDepth: 0,

    addListener(name: string, fn: ListenerFn) {
      this.eventListeners.push(name, fn);
    },

    fireEvent(evt: any) {
      const eventName: string = evt?.name || (evt?.getName ? evt.getName() : "");
      for (let i = 0; i + 1 < this.eventListeners.length; i += 2) {
        const key = this.eventListeners[i];
        const listener = this.eventListeners[i + 1] as ListenerFn;
        if (key === eventName) {
          try {
            listener(this, evt);
          } catch (e) {
            // swallow listener errors to mimic mx behavior
          }
        }
      }
    },

    clear() {
      if (typeof this._y.clear === "function") {
        this._y.clear();
      } else {
        // 兜底：如果没有 clear，则尝试通过撤销/重做栈清空
        while (this._y.canUndo && this._y.canUndo()) this._y.undo();
        while (this._y.canRedo && this._y.canRedo()) this._y.redo();
      }
      this.history = [];
      this.indexOfNextAdd = 0;
      this.fireEvent(createMxEventObject("clear"));
    },

    canUndo(): boolean {
      return trackLocalOnly
        ? this._localUndoDepth > 0
        : typeof this._y.canUndo === "function" && this._y.canUndo();
    },

    canRedo(): boolean {
      return trackLocalOnly
        ? this._localRedoDepth > 0
        : typeof this._y.canRedo === "function" && this._y.canRedo();
    },

    undo() {
      if (!trackLocalOnly || this._localUndoDepth > 0) this._y.undo();
    },

    redo() {
      if (!trackLocalOnly || this._localRedoDepth > 0) this._y.redo();
    },

    // mx 的接线点，在 yUndo 模式下不再需要真正入栈，避免重复/冲突
    undoableEditHappened(_edit: any) {
      // no-op: 让 yjs 基于事务决定是否入栈
    },
  };

  // 3) 将旧的监听器迁移到新适配器上，并桥接到 yUndo 的事件
  // 注意：部分监听器（如 Editor 内部用于同步 selection 的处理）可能依赖 evt.getProperty('edit')，
  // 这里提供一个空的 edit 占位以避免运行时报错。
  const bridge = (
    mxEventName: "add" | "clear" | "undo" | "redo",
    yEventName: string
  ) => {
    yUndo.on(yEventName as any, () => {
      if (trackLocalOnly && mxEventName !== "clear" && !lastTxnLocalOrigin) {
        // 远端事务：不更新 UI 的撤销状态，也不广播事件
        return;
      }
      // 更新镜像的 history/index 指针，供 DrawioFile.patch 使用
      switch (mxEventName) {
        case "add":
          if (mxLike.indexOfNextAdd < mxLike.history.length) {
            mxLike.history.splice(
              mxLike.indexOfNextAdd,
              mxLike.history.length - mxLike.indexOfNextAdd
            );
          }
          mxLike.history.push({});
          mxLike.indexOfNextAdd = mxLike.history.length;
          if (trackLocalOnly && lastTxnLocalOrigin) {
            mxLike._localUndoDepth = (mxLike._localUndoDepth || 0) + 1;
            mxLike._localRedoDepth = 0;
          }
          break;
        case "undo":
          if (mxLike.indexOfNextAdd > 0) mxLike.indexOfNextAdd--;
          if (trackLocalOnly) {
            if (mxLike._localUndoDepth > 0) mxLike._localUndoDepth -= 1;
            mxLike._localRedoDepth = (mxLike._localRedoDepth || 0) + 1;
          }
          break;
        case "redo":
          if (mxLike.indexOfNextAdd < mxLike.history.length) mxLike.indexOfNextAdd++;
          if (trackLocalOnly) {
            if (mxLike._localRedoDepth > 0) mxLike._localRedoDepth -= 1;
            mxLike._localUndoDepth = (mxLike._localUndoDepth || 0) + 1;
          }
          break;
        case "clear":
          mxLike.history = [];
          mxLike.indexOfNextAdd = 0;
          if (trackLocalOnly) {
            mxLike._localUndoDepth = 0;
            mxLike._localRedoDepth = 0;
          }
          break;
      }

      const evt = createMxEventObject(mxEventName, { edit: { changes: [] } });
      mxLike.fireEvent(evt);
    });
  };

  // 建立映射
  bridge("add", "stack-item-added");
  bridge("clear", "stack-cleared");
  bridge("undo", "stack-item-popped");
  bridge("redo", "stack-item-updated");

  // 迁移旧的 listeners 到新适配器（仅注册，不直接绑定到 yUndo，触发依靠 mxLike.fireEvent）
  pairs.forEach(([key, fn]) => {
    // 统一小写对齐
    const k = key.toLowerCase();
    if (k === "add" || k === "clear" || k === "undo" || k === "redo") {
      mxLike.addListener(k, fn);
    }
  });

  // 4) 替换 editor.undoManager
  editor.undoManager = mxLike;

  // 5) 断开 Editor 内部对 mxUndoManager 的灌入：用空实现覆盖，以避免把 mxGraph 的 UNDO 事件继续推给 yUndo
  //    Editor.js 中 graph model/view 的 UNDO 监听会调用 editor.undoListener(...)
  editor.undoListener = function () {
    // no-op in yjs mode
  };

  return mxLike;
}
