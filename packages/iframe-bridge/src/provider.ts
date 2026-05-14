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

export interface IframeBridgeProvider {
  serverClientId: number | null;
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
): IframeBridgeProvider {
  let applyingParentUpdate = false;
  let serverClientId: number | null = null;
  let currentCleanup: (() => void) | null = null;
  let currentMxLike: MxLike | null = null;

  const onYdocUpdate = (update: Uint8Array) => {
    if (applyingParentUpdate) return;
    window.parent.postMessage(
      { type: "ydoc-update", payload: Array.from(update) },
      "*",
    );
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

    const update = encodeAwarenessUpdate(awareness, changes);
    const remapped =
      serverClientId != null
        ? remapClientIdInUpdate(update, awareness.clientID, serverClientId)
        : update;

    window.parent.postMessage(
      { type: "awareness-update", payload: Array.from(remapped) },
      "*",
    );
  };

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const { type, payload, serverClientId: receivedServerId } = event.data;

    if (type === "pong" && receivedServerId != null) {
      serverClientId = receivedServerId;
      return;
    }

    if (type === "ydoc-sync" || type === "ydoc-update") {
      applyingParentUpdate = true;
      Y.applyUpdate(ydoc, new Uint8Array(payload));
      applyingParentUpdate = false;
    } else if (type === "awareness-sync" || type === "awareness-update") {
      if (receivedServerId != null) {
        serverClientId = receivedServerId;
      }

      const raw = new Uint8Array(payload);
      const remapped =
        serverClientId != null
          ? remapClientIdInUpdate(raw, serverClientId, awareness.clientID)
          : raw;

      applyingParentUpdate = true;
      applyAwarenessUpdate(awareness, remapped, null);
      applyingParentUpdate = false;
    } else if (type === "add" && currentMxLike) {
      applyingParentUpdate = true;
      if (currentMxLike.indexOfNextAdd < currentMxLike.history.length) {
        currentMxLike.history.splice(
          currentMxLike.indexOfNextAdd,
          currentMxLike.history.length - currentMxLike.indexOfNextAdd,
        );
      }
      currentMxLike.history.push({});
      currentMxLike.indexOfNextAdd = currentMxLike.history.length;
      currentMxLike.fireEvent(
        createMxEventObject("add", { edit: { changes: [] } }),
      );
      applyingParentUpdate = false;
    } else if (type === "undo" && currentMxLike) {
      applyingParentUpdate = true;
      if (currentMxLike.indexOfNextAdd > 0) currentMxLike.indexOfNextAdd--;
      currentMxLike.fireEvent(
        createMxEventObject("undo", { edit: { changes: [] } }),
      );
      applyingParentUpdate = false;
    } else if (type === "redo" && currentMxLike) {
      applyingParentUpdate = true;
      if (currentMxLike.indexOfNextAdd < currentMxLike.history.length)
        currentMxLike.indexOfNextAdd++;
      currentMxLike.fireEvent(
        createMxEventObject("redo", { edit: { changes: [] } }),
      );
      applyingParentUpdate = false;
    } else if (type === "clear" && currentMxLike) {
      applyingParentUpdate = true;
      currentMxLike.history = [];
      currentMxLike.indexOfNextAdd = 0;
      currentMxLike.fireEvent(createMxEventObject("clear"));
      applyingParentUpdate = false;
    }
  };

  ydoc.on("update", onYdocUpdate);
  awareness.on("update", onAwarenessUpdate);
  window.addEventListener("message", onMessage);

  window.parent.postMessage({ type: "init" }, "*");

  return {
    get serverClientId() {
      return serverClientId;
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
      if (currentCleanup) {
        currentCleanup();
      }
    },
  };
}
