import * as Y from "yjs";
import {
  parse as parseMxGraphModel,
  serialize as serializeMxGraphModel,
  key as mxGraphModelKey,
  type MxGraphModel,
} from "./mxGraphModel";
import type { ElementCompact } from "xml-js";

export const key = "diagram";

export interface Diagram extends ElementCompact {
  [mxGraphModelKey]: MxGraphModel;
}

export function parse(object: Diagram): Y.XmlElement {
  // 标记参数已使用，满足 noUnusedParameters
  const xmlElement = new Y.XmlElement(key);
  xmlElement.setAttribute("name", `${object._attributes?.name || ""}`);
  xmlElement.setAttribute("id", `${object._attributes?.id || ""}`);
  xmlElement.insert(0, [parseMxGraphModel(object[mxGraphModelKey])]);
  return xmlElement;
}

export function serialize(xmlElement: Y.XmlElement) {
  const mxGraphModel = xmlElement.querySelector(
    mxGraphModelKey
  ) as null | Y.XmlElement;

  return {
    _attributes: {
      ...xmlElement.getAttributes(),
    },
    [mxGraphModelKey]: mxGraphModel
      ? serializeMxGraphModel(mxGraphModel)
      : undefined,
  };
}
