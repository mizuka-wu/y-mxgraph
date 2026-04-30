export type Lang = "en" | "zh";

const I18N: Record<
  Lang,
  {
    versionLabel: string;
    customUrlOption: string;
    roomLabel: string;
    drawioNotLoaded: string;
    collabLabel: string;
    collabDisconnected: string;
    onlinePrefix: string;
    loadingDrawio: string;
    stepPreconfig: string;
    stepApp: string;
    stepInit: string;
    drawioLoading: string;
    drawioFailed: string;
    collabConnecting: string;
    collabReconnecting: string;
    collabConnected: (room: string) => string;
    drawioLoaded: (v: string) => string;
  }
> = {
  en: {
    versionLabel: "draw.io version:",
    customUrlOption: "Custom URL...",
    roomLabel: "Room:",
    drawioNotLoaded: "Not loaded",
    collabLabel: "Collab:",
    collabDisconnected: "Disconnected",
    onlinePrefix: "Online:",
    loadingDrawio: "Loading draw.io...",
    stepPreconfig: "Loading PreConfig.js",
    stepApp: "Loading editor (app.min.js)",
    stepInit: "Initializing editor",
    drawioLoading: "Loading...",
    drawioFailed: "Failed to load",
    collabConnecting: "Connecting...",
    collabReconnecting: "Reconnecting...",
    collabConnected: (room) => `Connected (${room})`,
    drawioLoaded: (v) => `Loaded (${v})`,
  },
  zh: {
    versionLabel: "draw.io 版本:",
    customUrlOption: "自定义 URL...",
    roomLabel: "房间:",
    drawioNotLoaded: "未加载",
    collabLabel: "协作:",
    collabDisconnected: "未连接",
    onlinePrefix: "在线:",
    loadingDrawio: "正在加载 draw.io...",
    stepPreconfig: "加载预配置 (PreConfig.js)",
    stepApp: "加载编辑器 (app.min.js)",
    stepInit: "初始化编辑器",
    drawioLoading: "加载中...",
    drawioFailed: "加载失败",
    collabConnecting: "连接中...",
    collabReconnecting: "重连中...",
    collabConnected: (room) => `已连接 (${room})`,
    drawioLoaded: (v) => `已加载 (${v})`,
  },
};

export function getI18n(lang: Lang) {
  return I18N[lang] ?? I18N.en;
}

export function applyI18n(lang: Lang): void {
  const t = getI18n(lang);
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";

  const setText = (sel: string, text: string) => {
    const el = document.querySelector(sel);
    if (el) el.textContent = text;
  };

  // Toolbar labels
  setText("#label-version", t.versionLabel);
  setText("#label-room", t.roomLabel);
  const customOpt = document.querySelector(
    "#version-select option[value='custom']",
  ) as HTMLOptionElement | null;
  if (customOpt) customOpt.textContent = t.customUrlOption;

  // Status bar labels
  setText("#label-drawio", "draw.io: ");
  setText("#label-collab", t.collabLabel + " ");

  // Status values (only if still showing default/initial state)
  setText("#drawio-status", t.drawioNotLoaded);
  setText("#collab-status", t.collabDisconnected);

  // Loading overlay
  setText("#loading-text", t.loadingDrawio);
  setText("#step-preconfig span:last-child", t.stepPreconfig);
  setText("#step-app span:last-child", t.stepApp);
  setText("#step-init span:last-child", t.stepInit);

  // Online peer count prefix
  const onlineLabel = document.getElementById("label-online");
  if (onlineLabel) onlineLabel.textContent = t.onlinePrefix + " ";
}

/**
 * DOM 元素引用集合
 */
