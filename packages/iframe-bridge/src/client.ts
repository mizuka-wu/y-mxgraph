import * as Y from "yjs";
import {
  BRIDGE_REMOTE_ORIGIN,
  BRIDGE_SCOPE,
  type BridgeMsg,
  isBridgeMsg,
  makeMsg,
  type AwarenessPushPayload,
  type AwarenessSetPayload,
  type PingPayload,
  type PongPayload,
  type SyncRequestPayload,
  type SyncUpdatePayload,
} from "./types";
import { AwarenessStub } from "./awareness-stub";
import { Observable } from "./observable";

const DEFAULT_PING_INTERVAL = 5_000;
const DEFAULT_DISCONNECT_TIMEOUT = 15_000;

export interface YMxGraphBridgeClientOptions {
  /** Target origin for postMessage to parent. Default "*". */
  targetOrigin?: string;
  /** Accepted `event.origin` for inbound messages. */
  expectedOrigin?: string | string[];
  pingInterval?: number;
  disconnectTimeout?: number;
  /** Local Y.Doc to bind. If omitted, a new one is created. */
  doc?: Y.Doc;
  /** Parent window. Defaults to `window.parent`. */
  parentWindow?: Window;
  /** Fired when parent is considered unreachable. */
  onDisconnect?: () => void;
}

export type BridgeClientEvent = "synced" | "connected" | "disconnected" | "destroy";

/**
 * Guest-side bridge running inside the iframe. Owns a local Y.Doc which is
 * kept in sync with the host through `SYNC_UPDATE` messages, and exposes an
 * `AwarenessStub` whose state mutations are forwarded to the host.
 */
export class YMxGraphBridgeClient extends Observable<BridgeClientEvent> {
  readonly doc: Y.Doc;
  readonly awareness: AwarenessStub;
  private readonly parent: Window;
  private targetOrigin: string;
  private expectedOrigins: string[] | null;
  private pingInterval: number;
  private disconnectTimeout: number;

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastPong = Date.now();
  private connected = false;
  private synced = false;
  private destroyed = false;
  private onDisconnect?: () => void;

  private _onDocUpdate: (update: Uint8Array, origin: unknown) => void;
  private _onMessage: (event: MessageEvent) => void;

  constructor(options: YMxGraphBridgeClientOptions = {}) {
    super();
    this.doc = options.doc ?? new Y.Doc();
    this.parent = options.parentWindow ?? window.parent;
    if (!this.parent || this.parent === window) {
      throw new Error(
        "[iframe-bridge] YMxGraphBridgeClient must run inside an iframe (no parent window)",
      );
    }
    this.targetOrigin = options.targetOrigin ?? "*";
    this.expectedOrigins = options.expectedOrigin
      ? Array.isArray(options.expectedOrigin)
        ? options.expectedOrigin
        : [options.expectedOrigin]
      : null;
    this.pingInterval = options.pingInterval ?? DEFAULT_PING_INTERVAL;
    this.disconnectTimeout = options.disconnectTimeout ?? DEFAULT_DISCONNECT_TIMEOUT;
    this.onDisconnect = options.onDisconnect;

    this.awareness = new AwarenessStub(this.doc, (state) => {
      this.send(
        makeMsg<AwarenessSetPayload>("AWARENESS_SET", { state }),
      );
    });

    // Forward local doc updates to the host. Skip updates that were just
    // applied from the host.
    this._onDocUpdate = (update, origin) => {
      if (origin === BRIDGE_REMOTE_ORIGIN) return;
      this.send(
        makeMsg<SyncUpdatePayload>("SYNC_UPDATE", { update }),
        [update.buffer],
      );
    };
    this.doc.on("update", this._onDocUpdate);

    this._onMessage = (event) => this.handleMessage(event);
    window.addEventListener("message", this._onMessage);

    // Kick things off
    this.send(
      makeMsg<SyncRequestPayload>("SYNC_REQUEST", {
        sv: Y.encodeStateVector(this.doc),
      }),
    );
    this.startPing();
  }

  isConnected(): boolean {
    return this.connected && !this.destroyed;
  }

  isSynced(): boolean {
    return this.synced;
  }

  /** Request a full re-sync from the host. */
  requestSync(): void {
    this.send(
      makeMsg<SyncRequestPayload>("SYNC_REQUEST", {
        sv: Y.encodeStateVector(this.doc),
      }),
    );
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    window.removeEventListener("message", this._onMessage);
    this.doc.off("update", this._onDocUpdate);
    this.awareness.destroy();
    this.emit("destroy", []);
    super.destroy();
  }

  // ---- internals --------------------------------------------------------

  private send(msg: BridgeMsg, transfer?: Transferable[]): void {
    if (this.destroyed) return;
    this.parent.postMessage(msg, this.targetOrigin, transfer ?? []);
  }

  private handleMessage(event: MessageEvent): void {
    if (this.destroyed) return;
    if (event.source !== this.parent) return;
    if (
      this.expectedOrigins &&
      event.origin &&
      !this.expectedOrigins.includes(event.origin)
    ) {
      return;
    }
    if (!isBridgeMsg(event.data)) return;
    if (event.data.scope !== BRIDGE_SCOPE) return;

    const msg = event.data;
    switch (msg.type) {
      case "PING": {
        const payload = msg.payload as PingPayload;
        this.markAlive();
        this.send(makeMsg<PongPayload>("PONG", payload));
        break;
      }
      case "PONG": {
        this.markAlive();
        break;
      }
      case "SYNC_UPDATE": {
        const payload = msg.payload as SyncUpdatePayload;
        const update =
          payload.update instanceof Uint8Array
            ? payload.update
            : new Uint8Array(payload.update as ArrayBufferLike);
        Y.applyUpdate(this.doc, update, BRIDGE_REMOTE_ORIGIN);
        this.markAlive();
        if (!this.synced) {
          this.synced = true;
          this.emit("synced", []);
        }
        break;
      }
      case "AWARENESS_PUSH": {
        const payload = msg.payload as AwarenessPushPayload;
        this.awareness._applySnapshot(payload.states, BRIDGE_REMOTE_ORIGIN);
        this.markAlive();
        break;
      }
      default:
        break;
    }
  }

  private markAlive(): void {
    this.lastPong = Date.now();
    if (!this.connected) {
      this.connected = true;
      this.emit("connected", []);
    }
  }

  private startPing(): void {
    this.lastPong = Date.now();
    this.pingTimer = setInterval(() => {
      if (this.destroyed) return;
      if (Date.now() - this.lastPong > this.disconnectTimeout) {
        this.handleDisconnect();
        return;
      }
      this.send(makeMsg<PingPayload>("PING", { timestamp: Date.now() }));
    }, this.pingInterval);
  }

  private handleDisconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this.emit("disconnected", []);
    if (this.onDisconnect) {
      try {
        this.onDisconnect();
      } catch (err) {
        console.error("[iframe-bridge] onDisconnect threw:", err);
      }
    } else {
      console.warn(
        "[iframe-bridge] parent disconnected (no PONG within timeout)",
      );
    }
  }
}
