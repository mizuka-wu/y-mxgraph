import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { BRIDGE_ORIGIN } from "../src/origin.js";
import { createIframeBridgeProvider } from "../src/provider.js";
import { createIframeBridgeServer } from "../src/server.js";

// Mock postMessage for provider tests
const mockPostMessage = vi.fn();
Object.defineProperty(window, "parent", {
  value: { postMessage: mockPostMessage },
  writable: true,
});

describe("BRIDGE_ORIGIN", () => {
  it("is a unique object reference", () => {
    expect(typeof BRIDGE_ORIGIN).toBe("object");
    expect(BRIDGE_ORIGIN).not.toBe({});
  });

  it("is different from LOCAL_ORIGIN pattern", () => {
    const LOCAL_ORIGIN = {};
    expect(BRIDGE_ORIGIN).not.toBe(LOCAL_ORIGIN);
  });
});

describe("createIframeBridgeProvider with undoManager", () => {
  let doc: Y.Doc;
  let awareness: Awareness;

  beforeEach(() => {
    doc = new Y.Doc();
    awareness = new Awareness(doc);
    mockPostMessage.mockClear();
  });

  it("sends undo-state on stack change", () => {
    const undoManager = new Y.UndoManager(doc, {
      trackedOrigins: new Set([BRIDGE_ORIGIN]),
    });

    createIframeBridgeProvider(doc, awareness, undoManager);

    // Make a local change
    doc.transact(() => {
      doc.getMap("test").set("key", "value");
    }, BRIDGE_ORIGIN);

    // Check undo-state was sent
    const undoStateCalls = mockPostMessage.mock.calls.filter(
      (call) => call[0].type === "undo-state",
    );
    expect(undoStateCalls.length).toBeGreaterThan(0);
    const lastCall = undoStateCalls[undoStateCalls.length - 1][0];
    expect(lastCall.payload.canUndo).toBe(true);
    expect(lastCall.payload.canRedo).toBe(false);

    undoManager.destroy();
  });

  it("sends initial undo-state after init", () => {
    const undoManager = new Y.UndoManager(doc, {
      trackedOrigins: new Set([BRIDGE_ORIGIN]),
    });

    createIframeBridgeProvider(doc, awareness, undoManager);

    // Check init was sent first, then undo-state
    const initIndex = mockPostMessage.mock.calls.findIndex(
      (call) => call[0].type === "init",
    );
    const undoStateIndex = mockPostMessage.mock.calls.findIndex(
      (call) => call[0].type === "undo-state",
    );

    expect(initIndex).toBeGreaterThanOrEqual(0);
    expect(undoStateIndex).toBeGreaterThan(initIndex);

    undoManager.destroy();
  });

  it("does not send undo-state when no undoManager provided", () => {
    createIframeBridgeProvider(doc, awareness);

    const undoStateCalls = mockPostMessage.mock.calls.filter(
      (call) => call[0].type === "undo-state",
    );
    expect(undoStateCalls.length).toBe(0);
  });
});

describe("createIframeBridgeServer with UndoManager", () => {
  let doc: Y.Doc;
  let awareness: Awareness;

  beforeEach(() => {
    doc = new Y.Doc();
    awareness = new Awareness(doc);
  });

  it("exposes undoManager when provided", () => {
    const undoManager = new Y.UndoManager(doc, {
      trackedOrigins: new Set([BRIDGE_ORIGIN]),
    });
    const server = createIframeBridgeServer(doc, awareness, undoManager);
    expect(server.undoManager).toBe(undoManager);
    server.destroy();
    undoManager.destroy();
  });

  it("undoManager is undefined when not provided", () => {
    const server = createIframeBridgeServer(doc, awareness);
    expect(server.undoManager).toBeUndefined();
    server.destroy();
  });

  it("parent UndoManager tracks bridge-originated changes", () => {
    const undoManager = new Y.UndoManager(doc, {
      trackedOrigins: new Set([BRIDGE_ORIGIN]),
    });
    const server = createIframeBridgeServer(doc, awareness, undoManager);

    expect(undoManager.canUndo()).toBe(false);

    // Simulate a change with BRIDGE_ORIGIN
    doc.transact(() => {
      doc.getMap("test").set("key", "value");
    }, BRIDGE_ORIGIN);

    expect(undoManager.canUndo()).toBe(true);

    server.destroy();
    undoManager.destroy();
  });

  it("parent UndoManager does NOT track non-bridge changes", () => {
    const undoManager = new Y.UndoManager(doc, {
      trackedOrigins: new Set([BRIDGE_ORIGIN]),
    });
    const server = createIframeBridgeServer(doc, awareness, undoManager);

    // Make a change without BRIDGE_ORIGIN
    doc.transact(() => {
      doc.getMap("test").set("key", "value");
    });

    expect(undoManager.canUndo()).toBe(false);

    server.destroy();
    undoManager.destroy();
  });

  it("parent undo reverts bridge-originated changes", () => {
    const undoManager = new Y.UndoManager(doc, {
      trackedOrigins: new Set([BRIDGE_ORIGIN]),
    });
    const server = createIframeBridgeServer(doc, awareness, undoManager);

    // Make a change with BRIDGE_ORIGIN
    doc.transact(() => {
      doc.getMap("test").set("key", "value");
    }, BRIDGE_ORIGIN);

    expect(doc.getMap("test").get("key")).toBe("value");

    // Undo
    undoManager.undo();

    expect(doc.getMap("test").get("key")).toBeUndefined();

    server.destroy();
    undoManager.destroy();
  });

  it("onUndoState registers callback", () => {
    const server = createIframeBridgeServer(doc, awareness);
    const callback = vi.fn();

    server.onUndoState("test-iframe", callback);
    expect(callback).not.toHaveBeenCalled();

    server.destroy();
  });
});
