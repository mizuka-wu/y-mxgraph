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

export interface Diagram extends ElementCompact {
  mxGraphModel: MxGraphModel;
  customProperties?: Map<string, string>;
}

export type YDiagram = Y.Map<unknown>;

export function parse(object: Diagram): YDiagram {
  const yDiagramElement = new Y.Map();
  yDiagramElement.set("name", `${object._attributes?.name || ""}`);
  yDiagramElement.set("id", `${object._attributes?.id || ""}`);

  const mxGraphModel = parseMxGraphModel(object[mxGraphModelKey]);

  yDiagramElement.set(mxGraphModelKey, mxGraphModel);
  
  // Parse and store custom properties from _attributes if present
  const customProperties = new Map<string, string>();
  for (const [key, value] of Object.entries(object._attributes || {})) {
    if (key !== "id" && key !== "name") {
      customProperties.set(key, String(value));
    }
  }
  if (customProperties.size > 0) {
    const yCustomProperties = new Y.Map<string>();
    customProperties.forEach((v, k) => yCustomProperties.set(k, v));
    yDiagramElement.set("customProperties", yCustomProperties);
  }
  
  return yDiagramElement as YDiagram;
}

export function serialize(yDiagram: YDiagram) {
  const mxGraphModel = getMap(yDiagram, mxGraphModelKey);
  const customProperties = getMap(yDiagram, "customProperties");
  
  const attributes: Record<string, string> = {
    name: yDiagram.get("name") as string,
    id: yDiagram.get("id") as string,
  };
  
  if (customProperties) {
    customProperties.forEach((value, key) => {
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
