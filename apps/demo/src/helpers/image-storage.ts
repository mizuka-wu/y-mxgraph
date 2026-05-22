import localforage from "localforage";
import type { FilePatch } from "y-mxgraph";

const STORE_NAME = "drawio-images";
const IMAGE_REF_PREFIX = "img:";

const imageStore = localforage.createInstance({
  name: "y-mxgraph-demo",
  storeName: STORE_NAME,
});

const blobUrlCache = new Map<string, string>();
const preloadPromises = new Map<string, Promise<void>>();
const notFoundUuids = new Set<string>();
const failedUploads = new Set<string>();
const MAX_FAILED_UPLOADS = 100;

// 同一 base64 的 upload 去重
const uploadPromises = new Map<string, Promise<string>>();

type UploadImageFn = (base64: string) => Promise<string>;

let uploadImageFn: UploadImageFn = defaultUploadImage;
let graphRef: any = null;

async function defaultUploadImage(base64: string): Promise<string> {
  const uuid = crypto.randomUUID?.() ?? generateUUID();
  await storeBlob(base64, uuid);
  return `${IMAGE_REF_PREFIX}${uuid}`;
}

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function base64ToBlob(base64: string): Blob {
  try {
    const commaIndex = base64.indexOf(",");
    if (commaIndex === -1) {
      throw new Error("Invalid base64 format: no comma separator");
    }
    const header = base64.substring(0, commaIndex);
    const data = base64.substring(commaIndex + 1).replace(/\s/g, "");
    const mimeMatch = header.match(/:(.*?);/);
    const mime = mimeMatch?.[1] ?? "image/png";
    const binary = atob(data);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      array[i] = binary.charCodeAt(i);
    }
    return new Blob([array], { type: mime });
  } catch (err) {
    throw new Error(`[image-storage] Failed to convert base64 to blob: ${err}`);
  }
}

async function storeBlob(base64: string, uuid: string): Promise<void> {
  const blob = base64ToBlob(base64);
  await imageStore.setItem(uuid, blob);
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
  if (notFoundUuids.has(uuidRef)) return;

  const existing = preloadPromises.get(uuidRef);
  if (existing) return existing;

  const promise = (async () => {
    const uuid = uuidRef.replace(IMAGE_REF_PREFIX, "");
    const blob = await imageStore.getItem<Blob>(uuid);
    if (!blob) {
      notFoundUuids.add(uuidRef);
      return;
    }
    if (blobUrlCache.has(uuidRef)) return;
    const url = URL.createObjectURL(blob);
    blobUrlCache.set(uuidRef, url);
  })();

  preloadPromises.set(uuidRef, promise);
  try {
    await promise;
  } finally {
    preloadPromises.delete(uuidRef);
  }
}

export async function preloadAllImages(imageRefs: string[]): Promise<void> {
  const refs = imageRefs.filter((ref) => !blobUrlCache.has(ref));
  await Promise.all(refs.map(preloadImage));
}

