import { getMap } from "../helper/yjs";
import {
  backgroundKey,
  key as mxGraphModelKey,
  type YMxGraphModel,
} from "./mxGraphModel";
import type { YDiagram } from "./diagram";

/** draw.io patch 里 view.background 的值 → XML 属性 */
export function patchValueToXmlAttr(value: string): string {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "string") return parsed;
  } catch {
    /* 非 JSON 则原样使用 */
  }
  return value;
}

/** XML background → draw.io patch 用的 JSON 字符串 */
export function xmlAttrToPatchValue(value: string): string {
  return JSON.stringify(value);
}

export function getBackground(diagram: YDiagram): string | undefined {
  const gm = getMap(diagram, mxGraphModelKey) as YMxGraphModel | undefined;
  if (!gm) return undefined;
  const bg = gm.get(backgroundKey) as string | undefined;
  return bg || undefined;
}

export function setBackground(
  diagram: YDiagram,
  background: string | undefined,
): void {
  const gm = getMap(diagram, mxGraphModelKey) as YMxGraphModel | undefined;
  if (!gm) return;
  if (background != null && background !== "") {
    gm.set(backgroundKey, background);
  } else {
    gm.delete(backgroundKey);
  }
}

/** 生成 draw.io 可消费的 view patch（仅 background） */
export function diffBackgroundViewPatch(
  prev: string | undefined,
  curr: string | undefined,
): Record<string, string> | undefined {
  const pv = prev ?? "";
  const cv = curr ?? "";
  if (pv === cv) return undefined;
  return {
    background: cv === "" ? '""' : xmlAttrToPatchValue(cv),
  };
}

/** 应用 draw.io diffPages 的 view 段（仅处理 background） */
export function applyViewPatch(
  diagram: YDiagram,
  viewPatch: Record<string, unknown>,
): void {
  if (!("background" in viewPatch)) return;

  const raw = viewPatch.background;
  if (raw === null || raw === undefined) {
    setBackground(diagram, undefined);
    return;
  }

  const str = String(raw);
  if (str === "" || str === '""' || str === "null") {
    setBackground(diagram, undefined);
  } else {
    setBackground(diagram, patchValueToXmlAttr(str));
  }
}
