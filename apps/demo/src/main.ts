import { DRAWIO_VERSIONS, DEFAULT_ROOM } from "./config.js";
import { loadDrawioScript } from "./drawio-loader.js";
import {
  createCollaboration,
  bindDrawioFile,
  type CollabState,
} from "./collaboration.js";
import { createIframeBridgeProvider } from "y-mxgraph/iframe-bridge/provider";
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
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";

const isInIframe = window.parent !== window;

// === 状态 ===
let collabState: CollabState = { provider: null, doc: null, binding: null };

// === 语言 ===
const langParam = new URLSearchParams(location.search).get("lang");
const lang: Lang = langParam === "zh" ? "zh" : "en";
const t = getI18n(lang);

// === UI 元素 ===
const ui = getUIElements();

// === 在 iframe 中时隐藏 toolbar 和 status-bar ===
if (isInIframe) {
  const toolbar = document.getElementById("toolbar");
  const statusBar = document.getElementById("status-bar");
  if (toolbar) toolbar.style.display = "none";
  if (statusBar) statusBar.style.display = "none";
}

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
  if (isInIframe) {
    await initIframeChild();
  } else {
    await initDirect();
  }
}

async function initDirect() {
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

async function initIframeChild() {
  const urlParams = new URLSearchParams(location.search);
  const version = urlParams.get("version") || "latest";
  const customUrl = urlParams.get("customUrl") || undefined;
  const iframeId = urlParams.get("iframeId") || "0";

  const overlay = document.getElementById("loading-overlay")!;
  const container = document.getElementById("drawio-container")!;

  try {
    await loadDrawioScript(
      version,
      {
        onLoading: () => {},
        onProgress: () => {},
        onReady: () => {
          overlay.style.display = "none";
          container.style.removeProperty("display");
        },
        onError: (msg) => {
          console.error(`[iframe ${iframeId}]`, msg);
        },
      },
      customUrl,
      lang,
    );
  } catch (e) {
    console.error(`[iframe ${iframeId}] Failed to load draw.io:`, e);
    return;
  }

  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);

  const bridgeProvider = createIframeBridgeProvider(ydoc, awareness);

  bindDrawioFile(ydoc, awareness, null as any, (binding) => {
    console.log(`[iframe ${iframeId}] draw.io bound`);
    bridgeProvider.takeoverUndoManager(binding.file);
  }, false);

  (window as any).__iframeYdoc__ = ydoc;
  (window as any).__iframeAwareness__ = awareness;
  (window as any).__iframeBridgeProvider__ = bridgeProvider;
}

/**
 * 连接协作（直接模式）
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

  // 绑定 draw.io（等待 Provider 初始同步）
  bindDrawioFile(
    collabState.doc!,
    collabState.provider!.awareness,
    collabState.provider!,
    (binding) => {
      collabState.binding = binding;
      Reflect.set(window, "__provider__", collabState.provider);
    },
  );
}

window.addEventListener("DOMContentLoaded", init);
