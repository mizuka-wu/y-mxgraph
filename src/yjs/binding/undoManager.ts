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

    // 不再维护自定义的本地撤销计数，直接依赖 yUndo.canUndo/canRedo

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

    // mx 的接线点，在 yUndo 模式下不再需要真正入栈，避免重复/冲突
    undoableEditHappened(_edit: any) {
      // no-op: 让 yjs 基于事务决定是否入栈
    },
  };

  // 3) 将旧的监听器迁移到新适配器上，并桥接到 yUndo 的事件
  // 注意：部分监听器（如 Editor 内部用于同步 selection 的处理）可能依赖 evt.getProperty('edit')，
  // 这里提供一个空的 edit 占位以避免运行时报错。
  const bridge = (
    mxEventName: "add" | "clear",
    yEventName: string
  ) => {
    yUndo.on(yEventName as any, () => {
      if (trackLocalOnly && mxEventName !== "clear" && !lastTxnLocalOrigin) {
        // 远端事务：不更新 UI 的撤销状态，也不广播事件
        return;
      }
      switch (mxEventName) {
        case "add": {
          if (mxLike.indexOfNextAdd < mxLike.history.length) {
            mxLike.history.splice(
              mxLike.indexOfNextAdd,
              mxLike.history.length - mxLike.indexOfNextAdd
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

  // 建立映射（新增/清空）
  bridge("add", "stack-item-added");
  bridge("clear", "stack-cleared");

  // 处理撤销/重做：yUndo 使用同一个事件 'stack-item-popped'，通过 e.type 区分
  yUndo.on("stack-item-popped" as any, (e: any) => {
    const t = e && (e.type || e.reason || e.kind); // 兼容不同实现字段
    if (t === "undo") {
      if (mxLike.indexOfNextAdd > 0) mxLike.indexOfNextAdd--;
      const evt = createMxEventObject("undo", { edit: { changes: [] } });
      mxLike.fireEvent(evt);
    } else if (t === "redo") {
      if (mxLike.indexOfNextAdd < mxLike.history.length) mxLike.indexOfNextAdd++;
      const evt = createMxEventObject("redo", { edit: { changes: [] } });
      mxLike.fireEvent(evt);
    } else {
      // 未知类型，尽量不破坏 index
    }
  });

  // 当 redo 栈被更新（例如新增编辑后清空 redo），通知 UI 刷新状态
  yUndo.on("stack-item-updated" as any, () => {
    // 不修改 index（由 add/undo/redo 已处理），仅派发事件提示 UI 重新计算 canUndo/canRedo
    const evt = createMxEventObject("redo", { edit: { changes: [] } });
    mxLike.fireEvent(evt);
  });

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
