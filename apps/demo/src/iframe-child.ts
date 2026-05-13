import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
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

  // 创建本地 ydoc 和 awareness（不连接 provider）
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);

  // 标记是否正在应用父页发来的 update，避免回发导致循环
  let applyingParentUpdate = false;

  // 绑定 draw.io
  const unbind = bindDrawioFile(ydoc, awareness, null as any, () => {
    console.log(`[iframe ${iframeId}] draw.io bound`);
    // 向父页请求初始同步
    window.parent.postMessage({ type: "init", iframeId }, "*");
  });

  // 监听本地 ydoc update -> 发给父页
  ydoc.on("update", (update: Uint8Array) => {
    if (applyingParentUpdate) return;
    window.parent.postMessage(
      { type: "ydoc-update", iframeId, payload: Array.from(update) },
      "*",
    );
  });

  // 监听本地 awareness update -> 发给父页
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
      if (applyingParentUpdate) return;
      const changes = [...added, ...updated, ...removed];
      if (changes.length === 0) return;
      const update = encodeAwarenessUpdate(awareness, changes);
      window.parent.postMessage(
        { type: "awareness-update", iframeId, payload: Array.from(update) },
        "*",
      );
    },
  );

  // 监听父页消息
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const { type, payload } = event.data;

    if (type === "ydoc-sync" || type === "ydoc-update") {
      applyingParentUpdate = true;
      Y.applyUpdate(ydoc, new Uint8Array(payload));
      applyingParentUpdate = false;
    } else if (type === "awareness-sync" || type === "awareness-update") {
      applyingParentUpdate = true;
      applyAwarenessUpdate(awareness, new Uint8Array(payload), null);
      applyingParentUpdate = false;
    }
  });

  // 暴露调试对象
  (window as any).__iframeYdoc__ = ydoc;
  (window as any).__iframeAwareness__ = awareness;
}

window.addEventListener("DOMContentLoaded", init);
