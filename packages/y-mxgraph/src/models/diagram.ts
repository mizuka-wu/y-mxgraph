import * as Y from "yjs";
import { getMap } from "../helper/yjs";
import {
  parse as parseMxGraphModel,
  serialize as serializeMxGraphModel,
  key as mxGraphModelKey,
  type MxGraphModel,
  type YMxGraphModel,
} from "./mxGraphModel";
import type { ElementCompact } from "xml-js";

export const key = "diagram";

/**
 * 默认的 diagram 固定属性白名单
 * 默认只包含 background，其他属性不会自动同步
 * 
 * 如需同步其他属性，请通过 options.fixedAttributes 自定义
 */
export const DEFAULT_DIAGRAM_FIXED_ATTRIBUTES: Set<string> = new Set([
  "background",  // 背景颜色/图片（唯一需要同步的属性）
]);

export type DiagramFixedAttributes = Set<string>;

export interface Diagram extends ElementCompact {
  mxGraphModel: MxGraphModel;
  fixedAttributes?: Map<string, string>;
}

export type YDiagram = Y.Map<unknown>;

export interface DiagramOptions {
  /**
   * diagram 固定属性白名单
   * 默认使用 DEFAULT_DIAGRAM_FIXED_ATTRIBUTES (仅 background)
   * 空 Set 表示不自动同步任何固定属性
   * 
   * @example
   * // 只同步 background
   * xml2ydoc(xml, doc);
   * 
   * @example
   * // 禁用所有固定属性同步
   * xml2ydoc(xml, doc, { fixedAttributes: new Set() });
   * 
   * @example
   * // 自定义需要同步的属性
   * xml2ydoc(xml, doc, {
   *   fixedAttributes: new Set(["background", "pageScale"])
   * });
   */
  fixedAttributes?: DiagramFixedAttributes;
}

export function parse(
  object: Diagram,
  options?: DiagramOptions
): YDiagram {
  const yDiagramElement = new Y.Map();
  yDiagramElement.set("name", `${object._attributes?.name || ""}`);
  yDiagramElement.set("id", `${object._attributes?.id || ""}`);

  const mxGraphModel = parseMxGraphModel(object[mxGraphModelKey]);

  yDiagramElement.set(mxGraphModelKey, mxGraphModel);
  
  // 解析固定的 diagram 属性（白名单模式）
  const fixedAttributesSet = options?.fixedAttributes || DEFAULT_DIAGRAM_FIXED_ATTRIBUTES;
  const fixedAttributes = new Map<string, string>();
  
  for (const [key, value] of Object.entries(object._attributes || {})) {
    if (key !== "id" && key !== "name" && fixedAttributesSet.has(key)) {
      fixedAttributes.set(key, String(value));
    }
  }
  
  if (fixedAttributes.size > 0) {
    const yFixedAttributes = new Y.Map<string>();
    fixedAttributes.forEach((v, k) => yFixedAttributes.set(k, v));
    yDiagramElement.set("fixedAttributes", yFixedAttributes);
  }
  
  return yDiagramElement as YDiagram;
}

export function serialize(
  yDiagram: YDiagram,
  options?: DiagramOptions
) {
  const mxGraphModel = getMap(yDiagram, mxGraphModelKey);
  const fixedAttributes = getMap(yDiagram, "fixedAttributes");
  
  const attributes: Record<string, string> = {
    name: yDiagram.get("name") as string,
    id: yDiagram.get("id") as string,
  };
  
  if (fixedAttributes) {
    fixedAttributes.forEach((value, key) => {
      attributes[key] = typeof value === "string" ? value : String(value);
    });
  }
  
  return {
    _attributes: attributes,
    [mxGraphModelKey]: mxGraphModel
      ? serializeMxGraphModel(mxGraphModel)
      : undefined,
  };
}
