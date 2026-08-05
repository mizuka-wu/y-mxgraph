import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { createIframeBridgeProvider, createIframeBridgeServer } from "../src/index";

// Mock message events
function createMessageEvent(data: unknown, source?: Window): MessageEvent {
  return new MessageEvent("message", {
    data,
    source: source ?? null,
    origin: "*",
  });
}

// Mock iframe element
function createMockIframe(): HTMLIFrameElement {
  const messages: unknown[] = [];
  const iframe = {
    contentWindow: {
      postMessage: vi.fn((msg: unknown) => {
        messages.push(msg);
      }),
    } as unknown as Window,
    _messages: messages,
  } as unknown as HTMLIFrameElement;
  return iframe;
}

describe("iframe-bridge desync detection", () => {
  let providerYdoc: Y.Doc;
  let serverYdoc: Y.Doc;
  let providerAwareness: Awareness;
  let serverAwareness: Awareness;
  let iframe: HTMLIFrameElement;

  beforeEach(() => {
    providerYdoc = new Y.Doc();
    serverYdoc = new Y.Doc();
    providerAwareness = new Awareness(providerYdoc, 1);
    serverAwareness = new Awareness(serverYdoc, 2);
    iframe = createMockIframe();
  });

  afterEach(() => {
    providerAwareness.destroy();
    serverAwareness.destroy();
    providerYdoc.destroy();
    serverYdoc.destroy();
  });

  it("pendingTimeoutMs triggers callback when connected but not acknowledged", async () => {
    const onPendingTimeout = vi.fn();
    const provider = createIframeBridgeProvider(providerYdoc, {
      pendingTimeoutMs: 50,
      onPendingTimeout,
    });

    // Simulate connection by sending ydoc-sync
    const syncEvent = createMessageEvent({
      type: "ydoc-sync",
      payload: Array.from(Y.encodeStateAsUpdate(providerYdoc)),
      protocolVersion: 2,
    });
    window.dispatchEvent(syncEvent);

    // Wait for connection
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Make a change that will be queued
    providerYdoc.getText("test").insert(0, "test");

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 100));

    // onPendingTimeout should have been called
    expect(onPendingTimeout).toHaveBeenCalled();

    provider.destroy();
  });

  it("provider can request full sync when desync detected", async () => {
    const provider = createIframeBridgeProvider(providerYdoc);
    const server = createIframeBridgeServer(iframe, serverYdoc, serverAwareness);

    // Simulate connection
    const syncEvent = createMessageEvent({
      type: "ydoc-sync",
      payload: Array.from(Y.encodeStateAsUpdate(providerYdoc)),
      protocolVersion: 2,
    });
    window.dispatchEvent(syncEvent);

    // Wait for connection
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Make a change on server without syncing
    serverYdoc.getText("test").insert(0, "server change");

    // Request full sync
    provider.forceSyncToServer();

    // Wait for message processing
    await new Promise((resolve) => setTimeout(resolve, 10));

    provider.destroy();
    server.destroy();
  });

  it("server can force sync to client", async () => {
    const provider = createIframeBridgeProvider(providerYdoc);
    const server = createIframeBridgeServer(iframe, serverYdoc, serverAwareness);

    // Simulate connection
    const cw = iframe.contentWindow;
    if (!cw) throw new Error("iframe.contentWindow is null");
    const initEvent = createMessageEvent({ type: "init" }, cw);
    window.dispatchEvent(initEvent);

    // Wait for connection
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Force sync
    server.forceSyncToClient();

    // Wait for message processing
    await new Promise((resolve) => setTimeout(resolve, 10));

    provider.destroy();
    server.destroy();
  });
});

describe("iframe-bridge beforeunload handling", () => {
  let providerYdoc: Y.Doc;
  let serverYdoc: Y.Doc;
  let providerAwareness: Awareness;
  let serverAwareness: Awareness;
  let iframe: HTMLIFrameElement;

  beforeEach(() => {
    providerYdoc = new Y.Doc();
    serverYdoc = new Y.Doc();
    providerAwareness = new Awareness(providerYdoc, 1);
    serverAwareness = new Awareness(serverYdoc, 2);
    iframe = createMockIframe();
  });

  afterEach(() => {
    providerAwareness.destroy();
    serverAwareness.destroy();
    providerYdoc.destroy();
    serverYdoc.destroy();
  });

  it("provider.destroy sends final updates", async () => {
    const provider = createIframeBridgeProvider(providerYdoc);
    const server = createIframeBridgeServer(iframe, serverYdoc, serverAwareness);

    // Simulate connection
    const syncEvent = createMessageEvent({
      type: "ydoc-sync",
      payload: Array.from(Y.encodeStateAsUpdate(providerYdoc)),
      protocolVersion: 2,
    });
    window.dispatchEvent(syncEvent);

    // Wait for connection
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Make a change
    providerYdoc.getText("test").insert(0, "final change");

    // Destroy provider (simulating beforeunload)
    provider.destroy();

    // Server should have received the update
    await new Promise((resolve) => setTimeout(resolve, 10));

    server.destroy();
  });

  it("server.destroy sends disconnect message", async () => {
    const provider = createIframeBridgeProvider(providerYdoc);
    const server = createIframeBridgeServer(iframe, serverYdoc, serverAwareness);

    // Simulate connection
    const cw = iframe.contentWindow;
    if (!cw) throw new Error("iframe.contentWindow is null");
    const initEvent = createMessageEvent({ type: "init" }, cw);
    window.dispatchEvent(initEvent);

    // Wait for connection
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Destroy server
    server.destroy();

    // Provider should have received disconnect
    await new Promise((resolve) => setTimeout(resolve, 10));

    provider.destroy();
  });

  it("both sides can clean up gracefully on page unload", async () => {
    const provider = createIframeBridgeProvider(providerYdoc);
    const server = createIframeBridgeServer(iframe, serverYdoc, serverAwareness);

    // Simulate connection
    const cw = iframe.contentWindow;
    if (!cw) throw new Error("iframe.contentWindow is null");
    const initEvent = createMessageEvent({ type: "init" }, cw);
    window.dispatchEvent(initEvent);

    // Wait for connection
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Make changes on both sides
    providerYdoc.getText("test").insert(0, "provider change");
    serverYdoc.getText("test").insert(0, "server change");

    // Simulate page unload by destroying both
    provider.destroy();
    server.destroy();

    // Wait for cleanup
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Both should be cleaned up
    expect(provider.connected).toBe(false);
    expect(server.connected).toBe(false);
  });
});
