import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import { WebrtcProvider } from "y-webrtc";
import { DRAWIO_VERSIONS, SIGNALING_SERVERS, DEFAULT_ROOM } from "./config.js";

// === UI 元素 ===
const ui = {
  versionSelect: document.getElementById("version-select") as HTMLSelectElement,
  customUrlGroup: document.getElementById("custom-url-group") as HTMLDivElement,
  customUrlInput: document.getElementById(
    "custom-url-input",
  ) as HTMLInputElement,
  roomInput: document.getElementById("room-input") as HTMLInputElement,
  drawioDotA: document.getElementById("drawio-dot-a") as HTMLSpanElement,
  drawioStatusA: document.getElementById("drawio-status-a") as HTMLSpanElement,
  drawioDotB: document.getElementById("drawio-dot-b") as HTMLSpanElement,
  drawioStatusB: document.getElementById("drawio-status-b") as HTMLSpanElement,
  collabDot: document.getElementById("collab-dot") as HTMLSpanElement,
  collabStatus: document.getElementById("collab-status") as HTMLSpanElement,
  peerCount: document.getElementById("peer-count") as HTMLSpanElement,
  peerNum: document.getElementById("peer-num") as HTMLSpanElement,
  iframeA: document.getElementById("iframe-a") as HTMLIFrameElement,
  iframeB: document.getElementById("iframe-b") as HTMLIFrameElement,
};

const iframeReady = new Map<string, boolean>([
  ["1", false],
  ["2", false],
]);

// === 状态 ===
let bridgeState: {
  provider: WebrtcProvider | null;
  doc: Y.Doc | null;
  awareness: Awareness | null;
} = { provider: null, doc: null, awareness: null };

// === 工具函数 ===
function updateDrawioStatus(id: string, ready: boolean) {
  const dot = id === "1" ? ui.drawioDotA : ui.drawioDotB;
  const status = id === "1" ? ui.drawioStatusA : ui.drawioStatusB;
  dot.className = "status-dot";
  if (ready) {
    dot.classList.add("connected");
    status.textContent = "Ready";
  } else {
    status.textContent = "Not loaded";
  }
}

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

function getIframeSrc(iframeId: string, version: string, customUrl?: string) {
  const params = new URLSearchParams();
  params.set("iframeId", iframeId);
  params.set("version", version);
  if (customUrl) params.set("customUrl", customUrl);
  return `./iframe.html?${params.toString()}`;
}

function broadcastToIframes(type: string, payload: Uint8Array) {
  if (ui.iframeA.contentWindow) {
    ui.iframeA.contentWindow.postMessage({ type, payload }, "*");
  }
  if (ui.iframeB.contentWindow) {
    ui.iframeB.contentWindow.postMessage({ type, payload }, "*");
  }
}

// === 版本切换 ===
ui.versionSelect.addEventListener("change", () => {
  const version = ui.versionSelect.value;
  const isCustom = version === "custom";
  ui.customUrlGroup.style.display = isCustom ? "flex" : "none";

  if (!isCustom) {
    const url = new URL(location.href);
    if (version === "latest") {
      url.searchParams.delete("version");
    } else {
      url.searchParams.set("version", version);
    }
    history.replaceState(null, "", url.toString());

    // 刷新两个 iframe
    ui.iframeA.src = getIframeSrc("1", version);
    ui.iframeB.src = getIframeSrc("2", version);
    iframeReady.set("1", false);
    iframeReady.set("2", false);
    updateDrawioStatus("1", false);
    updateDrawioStatus("2", false);
  }
});

// === 初始化 ===
function init() {
  // 从 URL 获取版本
  const urlVersion = new URLSearchParams(location.search).get("version");
  const version =
    urlVersion && DRAWIO_VERSIONS[urlVersion] ? urlVersion : "latest";
  ui.versionSelect.value = version;

  // 自定义 URL
  const isCustom = version === "custom";
  ui.customUrlGroup.style.display = isCustom ? "flex" : "none";

  // 房间号
  const roomName = ui.roomInput.value.trim() || DEFAULT_ROOM;

  // 创建 bridge ydoc + WebRTC provider
  const doc = new Y.Doc();
  const provider = new WebrtcProvider(roomName, doc, {
    signaling: SIGNALING_SERVERS,
  });
  const awareness = provider.awareness;

  bridgeState = { provider, doc, awareness };

  // 监听 provider 连接状态
  provider.on("status", (event: { connected: boolean }) => {
    if (event.connected) {
      updateCollabStatus("connected", `Connected (${roomName})`);
    } else {
      updateCollabStatus("loading", "Reconnecting...");
    }
  });

  // 监听 awareness 更新以刷新在线人数
  awareness.on("update", () => {
    const count = awareness.getStates().size;
    updatePeerCount(count);
  });

  // 监听 bridge ydoc update -> 广播给所有 iframe
  doc.on("update", (update: Uint8Array) => {
    broadcastToIframes("ydoc-update", update);
  });

  // 监听 bridge awareness update -> 广播给所有 iframe
  awareness.on(
    "update",
    ({
      added,
      updated,
      removed,
    }: {
      added: number[];
      updated: number[];
      removed: number[];
    }) => {
      const changes = [...added, ...updated, ...removed];
      if (changes.length === 0) return;
      const update = encodeAwarenessUpdate(awareness, changes);
      broadcastToIframes("awareness-update", update);
    },
  );

  // 监听 iframe 消息
  window.addEventListener("message", (event) => {
    if (
      event.source !== ui.iframeA.contentWindow &&
      event.source !== ui.iframeB.contentWindow
    )
      return;
    const { type, iframeId, payload } = event.data;
    if (!iframeId || (iframeId !== "1" && iframeId !== "2")) return;

    const sourceWindow = event.source as Window;

    if (type === "init") {
      // iframe 初始化完成，发送完整 ydoc 和 awareness 状态
      if (!iframeReady.get(iframeId)) {
        iframeReady.set(iframeId, true);
        updateDrawioStatus(iframeId, true);
      }
      const docState = Y.encodeStateAsUpdate(doc);
      const awarenessState = encodeAwarenessUpdate(
        awareness,
        Array.from(awareness.getStates().keys()),
      );
      sourceWindow.postMessage(
        { type: "ydoc-sync", payload: Array.from(docState) },
        "*",
      );
      sourceWindow.postMessage(
        { type: "awareness-sync", payload: Array.from(awarenessState) },
        "*",
      );
    } else if (type === "ydoc-update") {
      Y.applyUpdate(doc, new Uint8Array(payload));
    } else if (type === "awareness-update") {
      applyAwarenessUpdate(awareness, new Uint8Array(payload), null);
    }
  });

  updateCollabStatus("loading", "Connecting...");
}

window.addEventListener("DOMContentLoaded", init);
