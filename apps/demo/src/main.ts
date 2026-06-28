import { DRAWIO_VERSIONS, DEFAULT_ROOM, DEFAULT_IFRAME_USER } from "./config.js";
import { loadDrawioScript } from "./drawio-loader.js";
import {
  createCollaboration,
  bindDrawioFile,
  type CollabState,
} from "./collaboration.js";
import { createIframeBridgeProvider } from "y-mxgraph/iframe-bridge/provider";
import { xml2ydoc, ydoc2xml } from "y-mxgraph/transform";
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

const isInIframe = window.parent !== window;

// === 状态 ===
let collabState: CollabState = { provider: null, doc: null, binding: null, debugTools: null };

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

  const loadingText = overlay.querySelector("p")!;
  const loadingSteps = document.getElementById("loading-steps");

  console.log(`[iframe ${iframeId}] draw.io loading...`);

  // 1. 先加载 draw.io（不等待 server）
  try {
    await loadDrawioScript(
      version,
      {
        onLoading: () => {},
        onProgress: () => {},
        onReady: () => {
          console.log(`[iframe ${iframeId}] draw.io loaded — editor ready`);
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

  // 2. draw.io 加载完成，创建 bridge provider
  const ydoc = new Y.Doc();

  const initAccount =
    urlParams.get("account") ||
    urlParams.get("userName") ||
    DEFAULT_IFRAME_USER.account;
  const initName =
    urlParams.get("name") || initAccount || DEFAULT_IFRAME_USER.name;
  const initUserColor = urlParams.get("userColor") || DEFAULT_IFRAME_USER.color;

  const bridgeProvider = createIframeBridgeProvider(ydoc, { debug: true });
  console.log(
    `[iframe ${iframeId}] bridgeProvider created — connected=${bridgeProvider.connected}`,
  );

  bridgeProvider.setLocalFields({
    account: initAccount,
    name: initName,
    color: initUserColor,
  });

  // 3. 根据 connect 状态决定是否显示编辑器并 bind
  const doBind = () => {
    overlay.style.display = "none";
    container.style.removeProperty("display");
    console.log(
      `[iframe ${iframeId}] doBind — hiding overlay, binding draw.io`,
    );
    bindDrawioFile(
      ydoc,
      bridgeProvider.awareness as any,
      null as any,
      (binding) => {
        console.log(`[iframe ${iframeId}] draw.io bound to ydoc`);
        bridgeProvider.takeoverUndoManager(binding.file);
        // 重置 modified 状态，消除 "unsaved changes" 提示
        const ui = binding.file.getUi();
        ui.editor.setModified(false);
        ui.editor.setStatus("");
        binding.file.setModified(false);
        console.log(
          `[iframe ${iframeId}] editor status reset — unsaved changes cleared`,
        );
      },
      false,
    );
  };

  if (bridgeProvider.connected) {
    console.log(`[iframe ${iframeId}] already connected — binding immediately`);
    doBind();
  } else {
    if (loadingSteps) loadingSteps.style.display = "none";
    loadingText.textContent =
      lang === "zh" ? "等待服务器连接..." : "Waiting for server...";
    overlay.style.background = "rgba(255, 255, 255, 0.5)";
    console.log(`[iframe ${iframeId}] not connected — showing waiting overlay`);
    bridgeProvider.onConnect(doBind);
  }

  (window as any).__iframeYdoc__ = ydoc;
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

  // 设置初始 awareness user
  const urlParams = new URLSearchParams(location.search);
  const initAccount = urlParams.get("account") || urlParams.get("userName");
  const initName = urlParams.get("name") || initAccount;
  const initUserColor = urlParams.get("userColor");
  collabState.provider!.awareness.setLocalState({
    user: { account: initAccount, name: initName, color: initUserColor },
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

// === 导出 Y.Doc XML ===
const btnExportXml = document.getElementById(
  "btn-export-xml",
) as HTMLButtonElement;
const btnCompareXml = document.getElementById(
  "btn-compare-xml",
) as HTMLButtonElement;
const xmlUploadInput = document.getElementById(
  "xml-upload-input",
) as HTMLInputElement;
const comparePanel = document.getElementById("compare-panel") as HTMLDivElement;
const comparePanelOverlay = document.getElementById(
  "compare-panel-overlay",
) as HTMLDivElement;
const comparePanelClose = document.getElementById(
  "compare-panel-close",
) as HTMLButtonElement;
const comparePanelBody = document.getElementById(
  "compare-panel-body",
) as HTMLDivElement;

function getCurrentDoc(): Y.Doc | null {
  return collabState.doc || (window as any).__doc__ || null;
}

function exportYdocXml() {
  const doc = getCurrentDoc();
  if (!doc) {
    alert("Y.Doc 尚未初始化，请等待 draw.io 加载完成");
    return;
  }
  const xml = ydoc2xml(doc, 2);
  const blob = new Blob([xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ydoc-${Date.now()}.xml`;
  a.click();
  URL.revokeObjectURL(url);
}

function xmlStats(xml: string) {
  return {
    mxCell: (xml.match(/<mxCell/g) || []).length,
    mxGeometry: (xml.match(/<mxGeometry/g) || []).length,
    mxPoint: (xml.match(/<mxPoint/g) || []).length,
    length: xml.length,
  };
}

function showComparePanel(html: string) {
  comparePanelBody.innerHTML = html;
  comparePanelOverlay.style.display = "block";
  comparePanel.style.display = "flex";
}

function hideComparePanel() {
  comparePanelOverlay.style.display = "none";
  comparePanel.style.display = "none";
}

function compareUploadedXml(uploadedXml: string) {
  const doc = getCurrentDoc();
  if (!doc) {
    alert("Y.Doc 尚未初始化，请等待 draw.io 加载完成");
    return;
  }

  // 将上传的 XML 解析为新 doc 再序列化，确保是规范化后的格式
  const tempDoc = new Y.Doc();
  try {
    xml2ydoc(uploadedXml, tempDoc);
  } catch (e) {
    alert("上传的 XML 解析失败: " + (e as Error).message);
    return;
  }
  const normalized = ydoc2xml(tempDoc, 0);
  const current = ydoc2xml(doc, 0);

  const uploadedStats = xmlStats(uploadedXml);
  const normalizedStats = xmlStats(normalized);
  const currentStats = xmlStats(current);

  const mismatchClass = (a: number, b: number) =>
    a !== b ? 'class="diff-mismatch"' : "";

  const rows = [
    {
      label: "mxCell",
      uploaded: uploadedStats.mxCell,
      normalized: normalizedStats.mxCell,
      current: currentStats.mxCell,
    },
    {
      label: "mxGeometry",
      uploaded: uploadedStats.mxGeometry,
      normalized: normalizedStats.mxGeometry,
      current: currentStats.mxGeometry,
    },
    {
      label: "mxPoint",
      uploaded: uploadedStats.mxPoint,
      normalized: normalizedStats.mxPoint,
      current: currentStats.mxPoint,
    },
    {
      label: "文本长度",
      uploaded: uploadedStats.length,
      normalized: normalizedStats.length,
      current: currentStats.length,
    },
  ];

  const tableRows = rows
    .map((r) => {
      const uploadMismatch = mismatchClass(r.uploaded, r.normalized);
      const currentMismatch = mismatchClass(r.normalized, r.current);
      return `<tr>
        <td>${r.label}</td>
        <td ${uploadMismatch}>${r.uploaded}</td>
        <td ${uploadMismatch}>${r.normalized}</td>
        <td ${currentMismatch}>${r.current}</td>
      </tr>`;
    })
    .join("");

  const html = `
    <p><strong>说明：</strong></p>
    <ul>
      <li><strong>原始上传</strong>：你上传的 XML 文件原始内容统计</li>
      <li><strong>规范后</strong>：上传 XML 经 xml2ydoc → ydoc2xml 序列化后的统计（即经过库处理后的结果）</li>
      <li><strong>当前 Y.Doc</strong>：当前页面 Y.Doc 序列化后的统计</li>
    </ul>
    <table>
      <tr><th>指标</th><th>原始上传</th><th>规范后</th><th>当前 Y.Doc</th></tr>
      ${tableRows}
    </table>
    <p>红色 = 数量不一致</p>
  `;

  showComparePanel(html);

  // 同时输出到控制台
  console.log("=== XML 对比 ===");
  console.table({
    原始上传: uploadedStats,
    规范后: normalizedStats,
    当前YDoc: currentStats,
  });
}

btnExportXml.addEventListener("click", exportYdocXml);

btnCompareXml.addEventListener("click", () => {
  xmlUploadInput.click();
});

xmlUploadInput.addEventListener("change", (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = String(ev.target?.result || "");
    compareUploadedXml(text);
    xmlUploadInput.value = ""; // 允许再次选择同一文件
  };
  reader.readAsText(file);
});

comparePanelClose.addEventListener("click", hideComparePanel);
comparePanelOverlay.addEventListener("click", hideComparePanel);

window.addEventListener("DOMContentLoaded", init);
