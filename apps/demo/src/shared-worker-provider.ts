/**
 * SharedWorkerProvider — 主线程侧
 * 对外接口与 WebrtcProvider 兼容：doc, awareness, on/off, destroy
 */

import * as Y from "yjs";
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";

type WorkerMsg =
  | { type: "sync-step1"; sv: number[] }
  | { type: "sync-step2"; update: number[] }
  | { type: "update"; update: number[] }
  | { type: "awareness"; update: number[] }
  | { type: "awareness-remove"; clients: number[] }
  | { type: "leave"; clientId: number };

export class SharedWorkerProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;

  private port: MessagePort;
  private _connected = false;
  private _destroyed = false;
  private _listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  constructor(doc: Y.Doc, workerUrl: string | URL) {
    this.doc = doc;
    this.awareness = new Awareness(doc);

    const worker = new SharedWorker(workerUrl, { type: "module" });
    this.port = worker.port;
    this.port.onmessage = (e: MessageEvent<WorkerMsg>) => this._handleMessage(e.data);
    this.port.start();

    this._connect();
  }

  get connected() {
    return this._connected;
  }

  private _connect() {
    // 请求全量同步
    const sv = Y.encodeStateVector(this.doc);
    this._send({ type: "sync-step1", sv: Array.from(sv) });

    // 本地 doc update → 推给 worker
    this.doc.on("update", this._onDocUpdate);

    // 本地 awareness 变化 → 只推自己这个 client
    this.awareness.on("update", this._onAwarenessUpdate);

    this._connected = true;
    // 异步 emit，确保调用方 on("status") 已注册
    queueMicrotask(() => {
      if (!this._destroyed) this._emit("status", { connected: true });
    });
  }

  private _onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    this._send({ type: "update", update: Array.from(update) });
  };

  private _onAwarenessUpdate = ({
    added,
    updated,
    removed,
  }: {
    added: number[];
    updated: number[];
    removed: number[];
  }) => {
    // 只上报本客户端自身的变化，其他客户端的变化来自 worker 广播
    const own = this.awareness.clientID;
    const changed = [...added, ...updated, ...removed];
    if (!changed.includes(own)) return;
    const update = encodeAwarenessUpdate(this.awareness, [own]);
    this._send({ type: "awareness", update: Array.from(update) });
  };

  private _handleMessage(msg: WorkerMsg) {
    switch (msg.type) {
      case "sync-step2":
      case "update": {
        Y.applyUpdate(this.doc, new Uint8Array(msg.update), this);
        break;
      }
      case "awareness": {
        applyAwarenessUpdate(
          this.awareness,
          new Uint8Array(msg.update),
          this,
        );
        break;
      }
      case "awareness-remove": {
        removeAwarenessStates(this.awareness, msg.clients, this);
        break;
      }
    }
  }

  private _send(msg: WorkerMsg) {
    try {
      this.port.postMessage(msg);
    } catch (_) {
      // port 已关闭
    }
  }

  on(event: string, fn: (...args: unknown[]) => void) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event)!.add(fn);
    return this;
  }

  off(event: string, fn: (...args: unknown[]) => void) {
    this._listeners.get(event)?.delete(fn);
    return this;
  }

  private _emit(event: string, ...args: unknown[]) {
    this._listeners.get(event)?.forEach((fn) => fn(...args));
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._connected = false;

    this.doc.off("update", this._onDocUpdate);
    this.awareness.off("update", this._onAwarenessUpdate);

    // 通知 worker 移除 awareness
    this._send({ type: "leave", clientId: this.awareness.clientID });

    this.awareness.destroy();
    this.port.close();
    this._emit("status", { connected: false });
  }
}
