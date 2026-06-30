import { parse, serializer as xmlSerializer } from "../helper/xml";
import {
  parse as parseDiagram,
  key as diagramKey,
  serialize as serializeDiagram,
  type YDiagram,
} from "../models/diagram";
import {
  key as mxfileKey,
  type YMxFile,
  diagramOrderKey,
} from "../models/mxfile";
import {
  backgroundKey,
  mxCellOrderKey,
  key as mxGraphModelKey,
  type YMxGraphModel,
} from "../models/mxGraphModel";
import { key as mxCellKey } from "../models/mxCell";
import {
  applyViewPatch,
  diffBackgroundViewPatch,
  getBackground,
} from "../models/view";
import * as Y from "yjs";

const DIFF_INSERT = "i";
const DIFF_REMOVE = "r";
const DIFF_UPDATE = "u";

type DocSnapshot = {
  diagramOrder: string[] | null;
  cellsOrder: Map<string, string[]>;
  cellAttrs: Map<string, Map<string, Record<string, string>>>;
  diagramBackground: Map<string, string | undefined>;
};
const docSnapshots = new WeakMap<Y.Doc, DocSnapshot>();

interface ParentLookupEntry {
  inserted: Record<string, Record<string, string>>;
  moved: Record<string, string>;
}

function createParentLookup(
  cellsDiff: {
    [DIFF_INSERT]?: Record<string, string>[];
    [DIFF_UPDATE]?: { [key: string]: Record<string, string> };
  },
  cellsMap?: Y.Map<Y.XmlElement>,
): Record<string, ParentLookupEntry> {
  const parentLookup: Record<string, ParentLookupEntry> = {};

  const getLookup = (id: string): ParentLookupEntry => {
    if (!parentLookup[id]) {
      parentLookup[id] = { inserted: {}, moved: {} };
    }
    return parentLookup[id];
  };

  if (cellsDiff[DIFF_INSERT]) {
    for (const item of cellsDiff[DIFF_INSERT]!) {
      const par = (item.parent != null) ? item.parent : '';
      const prev = (item.previous != null) ? item.previous : '';
      getLookup(par).inserted[prev] = item;
    }
  }

  if (cellsDiff[DIFF_UPDATE]) {
    for (const id of Object.keys(cellsDiff[DIFF_UPDATE]!)) {
      const temp = cellsDiff[DIFF_UPDATE]![id];
      if (temp.previous != null) {
        let par = temp.parent;
        if (par == null && cellsMap) {
          const cell = cellsMap.get(id) as Y.XmlElement | undefined;
          if (cell) {
            const parentId = cell.getAttribute('parent');
            if (parentId) {
              par = parentId;
            }
          }
        }
        if (par != null) {
          getLookup(par).moved[temp.previous] = id;
        }
      }
    }
  }

  return parentLookup;
}

/**
 * 按照 draw.io 原始实现：处理单元格顺序
 * 参考 DiffSync.js 中的 patchCellRecursive
 */
