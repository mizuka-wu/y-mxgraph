import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
} from "y-protocols/awareness";
import { IFRAME_ORIGIN, BASELINE_ORIGIN } from "./origin.js";
const IFRAME_BRIDGE_STATE_KEYS = new Set(["cursor", "selection"]);

function isIframeBridgeStateKey(key: string): boolean {
  return IFRAME_BRIDGE_STATE_KEYS.has(key);
}

function getAwarenessStateFieldChanges(
  prev: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): Array<{ key: string; value: unknown }> {
  const keys = new Set([
    ...Object.keys(prev ?? {}),
    ...Object.keys(next ?? {}),
  ]);
  const changes: Array<{ key: string; value: unknown }> = [];
  for (const key of keys) {
    const prevValue = prev?.[key];
    const nextValue = next?.[key];
    if (JSON.stringify(prevValue) !== JSON.stringify(nextValue)) {
      changes.push({ key, value: nextValue });
    }
  }
  return changes;
}

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
  /** 一致性检查间隔（毫秒），0 或不传则禁用。定期比较 state vector，不一致时请求 full sync。 */
  consistencyCheckInterval?: number;
  /** pending update 超时回调（ms），不传则不检测 */
  pendingTimeoutMs?: number;
  /** pending update 超时触发的回调 */
  onPendingTimeout?: (info: { pendingCount: number; oldestMs: number }) => void;
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
  forceSyncToServer: () => void;
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
  const { awareness: externalAwareness, debug = false, consistencyCheckInterval = 0 } = options ?? {};
  let applyingParentUpdate = false;
  let serverClientId: number | null = null;
  let currentCleanup: (() => void) | null = null;
  let currentMxLike: MxLike | null = null;
  let pendingUndoState: {
    undoStackSize?: number;
    redoStackSize?: number;
  } | null = null;
  let connected = false;
  let forceFullSync = false;
  const MAX_QUEUE_SIZE = 1000;
  const pendingYdocUpdates: Array<{update: Uint8Array, isBaseline: boolean}> = [];
  let seq = 0;
  const unackedYdocUpdates = new Map<number, { update: Uint8Array; isBaseline: boolean; sentAt: number }>();
  let initRetryTimer: ReturnType<typeof setInterval> | null = null;
  let consistencyTimer: ReturnType<typeof setInterval> | null = null;
  let pendingCheckTimer: ReturnType<typeof setTimeout> | null = null;

  const { pendingTimeoutMs, onPendingTimeout } = options ?? {};

  function schedulePendingCheck() {
    if (pendingCheckTimer || !pendingTimeoutMs || !onPendingTimeout) return;
    pendingCheckTimer = setTimeout(() => {
      pendingCheckTimer = null;
      const now = Date.now();
      const unackedCount = unackedYdocUpdates.size;
      const pendingCount = pendingYdocUpdates.length;
      if (unackedCount > 0 || pendingCount > 0) {
        const oldest = unackedCount > 0
          ? Math.min(...Array.from(unackedYdocUpdates.values()).map((v) => v.sentAt))
          : now;
        onPendingTimeout({
          pendingCount: unackedCount + pendingCount,
          oldestMs: now - oldest,
        });
      }
    }, pendingTimeoutMs);
  }
  
  // Legacy mode detection: old servers don't send protocolVersion in pong
  let serverSupportsAck = false;
  let legacyMode = false;
  const connectListeners = new Set<() => void>();
  const disconnectListeners = new Set<() => void>();
  let lastLocalAwarenessSnapshot: Record<string, unknown> | null = null;

  const log = debug
    ? (...args: unknown[]) => console.log("[iframe-bridge provider]", ...args)
    : () => undefined;

  const useExternalAwareness = !!externalAwareness;
  let awareness: Awareness | AwarenessLike;
  const localStates = new Map<number, Record<string, unknown>>();
  const localClientId = Math.floor(Math.random() * 2147483647) + 1;
  const updateHandlers = new Set<(update: { added: number[]; updated: number[]; removed: number[] }) => void>();

  function createAwarenessLike(): AwarenessLike {
    function getEffectiveClientId() {
      return serverClientId ?? localClientId;
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
          const update = { added: [], updated: [], removed: [id] };
          updateHandlers.forEach(handler => handler(update));
        } else {
          const existed = localStates.has(id);
          localStates.set(id, state);
          const update = { added: !existed ? [id] : [], updated: [id], removed: [] };
          updateHandlers.forEach(handler => handler(update));
        }
      },
      setLocalStateField(field: string, value: unknown) {
        const id = getEffectiveClientId();
        const current = localStates.get(id) || {};
        const newState = { ...current, [field]: value };
        localStates.set(id, newState);
        postSetLocalStateToParent(field, value);
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

  function snapshotLocalAwarenessState() {
    const state = awareness.getLocalState();
    lastLocalAwarenessSnapshot = state ? { ...state } : null;
  }

  function postSetLocalStateToParent(key: string, value: unknown) {
    if (!connected || !isIframeBridgeStateKey(key)) return;
    const message = { type: "set-local-state", key, value };
    logMessage("send", "set-local-state", message);
    window.parent.postMessage(message, "*");
  }

  function parentPostMessage(message: unknown) {
    logMessage("send", (message as { type?: string }).type ?? "postMessage", message);
    window.parent.postMessage(message, "*");
  }

  function setConnected(value: boolean) {
    if (connected === value) return;
    connected = value;
    if (value) {
      forceFullSync = false;
      snapshotLocalAwarenessState();
      while (pendingYdocUpdates.length > 0) {
        const { update, isBaseline } = pendingYdocUpdates.shift()!;
        if (legacyMode) {
          const message = { type: "ydoc-update", payload: Array.from(update), isBaseline };
          window.parent.postMessage(message, "*");
        } else {
          const seqNum = ++seq;
          const message = { type: "ydoc-update", payload: Array.from(update), isBaseline, seq: seqNum };
          window.parent.postMessage(message, "*");
          unackedYdocUpdates.set(seqNum, { update, isBaseline, sentAt: Date.now() });
        }
      }
      if (!legacyMode) {
        for (const [savedSeq, { update, isBaseline }] of unackedYdocUpdates) {
          const message = { type: "ydoc-update", payload: Array.from(update), isBaseline, seq: savedSeq };
          window.parent.postMessage(message, "*");
        }
      }
      connectListeners.forEach((fn) => fn());
      // 连接后启动一致性检查
      startConsistencyCheck();
    } else {
      lastLocalAwarenessSnapshot = null;
      if (!legacyMode) {
        unackedYdocUpdates.clear();
      }
      disconnectListeners.forEach((fn) => fn());
    }
  }

  function startInitRetry() {
    if (initRetryTimer) {
      clearInterval(initRetryTimer);
    }
    if (!forceFullSync && pendingYdocUpdates.length > 0) {
      if (!legacyMode) {
        const updates = pendingYdocUpdates.splice(0);
        parentPostMessage({
          type: "ydoc-pending-updates",
          payload: updates.map(u => ({ update: Array.from(u.update), isBaseline: u.isBaseline })),
        });
      } else {
        for (const { update, isBaseline } of pendingYdocUpdates) {
          parentPostMessage({ type: "ydoc-update", payload: Array.from(update), isBaseline });
        }
        pendingYdocUpdates.length = 0;
      }
    }
    parentPostMessage({ type: "init" });
    initRetryTimer = setInterval(() => {
      if (!connected) {
        parentPostMessage({ type: "init" });
      }
    }, 1000);
  }

  function startConsistencyCheck() {
    if (consistencyTimer) clearInterval(consistencyTimer);
    if (consistencyCheckInterval <= 0) return;
    consistencyTimer = setInterval(() => {
      if (!connected) return;
      // 发送本地 state vector 给 server 比较
      const sv = Y.encodeStateVector(ydoc);
      parentPostMessage({ type: "consistency-check", stateVector: Array.from(sv) });
      log("consistency-check sent");
    }, consistencyCheckInterval);
  }

  const onYdocUpdate = (update: Uint8Array, origin: unknown) => {
    if (applyingParentUpdate) return;
    // 检测基线数据：origin 为 null 时是 xml2ydoc 首次初始化
    const isBaseline = origin === null || origin === undefined;
    if (!connected) {
      if (pendingYdocUpdates.length >= MAX_QUEUE_SIZE) {
        forceFullSync = true;
        pendingYdocUpdates.length = 0;
        console.warn("[iframe-bridge] queue full, forcing full sync on reconnect");
      }
      pendingYdocUpdates.push({ update, isBaseline });
      schedulePendingCheck();
      return;
    }
    if (legacyMode) {
      const message = { type: "ydoc-update", payload: Array.from(update), isBaseline };
      logMessage("send", "ydoc-update", message);
      window.parent.postMessage(message, "*");
    } else {
      const seqNum = ++seq;
      const message = { type: "ydoc-update", payload: Array.from(update), isBaseline, seq: seqNum };
      logMessage("send", "ydoc-update", message);
      window.parent.postMessage(message, "*");
      unackedYdocUpdates.set(seqNum, { update, isBaseline, sentAt: Date.now() });
      schedulePendingCheck();
    }
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

    const nextState = awareness.getLocalState();
    const fieldChanges = getAwarenessStateFieldChanges(
      lastLocalAwarenessSnapshot,
      nextState,
    );
    lastLocalAwarenessSnapshot = nextState ? { ...nextState } : null;
    for (const { key, value } of fieldChanges) {
      postSetLocalStateToParent(key, value);
    }
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
    if (!event.data || typeof event.data !== 'object') return;
    const { type, payload, serverClientId: receivedServerId } = event.data;

    logMessage("recv", type, payload);
    if (type === "pong" && receivedServerId != null) {
      serverClientId = receivedServerId;
      // 版本号检测：新版 server 在 pong 里带 protocolVersion
      if (event.data.protocolVersion >= 2) {
        serverSupportsAck = true;
        if (legacyMode) {
          // ydoc-sync 先到且无 protocolVersion 时误判了 legacy，纠正回来
          legacyMode = false;
          log("server supports ack (protocol v" + event.data.protocolVersion + ", corrected from legacy)");
        } else {
          log("server supports ack (protocol v" + event.data.protocolVersion + ")");
        }
      } else if (!serverSupportsAck) {
        legacyMode = true;
        unackedYdocUpdates.clear();
        log("legacy mode detected: server has no protocolVersion");
      }
      return;
    }
    if (type === "ydoc-update-ack") {
      const ackSeq = event.data.seq;
      if (ackSeq != null) {
        unackedYdocUpdates.delete(ackSeq);
      }
      return;
    }

    if (type === "ydoc-sync" || type === "ydoc-update") {
      applyingParentUpdate = true;
      // 使用 origin 区分 baseline vs 编辑数据，server 端 UndoManager 可据此追踪
      const isBaseline = (event.data && typeof event.data === "object" && event.data.isBaseline) ? true : false;
      const applyOrigin = isBaseline ? BASELINE_ORIGIN : IFRAME_ORIGIN;
      Y.applyUpdate(ydoc, new Uint8Array(payload), applyOrigin);
      applyingParentUpdate = false;
      // ydoc-sync 也可能带 protocolVersion（兜底检测，正常情况 pong 已检测）
      if (type === "ydoc-sync" && event.data.protocolVersion != null) {
        if (event.data.protocolVersion >= 2 && !serverSupportsAck) {
          serverSupportsAck = true;
          log("server supports ack (protocol v" + event.data.protocolVersion + ", via ydoc-sync)");
        }
      } else if (type === "ydoc-sync" && !serverSupportsAck && !legacyMode) {
        // ydoc-sync 无 protocolVersion 且 pong 还没来 → 先切 legacy
        // 如果 pong 后来带 protocolVersion 会纠正回来
        legacyMode = true;
        unackedYdocUpdates.clear();
        log("legacy mode tentative: ydoc-sync has no protocolVersion");
      }
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
        const removedClientIds: number[] = [];
        for (const [id, state] of parsedStates) {
          const existed = localStates.has(id);
          const changed = !existed || JSON.stringify(localStates.get(id)) !== JSON.stringify(state);
          localStates.set(id, state);
          if (changed) {
            changedClientIds.push(id);
          }
        }
        for (const [id] of localStates) {
          if (!parsedStates.has(id)) {
            localStates.delete(id);
            removedClientIds.push(id);
          }
        }
        if (changedClientIds.length > 0 || removedClientIds.length > 0) {
          const update = { added: [], updated: changedClientIds, removed: removedClientIds };
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
    } else if (type === "force-sync") {
      // server 检测到不一致，强制发送完整 state
      log("received force-sync from server");
      const fullState = Y.encodeStateAsUpdate(ydoc);
      parentPostMessage({ type: "ydoc-pending-updates", payload: [{ update: Array.from(fullState), isBaseline: false }] });
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
    forceSyncToServer() {
      if (!connected) return;
      const fullState = Y.encodeStateAsUpdate(ydoc);
      window.parent.postMessage({ type: "ydoc-pending-updates", payload: [{ update: Array.from(fullState), isBaseline: false }] }, "*");
      unackedYdocUpdates.clear();
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
      while (pendingYdocUpdates.length > 0) {
        const { update, isBaseline } = pendingYdocUpdates.shift()!;
        window.parent.postMessage({ type: "ydoc-update", payload: Array.from(update), isBaseline }, "*");
      }
      unackedYdocUpdates.clear();
      ydoc.off("update", onYdocUpdate);
      if (useExternalAwareness) {
        (awareness as Awareness).off("update", onAwarenessUpdate);
      }
      window.removeEventListener("message", onMessage);
      if (initRetryTimer) {
        clearInterval(initRetryTimer);
        initRetryTimer = null;
      }
      if (consistencyTimer) {
        clearInterval(consistencyTimer);
        consistencyTimer = null;
      }
      connectListeners.clear();
      disconnectListeners.clear();
      if (currentCleanup) {
        currentCleanup();
      }
    },
  };
}
