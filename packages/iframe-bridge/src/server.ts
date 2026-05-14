import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";

export interface IframeBridgeServer {
  addIframe: (iframe: HTMLIFrameElement, iframeId: string) => void;
  removeIframe: (iframeId: string) => void;
  destroy: () => void;
}

export function createIframeBridgeServer(
  ydoc: Y.Doc,
  awareness: Awareness,
): IframeBridgeServer {
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
        {
          type: "awareness-sync",
          payload: Array.from(awarenessState),
          serverClientId: awareness.clientID,
        },
        "*",
      );
    } else if (msgType === "ping") {
      sourceWindow.postMessage(
        { type: "pong", serverClientId: awareness.clientID },
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
    destroy: () => {
      ydoc.off("update", onYdocUpdate);
      awareness.off("update", onAwarenessUpdate);
      window.removeEventListener("message", onMessage);
      iframes.clear();
      iframeReady.clear();
    },
  };
}
