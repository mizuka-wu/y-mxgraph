import { DRAWIO_VERSIONS } from "./config.js";

export interface LoaderCallbacks {
  onLoading: () => void;
  onReady: (version: string) => void;
  onError: (message: string) => void;
}

/**
 * 获取 draw.io 脚本 URL
 */
export function getDrawioUrl(version: string, customUrl?: string): string {
  if (version === "custom" && customUrl) {
    return customUrl.trim();
  }
  return DRAWIO_VERSIONS[version] || DRAWIO_VERSIONS["latest"];
}

/**
 * 获取 CDN 基础路径
 */
function getCdnBaseUrl(version: string): string {
  if (version === "latest") {
    return "https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/";
  }
  return `https://cdn.jsdelivr.net/gh/jgraph/drawio@${version}/src/main/webapp/`;
}

/**
 * 加载 draw.io 脚本
 * 页面刷新切换版本，无需处理旧脚本清理
 */
export function loadDrawioScript(
  version: string,
  callbacks: LoaderCallbacks,
  customUrl?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = getDrawioUrl(version, customUrl);
    if (!url) {
      callbacks.onError("无效的 draw.io URL");
      reject(new Error("Invalid URL"));
      return;
    }

    callbacks.onLoading();

    // 设置全局 CDN 配置（正式加载前）
    const cdnBase = getCdnBaseUrl(version);
    (window as any).drawDevUrl = cdnBase;
    (window as any).mxDevUrl = cdnBase;
    (window as any).PLUGINS_BASE_PATH = cdnBase;

    // 开发模式
    (window as any).urlParams = (window as any).urlParams || {};
    (window as any).urlParams["dev"] = "1";

    const script = document.createElement("script");
    script.src = url;
    script.async = true;

    script.onload = () => {
      // 等待脚本初始化完成
      setTimeout(() => {
        callbacks.onReady(version);
        resolve();
      }, 1500);
    };

    script.onerror = () => {
      callbacks.onError("加载失败，请检查版本或 URL");
      reject(new Error("Failed to load script"));
    };

    document.head.appendChild(script);
  });
}

/**
 * 检查 draw.io 是否已加载
 */
export function isDrawioLoaded(): boolean {
  return !!(window as any).App;
}