function patchCellRecursive(
  orderArr: Y.Array<string>,
  cellsMap: Y.Map<Y.XmlElement>,
  parentId: string,
  parentLookup: Record<string, ParentLookupEntry>,
  cellsDiff: {
    [DIFF_INSERT]?: Record<string, string>[];
    [DIFF_UPDATE]?: { [key: string]: Record<string, string> };
  },
) {
  const temp = parentLookup[parentId];
  const inserted = temp?.inserted ? { ...temp.inserted } : {};
  const moved = temp?.moved ? { ...temp.moved } : {};

  // 获取当前 parent 下的子单元格索引
  // draw.io 会从 model.getChildCount(cell) 获取子单元格
  // 我们需要从 cellsMap 中获取所有 parent=parentId 的单元格
  const currentOrder = orderArr.toArray();
  const childIndices: number[] = [];
  for (let i = 0; i < currentOrder.length; i++) {
    const cellId = currentOrder[i];
    const cell = cellsMap.get(cellId) as Y.XmlElement | undefined;
    const cellParent = cell?.getAttribute('parent') ?? '';
    if (cellParent === parentId) {
      childIndices.push(i);
    }
  }

  // Restores existing order - 按照 draw.io 原始实现
  // 即使 parentLookup 中没有条目，也要从 cellsMap 中获取子单元格的顺序
  let prev = '';
  for (const idx of childIndices) {
    const cellId = currentOrder[idx];
    if (moved[prev] == null &&
      (cellsDiff[DIFF_UPDATE] == null ||
        cellsDiff[DIFF_UPDATE][cellId] == null ||
        (cellsDiff[DIFF_UPDATE][cellId].previous == null &&
          cellsDiff[DIFF_UPDATE][cellId].parent == null))
    ) {
      moved[prev] = cellId;
    }
    prev = cellId;
  }

  // 按照 draw.io 原始实现
  let index = childIndices.length > 0 ? childIndices[0] : currentOrder.length;
  const children: Array<{ child: Y.XmlElement | null; insert: boolean } | null> = [null];
  const processed = new Set<string>();

  const addCell = (child: Y.XmlElement | null, insert: boolean): string => {
    const id = child ? (child.getAttribute('id') || '') : '';
    if (!id || processed.has(id)) return id;

    if (child != null && insert) {
      const existing = cellsMap.get(id) as Y.XmlElement | undefined;
      if (existing != null && existing !== child) {
        return id;
      }
    }

    if (child != null) {
      processed.add(id);

      // 确保单元格在 orderArr 的正确位置
      const currentOrderNow = orderArr.toArray();
      const currentIdx = currentOrderNow.indexOf(id);
        if (currentIdx === -1) {
          // 新单元格，插入到当前位置
          if (index <= currentOrderNow.length) {
            orderArr.insert(index, [id]);
          } else {
            orderArr.push([id]);
          }
        } else if (currentIdx !== index) {
          // 已有单元格，移动到正确位置
          orderArr.delete(currentIdx, 1);
          const newOrder = orderArr.toArray();
          const targetIdx = Math.min(index, newOrder.length);
          orderArr.insert(targetIdx, [id]);
        }

      // 立即递归处理子单元格（关键！在 index++ 之前）
      const hasParentLookupEntry = !!parentLookup[id];
      let hasChildrenInCellsMap = false;
      
      if (!hasParentLookupEntry) {
        hasChildrenInCellsMap = Array.from(cellsMap.keys()).some(cid => {
          const cell = cellsMap.get(cid) as Y.XmlElement | undefined;
          return cell?.getAttribute('parent') === id;
        });
      }
      
      if (hasParentLookupEntry || hasChildrenInCellsMap) {
        patchCellRecursive(orderArr, cellsMap, id, parentLookup, cellsDiff);
        // 递归后，index 需要跳过所有子树
        // 找到当前 cell 的 parent，然后找到下一个同级 sibling 的位置
        const cellParent = (cellsMap.get(id) as Y.XmlElement)?.getAttribute('parent') ?? '';
        const orderNow = orderArr.toArray();
        const cellPos = orderNow.indexOf(id);
        let nextSiblingPos = orderNow.length;
        for (let i = cellPos + 1; i < orderNow.length; i++) {
          const cid = orderNow[i];
          const c = cellsMap.get(cid) as Y.XmlElement | undefined;
          const cParent = c?.getAttribute('parent') ?? '';
          if (cParent === cellParent) {
            nextSiblingPos = i;
            break;
          }
        }
        index = nextSiblingPos;
      }

      index++;
    }

    return id;
  };

  while (children.length > 0) {
    const entry = children.shift()!;
    const child = entry?.child ?? null;
    const insert = entry?.insert ?? false;
    const id = addCell(child, insert);

    const mov = moved[id];
    if (mov != null) {
      delete moved[id];
      const movCell = cellsMap.get(mov) as Y.XmlElement | undefined;
      if (movCell && !processed.has(mov)) {
        children.push({ child: movCell, insert: false });
      }
    }

    const ins = inserted[id];
    if (ins != null) {
      delete inserted[id];
      const insId = ins['id'];
      if (insId && cellsMap.has(insId) && !processed.has(insId)) {
        children.push({ child: cellsMap.get(insId) as Y.XmlElement, insert: true });
      }
    }

    if (children.length === 0) {
      for (const orphanId of Object.keys(moved)) {
        const orphanCell = cellsMap.get(moved[orphanId]) as Y.XmlElement | undefined;
        if (orphanCell && !processed.has(moved[orphanId])) {
          children.push({ child: orphanCell, insert: false });
        }
        delete moved[orphanId];
      }

      for (const orphanPrev of Object.keys(inserted)) {
        const orphanData = inserted[orphanPrev];
        const orphanId = orphanData['id'];
        if (orphanId && cellsMap.has(orphanId) && !processed.has(orphanId)) {
          children.push({ child: cellsMap.get(orphanId) as Y.XmlElement, insert: true });
        }
        delete inserted[orphanPrev];
      }
    }
  }
}

/**
 * 处理 parent 变化的情况（如创建分组）
 * 当单元格的 parent 从 A 变为 B 时，需要：
 * 1. 从 A 的 order 中移除
 * 2. 添加到 B 的 order 中
 */
function handleParentChanges(
  cellsDiff: {
    [DIFF_UPDATE]?: { [key: string]: Record<string, string> };
  },
  cellsMap: Y.Map<Y.XmlElement>,
  orderArr: Y.Array<string>,
) {
  if (!cellsDiff[DIFF_UPDATE]) return;

  const currentOrder = orderArr.toArray();

  for (const cellId of Object.keys(cellsDiff[DIFF_UPDATE])) {
    const diff = cellsDiff[DIFF_UPDATE][cellId];
    if (diff.parent == null) continue;

    const cell = cellsMap.get(cellId) as Y.XmlElement | undefined;
    if (!cell) continue;

    const currentParent = cell.getAttribute('parent') || '1';
    const newParent = diff.parent;

    if (currentParent === newParent) continue;

    cell.setAttribute('parent', newParent);

    const currentIndex = currentOrder.indexOf(cellId);
    if (currentIndex !== -1) {
      orderArr.delete(currentIndex, 1);
      currentOrder.splice(currentIndex, 1);
    }
  }
}

