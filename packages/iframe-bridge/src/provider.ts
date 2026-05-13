import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";

export interface IframeBridgeProvider {
  serverClientId: number | null;
  dispose: () => void;
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
    dispose: () => {
      ydoc.off("update", onYdocUpdate);
      awareness.off("update", onAwarenessUpdate);
      window.removeEventListener("message", onMessage);
    },
  };
}
