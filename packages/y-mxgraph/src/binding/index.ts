import * as Y from "yjs";
import { type Awareness } from "y-protocols/awareness";
import {
  generatePatch,
  applyFilePatch,
  initDocSnapshot,
} from "./patch";
import { xml2doc, doc2xml } from "../transformer";
import { bindUndoManager } from "./undoManager";
import { bindCollaborator } from "./collaborator";
import { LOCAL_ORIGIN } from "../helper/origin";

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

export function bindDrawioFile(
  file: any,
  options: BindDrawioFileOptions
) {
  const { doc, awareness, undoManager, mouseMoveThrottle, cursor } = options;

  const ui = file.getUi();
  const editor = ui.editor;
  const graph = editor.graph;
  const mxGraphModel = graph.model;

  let initialized = false;

  function initFromFile() {
    if (initialized) return;
    initialized = true;

    const xmlData = new XMLSerializer().serializeToString(
      file.ui.getXmlFileData()
    );

    doc.transact(() => {
      xml2doc(xmlData, doc);
    }, LOCAL_ORIGIN);

    initDocSnapshot(doc);
  }

  initFromFile();

  let applying = false;

  const docObserver = (
    events: Y.YEvent<any>[],
    transaction: Y.Transaction
  ) => {
    if (transaction.origin === LOCAL_ORIGIN) return;
    if (applying) return;

    const patch = generatePatch(events);
    applying = true;
    try {
      applyFilePatch(doc, patch, { origin: LOCAL_ORIGIN });
      const xml = doc2xml(doc);
      if (xml) {
        (file as any).mergeFile?.(xml);
      }
    } finally {
      applying = false;
    }
  };

  doc.on("update", (_update: Uint8Array, _origin: any, _doc: Y.Doc, tr: Y.Transaction) => {
    if (tr.origin === LOCAL_ORIGIN) return;
    if (applying) return;

    const xml = doc2xml(doc);
    if (xml) {
      applying = true;
      try {
        (file as any).mergeFile?.(xml);
      } finally {
        applying = false;
      }
    }
  });

  const mxListener = (_sender: any, _evt: any) => {
    if (applying) return;

    const xmlData = new XMLSerializer().serializeToString(
      file.ui.getXmlFileData()
    );

    applying = true;
    try {
      doc.transact(() => {
        const events = xml2doc(xmlData, doc);
        void events;
      }, LOCAL_ORIGIN);
    } finally {
      applying = false;
    }
  };

  mxGraphModel.addListener("change", mxListener);

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

  void docObserver;

  return {
    doc,
    destroy() {
      mxGraphModel.removeListener("change", mxListener);
    },
  };
}
