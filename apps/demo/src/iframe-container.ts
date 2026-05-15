import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { createIframeBridgeServer } from "y-mxgraph/iframe-bridge/server";
import { IFRAME_ORIGIN } from "y-mxgraph/iframe-bridge";
import { LOCAL_ORIGIN } from "y-mxgraph";
import { DRAWIO_VERSIONS, SIGNALING_SERVERS, DEFAULT_ROOM } from "./config.js";

// === UI 元素 ===
const ui = {
  versionSelect: document.getElementById("version-select") as HTMLSelectElement,
  customUrlGroup: document.getElementById("custom-url-group") as HTMLDivElement,
  customUrlInput: document.getElementById(
    "custom-url-input",
  ) as HTMLInputElement,
  roomInput: document.getElementById("room-input") as HTMLInputElement,
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

function updateCollabStatus(
  status: "connected" | "disconnected" | "loading",
  text: string,
) {
  ui.collabStatus.textContent = text;
  ui.collabDot.className = "status-dot";
  if (status === "connected") ui.collabDot.classList.add("connected");
  else if (status === "loading") ui.collabDot.classList.add("loading");
}

function updatePeerCount(count: number) {
  ui.peerNum.textContent = String(count);
  ui.peerCount.style.display = count > 0 ? "inline" : "none";
}

function getIframeSrc(version: string, customUrl?: string) {
  const params = new URLSearchParams();
  params.set("version", version);
  if (customUrl) params.set("customUrl", customUrl);
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

function initBridge(roomName: string) {
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
  delete (window as any).__undoManager__;

  const doc = new Y.Doc();
  const provider = new WebrtcProvider(roomName, doc, {
    signaling: SIGNALING_SERVERS,
  });
  const awareness = provider.awareness;
  const undoManager = new Y.UndoManager(doc, {
    trackedOrigins: new Set([LOCAL_ORIGIN, IFRAME_ORIGIN]),
  });

  const bridgeServer = createIframeBridgeServer(ui.iframe, doc, awareness, {
    undoManager,
  });

  currentProvider = provider;
  currentBridge = bridgeServer;
  currentUndoManager = undoManager;

  // 挂载到 window 供调试
  (window as any).__doc__ = doc;
  (window as any).__undoManager__ = undoManager;
  (window as any).__provider__ = provider;
  (window as any).__bridge__ = bridgeServer;

  undoManager.on("stack-item-added", updateUndoRedoButtons);
  undoManager.on("stack-item-popped", updateUndoRedoButtons);
  undoManager.on("stack-cleared", updateUndoRedoButtons);
  updateUndoRedoButtons();

  provider.on("status", (event: { connected: boolean }) => {
    if (event.connected) {
      updateCollabStatus("connected", `Connected (${roomName})`);
    } else {
      updateCollabStatus("loading", "Reconnecting...");
    }
  });

  awareness.on("update", () => {
    updatePeerCount(awareness.getStates().size);
  });

  updateCollabStatus("loading", "Connecting...");

  // 暴露调试对象到全局
  const win = window as any;
  win.__provider__ = provider;
  win.__doc__ = doc;
  win.__undoManager__ = undoManager;
  win.__awareness__ = awareness;
  win.__bridge__ = bridgeServer;
}

function init() {
  // 从 URL 获取版本和房间
  const urlParams = new URLSearchParams(location.search);
  const urlVersion = urlParams.get("version");
  const version =
    urlVersion && DRAWIO_VERSIONS[urlVersion] ? urlVersion : "latest";
  const customUrl = urlParams.get("customUrl") || undefined;
  const roomName = urlParams.get("room") || DEFAULT_ROOM;

  ui.versionSelect.value = version;
  ui.customUrlGroup.style.display = version === "custom" ? "flex" : "none";
  if (customUrl) ui.customUrlInput.value = customUrl;
  ui.roomInput.value = roomName;

  // 加载子 iframe
  ui.iframe.src = getIframeSrc(version, customUrl);

  initBridge(roomName);

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

      ui.iframe.src = getIframeSrc(v);
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
      const url = new URL(location.href);
      if (room === DEFAULT_ROOM) url.searchParams.delete("room");
      else url.searchParams.set("room", room);
      history.replaceState(null, "", url.toString());
      initBridge(room);
    }
  });

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
