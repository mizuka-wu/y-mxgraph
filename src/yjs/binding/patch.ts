/**
 * patch
 * @todo 完善diagram的patch（需要例子， 应该就是mxGraphModel的patch）
 * @todo insert的我没试过
 */
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
  mxCellOrderKey,
  key as mxGraphModelKey,
  type YMxGraphModel,
} from "../models/mxGraphModel";
import { key as mxCellKey } from "../models/mxCell";
import * as Y from "yjs";

const DIFF_INSERT = "i";
const DIFF_REMOVE = "r";
const DIFF_UPDATE = "u";

// 轻量快照按文档维度存储，避免全局共享与泄漏
type DocSnapshot = {
  diagramOrder: string[] | null;
  cellsOrder: Map<string, string[]>;
};
const docSnapshots = new WeakMap<Y.Doc, DocSnapshot>();

// 仅使用根级单实例 mxGraphModel（{ [mxCellKey], [mxCellOrderKey] }）

export interface DiagramInsert {
  data: string;
  id: string;
  previous: string;
}

export interface FilePatch {
  [DIFF_REMOVE]?: string[];
  [DIFF_INSERT]?: DiagramInsert[];
  [DIFF_UPDATE]?: {
    [key: string]: {
      previous?: string;
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

export function applyFilePatch(doc: Y.Doc, patch: FilePatch) {
  doc.transact(() => {
    const mxfile = doc.getMap(mxfileKey) as YMxFile;
    // 移除
    if (patch[DIFF_REMOVE]) {
      const diagramsMap = mxfile.get(diagramKey) as unknown as Y.Map<YDiagram>;
      const orderArr = mxfile.get(
        diagramOrderKey
      ) as unknown as Y.Array<string>;
      const orderList = orderArr.toArray();

      const removeIds = patch[DIFF_REMOVE];
      if (removeIds && removeIds.length) {
        const indexList = removeIds
          .map((id) => orderList.indexOf(id))
          .filter((i) => i !== -1)
          .sort((a, b) => b - a);

        // 先从顺序数组删除
        indexList.forEach((idx) => orderArr.delete(idx));
        // 再从 map 删除内容
        removeIds.forEach((id) => diagramsMap.delete(id));
      }
    }

    if (patch[DIFF_INSERT]) {
      // 添加插入（Map 存内容，Array 维护顺序）
      // 1) 现有 diagram 的 id -> index 映射（已在上方完成删除操作，这里是最新状态）
      const diagramsMap = mxfile.get(diagramKey) as unknown as Y.Map<YDiagram>;
      const orderArr = mxfile.get(
        diagramOrderKey
      ) as unknown as Y.Array<string>;
      const existingIds = orderArr.toArray();
      const existingIndex = new Map<string, number>();
      existingIds.forEach((id, idx) => existingIndex.set(id, idx));

      // 2) 解析待插入项，构造 xmlElement
      const inserts = patch[DIFF_INSERT].map((item, order) => {
        const object = parse(item.data) as any;
        const diagramObj = Array.isArray(object?.diagram)
          ? object.diagram[0]
          : object?.diagram;
        const diagramElement = parseDiagram(diagramObj);
        return {
          id: item.id,
          previous: item.previous || "",
          diagramElement,
          order, // 保留原始顺序用于稳定排序
        };
      });

      // 3) 为每个插入项计算锚点（anchorId：最近已存在的前驱）与深度（depth）
      const byId = new Map(inserts.map((i) => [i.id, i] as const));
      function computeAnchor(node: { id: string; previous: string }): {
        anchorId: string; // 为空表示插到最前
        depth: number;
      } {
        let depth = 1;
        let anchorId = "";
        let prevId = node.previous;
        const seen = new Set<string>([node.id]);
        while (prevId) {
          if (seen.has(prevId)) {
            // 检测到环，降级
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
      }

      const enriched = inserts.map((i) => ({ ...i, ...computeAnchor(i) }));

      // 4) 排序规则：
      // - 先按锚点在当前序列的索引升序（不同锚点相对独立）
      // - 同锚点下，按 depth 降序（越深的先插入）
      // - 再按原始顺序的倒序，保证同层兄弟按“倒叙插入”以得到期望最终顺序
      enriched.sort((a, b) => {
        const aIdx = a.anchorId ? existingIndex.get(a.anchorId)! : -1;
        const bIdx = b.anchorId ? existingIndex.get(b.anchorId)! : -1;
        if (aIdx !== bIdx) return aIdx - bIdx;
        if (a.depth !== b.depth) return b.depth - a.depth;
        return b.order - a.order;
      });

      // 5) 插入：
      // - 先写入 Map 内容
      // - 再根据“当前”顺序数组查找锚点位置进行插入，避免前序插入导致的索引漂移
      for (const item of enriched) {
        // 内容落盘
        diagramsMap.set(item.id, item.diagramElement);
        // 顺序插入
        const currentIds = orderArr.toArray();
        const anchorPos = item.anchorId
          ? currentIds.indexOf(item.anchorId)
          : -1;
        const index = anchorPos + 1; // -1 -> 0；k -> k+1
        orderArr.insert(index, [item.id]);
      }
    }

    if (patch[DIFF_UPDATE]) {
      // 更新
      Object.keys(patch[DIFF_UPDATE]).forEach((id) => {
        const diagramsMap = mxfile.get(
          diagramKey
        ) as unknown as Y.Map<YDiagram>;
        const diagram = diagramsMap.get(id) as YDiagram | undefined;
        if (diagram) {
          const update = patch[DIFF_UPDATE]![id];

          if (update.cells) {
            // diagram 直接持有 mxGraphModel（Map 结构）作为 firstChild
            const yMxGraphModel = diagram.get(mxGraphModelKey) as
              | YMxGraphModel
              | undefined;
            if (!yMxGraphModel) return;
            const cellsMap = yMxGraphModel.get(mxCellKey) as
              | Y.Map<Y.XmlElement>
              | undefined;
            const orderArr = yMxGraphModel.get(mxCellOrderKey) as
              | Y.Array<string>
              | undefined;
            if (!cellsMap || !orderArr) return;

            // 删除
            if (update.cells[DIFF_REMOVE] && update.cells[DIFF_REMOVE].length) {
              const orderIds = orderArr.toArray();
              const removeIndexList = update.cells[DIFF_REMOVE].map((cid) =>
                orderIds.indexOf(cid)
              )
                .filter((i) => i !== -1)
                .sort((a, b) => b - a);
              removeIndexList.forEach((idx) => orderArr.delete(idx));
              update.cells[DIFF_REMOVE].forEach((cid) => cellsMap.delete(cid));
            }

            // 添加
            if (update.cells[DIFF_INSERT] && update.cells[DIFF_INSERT].length) {
              for (const item of update.cells[DIFF_INSERT]) {
                const id = (item as any)["id"] as string | undefined;
                if (!id) continue;
                const xmlElement = new Y.XmlElement("mxCell");
                Object.keys(item).forEach((key) =>
                  xmlElement.setAttribute(key, item[key])
                );
                cellsMap.set(id, xmlElement);
                const len = orderArr.toArray().length;
                orderArr.insert(len, [id]);
              }
            }

            if (update.cells[DIFF_UPDATE]) {
              // 先应用属性更新（跳过 previous）
              Object.keys(update.cells[DIFF_UPDATE]).forEach((cid) => {
                const updateObj = update.cells![DIFF_UPDATE]![cid];
                const cell = cellsMap.get(cid) as Y.XmlElement | undefined;
                if (cell) {
                  Object.keys(updateObj).forEach((k) => {
                    if (k === "previous") return;
                    cell.setAttribute(k, updateObj[k]);
                  });
                }
              });

              // 再处理顺序更新（按照 previous 移动/插入）
              Object.keys(update.cells[DIFF_UPDATE]).forEach((cellId) => {
                const updateObj = update.cells![DIFF_UPDATE]![cellId];
                if (!Reflect.has(updateObj, "previous")) return;
                const previous = (updateObj as any).previous as string;

                const currentIds = orderArr.toArray();
                const targetIndex = !previous
                  ? 0
                  : currentIds.indexOf(previous) + 1;
                const currentIndex = currentIds.indexOf(cellId);
                if (currentIndex === -1) {
                  // 不存在则按顺序插入新 cell
                  const newCell = new Y.XmlElement("mxCell");
                  newCell.setAttribute("id", cellId);
                  Object.keys(updateObj).forEach((k) => {
                    if (k === "previous") return;
                    newCell.setAttribute(k, (updateObj as any)[k]);
                  });
                  cellsMap.set(cellId, newCell);
                  orderArr.insert(targetIndex, [cellId]);
                  return;
                }
                if (currentIndex !== targetIndex) {
                  let insertIndex = targetIndex;
                  if (currentIndex < insertIndex) insertIndex -= 1;
                  orderArr.delete(currentIndex);
                  orderArr.insert(insertIndex, [cellId]);
                }
              });
            }
          }

          // 顺序更新
          if (Reflect.has(update, "previous")) {
            const previous = update.previous;
            const orderArr = mxfile.get(
              diagramOrderKey
            ) as unknown as Y.Array<string>;
            const currentIds = orderArr.toArray();

            const targetIndex = !previous
              ? 0
              : currentIds.indexOf(previous) + 1;

            const currentIndex = currentIds.indexOf(id);

            if (currentIndex === -1) {
              // 未定位到当前节点（理论上不应发生），退化为直接插入 id
              orderArr.insert(targetIndex, [id]);
            } else if (currentIndex !== targetIndex) {
              // 稳妥移动：先删后插，并在 currentIndex < targetIndex 时修正插入索引
              let insertIndex = targetIndex;
              if (currentIndex < insertIndex) insertIndex -= 1;
              orderArr.delete(currentIndex);
              orderArr.insert(insertIndex, [id]);
            }
          }
        }
      });
    }
  });
}

export function generatePatch(
  events: Y.YEvent<
    Y.XmlElement | Y.Array<string> | Y.Map<Y.XmlElement> | YMxFile
  >[]
): FilePatch {
  const patch: FilePatch = {};

  // 空事件保护
  if (!events || events.length === 0) return patch;

  // 取 doc 与 mxfile
  const doc = (events[0] as any)?.transaction?.doc as Y.Doc | undefined;
  if (!doc) return patch;
  const mxfile = doc.getMap(mxfileKey) as YMxFile;
  const diagramsMap = mxfile.get(diagramKey) as unknown as Y.Map<Y.XmlElement>;
  const orderArr = mxfile.get(diagramOrderKey) as unknown as Y.Array<string>;

  // 读取/初始化当前文档的快照容器
  let snap = docSnapshots.get(doc);
  if (!snap) {
    snap = { diagramOrder: null, cellsOrder: new Map<string, string[]>() };
    docSnapshots.set(doc, snap);
  }
  const prevDiagramOrder = snap.diagramOrder;
  const prevCellsOrder = snap.cellsOrder;

  // 工具函数
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

  // 当前快照（变更后）
  const currDiagramOrder = orderArr.toArray();
  const diagramsList = currDiagramOrder
    .map((id) => diagramsMap.get(id) as Y.XmlElement | undefined)
    .filter((d): d is Y.XmlElement => !!d);
  const currCellsOrder = new Map<string, string[]>();
  const cellAttrMap = new Map<string, Map<string, Record<string, string>>>();

  for (const d of diagramsList) {
    const did = d.getAttribute("id") || "";
    const attrs = new Map<string, Record<string, string>>();
    const gm = (d as any).firstChild as YMxGraphModel | undefined;
    if (gm) {
      const cellsMap = gm.get(mxCellKey) as Y.Map<Y.XmlElement> | undefined;
      const orderArr = gm.get(mxCellOrderKey) as Y.Array<string> | undefined;
      if (cellsMap && orderArr) {
        const ids = orderArr.toArray();
        currCellsOrder.set(did, ids);
        for (const cid of ids) {
          const c = cellsMap.get(cid) as Y.XmlElement | undefined;
          if (c)
            attrs.set(cid, (c.getAttributes() as Record<string, string>) || {});
        }
      } else {
        currCellsOrder.set(did, []);
      }
    } else {
      currCellsOrder.set(did, []);
    }
    cellAttrMap.set(did, attrs);
  }

  // 收集新增的 cellId（用于避免对新插入的 cell 再追加属性更新）
  const insertedCellIdGlobal = new Set<string>();

  // 1) 基于快照：diagram 层 删除 / 插入 / 重排(previous)
  if (prevDiagramOrder) {
    const prevSet = new Set(prevDiagramOrder);
    const currSet = new Set(currDiagramOrder);

    // 删除
    const removed = prevDiagramOrder.filter(
      (id: string) => !currSet.has(id) && id
    );
    if (removed.length) patch[DIFF_REMOVE] = removed;

    // 插入
    const inserted = currDiagramOrder.filter(
      (id: string) => !prevSet.has(id) && id
    );
    if (inserted.length) {
      patch[DIFF_INSERT] = patch[DIFF_INSERT] || [];
      for (const id of inserted) {
        const index = currDiagramOrder.indexOf(id);
        const previous = index <= 0 ? "" : currDiagramOrder[index - 1];
        const diagramEl = diagramsMap.get(id) as Y.XmlElement | undefined;
        if (!diagramEl) continue;
        const data = xmlSerializer({ diagram: serializeDiagram(diagramEl) });
        patch[DIFF_INSERT]!.push({ id, previous, data });
      }
    }

    // 重排：previous 变化
    const prevNeighbor = (order: string[], id: string) => {
      const i = order.indexOf(id);
      return i <= 0 ? "" : order[i - 1];
    };
    const common = currDiagramOrder.filter((id) => prevSet.has(id) && id);
    for (const id of common) {
      const prevP = prevNeighbor(prevDiagramOrder, id);
      const currP = prevNeighbor(currDiagramOrder, id);
      if (prevP !== currP) {
        const u = ensureUpdate(id);
        u.previous = currP;
      }
    }
  }

  // 2) 基于快照：cells 删除 / 插入 / 重排
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

    // 删除
    const removed = prevCells.filter((cid: string) => !currSet.has(cid) && cid);
    if (removed.length) {
      const cells = ensureCellSection(did);
      cells[DIFF_REMOVE] = (cells[DIFF_REMOVE] || []).concat(removed);
    }

    // 插入
    const inserted = currCells.filter(
      (cid: string) => !prevSet.has(cid) && cid
    );
    if (inserted.length) {
      const cells = ensureCellSection(did);
      cells[DIFF_INSERT] = cells[DIFF_INSERT] || [];
      const attrsMap = cellAttrMap.get(did) || new Map();
      for (const cid of inserted) {
        const attrs = attrsMap.get(cid) || {};
        cells[DIFF_INSERT]!.push({ ...(attrs as Record<string, string>) });
        insertedCellIdGlobal.add(cid);
      }
    }

    // 重排（previous 变化，仅针对既存 cell）
    const prevNeighbor = (order: string[], id: string) => {
      const i = order.indexOf(id);
      return i <= 0 ? "" : order[i - 1];
    };
    const commonCells = currCells.filter((cid) => prevSet.has(cid) && cid);
    for (const cid of commonCells) {
      const prevP = prevNeighbor(prevCells, cid);
      const currP = prevNeighbor(currCells, cid);
      if (prevP !== currP) {
        const cells = ensureCellSection(did);
        cells[DIFF_UPDATE] = cells[DIFF_UPDATE] || {};
        const cellUpdate = (cells[DIFF_UPDATE]![cid] =
          cells[DIFF_UPDATE]![cid] || {});
        // 只写入顺序字段，属性更新仍由事件层收集
        (cellUpdate as any).previous = currP;
      }
    }
  }

  // 3) 事件驱动：mxCell 属性更新（跳过刚插入的 cell）
  for (const ev of events) {
    const target: any = (ev as any).target;
    if (!(target instanceof Y.XmlElement)) continue;
    const el = target as Y.XmlElement;
    if (el.nodeName !== "mxCell") continue;

    const changed: Set<string> =
      (ev as any).attributesChanged || (ev as any).keysChanged || new Set();
    if (!changed || (changed as Set<string>).size === 0) continue;

    const cellId = el.getAttribute("id");
    if (!cellId || insertedCellIdGlobal.has(cellId)) continue;

    // 定位所属 diagram：基于快照的顺序表判断
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
      cellUpdate[key] = el.getAttribute(key) || "";
    }
  }

  // 4) 更新当前文档的快照（供下次对比）
  snap.diagramOrder = currDiagramOrder.slice();
  const newCellsOrder = new Map<string, string[]>();
  for (const [did, arr] of currCellsOrder.entries()) {
    newCellsOrder.set(did, arr.slice());
  }
  snap.cellsOrder = newCellsOrder;
  docSnapshots.set(doc, snap);

  return patch;
}
