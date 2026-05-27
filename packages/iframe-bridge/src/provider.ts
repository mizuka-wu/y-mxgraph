import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
} from "y-protocols/awareness";

/**
 * Awareness-like 接口，只需要支持本地状态管理。
 * 用于 iframe-bridge provider 不需要与父页面同步 awareness 的场景。
 */
export interface AwarenessLike {
  readonly clientID: number;
  readonly states: Map<number, Record<string, unknown>>;
  getStates(): Map<number, Record<string, unknown>>;
  getLocalState(): Record<string, unknown> | null;
  setLocalState(state: Record<string, unknown> | null): void;
  setLocalStateField(field: string, value: unknown): void;
  on(event: "update", handler: (update: { added: number[]; updated: number[]; removed: number[] }) => void): void;
  off(event: "update", handler: (update: { added: number[]; updated: number[]; removed: number[] }) => void): void;
}

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
  awareness?: Awareness;
  debug?: boolean;
}

export interface IframeBridgeProvider {
  serverClientId: number | null;
  connected: boolean;
  awareness: Awareness;
  onConnect: (fn: () => void) => () => void;
  onDisconnect: (fn: () => void) => () => void;
  on: (event: "connect" | "disconnect", fn: () => void) => () => void;
  setLocalFields: (fields: Record<string, unknown>) => void;
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

function parseAwarenessPayload(data: Uint8Array): Map<number, Record<string, unknown>> {
  const result = new Map<number, Record<string, unknown>>();
  let pos = 0;
  const [count, pos2] = readVarUint(data, pos);
  pos = pos2;

  for (let i = 0; i < count; i++) {
    const [clientID, pos3] = readVarUint(data, pos);
    pos = pos3;
    const [, pos4] = readVarUint(data, pos);
    pos = pos4;
    const [stateStr, pos5] = readVarString(data, pos);
    pos = pos5;

    if (stateStr) {
      try {
        result.set(clientID, JSON.parse(stateStr));
      } catch {
        // no-op
      }
    }
  }
  return result;
}

export function createIframeBridgeProvider(
  ydoc: Y.Doc,
  options?: IframeBridgeProviderOptions,
): IframeBridgeProvider {
  const { awareness: externalAwareness, debug = false } = options ?? {};
  let applyingParentUpdate = false;
  let serverClientId: number | null = null;
  let currentCleanup: (() => void) | null = null;
  let currentMxLike: MxLike | null = null;
  let pendingUndoState: {
    undoStackSize?: number;
    redoStackSize?: number;
  } | null = null;
  let connected = false;
  let initRetryTimer: ReturnType<typeof setInterval> | null = null;
  const connectListeners = new Set<() => void>();
  const disconnectListeners = new Set<() => void>();

  const log = debug
    ? (...args: unknown[]) => console.log("[iframe-bridge provider]", ...args)
    : () => undefined;

  const useExternalAwareness = !!externalAwareness;
  let awareness: Awareness | AwarenessLike;
  const localStates = new Map<number, Record<string, unknown>>();
  const localClientId = Math.floor(Math.random() * 2147483647) + 1;
  const updateHandlers = new Set<(update: { added: number[]; updated: number[]; removed: number[] }) => void>();

  function createAwarenessLike(): AwarenessLike {
    let pendingState: Record<string, unknown> | null | undefined = undefined;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const FLUSH_INTERVAL = 50;

    function getEffectiveClientId() {
      return serverClientId ?? localClientId;
    }

    function scheduleFlush() {
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        if (pendingState !== undefined && connected) {
          window.parent.postMessage({ type: "awareness-local-state", state: pendingState }, "*");
          pendingState = undefined;
        }
      }, FLUSH_INTERVAL);
    }

