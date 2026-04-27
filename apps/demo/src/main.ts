import { DRAWIO_VERSIONS, DEFAULT_ROOM } from "./config.js";
import { loadDrawioScript, isDrawioLoaded } from "./drawio-loader.js";
import {
  createCollaboration,
  bindDrawioFile,
  disconnectCollaboration,
  type CollabState,
} from "./collaboration.js";
import {
  getUIElements,
  updateDrawioStatus,
  updateCollabStatus,
  updatePeerCount,
  showLoading,
  showReady,
  showConnecting,
  showDisconnected,
  toggleCustomUrl,
  restoreRoomFromURL,
} from "./ui.js";

// === 状态 ===
let collabState: CollabState = { provider: null, doc: null, binding: null };
let drawioLoaded = false;

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

ui.connectBtn.addEventListener("click", async () => {
  if (!drawioLoaded || !isDrawioLoaded()) {
    alert("请等待 draw.io 加载完成");
    return;
  }

  const roomName = ui.roomInput.value.trim() || DEFAULT_ROOM;

  updateCollabStatus(ui, "loading", "连接中...");
  showConnecting(ui);

  // 创建协作连接
  collabState = createCollaboration(roomName, {
    onPeerCountChange: (count) => updatePeerCount(ui, count),
    onStatusChange: (status, text) => updateCollabStatus(ui, status, text),
  });

  // 绑定 draw.io
  const cancelBind = bindDrawioFile(
    collabState.doc!,
    collabState.provider!,
    (binding) => {
      collabState.binding = binding;
    },
  );

  // 保存取消绑定函数用于清理
  (collabState as any).cancelBind = cancelBind;
});

ui.disconnectBtn.addEventListener("click", () => {
  disconnectCollaboration(collabState);
  collabState = { provider: null, doc: null, binding: null };
  showDisconnected(ui);
  updateCollabStatus(ui, "disconnected", "未连接");
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

  // 加载 draw.io
  showLoading(ui, "正在加载 draw.io...");

  try {
    await loadDrawioScript(version, {
      onLoading: () => updateDrawioStatus(ui, "loading", "加载中..."),
      onReady: (v) => {
        drawioLoaded = true;
        showReady(ui);
        updateDrawioStatus(ui, "ready", `已加载 (${v})`);
      },
      onError: (msg) => {
        updateDrawioStatus(ui, "error", "加载失败");
        ui.loadingText.textContent = msg;
      },
    });
  } catch (e) {
    console.error("[drawio] 加载失败:", e);
  }
}

window.addEventListener("DOMContentLoaded", init);
