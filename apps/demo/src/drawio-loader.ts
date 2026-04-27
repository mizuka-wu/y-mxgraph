import { DRAWIO_VERSIONS } from "./config.js";

export interface LoaderCallbacks {
  onLoading: () => void;
  onReady: (version: string) => void;
  onError: (message: string) => void;
}

let loadedScript: HTMLScriptElement | null = null;

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
 * 加载 draw.io 脚本
 */
export function loadDrawioScript(
  version: string,
  callbacks: LoaderCallbacks,
  customUrl?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // 移除之前加载的脚本
    if (loadedScript) {
      loadedScript.remove();
      loadedScript = null;
    }

    const url = getDrawioUrl(version, customUrl);
    if (!url) {
      callbacks.onError("无效的 draw.io URL");
      reject(new Error("Invalid URL"));
      return;
    }

    callbacks.onLoading();

    const script = document.createElement("script");
    script.src = url;
    script.async = true;

    script.onload = () => {
      loadedScript = script;
      // 等待脚本初始化
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

/**
 * 获取 App 实例
 */
export function getApp(): any {
  return (window as any).App;
}

/**
 * 卸载 draw.io 脚本
 */
export function unloadDrawio(): void {
  if (loadedScript) {
    loadedScript.remove();
    loadedScript = null;
  }
  // 清理 window 上的 App 对象
  delete (window as any).App;
}
