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
} from "../models/diagram";
import { key as mxfileKey, type YMxFile } from "../models/mxfile";
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
      const diagrams = mxfile.get(
        diagramKey
      ) as unknown as Y.Array<Y.XmlElement>;
      const diagramsArray = diagrams.toArray();
      const indexList = patch[DIFF_REMOVE].map((id) => {
        return diagramsArray.findIndex(
          (item) => item.getAttribute("id") === id
        );
      })
        .sort((a, b) => b - a)
        .filter((index) => index !== -1);

      indexList.forEach((index) => {
        diagrams.delete(index);
      });
    }

    if (patch[DIFF_INSERT]) {
      // 添加插入
      // 1) 现有 diagram 的 id -> index 映射（已在上方完成删除操作，这里是最新状态）
      const existingDiagrams = mxfile.get(
        diagramKey
      ) as unknown as Y.Array<Y.XmlElement>;
      const existingIndex = new Map<string, number>();
      existingDiagrams.forEach((el, idx) => {
        const id = el.getAttribute("id");
        if (id) existingIndex.set(id, idx);
      });

      // 2) 解析待插入项，构造 xmlElement
      const inserts = patch[DIFF_INSERT].map((item, order) => {
        const object = parse(item.data) as any;
        const diagramObj = Array.isArray(object?.diagram)
          ? object.diagram[0]
          : object?.diagram;
        const xmlElement = parseDiagram(diagramObj);
        return {
          id: item.id,
          previous: item.previous || "",
          xmlElement,
          order, // 保留原始顺序用于稳定排序
        };
      });

      // 3) 为每个插入项计算锚点（anchorIndex）与深度（depth）
      const byId = new Map(inserts.map((i) => [i.id, i] as const));

      function computeAnchorAndDepth(node: { id: string; previous: string }): {
        anchorIndex: number;
        depth: number;
      } {
        // depth: 相对锚点的层级，previous 为空视为 depth = 1
        let depth = 1;
        let anchorIndex = -1; // -1 表示插入到最前面
        let prevId = node.previous;
        const seen = new Set<string>([node.id]);

        while (prevId) {
          if (seen.has(prevId)) {
            // 检测到环，降级：视为从最前插入，depth 重置
            depth = 1;
            anchorIndex = -1;
            break;
          }
          seen.add(prevId);

          const prevNode = byId.get(prevId);
          if (prevNode) {
            depth += 1;
            prevId = prevNode.previous;
            continue;
          }

          // 不在本次批次中，查找现有位置
          if (existingIndex.has(prevId)) {
            anchorIndex = existingIndex.get(prevId)!;
          } else {
            // 未找到对应现有节点，按最前处理
            anchorIndex = -1;
          }
          break;
        }

        return { anchorIndex, depth };
      }

      const enriched = inserts.map((i) => ({
        ...i,
        ...computeAnchorAndDepth(i),
      }));

      // 4) 排序规则：
      // - 先按锚点位置（anchorIndex）升序，使不同锚点间插入互不干扰
      // - 同锚点下，按 depth 降序（越深的先插入）
      // - 再按原始顺序的倒序，保证同层兄弟按“倒叙插入”以得到期望最终顺序
      enriched.sort((a, b) => {
        if (a.anchorIndex !== b.anchorIndex)
          return a.anchorIndex - b.anchorIndex;
        if (a.depth !== b.depth) return b.depth - a.depth;
        return b.order - a.order;
      });

      // 5) 倒叙插入：始终在 anchorIndex + 1 处插入；
      //    anchorIndex 为 -1 时，插入到最前（index 0）
      const diagrams = mxfile.get(
        diagramKey
      ) as unknown as Y.Array<Y.XmlElement>;
      for (const item of enriched) {
        const index = item.anchorIndex + 1; // -1 -> 0；k -> k+1（紧跟在前兄弟之后）
        diagrams.insert(index, [item.xmlElement]);
      }
    }

    if (patch[DIFF_UPDATE]) {
      // 更新
      Object.keys(patch[DIFF_UPDATE]).forEach((id) => {
        const diagrams = mxfile.get(
          diagramKey
        ) as unknown as Y.Array<Y.XmlElement>;
        const diagram = diagrams
          .toArray()
          .find((item) => item.getAttribute("id") === id);
        if (diagram) {
          const update = patch[DIFF_UPDATE]![id];

          if (update.cells) {
            const mxGraphModel = diagram.firstChild as Y.XmlElement;
            // 删除
            if (update.cells[DIFF_REMOVE]) {
              const existingCells = mxGraphModel.querySelectorAll(
                "mxCell"
              ) as Y.XmlElement[];
              const removeIndexList = update.cells[DIFF_REMOVE].map((id) =>
                existingCells.findIndex(
                  (item) => item.getAttribute("id") === id
                )
              )
                .filter((index) => index !== -1)
                .sort((a, b) => b - a);
              removeIndexList.forEach((index) => mxGraphModel.delete(index));
            }
            // 添加
            if (update.cells[DIFF_INSERT]) {
              mxGraphModel.insert(
                mxGraphModel.length,
                update.cells[DIFF_INSERT].map((item) => {
                  const xmlElement = new Y.XmlElement("mxCell");
                  Object.keys(item).forEach((key) => {
                    xmlElement.setAttribute(key, item[key]);
                  });
                  return xmlElement;
                })
              );
            }

            if (update.cells[DIFF_UPDATE]) {
              // 先应用属性更新（跳过 previous）
              Object.keys(update.cells[DIFF_UPDATE]).forEach((id) => {
                const cell = (
                  mxGraphModel.querySelectorAll("mxCell") as Y.XmlElement[]
                ).find((_cell) => _cell.getAttribute("id") === id);
                if (cell) {
                  Object.keys(update.cells![DIFF_UPDATE]![id]).forEach(
                    (key) => {
                      if (key === "previous") return; // 顺序更新另行处理
                      cell.setAttribute(
                        key,
                        update.cells![DIFF_UPDATE]![id][key]
                      );
                    }
                  );
                }
              });

              // // 再处理顺序更新（按照 previous 移动）
              // Object.keys(update.cells[DIFF_UPDATE]).forEach((id) => {
              //   const updateObj = update.cells![DIFF_UPDATE]![id];
              //   if (!Reflect.has(updateObj, "previous")) return;

              //   const previous = updateObj.previous as string;
              //   const existingCells = (mxGraphModel.querySelectorAll(
              //     "mxCell"
              //   ) || []) as Y.XmlElement[];

              //   const targetIndex = !previous
              //     ? 0
              //     : existingCells.findIndex(
              //         (item) => item.getAttribute("id") === previous
              //       ) + 1;

              //   const currentIndex = existingCells.findIndex(
              //     (item) => item.getAttribute("id") === id
              //   );

              //   if (currentIndex === -1) return;

              //   let insertIndex = targetIndex;
              //   if (currentIndex < insertIndex) insertIndex -= 1;

              //   const cell = existingCells[currentIndex];
              //   mxGraphModel.delete(currentIndex);
              //   mxGraphModel.insert(insertIndex, [cell]);
              // });
            }
          }

          // 顺序更新
          if (Reflect.has(update, "previous")) {
            const previous = update.previous;
            const existingDiagrams = (
              mxfile.get(diagramKey) as unknown as Y.Array<Y.XmlElement>
            ).toArray();

            const targetIndex = !previous
              ? 0
              : existingDiagrams.findIndex(
                  (item) => item.getAttribute("id") === previous
                ) + 1;

            const currentIndex = existingDiagrams.findIndex(
              (item) => item.getAttribute("id") === id
            );

            const diagrams = mxfile.get(
              diagramKey
            ) as unknown as Y.Array<Y.XmlElement>;
            if (currentIndex === -1) {
              // 未定位到当前节点（理论上不应发生），退化为直接插入
              diagrams.insert(targetIndex, [diagram.clone()]);
            } else if (currentIndex !== targetIndex) {
              // 稳妥移动：先删后插，并在 currentIndex < targetIndex 时修正插入索引
              let insertIndex = targetIndex;
              if (currentIndex < insertIndex) insertIndex -= 1;
              diagrams.delete(currentIndex);
              diagrams.insert(insertIndex, [diagram.clone()]);
            }
          }
        }
      });
    }
  });
}

