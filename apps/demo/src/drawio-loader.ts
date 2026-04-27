import { DRAWIO_VERSIONS } from "./config.js";

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
 */
export function loadDrawioScript(
  version: string,
  callbacks: {
    onLoading: () => void;
    onReady: (version: string) => void;
    onError: (message: string) => void;
  },
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

    // 设置默认配置
    (window as any).mxIsElectron = false;

    // 设置全局 CDN 配置
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
      setTimeout(() => {
        callbacks.onReady(version);
        resolve();
      }, 1500);
    };

    script.onerror = () => {
      callbacks.onError("加载失败");
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
