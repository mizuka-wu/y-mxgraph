import * as Y from "yjs";
import { ydoc2xml } from "y-mxgraph";

export interface SyncStatus {
  inSync: boolean;
  ydocXml: string | null;
  fileXml: string | null;
  diagramCountMatch: boolean;
  cellCountMatch: boolean;
  details: string[];
}

export interface SyncCheckResult {
  timestamp: number;
  status: SyncStatus;
  duration: number;
}

export class SyncChecker {
  private history: SyncCheckResult[] = [];
  private maxHistory: number;

  constructor(
    private doc: Y.Doc,
    private getFileData: () => string,
    options: { maxHistory?: number } = {},
  ) {
    this.maxHistory = options.maxHistory ?? 50;
  }

  check(): SyncCheckResult {
    const start = performance.now();
    const status = this.checkSync();
    const duration = performance.now() - start;

    const result: SyncCheckResult = {
      timestamp: Date.now(),
      status,
      duration,
    };

    this.history.push(result);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }

    return result;
  }

  private checkSync(): SyncStatus {
    const details: string[] = [];

    try {
      const ydocXml = ydoc2xml(this.doc);
      const fileXml = this.getFileData();

      if (!fileXml || fileXml.trim() === "") {
        return {
          inSync: true,
          ydocXml,
          fileXml,
          diagramCountMatch: true,
          cellCountMatch: true,
          details: ["文件为空，跳过检查"],
        };
      }

      const ydocDiagramCount = (ydocXml.match(/<diagram /g) || []).length;
      const fileDiagramCount = (fileXml.match(/<diagram /g) || []).length;
      const diagramCountMatch = ydocDiagramCount === fileDiagramCount;

      if (!diagramCountMatch) {
        details.push(`页面数量不一致：YDoc=${ydocDiagramCount}, 文件=${fileDiagramCount}`);
      }

      const ydocCellCount = (ydocXml.match(/<mxCell /g) || []).length;
      const fileCellCount = (fileXml.match(/<mxCell /g) || []).length;
      const cellCountMatch = ydocCellCount === fileCellCount;

      if (!cellCountMatch) {
        details.push(`元素数量不一致：YDoc=${ydocCellCount}, 文件=${fileCellCount}`);
      }

      const inSync = diagramCountMatch && cellCountMatch;

      if (inSync) {
        details.push("同步正常");
      }

      return {
        inSync,
        ydocXml,
        fileXml,
        diagramCountMatch,
        cellCountMatch,
        details,
      };
    } catch (e) {
      return {
        inSync: false,
        ydocXml: null,
        fileXml: null,
        diagramCountMatch: false,
        cellCountMatch: false,
        details: [`检查出错: ${e}`],
      };
    }
  }

  getHistory(): SyncCheckResult[] {
    return [...this.history];
  }

  getLastCheck(): SyncCheckResult | null {
    return this.history.length > 0 ? this.history[this.history.length - 1] : null;
  }

  isConsistent(): boolean {
    const last = this.getLastCheck();
    return last?.status.inSync ?? true;
  }

  clearHistory(): void {
    this.history = [];
  }

  destroy(): void {
    this.history = [];
  }
}
