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

  describe("provider:未连接时不推送本地状态", () => {
    it("未连接时设置本地状态不应发送到 server", () => {
      const provider = createIframeBridgeProvider(childDoc, childAwareness);
      childAwareness.setLocalState({
        user: { name: "Test User", color: "#ff0000" },
      });
      expect(mockPostMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "awareness-local-state" }),
        "*"
      );
      provider.destroy();
    });

    it("连接后设置本地状态应发送到 server", () => {
      const provider = createIframeBridgeProvider(childDoc, childAwareness);
      // 使用有效的 Y.Doc 更新数据
      const docUpdate = Y.encodeStateAsUpdate(parentDoc);
      const syncEvent = createMessageEvent(
        { type: "ydoc-sync", payload: Array.from(docUpdate) },
        window.parent
      );
      window.dispatchEvent(syncEvent);
      mockPostMessage.mockClear();
      childAwareness.setLocalState({
        user: { name: "Test User", color: "#ff0000" },
      });
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "awareness-local-state",
          state: { user: { name: "Test User", color: "#ff0000" } },
        }),
        "*"
      );
      provider.destroy();
    });
  });

  describe("setLocalFields 行为", () => {
    it("连接时调用 setLocalFields 应发送到 server", () => {
      const provider = createIframeBridgeProvider(childDoc, childAwareness);
      // 使用有效的 Y.Doc 更新数据
      const docUpdate = Y.encodeStateAsUpdate(parentDoc);
      const syncEvent = createMessageEvent(
        { type: "ydoc-sync", payload: Array.from(docUpdate) },
        window.parent
      );
      window.dispatchEvent(syncEvent);
      mockPostMessage.mockClear();
      provider.setLocalFields({ name: "New Name", color: "#ff0000" });
      const localState = childAwareness.getLocalState();
      expect(localState?.user).toEqual({ name: "New Name", color: "#ff0000" });
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "set-local-fields",
          fields: { name: "New Name", color: "#ff0000" },
        }),
        "*"
      );
      provider.destroy();
    });

    it("未连接时调用 setLocalFields 只设置本地状态", () => {
      const provider = createIframeBridgeProvider(childDoc, childAwareness);
      provider.setLocalFields({ name: "New Name", color: "#ff0000" });
      const localState = childAwareness.getLocalState();
      expect(localState?.user).toEqual({ name: "New Name", color: "#ff0000" });
      expect(mockPostMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "set-local-fields" }),
        "*"
      );
      provider.destroy();
    });

    it("setLocalFields 应该合并现有状态", () => {
      const provider = createIframeBridgeProvider(childDoc, childAwareness);
      childAwareness.setLocalState({
        user: { name: "Old Name", color: "#000000" },
        cursor: { x: 100, y: 200 },
      });
      provider.setLocalFields({ name: "New Name" });
      const localState = childAwareness.getLocalState();
      expect(localState?.user).toEqual({ name: "New Name", color: "#000000" });
      expect(localState?.cursor).toEqual({ x: 100, y: 200 });
      provider.destroy();
    });
  });

  describe("server 处理 set-local-fields", () => {
    it("server 有 user 时应合并字段", () => {
      parentAwareness.setLocalState({
        user: { name: "Server User", color: "#00ff00" },
      });
      const server = createIframeBridgeServer(mockIframe, parentDoc, parentAwareness);
      const messageEvent = createMessageEvent(
        { type: "set-local-fields", fields: { name: "Updated Name", account: "new-account" } },
        mockIframeContentWindow
      );
      window.dispatchEvent(messageEvent);
      const serverState = parentAwareness.getLocalState();
      expect(serverState?.user).toEqual({
        name: "Updated Name",
        color: "#00ff00",
        account: "new-account",
      });
      server.destroy();
    });

    it("server 没有 user 时应设置 user", () => {
      const server = createIframeBridgeServer(mockIframe, parentDoc, parentAwareness);
      const messageEvent = createMessageEvent(
        { type: "set-local-fields", fields: { name: "New User", color: "#ff0000" } },
        mockIframeContentWindow
      );
      window.dispatchEvent(messageEvent);
      const serverState = parentAwareness.getLocalState();
      expect(serverState?.user).toEqual({ name: "New User", color: "#ff0000" });
      server.destroy();
    });

    it("server 有多个字段时只更新指定字段", () => {
      parentAwareness.setLocalState({
        user: { name: "Server User", color: "#00ff00", account: "server-account" },
      });
      const server = createIframeBridgeServer(mockIframe, parentDoc, parentAwareness);
      const messageEvent = createMessageEvent(
        { type: "set-local-fields", fields: { name: "Updated Name" } },
        mockIframeContentWindow
      );
      window.dispatchEvent(messageEvent);
      const serverState = parentAwareness.getLocalState();
      expect(serverState?.user).toEqual({
        name: "Updated Name",
        color: "#00ff00",
        account: "server-account",
      });
      server.destroy();
    });
  });

  describe("provider 未连接时的随机值不应覆盖 server 的 user", () => {
    it("provider 未连接时设置随机值不应发送到 server", () => {
      parentAwareness.setLocalState({
        user: { name: "Server User", color: "#00ff00" },
      });
      const server = createIframeBridgeServer(mockIframe, parentDoc, parentAwareness);
      const provider = createIframeBridgeProvider(childDoc, childAwareness);
      childAwareness.setLocalState({
        user: { name: "Random 456", color: "#def456" },
      });
      expect(mockPostMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "awareness-local-state" }),
        "*"
      );
      const serverState = parentAwareness.getLocalState();
      expect(serverState?.user).toEqual({ name: "Server User", color: "#00ff00" });
      server.destroy();
      provider.destroy();
    });
  });

  describe("完整同步流程", () => {
    it("provider 调用 setLocalFields 应同步到 server", () => {
      const server = createIframeBridgeServer(mockIframe, parentDoc, parentAwareness);
      const provider = createIframeBridgeProvider(childDoc, childAwareness);
      // 使用有效的 Y.Doc 更新数据
      const docUpdate = Y.encodeStateAsUpdate(parentDoc);
      const syncEvent = createMessageEvent(
        { type: "ydoc-sync", payload: Array.from(docUpdate) },
        window.parent
      );
      window.dispatchEvent(syncEvent);
      provider.setLocalFields({ name: "Provider User", color: "#ff0000" });
      const setFieldsCall = mockPostMessage.mock.calls.find(
        (call) => (call[0] as { type?: string }).type === "set-local-fields"
      );
      expect(setFieldsCall).toBeDefined();
      const messageEvent = createMessageEvent(setFieldsCall![0], mockIframeContentWindow);
      window.dispatchEvent(messageEvent);
      const serverState = parentAwareness.getLocalState();
      expect(serverState?.user).toEqual({ name: "Provider User", color: "#ff0000" });
      server.destroy();
      provider.destroy();
    });

    it("server 和 provider 都没有 user 时 setLocalFields 应正常工作", () => {
      const server = createIframeBridgeServer(mockIframe, parentDoc, parentAwareness);
      const provider = createIframeBridgeProvider(childDoc, childAwareness);
      expect(parentAwareness.getLocalState()?.user).toBeUndefined();
      expect(childAwareness.getLocalState()?.user).toBeUndefined();
      // 使用有效的 Y.Doc 更新数据
      const docUpdate = Y.encodeStateAsUpdate(parentDoc);
      const syncEvent = createMessageEvent(
        { type: "ydoc-sync", payload: Array.from(docUpdate) },
        window.parent
      );
      window.dispatchEvent(syncEvent);
      provider.setLocalFields({ name: "New User" });
      const setFieldsCall = mockPostMessage.mock.calls.find(
        (call) => (call[0] as { type?: string }).type === "set-local-fields"
      );
      expect(setFieldsCall).toBeDefined();
      const messageEvent = createMessageEvent(setFieldsCall![0], mockIframeContentWindow);
      window.dispatchEvent(messageEvent);
      const serverState = parentAwareness.getLocalState();
      expect(serverState?.user).toEqual({ name: "New User" });
      server.destroy();
      provider.destroy();
    });
  });
});
