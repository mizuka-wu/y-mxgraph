/**
 * 和mxGraphModel的转换
 */
import * as Y from "yjs";

import type { ElementCompact } from "xml-js";

export const key = "mxGraphModel";
export interface MxGraphModel extends ElementCompact {
  root: {
    mxCell: ElementCompact[];
  };
}

export function parse(object: MxGraphModel, doc?: Y.Doc) {
  const mxCells = (object.root.mxCell || []).map((cell) => {
    const xmlElement = new Y.XmlElement("mxCell");

    for (const attribute of Object.keys(cell._attributes || {})) {
      xmlElement.setAttribute(
        attribute,
        `${cell._attributes?.[attribute] || ""}`
      );
    }
    return xmlElement;
  });

  const xmlElement = doc?.getXmlElement(key) || new Y.XmlElement(key);

  if (doc) {
    doc.transact(() => {
      xmlElement.nodeName = key;
      xmlElement.insert(0, mxCells);
    });
  } else {
    xmlElement.insert(0, mxCells);
  }

  return xmlElement;
}

export function serialize(xmlElement: Y.XmlElement) {
  return {
    _attributes: {
      ...xmlElement.getAttributes(),
    },
    root: {},
  };
}
