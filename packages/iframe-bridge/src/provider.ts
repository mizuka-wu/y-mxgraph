import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";

type ListenerFn = (sender: unknown, evt?: unknown) => void;

function createMxEventObject(name: string, props?: Record<string, unknown>) {
  const _props = props || {};
  return {
    name,
    getName: () => name,
    getProperty: (k: string) => _props[k],
  };
}

type MxLike = Record<string, unknown> & {
  eventListeners: Array<string | ListenerFn>;
  history: unknown[];
  indexOfNextAdd: number;
  addListener(name: string, fn: ListenerFn): void;
  fireEvent(evt: unknown): void;
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): void;
  redo(): void;
  undoableEditHappened(_edit: unknown): void;
};

export interface DrawioEditor {
  undoManager?: {
    eventListeners?: unknown[];
    [key: string]: unknown;
  };
  undoListener?: (...args: unknown[]) => void;
}

export interface DrawioFile {
  getUi(): { editor: DrawioEditor };
}

export interface IframeBridgeProviderOptions {
  debug?: boolean;
}

export interface IframeBridgeProvider {
  serverClientId: number | null;
  connected: boolean;
  onConnect: (fn: () => void) => () => void;
  onDisconnect: (fn: () => void) => () => void;
  on: (event: "connect" | "disconnect", fn: () => void) => () => void;
  takeoverUndoManager: (file: DrawioFile) => () => void;
  destroy: () => void;
}

function readVarUint(data: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  let byte: number;
  do {
    byte = data[pos++];
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte >= 0x80);
  return [result >>> 0, pos];
}

function writeVarUint(value: number): number[] {
  const bytes: number[] = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  return bytes;
}

function readVarString(data: Uint8Array, pos: number): [string, number] {
  const [len, pos2] = readVarUint(data, pos);
  const str = new TextDecoder().decode(data.subarray(pos2, pos2 + len));
  return [str, pos2 + len];
}

function writeVarString(str: string): number[] {
  const encoded = new TextEncoder().encode(str);
  return [...writeVarUint(encoded.length), ...encoded];
}

function remapClientIdInUpdate(
  update: Uint8Array,
  fromId: number,
  toId: number,
): Uint8Array {
  const entries: Array<{ clientID: number; clock: number; state: string }> = [];
  const seenClientIds = new Set<number>();
  let pos = 0;

  const [count, pos2] = readVarUint(update, pos);
  pos = pos2;

  for (let i = 0; i < count; i++) {
    const [clientID, pos3] = readVarUint(update, pos);
    pos = pos3;
    const [clock, pos4] = readVarUint(update, pos);
    pos = pos4;
    const [state, pos5] = readVarString(update, pos);
    pos = pos5;

    const mappedId = clientID === fromId ? toId : clientID;
    if (seenClientIds.has(mappedId)) {
      continue;
    }

    seenClientIds.add(mappedId);
    entries.push({ clientID: mappedId, clock, state });
  }

  const result: number[] = [];
  result.push(...writeVarUint(entries.length));
  for (const entry of entries) {
    result.push(...writeVarUint(entry.clientID));
    result.push(...writeVarUint(entry.clock));
    result.push(...writeVarString(entry.state));
  }

  return new Uint8Array(result);
}

