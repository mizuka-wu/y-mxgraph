import * as Y from "yjs";
import { type Awareness } from "y-protocols/awareness";
import { applyFilePatch, generatePatch, initDocSnapshot } from "./patch";
import { xml2ydoc, ydoc2xml } from "../transform";
import { bindUndoManager } from "./undoManager";
import { bindCollaborator } from "./collaborator";
import { LOCAL_ORIGIN } from "../helper/origin";
import {
  key as mxfileKey,
  diagramOrderKey,
  type YMxFile,
} from "../models/mxfile";
import {
  key as diagramKey,
  parse as parseDiagram,
  type YDiagram,
} from "../models/diagram";
import {
  key as mxGraphModelKey,
  mxCellOrderKey,
  type YMxGraphModel,
} from "../models/mxGraphModel";
import { key as mxCellKey } from "../models/mxCell";
import { parse as parseXml } from "../helper/xml";
import type { DrawioFile, DrawioUi, MxGraphModel } from "../types/drawio";
import { ConsistencyChecker, type DriftEvent, type DriftHandler } from "./consistency";
export type { DriftEvent, DriftHandler } from "./consistency";

/**
 * 控制 Binding 构造时 file 与 Y.Doc 的初始内容对齐策略。
 * - `replace`      : doc 非空则用 doc 覆盖 file；doc 为空则保留 file 现有数据（默认）。
 * - `merge-remote` : 按 diagram id 取并集，同 id 冲突时以 doc 为准（远端权威）。
 * - `merge-client` : 按 diagram id 取并集，同 id 冲突时以 file 为准（本地权威，覆盖到 doc）。
 */
export type InitialContentStrategy =
  | "replace"
  | "merge-remote"
  | "merge-client";

export interface BindDrawioFileOptions {
  doc: Y.Doc;
  awareness?: Awareness;
  /**
   * UndoManager 实例，用于支持 undo/redo。
   * - 传入 Y.UndoManager 实例：绑定到 draw.io 的 undoManager
   * - 传入 false：跳过绑定（用于 iframe-bridge 等外部接管场景）
   * - 不传或 undefined：不绑定 undoManager
   */
  undoManager?: Y.UndoManager | false;
  mouseMoveThrottle?: number;
  cursor?:
    | boolean
    | {
        userNameKey?: string;
        userColorKey?: string;
        userAccountKey?: string;
      };
  /**
   * 初始内容对齐策略，默认 `replace`。详见 {@link InitialContentStrategy}。
   */
  initialContent?: InitialContentStrategy;
  /**
   * 自定义把 XML 应用到 file 的方式。默认实现只调用
   * `file.ui.setFileData(xml)`（刷新 UI / 重建 pages），
   * **不会**调用 `file.setData(xml)`，以避免把 file 标记为「已修改」
   * 触发 draw.io 的 "Save diagrams to:" 存储选择对话框。
   *
   * 若业务方确实需要同步 `file.data`（如自定义 CollabFile 或依赖
   * `file.save()`），可提供自定义实现。
   */
  applyFileData?: (file: DrawioFile, xml: string) => void;
  /**
   * 是否禁用 draw.io 的 beforeUnload 弹窗，默认 `true`。
   *
   * Yjs 接管持久化后，draw.io 的原生保存状态不再有意义。
   * 但 draw.io 内部会在特定条件下（如 LocalFile 无 fileHandle、
   * 图表非空等）弹出 "All changes will be lost" 或
   * "Ensure your data has been saved" 提示。
   *
   * 设为 `true` 可彻底禁用这些弹窗，适合纯 Yjs 协作场景。
   * 若需要保留原生行为（如使用 File System Access API），设为 `false`。
   */
  disableBeforeUnload?: boolean;
  /**
   * 转换本地 patch，在同步到 Y.Doc 前修改或过滤变更。
   *
   * - 返回原始 patch 或 `undefined`：不做过滤，直接同步
   * - 返回修改后的 `FilePatch`：使用修改后的 patch 同步
   * - 返回 `null`：跳过本次同步，不写入 Y.Doc
   *
   * 适用于异步资源处理场景（如图片上传），可精确过滤包含中间态的 cell 变更。
   */
  transformPatch?: (patch: import("./patch").FilePatch) => import("./patch").FilePatch | null | undefined;
  /**
   * 一致性检查间隔（毫秒）。设为 0 或不传则禁用定期检查。
   * 检测到 ydoc 与 file XML 不一致时会触发 drift 事件。
   */
  consistencyCheckInterval?: number;
  /**
   * drift 事件回调。当一致性检测发现 ydoc 与 file 不一致时触发。
   */
  onDrift?: DriftHandler;
  /**
   * patch 后检查顺序一致性，不一致时自动 forceSync。
   * 默认 `false`。设为 `true` 可启用保底机制。
   */
  syncOnOrderMismatch?: boolean;
}