function insertAfterUnique(
  orderArr: Y.Array<string>,
  id: string,
  previous: string | null | undefined,
  fallbackToEnd = false,
) {
  const currentIds = orderArr.toArray();
  // previous 语义："" = 插到最前面，null/undefined = 未找到（走 fallback），string = 在该 id 之后
  let anchorPos = previous != null ? currentIds.indexOf(previous) : -1;
  if (anchorPos === -1 && fallbackToEnd) anchorPos = currentIds.length - 1;
  const targetIndex = anchorPos + 1;

  const existingIndex = currentIds.indexOf(id);
  if (existingIndex === -1) {
    orderArr.insert(targetIndex, [id]);
    return;
  }

  if (existingIndex === targetIndex) return;

  if (existingIndex < targetIndex) {
    orderArr.delete(existingIndex, 1);
    orderArr.insert(targetIndex - 1, [id]);
  } else {
    orderArr.delete(existingIndex, 1);
    orderArr.insert(targetIndex, [id]);
  }
}

function ensureUniqueOrder(orderArr: Y.Array<string>) {
  const arr = orderArr.toArray();
  const seen = new Set<string>();
  const dupIdx: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    const id = arr[i];
    if (!id) continue;
    if (seen.has(id)) dupIdx.push(i);
    else seen.add(id);
  }
  if (dupIdx.length) {
    // 从后往前删除，避免索引偏移
    for (let i = dupIdx.length - 1; i >= 0; i--) {
      orderArr.delete(dupIdx[i], 1);
    }
  }
}

export interface DiagramInsert {
  data: string;
  id: string;
  /** previous 语义："" = 最前面，null/undefined = 未找到，string = 在该 id 之后 */
  previous?: string | null;
}

export interface FilePatch {
  [DIFF_REMOVE]?: string[];
  [DIFF_INSERT]?: DiagramInsert[];
  [DIFF_UPDATE]?: {
    [key: string]: {
      name?: string;
      /** previous 语义："" = 最前面，null = 未找到，string = 在该 id 之后 */
      previous?: string | null;
      /** draw.io page viewState（如 background），与 diffPages 格式一致 */
      view?: Record<string, string>;
      cells?: {
        [DIFF_REMOVE]?: string[];
        [DIFF_INSERT]?: Record<string, string>[];
        [DIFF_UPDATE]?: {
          [key: string]: Record<string, string>;
        };
      };
    };
  };
}

function pruneEmptyPatch(patch: FilePatch): FilePatch {
  if (!patch[DIFF_UPDATE]) return patch;
  for (const id of Object.keys(patch[DIFF_UPDATE]!)) {
    const u = patch[DIFF_UPDATE]![id]!;
    const cells = u.cells;
    if (cells?.[DIFF_UPDATE]) {
      for (const cid of Object.keys(cells[DIFF_UPDATE]!)) {
        if (Object.keys(cells[DIFF_UPDATE]![cid]!).length === 0) {
          delete cells[DIFF_UPDATE]![cid];
        }
      }
      if (Object.keys(cells[DIFF_UPDATE]!).length === 0) {
        delete cells[DIFF_UPDATE];
      }
    }
    if (
      cells &&
      !cells[DIFF_REMOVE]?.length &&
      !cells[DIFF_INSERT]?.length &&
      (!cells[DIFF_UPDATE] || Object.keys(cells[DIFF_UPDATE]).length === 0)
    ) {
      delete u.cells;
    }
    if (Object.keys(u).length === 0) {
      delete patch[DIFF_UPDATE]![id];
    }
  }
  if (Object.keys(patch[DIFF_UPDATE]!).length === 0) {
    delete patch[DIFF_UPDATE];
  }
  return patch;
}

