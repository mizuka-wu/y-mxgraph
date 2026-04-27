/**
 * SharedWorker — 三层协作中央节点
 *
 * 层级：
 *   1. SharedWorker 内存：同浏览器跨标签实时同步
 *   2. IndexedDB (idb-keyval)：持久化，新标签/刷新恢复
 *   3. y-webrtc：跨浏览器 P2P 同步
 *
 * 消息协议（JSON）：
 *   { type: "sync-step1", sv: number[] }           — 请求全量同步
 *   { type: "sync-step2", update: number[] }        — 回复完整 diff
 *   { type: "update",     update: number[] }        — 增量 update
 *   { type: "awareness",  update: number[] }        — awareness update
 *   { type: "awareness-remove", clients: number[] } — 客户端离线通知
 *   { type: "leave",      clientId: number }        — port 主动离开
 */

import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { WebrtcProvider } from "y-webrtc";
import { get, set } from "idb-keyval";

const _self = self as unknown as SharedWorkerGlobalScope;

const roomName =
  new URL(_self.location.href).searchParams.get("room") ?? "y-mxgraph-default";
const IDB_KEY = `y-mxgraph:${roomName}`;

const doc = new Y.Doc();
const awareness = new awarenessProtocol.Awareness(doc);

const ports = new Set<MessagePort>();
const portClientId = new Map<MessagePort, number>();

// IDB 恢复前收到的 sync-step1 请求队列
let idbReady = false;
const pendingSyncPorts: MessagePort[] = [];

type Msg =
  | { type: "sync-step1"; sv: number[] }
  | { type: "sync-step2"; update: number[] }
  | { type: "update"; update: number[] }
  | { type: "awareness"; update: number[] }
  | { type: "awareness-remove"; clients: number[] }
  | { type: "leave"; clientId: number };

function send(port: MessagePort, msg: Msg) {
  try {
    port.postMessage(msg);
  } catch (_) {
    // port 已关闭
  }
}

function broadcast(msg: Msg, exclude?: MessagePort) {
  ports.forEach((p) => {
    if (p !== exclude) send(p, msg);
  });
}

// ── IndexedDB 持久化 ──────────────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    const state = Y.encodeStateAsUpdate(doc);
    await set(IDB_KEY, state).catch(() => undefined);
  }, 500);
}

async function restoreFromIDB(): Promise<void> {
  const saved = await get<Uint8Array>(IDB_KEY).catch(() => undefined);
  if (saved && saved.byteLength > 0) {
    Y.applyUpdate(doc, saved, "idb");
  }
}

// ── y-webrtc 跨浏览器同步 ─────────────────────────────────────────

function initWebrtc() {
  new WebrtcProvider(roomName, doc, {
    awareness,
    signaling: ["wss://y-webrtc-eu.fly.dev", "wss://y-webrtc-oc.fly.dev"],
  });
}

// ── doc / awareness 事件 ─────────────────────────────────────────

doc.on("update", (update: Uint8Array, origin: unknown) => {
  // origin 是发送方 port 时排除它，避免重复 apply
  const exclude = origin instanceof MessagePort ? origin : undefined;
  broadcast({ type: "update", update: Array.from(update) }, exclude);
  if (origin !== "idb") scheduleSave();
});

awareness.on(
  "update",
  ({
    added,
    updated,
    removed,
  }: {
    added: number[];
    updated: number[];
    removed: number[];
  }) => {
    const changed = [...added, ...updated, ...removed];
    const aUpdate = awarenessProtocol.encodeAwarenessUpdate(awareness, changed);
    broadcast({ type: "awareness", update: Array.from(aUpdate) });
    if (removed.length > 0) {
      broadcast({ type: "awareness-remove", clients: removed });
    }
  },
);

// ── Port 管理 ────────────────────────────────────────────────────

function removePort(port: MessagePort) {
  const clientId = portClientId.get(port);
  ports.delete(port);
  portClientId.delete(port);
  if (clientId !== undefined) {
    awarenessProtocol.removeAwarenessStates(awareness, [clientId], "leave");
  }
}

function handlePort(port: MessagePort) {
  ports.add(port);

  port.onmessage = (e: MessageEvent<Msg>) => {
    const msg = e.data;
    switch (msg.type) {
      case "sync-step1": {
        if (!idbReady) {
          // IDB 还未恢复，先排队，恢复后统一处理
          pendingSyncPorts.push(port);
        } else {
          doSync(port);
        }
        break;
      }
      case "update": {
        Y.applyUpdate(doc, new Uint8Array(msg.update), port);
        break;
      }
      case "awareness": {
        // 记录新 clientId 归属
        const beforeIds = new Set(awareness.getStates().keys());
        awarenessProtocol.applyAwarenessUpdate(
          awareness,
          new Uint8Array(msg.update),
          port,
        );
        if (!portClientId.has(port)) {
          awareness.getStates().forEach((_, clientId) => {
            if (!beforeIds.has(clientId)) {
              portClientId.set(port, clientId);
            }
          });
        }
        break;
      }
      case "leave": {
        portClientId.set(port, msg.clientId);
        removePort(port);
        break;
      }
    }
  };

  port.onmessageerror = () => removePort(port);
}

// ── 工具函数 ─────────────────────────────────────────────────────

function doSync(port: MessagePort) {
  const diff = Y.encodeStateAsUpdate(doc);
  send(port, { type: "sync-step2", update: Array.from(diff) });

  const clients = Array.from(awareness.getStates().keys());
  if (clients.length > 0) {
    const aUpdate = awarenessProtocol.encodeAwarenessUpdate(awareness, clients);
    send(port, { type: "awareness", update: Array.from(aUpdate) });
  }
}

// ── 启动 ─────────────────────────────────────────────────────────

restoreFromIDB().then(() => {
  idbReady = true;
  // 处理在 IDB 恢复前积压的 sync-step1
  pendingSyncPorts.splice(0).forEach(doSync);
  initWebrtc();
});

_self.onconnect = (e: MessageEvent) => {
  const port = e.ports[0];
  handlePort(port);
  port.start();
};
