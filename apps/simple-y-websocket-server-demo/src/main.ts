import { DRAWIO_VERSIONS, DEFAULT_ROOM } from "./config.js";
import { loadDrawioScript } from "./drawio-loader.js";
import { Binding } from "y-mxgraph";
import {
  createCollaboration,
  bindDrawioFile,
  type CollabState,
} from "./collaboration.js";
import {
  getUIElements,
  updateDrawioStatus,
  updateCollabStatus,
  updatePeerCount,
  showLoading,
  showReady,
  toggleCustomUrl,
  restoreRoomFromURL,
  applyI18n,
  getI18n,
  type Lang,
} from "./ui.js";

// === 状态 ===
let collabState: CollabState = { provider: null, doc: null, binding: null };

// === 语言 ===
const langParam = new URLSearchParams(location.search).get("lang");
const lang: Lang = langParam === "zh" ? "zh" : "en";
const t = getI18n(lang);

// === UI 元素 ===
const ui = getUIElements();

// === 事件监听 ===
ui.versionSelect.addEventListener("change", () => {
  const version = ui.versionSelect.value;
  const isCustom = version === "custom";

  toggleCustomUrl(ui, isCustom);

  // 非自定义版本切换时刷新页面（保留房间参数）
  if (!isCustom) {
    const url = new URL(location.href);
    if (version === "latest") {
      url.searchParams.delete("version");
    } else {
      url.searchParams.set("version", version);
    }
    location.href = url.toString();
  }
});

// === 初始化 ===
async function init() {
  // 从 URL 恢复房间
  restoreRoomFromURL(ui);

  // 获取版本（优先 URL 参数，默认 latest）
  const urlVersion = new URLSearchParams(location.search).get("version");
  const version =
    urlVersion && DRAWIO_VERSIONS[urlVersion] ? urlVersion : "latest";
  ui.versionSelect.value = version;
  toggleCustomUrl(ui, version === "custom");

  // 应用语言
  applyI18n(lang);

  // 加载 draw.io
  showLoading(ui, t.loadingDrawio);

  const setStep = (step: "preconfig" | "app" | "init") => {
    const order = ["preconfig", "app", "init"] as const;
    const idx = order.indexOf(step);
    order.forEach((s, i) => {
      const el = document.getElementById(`step-${s}`);
      if (!el) return;
      const icon = el.querySelector(".step-icon")!;
      el.classList.remove("active", "done");
      if (i < idx) {
        el.classList.add("done");
        icon.textContent = "✓";
      } else if (i === idx) {
        el.classList.add("active");
        icon.textContent = "◉";
      } else {
        icon.textContent = "○";
      }
    });
  };

  try {
    await loadDrawioScript(
      version,
      {
        onLoading: () => updateDrawioStatus(ui, "loading", t.drawioLoading),
        onProgress: setStep,
        onReady: (v) => {
          showReady(ui);
          updateDrawioStatus(ui, "ready", t.drawioLoaded(v));
          // 加载完成后自动连接
          connectCollaboration();
        },
        onError: (msg) => {
          updateDrawioStatus(ui, "error", t.drawioFailed);
          ui.loadingText.textContent = msg;
        },
      },
      undefined,
      lang,
    );
  } catch (e) {
    console.error("[drawio] Failed to load:", e);
  }
}

/**
 * 连接协作（使用 y-websocket）
 */
function connectCollaboration() {
  const roomName = ui.roomInput.value.trim() || DEFAULT_ROOM;

  updateCollabStatus(ui, "loading", t.collabConnecting);

  // 创建协作连接
  collabState = createCollaboration(roomName, {
    onPeerCountChange: (count) => updatePeerCount(ui, count),
    onStatusChange: (status, text) => updateCollabStatus(ui, status, text),
    connectedText: t.collabConnected,
    reconnectingText: t.collabReconnecting,
  });

  // 绑定 draw.io（等待 provider sync 后,由 Binding 内部处理数据同步）
  bindDrawioFile(
    collabState.provider!,
    collabState.doc!,
    collabState.provider!.awareness,
    (binding: Binding) => {
      collabState.binding = binding;
      Reflect.set(window, "__provider__", collabState.provider);
    },
  );
}

window.addEventListener("DOMContentLoaded", init);