export function applyFilePatch(
  doc: Y.Doc,
  patch: FilePatch,
  options?: { origin?: unknown },
) {
  doc.transact(() => {
    const mxfile = doc.getMap(mxfileKey) as YMxFile;
    if (patch[DIFF_REMOVE]) {
      const diagramsMap = mxfile.get(diagramKey) as
        | Y.Map<YDiagram>
        | undefined;
      const orderArr = mxfile.get(diagramOrderKey) as
        | Y.Array<string>
        | undefined;

      if (orderArr) ensureUniqueOrder(orderArr);

      const removeIds = patch[DIFF_REMOVE];
      if (removeIds && removeIds.length) {
        if (orderArr) {
          const orderList = orderArr.toArray();
          const indexList = removeIds
            .map((id) => orderList.indexOf(id))
            .filter((i) => i !== -1)
            .sort((a, b) => b - a);
          indexList.forEach((idx) => orderArr.delete(idx, 1));
        }
        if (diagramsMap) {
          removeIds.forEach((id) => {
            if (diagramsMap.has(id)) {
              diagramsMap.delete(id);
            }
          });
        }
      }
    }

    if (patch[DIFF_INSERT]) {
      const diagramsMap = mxfile.get(diagramKey) as
        | Y.Map<YDiagram>
        | undefined;
      const orderArr = mxfile.get(diagramOrderKey) as
        | Y.Array<string>
        | undefined;

      if (orderArr) {
        ensureUniqueOrder(orderArr);

        const currentOrder = orderArr.toArray();
        if (currentOrder.length === 0 && diagramsMap && diagramsMap.size > 0) {
          const allIds = Array.from(diagramsMap.keys());
          orderArr.push(allIds);
        }
        ensureUniqueOrder(orderArr);
      }

      const existingIds = orderArr?.toArray() ?? [];
      const existingIndex = new Map<string, number>();
      existingIds.forEach((id, idx) => existingIndex.set(id, idx));

      const inserts = patch[DIFF_INSERT].map((item, order) => {
        const object = parse(item.data) as Record<string, unknown>;
        const diagramObj = Array.isArray(object?.diagram)
          ? (object.diagram as unknown[])[0]
          : object?.diagram;
        const diagramElement = parseDiagram(
          diagramObj as import("../models/diagram").Diagram,
        );
        return {
          id: item.id,
          previous: item.previous === undefined ? null : item.previous,
          diagramElement,
          order,
        };
      });

      const byId = new Map(inserts.map((i) => [i.id, i] as const));
      const computeAnchor = (node: {
        id: string;
        previous: string | null;
      }): {
        anchorId: string;
        depth: number;
      } => {
        let depth = 1;
        let anchorId = "";
        let prevId = node.previous;
        const seen = new Set<string>([node.id]);
        while (prevId) {
          if (seen.has(prevId)) {
            depth = 1;
            anchorId = "";
            break;
          }
          seen.add(prevId);

          const prevNode = byId.get(prevId);
          if (prevNode) {
            depth += 1;
            prevId = prevNode.previous;
            continue;
          }

          if (existingIndex.has(prevId)) {
            anchorId = prevId;
          } else {
            anchorId = "";
          }
          break;
        }
        return { anchorId, depth };
      };

      const enriched = inserts.map((i) => ({ ...i, ...computeAnchor(i) }));

      enriched.sort((a, b) => {
        const aIdx = a.anchorId ? existingIndex.get(a.anchorId)! : -1;
        const bIdx = b.anchorId ? existingIndex.get(b.anchorId)! : -1;
        if (aIdx !== bIdx) return aIdx - bIdx;
        if (a.depth !== b.depth) return b.depth - a.depth;
        return b.order - a.order;
      });

      for (const item of enriched) {
        if (diagramsMap) {
          diagramsMap.set(item.id, item.diagramElement);
        }
        if (orderArr) {
          const anchorArg = item.anchorId === "" ? "" : (item.anchorId ?? null);
          insertAfterUnique(orderArr, item.id, anchorArg);
        }
      }
    }

    if (patch[DIFF_UPDATE]) {
      Object.keys(patch[DIFF_UPDATE]).forEach((id) => {
        const diagramsMap = mxfile.get(diagramKey) as
          | Y.Map<YDiagram>
          | undefined;
        const diagram = diagramsMap?.get(id) as YDiagram | undefined;
        if (diagram) {
          const update = patch[DIFF_UPDATE]![id];
          if ("name" in update) {
            (diagram as unknown as Y.Map<unknown>).set(
              "name",
              update.name || "",
            );
          }

          if (update.view && typeof update.view === "object") {
            applyViewPatch(diagram, update.view);
          }

          if (update.cells) {
            const yMxGraphModel = diagram.get(mxGraphModelKey) as
              | YMxGraphModel
              | undefined;
            if (!yMxGraphModel) {
              console.warn(
                "[y-mxgraph] applyFilePatch: yMxGraphModel not found for diagram, skipping cells update",
              );
              return;
            }
            const cellsMap = yMxGraphModel.get(mxCellKey) as
              | Y.Map<Y.XmlElement>
              | undefined;
            const orderArr = yMxGraphModel.get(mxCellOrderKey) as
              | Y.Array<string>
              | undefined;

            if (!cellsMap && !orderArr) {
              console.warn(
                "[y-mxgraph] applyFilePatch: both cellsMap and orderArr missing, skipping cells update",
              );
              return;
            }

            // 按照 draw.io 原始实现：先创建 parentLookup
            const parentLookup = createParentLookup(update.cells, cellsMap);

            // 处理插入的单元格 - 创建 XmlElement 并加入 cellsMap
            if (cellsMap && update.cells[DIFF_INSERT]) {
              for (const item of update.cells[DIFF_INSERT]) {
                const cellId = item["id"] as string | undefined;
                if (!cellId) continue;
                if (!cellsMap.has(cellId)) {
                  const xmlElement = new Y.XmlElement("mxCell");
                  Object.keys(item).forEach((key) => {
                    if (key === "previous") return;
                    xmlElement.setAttribute(key, item[key]);
                  });
                  cellsMap.set(cellId, xmlElement);
                }
              }
            }

            // 处理 parent 变化（如创建分组）
            if (cellsMap && orderArr) {
              handleParentChanges(update.cells, cellsMap, orderArr);
            }

            // 按照 draw.io 原始实现：使用 patchCellRecursive 处理顺序
            if (orderArr && cellsMap) {
              const processedParents = new Set<string>();
              const processParent = (parentId: string) => {
                if (processedParents.has(parentId)) return;
                processedParents.add(parentId);
                patchCellRecursive(orderArr!, cellsMap!, parentId, parentLookup, update.cells);
              };
              processParent('');
              for (const parentId of Object.keys(parentLookup)) {
                processParent(parentId);
              }
            }

            // 更新单元格属性
            if (cellsMap && update.cells[DIFF_UPDATE]) {
              Object.keys(update.cells[DIFF_UPDATE]).forEach((cid) => {
                const updateObj = update.cells![DIFF_UPDATE]![cid];
                const cell = cellsMap.get(cid) as Y.XmlElement | undefined;
                if (cell) {
                  Object.keys(updateObj).forEach((k) => {
                    if (k === "previous" || k === "parent") return;
                    cell.setAttribute(k, updateObj[k]);
                  });
                }
              });
            }

            // 删除单元格 - 按照 draw.io 原始实现，在最后处理
            if (update.cells[DIFF_REMOVE] && update.cells[DIFF_REMOVE].length) {
              if (orderArr) {
                const orderIds = orderArr.toArray();
                const removeIndexList = update.cells[DIFF_REMOVE].map((cid) =>
                  orderIds.indexOf(cid),
                )
                  .filter((i) => i !== -1)
                  .sort((a, b) => b - a);
                removeIndexList.forEach((idx) => orderArr.delete(idx, 1));
              }
              if (cellsMap) {
                update.cells[DIFF_REMOVE].forEach((cid) => {
                  if (cellsMap.has(cid)) {
                    cellsMap.delete(cid);
                  }
                });
              }
            }
          }

          if ("previous" in update) {
            const previous = Object.prototype.hasOwnProperty.call(update, "previous")
              ? (update.previous as string | null)
              : null;
            // draw.io 语义：previous 为 null 表示没有移动，不执行任何操作
            if (previous !== null) {
              const orderArr = mxfile.get(diagramOrderKey) as
                | Y.Array<string>
                | undefined;
              if (orderArr) {
                ensureUniqueOrder(orderArr);
                insertAfterUnique(orderArr, id, previous, false);
              }
            }
          }
        }
      });
    }
  }, options?.origin);
}

