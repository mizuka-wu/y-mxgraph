/**
 * 绑定yDoc和drawioFile/mxGraphModel
 */
import * as Y from "yjs";
import { xml2doc } from "../transformer";
import { applyFilePatch, generatePatch, initDocSnapshot, ensureRootCells, syncCellsMapAndOrder } from "./patch";
import { LOCAL_ORIGIN } from "../helper/origin";
import { key as mxfileKey, type YMxFile } from "../models/mxfile";
import { bindCollaborator } from "./collaborator";
import { bindUndoManager } from "./undoManager";
import { type Awareness } from "y-protocols/awareness";

export const DEFAULT_USER_NAME_KEY = "user.name";
export const DEFAULT_USER_COLOR_KEY = "user.color";

/**
 * 绑定yDoc和drawioFile
 */
export function bindDrawioFile(
  file: any,
  options: {
    mouseMoveThrottle?: number;
    doc?: Y.Doc | null;
    awareness?: Awareness;
    undoManager?: Y.UndoManager;
    trackLocalUndoOnly?: boolean;
    cursor?:
      | boolean
      | {
          userNameKey?: string;
          userColorKey?: string;
        };
  } = {}
) {
  const doc = options?.doc || new Y.Doc();

  if (!doc.share.has(mxfileKey)) {
    xml2doc(file.data, doc);
  }

  // 初始化 doc 快照，避免首次事务（如撤销）时 prev 快照缺失导致空补丁
  initDocSnapshot(doc);

  // 确保根节点（cell 0/1）存在 + 同步 cellsMap 与 cellsOrder 一致性
  ensureRootCells(doc);
  syncCellsMapAndOrder(doc);

  const graph = file.getUi().editor.graph;
  const mxGraphModel = graph.model;
  const mouseMoveThrottle = options.mouseMoveThrottle || 100;
  // 防抖标记：应用远端补丁到 UI 时，暂时忽略本地 change 事件
  let suppressLocalApply = false;
  // 绑定本地的change到yDoc
  mxGraphModel.addListener("change", () => {
    if (suppressLocalApply) return;
    const patch = file.ui.diffPages(file.shadowPages, file.ui.pages);

    // 过滤掉对 cell 0/1 的删除操作（draw.io diffPages 黑盒可能产生）
    if (patch?.u) {
      for (const diagramId of Object.keys(patch.u)) {
        const update = patch.u[diagramId];
        if (update?.cells?.r) {
          update.cells.r = update.cells.r.filter(
            (cid: string) => cid !== "0" && cid !== "1"
          );
        }
      }
    }

    file.setShadowPages(file.ui.clonePages(file.ui.pages));
    applyFilePatch(doc, patch, { origin: LOCAL_ORIGIN });
    // 本地修改后确保根节点完整
    ensureRootCells(doc);
    console.log("local patch", patch);
  });

  // 监听remoteChange
  doc
    .getMap(mxfileKey)
    .observeDeep(
      (
        events: Y.YEvent<
          Y.XmlElement | Y.Array<string> | Y.Map<Y.XmlElement> | YMxFile
        >[],
        transaction: Y.Transaction
      ) => {
        // 仅跳过由本地 UI 写入到 Y.Doc 的事务（origin === LOCAL_ORIGIN）
        // 但仍需更新快照（generatePatch 内部会刷新 docSnapshots），
        // 以确保随后由 UndoManager 触发的撤销/重做可以生成非空 patch 并同步到 UI
        if (transaction.local && transaction.origin === (LOCAL_ORIGIN as any)) {
          generatePatch(events);
          return;
        }
        const patch = generatePatch(events);
        const isUndoManagerOrigin =
          !!transaction.origin &&
          ((transaction.origin instanceof (Y as any).UndoManager) ||
            ((transaction.origin as any)?.constructor?.name === "UndoManager"));
        console.log(isUndoManagerOrigin ? "undoManager patch" : "remote patch", patch);
        // 应用远端 patch 到 UI，期间屏蔽本地 change 回写
        suppressLocalApply = true;
        try {
          file.patch([patch]);
          // 重要：远端/撤销应用后，刷新 shadowPages，避免后续本地 diff 基于过期快照
          file.setShadowPages(file.ui.clonePages(file.ui.pages));
          // patch 应用后确保根节点完整
          ensureRootCells(doc);
        } finally {
          suppressLocalApply = false;
        }
      }
    );

  // undoManager劫持
  bindUndoManager(doc, file, {
    undoManager: options.undoManager,
    trackLocalUndoOnly: options.trackLocalUndoOnly,
  });

  // 协作（光标/选区/远端光标渲染）
  if (options.awareness) {
    bindCollaborator(file, {
      awareness: options.awareness,
      graph,
      cursor: options.cursor,
      mouseMoveThrottle,
    });
  }

  return doc;
}
