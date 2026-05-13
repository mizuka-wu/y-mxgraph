import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";

export interface IframeBridgeParent {
  addIframe: (iframe: HTMLIFrameElement, iframeId: string) => void;
  removeIframe: (iframeId: string) => void;
  dispose: () => void;
}

/**
 * 创建 iframe-bridge 父端。
 * 父端运行在主页面，通过 postMessage 与所有子 iframe 同步 ydoc 和 awareness。
 */
export function createIframeBridgeParent(
  ydoc: Y.Doc,
  awareness: Awareness,
): IframeBridgeParent {
  const iframes = new Map<string, HTMLIFrameElement>();
  const iframeReady = new Set<string>();

  const onYdocUpdate = (update: Uint8Array) => {
    broadcastToAll("ydoc-update", update);
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
    const changes = [...added, ...updated, ...removed];
    if (changes.length === 0) return;
    const update = encodeAwarenessUpdate(awareness, changes);
    broadcastToAll("awareness-update", update);
  };

  function broadcastToAll(type: string, payload: Uint8Array) {
    for (const iframe of iframes.values()) {
      if (iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type, payload }, "*");
      }
    }
  }

  const onMessage = (event: MessageEvent) => {
    // 检查消息来源是否是已注册的 iframe
    let iframeId: string | null = null;
    for (const [id, iframe] of iframes) {
      if (event.source === iframe.contentWindow) {
        iframeId = id;
        break;
      }
    }
    if (!iframeId) return;

    const { type: msgType, payload } = event.data;
    const sourceWindow = event.source as Window;

    if (msgType === "init") {
      if (!iframeReady.has(iframeId)) {
        iframeReady.add(iframeId);
      }
      const docState = Y.encodeStateAsUpdate(ydoc);
      const awarenessState = encodeAwarenessUpdate(
        awareness,
        Array.from(awareness.getStates().keys()),
      );
      sourceWindow.postMessage(
        { type: "ydoc-sync", payload: Array.from(docState) },
        "*",
      );
      sourceWindow.postMessage(
        { type: "awareness-sync", payload: Array.from(awarenessState) },
        "*",
      );
    } else if (msgType === "ydoc-update") {
      Y.applyUpdate(ydoc, new Uint8Array(payload));
    } else if (msgType === "awareness-update") {
      applyAwarenessUpdate(awareness, new Uint8Array(payload), null);
    }
  };

  function addIframe(iframe: HTMLIFrameElement, iframeId: string) {
    iframes.set(iframeId, iframe);
  }

  function removeIframe(iframeId: string) {
    iframes.delete(iframeId);
    iframeReady.delete(iframeId);
  }

  ydoc.on("update", onYdocUpdate);
  awareness.on("update", onAwarenessUpdate);
  window.addEventListener("message", onMessage);

  return {
    addIframe,
    removeIframe,
    dispose: () => {
      ydoc.off("update", onYdocUpdate);
      awareness.off("update", onAwarenessUpdate);
      window.removeEventListener("message", onMessage);
      iframes.clear();
      iframeReady.clear();
    },
  };
}