/**
 * 默认只调用 `file.ui.setFileData(xml)` 重建 UI（pages / mxGraphModel），
 * 有意跳过 `file.setData(xml)`：在 Yjs 驱动的协作场景下，`file.data`
 * 不是真实状态来源；调用 `setData` 会把文件标记为「已修改」，
 * draw.io 在没有配置存储后端时会弹出 "Save diagrams to:" 存储选择对话框。
 *
 * 若业务方确实需要同步 `file.data`（例如需要 `file.save()` 或依赖
 * `file.data` 的快照逻辑），可通过 `applyFileData` 选项覆写：
 *
 * ```ts
 * new Binding(file, {
 *   doc,
 *   applyFileData: (f, xml) => {
 *     f.ui.setFileData(xml);
 *     f.setData(xml);
 *   },
 * });
 * ```
 */
const defaultApplyFileData = (file: DrawioFile, xml: string) => {
  file.ui.setFileData(xml);
};

/**
 * 把 file XML 中的 diagram 合并进 Y.Doc。仅在 merge 策略 + doc 已有数据时调用。
 * @returns 是否成功合并；解析失败时返回 false 由调用方回退到 replace。
 */
function mergeFileIntoDoc(
  doc: Y.Doc,
  fileXml: string,
  strategy: "merge-remote" | "merge-client",
): boolean {
  let parsed: unknown;
  try {
    parsed = parseXml(fileXml);
  } catch (err) {
    console.warn(
      "[y-mxgraph] 合并失败，file XML 解析异常，回退到 replace：",
      err,
    );
    return false;
  }

  const mxfileObj = (parsed as Record<string, unknown>)?.mxfile as
    | { diagram?: Array<Record<string, unknown>> }
    | undefined;
  if (!mxfileObj || !Array.isArray(mxfileObj.diagram)) {
    console.warn(
      "[y-mxgraph] 合并失败，file XML 不是合法 mxfile，回退到 replace",
    );
    return false;
  }

  const mxfileMap = doc.getMap(mxfileKey);
  const diagramMap = mxfileMap.get(diagramKey) as Y.Map<YDiagram> | undefined;
  const diagramOrder = mxfileMap.get(diagramOrderKey) as
    | Y.Array<string>
    | undefined;
  if (!diagramMap || !diagramOrder) {
    console.warn("[y-mxgraph] 合并失败，doc 结构不完整，回退到 replace");
    return false;
  }

  doc.transact(() => {
    for (const diagram of mxfileObj.diagram!) {
      const id =
        ((diagram as { _attributes?: { id?: string } })._attributes
          ?.id as string) || "";
      if (!id) continue;

      const docHas = diagramMap.has(id);
      if (docHas && strategy === "merge-remote") {
        // doc 优先，跳过
        continue;
      }

      // 覆盖或新增
      const yDiagram = parseDiagram(
        diagram as unknown as import("../models/diagram").Diagram,
      );
      diagramMap.set(id, yDiagram);
      if (!docHas) {
        diagramOrder.push([id]);
      }
    }
  });
  return true;
}

