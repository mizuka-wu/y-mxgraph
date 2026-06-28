import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import { IFRAME_ORIGIN, BASELINE_ORIGIN } from "./origin.js";

export interface IframeBridgeServerOptions {
  undoManager?: Y.UndoManager;
  debug?: boolean;
  /** pending update 超时回调（ms），不传则不检测 */
  pendingTimeoutMs?: number;
  /** pending update 超时触发的回调 */
  onPendingTimeout?: (info: { pendingCount: number; oldestMs: number }) => void;
}

export interface IframeBridgeServer {
  connected: boolean;
  onConnect: (fn: () => void) => () => void;
  onDisconnect: (fn: () => void) => () => void;
  on: (event: "connect" | "disconnect", fn: () => void) => () => void;
  forceSyncToClient: () => void;
  destroy: () => void;
}

export function createIframeBridgeServer(
  iframe: HTMLIFrameElement,
  ydoc: Y.Doc,
  awareness: Awareness,
  options?: IframeBridgeServerOptions,
): IframeBridgeServer {
  const { undoManager, debug = false, pendingTimeoutMs, onPendingTimeout } = options ?? {};
  const log = debug
    ? (...args: unknown[]) => console.log("[iframe-bridge server]", ...args)
    : () => undefined;

  function formatPayload(payload: unknown) {
    if (payload instanceof Uint8Array) {
      return { bytes: payload.byteLength };
    }
    if (Array.isArray(payload) && payload.every((item) => typeof item === "number")) {
      return { bytes: payload.length };
    }
    return payload;
  }

  function logMessage(direction: "send" | "recv", type: string, payload?: unknown) {
    if (!debug) return;
    log(direction, type, formatPayload(payload));
  }

  let connected = false;
  let forceFullSync = false;
  let applyingIframeUpdate = false;
  const connectListeners = new Set<() => void>();
  const disconnectListeners = new Set<() => void>();
  let iframeOriginTracked = false;
  const MAX_QUEUE_SIZE = 1000;
  const pendingUpdatesToIframe: Array<{ update: Uint8Array; isBaseline: boolean }> = [];
  let serverSeq = 0;
  const unackedServerUpdates = new Map<number, { update: Uint8Array; isBaseline: boolean; sentAt: number }>();
  let pendingCheckTimer: ReturnType<typeof setTimeout> | null = null;

  function schedulePendingCheck() {
    if (pendingCheckTimer || !pendingTimeoutMs || !onPendingTimeout) return;
    pendingCheckTimer = setTimeout(() => {
      pendingCheckTimer = null;
      const now = Date.now();
      const unackedCount = unackedServerUpdates.size;
      const pendingCount = pendingUpdatesToIframe.length;
      if (unackedCount > 0 || pendingCount > 0) {
        const oldest = unackedCount > 0
          ? Math.min(...Array.from(unackedServerUpdates.values()).map((v) => v.sentAt))
          : now;
        onPendingTimeout({
          pendingCount: unackedCount + pendingCount,
          oldestMs: now - oldest,
        });
      }
    }, pendingTimeoutMs);
  }

  // capabilities learned from the iframe (if any)
  let iframeCapabilities: Record<string, unknown> | null = null;

  function tryAddIframeOriginTracking() {
    if (!undoManager) return;
    try {
      if (typeof (undoManager as any).addTrackedOrigin === "function") {
        (undoManager as any).addTrackedOrigin(IFRAME_ORIGIN);
        iframeOriginTracked = true;
      }
    } catch (error) {
      console.warn(
        "[iframe-bridge server] failed to add IFRAME_ORIGIN to UndoManager tracked origins:",
        error,
      );
    }
  }

  function tryRemoveIframeOriginTracking() {
    if (!undoManager || !iframeOriginTracked) return;
    try {
      if (typeof (undoManager as any).removeTrackedOrigin === "function") {
        (undoManager as any).removeTrackedOrigin(IFRAME_ORIGIN);
      }
    } catch (error) {
      console.warn(
        "[iframe-bridge server] failed to remove IFRAME_ORIGIN from UndoManager tracked origins:",
        error,
      );
    }
  }

  tryAddIframeOriginTracking();

  function setConnected(value: boolean) {
    if (connected === value) return;
    connected = value;
    if (value) {
      const wasForceFullSync = forceFullSync;
      forceFullSync = false;
      while (pendingUpdatesToIframe.length > 0) {
        const { update, isBaseline } = pendingUpdatesToIframe.shift()!;
        const seqNum = ++serverSeq;
        const cw = iframe.contentWindow;
        if (cw) {
          const message = { type: "ydoc-update", payload: Array.from(update), isBaseline, seq: seqNum };
          cw.postMessage(message, "*");
        }
        unackedServerUpdates.set(seqNum, { update, isBaseline, sentAt: Date.now() });
      }
      if (!wasForceFullSync) {
        for (const [savedSeq, { update, isBaseline }] of unackedServerUpdates) {
          const cw = iframe.contentWindow;
          if (cw) {
            cw.postMessage({ type: "ydoc-update", payload: Array.from(update), isBaseline, seq: savedSeq }, "*");
          }
        }
      }

      // send a capabilities request to the iframe so both sides can negotiate
      // older providers will ignore unknown messages, so this is backwards compatible
      postObjectToIframe({ type: "capabilities-request" });

      connectListeners.forEach((fn) => fn());
    } else {
      unackedServerUpdates.clear();
      disconnectListeners.forEach((fn) => fn());
    }
  }

  function postToIframe(type: string, payload?: Uint8Array) {
    const cw = iframe.contentWindow;
    const message = { type, payload: payload ? Array.from(payload) : [] };
    logMessage("send", type, payload);
    if (cw) {
      cw.postMessage(message, "*");
    }
  }

  function postObjectToIframe(message: Record<string, unknown>) {
    const type = message.type as string;
    logMessage("send", type, message);
    const cw = iframe.contentWindow;
    if (cw) {
      cw.postMessage(message, "*");
    }
  }

  const onYdocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === IFRAME_ORIGIN) return;
    // 检测基线数据：origin 为 null 时是 xml2ydoc 首次初始化
    const isBaseline = origin === null || origin === undefined;
    logMessage("send", "ydoc-update", update);
    if (!connected) {
      if (pendingUpdatesToIframe.length >= MAX_QUEUE_SIZE) {
        forceFullSync = true;
        pendingUpdatesToIframe.length = 0;
        console.warn("[iframe-bridge server] queue full, forcing full sync on reconnect");
      }
      pendingUpdatesToIframe.push({ update, isBaseline });
      schedulePendingCheck();
      return;
    }
    const seqNum = ++serverSeq;
    const cw = iframe.contentWindow;
    if (cw) {
      const message = { type: "ydoc-update", payload: Array.from(update), isBaseline, seq: seqNum };
      cw.postMessage(message, "*");
    }
    unackedServerUpdates.set(seqNum, { update, isBaseline, sentAt: Date.now() });
    schedulePendingCheck();
  };

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
      logMessage("send", "undo-state", state);
      cw.postMessage(state, "*");
    }
  }

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
    logMessage("send", "awareness-update", update);
    postObjectToIframe({
      type: "awareness-update",
      payload: Array.from(update),
      serverClientId: awareness.clientID,
    });
  };

  const onMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return;

    const { type: msgType, payload } = event.data;

    if (msgType === "ydoc-pending-updates") {
      logMessage("recv", "ydoc-pending-updates", payload);
      if (Array.isArray(payload)) {
        for (const item of payload) {
          const arr = item.update ?? item;
          const isBaseline = item.isBaseline ?? false;
          const update = new Uint8Array(arr);
          const applyOrigin = isBaseline ? BASELINE_ORIGIN : IFRAME_ORIGIN;
          Y.applyUpdate(ydoc, update, applyOrigin);
        }
      }
    } else if (msgType === "init") {
      logMessage("recv", "init", payload);
      if (!connected) {
        setConnected(true);
      }
      const docState = Y.encodeStateAsUpdate(ydoc);
      logMessage("send", "ydoc-sync", { bytes: docState.length });
      postObjectToIframe({ type: "ydoc-sync", payload: Array.from(docState), protocolVersion: 2 });
      unackedServerUpdates.clear();
      // 在单独的 postMessage 中发送 serverClientId，方便 iframe 接收
      const cw = iframe.contentWindow;
      if (cw) {
        const states = awareness.getStates();
        const statesArray = Array.from(states.entries());
        log("[DEBUG] server sending awareness-sync - detailed", {
          serverClientId: awareness.clientID,
          statesCount: states.size,
          statesArray: statesArray.map(([id, state]) => ({
            clientId: id,
            user: (state as Record<string, unknown>)?.user,
            hasUser: !!(state as Record<string, unknown>)?.user,
          })),
        });
        const message = {
          type: "awareness-sync",
          payload: Array.from(encodeAwarenessUpdate(
            awareness,
            Array.from(states.keys()),
          )),
          serverClientId: awareness.clientID,
        };
        log("[DEBUG] server sending awareness-sync", {
          serverClientId: awareness.clientID,
          states: Object.fromEntries(states),
          payloadLength: message.payload.length,
        });
        logMessage("send", "awareness-sync", message);
        cw.postMessage(message, "*");
      }
      // 同步初始 undo 状态
      postUndoStateToIframe();
    } else if (msgType === "ping") {
      logMessage("recv", "ping", payload);
      const cw = iframe.contentWindow;
      if (cw) {
        const message = { type: "pong", serverClientId: awareness.clientID, protocolVersion: 2 };
        logMessage("send", "pong", message);
        cw.postMessage(message, "*");
      }
    } else if (msgType === "ydoc-update") {
      logMessage("recv", "ydoc-update", payload);
      const update = new Uint8Array(payload);
      const isBaseline = event.data.isBaseline;
      // 基线数据使用 BASELINE_ORIGIN（不进入 undo 栈），编辑数据使用 IFRAME_ORIGIN
      const applyOrigin = isBaseline ? BASELINE_ORIGIN : IFRAME_ORIGIN;
      Y.applyUpdate(ydoc, update, applyOrigin);
      // 源 iframe 已经持有此 update，无需回传
      const inSeq = event.data.seq;
      if (inSeq != null) {
        const cw = iframe.contentWindow;
        if (cw) {
          cw.postMessage({ type: "ydoc-update-ack", seq: inSeq }, "*");
        }
      }
    } else if (msgType === "ydoc-update-ack") {
      const ackSeq = event.data.seq;
      if (ackSeq != null) {
        unackedServerUpdates.delete(ackSeq);
      }
    } else if (msgType === "awareness-local-state") {
      // 保留消息类型兼容旧客户端，已不再采用
      logMessage("recv", "awareness-local-state (ignored)", payload);
    } else if (msgType === "set-local-state") {
      const { key, value } = event.data as {
        key?: string;
        value?: unknown;
      };
      logMessage("recv", "set-local-state", { key, value });
      if (typeof key === "string") {
        applyingIframeUpdate = true;
        awareness.setLocalStateField(key, value);
        applyingIframeUpdate = false;
      }
    } else if (msgType === "awareness-update") {
      logMessage("recv", "awareness-update", payload);
      // 应用 iframe 的 awareness 更新时设置标志，防止触发 onAwarenessUpdate 回传
      applyingIframeUpdate = true;
      applyAwarenessUpdate(awareness, new Uint8Array(payload), IFRAME_ORIGIN);
      applyingIframeUpdate = false;
    } else if (msgType === "set-local-fields") {
      logMessage("recv", "set-local-fields", payload);
      const { fields } = event.data;
      if (fields && typeof fields === "object") {
        applyingIframeUpdate = true;
        const currentLocal = awareness.getLocalState() || {};
        const currentUser = (currentLocal as { user?: Record<string, unknown> }).user || {};
        const newUser = { ...currentUser, ...fields };
        awareness.setLocalState({
          ...currentLocal,
          user: newUser,
        });
        applyingIframeUpdate = false;
      }
    } else if (msgType === "request-undo-state") {
      postUndoStateToIframe();
    } else if (msgType === "consistency-check") {
      // provider 请求一致性检查：比较 state vector
      logMessage("recv", "consistency-check", payload);
      const providerSV = new Uint8Array(event.data.stateVector || []);
      const serverSV = Y.encodeStateVector(ydoc);
      // 简单比较：如果 state vector 不同，发送 force-sync
      const svMatch = providerSV.length === serverSV.length &&
        providerSV.every((v: number, i: number) => v === serverSV[i]);
      if (!svMatch) {
        log("consistency mismatch detected, sending force-sync");
        const cw = iframe.contentWindow;
        if (cw) {
          cw.postMessage({ type: "force-sync" }, "*");
        }
      }
    } else if (msgType === "request-full-sync") {
      // provider 请求完整同步
      logMessage("recv", "request-full-sync", payload);
      const docState = Y.encodeStateAsUpdate(ydoc);
      postObjectToIframe({ type: "ydoc-sync", payload: Array.from(docState), protocolVersion: 2 });
    } else if (msgType === "undo" && undoManager) {
      undoManager.undo();
      postUndoStateToIframe();
    } else if (msgType === "redo" && undoManager) {
      undoManager.redo();
      postUndoStateToIframe();
    } else if (msgType === "capabilities-request") {
      // provider 想协商能力集，回复 capabilities-reply
      logMessage("recv", "capabilities-request", payload);
      postObjectToIframe({ type: "capabilities-reply", capabilities: { consistency: true } });
    } else if (msgType === "capabilities-reply") {
      // provider 回复能力集，保存以便后续使用（可扩展）
      logMessage("recv", "capabilities-reply", payload);
      iframeCapabilities = event.data.capabilities ?? null;
      log("[DEBUG] received iframe capabilities", iframeCapabilities);
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
    forceSyncToClient() {
      if (!connected) return;
      const cw = iframe.contentWindow;
      if (!cw) return;
      const docState = Y.encodeStateAsUpdate(ydoc);
      cw.postMessage({ type: "ydoc-sync", payload: Array.from(docState) }, "*");
      unackedServerUpdates.clear();
      if (pendingCheckTimer) {
        clearTimeout(pendingCheckTimer);
        pendingCheckTimer = null;
      }
    },
    destroy: () => {
      if (pendingCheckTimer) {
        clearTimeout(pendingCheckTimer);
        pendingCheckTimer = null;
      }
      while (pendingUpdatesToIframe.length > 0) {
        const { update, isBaseline } = pendingUpdatesToIframe.shift()!;
        const cw = iframe.contentWindow;
        if (cw) {
          cw.postMessage({ type: "ydoc-update", payload: Array.from(update), isBaseline }, "*");
        }
      }
      setConnected(false);
      postToIframe("disconnect");
      ydoc.off("update", onYdocUpdate);
      awareness.off("update", onAwarenessUpdate);
      window.removeEventListener("message", onMessage);
      if (undoManager) {
        undoManager.off("stack-item-popped", onUndoPopped);
        undoManager.off("stack-cleared", onStackCleared);
        undoManager.off("stack-item-added", onStackItemAdded);
        tryRemoveIframeOriginTracking();
      }
      connectListeners.clear();
      disconnectListeners.clear();
    },
  };
}