    return {
      get clientID() {
        return getEffectiveClientId();
      },
      get states() {
        return localStates;
      },
      getStates() {
        return new Map(localStates);
      },
      getLocalState() {
        return localStates.get(getEffectiveClientId()) ?? null;
      },
      setLocalState(state: Record<string, unknown> | null) {
        const id = getEffectiveClientId();
        if (state === null) {
          localStates.delete(id);
        } else {
          localStates.set(id, state);
        }
        pendingState = state;
        scheduleFlush();
        const update = { added: state && !localStates.has(id) ? [id] : [], updated: state ? [id] : [], removed: state === null ? [id] : [] };
        updateHandlers.forEach(handler => handler(update));
      },
      setLocalStateField(field: string, value: unknown) {
        const id = getEffectiveClientId();
        const current = localStates.get(id) || {};
        const newState = { ...current, [field]: value };
        localStates.set(id, newState);
        pendingState = newState;
        scheduleFlush();
        const update = { added: [], updated: [id], removed: [] };
        updateHandlers.forEach(handler => handler(update));
      },
      on(event: "update", handler: (update: { added: number[]; updated: number[]; removed: number[] }) => void) {
        if (event === "update") {
          updateHandlers.add(handler);
        }
      },
      off(event: "update", handler: (update: { added: number[]; updated: number[]; removed: number[] }) => void) {
        if (event === "update") {
          updateHandlers.delete(handler);
        }
      },
    };
  }

  if (externalAwareness) {
    awareness = externalAwareness;
  } else {
    awareness = createAwarenessLike();
  }

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
    if (applyingParentUpdate) {
      return;
    }
    if (!connected) {
      return;
    }
    const changes = [...added, ...updated, ...removed];
    if (changes.length === 0) return;

    const localClientId = awareness.clientID;
    const localChanged = changes.includes(localClientId);
    if (!localChanged) return;

    const state = awareness.getLocalState();
    const message = { type: "awareness-local-state", state };
    logMessage("send", "awareness-local-state", state);
    window.parent.postMessage(message, "*");
  };

  const syncUndoStateFromServer = (
    mxLike: MxLike,
    data: { undoStackSize?: number; redoStackSize?: number },
  ) => {
    const { undoStackSize, redoStackSize } = data;
    const oldIndex = mxLike.indexOfNextAdd;
    const newIndex = undoStackSize || 0;
    const newTotal = (undoStackSize || 0) + (redoStackSize || 0);
    applyingParentUpdate = true;
    mxLike.history = new Array(newTotal).fill({});
    mxLike.indexOfNextAdd = newIndex;
    if (newTotal === 0) {
      mxLike.fireEvent(createMxEventObject("clear"));
    } else if (newIndex < oldIndex) {
      mxLike.fireEvent(
        createMxEventObject("undo", { edit: { changes: [] } }),
      );
    } else if (newIndex > oldIndex) {
      mxLike.fireEvent(
        createMxEventObject("redo", { edit: { changes: [] } }),
      );
    } else {
      mxLike.fireEvent(
        createMxEventObject("add", { edit: { changes: [] } }),
      );
    }
    applyingParentUpdate = false;
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
      const prevLocalId = localClientId;
      if (receivedServerId != null) {
        serverClientId = receivedServerId;
        if (useExternalAwareness === false && receivedServerId != null && prevLocalId !== receivedServerId) {
          const tempState = localStates.get(prevLocalId);
          if (tempState) {
            localStates.delete(prevLocalId);
            localStates.set(receivedServerId, tempState);
          }
        }
      }

      if (useExternalAwareness) {
        const serverId = receivedServerId ?? serverClientId;
        const localId = awareness.clientID;
        
        applyingParentUpdate = true;
        if (serverId != null && serverId !== localId) {
          const remapped = remapClientIdInUpdate(
            new Uint8Array(payload),
            serverId,
            localId,
          );
          
          if (type === "awareness-sync") {
            (awareness as Awareness).meta.delete(localId);
            awareness.setLocalState(null);
          }
          
          applyAwarenessUpdate(awareness as Awareness, remapped, null);
        } else {
          applyAwarenessUpdate(awareness as Awareness, new Uint8Array(payload), null);
        }
        applyingParentUpdate = false;
      } else {
        const parsedStates = parseAwarenessPayload(new Uint8Array(payload));
        applyingParentUpdate = true;
        const changedClientIds: number[] = [];
        for (const [id, state] of parsedStates) {
          const existed = localStates.has(id);
          const changed = !existed || JSON.stringify(localStates.get(id)) !== JSON.stringify(state);
          localStates.set(id, state);
          if (changed) {
            changedClientIds.push(id);
          }
        }
        if (changedClientIds.length > 0) {
          const update = { added: [], updated: changedClientIds, removed: [] };
          updateHandlers.forEach(handler => handler(update));
        }
        applyingParentUpdate = false;
      }
    } else if (type === "undo-state") {
      if (!currentMxLike) {
        pendingUndoState = event.data;
      } else {
        syncUndoStateFromServer(currentMxLike, event.data);
      }
    } else if (type === "disconnect") {
      setConnected(false);
      startInitRetry();
    }
  };

  ydoc.on("update", onYdocUpdate);
  // 只有真正的 y-protocols Awareness 实例才有 .on() 方法
  // AwarenessLike（内部创建的）通过 updateHandlers 管理回调
  if (useExternalAwareness) {
    (awareness as Awareness).on("update", onAwarenessUpdate);
  }
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
    get awareness() {
      return awareness as Awareness;
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
    setLocalFields(fields: Record<string, unknown>) {
      const currentLocal = awareness.getLocalState() || {};
      const currentUser = (currentLocal as { user?: Record<string, unknown> }).user || {};
      const newUser = { ...currentUser, ...fields };
      awareness.setLocalState({
        ...currentLocal,
        user: newUser,
      });
      // 通知父页面更新本地字段，父页面可选择是否处理
      if (connected) {
        const message = { type: "set-local-fields", fields };
        logMessage("send", "set-local-fields", fields);
        window.parent.postMessage(message, "*");
      }
    },
    takeoverUndoManager(file: DrawioFile) {
      if (currentCleanup) {
        currentCleanup();
      }

      const editor = file.getUi().editor;
      const originUndoManager = editor.undoManager;

      // bindUndoManager 已安装：不替换 editor.undoManager，只委托 undo/redo
      if (originUndoManager && "_y" in originUndoManager) {
        const mxLike = originUndoManager as MxLike;
        const origUndo = mxLike.undo.bind(mxLike);
        const origRedo = mxLike.redo.bind(mxLike);
        const origCanUndo = mxLike.canUndo.bind(mxLike);
        const origCanRedo = mxLike.canRedo.bind(mxLike);
        currentMxLike = mxLike;
        mxLike.undo = () => {
          if (!applyingParentUpdate) {
            window.parent.postMessage({ type: "undo" }, "*");
          } else {
            origUndo();
          }
        };
        mxLike.redo = () => {
          if (!applyingParentUpdate) {
            window.parent.postMessage({ type: "redo" }, "*");
          } else {
            origRedo();
          }
        };
        mxLike.canUndo = () => mxLike.indexOfNextAdd > 0;
        mxLike.canRedo = () => mxLike.indexOfNextAdd < mxLike.history.length;
        if (pendingUndoState) {
          syncUndoStateFromServer(mxLike, pendingUndoState);
          pendingUndoState = null;
        }
        window.parent.postMessage({ type: "request-undo-state" }, "*");
        const cleanup = () => {
          mxLike.undo = origUndo;
          mxLike.redo = origRedo;
          mxLike.canUndo = origCanUndo;
          mxLike.canRedo = origCanRedo;
          currentMxLike = null;
          pendingUndoState = null;
        };
        currentCleanup = cleanup;
        return cleanup;
      }

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
      editor.undoManager = mxLike as unknown as DrawioEditor["undoManager"];
      editor.undoListener = function () {};

      if (pendingUndoState) {
        syncUndoStateFromServer(mxLike, pendingUndoState);
        pendingUndoState = null;
      }
      window.parent.postMessage({ type: "request-undo-state" }, "*");

      const cleanup = () => {
        editor.undoManager = originUndoManager;
        editor.undoListener = originUndoManager?.undoListener as
          | ((...args: unknown[]) => void)
          | undefined;
        currentMxLike = null;
        pendingUndoState = null;
      };

      currentCleanup = cleanup;
      return cleanup;
    },
    destroy: () => {
      ydoc.off("update", onYdocUpdate);
      if (useExternalAwareness) {
        (awareness as Awareness).off("update", onAwarenessUpdate);
      }
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
