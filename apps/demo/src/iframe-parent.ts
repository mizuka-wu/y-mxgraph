/**
 * iframe 模式父页（v1.3 bridge）。
 *
 * 设计：
 * - 页面挂 2 个 iframe (A/B)。v1.3 bridge 要求 Provider 与 iframe 1:1，
 *   因此每个 iframe 独立：一份 Y.Doc + WebrtcProvider + BridgeProvider。
 * - 两个 iframe 用同一个 room 通过 WebRTC 互相发现，彼此作为真正的
 *   协作 peer（而不是原来那种父端手动 fan-out 的方案）。
 */
import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { YMxGraphBridgeProvider } from "@y-mxgraph/iframe-bridge";
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

// === 状态 ===
interface Slot {
  id: "1" | "2";
  iframe: HTMLIFrameElement;
  doc: Y.Doc;
  rtc: WebrtcProvider;
  bridge: YMxGraphBridgeProvider;
  rtcConnected: boolean;
  synced: boolean;
}

const slots = new Map<"1" | "2", Slot>();

// === 工具函数 ===
function updateDrawioStatus(id: "1" | "2", ready: boolean) {
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
  state: "connected" | "disconnected" | "loading",
  text: string,
) {
  ui.collabStatus.textContent = text;
  ui.collabDot.className = "status-dot";
  if (state === "connected") ui.collabDot.classList.add("connected");
  else if (state === "loading") ui.collabDot.classList.add("loading");
}

function recomputeCollabStatus(roomName: string) {
  const connected = [...slots.values()].every((s) => s.rtcConnected);
  if (connected && slots.size === 2) {
    updateCollabStatus("connected", `Connected (${roomName})`);
  } else {
    updateCollabStatus("loading", "Connecting...");
  }
}

function recomputePeerCount() {
  // 两个 slot 共享同一个 room，取一个 slot 看到的 peer 数即可。
  const first = slots.get("1") ?? slots.get("2");
  if (!first) {
    ui.peerCount.style.display = "none";
    return;
  }
  const count = first.rtc.awareness.getStates().size;
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

// === Slot 生命周期 ===
function createSlot(id: "1" | "2", iframe: HTMLIFrameElement, roomName: string): Slot {
  const doc = new Y.Doc();
  const rtc = new WebrtcProvider(roomName, doc, {
    signaling: SIGNALING_SERVERS,
  });
  const bridge = new YMxGraphBridgeProvider(iframe, doc, {
    awareness: rtc.awareness,
    // 子页重载期间不要立刻判死亡
    disconnectTimeout: 30_000,
    onDisconnect: () => {
      updateDrawioStatus(id, false);
    },
  });

  const slot: Slot = {
    id,
    iframe,
    doc,
    rtc,
    bridge,
    rtcConnected: false,
    synced: false,
  };

  bridge.on("connected", () => {
    // 心跳接通意味着子页已经响应，但不代表 drawio 已经绑定，
    // 真正的 "ready" 以子页 AWARENESS_SET 上报的 ready 字段为准（见下）。
  });

  bridge.on("disconnected", () => {
    updateDrawioStatus(id, false);
  });

  // 子页绑定完成后会 setLocalStateField('drawioReady', true)，借此判定 UI ready
  rtc.awareness.on("update", () => {
    const myState = rtc.awareness.getLocalState() as
      | { drawioReady?: boolean }
      | null;
    updateDrawioStatus(id, !!myState?.drawioReady);
    recomputePeerCount();
  });

  rtc.on("status", (event: { connected: boolean }) => {
    slot.rtcConnected = event.connected;
    recomputeCollabStatus(roomName);
  });

  return slot;
}

function destroySlot(slot: Slot) {
  slot.bridge.destroy();
  slot.rtc.disconnect();
  slot.rtc.destroy();
  slot.doc.destroy();
}

function rebuildAll(roomName: string, version: string, customUrl?: string) {
  // 先销毁老的
  for (const slot of slots.values()) destroySlot(slot);
  slots.clear();
  updateDrawioStatus("1", false);
  updateDrawioStatus("2", false);
  updateCollabStatus("loading", "Connecting...");

  // iframe.src 切版本
  ui.iframeA.src = getIframeSrc("1", version, customUrl);
  ui.iframeB.src = getIframeSrc("2", version, customUrl);

  slots.set("1", createSlot("1", ui.iframeA, roomName));
  slots.set("2", createSlot("2", ui.iframeB, roomName));
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

    const roomName = ui.roomInput.value.trim() || DEFAULT_ROOM;
    rebuildAll(roomName, version);
  }
});

ui.roomInput.addEventListener("change", () => {
  const version = ui.versionSelect.value;
  const roomName = ui.roomInput.value.trim() || DEFAULT_ROOM;
  rebuildAll(roomName, version);
});

// === 初始化 ===
function init() {
  const urlVersion = new URLSearchParams(location.search).get("version");
  const version =
    urlVersion && DRAWIO_VERSIONS[urlVersion] ? urlVersion : "latest";
  ui.versionSelect.value = version;

  const isCustom = version === "custom";
  ui.customUrlGroup.style.display = isCustom ? "flex" : "none";

  const roomName = ui.roomInput.value.trim() || DEFAULT_ROOM;

  // iframe.src 里附带当前版本
  ui.iframeA.src = getIframeSrc("1", version);
  ui.iframeB.src = getIframeSrc("2", version);

  slots.set("1", createSlot("1", ui.iframeA, roomName));
  slots.set("2", createSlot("2", ui.iframeB, roomName));

  updateCollabStatus("loading", "Connecting...");
}

window.addEventListener("DOMContentLoaded", init);
window.addEventListener("beforeunload", () => {
  for (const slot of slots.values()) destroySlot(slot);
});
