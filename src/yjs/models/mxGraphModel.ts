/**
 * 和mxGraphModel的转换
 */
import * as Y from "yjs";

import {
  key as mxCellKey,
  parse as parseMxCell,
  serialize as serializeMxCell,
  type MxCellModel,
} from "./mxCell";
import type { ElementCompact } from "xml-js";

export const key = "mxGraphModel";
export interface MxGraphModel extends ElementCompact {
  root: {
    [mxCellKey]: MxCellModel[];
  };
}

export function parse(object: MxGraphModel, doc?: Y.Doc) {
  const mxCells = (object.root[mxCellKey] || []).map((cell) => {
    return parseMxCell(cell);
  });

  const xmlElement = doc?.getXmlElement(key) || new Y.XmlElement(key);

  if (doc) {
    xmlElement.nodeName = key;
    xmlElement.insert(0, mxCells);
  } else {
    xmlElement.insert(0, mxCells);
  }

  return xmlElement;
}

export function serialize(xmlElement: Y.XmlElement) {
  const cells = (xmlElement.querySelectorAll(mxCellKey) ||
    []) as Y.XmlElement[];
  return {
    _attributes: {
      ...xmlElement.getAttributes(),
    },
    root: {
      [mxCellKey]: cells.map(serializeMxCell),
    },
  };
}
