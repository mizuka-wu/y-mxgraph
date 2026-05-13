import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";

export interface IframeBridgeChild {
  dispose: () => void;
}

/**
 * 创建 iframe-bridge 子端。
 * 子端运行在 iframe 内部，通过 postMessage 与父容器同步 ydoc 和 awareness。
 */
export function createIframeBridgeChild(
  ydoc: Y.Doc,
  awareness: Awareness,
): IframeBridgeChild {
  let applyingParentUpdate = false;

  const onYdocUpdate = (update: Uint8Array) => {
    if (applyingParentUpdate) return;
    window.parent.postMessage(
      { type: "ydoc-update", payload: Array.from(update) },
      "*",
    );
  };

  const onAwarenessUpdate = ({
    added,
    updated,
    removed,
  }: {
    added: number[];
    updated: number[];
    removed: number[];
  }) => {
    if (applyingParentUpdate) return;
    const changes = [...added, ...updated, ...removed];
    if (changes.length === 0) return;
    const update = encodeAwarenessUpdate(awareness, changes);
    window.parent.postMessage(
      { type: "awareness-update", payload: Array.from(update) },
      "*",
    );
  };

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const { type, payload } = event.data;

    if (type === "ydoc-sync" || type === "ydoc-update") {
      applyingParentUpdate = true;
      Y.applyUpdate(ydoc, new Uint8Array(payload));
      applyingParentUpdate = false;
    } else if (type === "awareness-sync" || type === "awareness-update") {
      applyingParentUpdate = true;
      applyAwarenessUpdate(awareness, new Uint8Array(payload), null);
      applyingParentUpdate = false;
    }
  };

  ydoc.on("update", onYdocUpdate);
  awareness.on("update", onAwarenessUpdate);
  window.addEventListener("message", onMessage);

  // 向父容器请求初始同步
  window.parent.postMessage({ type: "init" }, "*");

  return {
    dispose: () => {
      ydoc.off("update", onYdocUpdate);
      awareness.off("update", onAwarenessUpdate);
      window.removeEventListener("message", onMessage);
    },
  };
}
