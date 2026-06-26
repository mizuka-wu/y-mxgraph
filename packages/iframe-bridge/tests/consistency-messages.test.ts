import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";
import { createIframeBridgeProvider } from "../src/provider";
import { createIframeBridgeServer } from "../src/server";
import { Awareness } from "y-protocols/awareness";

function createMessageEvent(data: unknown, source: unknown): MessageEvent {
  return new MessageEvent("message", {
    data,
    source: source as Window,
    origin: "*",
  });
}

function createMockIframe(): HTMLIFrameElement {
  const messages: any[] = [];
  return {
    contentWindow: {
      postMessage: (msg: any) => messages.push(msg),
    },
    _messages: messages,
  } as any;
}

describe("provider — consistency-check 消息", () => {
  let childDoc: Y.Doc;

  beforeEach(() => {
    Object.defineProperty(window, "parent", {
      value: { postMessage: vi.fn() },
      writable: true,
    });
    childDoc = new Y.Doc();
  });

  it("consistencyCheckInterval > 0 时发送 consistency-check", () => {
    vi.useFakeTimers();
    const parentPostMessage = window.parent.postMessage as any;
    const provider = createIframeBridgeProvider(childDoc, {
      consistencyCheckInterval: 5000,
    });

    // 模拟连接
    const serverDoc = new Y.Doc();
    const update = Y.encodeStateAsUpdate(serverDoc);
    window.dispatchEvent(
      createMessageEvent({ type: "ydoc-sync", payload: Array.from(update), protocolVersion: 2 }, window.parent),
    );

    vi.advanceTimersByTime(5000);

    // 应该发送了 consistency-check
    const calls = parentPostMessage.mock.calls;
    const consistencyCheck = calls.find((c: any[]) => c[0]?.type === "consistency-check");
    expect(consistencyCheck).toBeDefined();
    expect(consistencyCheck![0].stateVector).toBeDefined();

    provider.destroy();
    vi.useRealTimers();
  });

  it("收到 force-sync 时发送完整 state", () => {
    const parentPostMessage = window.parent.postMessage as any;
    const provider = createIframeBridgeProvider(childDoc);

    // 添加一些数据
    childDoc.getMap("test").set("key", "value");

    // 模拟连接
    const serverDoc = new Y.Doc();
    const update = Y.encodeStateAsUpdate(serverDoc);
    window.dispatchEvent(
      createMessageEvent({ type: "ydoc-sync", payload: Array.from(update), protocolVersion: 2 }, window.parent),
    );

    // 收到 force-sync
    window.dispatchEvent(
      createMessageEvent({ type: "force-sync" }, window.parent),
    );

    const calls = parentPostMessage.mock.calls;
    const pendingUpdates = calls.find((c: any[]) => c[0]?.type === "ydoc-pending-updates");
    expect(pendingUpdates).toBeDefined();
    expect(pendingUpdates![0].payload.length).toBeGreaterThan(0);

    provider.destroy();
  });

  it("consistencyCheckInterval=0 时不发送 consistency-check", () => {
    vi.useFakeTimers();
    const parentPostMessage = window.parent.postMessage as any;
    const provider = createIframeBridgeProvider(childDoc, {
      consistencyCheckInterval: 0,
    });

    // 模拟连接
    const serverDoc = new Y.Doc();
    const update = Y.encodeStateAsUpdate(serverDoc);
    window.dispatchEvent(
      createMessageEvent({ type: "ydoc-sync", payload: Array.from(update), protocolVersion: 2 }, window.parent),
    );

    parentPostMessage.mockClear();
    vi.advanceTimersByTime(10000);

    const calls = parentPostMessage.mock.calls;
    const consistencyCheck = calls.find((c: any[]) => c[0]?.type === "consistency-check");
    expect(consistencyCheck).toBeUndefined();

    provider.destroy();
    vi.useRealTimers();
  });
});

describe("server — consistency-check 处理", () => {
  it("state vector 不一致时发送 force-sync", () => {
    const iframe = createMockIframe();
    const serverDoc = new Y.Doc();
    const awareness = new Awareness(serverDoc);

    // 添加数据到 server doc
    serverDoc.getMap("test").set("key", "value");

    const server = createIframeBridgeServer(iframe, serverDoc, awareness);

    // 模拟 iframe 发送 init
    const cw = iframe.contentWindow as any;
    window.dispatchEvent(
      createMessageEvent({ type: "init" }, cw),
    );

    // 模拟 iframe 发送 consistency-check（state vector 不同）
    const emptySV = Y.encodeStateVector(new Y.Doc());
    window.dispatchEvent(
      createMessageEvent({ type: "consistency-check", stateVector: Array.from(emptySV) }, cw),
    );

    // 应该发送了 force-sync
    const messages = (iframe as any)._messages;
    const forceSync = messages.find((m: any) => m.type === "force-sync");
    expect(forceSync).toBeDefined();

    server.destroy();
  });

  it("state vector 一致时不发送 force-sync", () => {
    const iframe = createMockIframe();
    const serverDoc = new Y.Doc();
    const awareness = new Awareness(serverDoc);

    const server = createIframeBridgeServer(iframe, serverDoc, awareness);

    // 模拟 iframe 发送 init
    const cw = iframe.contentWindow as any;
    window.dispatchEvent(
      createMessageEvent({ type: "init" }, cw),
    );

    // 模拟 iframe 发送 consistency-check（state vector 相同）
    const sv = Y.encodeStateVector(serverDoc);
    (iframe as any)._messages.length = 0; // 清空消息
    window.dispatchEvent(
      createMessageEvent({ type: "consistency-check", stateVector: Array.from(sv) }, cw),
    );

    const messages = (iframe as any)._messages;
    const forceSync = messages.find((m: any) => m.type === "force-sync");
    expect(forceSync).toBeUndefined();

    server.destroy();
  });

  it("request-full-sync 发送完整 state", () => {
    const iframe = createMockIframe();
    const serverDoc = new Y.Doc();
    const awareness = new Awareness(serverDoc);
    serverDoc.getMap("test").set("key", "value");

    const server = createIframeBridgeServer(iframe, serverDoc, awareness);

    // 模拟 iframe 发送 init
    const cw = iframe.contentWindow as any;
    window.dispatchEvent(
      createMessageEvent({ type: "init" }, cw),
    );

    (iframe as any)._messages.length = 0;
    window.dispatchEvent(
      createMessageEvent({ type: "request-full-sync" }, cw),
    );

    const messages = (iframe as any)._messages;
    const sync = messages.find((m: any) => m.type === "ydoc-sync");
    expect(sync).toBeDefined();
    expect(sync.payload.length).toBeGreaterThan(0);

    server.destroy();
  });
});