function reconcileInitialContent(
  doc: Y.Doc,
  file: DrawioFile,
  strategy: InitialContentStrategy,
  applyFileData: (file: DrawioFile, xml: string) => void,
): boolean {
  const mxfileMap = doc.getMap(mxfileKey);
  const docHasData = mxfileMap.size > 0;
  // 与旧 demo 行为保持一致：file 是否「有任何数据」用 truthy 判断；
  // 只有完全空时才注入模板，避免把 draw.io 默认文件覆盖成模板触发
  // 「Save diagrams to:」存储选择对话框。
  const fileHasAnyData = !!file.data;
  // merge 策略需要进一步判断是否存在真实 diagram 内容
  const fileHasDiagrams = fileHasAnyData && file.data.includes("<diagram");

  if (strategy === "replace") {
    if (docHasData) {
      const xml = ydoc2xml(doc);
      if (xml && xml.includes("<diagram")) {
        applyFileData(file, xml);
      } else if (!fileHasAnyData) {
        applyFileData(file, Binding.generateFileTemplate("diagram-0"));
      }
    } else if (!fileHasAnyData) {
      applyFileData(file, Binding.generateFileTemplate("diagram-0"));
    }
    // 其余情况保留 file，避免触发 draw.io 默认文件的存储对话框
    return mxfileMap.size > 0;
  }

  // merge-remote / merge-client
  if (!docHasData && !fileHasDiagrams) {
    if (!fileHasAnyData) {
      applyFileData(file, Binding.generateFileTemplate("diagram-0"));
    }
    return false;
  }

  if (!docHasData && fileHasDiagrams) {
    // 仅 file 有 → 把 file 写入 doc，file 保持不变
    try {
      doc.transact(() => {
        xml2ydoc(file.data, doc);
      });
      return true;
    } catch (err) {
      console.warn(
        "[y-mxgraph] merge 模式下 xml2ydoc 失败，回退 replace：",
        err,
      );
      applyFileData(file, Binding.generateFileTemplate("diagram-0"));
      return false;
    }
  }

  if (docHasData && !fileHasDiagrams) {
    // 仅 doc 有可用 diagram → 用 doc 覆盖 file
    const xml = ydoc2xml(doc);
    if (xml && xml.includes("<diagram")) {
      applyFileData(file, xml);
    } else if (!fileHasAnyData) {
      applyFileData(file, Binding.generateFileTemplate("diagram-0"));
    }
    return mxfileMap.size > 0;
  }

  // 双方都有可用 diagram → 按策略合并
  const ok = mergeFileIntoDoc(doc, file.data, strategy);
  if (!ok) {
    // 解析失败回退到 replace（用 doc 覆盖 file）
    const xml = ydoc2xml(doc);
    if (xml && xml.includes("<diagram")) applyFileData(file, xml);
    return mxfileMap.size > 0;
  }
  const xml = ydoc2xml(doc);
  if (xml && xml.includes("<diagram")) applyFileData(file, xml);
  return true;
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
  /** draw.io file 实例 */
  readonly file: DrawioFile;
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
  /** 协作功能清理函数（awareness 光标/选区） */
  private cleanupCollaborator?: () => void;
  /** UndoManager 绑定清理函数 */
  private cleanupUndoManager?: () => void;
  /** 初始内容策略 */
  private initialContentStrategy: InitialContentStrategy;
  /** draw.io UI 引用，用于重置状态和获取 currentFile */
  private ui: DrawioUi | null = null;
  /** 转换本地 patch 的回调 */
  private transformPatch?: (patch: import("./patch").FilePatch) => import("./patch").FilePatch | null | undefined;
  /** 一致性检查器 */
  private consistencyChecker?: ConsistencyChecker;
  /** applyFileData 回调引用（forceSync 需要） */
  private applyFileData: (file: DrawioFile, xml: string) => void;
  /** debounce 后的 forceSync，用于 patch 后保底 */
  private debouncedForceSync: ReturnType<typeof setTimeout> | null = null;
  /** patch 后检查顺序一致性 */
  private syncOnOrderMismatch: boolean;

  /** replace 策略下，构造时 doc 为空，现在 doc 有数据时需要强制替换 */
  private get shouldReplaceWhenDocHasData(): boolean {
    return this.initialContentStrategy === "replace" && !this.docInitialized;
  }

  constructor(file: DrawioFile, options: BindDrawioFileOptions) {
    const {
      doc,
      awareness,
      undoManager,
      mouseMoveThrottle,
      cursor,
      initialContent = "replace",
      applyFileData = defaultApplyFileData,
      disableBeforeUnload = true,
      transformPatch,
      syncOnOrderMismatch = false,
    } = options;

    this.doc = doc;
    this.file = file;
    this.initialContentStrategy = initialContent;
    this.transformPatch = transformPatch;
    this.applyFileData = applyFileData;
    this.syncOnOrderMismatch = syncOnOrderMismatch;

    const ui = file.getUi();
    const graph = ui.editor.graph;
    this.mxGraphModel = graph.model;
    this.ui = ui;

    // 禁用 draw.io 的 beforeUnload 弹窗
    // Yjs 接管持久化后，draw.io 的原生保存状态不再有意义，
    // 但 draw.io 内部会在特定条件下弹出 "All changes will be lost" 提示。
    if (disableBeforeUnload) {
      (ui as any).onBeforeUnload = () => null;
    }

    // 统一初始化：根据 initialContent 策略对齐 file 与 doc。
    // 内部会调用 applyFileData 钩子（默认 ui.setFileData + file.setData），
    // 业务方不再需要在外部手动同步。
    this.suppressLocalApply = true;
    try {
      this.docInitialized = reconcileInitialContent(
        doc,
        file,
        initialContent,
        applyFileData,
      );
      // doc 在 reconcile 后才确定有内容，需建立 snapshot 基线
      if (this.docInitialized) {
        initDocSnapshot(doc, false);
      }
    } finally {
      this.suppressLocalApply = false;
    }

    // 对齐 shadowPages（reconcile 可能已经替换了 ui.pages）
    file.setShadowPages(file.ui.clonePages(file.ui.pages));

    // 本地变更监听
    this.mxListener = () => {
      if (this.suppressLocalApply) return;

      const patch = file.ui.diffPages(
        file.shadowPages,
        file.ui.pages,
      ) as import("./patch").FilePatch;
      const patchKeys = Object.keys(patch);

      // 没有实际本地变更时直接跳过
      if (patchKeys.length === 0) return;

      let finalPatch = patch;
      if (this.transformPatch) {
        const result = this.transformPatch(patch);
        if (result === null) return;
        if (result !== undefined) finalPatch = result;
      }

      // 第一次有实际本地编辑时才初始化 Y.Doc
      if (!this.docInitialized) {
        doc.transact(() => {
          xml2ydoc(file.data, doc);
          initDocSnapshot(doc, false);
        });
        this.docInitialized = true;
      }

      file.setShadowPages(file.ui.clonePages(file.ui.pages));
      applyFilePatch(doc, finalPatch, { origin: LOCAL_ORIGIN });
      this.resetEditorStatus();
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
        // 本地改动由 mxListener 处理，这里只跳过，不更新 snapshot
        // 如果调用 generatePatch 会更新共享 snapshot，导致远端 tab 无法检测到变化
        return;
      }

      // replace 策略下，若构造时 doc 为空，现在 doc 有数据，强制替换本地 file
      // 注意：只有非本地 transaction 时才执行强制替换，避免本地初始化时自我覆盖
      if (this.shouldReplaceWhenDocHasData && !transaction.local) {
        const mxfileMap = doc.getMap(mxfileKey);
        const diagramMap = mxfileMap.get(diagramKey) as
          | Y.Map<Y.XmlElement>
          | undefined;
        if (diagramMap && diagramMap.size > 0) {
          // doc 已有数据，执行强制替换
          const xml = ydoc2xml(doc);
          if (xml && xml.includes("<diagram")) {
            this.suppressLocalApply = true;
            try {
              applyFileData(file, xml);
              file.setShadowPages(file.ui.clonePages(file.ui.pages));
              initDocSnapshot(doc, false);
              this.resetEditorStatus();
            } finally {
              this.suppressLocalApply = false;
            }
            // 强制替换完成后再标记 docInitialized
            this.docInitialized = true;
            return;
          }
        }
      }

      // 标记已初始化（远端数据到达且不是首次强制替换）
      if (!this.docInitialized) {
        this.docInitialized = true;
      }

      const patch = generatePatch(events);
      const patchKeys = Object.keys(patch);
      if (patchKeys.length === 0) return;

      this.suppressLocalApply = true;
      try {
        file.patch([patch]);
        file.setShadowPages(file.ui.clonePages(file.ui.pages));
        this.resetEditorStatus();
      } finally {
        this.suppressLocalApply = false;
      }

      if (this.syncOnOrderMismatch && patch.u && this.checkOrderMismatch(patch)) {
        console.warn("[y-mxgraph] order mismatch detected, debounced forceSync (file → ydoc)");
        if (this.debouncedForceSync) clearTimeout(this.debouncedForceSync);
        this.debouncedForceSync = setTimeout(() => {
          this.debouncedForceSync = null;
          this.forceSync("file-to-ydoc");
        }, 300);
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

    // 一致性检查器
    const {
      consistencyCheckInterval,
      onDrift,
    } = options;
    if (consistencyCheckInterval && consistencyCheckInterval > 0) {
      this.consistencyChecker = new ConsistencyChecker(doc, () => file.data, {
        source: "binding",
      });
      if (onDrift) {
        this.consistencyChecker.onDrift(onDrift);
      }
      this.consistencyChecker.onDrift((event) => {
        // 自动修复：超过最大次数后停止
        if (this.consistencyChecker?.shouldStopAutoFix) {
          console.warn(
            `[y-mxgraph] 连续 ${event.details} 次 drift，停止自动 forceSync`,
          );
          return;
        }
        this.forceSync("ydoc-to-file");
      });
      this.consistencyChecker.start(consistencyCheckInterval);
    }
  }

  /**
   * 重置 editor 和 file 的 modified 状态及状态栏。
   * Yjs 接管持久化后，draw.io 的原生保存状态不再有意义。
   */
  private resetEditorStatus(): void {
    if (!this.ui) return;
    this.ui.editor.setModified(false);
    this.ui.editor.setStatus("");
    this.ui.currentFile?.setModified(false);
  }

  /**
   * 强制同步 ydoc 与 file，修复检测到的不一致。
   *
   * @param direction - 同步方向
   *   - `ydoc-to-file`（默认）：用 ydoc 数据覆盖 file
   *   - `file-to-ydoc`：用 file 数据覆盖 ydoc
   */
  forceSync(direction: "ydoc-to-file" | "file-to-ydoc" = "ydoc-to-file"): void {
    if (direction === "ydoc-to-file") {
      // 在 forceSync 时清理异常 cellOrder，避免影响 undo 栈
      this.cleanInvalidCellOrder();
      const xml = ydoc2xml(this.doc);
      if (!xml || !xml.includes("<diagram")) return;
      this.suppressLocalApply = true;
      try {
        this.applyFileData(this.file, xml);
        this.file.setShadowPages(this.file.ui.clonePages(this.file.ui.pages));
        initDocSnapshot(this.doc, false);
        this.resetEditorStatus();
      } finally {
        this.suppressLocalApply = false;
      }
    } else {
      this.doc.transact(() => {
        xml2ydoc(this.file.data, this.doc);
        initDocSnapshot(this.doc, false);
      }, LOCAL_ORIGIN);
    }
    // forceSync 成功后重置 drift 计数
    this.consistencyChecker?.resetDriftCount();
  }

  /**
   * 清理 cellsMap 中不存在的 cell id，避免影响 undo 栈。
   * 只在 forceSync 时调用，因为这是用户主动触发的同步操作。
   */
  private cleanInvalidCellOrder(): void {
    const mxfile = this.doc.getMap(mxfileKey) as YMxFile;
    const diagramsMap = mxfile.get(diagramKey) as unknown as Y.Map<YDiagram>;
    if (!diagramsMap) return;

    for (const [did, diagram] of diagramsMap.entries()) {
      const gm = diagram.get(mxGraphModelKey) as YMxGraphModel | undefined;
      if (!gm) continue;

      const order = gm.get(mxCellOrderKey) as Y.Array<string> | undefined;
      const cellsMap = gm.get(mxCellKey) as Y.Map<Y.XmlElement> | undefined;
      if (!order || !cellsMap) continue;

      const ids = order.toArray();
      const invalidIds: string[] = [];

      for (const cid of ids) {
        const cell = cellsMap.get(cid);
        if (!cell || typeof (cell as any).getAttributes !== 'function') {
          invalidIds.push(cid);
        }
      }

      if (invalidIds.length > 0) {
        console.warn(`[y-mxgraph] forceSync: cleaning invalid cell ids from order: ${invalidIds.join(",")}`);
        for (const invalidId of invalidIds) {
          const index = order.toArray().indexOf(invalidId);
          if (index !== -1) {
            order.delete(index, 1);
          }
        }
      }
    }
  }

  private checkOrderMismatch(patch: import("./patch").FilePatch): boolean {
    if (!patch.u) return false;
    for (const [did, update] of Object.entries(patch.u)) {
      if (!update.cells?.u) continue;
      for (const [cid, cellUpdate] of Object.entries(update.cells.u)) {
        if (!("previous" in cellUpdate)) continue;
        const mxfile = this.doc.getMap(mxfileKey) as YMxFile;
        const diagramsMap = mxfile.get(diagramKey) as Y.Map<YDiagram> | undefined;
        const diagram = diagramsMap?.get(did) as YDiagram | undefined;
        if (!diagram) continue;
        const gm = diagram.get(mxGraphModelKey) as YMxGraphModel | undefined;
        if (!gm) continue;
        const orderArr = gm.get(mxCellOrderKey) as Y.Array<string> | undefined;
        if (!orderArr) continue;
        const ids = orderArr.toArray();
        const idx = ids.indexOf(cid);
        if (idx === -1) continue;
        const expectedPrev = idx === 0 ? "" : ids[idx - 1];
        const actualPrev = cellUpdate.previous as string;
        if (expectedPrev !== actualPrev) {
          console.log(`[y-mxgraph] order mismatch: cell=${cid}, ydoc prev=${JSON.stringify(expectedPrev)}, patch prev=${JSON.stringify(actualPrev)}`);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 手动触发一次一致性检查。
   * @returns true = 一致，false = 存在 drift
   */
  checkConsistency(): boolean {
    if (!this.consistencyChecker) return true;
    return this.consistencyChecker.check();
  }

  /**
   * 销毁绑定，解除所有监听器
   * @param deep - 是否深度清理（包括 awareness/undoManager），默认 false
   */
  destroy(deep = false): void {
    this.mxGraphModel.removeListener("change", this.mxListener);
    this.doc.getMap(mxfileKey).unobserveDeep(this.docObserver);
    this.consistencyChecker?.destroy();
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
