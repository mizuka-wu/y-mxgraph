import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";
import { createIframeBridgeServer } from "../src/server";

function createMockIframe(): HTMLIFrameElement {
  const listeners = new Map<string, Set<Function>>();
  return {
    contentWindow: {
      postMessage: vi.fn(),
      addEventListener: vi.fn((type: string, fn: Function) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      }),
      removeEventListener: vi.fn((type: string, fn: Function) => {
        listeners.get(type)?.delete(fn);
      }),
    },
    addEventListener: vi.fn((type: string, fn: Function) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: Function) => {
      listeners.get(type)?.delete(fn);
    }),
  } as unknown as HTMLIFrameElement;
}

function createMockAwareness() {
  return {
    getStates: () => new Map(),
    on: vi.fn(),
    off: vi.fn(),
  } as any;
}

describe("iframe-bridge pending update timeout", () => {
  it("onPendingTimeout 触发 pending update 堆积", () => {
    vi.useFakeTimers();

    const doc = new Y.Doc();
    const awareness = createMockAwareness();
    const iframe = createMockIframe();
    const onPendingTimeout = vi.fn();

    createIframeBridgeServer(iframe, doc, awareness, {
      pendingTimeoutMs: 5000,
      onPendingTimeout,
    });

    doc.transact(() => {
      const map = doc.getMap("test");
      map.set("key", "value");
    });

    expect(onPendingTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(6000);

    expect(onPendingTimeout).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingCount: expect.any(Number),
        oldestMs: expect.any(Number),
      }),
    );

    vi.useRealTimers();
  });

  it("未配置 pendingTimeoutMs 时不触发", () => {
    vi.useFakeTimers();

    const doc = new Y.Doc();
    const awareness = createMockAwareness();
    const iframe = createMockIframe();
    const onPendingTimeout = vi.fn();

    createIframeBridgeServer(iframe, doc, awareness, {
      onPendingTimeout,
    });

    doc.transact(() => {
      const map = doc.getMap("test");
      map.set("key", "value");
    });

    vi.advanceTimersByTime(30000);

    expect(onPendingTimeout).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("destroy 清理 timer", () => {
    vi.useFakeTimers();

    const doc = new Y.Doc();
    const awareness = createMockAwareness();
    const iframe = createMockIframe();
    const onPendingTimeout = vi.fn();

    const bridge = createIframeBridgeServer(iframe, doc, awareness, {
      pendingTimeoutMs: 5000,
      onPendingTimeout,
    });

    doc.transact(() => {
      const map = doc.getMap("test");
      map.set("key", "value");
    });

    bridge.destroy();
    vi.advanceTimersByTime(10000);

    expect(onPendingTimeout).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
