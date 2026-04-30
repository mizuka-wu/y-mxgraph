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
 *
 * 初始化流程对齐 y-prosemirror 等数据源：
 * - 绑定时不向 Y.Doc 写入初始数据
 * - 在第一次本地编辑时才初始化 Y.Doc
 * - 新客户端加入时，同步已有的远端数据到本地
 */
export class Binding {
  /** Y.Doc 实例，用于协同数据存储 */
  readonly doc: Y.Doc;
  /** mxGraph 的数据模型，用于监听本地变更 */
  private mxGraphModel: MxGraphModel;
  /** 本地变更抑制标志，防止循环同步 */
  private suppressLocalApply = false;
  /** 初始化标志，标记 Y.Doc 是否已初始化 */
  private docInitialized = false;
  /** mxGraph change 事件监听器 */
  private mxListener: () => void;
  /** Yjs 文档深度变更监听器 */
  private docObserver: (
    events: Y.YEvent<
      Y.XmlElement | Y.Array<string> | Y.Map<Y.XmlElement> | YMxFile
    >[],
    transaction: Y.Transaction,
  ) => void;
  /** Y.Doc update 事件监听器 */
  private docUpdateListener: (update: Uint8Array, origin: unknown) => void;
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

    // 检查 Y.Doc 是否已有数据
    const docHasData = doc.share.has(mxfileKey);
    this.docInitialized = docHasData;

    // 若 Y.Doc 已有数据（新客户端加入场景），立即同步到本地
    if (docHasData) {
      initDocSnapshot(doc, false);
      const fullPatch = generatePatch([], doc);
      if (Object.keys(fullPatch).length > 0) {
        this.suppressLocalApply = true;
        try {
          file.patch([fullPatch]);
          file.setShadowPages(file.ui.clonePages(file.ui.pages));
        } finally {
          this.suppressLocalApply = false;
        }
      }
    }

    // 本地变更监听
    this.mxListener = () => {
      if (this.suppressLocalApply) return;

      // 第一次编辑时初始化 Y.Doc
      if (!this.docInitialized) {
        doc.transact(() => {
          xml2doc(file.data, doc);
          initDocSnapshot(doc, false);
        });
        this.docInitialized = true;
      }

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
      // 标记已初始化（即使是远端数据到达）
      if (!this.docInitialized) {
        this.docInitialized = true;
      }

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

    // Y.Doc update 事件监听器 - 用于调试
    this.docUpdateListener = (update: Uint8Array, origin: unknown) => {
      const isLocal = origin === LOCAL_ORIGIN;
      const message = `[y-mxgraph] Y.Doc update (${update.length} bytes, origin: ${isLocal ? "local" : "remote"})`;
      console.log(message, {
        update,
        origin,
        docState: Array.from(Y.encodeStateAsUpdate(doc)),
      });
      // 同时输出到页面
      if (typeof window !== "undefined") {
        const logEl = document.getElementById("y-mxgraph-debug-log");
        if (logEl) {
          const timestamp = new Date().toLocaleTimeString();
          const line = document.createElement("div");
          line.style.cssText =
            "font-family: monospace; font-size: 12px; padding: 4px 8px; border-bottom: 1px solid #eee; word-break: break-all;";
          line.textContent = `${timestamp} ${message} (${update.length} bytes)`;
          logEl.appendChild(line);
          // 保持最近 100 条日志
          while (logEl.children.length > 100) {
            logEl.removeChild(logEl.firstChild!);
          }
        }
      }
    };
    doc.on("update", this.docUpdateListener);

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
    this.doc.off("update", this.docUpdateListener);
    if (deep) {
      this.cleanupCollaborator?.();
      this.cleanupUndoManager?.();
    }
  }

  /**
   * 生成标准化的 mxfile XML 模板，用于确保多端协同的数据起点一致。
   *
   * draw.io 每次新建 diagram 时默认生成随机 id（如 `DEMOabHTdChjKBf1yHdD`）。
   * 如果各客户端初始化时的 diagram id 不同，Y.Doc 中的数据与本地 file.data 无法对齐，
   * 会导致：
   * - 后进房间的客户端出现「孤立 page」（来自本地 XML，未写入 Y.Doc）
   * - patch 的 diff 无法正确匹配 diagram/cell id，协同失效
   *
   * 因此业务方应在初始化 draw.io 文件时，先用此方法生成统一起点的 XML，
   * 再注入到 draw.io 的 currentFile 中（详见文档「接入注意事项」）。
   *
   * @param diagramId - diagram 的固定 id，默认 `diagram-0`
   * @returns 最小化的 mxfile XML 字符串
   */
  static generateFileTemplate(diagramId = "diagram-0"): string {
    return `<mxfile pages="1">
  <diagram id="${diagramId}">
    <mxGraphModel>
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
  }

  /**
   * 静态工厂方法，创建 Binding 实例
   * 与 `new Binding()` 等价
   */
  static create(file: DrawioFile, options: BindDrawioFileOptions): Binding {
    return new Binding(file, options);
  }
}
