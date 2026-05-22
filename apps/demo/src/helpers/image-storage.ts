import localforage from "localforage";
import type { FilePatch } from "y-mxgraph";

const STORE_NAME = "drawio-images";
const IMAGE_REF_PREFIX = "img:";

const imageStore = localforage.createInstance({
  name: "y-mxgraph-demo",
  storeName: STORE_NAME,
});

const blobUrlCache = new Map<string, string>();

type UploadImageFn = (base64: string) => Promise<string>;

let uploadImageFn: UploadImageFn = defaultUploadImage;
let graphRef: any = null;

async function defaultUploadImage(base64: string): Promise<string> {
  const uuid = crypto.randomUUID?.() ?? generateUUID();
  const blob = base64ToBlob(base64);
  await imageStore.setItem(uuid, blob);
  return `${IMAGE_REF_PREFIX}${uuid}`;
}

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function base64ToBlob(base64: string): Blob {
  const commaIndex = base64.indexOf(",");
  const header = base64.substring(0, commaIndex);
  const data = base64.substring(commaIndex + 1);
  const mimeMatch = header.match(/:(.*?);/);
  const mime = mimeMatch?.[1] ?? "image/png";
  const binary = atob(data);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  return new Blob([array], { type: mime });
}

export function configureImageStorage(options: {
  uploadImage?: UploadImageFn;
  graph?: any;
}) {
  if (options.uploadImage) uploadImageFn = options.uploadImage;
  if (options.graph) graphRef = options.graph;
}

export function isImageRef(src: string): boolean {
  return src.startsWith(IMAGE_REF_PREFIX);
}

export function isBase64Image(src: string): boolean {
  return src.startsWith("data:image/");
}

export function getCachedBlobUrl(uuidRef: string): string | undefined {
  return blobUrlCache.get(uuidRef);
}

export async function preloadImage(uuidRef: string): Promise<void> {
  if (blobUrlCache.has(uuidRef)) return;

  const uuid = uuidRef.replace(IMAGE_REF_PREFIX, "");
  const blob = await imageStore.getItem<Blob>(uuid);
  if (!blob) return;

  const url = URL.createObjectURL(blob);
  blobUrlCache.set(uuidRef, url);
}

export async function preloadAllImages(imageRefs: string[]): Promise<void> {
  const refs = imageRefs.filter((ref) => !blobUrlCache.has(ref));
  await Promise.all(refs.map(preloadImage));
}

export function transformImagePatch(
  patch: FilePatch,
): FilePatch | null | undefined {
  const update = patch.u;
  if (!update) return undefined;

  let hasBase64 = false;
  const newUpdate: Record<string, any> = {};
  const pendingUploads: Array<{ cellId: string; base64: string }> = [];

  for (const diagramId of Object.keys(update)) {
    const diagramUpdate: any = update[diagramId];
    if (!diagramUpdate.cells) {
      newUpdate[diagramId] = diagramUpdate;
      continue;
    }

    const cells: any = diagramUpdate.cells;
    const newCells: Record<string, any> = {};

    if (cells.i) {
      const cleanInserts: any[] = [];
      for (const cell of cells.i) {
        const base64 = extractBase64FromStyle(cell.style);
        if (base64) {
          hasBase64 = true;
          pendingUploads.push({ cellId: cell.id, base64 });
        } else {
          cleanInserts.push(cell);
        }
      }
      if (cleanInserts.length > 0) {
        newCells.i = cleanInserts;
      }
    }

    if (cells.r) {
      newCells.r = cells.r;
    }

    if (cells.u) {
      const newUpdates: Record<string, any> = {};
      for (const cellId of Object.keys(cells.u)) {
        const attrs = cells.u[cellId];
        const base64 = extractBase64FromStyle(attrs.style);
        if (base64) {
          hasBase64 = true;
          pendingUploads.push({ cellId, base64 });
        } else {
          newUpdates[cellId] = attrs;
        }
      }
      if (Object.keys(newUpdates).length > 0) {
        newCells.u = newUpdates;
      }
    }

    if (newCells.i || newCells.r || newCells.u) {
      newUpdate[diagramId] = {
        ...diagramUpdate,
        cells: newCells,
      };
    }
  }

  if (!hasBase64) return undefined;

  for (const { cellId, base64 } of pendingUploads) {
    uploadAndApplyImage(cellId, base64);
  }

  if (Object.keys(newUpdate).length === 0) return null;

  const newPatch: FilePatch = {};
  if (patch.i) newPatch.i = patch.i;
  if (patch.r) newPatch.r = patch.r;
  newPatch.u = newUpdate;

  return newPatch;
}

