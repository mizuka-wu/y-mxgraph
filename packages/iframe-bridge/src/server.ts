import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import { IFRAME_ORIGIN } from "./origin.js";

export interface IframeBridgeServerOptions {
  undoManager?: Y.UndoManager;
}

export interface IframeBridgeServer {
  addIframe: (iframe: HTMLIFrameElement, iframeId: string) => void;
  removeIframe: (iframeId: string) => void;
  destroy: () => void;
}

export function createIframeBridgeServer(
  ydoc: Y.Doc,
  awareness: Awareness,
  options?: IframeBridgeServerOptions,
): IframeBridgeServer {
  const { undoManager } = options ?? {};
  const iframes = new Map<string, HTMLIFrameElement>();
  const iframeReady = new Set<string>();

  const onYdocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === IFRAME_ORIGIN) return;
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

  function broadcastToAll(
    type: string,
    payload: Uint8Array,
    excludeSource?: Window,
  ) {
    for (const iframe of iframes.values()) {
      if (iframe.contentWindow && iframe.contentWindow !== excludeSource) {
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
      const update = new Uint8Array(payload);
      Y.applyUpdate(ydoc, update, IFRAME_ORIGIN);
      broadcastToAll("ydoc-update", update, sourceWindow);
    } else if (msgType === "awareness-update") {
      applyAwarenessUpdate(awareness, new Uint8Array(payload), null);
    } else if (msgType === "undo" && undoManager) {
      undoManager.undo();
    } else if (msgType === "redo" && undoManager) {
      undoManager.redo();
    }
  };

  function addIframe(iframe: HTMLIFrameElement, iframeId: string) {
    iframes.set(iframeId, iframe);
  }

  function removeIframe(iframeId: string) {
    iframes.delete(iframeId);
    iframeReady.delete(iframeId);
  }

  const onUndoPopped = (e: {
    type?: string;
    reason?: string;
    kind?: string;
  }) => {
    const t = e && (e.type || e.reason || e.kind);
    if (t === "undo") {
      broadcastToAll("undo", new Uint8Array());
    } else if (t === "redo") {
      broadcastToAll("redo", new Uint8Array());
    }
  };

  const onStackCleared = () => {
    broadcastToAll("clear", new Uint8Array());
  };

  const onStackItemAdded = () => {
    broadcastToAll("add", new Uint8Array());
  };

  ydoc.on("update", onYdocUpdate);
  awareness.on("update", onAwarenessUpdate);
  window.addEventListener("message", onMessage);
  if (undoManager) {
    undoManager.on("stack-item-popped", onUndoPopped);
    undoManager.on("stack-cleared", onStackCleared);
    undoManager.on("stack-item-added", onStackItemAdded);
  }

  return {
    addIframe,
    removeIframe,
    destroy: () => {
      ydoc.off("update", onYdocUpdate);
      awareness.off("update", onAwarenessUpdate);
      window.removeEventListener("message", onMessage);
      if (undoManager) {
        undoManager.off("stack-item-popped", onUndoPopped);
        undoManager.off("stack-cleared", onStackCleared);
        undoManager.off("stack-item-added", onStackItemAdded);
      }
      iframes.clear();
      iframeReady.clear();
    },
  };
}
