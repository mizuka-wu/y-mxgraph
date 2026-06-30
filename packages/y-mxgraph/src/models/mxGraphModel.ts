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
  const cells = getMap<Y.XmlElement>(map, mxCellKey);
  const cellsOrder = getArray<string>(map, mxCellOrderKey);

  if (!cells || !cellsOrder) {
    return {
      _attributes: {},
      root: { [mxCellKey]: [] },
    };
  }

  const bg = map.get(backgroundKey) as string | undefined;
  const _attributes: Record<string, string> = {};
  if (bg) _attributes.background = bg;
  const orderIds = cellsOrder.toArray();
  const missingIds: string[] = [];
  const invalidIds: string[] = [];
  const filtered: Y.XmlElement[] = [];
  for (const id of orderIds) {
    const cell = cells.get(id);
    if (cell && typeof cell.getAttributes === 'function') {
      filtered.push(cell);
    } else if (cell) {
      invalidIds.push(id);
    } else {
      missingIds.push(id);
    }
  }
  if (missingIds.length) {
    console.warn(
      `[y-mxgraph] serialize: cellsOrder contains ids not present in mxCell map: ${missingIds.join(",")}`,
    );
    // 自动清理无效的 id（可能是 undo 后不同步导致的）
    for (const id of missingIds) {
      const idx = orderIds.indexOf(id);
      if (idx !== -1) {
        cellsOrder.delete(idx, 1);
        orderIds.splice(idx, 1);
      }
    }
  }
  if (invalidIds.length) {
    console.warn(
      `[y-mxgraph] serialize: cellsOrder contains invalid Y.XmlElement: ${invalidIds.join(",")}`,
    );
    // 自动清理无效的 id
    for (const id of invalidIds) {
      const idx = orderIds.indexOf(id);
      if (idx !== -1) {
        cellsOrder.delete(idx, 1);
        orderIds.splice(idx, 1);
      }
    }
  }
  return {
    _attributes,
    root: {
      [mxCellKey]: filtered.map((cell) => serializeMxCell(cell)),
    },
  };
}
