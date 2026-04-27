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
