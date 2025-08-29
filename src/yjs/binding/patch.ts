/**
 * patch
 * @todo 完善diagram的patch（需要例子， 应该就是mxGraphModel的patch）
 * @todo insert的我没试过
 */
import { parse } from "../helper/xml";
import { parse as parseDiagram } from "../models/diagram";
import * as Y from "yjs";

const DIFF_INSERT = "i";
const DIFF_REMOVE = "r";
const DIFF_UPDATE = "u";

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
    const mxfile = doc.getXmlElement("mxfile");
    // 移除
    if (patch[DIFF_REMOVE]) {
      const diagrams = mxfile.querySelectorAll("diagram") as Y.XmlElement[];
      const indexList = patch[DIFF_REMOVE].map((id) => {
        return diagrams.findIndex((item) => item.getAttribute("id") === id);
      })
        .sort((a, b) => b - a)
        .filter((index) => index !== -1);

      indexList.forEach((index) => {
        mxfile.delete(index);
      });
    }

    if (patch[DIFF_INSERT]) {
      // 添加插入
      // 1) 现有 diagram 的 id -> index 映射（已在上方完成删除操作，这里是最新状态）
      const existingDiagrams = mxfile.querySelectorAll(
        "diagram"
      ) as Y.XmlElement[];
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
      for (const item of enriched) {
        const index = item.anchorIndex + 1; // -1 -> 0；k -> k+1（紧跟在前兄弟之后）
        mxfile.insert(index, [item.xmlElement]);
      }
    }

    if (patch[DIFF_UPDATE]) {
      // 更新
      Object.keys(patch[DIFF_UPDATE]).forEach((id) => {
        const diagram = (
          mxfile.querySelectorAll("diagram") as Y.XmlElement[]
        ).find(
          (item: Y.XmlElement) => item.getAttribute("id") === id
        ) as Y.XmlElement | null;
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
              Object.keys(update.cells[DIFF_UPDATE]).forEach((id) => {
                const cell = (
                  mxGraphModel.querySelectorAll("mxCell") as Y.XmlElement[]
                ).find((_cell) => _cell.getAttribute("id") === id);
                if (cell) {
                  Object.keys(update.cells![DIFF_UPDATE]![id]).forEach(
                    (key) => {
                      cell.setAttribute(
                        key,
                        update.cells![DIFF_UPDATE]![id][key]
                      );
                    }
                  );
                }
              });
            }
          }

          // 顺序更新
          if (Reflect.has(update, "previous")) {
            const previous = update.previous;
            const existingDiagrams = mxfile.querySelectorAll(
              "diagram"
            ) as Y.XmlElement[];

            const targetIndex = !previous
              ? 0
              : existingDiagrams.findIndex(
                  (item) => item.getAttribute("id") === previous
                ) + 1;

            const currentIndex = existingDiagrams.findIndex(
              (item) => item.getAttribute("id") === id
            );

            if (currentIndex === -1) {
              // 未定位到当前节点（理论上不应发生），退化为直接插入
              mxfile.insert(targetIndex, [diagram]);
            } else if (currentIndex !== targetIndex) {
              // 稳妥移动：先删后插，并在 currentIndex < targetIndex 时修正插入索引
              let insertIndex = targetIndex;
              if (currentIndex < insertIndex) insertIndex -= 1;
              mxfile.delete(currentIndex);
              mxfile.insert(insertIndex, [diagram]);
            }
          }
        }
      });
    }
  });
}
