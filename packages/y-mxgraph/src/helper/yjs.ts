import * as Y from "yjs";

/**
 * 从 Y.Map 中安全获取子 Map（格式固定，转型安全）
 */
export function getMap<T = unknown>(
  parent: Y.Map<unknown>,
  key: string,
): Y.Map<T> | undefined {
  return parent.get(key) as Y.Map<T> | undefined;
}

/**
 * 从 Y.Map 中安全获取子 Array（格式固定，转型安全）
 */
export function getArray<T = unknown>(
  parent: Y.Map<unknown>,
  key: string,
): Y.Array<T> | undefined {
  return parent.get(key) as Y.Array<T> | undefined;
}
