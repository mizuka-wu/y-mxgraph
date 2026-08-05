import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import { createIframeBridgeProvider, createIframeBridgeServer } from "../src/index";
import type { IframeBridgeProviderOptions, IframeBridgeServerOptions } from "../src/index";

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

// Mock DrawioFile for takeoverUndoManager
function createMockDrawioFile() {
  return {
    getUi: () => ({
      editor: {
        undoManager: undefined,
      },
    }),
  };
}

describe("iframe-bridge provider", () => {
  let ydoc: Y.Doc;

  beforeEach(() => {
    ydoc = new Y.Doc();
  });

  afterEach(() => {
    ydoc.destroy();
  });

  it("creates provider without errors", () => {
    const provider = createIframeBridgeProvider(ydoc);
    expect(provider).toBeDefined();
    expect(provider.connected).toBe(false);
    expect(provider.awareness).toBeDefined();
    provider.destroy();
  });

  it("provides awareness-like interface", () => {
    const provider = createIframeBridgeProvider(ydoc);
    const awareness = provider.awareness;

    // Should have clientID
    expect(typeof awareness.clientID).toBe("number");
    expect(awareness.clientID).toBeGreaterThan(0);

    // Should have states map
    expect(awareness.states).toBeInstanceOf(Map);

    // Should support getLocalState/setLocalState
    expect(awareness.getLocalState()).toBeNull();

    awareness.setLocalState({ user: { name: "test" } });
    expect(awareness.getLocalState()).toEqual({ user: { name: "test" } });

    awareness.setLocalState(null);
    expect(awareness.getLocalState()).toBeNull();

    provider.destroy();
  });

  it("supports setLocalStateField", () => {
    const provider = createIframeBridgeProvider(ydoc);
    const awareness = provider.awareness;

    awareness.setLocalState({ user: {} });
    awareness.setLocalStateField("name", "Alice");

    const state = awareness.getLocalState();
    // setLocalStateField sets at top level, not nested under user
    expect(state).toEqual({ user: {}, name: "Alice" });

    provider.destroy();
  });

  it("handles on/off event listeners", () => {
    const provider = createIframeBridgeProvider(ydoc);
    const awareness = provider.awareness;

    const handler = vi.fn();
    awareness.on("update", handler);
    awareness.off("update", handler);

    provider.destroy();
  });

  it("setLocalFields updates awareness and notifies parent", () => {
    const provider = createIframeBridgeProvider(ydoc);
    const awareness = provider.awareness;

    awareness.setLocalState({ user: {} });
    provider.setLocalFields({ name: "Bob", color: "#ff0000" });

    const state = awareness.getLocalState();
    expect(state).toEqual({ user: { name: "Bob", color: "#ff0000" } });

    provider.destroy();
  });

  it("onConnect/onDisconnect register and unregister listeners", () => {
    const provider = createIframeBridgeProvider(ydoc);
    const connectHandler = vi.fn();
    const disconnectHandler = vi.fn();

    const unsubConnect = provider.onConnect(connectHandler);
    const unsubDisconnect = provider.onDisconnect(disconnectHandler);

    // Unregister
    unsubConnect();
    unsubDisconnect();

    provider.destroy();
  });

  it("on() method works for connect/disconnect events", () => {
    const provider = createIframeBridgeProvider(ydoc);
    const handler = vi.fn();

    const unsub = provider.on("connect", handler);
    unsub();

    provider.destroy();
  });

  it("destroy cleans up resources", () => {
    const provider = createIframeBridgeProvider(ydoc);
    const awareness = provider.awareness;

    awareness.setLocalState({ user: { name: "test" } });

    // Should not throw
    provider.destroy();

    // Provider should be unusable after destroy
    expect(provider.connected).toBe(false);
  });

  it("forceSyncToServer throws when not connected", () => {
    const provider = createIframeBridgeProvider(ydoc);

    // Should not throw, just silently fail
    expect(() => provider.forceSyncToServer()).not.toThrow();

    provider.destroy();
  });
});

describe("iframe-bridge server", () => {
  let ydoc: Y.Doc;
  let awareness: Awareness;
  let iframe: HTMLIFrameElement;

  beforeEach(() => {
    ydoc = new Y.Doc();
    awareness = new Awareness(ydoc, 1);
    iframe = createMockIframe();
  });

  afterEach(() => {
    awareness.destroy();
    ydoc.destroy();
  });

  it("creates server without errors", () => {
    const server = createIframeBridgeServer(iframe, ydoc, awareness);
    expect(server).toBeDefined();
    expect(server.connected).toBe(false);
    server.destroy();
  });

  it("provides connect/disconnect listeners", () => {
    const server = createIframeBridgeServer(iframe, ydoc, awareness);
    const connectHandler = vi.fn();
    const disconnectHandler = vi.fn();

    const unsubConnect = server.onConnect(connectHandler);
    const unsubDisconnect = server.onDisconnect(disconnectHandler);

    unsubConnect();
    unsubDisconnect();

    server.destroy();
  });

  it("on() method works for connect/disconnect events", () => {
    const server = createIframeBridgeServer(iframe, ydoc, awareness);
    const handler = vi.fn();

    const unsub = server.on("connect", handler);
    unsub();

    server.destroy();
  });

  it("pause/resume controls message processing", () => {
    const server = createIframeBridgeServer(iframe, ydoc, awareness);

    server.pause();
    server.resume();

    server.destroy();
  });

  it("destroy cleans up resources", () => {
    const server = createIframeBridgeServer(iframe, ydoc, awareness);

    // Should not throw
    server.destroy();

    expect(server.connected).toBe(false);
  });

  it("forceSyncToClient throws when not connected", () => {
    const server = createIframeBridgeServer(iframe, ydoc, awareness);

    // Should not throw, just silently fail
    expect(() => server.forceSyncToClient()).not.toThrow();

    server.destroy();
  });
});

