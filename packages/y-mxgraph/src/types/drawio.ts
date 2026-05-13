/**
 * draw.io / mxGraph 核心类型声明
 * 基于代码中实际使用到的 API 进行最小化类型定义
 */

/** mxGraph 页面 */
export interface DrawioPage {
  getId(): string;
}

/** mxGraph 视图 */
export interface GraphView {
  translate: { x: number; y: number };
  scale: number;
}

/** mxGraph 模型 */
export interface MxGraphModel {
  addListener(event: string, fn: (...args: unknown[]) => void): void;
  removeListener(event: string, fn: (...args: unknown[]) => void): void;
  getCell(id: string): unknown | null;
}

/** mxGraph 选区模型 */
export interface SelectionModel {
  cells: Record<string, unknown>;
  addListener(event: string, fn: (...args: unknown[]) => void): void;
  removeListener(event: string, fn: (...args: unknown[]) => void): void;
}

/** mxGraph 实例 */
export interface MxGraph {
  model: MxGraphModel;
  container: HTMLElement;
  view: GraphView;
  addMouseListener(listener: unknown): void;
  removeMouseListener(listener: unknown): void;
  getSelectionModel(): SelectionModel;
  highlightCell(
    cell: unknown,
    color: string,
    timeout: number,
    opacity: number,
    width: number,
  ): { destroy(): void };
}

/** draw.io 编辑器 */
export interface DrawioEditor {
  graph: MxGraph;
  setStatus(status: string): void;
  setModified(modified: boolean): void;
  undoManager?: {
    eventListeners?: unknown[];
    undoListener?: (...args: unknown[]) => void;
    [key: string]: unknown;
  };
  undoListener?: (...args: unknown[]) => void;
}

/** draw.io UI */
export interface DrawioUi {
  editor: DrawioEditor;
  currentFile: DrawioFile | null;
  currentPage?: DrawioPage | null;
  diagramContainer: HTMLElement;
  pages: unknown[];
  diffPages(oldPages: unknown[], newPages: unknown[]): unknown;
  clonePages(pages: unknown[]): unknown[];
  /** 解析 XML 并重建 pages / mxGraphModel，触发 UI 重绘 */
  setFileData(data: string): void;
}

/** mxGraph 事件对象 */
export interface MxEventObject {
  name: string;
  getName(): string;
  getProperty(key: string): unknown;
}

/** draw.io 文件对象 */
export interface DrawioFile {
  data: string;
  shadowPages: unknown[];
  ui: DrawioUi;
  getUi(): DrawioUi;
  setShadowPages(pages: unknown[]): void;
  patch(patches: unknown[]): void;
  /** 仅赋值 this.data = xml，不触发 UI 重绘 */
  setData(data: string): void;
  isModified(): boolean;
  setModified(modified: boolean): void;
}

/** draw.io App（demo 中通过 iframe 访问） */
export interface DrawioApp {
  currentFile: DrawioFile | null;
  editor: DrawioEditor;
}
