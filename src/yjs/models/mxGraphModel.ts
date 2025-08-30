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
export const mxCellOrderKey = mxCellKey + "Order";
export interface MxGraphModel extends ElementCompact {
  root: {
    [mxCellKey]: MxCellModel[];
  };
}

export type YMxGraphModel = Y.Map<{
  [mxCellKey]: Y.Map<Y.XmlElement>;
  [mxCellOrderKey]: Y.Array<string>;
}>;

export function parse(object: MxGraphModel, doc?: Y.Doc) {
  const mxCells = (object.root[mxCellKey] || []).map((cell) => {
    return {
      value: parseMxCell(cell),
      id: cell._attributes?.id! as string,
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

  return mxGraphElement as YMxGraphModel;
}

export function serialize(map: YMxGraphModel) {
  const cells = map.get(mxCellKey) as unknown as Y.Map<Y.XmlElement>;
  const cellsOrder = map.get(mxCellOrderKey) as unknown as Y.Array<string>;
  return {
    _attributes: {},
    root: {
      [mxCellKey]: cellsOrder
        .toArray()
        .map((id) => serializeMxCell(cells.get(id) as Y.XmlElement)),
    },
  };
}
