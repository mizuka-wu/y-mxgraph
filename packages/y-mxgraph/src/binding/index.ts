import * as Y from "yjs";
import { type Awareness } from "y-protocols/awareness";
import { applyFilePatch, generatePatch, initDocSnapshot } from "./patch";
import { xml2doc } from "../transformer";
import { bindUndoManager } from "./undoManager";
import { bindCollaborator } from "./collaborator";
import { LOCAL_ORIGIN } from "../helper/origin";
import { key as mxfileKey, type YMxFile } from "../models/mxfile";
import type { DrawioFile, MxGraphModel } from "../types/drawio";

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

/**
 * Y-MXGraph 绑定类，管理 draw.io 文件与 Y.Doc 的双向同步
 */
export class Binding {
  /** Y.Doc 实例，用于协同数据存储 */
  readonly doc: Y.Doc;
  /** mxGraph 的数据模型，用于监听本地变更 */
  private mxGraphModel: MxGraphModel;
  /** 本地变更抑制标志，防止循环同步 */
  private suppressLocalApply = false;
  /** mxGraph change 事件监听器 */
  private mxListener: () => void;
  /** Yjs 文档深度变更监听器 */
  private docObserver: (
    events: Y.YEvent<
      Y.XmlElement | Y.Array<string> | Y.Map<Y.XmlElement> | YMxFile
    >[],
    transaction: Y.Transaction,
  ) => void;
  /** 协作功能清理函数（awareness 光标/选区） */
  private cleanupCollaborator?: () => void;
  /** UndoManager 绑定清理函数 */
  private cleanupUndoManager?: () => void;

  constructor(file: DrawioFile, options: BindDrawioFileOptions) {
    const { doc, awareness, undoManager, mouseMoveThrottle, cursor } = options;

    this.doc = doc;

    const ui = file.getUi();
    const graph = ui.editor.graph;
    this.mxGraphModel = graph.model;

    if (!doc.share.has(mxfileKey)) {
      xml2doc(file.data, doc);
    }

    initDocSnapshot(doc);

    // 本地变更监听
    this.mxListener = () => {
      if (this.suppressLocalApply) return;
      const patch = file.ui.diffPages(
        file.shadowPages,
        file.ui.pages,
      ) as import("./patch").FilePatch;
      file.setShadowPages(file.ui.clonePages(file.ui.pages));
      applyFilePatch(doc, patch, { origin: LOCAL_ORIGIN });
    };
    this.mxGraphModel.addListener("change", this.mxListener);

    // 远端变更监听
    this.docObserver = (
      events: Y.YEvent<
        Y.XmlElement | Y.Array<string> | Y.Map<Y.XmlElement> | YMxFile
      >[],
      transaction: Y.Transaction,
    ) => {
      if (transaction.local && transaction.origin === LOCAL_ORIGIN) {
        generatePatch(events);
        return;
      }
      const patch = generatePatch(events);
      this.suppressLocalApply = true;
      try {
        file.patch([patch]);
        file.setShadowPages(file.ui.clonePages(file.ui.pages));
      } finally {
        this.suppressLocalApply = false;
      }
    };
    doc.getMap(mxfileKey).observeDeep(this.docObserver);

    // 协作功能
    if (awareness) {
      this.cleanupCollaborator = bindCollaborator(file, {
        awareness,
        graph,
        cursor: cursor ?? true,
        mouseMoveThrottle,
      });
    }

    // UndoManager
    if (undoManager) {
      this.cleanupUndoManager = bindUndoManager(doc, file, undoManager);
    }
  }

  /**
   * 销毁绑定，解除所有监听器
   * @param deep - 是否深度清理（包括 awareness/undoManager），默认 false
   */
  destroy(deep = false): void {
    this.mxGraphModel.removeListener("change", this.mxListener);
    this.doc.getMap(mxfileKey).unobserveDeep(this.docObserver);
    if (deep) {
      this.cleanupCollaborator?.();
      this.cleanupUndoManager?.();
    }
  }

  /**
   * 静态工厂方法，创建 Binding 实例
   * 与 `new Binding()` 等价
   */
  static create(file: DrawioFile, options: BindDrawioFileOptions): Binding {
    return new Binding(file, options);
  }
}
