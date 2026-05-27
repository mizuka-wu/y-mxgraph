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
/** 协同同步的 mxGraphModel 属性：仅 background */
export const backgroundKey = "background";

export interface MxGraphModel extends ElementCompact {
  _attributes?: Record<string, string>;
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

  const bg = object._attributes?.background;
  if (bg != null && bg !== "") {
    mxGraphElement.set(backgroundKey, String(bg));
  }

  return mxGraphElement as YMxGraphModel;
}

export function serialize(map: YMxGraphModel) {
  const cells = getMap<Y.XmlElement>(map, mxCellKey)!;
  const cellsOrder = getArray<string>(map, mxCellOrderKey)!;
  const bg = map.get(backgroundKey) as string | undefined;
  const _attributes: Record<string, string> = {};
  if (bg) _attributes.background = bg;
  return {
    _attributes,
    root: {
      [mxCellKey]: cellsOrder
        .toArray()
        .map((id) => serializeMxCell(cells!.get(id) as Y.XmlElement)),
    },
  };
}
