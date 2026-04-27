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

    // 设置全局 CDN 配置（生产模式，不使用 dev=1 避免走本地相对路径）
    const cdnBase = getCdnBaseUrl(version);
    (window as any).mxBasePath = `${cdnBase}mxgraph`;
    (window as any).mxImageBasePath = `${cdnBase}mxgraph/images`;
    (window as any).RESOURCES_PATH = `${cdnBase}resources`;
    (window as any).RESOURCE_BASE = `${cdnBase}resources/dia`;
    (window as any).STENCIL_PATH = `${cdnBase}stencils`;
    (window as any).SHAPES_PATH = `${cdnBase}shapes`;
    (window as any).PLUGINS_BASE_PATH = cdnBase;
    (window as any).DRAW_MATH_URL =
      "https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/math/MathJax.js";
    (window as any).mxLoadStylesheets = false;

    // URL 参数（生产模式，不设置 dev=1）
    (window as any).urlParams = (window as any).urlParams || {};
    (window as any).urlParams["math"] = "0";
    (window as any).urlParams["stealth"] = "1";
    (window as any).urlParams["chrome"] = "0";

    // 屏蔽 draw.io 内置的 window.onerror 弹窗（跨域脚本错误会触发 "Script error."）
    window.onerror = () => true;

    // 设置 demo 文件 hash（让 draw.io 自动加载）
    window.location.hash = "#R" + encodeURIComponent(DEMO_FILE);

    // 加载 grapheditor.css
    const cssLink = document.createElement("link");
    cssLink.rel = "stylesheet";
    cssLink.type = "text/css";
    cssLink.href = `${cdnBase}styles/grapheditor.css`;
    document.head.appendChild(cssLink);

    // 注入全局 mxscript 拦截器，将 app.min.js 内部的相对路径重定向到 CDN
    // app.min.js 调用 mxscript('js/PostConfig.js') 等时会走此函数
    (window as any).mxscript = function (
      src: string,
      onLoad?: () => void,
      id?: string,
      _dataAppKey?: string,
      _noWrite?: boolean,
      onError?: (msg: string, e: any) => void,
    ) {
      const fullSrc = src.startsWith("http") ? src : `${cdnBase}${src}`;
      const s = document.createElement("script");
      s.setAttribute("type", "text/javascript");
      s.setAttribute("src", fullSrc);
      if (id != null) s.setAttribute("id", id);
      if (onLoad != null) {
        let done = false;
        s.onload = (s as any).onreadystatechange = function () {
          if (
            !done &&
            (!(s as any).readyState || (s as any).readyState === "complete")
          ) {
            done = true;
            onLoad();
          }
        };
      }
      if (onError != null) {
        s.onerror = (e: any) => onError("Failed to load " + src, e);
      }
      const first = document.getElementsByTagName("script")[0];
      if (first?.parentNode) {
        first.parentNode.insertBefore(s, first);
      } else {
        document.head.appendChild(s);
      }
    };

    // 先加载 PreConfig.js，再加载 app.min.js（与 bootstrap.js 生产模式一致）
    const preConfigUrl = `${cdnBase}js/PreConfig.js`;
    const preConfig = document.createElement("script");
    preConfig.src = preConfigUrl;

    preConfig.onload = () => {
      const script = document.createElement("script");
      script.src = url;

      script.onload = () => {
        setTimeout(() => {
          callbacks.onReady(version);
          resolve();
        }, 1500);
      };

      script.onerror = () => {
        callbacks.onError("加载失败");
        reject(new Error("Failed to load app.min.js"));
      };

      document.head.appendChild(script);
    };

    preConfig.onerror = () => {
      callbacks.onError("PreConfig 加载失败，尝试直接加载 app.min.js");
      const script = document.createElement("script");
      script.src = url;

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
    };

    document.head.appendChild(preConfig);
  });
}

/**
 * 检查 draw.io 是否已加载
 */
export function isDrawioLoaded(): boolean {
  return !!(window as any).App;
}