export function initDocSnapshot(doc: Y.Doc, resetSnapshot = false) {
  try {
    const mxfile = doc.getMap(mxfileKey) as YMxFile;
    const diagramsMap = mxfile.get(diagramKey) as unknown as Y.Map<YDiagram>;
    const orderArr = mxfile.get(diagramOrderKey) as unknown as Y.Array<string>;
    
    // 如果 diagramOrder 为空但 diagram map 不为空,使用 diagram map 中的所有 ID
    const orderIds = orderArr ? orderArr.toArray() : [];
    const allDiagramIds = orderIds.length > 0 
      ? orderIds 
      : (diagramsMap ? Array.from(diagramsMap.keys()) : []);
    
    // resetSnapshot=true 时把 diagramOrder 设为空数组，
    // 使第一次 generatePatch 把所有现有 diagram/cells 都识别为 insert
    const diagramOrder = resetSnapshot ? [] : allDiagramIds.slice();

    const snap: DocSnapshot = {
      diagramOrder,
      cellsOrder: new Map<string, string[]>(),
      cellAttrs: new Map<string, Map<string, Record<string, string>>>(),
      diagramBackground: new Map<string, string | undefined>(),
    };

    const diagrams: YDiagram[] = diagramOrder
      .map((id) => diagramsMap?.get(id) as YDiagram | undefined)
      .filter((d): d is YDiagram => !!d);
    for (const d of diagrams) {
      const did = (d.get("id") as unknown as string) || "";
      if (!did) continue;
      const gm = d.get(mxGraphModelKey) as YMxGraphModel | undefined;
      if (gm) {
        const order = gm.get(mxCellOrderKey) as Y.Array<string> | undefined;
        const ids = order ? order.toArray().slice() : [];
        const cellsMap = gm.get(mxCellKey) as Y.Map<Y.XmlElement> | undefined;
        const attrMap = new Map<string, Record<string, string>>();
        const validIds: string[] = [];
        const invalidIds: string[] = [];
        
        if (cellsMap) {
          for (const cid of ids) {
            const el = cellsMap.get(cid) as Y.XmlElement | undefined;
            if (el && typeof el.getAttributes === 'function') {
              validIds.push(cid);
              attrMap.set(
                cid,
                (el.getAttributes() as Record<string, string>) || {},
              );
            } else {
              invalidIds.push(cid);
            }
          }
        } else {
          validIds.push(...ids);
        }
        
        // 在初始化阶段清理异常 id，不影响 undo 栈
        if (invalidIds.length > 0 && order) {
          console.warn(`[y-mxgraph] initDocSnapshot: cleaning invalid cell ids from order: ${invalidIds.join(",")}`);
          for (const invalidId of invalidIds) {
            const index = order.toArray().indexOf(invalidId);
            if (index !== -1) {
              order.delete(index, 1);
            }
          }
        }
        
        snap.cellsOrder.set(did, validIds);
        snap.cellAttrs.set(did, attrMap);
      } else {
        snap.cellsOrder.set(did, []);
        snap.cellAttrs.set(did, new Map());
      }
      snap.diagramBackground.set(did, getBackground(d));
    }

    docSnapshots.set(doc, snap);
  } catch (e) {
    console.warn("[y-mxgraph] initDocSnapshot failed:", e);
  }
}

