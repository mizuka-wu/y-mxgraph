import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { createIframeBridgeServer } from "y-mxgraph/iframe-bridge/server";
import { IFRAME_ORIGIN } from "y-mxgraph/iframe-bridge";
import { LOCAL_ORIGIN } from "y-mxgraph";
import { installDebugTools, type DebugTools } from "@y-mxgraph/debug";
import {
  DRAWIO_VERSIONS,
  SIGNALING_SERVERS,
  DEFAULT_ROOM,
  DEFAULT_IFRAME_USER,
} from "./config.js";

// === UI 元素 ===
const ui = {
  versionSelect: document.getElementById("version-select") as HTMLSelectElement,
  customUrlGroup: document.getElementById("custom-url-group") as HTMLDivElement,
  customUrlInput: document.getElementById(
    "custom-url-input",
  ) as HTMLInputElement,
  roomInput: document.getElementById("room-input") as HTMLInputElement,
  serverDelayInput: document.getElementById(
    "server-delay-input",
  ) as HTMLInputElement,
  userAccountInput: document.getElementById(
    "user-account-input",
  ) as HTMLInputElement,
  userNameInput: document.getElementById("user-name-input") as HTMLInputElement,
  userColorInput: document.getElementById(
    "user-color-input",
  ) as HTMLInputElement,
  collabDot: document.getElementById("collab-dot") as HTMLSpanElement,
  collabStatus: document.getElementById("collab-status") as HTMLSpanElement,
  peerCount: document.getElementById("peer-count") as HTMLSpanElement,
  peerNum: document.getElementById("peer-num") as HTMLSpanElement,
  iframe: document.getElementById("child-iframe") as HTMLIFrameElement,
  undoBtn: document.getElementById("undo-btn") as HTMLButtonElement,
  redoBtn: document.getElementById("redo-btn") as HTMLButtonElement,
};

let currentProvider: WebrtcProvider | null = null;
let currentBridge: ReturnType<typeof createIframeBridgeServer> | null = null;
let currentUndoManager: Y.UndoManager | null = null;
let currentDebugTools: DebugTools | null = null;

let providerConnected = false;
let bridgeConnected = false;

function renderStatus() {
  const providerText = providerConnected
    ? "Provider: Connected"
    : "Provider: Disconnected";
  const bridgeText = bridgeConnected ? "Bridge: Connected" : "Bridge: Waiting";
  ui.collabStatus.textContent = `${providerText} | ${bridgeText}`;
  ui.collabDot.className = "status-dot";
  if (providerConnected && bridgeConnected)
    ui.collabDot.classList.add("connected");
  else ui.collabDot.classList.add("loading");
}

function updatePeerCount(count: number) {
  ui.peerNum.textContent = String(count);
  ui.peerCount.style.display = count > 0 ? "inline" : "none";
}

function getIframeSrc(version: string, customUrl?: string) {
  const params = new URLSearchParams();
  params.set("version", version);
  if (customUrl) params.set("customUrl", customUrl);
  const account =
    ui.userAccountInput.value.trim() || DEFAULT_IFRAME_USER.account;
  const name =
    ui.userNameInput.value.trim() || account || DEFAULT_IFRAME_USER.name;
  const userColor = ui.userColorInput.value || DEFAULT_IFRAME_USER.color;
  params.set("account", account);
  if (name !== account) params.set("name", name);
  params.set("userColor", userColor);
  return `./index.html?${params.toString()}`;
}

function updateUndoRedoButtons() {
  if (!currentUndoManager) {
    ui.undoBtn.disabled = true;
    ui.redoBtn.disabled = true;
    return;
  }
  ui.undoBtn.disabled = !currentUndoManager.canUndo();
  ui.redoBtn.disabled = !currentUndoManager.canRedo();
}

