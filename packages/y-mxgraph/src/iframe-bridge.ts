/**
 * Shared iframe bridge utilities and types.
 *
 * Provider / Client are exported from their own sub-paths:
 *   - `y-mxgraph/iframe-bridge/provider`
 *   - `y-mxgraph/iframe-bridge/client`
 */
export {
  BRIDGE_SCOPE,
  BRIDGE_REMOTE_ORIGIN,
  isBridgeMsg,
  makeMsg,
  Observable,
  AwarenessStub,
} from "@y-mxgraph/iframe-bridge";

export type {
  BridgeMsg,
  BridgeMsgType,
  BridgeScope,
  PingPayload,
  PongPayload,
  SyncRequestPayload,
  SyncUpdatePayload,
  AwarenessPushPayload,
  AwarenessSetPayload,
  AwarenessChange,
  AwarenessStubEvent,
} from "@y-mxgraph/iframe-bridge";
