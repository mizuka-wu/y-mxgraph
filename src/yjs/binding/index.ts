/**
 * 绑定yDoc和drawioFile/mxGraphModel
 */
import * as Y from "yjs";
import { xml2doc } from "../transformer";
import { applyFilePatch, generatePatch } from "./patch";
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

  const graph = file.getUi().editor.graph;
  const mxGraphModel = graph.model;
  const mouseMoveThrottle = options.mouseMoveThrottle || 100;
  // 防抖标记：应用远端补丁到 UI 时，暂时忽略本地 change 事件
  let suppressLocalApply = false;
  // 绑定本地的change到yDoc
  mxGraphModel.addListener("change", () => {
    if (suppressLocalApply) return;
    const patch = file.ui.diffPages(file.shadowPages, file.ui.pages);
    file.setShadowPages(file.ui.clonePages(file.ui.pages));
    applyFilePatch(doc, patch, { origin: LOCAL_ORIGIN });
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
        // 跳过本地事务（由本地 change 监听已经处理）
        if (transaction.local) return;
        const patch = generatePatch(events);
        console.log("remote patch", patch);
        // 应用远端 patch 到 UI，期间屏蔽本地 change 回写
        suppressLocalApply = true;
        try {
          file.patch([patch]);
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
