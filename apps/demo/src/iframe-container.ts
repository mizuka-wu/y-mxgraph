import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { createIframeBridgeParent } from "y-mxgraph/iframe-bridge/parent";
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
};

let currentProvider: WebrtcProvider | null = null;
let currentBridge: ReturnType<typeof createIframeBridgeParent> | null = null;

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

function initBridge(roomName: string) {
  // 清理旧的
  if (currentBridge) {
    currentBridge.dispose();
    currentBridge = null;
  }
  if (currentProvider) {
    currentProvider.disconnect();
    currentProvider.destroy();
    currentProvider = null;
  }

  const doc = new Y.Doc();
  const provider = new WebrtcProvider(roomName, doc, {
    signaling: SIGNALING_SERVERS,
  });
  const awareness = provider.awareness;

  const bridgeParent = createIframeBridgeParent(doc, awareness);
  bridgeParent.addIframe(ui.iframe, "child");

  currentProvider = provider;
  currentBridge = bridgeParent;

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

  // 初始化 bridge
  initBridge(roomName);

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

  // 暴露调试对象
  (window as any).__iframeContainer__ = {
    get provider() {
      return currentProvider;
    },
    get bridge() {
      return currentBridge;
    },
  };
}

window.addEventListener("DOMContentLoaded", init);
