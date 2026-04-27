import { DRAWIO_VERSIONS, DEMO_FILE } from "./config.js";

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
 * 获取 math 路径（29+ 用 math4，旧版本用 math）
 */
function getMathPath(version: string): string {
  if (version === "latest") {
    return "math4/es5";
  }
  const major = parseInt(version.split(".")[0], 10);
  return major >= 29 ? "math4/es5" : "math/es5";
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
    (window as any).mxLoadStylesheets = false;
    (window as any).DRAWIO_BASE_URL = cdnBase;
    (window as any).DRAW_MATH_URL = getMathPath(version);
    (window as any).drawDevUrl = cdnBase;
    (window as any).mxDevUrl = cdnBase;
    (window as any).STENCIL_PATH =
      `https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/stencils`;
    (window as any).SHAPES_PATH =
      `https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/shapes`;
    (window as any).mxBasePath = `${cdnBase}mxgraph`;
    (window as any).PLUGINS_BASE_PATH = cdnBase;
    (window as any).DRAW_MATH_URL = `${cdnBase}${getMathPath(version)}`;

    // 开发模式
    (window as any).urlParams = (window as any).urlParams || {};
    (window as any).urlParams["dev"] = "1";

    // 设置 demo 文件 hash（让 draw.io 自动加载）
    window.location.hash = "#R" + encodeURIComponent(DEMO_FILE);

    // 加载 grapheditor.css
    const cssLink = document.createElement("link");
    cssLink.rel = "stylesheet";
    cssLink.type = "text/css";
    cssLink.href = `${cdnBase}styles/grapheditor.css`;
    document.head.appendChild(cssLink);

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