async function uploadAndApplyImage(
  cellId: string,
  base64: string,
): Promise<void> {
  try {
    const imageRef = await uploadImageFn(base64);

    // 预加载到缓存，这样 rewriteImageSource 可以同步获取
    await preloadImage(imageRef);

    if (graphRef) {
      const cell = graphRef.model.getCell(cellId);
      if (cell) {
        const model = graphRef.getModel();
        const currentStyle = model.getStyle(cell) || "";
        const newStyle = currentStyle.replace(
          /image=data:image\/[^;,]+(?:;base64)?,[A-Za-z0-9+/=]+/,
          `image=${imageRef}`,
        );
        model.beginUpdate();
        try {
          model.setStyle(cell, newStyle);
        } finally {
          model.endUpdate();
        }
      }
    }
  } catch (err) {
    console.warn("[image-storage] Failed to upload image:", err);
  }
}

function extractBase64FromStyle(style: string | undefined): string | null {
  if (!style) return null;
  // draw.io 格式: image=data:image/png,iVBOR... (省略 ;base64,)
  // 标准格式: image=data:image/png;base64,iVBOR...
  const match = style.match(/image=(data:image\/[^;,]+(?:;base64)?,[A-Za-z0-9+/=]+)/);
  return match ? match[1] : null;
}

export function injectImageStorageHooks(): void {
  const w = window as any;

  const applyRewriteHook = (proto: any, name: string) => {
    if (!proto?.rewriteImageSource) return;
    const origRewrite = proto.rewriteImageSource;
    proto.rewriteImageSource = function (src: string) {
      if (isImageRef(src)) {
        const cached = getCachedBlobUrl(src);
        return cached ?? "";
      }
      return origRewrite.call(this, src);
    };
    console.log(`[image-storage] Hooked ${name}.rewriteImageSource`);
  };

  applyRewriteHook(w.mxJsCanvas?.prototype, "mxJsCanvas");
  applyRewriteHook(w.mxAsyncCanvas?.prototype, "mxAsyncCanvas");

  // mxSvgCanvas2D 没有 rewriteImageSource，需要直接 hook image 方法
  if (w.mxSvgCanvas2D?.prototype?.image) {
    const origImage = w.mxSvgCanvas2D.prototype.image;
    w.mxSvgCanvas2D.prototype.image = function (
      x: number,
      y: number,
      w2: number,
      h: number,
      src: string,
      aspect: boolean,
      flipH: boolean,
      flipV: boolean,
      gradient: string,
      border: boolean,
      roundable: boolean,
      clip: boolean,
    ) {
      if (isImageRef(src)) {
        const cached = getCachedBlobUrl(src);
        if (cached) {
          src = cached;
        } else {
          // 异步加载，加载完后触发重绘
          preloadImage(src).then(() => {
            if (graphRef) {
              graphRef.refresh();
            }
          });
          return;
        }
      }
      return origImage.call(
        this, x, y, w2, h, src, aspect, flipH, flipV,
        gradient, border, roundable, clip,
      );
    };
    console.log("[image-storage] Hooked mxSvgCanvas2D.image");
  }
}

export function scanImageRefs(model: any): string[] {
  const refs: string[] = [];
  const visited = new Set<string>();

  function scanCell(cell: any) {
    if (!cell || visited.has(cell.id)) return;
    visited.add(cell.id);

    const style = cell.style || "";
    const match = style.match(/image=(img:[a-f0-9-]+)/);
    if (match) {
      refs.push(match[1]);
    }

    if (cell.children) {
      for (const child of cell.children) {
        scanCell(child);
      }
    }
  }

  const root = model.getRoot?.() || model.root;
  if (root) {
    scanCell(root);
  }

  return [...new Set(refs)];
}

export function releaseAllBlobUrls(): void {
  for (const url of blobUrlCache.values()) {
    URL.revokeObjectURL(url);
  }
  blobUrlCache.clear();
}