function initBridge(roomName: string, serverDelay: number = 0) {
  // 清理旧的
  if (currentBridge) {
    currentBridge.destroy();
    currentBridge = null;
  }
  if (currentProvider) {
    currentProvider.disconnect();
    currentProvider.destroy();
    currentProvider = null;
  }
  if (currentUndoManager) {
    currentUndoManager.destroy();
    currentUndoManager = null;
  }
  if (currentDebugTools) {
    currentDebugTools.destroy();
    currentDebugTools = null;
  }
  delete (window as any).__undoManager__;
  delete (window as any).__debugTools__;

  // 1. 先创建 Y.Doc + Provider（独立同步数据）
  const doc = new Y.Doc();
  const provider = new WebrtcProvider(roomName, doc, {
    signaling: SIGNALING_SERVERS,
  });
  const awareness = provider.awareness;

  // 设置父容器 awareness user，确保 iframe 能从 server 同步到正确的用户信息
  const parentAccount = ui.userAccountInput.value.trim() || "";
  const parentName = ui.userNameInput.value.trim() || parentAccount;
  const parentUserColor = ui.userColorInput.value;
  awareness.setLocalState({
    user: { account: parentAccount, name: parentName, color: parentUserColor },
  });

  currentProvider = provider;

  provider.on("status", (event: { connected: boolean }) => {
    providerConnected = event.connected;
    renderStatus();
  });

  awareness.on("update", () => {
    updatePeerCount(awareness.getStates().size);
  });

  providerConnected = false;
  bridgeConnected = false;
  renderStatus();

  // 暴露 provider 调试对象
  const win = window as any;
  win.__provider__ = provider;
  win.__doc__ = doc;
  win.__awareness__ = awareness;

  // 安装 debug 工具（iframe-container 没有 file，使用 Y.Doc 序列化作为数据源）
  const debugTools = installDebugTools(doc, () => {
    // 返回空字符串，因为 iframe-container 没有直接访问 file 的方式
    // debug 工具会检测到 YDoc 未编辑状态
    return "";
  }, {
    autoStart: true,
    autoCheckIntervalMs: 10000,
    windowKey: "__y_mxgraph_debug__",
  });
  currentDebugTools = debugTools;
  win.__debugTools__ = debugTools;

  // 2. 创建 Server（可延迟，让 provider 有时间同步数据）
  const createServer = () => {
    const mxfileMap = doc.getMap("mxfile");
    const diagramMap = mxfileMap.get("diagram") as any;
    const hasData = diagramMap && diagramMap.size > 0;
    console.log(
      `[iframe-container] createServer — ydoc hasData=${hasData}, diagramMap size=${diagramMap?.size ?? 0}`,
    );

    const undoManager = new Y.UndoManager(doc, {
      trackedOrigins: new Set([LOCAL_ORIGIN, IFRAME_ORIGIN]),
    });

    const bridgeServer = createIframeBridgeServer(ui.iframe, doc, awareness, {
      undoManager,
      debug: true,
    });

    currentBridge = bridgeServer;
    currentUndoManager = undoManager;

    undoManager.on("stack-item-added", updateUndoRedoButtons);
    undoManager.on("stack-item-popped", updateUndoRedoButtons);
    undoManager.on("stack-cleared", updateUndoRedoButtons);
    updateUndoRedoButtons();

    bridgeServer.onConnect(() => {
      console.log(
        `[iframe-container] server onConnect — iframe client connected`,
      );
      bridgeConnected = true;
      renderStatus();
    });

    bridgeServer.onDisconnect(() => {
      console.log(
        `[iframe-container] server onDisconnect — iframe client disconnected`,
      );
      bridgeConnected = false;
      renderStatus();
    });

    // 挂载 server 调试对象
    win.__undoManager__ = undoManager;
    win.__bridge__ = bridgeServer;
  };

  if (serverDelay > 0) {
    setTimeout(createServer, serverDelay);
  } else {
    createServer();
  }
}