export function getUIElements() {
  return {
    // 控件
    versionSelect: document.getElementById(
      "version-select",
    ) as HTMLSelectElement,
    customUrlGroup: document.getElementById(
      "custom-url-group",
    ) as HTMLDivElement,
    customUrlInput: document.getElementById(
      "custom-url-input",
    ) as HTMLInputElement,
    roomInput: document.getElementById("room-input") as HTMLInputElement,

    // 容器
    drawioWrapper: document.getElementById("drawio-wrapper") as HTMLDivElement,
    drawioContainer: document.getElementById(
      "drawio-container",
    ) as HTMLDivElement,
    loadingOverlay: document.getElementById(
      "loading-overlay",
    ) as HTMLDivElement,
    loadingText: document.querySelector(
      "#loading-overlay p",
    ) as HTMLParagraphElement,

    // 状态显示
    drawioStatusEl: document.getElementById("drawio-status") as HTMLSpanElement,
    drawioDot: document.getElementById("drawio-dot") as HTMLSpanElement,
    collabStatusEl: document.getElementById("collab-status") as HTMLSpanElement,
    collabDot: document.getElementById("collab-dot") as HTMLSpanElement,
    peerCountEl: document.getElementById("peer-count") as HTMLSpanElement,
    peerNumEl: document.getElementById("peer-num") as HTMLSpanElement,

    // 调试面板
    debugLog: document.getElementById(
      "y-mxgraph-debug-log",
    ) as HTMLDivElement,
    debugClearBtn: document.getElementById(
      "debug-panel-clear",
    ) as HTMLButtonElement,
  };
}

export type UIElements = ReturnType<typeof getUIElements>;

/**
 * 状态样式
 */
export type DrawioStatus = "loading" | "ready" | "error";
export type CollabStatus = "connected" | "disconnected" | "loading";

/**
 * 更新 draw.io 状态显示
 */
export function updateDrawioStatus(
  elements: UIElements,
  status: DrawioStatus,
  text: string,
): void {
  elements.drawioStatusEl.textContent = text;
  elements.drawioDot.className = "status-dot";
  if (status === "ready") elements.drawioDot.classList.add("connected");
  else if (status === "loading") elements.drawioDot.classList.add("loading");
}

/**
 * 更新协作状态显示
 */
export function updateCollabStatus(
  elements: UIElements,
  status: CollabStatus,
  text: string,
): void {
  elements.collabStatusEl.textContent = text;
  elements.collabDot.className = "status-dot";
  if (status === "connected") elements.collabDot.classList.add("connected");
  else if (status === "loading") elements.collabDot.classList.add("loading");
}

/**
 * 更新在线人数显示
 */
export function updatePeerCount(elements: UIElements, count: number): void {
  elements.peerNumEl.textContent = String(count);
  elements.peerCountEl.style.display = count > 0 ? "inline" : "none";
}

/**
 * 显示加载中状态
 */
export function showLoading(elements: UIElements, message: string): void {
  elements.loadingOverlay.style.display = "flex";
  elements.loadingOverlay.style.zIndex = "10";
  elements.drawioContainer.style.removeProperty("display");
  elements.loadingText.textContent = message;
}

/**
 * 显示就绪状态
 */
export function showReady(elements: UIElements): void {
  elements.loadingOverlay.style.display = "none";
  elements.drawioContainer.style.removeProperty("display");
}

/**
 * 切换自定义 URL 输入框显示
 */
export function toggleCustomUrl(elements: UIElements, show: boolean): void {
  elements.customUrlGroup.style.display = show ? "flex" : "none";
}

/**
 * 从 URL 恢复房间名称
 */
export function restoreRoomFromURL(elements: UIElements): string {
  const room = new URLSearchParams(location.search).get("room") || "";
  if (room) {
    elements.roomInput.value = room;
  }
  return room;
}

/**
 * 初始化调试面板事件监听
 */
export function initDebugPanel(elements: UIElements): void {
  if (elements.debugClearBtn) {
    elements.debugClearBtn.addEventListener("click", () => {
      if (elements.debugLog) {
        elements.debugLog.innerHTML = "";
      }
    });
  }
}