export function transformImagePatch(
  patch: FilePatch,
): FilePatch | null | undefined {
  const update = patch.u;
  const hasUpdate = !!update;

  let hasBase64 = false;
  const newUpdate: Record<string, any> = {};
  const pendingUploads: Array<{ cellId: string; base64: string }> = [];

  if (update) {
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

      const hasNonCellChanges =
        diagramUpdate.name !== undefined ||
        diagramUpdate.previous !== undefined;
      if (newCells.i || newCells.r || newCells.u || hasNonCellChanges) {
        newUpdate[diagramId] = {
          ...diagramUpdate,
          cells: newCells,
        };
      } else if (hasNonCellChanges) {
        const { cells: _, ...rest } = diagramUpdate;
        newUpdate[diagramId] = rest;
      }
    }
  }

  // 处理 patch.i（新增 diagram）中的 base64
  let newPatchInserts: typeof patch.i = undefined;
  if (patch.i) {
    const cleanInserts: any[] = [];
    for (const insert of patch.i) {
      const { data: newData, uploads: diagramUploads } =
        replaceBase64InDiagramXml(insert.data);
      if (diagramUploads.length > 0) {
        hasBase64 = true;
        for (const { base64, ref } of diagramUploads) {
          storeImageRef(base64, ref).catch((err) => {
            console.warn("[image-storage] Failed to store diagram image:", err);
          });
        }
        cleanInserts.push({ ...insert, data: newData });
      } else {
        cleanInserts.push(insert);
      }
    }
    if (cleanInserts.length > 0) {
      newPatchInserts = cleanInserts;
    }
  }

  if (!hasBase64) return undefined;

  for (const { cellId, base64 } of pendingUploads) {
    uploadAndApplyImage(cellId, base64);
  }

  const hasDiagramInsertOrRemove =
    (patch.r && patch.r.length > 0) ||
    (!!newPatchInserts && newPatchInserts.length > 0);
  const hasNewUpdate = Object.keys(newUpdate).length > 0;
  if (!hasNewUpdate && !hasDiagramInsertOrRemove) {
    return null;
  }

  const newPatch: FilePatch = {};
  if (newPatchInserts) newPatch.i = newPatchInserts;
  else if (patch.i) newPatch.i = patch.i;
  if (patch.r) newPatch.r = patch.r;
  if (hasNewUpdate) newPatch.u = newUpdate;

  return newPatch;
}

function replaceBase64InDiagramXml(xml: string): {
  data: string;
  uploads: Array<{ base64: string; ref: string }>;
} {
  const uploads: Array<{ base64: string; ref: string }> = [];
  const base64ToRef = new Map<string, string>();

  const newXml = xml.replace(
    /image=(data:image\/[^;,]+(?:;base64)?,[A-Za-z0-9+/=\s]+)/g,
    (match, base64) => {
      let ref = base64ToRef.get(base64);
      if (!ref) {
        ref = `img:${crypto.randomUUID?.() ?? generateUUID()}`;
        base64ToRef.set(base64, ref);
        uploads.push({ base64, ref });
      }
      return `image=${ref}`;
    },
  );

  return { data: newXml, uploads };
}

async function storeImageRef(base64: string, ref: string): Promise<void> {
  const uuid = ref.replace(IMAGE_REF_PREFIX, "");
  await storeBlob(base64, uuid);
}

async function uploadAndApplyImage(
  cellId: string,
  base64: string,
): Promise<void> {
  if (failedUploads.has(cellId)) return;

  try {
    // 同一 base64 的 upload 去重
    let promise = uploadPromises.get(base64);
    if (!promise) {
      promise = uploadImageFn(base64);
      uploadPromises.set(base64, promise);
    }
    const imageRef = await promise;

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
        if (newStyle === currentStyle) return;
        model.beginUpdate();
        try {
          model.setStyle(cell, newStyle);
        } finally {
          model.endUpdate();
        }
      }
    }
  } catch (err) {
    uploadPromises.delete(base64);
    failedUploads.add(cellId);
    console.warn("[image-storage] Failed to upload image:", err);
  }
}

function extractBase64FromStyle(style: string | undefined): string | null {
  if (!style) return null;
  // draw.io 格式: image=data:image/png,iVBOR... (省略 ;base64,)
  // 标准格式: image=data:image/png;base64,iVBOR...
  const match = style.match(
    /image=(data:image\/[^;,]+(?:;base64)?,[A-Za-z0-9+/=]+)/,
  );
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
        if (cached) return cached;
        if (notFoundUuids.has(src)) return "";
        preloadImage(src).then(() => graphRef?.refresh());
        return "";
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
          src = "";
        }
      }
      return origImage.call(
        this,
        x,
        y,
        w2,
        h,
        src,
        aspect,
        flipH,
        flipV,
        gradient,
        border,
        roundable,
        clip,
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
    const match = style.match(/image=(img:[a-f0-9-]+)/i);
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
