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
  const result: number[] = [];
  let pos = 0;

  const [count, pos2] = readVarUint(update, pos);
  pos = pos2;
  result.push(...writeVarUint(count));

  for (let i = 0; i < count; i++) {
    const [clientID, pos3] = readVarUint(update, pos);
    pos = pos3;
    const [clock, pos4] = readVarUint(update, pos);
    pos = pos4;
    const [state, pos5] = readVarString(update, pos);
    pos = pos5;

    const mappedId = clientID === fromId ? toId : clientID;
    result.push(...writeVarUint(mappedId));
    result.push(...writeVarUint(clock));
    result.push(...writeVarString(state));
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

    // 只发送本地 clientID 的更新给父页面
    // 其他 peers 的更新通过父页面的 WebrtcProvider 同步，不应该从 iframe 回传
    const localClientId = awareness.clientID;
    const localChanged = changes.includes(localClientId);
    if (!localChanged) return;

    const update = encodeAwarenessUpdate(awareness, [localClientId]);
    const remapped =
      serverClientId != null
        ? remapClientIdInUpdate(update, localClientId, serverClientId)
        : update;

    const message = { type: "awareness-update", payload: Array.from(remapped) };
    logMessage("send", "awareness-update", message);
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

      // 直接使用 server 发送的原始 clientID，不做映射
      // iframe 的 awareness 中会包含：
      // - iframe 自身的 clientID (awareness.clientID)
      // - server 的 clientID (serverClientId)
      // - 其他 Webrtc peers 的 clientID
      applyingParentUpdate = true;
      applyAwarenessUpdate(awareness, new Uint8Array(payload), null);

      // 从 server 的 awareness state 中提取 user 信息并同步到本地
      // 避免 binding 生成随机用户信息后通过 remap 覆盖父页面的真实用户
      let localUserSynced = false;
      if (serverClientId != null) {
        const serverState = awareness.getStates().get(serverClientId);
        if (serverState) {
          const serverUserAccount = (
            serverState as { user?: { account?: unknown } }
          ).user?.account;
          const serverUserName = (serverState as { user?: { name?: unknown } })
            .user?.name;
          const serverUserColor = (
            serverState as { user?: { color?: unknown } }
          ).user?.color;
          if (serverUserAccount || serverUserName || serverUserColor) {
            const currentLocal = awareness.getLocalState() || {};
            const currentUser = ((currentLocal as Record<string, unknown>)
              .user || {}) as Record<string, unknown>;
            const nextUser: Record<string, unknown> = { ...currentUser };
            if (serverUserAccount) {
              nextUser.account = serverUserAccount;
            }
            if (serverUserName) {
              nextUser.name = serverUserName;
            }
            if (serverUserColor) {
              nextUser.color = serverUserColor;
            }
            const userChanged =
              currentUser.account !== nextUser.account ||
              currentUser.name !== nextUser.name ||
              currentUser.color !== nextUser.color;
            if (userChanged) {
              awareness.setLocalState({
                ...currentLocal,
                user: nextUser,
              });
              localUserSynced = true;
            }
          }
        }
      }

      applyingParentUpdate = false;

      // 如果同步了本地 user info，需要发送一次更新给父页面
      // 恢复可能被随机值覆盖的 server user 信息
      if (localUserSynced && serverClientId != null) {
        const update = encodeAwarenessUpdate(awareness, [awareness.clientID]);
        const remapped = remapClientIdInUpdate(
          update,
          awareness.clientID,
          serverClientId,
        );
        const message = { type: "awareness-update", payload: Array.from(remapped) };
        logMessage("send", "awareness-update", message);
        window.parent.postMessage(message, "*");
      }
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