export function generatePatch(
  events: Y.YEvent<
    Y.XmlElement | Y.Array<string> | Y.Map<Y.XmlElement> | YMxFile | YDiagram
  >[],
  explicitDoc?: Y.Doc,
): FilePatch {
  const patch: FilePatch = {};

  const doc =
    explicitDoc ??
    (events[0] as unknown as { transaction?: { doc?: Y.Doc } } | undefined)
      ?.transaction?.doc;
  if (!doc) return patch;
  if (!explicitDoc && (!events || events.length === 0)) return patch;
  const mxfile = doc.getMap(mxfileKey) as YMxFile;
  const diagramsMap = mxfile.get(diagramKey) as unknown as Y.Map<YDiagram>;
  const orderArr = mxfile.get(diagramOrderKey) as unknown as Y.Array<string>;

  let snap = docSnapshots.get(doc);
  if (!snap) {
    snap = {
      diagramOrder: null,
      cellsOrder: new Map<string, string[]>(),
      cellAttrs: new Map<string, Map<string, Record<string, string>>>(),
      diagramBackground: new Map<string, string | undefined>(),
    };
    docSnapshots.set(doc, snap);
  }
  const prevDiagramOrder = snap.diagramOrder;
  const prevCellsOrder = snap.cellsOrder;
  const prevCellsAttrs = snap.cellAttrs;
  const prevDiagramBackground = snap.diagramBackground;

  const ensureUpdate = (diagramId: string) => {
    patch[DIFF_UPDATE] = patch[DIFF_UPDATE] || {};
    patch[DIFF_UPDATE]![diagramId] = patch[DIFF_UPDATE]![diagramId] || {};
    return patch[DIFF_UPDATE]![diagramId]!;
  };
  const ensureCellSection = (diagramId: string) => {
    const u = ensureUpdate(diagramId);
    u.cells = u.cells || {};
    return u.cells!;
  };

  // 如果 diagramOrder 为空但 diagram map 不为空,使用 diagram map 中的所有 ID
  const orderIds = orderArr?.toArray() ?? [];
  const currDiagramOrder = orderIds.length > 0 
    ? orderIds 
    : (diagramsMap ? Array.from(diagramsMap.keys()) : []);
  const diagramsList = currDiagramOrder
    .map((id) => diagramsMap?.get(id) as YDiagram | undefined)
    .filter((d): d is YDiagram => !!d);
  const currCellsOrder = new Map<string, string[]>();
  const cellAttrMap = new Map<string, Map<string, Record<string, string>>>();
  const currDiagramBackground = new Map<string, string | undefined>();

  for (const d of diagramsList) {
    const did = (d.get("id") as unknown as string) || "";
    currDiagramBackground.set(did, getBackground(d));
    const attrs = new Map<string, Record<string, string>>();
    const gm = d.get(mxGraphModelKey) as YMxGraphModel | undefined;
    if (gm) {
      const cellsMap = gm.get(mxCellKey) as Y.Map<Y.XmlElement> | undefined;
      const orderArr = gm.get(mxCellOrderKey) as Y.Array<string> | undefined;
      if (cellsMap && orderArr) {
        const ids = orderArr.toArray();
        const validIds: string[] = [];
        for (const cid of ids) {
          const c = cellsMap.get(cid) as Y.XmlElement | undefined;
          if (c && typeof c.getAttributes === 'function') {
            validIds.push(cid);
            attrs.set(cid, (c.getAttributes() as Record<string, string>) || {});
          } else if (c) {
            console.warn(`[y-mxgraph] cell ${cid} is not a valid Y.XmlElement:`, c);
          } else {
            console.warn(`[y-mxgraph] cell ${cid} in order but not in cellsMap, skipping`);
          }
        }
        currCellsOrder.set(did, validIds);
      } else {
        currCellsOrder.set(did, []);
      }
    } else {
      currCellsOrder.set(did, []);
    }
    cellAttrMap.set(did, attrs);
  }

  const insertedDiagramIdGlobal = new Set<string>();
  const insertedCellIdGlobal = new Set<string>();

  if (prevDiagramOrder) {
    const prevSet = new Set(prevDiagramOrder);
    const currSet = new Set(currDiagramOrder);

    const removed = prevDiagramOrder.filter(
      (id: string) => !currSet.has(id) && id,
    );
    if (removed.length) patch[DIFF_REMOVE] = removed;
    const removedDiagramSet = new Set(removed);

    const inserted = currDiagramOrder.filter(
      (id: string) => !prevSet.has(id) && id,
    );
    if (inserted.length) {
      patch[DIFF_INSERT] = patch[DIFF_INSERT] || [];
      for (const id of inserted) {
        const index = currDiagramOrder.indexOf(id);
        const previous = index <= 0 ? "" : currDiagramOrder[index - 1];
        const yDiagram = diagramsMap?.get(id) as YDiagram | undefined;
        if (!yDiagram) continue;
        const data = xmlSerializer({ diagram: serializeDiagram(yDiagram) });
        patch[DIFF_INSERT]!.push({ id, previous, data });
        insertedDiagramIdGlobal.add(id);
      }
    }

    const prevNeighbor = (order: string[], id: string) => {
      const i = order.indexOf(id);
      if (i === -1) return null; // 不在 order 中 → 未找到
      return i === 0 ? "" : order[i - 1];
    };
    const common = currDiagramOrder.filter((id) => prevSet.has(id) && id);
    for (const id of common) {
      const prevP = prevNeighbor(prevDiagramOrder, id);
      const currP = prevNeighbor(currDiagramOrder, id);
      if (prevP !== currP) {
        if (prevP && removedDiagramSet.has(prevP)) continue;
        const u = ensureUpdate(id);
        u.previous = currP;
      }
    }
  }

  const allDiagramIds = new Set<string>([
    ...(prevDiagramOrder || []),
    ...currDiagramOrder,
  ]);
  for (const did of allDiagramIds) {
    if (!did) continue;
    const prevCells = prevCellsOrder.get(did) || [];
    const currCells = currCellsOrder.get(did) || [];
    if (!prevCells.length && !currCells.length) continue;

    const prevSet = new Set(prevCells);
    const currSet = new Set(currCells);

    const removed = prevCells.filter((cid: string) => !currSet.has(cid) && cid);
    if (removed.length) {
      const cells = ensureCellSection(did);
      cells[DIFF_REMOVE] = (cells[DIFF_REMOVE] || []).concat(removed);
    }
    const removedCellSet = new Set(removed);

    const inserted = currCells.filter(
      (cid: string) => !prevSet.has(cid) && cid,
    );
    if (inserted.length) {
      const cells = ensureCellSection(did);
      cells[DIFF_INSERT] = cells[DIFF_INSERT] || [];
      const attrsMap = cellAttrMap.get(did) || new Map();
      for (const cid of inserted) {
        const attrs = attrsMap.get(cid) || {};
        const index = currCells.indexOf(cid);
        const previous = index <= 0 ? "" : currCells[index - 1];
        cells[DIFF_INSERT]!.push({
          ...(attrs as Record<string, string>),
          previous,
        });
        insertedCellIdGlobal.add(cid);
      }
    }

    const prevNeighbor = (order: string[], id: string) => {
      const i = order.indexOf(id);
      if (i === -1) return null;
      return i === 0 ? "" : order[i - 1];
    };
    const commonCells = currCells.filter((cid) => prevSet.has(cid) && cid);
    for (const cid of commonCells) {
      const prevP = prevNeighbor(prevCells, cid);
      const currP = prevNeighbor(currCells, cid);
      if (prevP !== currP) {
        if (prevP && removedCellSet.has(prevP)) continue;
        const cells = ensureCellSection(did);
        cells[DIFF_UPDATE] = cells[DIFF_UPDATE] || {};
        const cellUpdate = (cells[DIFF_UPDATE]![cid] =
          cells[DIFF_UPDATE]![cid] || {});
        (cellUpdate as Record<string, unknown>).previous = currP;
      }
    }
  }

  {
    const diagramSet = new Set<Y.Map<unknown>>(
      diagramsList as unknown as Y.Map<unknown>[],
    );
    for (const ev of events) {
      const target = (ev as unknown as { target?: unknown }).target;
      if (!(target instanceof Y.Map)) continue;
      if (!diagramSet.has(target)) continue;
      const changed: Set<string> =
        (ev as unknown as { keysChanged?: Set<string> }).keysChanged ||
        new Set();
      if (!changed?.has("name")) continue;
      const did = (target.get("id") as unknown as string) || "";
      if (!did || insertedDiagramIdGlobal.has(did)) continue;
      ensureUpdate(did).name = (target.get("name") as unknown as string) || "";
    }
  }

  if (!prevDiagramOrder) {
    for (const d of diagramsList) {
      const did = (d.get("id") as unknown as string) || "";
      if (!did) continue;
      ensureUpdate(did).name = (d.get("name") as unknown as string) || "";
    }
  }

  for (const ev of events) {
    const target = (ev as unknown as { target?: unknown }).target;
    if (!(target instanceof Y.Map)) continue;
    for (const d of diagramsList) {
      const gm = d.get(mxGraphModelKey) as YMxGraphModel | undefined;
      if (gm !== target) continue;
      const changed: Set<string> =
        (ev as unknown as { keysChanged?: Set<string> }).keysChanged ||
        new Set();
      if (!changed.has(backgroundKey)) continue;
      const did = (d.get("id") as unknown as string) || "";
      if (!did || insertedDiagramIdGlobal.has(did)) continue;
      const viewDiff = diffBackgroundViewPatch(
        prevDiagramBackground.get(did),
        getBackground(d),
      );
      if (viewDiff) ensureUpdate(did).view = viewDiff;
      break;
    }
  }

  for (const ev of events) {
    const target = (ev as unknown as { target?: unknown }).target;
    if (!(target instanceof Y.XmlElement)) continue;
    const el = target as Y.XmlElement;
    
    // 添加运行时类型检查，防止失效对象导致崩溃
    if (typeof el.getAttribute !== 'function' || typeof el.getAttributes !== 'function') {
      console.warn('[y-mxgraph] el is not a valid Y.XmlElement in event handler:', el);
      continue;
    }
    
    if (el.nodeName !== "mxCell") continue;

    const changed: Set<string> =
      (ev as unknown as { attributesChanged?: Set<string> })
        .attributesChanged ||
      (ev as unknown as { keysChanged?: Set<string> }).keysChanged ||
      new Set();
    if (!changed || (changed as Set<string>).size === 0) continue;

    const cellId = el.getAttribute("id");
    if (!cellId || insertedCellIdGlobal.has(cellId)) continue;

    const idsEntries = Array.from(currCellsOrder.entries());
    let diagramId = "";
    for (const [did, ids] of idsEntries) {
      if (ids.includes(cellId)) {
        diagramId = did;
        break;
      }
    }
    if (!diagramId) continue;

    const cellsPatch = ensureCellSection(diagramId);
    cellsPatch[DIFF_UPDATE] = cellsPatch[DIFF_UPDATE] || {};
    const cellUpdate = (cellsPatch[DIFF_UPDATE]![cellId] =
      cellsPatch[DIFF_UPDATE]![cellId] || {});
    for (const key of Array.from(changed)) {
      // getAttribute 返回 null 表示属性不存在，?? 只处理 null/undefined
      cellUpdate[key] = el.getAttribute(key) ?? "";
    }
  }

  if (prevDiagramOrder) {
    for (const [did, currBg] of currDiagramBackground.entries()) {
      if (insertedDiagramIdGlobal.has(did)) continue;
      const viewDiff = diffBackgroundViewPatch(
        prevDiagramBackground.get(did),
        currBg,
      );
      if (viewDiff) ensureUpdate(did).view = viewDiff;
    }

    for (const [did, currAttrsMap] of cellAttrMap.entries()) {
      const prevAttrsMap =
        prevCellsAttrs.get(did) || new Map<string, Record<string, string>>();
      const cellsPatch = ensureCellSection(did);
      cellsPatch[DIFF_UPDATE] = cellsPatch[DIFF_UPDATE] || {};
      const updateBucket = cellsPatch[DIFF_UPDATE]!;

      const currCells = currAttrsMap.keys();
      for (const cid of currCells) {
        if (insertedCellIdGlobal.has(cid)) continue;
        const prevAttrs = prevAttrsMap.get(cid) || {};
        const currAttrs = currAttrsMap.get(cid) || {};
        
        const keys = new Set<string>([
          ...Object.keys(prevAttrs),
          ...Object.keys(currAttrs),
        ]);
        const cellUpdate = (updateBucket[cid] = updateBucket[cid] || {});
        let changed = false;
        for (const k of keys) {
          const pv = prevAttrs[k] ?? "";
          const cv = currAttrs[k] ?? "";
          if (pv !== cv) {
            cellUpdate[k] = cv;
            changed = true;
          }
        }
        if (!changed) {
          if (Object.keys(cellUpdate).length === 0) {
            delete updateBucket[cid];
          }
        }
      }
    }
  }

  snap.diagramOrder = currDiagramOrder.slice();
  const newCellsOrder = new Map<string, string[]>();
  const newCellsAttrs = new Map<string, Map<string, Record<string, string>>>();
  for (const [did, arr] of currCellsOrder.entries()) {
    newCellsOrder.set(did, arr.slice());
  }
  for (const [did, attrsMap] of cellAttrMap.entries()) {
    const copy = new Map<string, Record<string, string>>();
    for (const [cid, attrs] of attrsMap.entries()) {
      copy.set(cid, { ...attrs });
    }
    newCellsAttrs.set(did, copy);
  }
  snap.cellsOrder = newCellsOrder;
  snap.cellAttrs = newCellsAttrs;
  snap.diagramBackground = new Map<string, string | undefined>();
  for (const [did, bg] of currDiagramBackground.entries()) {
    snap.diagramBackground.set(did, bg);
  }
  docSnapshots.set(doc, snap);

  return pruneEmptyPatch(patch);
}
