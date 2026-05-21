import { get, set, del, createStore, keys, clear } from "idb-keyval";

/**
 * IndexedDB 存储层：将 base64 图片转为 Blob 存储，XML 中只保留 source-id:<uuid> 引用。
 * Blob 比 base64 小 ~33%，且 IndexedDB 对 Blob 有原生优化。
 */
const DB_NAME = "y-mxgraph-images";
const STORE_NAME = "images";

const imageStore = createStore(DB_NAME, STORE_NAME);

export const SOURCE_ID_PREFIX = "source-id:";

export function isSourceId(src: string): boolean {
  return src.startsWith(SOURCE_ID_PREFIX);
}

export function extractUuid(src: string): string {
  return src.substring(SOURCE_ID_PREFIX.length);
}

export function toSourceId(uuid: string): string {
  return `${SOURCE_ID_PREFIX}${uuid}`;
}

export function isBase64DataUri(src: string): boolean {
  return src.startsWith("data:image/");
}

export function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 将 data URI 转为 Blob */
export function dataUriToBlob(dataUri: string): Blob {
  const [header, data] = dataUri.split(",");
  const mime = header.match(/:(.*?);/)?.[1] ?? "application/octet-stream";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

/** 将 Blob 转回 data URI */
export async function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** 存入 base64 data URI（转为 Blob 存储），返回 UUID key */
export async function storeImage(base64Data: string): Promise<string> {
  const uuid = generateUUID();
  const blob = dataUriToBlob(base64Data);
  await set(uuid, blob, imageStore);
  return uuid;
}

/** 根据 UUID 获取 Blob，不存在返回 null */
export async function getImageBlob(uuid: string): Promise<Blob | null> {
  const result = await get<Blob>(uuid, imageStore);
  return result ?? null;
}

/** 根据 UUID 获取 Object URL（用于渲染） */
export async function getImageObjectUrl(uuid: string): Promise<string | null> {
  const blob = await getImageBlob(uuid);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}

/** 根据 UUID 获取 data URI（用于导出） */
export async function getImageDataUri(uuid: string): Promise<string | null> {
  const blob = await getImageBlob(uuid);
  if (!blob) return null;
  return blobToDataUri(blob);
}

export async function hasImage(uuid: string): Promise<boolean> {
  const data = await get(uuid, imageStore);
  return data !== undefined;
}

export async function deleteImage(uuid: string): Promise<void> {
  return del(uuid, imageStore);
}

export async function listImageKeys(): Promise<string[]> {
  return keys<string>(imageStore);
}

export async function clearImages(): Promise<void> {
  return clear(imageStore);
}

/** 批量预加载图片为 Object URL，返回 Map<sourceId, objectUrl> */
export async function batchGetObjectUrls(
  uuids: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  await Promise.allSettled(
    uuids.map(async (uuid) => {
      const url = await getImageObjectUrl(uuid);
      if (url) result.set(toSourceId(uuid), url);
    }),
  );
  return result;
}

/** 扫描 XML 中所有 source-id 引用并预加载为 Object URL */
export async function preloadImagesFromXml(
  xml: string,
): Promise<Map<string, string>> {
  const uuids: string[] = [];
  const regex = /source-id:([a-f0-9-]{36})/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(xml)) !== null) {
    uuids.push(match[1]);
  }

  if (uuids.length === 0) return new Map();
  return batchGetObjectUrls(uuids);
}
