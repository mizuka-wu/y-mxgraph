import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { createIframeBridgeProvider } from "../src/provider";
import { createIframeBridgeServer } from "../src/server";

const mockPostMessage = vi.fn();
const mockIframeContentWindow = { postMessage: vi.fn() };
const mockIframe = { contentWindow: mockIframeContentWindow } as unknown as HTMLIFrameElement;

function createMessageEvent(data: unknown, source: unknown): MessageEvent {
  return new MessageEvent("message", {
    data,
    source: source as Window,
    origin: "*",
  });
}

function connectProvider(
  provider: ReturnType<typeof createIframeBridgeProvider>,
  parentDoc: Y.Doc,
) {
  const docUpdate = Y.encodeStateAsUpdate(parentDoc);
  window.dispatchEvent(
    createMessageEvent(
      { type: "ydoc-sync", payload: Array.from(docUpdate) },
      window.parent,
    ),
  );
  mockPostMessage.mockClear();
  return provider;
}

describe("iframe-bridge awareness sync", () => {
  let parentDoc: Y.Doc;
  let childDoc: Y.Doc;
  let parentAwareness: Awareness;
  let childAwareness: Awareness;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "parent", {
      value: { postMessage: mockPostMessage },
      writable: true,
    });
    parentDoc = new Y.Doc();
    childDoc = new Y.Doc();
    parentAwareness = new Awareness(parentDoc);
    childAwareness = new Awareness(childDoc);
  });

  afterEach(() => {
    parentDoc.destroy();
    childDoc.destroy();
  });

  describe("provider: set-local-state", () => {
    it("未连接时 setLocalStateField 不发送", () => {
      const provider = createIframeBridgeProvider(childDoc, {
        awareness: childAwareness,
      });
      childAwareness.setLocalStateField("cursor", { x: 1, y: 2 });
      expect(mockPostMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "set-local-state" }),
        "*",
      );
      provider.destroy();
    });

    it("连接后 setLocalStateField(cursor) 发送 set-local-state", () => {
      const provider = createIframeBridgeProvider(childDoc, {
        awareness: childAwareness,
      });
      connectProvider(provider, parentDoc);
      childAwareness.setLocalStateField("cursor", { x: 1, y: 2, pageId: "0" });
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "set-local-state",
          key: "cursor",
          value: { x: 1, y: 2, pageId: "0" },
        }),
        "*",
      );
      expect(mockPostMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "awareness-local-state" }),
        "*",
      );
      provider.destroy();
    });

    it("setLocalStateField(user) 不发送 set-local-state", () => {
      const provider = createIframeBridgeProvider(childDoc, {
        awareness: childAwareness,
      });
      connectProvider(provider, parentDoc);
      childAwareness.setLocalStateField("user", { name: "Test" });
      expect(mockPostMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "set-local-state" }),
        "*",
      );
      provider.destroy();
    });
  });

  describe("setLocalFields 行为", () => {
    it("连接时调用 setLocalFields 应发送 set-local-fields", () => {
      const provider = createIframeBridgeProvider(childDoc, {
        awareness: childAwareness,
      });
      connectProvider(provider, parentDoc);
      provider.setLocalFields({ name: "New Name", color: "#ff0000" });
      expect(childAwareness.getLocalState()?.user).toEqual({
        name: "New Name",
        color: "#ff0000",
      });
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "set-local-fields",
          fields: { name: "New Name", color: "#ff0000" },
        }),
        "*",
      );
      provider.destroy();
    });

    it("未连接时调用 setLocalFields 只设置本地状态", () => {
      const provider = createIframeBridgeProvider(childDoc, {
        awareness: childAwareness,
      });
      provider.setLocalFields({ name: "New Name", color: "#ff0000" });
      expect(childAwareness.getLocalState()?.user).toEqual({
        name: "New Name",
        color: "#ff0000",
      });
      expect(mockPostMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "set-local-fields" }),
        "*",
      );
      provider.destroy();
    });
  });

  describe("server 处理 set-local-state", () => {
    it("按 key/value 合并 cursor，保留 server user", () => {
      parentAwareness.setLocalState({
        user: { name: "Server User", color: "#00ff00" },
      });
      const server = createIframeBridgeServer(mockIframe, parentDoc, parentAwareness);
      window.dispatchEvent(
        createMessageEvent(
          {
            type: "set-local-state",
            key: "cursor",
            value: { x: 1, y: 2 },
          },
          mockIframeContentWindow,
        ),
      );
      expect(parentAwareness.getLocalState()).toEqual({
        user: { name: "Server User", color: "#00ff00" },
        cursor: { x: 1, y: 2 },
      });
      server.destroy();
    });

    it("按 key/value 写入任意顶层字段", () => {
      const server = createIframeBridgeServer(mockIframe, parentDoc, parentAwareness);
      window.dispatchEvent(
        createMessageEvent(
          {
            type: "set-local-state",
            key: "selection",
            value: { ids: ["a"], pageId: "0" },
          },
          mockIframeContentWindow,
        ),
      );
      expect(parentAwareness.getLocalState()?.selection).toEqual({
        ids: ["a"],
        pageId: "0",
      });
      server.destroy();
    });
  });

  describe("server 保留 awareness-local-state 但不处理", () => {
    it("收到 awareness-local-state 不修改 server awareness", () => {
      parentAwareness.setLocalState({
        user: { name: "Server User", color: "#00ff00" },
      });
      const server = createIframeBridgeServer(mockIframe, parentDoc, parentAwareness);
      window.dispatchEvent(
        createMessageEvent(
          {
            type: "awareness-local-state",
            state: {
              user: { name: "Iframe User", color: "#ff0000" },
              cursor: { x: 1, y: 2 },
            },
          },
          mockIframeContentWindow,
        ),
      );
      expect(parentAwareness.getLocalState()).toEqual({
        user: { name: "Server User", color: "#00ff00" },
      });
      server.destroy();
    });
  });

  describe("server 处理 set-local-fields", () => {
    it("server 有 user 时应合并字段", () => {
      parentAwareness.setLocalState({
        user: { name: "Server User", color: "#00ff00" },
      });
      const server = createIframeBridgeServer(mockIframe, parentDoc, parentAwareness);
      window.dispatchEvent(
        createMessageEvent(
          {
            type: "set-local-fields",
            fields: { name: "Updated Name", account: "new-account" },
          },
          mockIframeContentWindow,
        ),
      );
      expect(parentAwareness.getLocalState()?.user).toEqual({
        name: "Updated Name",
        color: "#00ff00",
        account: "new-account",
      });
      server.destroy();
    });
  });
});
