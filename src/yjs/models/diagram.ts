import * as Y from "yjs";
import { parse as parseMxGraphModel, type MxGraphModel } from "./mxGraphModel";
import type { ElementCompact } from "xml-js";

export const key = "diagram";

export interface Diagram extends ElementCompact {
  mxGraphModel: MxGraphModel;
}

export function parse(object: Diagram): Y.XmlElement {
  // 标记参数已使用，满足 noUnusedParameters
  const xmlElement = new Y.XmlElement("diagram");
  xmlElement.setAttribute("name", `${object._attributes?.name || ""}`);
  xmlElement.setAttribute("id", `${object._attributes?.id || ""}`);
  xmlElement.insert(0, [parseMxGraphModel(object.mxGraphModel)]);
  return xmlElement;
}

export function serialize(xmlElement: Y.XmlElement) {
  return {
    _attributes: {
      ...xmlElement.getAttributes(),
    },
  };
}
