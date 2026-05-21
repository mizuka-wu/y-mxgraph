import {
  isSourceId,
  isBase64DataUri,
  extractUuid,
  toSourceId,
  storeImage,
  getImageObjectUrl,
  getImageDataUri,
  batchGetObjectUrls,
} from "./image-storage";

/**
 * 渲染缓存：sourceId → Object URL（用于 <img>.src）
 * 导出缓存：sourceId → data URI（用于 SVG/PNG 导出）
 */
const sourceIdToObjectUrl = new Map<string, string>();
const sourceIdToDataUri = new Map<string, string>();

/** base64 → sourceId 的反向映射，用于去重 */
const dataToSourceId = new Map<string, string>();

let hooked = false;

/**
 * 设置 draw.io 图片处理钩子，在 draw.io 加载完成后调用。
 *
 * draw.io 图片处理流程（基于源码分析）：
 * 1. mxImageShape.getImageDataUri() — 返回 this.image（base64 data URI）
 * 2. mxJsCanvas/mxAsyncCanvas.rewriteImageSource(src) — 渲染前转换 src
 * 3. canvas.image() — 用 rewriteImageSource 返回的 src 创建 new Image()
 * 4. Editor.convertImages() — 导出时将图片转为 data URI
 */
export function setupImageHooks(): void {
  if (hooked) return;
  hooked = true;

  hookGetImageDataUri();
  hookRewriteImageSource();
  hookConvertImages();
}

/**
 * 异步加载 sourceId 的 Object URL 到缓存。
 * 返回当前缓存值，未命中时返回 undefined（下次重绘可用）。
 */
function ensureCachedObjectUrl(sourceId: string): string | undefined {
  if (sourceIdToObjectUrl.has(sourceId)) {
    return sourceIdToObjectUrl.get(sourceId);
  }
  // Cache miss — async fetch from IndexedDB
  const uuid = extractUuid(sourceId);
  getImageObjectUrl(uuid).then((url) => {
    if (url) sourceIdToObjectUrl.set(sourceId, url);
  });
  return undefined;
}

/**
 * 将 base64 data URI 转为 source-id，存入 IndexedDB（Blob），缓存 Object URL。
 * 相同内容去重复用同一 UUID。
 */
async function resolveBase64ToSourceId(base64: string): Promise<string> {
  const existing = dataToSourceId.get(base64);
  if (existing) return existing;

  const uuid = await storeImage(base64);
  const sourceId = toSourceId(uuid);
  const objectUrl = await getImageObjectUrl(uuid);
  if (objectUrl) sourceIdToObjectUrl.set(sourceId, objectUrl);
  dataToSourceId.set(base64, sourceId);
  return sourceId;
}

/**
 * Hook 1: mxImageShape.prototype.getImageDataUri
 *
 * draw.io 内部实现：直接返回 this.image（base64 data URI）
 * 我们拦截：base64 → 存入 IndexedDB，this.image 替换为 source-id
 */
function hookGetImageDataUri(): void {
  const mxImageShape = (window as any).mxImageShape;
  if (!mxImageShape?.prototype?.getImageDataUri) {
    console.warn("[image-hook] mxImageShape.prototype.getImageDataUri not found");
    return;
  }

  const orig = mxImageShape.prototype.getImageDataUri;
  mxImageShape.prototype.getImageDataUri = function () {
    const src = this.image;
    if (!src || isSourceId(src) || !isBase64DataUri(src)) return orig.call(this);

    // fire-and-forget: store Blob in IndexedDB, replace this.image with source-id
    resolveBase64ToSourceId(src).then((sourceId) => {
      this.image = sourceId;
    });

    return orig.call(this);
  };
}

/**
 * Hook 2: rewriteImageSource on canvas prototypes
 *
 * draw.io 内部实现（mxJsCanvas/mxAsyncCanvas）：
 *   - http/https → '/proxy?url=...'（跨域代理）
 *   - 其他 → 原样返回
 * canvas.image() 用返回值作为 new Image().src
 *
 * 我们拦截：source-id → 返回 Object URL（从 Blob 创建）
 * mxAsyncCanvas 的 waitCounter 机制会自动处理异步加载
 */
function hookRewriteImageSource(): void {
  const targets = [
    (window as any).mxJsCanvas,
    (window as any).mxAsyncCanvas,
  ];

  for (const target of targets) {
    if (!target?.prototype?.rewriteImageSource) continue;

    const orig = target.prototype.rewriteImageSource;
    target.prototype.rewriteImageSource = function (src: string) {
      if (src && isSourceId(src)) {
        return ensureCachedObjectUrl(src) ?? src;
      }
      return orig.call(this, src);
    };
  }
}

/**
 * Hook 3: Editor.prototype.convertImages
 *
 * draw.io 内部实现：遍历 SVG 中的 <image>，将 src 转为 data URI 写入 imageCache。
 * 导出需要 data URI（不是 Object URL），所以预填充 sourceIdToDataUri。
 */
function hookConvertImages(): void {
  const Editor = (window as any).Editor;
  if (!Editor?.prototype?.convertImages) {
    console.warn("[image-hook] Editor.prototype.convertImages not found");
    return;
  }

  const orig = Editor.prototype.convertImages;
  Editor.prototype.convertImages = function (
    svgRoot: any,
    callback: () => void,
    imageCache: Map<string, string>,
    converter: any,
  ) {
    if (imageCache) {
      for (const [sourceId, dataUri] of sourceIdToDataUri) {
        imageCache.set(sourceId, dataUri);
      }
    }
    return orig.call(this, svgRoot, callback, imageCache, converter);
  };
}

/**
 * 预加载 XML 中所有 source-id 引用到内存缓存。
 * 在 Binding 创建后调用，确保首屏渲染不闪烁。
 */
export async function preloadCache(xml: string): Promise<void> {
  const regex = /source-id:([a-f0-9-]{36})/g;
  let match: RegExpExecArray | null;
  const uuids: string[] = [];

  while ((match = regex.exec(xml)) !== null) {
    uuids.push(match[1]);
  }

  if (uuids.length === 0) return;

  const urlMap = await batchGetObjectUrls(uuids);
  for (const [sourceId, objectUrl] of urlMap) {
    sourceIdToObjectUrl.set(sourceId, objectUrl);
  }
}

export function getCacheStats() {
  return {
    objectUrls: sourceIdToObjectUrl.size,
    dataUris: sourceIdToDataUri.size,
    deduplicated: dataToSourceId.size,
  };
}

export function clearCache(): void {
  for (const url of sourceIdToObjectUrl.values()) {
    URL.revokeObjectURL(url);
  }
  sourceIdToObjectUrl.clear();
  sourceIdToDataUri.clear();
  dataToSourceId.clear();
}
