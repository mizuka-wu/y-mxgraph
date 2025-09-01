/**
 * 绑定 yjs UndoManager 到 draw.io 的 editor.undoManager，提供 mxUndoManager 兼容层。
 */
import * as Y from "yjs";

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
  }
) {
  // 1) 准备 yjs 的 UndoManager（作用域为整个 doc）
  const yUndo: Y.UndoManager =
    options?.undoManager ||
    new Y.UndoManager(doc, {
      // 仅作占位，是否捕获通过 yjs 内部策略控制
      trackedOrigins: new Set([null]),
    });

  const editor = file.getUi().editor;
  const originUndoManager = editor.undoManager;

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
      return typeof this._y.canUndo === "function" ? this._y.canUndo() : false;
    },

    canRedo(): boolean {
      return typeof this._y.canRedo === "function" ? this._y.canRedo() : false;
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
    mxEventName: "add" | "clear" | "undo" | "redo",
    yEventName: string
  ) => {
    yUndo.on(yEventName as any, () => {
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
          break;
        case "undo":
          if (mxLike.indexOfNextAdd > 0) mxLike.indexOfNextAdd--;
          break;
        case "redo":
          if (mxLike.indexOfNextAdd < mxLike.history.length) mxLike.indexOfNextAdd++;
          break;
        case "clear":
          mxLike.history = [];
          mxLike.indexOfNextAdd = 0;
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
