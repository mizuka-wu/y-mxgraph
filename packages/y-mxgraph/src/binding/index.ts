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

export interface BindDrawioFileResult {
  doc: Y.Doc;
  destroy: (deep?: boolean) => void;
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

  const mxListener = () => {
    if (suppressLocalApply) return;
    const patch = file.ui.diffPages(file.shadowPages, file.ui.pages);
    file.setShadowPages(file.ui.clonePages(file.ui.pages));
    applyFilePatch(doc, patch, { origin: LOCAL_ORIGIN });
  };
  mxGraphModel.addListener("change", mxListener);

  const docObserver = (
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
  };
  doc.getMap(mxfileKey).observeDeep(docObserver);

  let cleanupCollaborator: (() => void) | undefined;
  if (awareness) {
    cleanupCollaborator = bindCollaborator(file, {
      awareness,
      graph,
      cursor: cursor ?? true,
      mouseMoveThrottle,
    });
  }

  let cleanupUndoManager: (() => void) | undefined;
  if (undoManager) {
    cleanupUndoManager = bindUndoManager(doc, file, undoManager);
  }

  const destroy = (deep = false) => {
    mxGraphModel.removeListener("change", mxListener);
    doc.getMap(mxfileKey).unobserveDeep(docObserver);
    if (deep) {
      cleanupCollaborator?.();
      cleanupUndoManager?.();
    }
  };

  return { doc, destroy };
}