export function generatePatch(
  events: Y.YEvent<Y.XmlElement | Y.Array<Y.XmlElement> | YMxFile>[]
): FilePatch {
  const patch: FilePatch = {};

  // 空事件保护
  if (!events || events.length === 0) return patch;

  // 取 doc 与 mxfile
  const doc = (events[0] as any)?.transaction?.doc as Y.Doc | undefined;
  if (!doc) return patch;
  const mxfile = doc.getMap(mxfileKey) as YMxFile;
  const diagramsArr = mxfile.get(
    diagramKey
  ) as unknown as Y.Array<Y.XmlElement>;

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
  const diagramsList = diagramsArr.toArray();
  const currDiagramOrder = diagramsList.map((d) => d.getAttribute("id") || "");
  const currCellsOrder = new Map<string, string[]>();
  const cellAttrMap = new Map<string, Map<string, Record<string, string>>>();

  for (const d of diagramsList) {
    const did = d.getAttribute("id") || "";
    const gm = d.firstChild as Y.XmlElement;
    const cells = (gm?.querySelectorAll("mxCell") || []) as Y.XmlElement[];
    const ids = cells.map((c) => c.getAttribute("id") || "");
    currCellsOrder.set(did, ids);
    const attrs = new Map<string, Record<string, string>>();
    for (const c of cells)
      attrs.set(
        c.getAttribute("id") || "",
        (c.getAttributes() as Record<string, string>) || {}
      );
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
        const diagramEl = diagramsList.find(
          (d) => (d.getAttribute("id") || "") === id
        )!;
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

    // 定位所属 diagram
    let diagramId = "";
    for (const d of diagramsList) {
      const gm = d.firstChild as Y.XmlElement;
      const cells = (gm.querySelectorAll("mxCell") || []) as Y.XmlElement[];
      if (cells.includes(el)) {
        diagramId = d.getAttribute("id") || "";
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
