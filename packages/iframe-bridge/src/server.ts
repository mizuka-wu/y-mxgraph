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
  destroy: () => void;
}

export function createIframeBridgeServer(
  iframe: HTMLIFrameElement,
  ydoc: Y.Doc,
  awareness: Awareness,
  options?: IframeBridgeServerOptions,
): IframeBridgeServer {
  const { undoManager } = options ?? {};
  let iframeReady = false;

  function postToIframe(type: string, payload: Uint8Array) {
    const cw = iframe.contentWindow;
    if (cw) {
      cw.postMessage({ type, payload }, "*");
    }
  }

  const onYdocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === IFRAME_ORIGIN) return;
    postToIframe("ydoc-update", update);
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
    postToIframe("awareness-update", update);
  };

  const onMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return;

    const { type: msgType, payload } = event.data;

    if (msgType === "init") {
      if (!iframeReady) {
        iframeReady = true;
      }
      const docState = Y.encodeStateAsUpdate(ydoc);
      const awarenessState = encodeAwarenessUpdate(
        awareness,
        Array.from(awareness.getStates().keys()),
      );
      postToIframe("ydoc-sync", new Uint8Array(Array.from(docState)));
      postToIframe(
        "awareness-sync",
        new Uint8Array(Array.from(awarenessState)),
      );
    } else if (msgType === "ping") {
      const cw = iframe.contentWindow;
      if (cw) {
        cw.postMessage(
          { type: "pong", serverClientId: awareness.clientID },
          "*",
        );
      }
    } else if (msgType === "ydoc-update") {
      const update = new Uint8Array(payload);
      Y.applyUpdate(ydoc, update, IFRAME_ORIGIN);
      // 源 iframe 已经持有此 update，无需回传
    } else if (msgType === "awareness-update") {
      applyAwarenessUpdate(awareness, new Uint8Array(payload), null);
    } else if (msgType === "undo" && undoManager) {
      undoManager.undo();
    } else if (msgType === "redo" && undoManager) {
      undoManager.redo();
    }
  };

  const onUndoPopped = (e: {
    type?: string;
    reason?: string;
    kind?: string;
  }) => {
    const t = e && (e.type || e.reason || e.kind);
    if (t === "undo") {
      postToIframe("undo", new Uint8Array());
    } else if (t === "redo") {
      postToIframe("redo", new Uint8Array());
    }
  };

  const onStackCleared = () => {
    postToIframe("clear", new Uint8Array());
  };

  const onStackItemAdded = () => {
    postToIframe("add", new Uint8Array());
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
    destroy: () => {
      ydoc.off("update", onYdocUpdate);
      awareness.off("update", onAwarenessUpdate);
      window.removeEventListener("message", onMessage);
      if (undoManager) {
        undoManager.off("stack-item-popped", onUndoPopped);
        undoManager.off("stack-cleared", onStackCleared);
        undoManager.off("stack-item-added", onStackItemAdded);
      }
      iframeReady = false;
    },
  };
}
