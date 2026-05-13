import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { debounce } from "lodash-es";
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
import { Observable } from "./observable";

const DEFAULT_PING_INTERVAL = 5_000;
const DEFAULT_DISCONNECT_TIMEOUT = 15_000;
const DEFAULT_AWARENESS_DEBOUNCE = 50;

export interface YMxGraphBridgeProviderOptions {
  /**
   * Target origin for postMessage. Default "*".
   * In production, set this to the iframe's exact origin to prevent leaks.
   */
  targetOrigin?: string;
  /**
   * Acceptable `event.origin` for incoming messages. Defaults to any.
   * Provide the iframe's origin (e.g. "https://app.example.com") to harden.
   */
  expectedOrigin?: string | string[];
  /** Heartbeat interval (ms). Default 5000. */
  pingInterval?: number;
  /** Disconnect detection threshold (ms). Default 15000. */
  disconnectTimeout?: number;
  /** Awareness broadcast debounce (ms). Default 50. */
  awarenessDebounce?: number;
  /**
   * Awareness instance. Typically comes from your Yjs provider
   * (e.g. `webrtcProvider.awareness`, `wsProvider.awareness`) — **not**
   * from the Y.Doc, which does not carry an awareness.
   */
  awareness: Awareness;
  /**
   * Triggered when the iframe is considered disconnected (PONG timeout).
   * Default behaviour: log and stop the heartbeat. The provider is NOT
   * destroyed automatically so the host can attempt a reload.
   */
  onDisconnect?: () => void;
}

export type BridgeProviderEvent = "connected" | "disconnected" | "destroy";

/**
 * Host-side bridge. Owns the authoritative `Y.Doc` + `Awareness` and forwards
 * incremental updates to a single iframe via `postMessage`.
 */
export class YMxGraphBridgeProvider extends Observable<BridgeProviderEvent> {
  readonly iframe: HTMLIFrameElement;
  readonly doc: Y.Doc;
  readonly awareness: Awareness;

  private targetOrigin: string;
  private expectedOrigins: string[] | null;
  private pingInterval: number;
  private disconnectTimeout: number;

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastPong = Date.now();
  private connected = false;
  private destroyed = false;
  private onDisconnect?: () => void;

  private _onDocUpdate: (update: Uint8Array, origin: unknown) => void;
  private _onAwarenessChange: (change: {
    added: number[];
    updated: number[];
    removed: number[];
  }) => void;
  private _onMessage: (event: MessageEvent) => void;

  constructor(
    iframe: HTMLIFrameElement,
    doc: Y.Doc,
    options: YMxGraphBridgeProviderOptions,
  ) {
    super();
    if (!iframe) throw new Error("[iframe-bridge] iframe is required");
    if (!doc) throw new Error("[iframe-bridge] doc is required");
    if (!options || !options.awareness) {
      throw new Error(
        "[iframe-bridge] options.awareness is required (usually `provider.awareness`)",
      );
    }

    this.iframe = iframe;
    this.doc = doc;
    this.awareness = options.awareness;
    this.targetOrigin = options.targetOrigin ?? "*";
    this.expectedOrigins = options.expectedOrigin
      ? Array.isArray(options.expectedOrigin)
        ? options.expectedOrigin
        : [options.expectedOrigin]
      : null;
    this.pingInterval = options.pingInterval ?? DEFAULT_PING_INTERVAL;
    this.disconnectTimeout =
      options.disconnectTimeout ?? DEFAULT_DISCONNECT_TIMEOUT;
    this.onDisconnect = options.onDisconnect;

    // Forward local Y.Doc updates (i.e. updates from external providers or
    // host-side code) to the iframe. Skip updates that we just applied from
    // the iframe to break the echo loop.
    // Note: 不使用 transfer，让 postMessage 做结构化克隆，避免 detached ArrayBuffer 问题
    this._onDocUpdate = (update, origin) => {
      if (origin === BRIDGE_REMOTE_ORIGIN) return;
      this.send(makeMsg<SyncUpdatePayload>("SYNC_UPDATE", { update }));
    };
    doc.on("update", this._onDocUpdate);

    // Debounced full-snapshot broadcast of awareness.
    const pushAwareness = debounce(() => {
      const states = Array.from(this.awareness.getStates().entries()) as Array<
        [number, Record<string, unknown>]
      >;
      this.send(makeMsg<AwarenessPushPayload>("AWARENESS_PUSH", { states }));
    }, options.awarenessDebounce ?? DEFAULT_AWARENESS_DEBOUNCE);

    this._onAwarenessChange = () => {
      if (this.destroyed) return;
      pushAwareness();
    };
    this.awareness.on("change", this._onAwarenessChange);

    this._onMessage = (event) => this.handleMessage(event);
    window.addEventListener("message", this._onMessage);

    this.startPing();
  }

  /** Whether the iframe has responded to a recent ping. */
  isConnected(): boolean {
    return this.connected && !this.destroyed;
  }

  /** Manually push the full doc snapshot to the iframe (also used on SYNC_REQUEST). */
  sendFullSync(sv?: Uint8Array): void {
    const update = Y.encodeStateAsUpdate(this.doc, sv);
    // Note: 不使用 transfer，让 postMessage 做结构化克隆
    this.send(makeMsg<SyncUpdatePayload>("SYNC_UPDATE", { update }));
    // Also push the latest awareness snapshot so the iframe shows peers immediately.
    const states = Array.from(this.awareness.getStates().entries()) as Array<
      [number, Record<string, unknown>]
    >;
    this.send(makeMsg<AwarenessPushPayload>("AWARENESS_PUSH", { states }));
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
    this.awareness.off("change", this._onAwarenessChange);
    this.emit("destroy", []);
    super.destroy();
  }

  // ---- internals --------------------------------------------------------

  private getTargetWindow(): WindowProxy | null {
    return this.iframe.contentWindow;
  }

  private send(msg: BridgeMsg, transfer?: Transferable[]): void {
    const target = this.getTargetWindow();
    if (!target) return;
    target.postMessage(msg, this.targetOrigin, transfer ?? []);
  }

  private handleMessage(event: MessageEvent): void {
    if (this.destroyed) return;
    if (event.source !== this.getTargetWindow()) return;
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
      case "SYNC_REQUEST": {
        const payload = (msg.payload as SyncRequestPayload) ?? {};
        const sv = payload.sv
          ? payload.sv instanceof Uint8Array
            ? payload.sv
            : new Uint8Array(payload.sv as ArrayBufferLike)
          : undefined;
        this.sendFullSync(sv);
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
        break;
      }
      case "AWARENESS_SET": {
        const payload = msg.payload as AwarenessSetPayload;
        // The iframe peer's local state lives in the host's awareness. This is
        // the v1.3 protocol design: a single 1:1 channel where the iframe is a
        // mirror of the host's local client identity.
        this.awareness.setLocalState(payload.state ?? null);
        this.markAlive();
        break;
      }
      default:
        // Ignore unknown message types
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
    if (!this.connected && !this.destroyed) {
      // never connected; keep retrying pings silently
      return;
    }
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
        "[iframe-bridge] iframe disconnected (no PONG within timeout)",
      );
    }
  }
}
