import { DRAWIO_VERSIONS } from "./config.js";
import {
  setupGlobals,
  setupUrlParams,
  applyPrototypeOverrides,
} from "./drawio-overrides.js";

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
 *
 * 与 apps/demo 版本的区别：不设置 #R hash，初始数据由 y-websocket 服务器提供
 */
export function loadDrawioScript(
  version: string,
  callbacks: {
    onLoading: () => void;
    onProgress: (step: "preconfig" | "app" | "init") => void;
    onReady: (version: string) => void;
    onError: (message: string) => void;
  },
  customUrl?: string,
  lang?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = getDrawioUrl(version, customUrl);
    if (!url) {
      callbacks.onError("Invalid draw.io URL");
      reject(new Error("Invalid URL"));
      return;
    }

    callbacks.onLoading();

    const cdnBase = getCdnBaseUrl(version);

    // 1. 全局变量 & URL 参数（详见 drawio-overrides.ts）
    setupGlobals(cdnBase);
    setupUrlParams(lang);

    // 屏蔽 draw.io 内置的 window.onerror 弹窗（跨域脚本错误会触发 "Script error."）
    window.onerror = () => true;

    // mxLoadStylesheets=false 时 mxClient 不会自动加载 common.css，需手动引入
    const commonCss = document.createElement("link");
    commonCss.rel = "stylesheet";
    commonCss.type = "text/css";
    commonCss.href = `${cdnBase}mxgraph/css/common.css`;
    document.head.appendChild(commonCss);

    // 加载 grapheditor.css
    const cssLink = document.createElement("link");
    cssLink.rel = "stylesheet";
    cssLink.type = "text/css";
    cssLink.href = `${cdnBase}styles/grapheditor.css`;
    document.head.appendChild(cssLink);

    // 注入全局 mxscript 拦截器，将 app.min.js 内部的相对路径重定向到 CDN
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

    callbacks.onProgress("preconfig");

    preConfig.onload = () => {
      callbacks.onProgress("app");
      const script = document.createElement("script");
      script.src = url;

      script.onload = () => {
        // 2. 原型覆写（详见 drawio-overrides.ts）
        applyPrototypeOverrides();

        callbacks.onProgress("init");
        setTimeout(() => {
          callbacks.onReady(version);
          resolve();
        }, 1500);
      };

      script.onerror = () => {
        callbacks.onError("Failed to load app.min.js");
        reject(new Error("Failed to load app.min.js"));
      };

      document.head.appendChild(script);
    };

    preConfig.onerror = () => {
      callbacks.onProgress("app");
      const script = document.createElement("script");
      script.src = url;

      script.onload = () => {
        applyPrototypeOverrides();

        callbacks.onProgress("init");
        setTimeout(() => {
          callbacks.onReady(version);
          resolve();
        }, 1500);
      };

      script.onerror = () => {
        callbacks.onError("Failed to load script");
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
