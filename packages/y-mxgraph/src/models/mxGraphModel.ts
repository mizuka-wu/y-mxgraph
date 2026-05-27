import * as Y from "yjs";
import { getMap, getArray } from "../helper/yjs";

import {
  key as mxCellKey,
  parse as parseMxCell,
  serialize as serializeMxCell,
  type MxCellModel,
} from "./mxCell";
import type { ElementCompact } from "xml-js";

export const key = "mxGraphModel";
export const mxCellOrderKey = mxCellKey + "Order";
export const mxGraphModelAttributesKey = "attributes";

export interface MxGraphModel extends ElementCompact {
  root: {
    mxCell: MxCellModel[];
  };
}

export type YMxGraphModel = Y.Map<unknown>;

export function parse(object: MxGraphModel, doc?: Y.Doc) {
  const mxCells = (object.root[mxCellKey] || []).map((cell: MxCellModel) => {
    return {
      value: parseMxCell(cell),
      id: (cell._attributes?.id || "") as string,
    };
  });

  const mxGraphElement = doc?.getMap(key) || new Y.Map();

  const cells = new Y.Map<Y.XmlElement>();
  const cellsOrder = new Y.Array<string>();

  mxCells.forEach((cell) => {
    cells.set(cell.id, cell.value);
  });

  cellsOrder.push(mxCells.map((cell) => cell.id));

  mxGraphElement.set(mxCellKey, cells);
  mxGraphElement.set(mxCellOrderKey, cellsOrder);

  // Store mxGraphModel attributes
  const attributes = object._attributes || {};
  const attributesMap = new Y.Map<string>();
  for (const [key, value] of Object.entries(attributes)) {
    attributesMap.set(key, `${value || ""}`);
  }
  mxGraphElement.set(mxGraphModelAttributesKey, attributesMap);

  return mxGraphElement as YMxGraphModel;
}

export function serialize(map: YMxGraphModel) {
  const cells = getMap<Y.XmlElement>(map, mxCellKey)!;
  const cellsOrder = getArray<string>(map, mxCellOrderKey)!;
  const attributesMap = getMap<string>(map, mxGraphModelAttributesKey);

  const attributes: Record<string, string> = {};
  if (attributesMap) {
    for (const [key, value] of attributesMap.entries()) {
      attributes[key] = value || "";
    }
  }

  return {
    _attributes: attributes,
    root: {
      [mxCellKey]: cellsOrder
        .toArray()
        .map((id) => serializeMxCell(cells!.get(id) as Y.XmlElement)),
    },
  };
}
