/**
 * End-to-end test for the iframe bridge. We don't actually use a real iframe;
 * instead we run Provider + Client in the same jsdom window, wiring postMessage
 * between two stub `Window` objects.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import {
  YMxGraphBridgeProvider,
  YMxGraphBridgeClient,
  BRIDGE_SCOPE,
  isBridgeMsg,
} from "../src";

/**
 * Build a pair of windows that route postMessage to each other and to the
 * global `window` listener, so both Provider and Client can run side-by-side.
 *
 * The bridge filters by `event.source`, so each side gets its own fake window
 * proxy. We dispatch a `MessageEvent` on the real `window` with `source` set
 * to the opposite peer.
 */
interface FakePair {
  hostWin: Window;
  guestWin: Window;
  iframe: HTMLIFrameElement;
  teardown: () => void;
}

function setupPair(): FakePair {
  // Two opaque "WindowProxy" tokens. Their identity is what matters.
  const hostWin = { name: "host" } as unknown as Window;
  const guestWin = { name: "guest" } as unknown as Window;

  // guestWin.postMessage() is called BY the host (Provider) to deliver a
  // message to the guest. The MessageEvent's `source` therefore identifies
  // the *sender* = hostWin. Same logic in reverse for hostWin.postMessage.
  (guestWin as any).postMessage = (data: unknown, _origin: string) => {
    queueMicrotask(() => {
      const ev = new MessageEvent("message", {
        data,
        source: hostWin as unknown as MessageEventSource,
        origin: "http://host",
      });
      window.dispatchEvent(ev);
    });
  };
  (hostWin as any).postMessage = (data: unknown, _origin: string) => {
    queueMicrotask(() => {
      const ev = new MessageEvent("message", {
        data,
        source: guestWin as unknown as MessageEventSource,
        origin: "http://guest",
      });
      window.dispatchEvent(ev);
    });
  };

  // Fake iframe whose contentWindow points to guestWin.
  const iframe = {
    contentWindow: guestWin,
  } as unknown as HTMLIFrameElement;

  // For the client, we need `window.parent` to resolve to hostWin. We can't
  // overwrite `window.parent` in jsdom easily, so we instead pass parentWindow.
  return {
    hostWin,
    guestWin,
    iframe,
    teardown: () => {
      // nothing — listeners are removed by destroy()
    },
  };
}

async function flush() {
  // Let microtask-scheduled postMessages and Yjs internals settle.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe("YMxGraphBridge", () => {
  let pair: FakePair;

  beforeEach(() => {
    pair = setupPair();
  });

  afterEach(() => {
    pair.teardown();
  });

  it("scopes all bridge messages", () => {
    expect(BRIDGE_SCOPE).toBe("y-mxgraph");
    expect(isBridgeMsg({ scope: "y-mxgraph", type: "PING", payload: {} })).toBe(
      true,
    );
    expect(isBridgeMsg({ scope: "other", type: "PING" })).toBe(false);
    expect(isBridgeMsg(null)).toBe(false);
  });

  it("syncs Y.Doc from host to guest on connect", async () => {
    const hostDoc = new Y.Doc();
    const hostAwareness = new Awareness(hostDoc);
    hostDoc.getArray("items").insert(0, ["a", "b", "c"]);

    const provider = new YMxGraphBridgeProvider(pair.iframe, hostDoc, {
      awareness: hostAwareness,
      pingInterval: 100_000, // effectively disabled for the test
    });
    const client = new YMxGraphBridgeClient({
      parentWindow: pair.hostWin,
      pingInterval: 100_000,
    });

    await flush();
    await flush();

    expect(client.doc.getArray("items").toArray()).toEqual(["a", "b", "c"]);
    expect(client.isSynced()).toBe(true);

    provider.destroy();
    client.destroy();
    hostAwareness.destroy();
    hostDoc.destroy();
  });

  it("propagates updates host → guest and guest → host", async () => {
    const hostDoc = new Y.Doc();
    const hostAwareness = new Awareness(hostDoc);

    const provider = new YMxGraphBridgeProvider(pair.iframe, hostDoc, {
      awareness: hostAwareness,
      pingInterval: 100_000,
    });
    const client = new YMxGraphBridgeClient({
      parentWindow: pair.hostWin,
      pingInterval: 100_000,
    });

    await flush();

    // host → guest
    hostDoc.getMap("m").set("k", 1);
    await flush();
    expect(client.doc.getMap("m").get("k")).toBe(1);

    // guest → host
    client.doc.getMap("m").set("k2", 2);
    await flush();
    expect(hostDoc.getMap("m").get("k2")).toBe(2);

    provider.destroy();
    client.destroy();
  });

  it("forwards guest awareness state changes back via AWARENESS_PUSH", async () => {
    const hostDoc = new Y.Doc();
    const hostAwareness = new Awareness(hostDoc);

    const provider = new YMxGraphBridgeProvider(pair.iframe, hostDoc, {
      awareness: hostAwareness,
      pingInterval: 100_000,
      awarenessDebounce: 0,
    });
    const client = new YMxGraphBridgeClient({
      parentWindow: pair.hostWin,
      pingInterval: 100_000,
    });

    await flush();

    const changes: any[] = [];
    client.awareness.on("change", (c: any) => changes.push(c));

    client.awareness.setLocalState({ cursor: { x: 1, y: 2 } });
    await flush();
    await flush();

    // Host's awareness should now hold the guest's state.
    const hostStates = hostAwareness.getStates();
    const hostLocal = hostStates.get(hostDoc.clientID);
    expect(hostLocal).toEqual({ cursor: { x: 1, y: 2 } });

    // Guest's stub snapshot should also reflect it.
    expect(client.awareness.getStates().size).toBeGreaterThan(0);
    expect(changes.length).toBeGreaterThan(0);

    provider.destroy();
    client.destroy();
  });

  it("destroys cleanly and stops listening", async () => {
    const hostDoc = new Y.Doc();
    const hostAwareness = new Awareness(hostDoc);

    const provider = new YMxGraphBridgeProvider(pair.iframe, hostDoc, {
      awareness: hostAwareness,
      pingInterval: 100_000,
    });
    const client = new YMxGraphBridgeClient({
      parentWindow: pair.hostWin,
      pingInterval: 100_000,
    });

    await flush();

    const destroySpyP = vi.fn();
    const destroySpyC = vi.fn();
    provider.on("destroy", destroySpyP);
    client.on("destroy", destroySpyC);

    provider.destroy();
    client.destroy();

    expect(destroySpyP).toHaveBeenCalledTimes(1);
    expect(destroySpyC).toHaveBeenCalledTimes(1);

    // Further updates must not throw or leak across.
    hostDoc.getMap("m").set("after", 1);
    await flush();
    expect(client.doc.getMap("m").get("after")).toBeUndefined();
  });
});
