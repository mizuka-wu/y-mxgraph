import * as Y from "yjs";
import { type Awareness } from "y-protocols/awareness";
import { applyFilePatch, generatePatch, initDocSnapshot } from "./patch";
import { xml2doc } from "../transformer";
import { bindUndoManager } from "./undoManager";
import { bindCollaborator } from "./collaborator";
import { LOCAL_ORIGIN } from "../helper/origin";
import { key as mxfileKey, type YMxFile } from "../models/mxfile";

export interface BindDrawioFileOptions {
  doc: Y.Doc;
  awareness?: Awareness;
  undoManager?: Y.UndoManager;
  mouseMoveThrottle?: number;
  cursor?:
    | boolean
    | {
        userNameKey?: string;
        userColorKey?: string;
      };
}

export function bindDrawioFile(file: any, options: BindDrawioFileOptions) {
  const { doc, awareness, undoManager, mouseMoveThrottle, cursor } = options;

  const graph = file.getUi().editor.graph;
  const mxGraphModel = graph.model;

  if (!doc.share.has(mxfileKey)) {
    xml2doc(file.data, doc);
  }

  initDocSnapshot(doc);

  let suppressLocalApply = false;

  mxGraphModel.addListener("change", () => {
    if (suppressLocalApply) return;
    const patch = file.ui.diffPages(file.shadowPages, file.ui.pages);
    file.setShadowPages(file.ui.clonePages(file.ui.pages));
    applyFilePatch(doc, patch, { origin: LOCAL_ORIGIN });
  });

  doc
    .getMap(mxfileKey)
    .observeDeep(
      (
        events: Y.YEvent<
          Y.XmlElement | Y.Array<string> | Y.Map<Y.XmlElement> | YMxFile
        >[],
        transaction: Y.Transaction,
      ) => {
        if (transaction.local && transaction.origin === (LOCAL_ORIGIN as any)) {
          generatePatch(events);
          return;
        }
        const patch = generatePatch(events);
        suppressLocalApply = true;
        try {
          file.patch([patch]);
          file.setShadowPages(file.ui.clonePages(file.ui.pages));
        } finally {
          suppressLocalApply = false;
        }
      },
    );

  if (undoManager) {
    bindUndoManager(doc, file, undoManager);
  }

  if (awareness) {
    bindCollaborator(file, {
      awareness,
      graph,
      cursor: cursor ?? true,
      mouseMoveThrottle,
    });
  }

  return doc;
}