export function createIframeBridgeProvider(
  ydoc: Y.Doc,
  awareness: Awareness,
  options?: IframeBridgeProviderOptions,
): IframeBridgeProvider {
  const { debug = false } = options ?? {};
  let applyingParentUpdate = false;
  let serverClientId: number | null = null;
  let currentCleanup: (() => void) | null = null;
  let currentMxLike: MxLike | null = null;
  let connected = false;
  let initRetryTimer: ReturnType<typeof setInterval> | null = null;
  const connectListeners = new Set<() => void>();
  const disconnectListeners = new Set<() => void>();

  const log = debug
    ? (...args: unknown[]) => console.debug("[iframe-bridge provider]", ...args)
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

  function parentPostMessage(message: unknown) {
    logMessage("send", (message as { type?: string }).type ?? "postMessage", message);
    window.parent.postMessage(message, "*");
  }

  function setConnected(value: boolean) {
    if (connected === value) return;
    connected = value;
    if (value) {
      connectListeners.forEach((fn) => fn());
    } else {
      disconnectListeners.forEach((fn) => fn());
    }
  }

  function startInitRetry() {
    if (initRetryTimer) {
      clearInterval(initRetryTimer);
    }
    parentPostMessage({ type: "init" });
    initRetryTimer = setInterval(() => {
      if (!connected) {
        parentPostMessage({ type: "init" });
      }
    }, 1000);
  }

  const onYdocUpdate = (update: Uint8Array, origin: unknown) => {
    if (applyingParentUpdate) return;
    // 检测基线数据：origin 为 null 时是 xml2ydoc 首次初始化
    const isBaseline = origin === null || origin === undefined;
    const message = { type: "ydoc-update", payload: Array.from(update), isBaseline };
    logMessage("send", "ydoc-update", message);
    window.parent.postMessage(message, "*");
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

    // 只同步本地 clientID 的状态给父页面
    // 其他 peers 的更新由父页面的 WebRTC/WebSocket provider 负责广播
    const localClientId = awareness.clientID;
    const localChanged = changes.includes(localClientId);
    if (!localChanged) return;

    const state = awareness.getLocalState();
    const message = { type: "awareness-local-state", state };
    logMessage("send", "awareness-local-state", state);
    window.parent.postMessage(message, "*");
  };

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const { type, payload, serverClientId: receivedServerId } = event.data;

    logMessage("recv", type, payload);
    if (type === "pong" && receivedServerId != null) {
      serverClientId = receivedServerId;
      return;
    }

    if (type === "ydoc-sync" || type === "ydoc-update") {
      applyingParentUpdate = true;
      Y.applyUpdate(ydoc, new Uint8Array(payload));
      applyingParentUpdate = false;
      if (type === "ydoc-sync" && !connected) {
        setConnected(true);
        if (initRetryTimer) {
          clearInterval(initRetryTimer);
          initRetryTimer = null;
        }
      }
    } else if (type === "awareness-sync" || type === "awareness-update") {
      logMessage("recv", type, payload);
      if (receivedServerId != null) {
        serverClientId = receivedServerId;
      }

      const serverId = receivedServerId ?? serverClientId;
      const localClientId = awareness.clientID;
      applyingParentUpdate = true;
      if (serverId != null && serverId !== localClientId) {
        const remapped = remapClientIdInUpdate(
          new Uint8Array(payload),
          serverId,
          localClientId,
        );
        applyAwarenessUpdate(awareness, remapped, null);
      } else {
        applyAwarenessUpdate(awareness, new Uint8Array(payload), null);
      }

      // awareness-sync 时：以 server 的 user 为基准，iframe 补充缺失字段，然后推送完整 user 给 server
      if (type === "awareness-sync" && serverId != null) {
        const serverState = awareness.getStates().get(localClientId);
        const serverUser = (serverState as { user?: Record<string, unknown> } | undefined)?.user || {};
        const currentLocal = awareness.getLocalState() || {};
        const iframeUser = (currentLocal as { user?: Record<string, unknown> }).user || {};

        // 以 server 为基准，iframe 只补充 server 缺失的字段
        const mergedUser: Record<string, unknown> = {
          name: serverUser.name !== undefined ? serverUser.name : iframeUser.name,
          account: serverUser.account !== undefined ? serverUser.account : iframeUser.account,
          color: serverUser.color !== undefined ? serverUser.color : iframeUser.color,
        };

        const userChanged =
          iframeUser.name !== mergedUser.name ||
          iframeUser.account !== mergedUser.account ||
          iframeUser.color !== mergedUser.color;

        if (userChanged) {
          awareness.setLocalState({
            ...currentLocal,
            user: mergedUser,
          });
          // 推送完整的 user 给 server（补充了缺失字段）
          const update = encodeAwarenessUpdate(awareness, [awareness.clientID]);
          const remapped = remapClientIdInUpdate(update, awareness.clientID, serverId);
          const message = { type: "awareness-update", payload: Array.from(remapped) };
          logMessage("send", "awareness-update", message);
          window.parent.postMessage(message, "*");
        }
      }

      applyingParentUpdate = false;
    } else if (type === "undo-state" && currentMxLike) {
      // 从 Server 同步真实的 undo/redo 状态
      const { undoStackSize, redoStackSize } = event.data;

      const oldIndex = currentMxLike.indexOfNextAdd;
      const newIndex = undoStackSize || 0;
      const newTotal = (undoStackSize || 0) + (redoStackSize || 0);

      // 直接根据 server 状态重建本地状态
      applyingParentUpdate = true;

      // 重建 history 数组匹配 server 的总大小
      currentMxLike.history = new Array(newTotal).fill({});
      currentMxLike.indexOfNextAdd = newIndex;

      // 触发对应事件通知 UI 更新
      if (newTotal === 0) {
        currentMxLike.fireEvent(createMxEventObject("clear"));
      } else if (newIndex < oldIndex) {
        currentMxLike.fireEvent(
          createMxEventObject("undo", { edit: { changes: [] } }),
        );
      } else if (newIndex > oldIndex) {
        currentMxLike.fireEvent(
          createMxEventObject("redo", { edit: { changes: [] } }),
        );
      } else {
        currentMxLike.fireEvent(
          createMxEventObject("add", { edit: { changes: [] } }),
        );
      }

      applyingParentUpdate = false;
    } else if (type === "disconnect") {
      setConnected(false);
      startInitRetry();
    }
  };

  ydoc.on("update", onYdocUpdate);
  awareness.on("update", onAwarenessUpdate);
  window.addEventListener("message", onMessage);

  startInitRetry();

  // 发送 ping 获取 serverClientId
  setTimeout(() => {
    window.parent.postMessage({ type: "ping" }, "*");
  }, 100);

  return {
    get serverClientId() {
      return serverClientId;
    },
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
    takeoverUndoManager(file: DrawioFile) {
      if (currentCleanup) {
        currentCleanup();
      }

      const editor = file.getUi().editor;
      const originUndoManager = editor.undoManager;

      const pairs: Array<[string, ListenerFn]> = [];
      const raw = Array.isArray(originUndoManager?.eventListeners)
        ? (originUndoManager.eventListeners as unknown[])
        : [];
      for (let i = 0; i + 1 < raw.length; i += 2) {
        const key = String(raw[i]);
        const fn = raw[i + 1] as ListenerFn;
        pairs.push([key, fn]);
      }

      const mxLike: MxLike = {
        eventListeners: [] as Array<string | ListenerFn>,
        history: [] as unknown[],
        indexOfNextAdd: 0,

        addListener(name: string, fn: ListenerFn) {
          this.eventListeners.push(name, fn);
        },

        fireEvent(evt: unknown) {
          const eventName: string =
            (evt as { name?: string } | undefined)?.name ||
            ((evt as { getName?: () => string } | undefined)?.getName?.() ??
              "");
          for (let i = 0; i + 1 < this.eventListeners.length; i += 2) {
            const key = this.eventListeners[i];
            const listener = this.eventListeners[i + 1] as ListenerFn;
            if (key === eventName) {
              try {
                listener(this, evt);
              } catch (e) {
                console.warn(
                  "[iframe-bridge] undoManager event listener error:",
                  e,
                );
              }
            }
          }
        },

        canUndo(): boolean {
          return this.indexOfNextAdd > 0;
        },

        canRedo(): boolean {
          return this.indexOfNextAdd < this.history.length;
        },

        undo() {
          if (!applyingParentUpdate) {
            window.parent.postMessage({ type: "undo" }, "*");
          }
        },

        redo() {
          if (!applyingParentUpdate) {
            window.parent.postMessage({ type: "redo" }, "*");
          }
        },

        undoableEditHappened() {
          // no-op
        },
      };

      pairs.forEach(([key, fn]) => {
        const k = key.toLowerCase();
        if (k === "add" || k === "clear" || k === "undo" || k === "redo") {
          mxLike.addListener(k, fn);
        }
      });

      currentMxLike = mxLike;
      editor.undoManager = mxLike as any;
      editor.undoListener = function () {};

      const cleanup = () => {
        editor.undoManager = originUndoManager;
        editor.undoListener = originUndoManager?.undoListener as
          | ((...args: unknown[]) => void)
          | undefined;
        currentMxLike = null;
      };

      currentCleanup = cleanup;
      return cleanup;
    },
    destroy: () => {
      ydoc.off("update", onYdocUpdate);
      awareness.off("update", onAwarenessUpdate);
      window.removeEventListener("message", onMessage);
      if (initRetryTimer) {
        clearInterval(initRetryTimer);
        initRetryTimer = null;
      }
      connectListeners.clear();
      disconnectListeners.clear();
      if (currentCleanup) {
        currentCleanup();
      }
    },
  };
}
