import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import { IFRAME_ORIGIN, BASELINE_ORIGIN } from "./origin.js";

export interface IframeBridgeServerOptions {
  undoManager?: Y.UndoManager;
}

export interface IframeBridgeServer {
  connected: boolean;
  onConnect: (fn: () => void) => () => void;
  onDisconnect: (fn: () => void) => () => void;
  on: (event: "connect" | "disconnect", fn: () => void) => () => void;
  destroy: () => void;
}

export function createIframeBridgeServer(
  iframe: HTMLIFrameElement,
  ydoc: Y.Doc,
  awareness: Awareness,
  options?: IframeBridgeServerOptions,
): IframeBridgeServer {
  const { undoManager } = options ?? {};
  let connected = false;
  let applyingIframeUpdate = false;
  const connectListeners = new Set<() => void>();
  const disconnectListeners = new Set<() => void>();

  function setConnected(value: boolean) {
    if (connected === value) return;
    connected = value;
    if (value) {
      connectListeners.forEach((fn) => fn());
    } else {
      disconnectListeners.forEach((fn) => fn());
    }
  }

  function postToIframe(type: string, payload?: Uint8Array) {
    const cw = iframe.contentWindow;
    if (cw) {
      cw.postMessage(
        { type, payload: payload ? Array.from(payload) : [] },
        "*",
      );
    }
  }

  function postUndoStateToIframe() {
    if (!undoManager) return;
    const undoStack = (undoManager as any).undoStack;
    const redoStack = (undoManager as any).redoStack;
    const cw = iframe.contentWindow;
    if (cw) {
      const state = {
        type: "undo-state",
        canUndo: undoManager.canUndo(),
        canRedo: undoManager.canRedo(),
        undoStackSize: undoStack?.length ?? 0,
        redoStackSize: redoStack?.length ?? 0,
      };
      cw.postMessage(state, "*");
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
    if (applyingIframeUpdate) return;
    const changes = [...added, ...updated, ...removed];
    if (changes.length === 0) return;

    // 把所有变化的 clientID 都发送给 iframe（包括其他 Webrtc peers 的光标更新）
    // 但要注意：server 自身的 clientID 需要被 iframe 识别为 serverClientId
    const update = encodeAwarenessUpdate(awareness, changes);
    postToIframe("awareness-update", update);
  };

  const onMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return;

    const { type: msgType, payload } = event.data;

    if (msgType === "init") {
      console.log(
        `[iframe-bridge server] received init — connected=${connected}`,
      );
      if (!connected) {
        setConnected(true);
      }
      const docState = Y.encodeStateAsUpdate(ydoc);
      console.log(
        `[iframe-bridge server] sending ydoc-sync — docState bytes=${docState.length}`,
      );
      const awarenessState = encodeAwarenessUpdate(
        awareness,
        Array.from(awareness.getStates().keys()),
      );
      postToIframe("ydoc-sync", new Uint8Array(Array.from(docState)));
      // 在单独的 postMessage 中发送 serverClientId，方便 iframe 接收
      const cw = iframe.contentWindow;
      if (cw) {
        cw.postMessage(
          {
            type: "awareness-sync",
            payload: Array.from(awarenessState),
            serverClientId: awareness.clientID,
          },
          "*",
        );
      }
      // 同步初始 undo 状态
      postUndoStateToIframe();
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
      const isBaseline = event.data.isBaseline;
      // 基线数据使用 BASELINE_ORIGIN（不进入 undo 栈），编辑数据使用 IFRAME_ORIGIN
      const applyOrigin = isBaseline ? BASELINE_ORIGIN : IFRAME_ORIGIN;
      Y.applyUpdate(ydoc, update, applyOrigin);
      // 源 iframe 已经持有此 update，无需回传
    } else if (msgType === "awareness-update") {
      // 应用 iframe 的 awareness 更新时设置标志，防止触发 onAwarenessUpdate 回传
      applyingIframeUpdate = true;
      applyAwarenessUpdate(awareness, new Uint8Array(payload), IFRAME_ORIGIN);
      applyingIframeUpdate = false;
    } else if (msgType === "undo" && undoManager) {
      undoManager.undo();
      postUndoStateToIframe();
    } else if (msgType === "redo" && undoManager) {
      undoManager.redo();
      postUndoStateToIframe();
    }
  };

  const onUndoPopped = () => {
    postUndoStateToIframe();
  };

  const onStackCleared = () => {
    postUndoStateToIframe();
  };

  const onStackItemAdded = () => {
    postUndoStateToIframe();
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
    get connected() {
      return connected;
    },
    onConnect(fn: () => void) {
      connectListeners.add(fn);
      return () => connectListeners.delete(fn);
    },
    onDisconnect(fn: () => void) {
      disconnectListeners.add(fn);
      return () => disconnectListeners.delete(fn);
    },
    on(event: "connect" | "disconnect", fn: () => void) {
      if (event === "connect") {
        connectListeners.add(fn);
        return () => connectListeners.delete(fn);
      } else {
        disconnectListeners.add(fn);
        return () => disconnectListeners.delete(fn);
      }
    },
    destroy: () => {
      setConnected(false);
      postToIframe("disconnect");
      ydoc.off("update", onYdocUpdate);
      awareness.off("update", onAwarenessUpdate);
      window.removeEventListener("message", onMessage);
      if (undoManager) {
        undoManager.off("stack-item-popped", onUndoPopped);
        undoManager.off("stack-cleared", onStackCleared);
        undoManager.off("stack-item-added", onStackItemAdded);
      }
      connectListeners.clear();
      disconnectListeners.clear();
    },
  };
}
