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

  // 按 draw.io 期望的顺序输出：parent-child 树形遍历
  // group children 紧跟在 group 后面
  const ordered: Y.XmlElement[] = [];
  const visited = new Set<string>();

  // 预构建 parent → children 映射（避免 O(n²)）
  const childrenMap = new Map<string, string[]>();
  for (const id of orderIds) {
    const cell = cells.get(id);
    if (!cell || typeof cell.getAttributes !== "function") continue;
    const parent = cell.getAttribute("parent") ?? "";
    if (!childrenMap.has(parent)) {
      childrenMap.set(parent, []);
    }
    childrenMap.get(parent)!.push(id);
  }

  function addCellAndChildren(id: string) {
    if (visited.has(id)) return;
    visited.add(id);

    if (!cells || typeof cells.get !== "function") {
      return console.warn("cells is not defined or not ymap");
    }

    const cell = cells.get(id);
    if (cell && typeof cell.getAttributes === "function") {
      ordered.push(cell);

      // 递归处理子单元格
      const children = childrenMap.get(id) || [];
      for (const childId of children) {
        addCellAndChildren(childId);
      }
    } else if (cell) {
      invalidIds.push(id);
    } else {
      missingIds.push(id);
    }
  }

  // 先处理 root cells（没有 parent），再处理 parent='0'，再处理 parent='1'
  const noParentCells = childrenMap.get("") || [];
  for (const id of noParentCells) {
    addCellAndChildren(id);
  }
  const rootChildren = childrenMap.get("0") || [];
  for (const id of rootChildren) {
    addCellAndChildren(id);
  }
  // 处理 parent='1' 的单元格（default layer 的子节点）
  const layerCells = childrenMap.get("1") || [];
  for (const id of layerCells) {
    addCellAndChildren(id);
  }
  // 处理剩余未访问的单元格
  for (const id of orderIds) {
    if (!visited.has(id)) {
      addCellAndChildren(id);
    }
  }

  if (missingIds.length) {
    console.warn(
      `[y-mxgraph] serialize: cellsOrder contains ids not present in mxCell map: ${missingIds.join(",")}`,
    );
  }
  if (invalidIds.length) {
    console.warn(
      `[y-mxgraph] serialize: cellsOrder contains invalid Y.XmlElement: ${invalidIds.join(",")}`,
    );
  }
  return {
    _attributes,
    root: {
      [mxCellKey]: ordered.map((cell) => serializeMxCell(cell)),
    },
  };
}
