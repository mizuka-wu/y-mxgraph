/**
 * y-mxgraph iframe bridge message protocol.
 * See: y-mxgraph-iframe-bridge-doc.md (v1.3)
 */

export const BRIDGE_SCOPE = "y-mxgraph" as const;

export type BridgeScope = typeof BRIDGE_SCOPE;

export type BridgeMsgType =
  | "PING"
  | "PONG"
  | "SYNC_REQUEST"
  | "SYNC_UPDATE"
  | "AWARENESS_PUSH"
  | "AWARENESS_SET";

export interface BridgeMsg<T = unknown> {
  type: BridgeMsgType;
  scope: BridgeScope;
  payload: T;
}

export interface PingPayload {
  timestamp: number;
}

export type PongPayload = PingPayload;

export interface SyncUpdatePayload {
  /** Yjs incremental update. The underlying buffer is sent as Transferable. */
  update: Uint8Array;
}

export interface SyncRequestPayload {
  /** Optional state vector so the host can return a diff. */
  sv?: Uint8Array;
}

export interface AwarenessPushPayload {
  /** Full snapshot as an array of [clientID, state] tuples. */
  states: Array<[number, Record<string, unknown>]>;
}

export interface AwarenessSetPayload {
  /** Desired local state of the iframe peer. Null clears the state. */
  state: Record<string, unknown> | null;
}

/** Origin tag for updates that came from the bridge (avoid echo loops). */
export const BRIDGE_REMOTE_ORIGIN = Symbol.for("y-mxgraph-bridge-remote");

export function makeMsg<T>(type: BridgeMsgType, payload: T): BridgeMsg<T> {
  return { type, scope: BRIDGE_SCOPE, payload };
}

export function isBridgeMsg(data: unknown): data is BridgeMsg {
  return (
    !!data &&
    typeof data === "object" &&
    (data as BridgeMsg).scope === BRIDGE_SCOPE &&
    typeof (data as BridgeMsg).type === "string"
  );
}
