/**
 * iframe 模式子页（v1.3 bridge）。
 *
 * - YMxGraphBridgeClient 持有本地 Y.Doc 与 AwarenessStub，
 *   通过 postMessage 和父页双向同步。
 * - drawio 加载完成 + 首个 SYNC_UPDATE 到达后再绑定，避免 drawio 用空
 *   数据初始化再被远端数据覆盖。
 */
import type { Awareness } from "y-protocols/awareness";
import { YMxGraphBridgeClient } from "y-mxgraph/iframe-bridge/client";
import { loadDrawioScript } from "./drawio-loader.js";
import { bindDrawioFile } from "./collaboration.js";

const urlParams = new URLSearchParams(location.search);
const version = urlParams.get("version") || "latest";
const customUrl = urlParams.get("customUrl") || undefined;
const lang = urlParams.get("lang") || "en";
const iframeId = urlParams.get("iframeId") || "0";

async function init() {
  const overlay = document.getElementById("loading-overlay")!;
  const container = document.getElementById("drawio-container")!;

  // 1) 加载 draw.io
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

  // 2) 建立 bridge 客户端
  const bridge = new YMxGraphBridgeClient({
    onDisconnect: () => {
      console.warn(`[iframe ${iframeId}] parent unreachable`);
    },
  });

  // 3) 第一轮 SYNC_UPDATE 到达后再绑定 drawio，这样 doc2xml 能直接
  //    拿到远端当前的完整内容。
  const runBind = () => {
    bindDrawioFile(
      bridge.doc,
      bridge.awareness as unknown as Awareness,
      null,
      () => {
        console.log(`[iframe ${iframeId}] draw.io bound`);
        // 通知父页子页已 ready（父页用该字段判断 drawio 加载完成）
        bridge.awareness.setLocalStateField("drawioReady", true);
        bridge.awareness.setLocalStateField("iframeId", iframeId);
      },
    );
  };
  if (bridge.isSynced()) runBind();
  else bridge.once("synced", runBind);

  // 调试
  Reflect.set(window, "__iframeYdoc__", bridge.doc);
  Reflect.set(window, "__iframeAwareness__", bridge.awareness);
  Reflect.set(window, "__bridge__", bridge);

  window.addEventListener("beforeunload", () => bridge.destroy());
}

window.addEventListener("DOMContentLoaded", init);
