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

  // 确保 cell 0（根节点）和 cell 1（默认图层）始终存在
  if (!cells.has("0")) {
    const cell0 = new Y.XmlElement("mxCell");
    cell0.setAttribute("id", "0");
    cells.set("0", cell0);
    cellsOrder.insert(0, ["0"]);
  }
  if (!cells.has("1")) {
    const cell1 = new Y.XmlElement("mxCell");
    cell1.setAttribute("id", "1");
    cell1.setAttribute("parent", "0");
    cells.set("1", cell1);
    const idx0 = cellsOrder.toArray().indexOf("0");
    cellsOrder.insert(idx0 >= 0 ? idx0 + 1 : 0, ["1"]);
  }

  mxGraphElement.set(mxCellKey, cells);
  mxGraphElement.set(mxCellOrderKey, cellsOrder);

  return mxGraphElement as YMxGraphModel;
}

export function serialize(map: YMxGraphModel) {
  const cells = map.get(mxCellKey) as unknown as Y.Map<Y.XmlElement>;
  const cellsOrder = map.get(mxCellOrderKey) as unknown as Y.Array<string>;

  const orderedCells = cellsOrder
    .toArray()
    .filter((id) => {
      const cell = cells.get(id);
      if (!cell) {
        console.warn(
          `[y-mxgraph] serialize: cell "${id}" in order but not in cellsMap, skipping`,
        );
        return false;
      }
      return true;
    })
    .map((id) => serializeMxCell(cells.get(id) as Y.XmlElement));

  // 确保输出中始终包含 cell 0 和 cell 1
  const hasCell0 = orderedCells.some(
    (c) => (c as any)?._attributes?.id === "0",
  );
  const hasCell1 = orderedCells.some(
    (c) => (c as any)?._attributes?.id === "1",
  );
  if (!hasCell0) {
    orderedCells.unshift({ _attributes: { id: "0" }, mxCell: [] });
  }
  if (!hasCell1) {
    const idx0 = orderedCells.findIndex(
      (c) => (c as any)?._attributes?.id === "0",
    );
    const insertIdx = idx0 >= 0 ? idx0 + 1 : 0;
    orderedCells.splice(insertIdx, 0, {
      _attributes: { id: "1", parent: "0" },
      mxCell: [],
    });
  }

  return {
    _attributes: {},
    root: {
      [mxCellKey]: orderedCells,
    },
  };
}
