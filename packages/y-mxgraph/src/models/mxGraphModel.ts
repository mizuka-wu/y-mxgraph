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
  const mxCellsRaw = object.root[mxCellKey] || [];
  const mxCells = (Array.isArray(mxCellsRaw) ? mxCellsRaw : [mxCellsRaw]).map((cell: MxCellModel) => {
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

  const ids = mxCells.map((cell) => cell.id);
  cellsOrder.push(ids);

  // 确保 cell 0（根节点）和 cell 1（默认图层）始终存在
  // 注意：standalone Y.Map 的 has() 不可靠，用 ids 数组检查
  if (!ids.includes("0")) {
    const cell0 = new Y.XmlElement("mxCell");
    cell0.setAttribute("id", "0");
    cells.set("0", cell0);
    cellsOrder.insert(0, ["0"]);
  }
  if (!ids.includes("1")) {
    const cell1 = new Y.XmlElement("mxCell");
    cell1.setAttribute("id", "1");
    cell1.setAttribute("parent", "0");
    cells.set("1", cell1);
    const idx0 = cellsOrder.toArray().indexOf("0");
    cellsOrder.insert(idx0 >= 0 ? idx0 + 1 : 0, ["1"]);
  }

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
  // 确保输出中始终包含 cell 0 和 cell 1
  const hasCell0 = ordered.some(
    (c) => (c as Y.XmlElement).getAttribute("id") === "0",
  );
  const hasCell1 = ordered.some(
    (c) => (c as Y.XmlElement).getAttribute("id") === "1",
  );

  // 序列化所有正常 cell
  const serialized = ordered.map((cell) => serializeMxCell(cell));

  // 补入缺失的 protected cell（直接构造序列化对象，不创建 Y.XmlElement）
  if (!hasCell0) {
    serialized.unshift({ _attributes: { id: "0" }, mxCell: [] });
  }
  if (!hasCell1) {
    const idx0 = serialized.findIndex(
      (c) => (c as any)?._attributes?.id === "0",
    );
    const insertIdx = idx0 >= 0 ? idx0 + 1 : 0;
    serialized.splice(insertIdx, 0, {
      _attributes: { id: "1", parent: "0" },
      mxCell: [],
    });
  }

  return {
    _attributes,
    root: {
      [mxCellKey]: serialized,
    },
  };
}