function init() {
  // 从 URL 获取版本和房间
  const urlParams = new URLSearchParams(location.search);
  const urlVersion = urlParams.get("version");
  const version =
    urlVersion && DRAWIO_VERSIONS[urlVersion] ? urlVersion : "latest";
  const customUrl = urlParams.get("customUrl") || undefined;
  const roomName = urlParams.get("room") || DEFAULT_ROOM;
  const serverDelay = parseInt(urlParams.get("serverDelay") || "0", 10);

  ui.versionSelect.value = version;
  ui.customUrlGroup.style.display = version === "custom" ? "flex" : "none";
  if (customUrl) ui.customUrlInput.value = customUrl;
  ui.roomInput.value = roomName;
  ui.serverDelayInput.value = String(serverDelay);

  const account =
    urlParams.get("account") ||
    urlParams.get("userName") ||
    DEFAULT_IFRAME_USER.account;
  const name = urlParams.get("name") || account || DEFAULT_IFRAME_USER.name;
  const userColor = urlParams.get("userColor") || DEFAULT_IFRAME_USER.color;
  ui.userAccountInput.value = account;
  ui.userNameInput.value = name;
  ui.userColorInput.value = userColor;

  // 加载子 iframe
  ui.iframe.src = getIframeSrc(version, customUrl);

  initBridge(roomName, serverDelay);

  ui.undoBtn.addEventListener("click", () => {
    if (currentUndoManager && currentUndoManager.canUndo()) {
      currentUndoManager.undo();
    }
  });
  ui.redoBtn.addEventListener("click", () => {
    if (currentUndoManager && currentUndoManager.canRedo()) {
      currentUndoManager.redo();
    }
  });

  // 版本切换
  ui.versionSelect.addEventListener("change", () => {
    const v = ui.versionSelect.value;
    const isCustom = v === "custom";
    ui.customUrlGroup.style.display = isCustom ? "flex" : "none";

    if (!isCustom) {
      const url = new URL(location.href);
      if (v === "latest") url.searchParams.delete("version");
      else url.searchParams.set("version", v);
      history.replaceState(null, "", url.toString());

      ui.iframe.src = getIframeSrc(v, undefined);
    }
  });

  // 自定义 URL 确认（回车）
  ui.customUrlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const url = ui.customUrlInput.value.trim();
      if (url) {
        const u = new URL(location.href);
        u.searchParams.set("customUrl", url);
        history.replaceState(null, "", u.toString());
        ui.iframe.src = getIframeSrc("custom", url);
      }
    }
  });

  // 房间切换
  ui.roomInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const room = ui.roomInput.value.trim() || DEFAULT_ROOM;
      const delay = parseInt(ui.serverDelayInput.value.trim() || "0", 10);
      const url = new URL(location.href);
      if (room === DEFAULT_ROOM) url.searchParams.delete("room");
      else url.searchParams.set("room", room);
      history.replaceState(null, "", url.toString());
      initBridge(room, delay);
    }
  });

  // Server Delay 切换
  ui.serverDelayInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const delay = parseInt(ui.serverDelayInput.value.trim() || "0", 10);
      const url = new URL(location.href);
      if (delay <= 0) url.searchParams.delete("serverDelay");
      else url.searchParams.set("serverDelay", String(delay));
      history.replaceState(null, "", url.toString());
      // 需要重新加载 iframe 才能用新的 delay 创建 server
      const room = ui.roomInput.value.trim() || DEFAULT_ROOM;
      ui.iframe.src = getIframeSrc(
        ui.versionSelect.value,
        ui.customUrlInput.value.trim() || undefined,
      );
      initBridge(room, delay);
    }
  });

  // 用户信息切换
  function onUserInfoChange() {
    const account = ui.userAccountInput.value.trim();
    const name = ui.userNameInput.value.trim() || account;
    const userColor = ui.userColorInput.value;
    const url = new URL(location.href);
    url.searchParams.set("account", account);
    if (name === account) url.searchParams.delete("name");
    else url.searchParams.set("name", name);
    url.searchParams.set("userColor", userColor);
    history.replaceState(null, "", url.toString());

    const room = ui.roomInput.value.trim() || DEFAULT_ROOM;
    const delay = parseInt(ui.serverDelayInput.value.trim() || "0", 10);
    ui.iframe.src = getIframeSrc(
      ui.versionSelect.value,
      ui.customUrlInput.value.trim() || undefined,
    );
    initBridge(room, delay);
  }

  ui.userAccountInput.addEventListener("change", onUserInfoChange);
  ui.userNameInput.addEventListener("change", onUserInfoChange);
  ui.userColorInput.addEventListener("change", onUserInfoChange);

  // 暴露调试对象（getter 形式，始终返回当前值）
  const win = window as any;
  if (!win.__iframeContainer__) {
    win.__iframeContainer__ = {
      get provider() {
        return currentProvider;
      },
      get doc() {
        return currentProvider ? (currentProvider as any).doc : null;
      },
      get awareness() {
        return currentProvider ? currentProvider.awareness : null;
      },
      get bridge() {
        return currentBridge;
      },
    };
  }
}

window.addEventListener("DOMContentLoaded", init);
