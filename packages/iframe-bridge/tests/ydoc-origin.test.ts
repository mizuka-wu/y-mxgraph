import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";
import { createIframeBridgeProvider } from "../src/provider";
import { IFRAME_ORIGIN, BASELINE_ORIGIN } from "../src/origin";

function createMessageEvent(data: unknown, source: unknown): MessageEvent {
  return new MessageEvent("message", {
    data,
    source: source as Window,
    origin: "*",
  });
}

describe("iframe provider applies origin on incoming updates", () => {
  let childDoc: Y.Doc;

  beforeEach(() => {
    Object.defineProperty(window, "parent", {
      value: { postMessage: () => {} },
      writable: true,
    });
    childDoc = new Y.Doc();
  });

  it("applies non-baseline updates with IFRAME_ORIGIN", () => {
    const provider = createIframeBridgeProvider(childDoc);
    let receivedOrigin: any = undefined;
    childDoc.on("update", (_u: Uint8Array, origin: unknown) => {
      receivedOrigin = origin;
    });

    const serverDoc = new Y.Doc();
    const map = serverDoc.getMap("mxfile");
    map.set("test", "value");
    const update = Y.encodeStateAsUpdate(serverDoc);

    window.dispatchEvent(
      createMessageEvent({ type: "ydoc-update", payload: Array.from(update), isBaseline: false }, window.parent),
    );

    expect(receivedOrigin).toBe(IFRAME_ORIGIN);
    provider.destroy();
  });

  it("applies baseline updates with BASELINE_ORIGIN", () => {
    const provider = createIframeBridgeProvider(childDoc);
    let receivedOrigin: any = undefined;
    childDoc.on("update", (_u: Uint8Array, origin: unknown) => {
      receivedOrigin = origin;
    });

    const serverDoc = new Y.Doc();
    const map = serverDoc.getMap("mxfile");
    map.set("test2", "value2");
    const update = Y.encodeStateAsUpdate(serverDoc);

    window.dispatchEvent(
      createMessageEvent({ type: "ydoc-update", payload: Array.from(update), isBaseline: true }, window.parent),
    );

    expect(receivedOrigin).toBe(BASELINE_ORIGIN);
    provider.destroy();
  });

  it("applies ydoc-sync with IFRAME_ORIGIN by default (no isBaseline)", () => {
    const provider = createIframeBridgeProvider(childDoc);
    let receivedOrigin: any = undefined;
    childDoc.on("update", (_u: Uint8Array, origin: unknown) => {
      receivedOrigin = origin;
    });

    const serverDoc = new Y.Doc();
    const map = serverDoc.getMap("mxfile");
    map.set("test3", "value3");
    const update = Y.encodeStateAsUpdate(serverDoc);

    // ydoc-sync 不带 isBaseline → 应该用 IFRAME_ORIGIN（非 baseline）
    window.dispatchEvent(
      createMessageEvent({ type: "ydoc-sync", payload: Array.from(update) }, window.parent),
    );

    expect(receivedOrigin).toBe(IFRAME_ORIGIN);
    provider.destroy();
  });
});