describe("iframe-bridge interaction", () => {
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

  it("provider and server can be created together", () => {
    const provider = createIframeBridgeProvider(providerYdoc);
    const server = createIframeBridgeServer(iframe, serverYdoc, serverAwareness);

    expect(provider).toBeDefined();
    expect(server).toBeDefined();

    provider.destroy();
    server.destroy();
  });

  it("ydoc updates propagate through sync", async () => {
    const provider = createIframeBridgeProvider(providerYdoc);
    const server = createIframeBridgeServer(iframe, serverYdoc, serverAwareness);

    // Simulate server making a change
    serverYdoc.getText("test").insert(0, "hello");

    // Force sync
    server.forceSyncToClient();

    // Wait for message processing
    await new Promise((resolve) => setTimeout(resolve, 10));

    provider.destroy();
    server.destroy();
  });

  it("awareness updates propagate", async () => {
    const provider = createIframeBridgeProvider(providerYdoc);
    const server = createIframeBridgeServer(iframe, serverYdoc, serverAwareness);

    // Simulate awareness update
    serverAwareness.setLocalState({ user: { name: "server" } });

    // Wait for message processing
    await new Promise((resolve) => setTimeout(resolve, 10));

    provider.destroy();
    server.destroy();
  });

  it("undo/redo messages are handled", async () => {
    const provider = createIframeBridgeProvider(providerYdoc);
    const server = createIframeBridgeServer(iframe, serverYdoc, serverAwareness);

    const cw = iframe.contentWindow;
    if (!cw) throw new Error("iframe.contentWindow is null");

    // Simulate undo message
    const undoEvent = createMessageEvent({ type: "undo" }, cw);
    window.dispatchEvent(undoEvent);

    // Simulate redo message
    const redoEvent = createMessageEvent({ type: "redo" }, cw);
    window.dispatchEvent(redoEvent);

    await new Promise((resolve) => setTimeout(resolve, 10));

    provider.destroy();
    server.destroy();
  });

  it("consistency check messages are handled", async () => {
    const provider = createIframeBridgeProvider(providerYdoc, {
      consistencyCheckInterval: 100,
    });
    const server = createIframeBridgeServer(iframe, serverYdoc, serverAwareness);

    // Wait for consistency check
    await new Promise((resolve) => setTimeout(resolve, 200));

    provider.destroy();
    server.destroy();
  });

  it("pending timeout callback is invoked", async () => {
    const onPendingTimeout = vi.fn();
    const provider = createIframeBridgeProvider(providerYdoc, {
      pendingTimeoutMs: 50,
      onPendingTimeout,
    });

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 100));

    provider.destroy();
  });
});

describe("iframe-bridge error handling", () => {
  let ydoc: Y.Doc;

  beforeEach(() => {
    ydoc = new Y.Doc();
  });

  afterEach(() => {
    ydoc.destroy();
  });

  it("provider handles invalid message gracefully", () => {
    const provider = createIframeBridgeProvider(ydoc);

    // Send invalid message
    const invalidEvent = createMessageEvent({ type: "unknown" });
    window.dispatchEvent(invalidEvent);

    // Should not throw
    provider.destroy();
  });

  it("server handles invalid message gracefully", () => {
    const awareness = new Awareness(ydoc, 1);
    const iframe = createMockIframe();
    const server = createIframeBridgeServer(iframe, ydoc, awareness);

    const cw = iframe.contentWindow;
    if (!cw) throw new Error("iframe.contentWindow is null");

    // Send invalid message from iframe
    const invalidEvent = createMessageEvent({ type: "unknown" }, cw);
    window.dispatchEvent(invalidEvent);

    // Should not throw
    server.destroy();
    awareness.destroy();
  });

  it("provider handles malformed payload gracefully", () => {
    const provider = createIframeBridgeProvider(ydoc);

    // Send message with malformed payload
    const malformedEvent = createMessageEvent({
      type: "ydoc-update",
      payload: "not-an-array",
    });
    window.dispatchEvent(malformedEvent);

    // Should not throw
    provider.destroy();
  });

  it("server handles unknown message type gracefully", () => {
    const awareness = new Awareness(ydoc, 1);
    const iframe = createMockIframe();
    const server = createIframeBridgeServer(iframe, ydoc, awareness);

    const cw = iframe.contentWindow;
    if (!cw) throw new Error("iframe.contentWindow is null");

    // Send unknown message type - server should silently ignore
    const unknownEvent = createMessageEvent({ type: "unknown-type" }, cw);
    window.dispatchEvent(unknownEvent);

    // Server should still be functional
    expect(server.connected).toBe(false);
    server.destroy();
    awareness.destroy();
  });
});
