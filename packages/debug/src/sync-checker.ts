import * as Y from "yjs";
import { ydoc2xml } from "y-mxgraph";

export interface SyncStatus {
  inSync: boolean;
  isDraft: boolean;
  ydocXml: string | null;
  fileXml: string | null;
  diagramCountMatch: boolean;
  cellCountMatch: boolean;
  cellOrderMatch: boolean;
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
      console.log("[y-mxgraph/debug] 开始同步检查...");
      
      const ydocXml = ydoc2xml(this.doc);
      const fileXml = this.getFileData();

      console.log("[y-mxgraph/debug] 步骤1: 获取 XML 数据");
      console.log("  YDoc XML 长度:", ydocXml.length);
      console.log("  File XML 长度:", fileXml.length);

      if (!fileXml || fileXml.trim() === "") {
        console.log("[y-mxgraph/debug] 步骤2: 文件为空，跳过检查");
        return {
          inSync: true,
          isDraft: false,
          ydocXml,
          fileXml,
          diagramCountMatch: true,
          cellCountMatch: true,
          cellOrderMatch: true,
          details: ["文件为空，跳过检查"],
        };
      }

      const ydocDiagramCount = (ydocXml.match(/<diagram /g) || []).length;
      const fileDiagramCount = (fileXml.match(/<diagram /g) || []).length;
      const ydocCellCount = (ydocXml.match(/<mxCell /g) || []).length;
      const fileCellCount = (fileXml.match(/<mxCell /g) || []).length;

      console.log("[y-mxgraph/debug] 步骤2: 统计数量");
      console.log("  YDoc diagram:", ydocDiagramCount, "cell:", ydocCellCount);
      console.log("  File diagram:", fileDiagramCount, "cell:", fileCellCount);

      const isDraft = ydocDiagramCount === 0 && ydocCellCount === 0;
      const diagramCountMatch = ydocDiagramCount === fileDiagramCount;
      const cellCountMatch = ydocCellCount === fileCellCount;

      if (isDraft) {
        console.log("[y-mxgraph/debug] 步骤3: 草稿状态");
        details.push("YDoc 未编辑（草稿状态）");
        return {
          inSync: true,
          isDraft,
          ydocXml,
          fileXml,
          diagramCountMatch,
          cellCountMatch,
          cellOrderMatch: true,
          details,
        };
      }

      if (!diagramCountMatch) {
        details.push(`页面数量不一致：YDoc=${ydocDiagramCount}, 文件=${fileDiagramCount}`);
      }

      if (!cellCountMatch) {
        details.push(`元素数量不一致：YDoc=${ydocCellCount}, 文件=${fileCellCount}`);
      }

      let cellOrderMatch = true;
      if (cellCountMatch && ydocCellCount > 0) {
        console.log("[y-mxgraph/debug] 步骤3: 检查 cell 顺序");
        const ydocIds = this.extractCellIds(ydocXml);
        const fileIds = this.extractCellIds(fileXml);
        
        console.log("  YDoc cell IDs:", ydocIds);
        console.log("  File cell IDs:", fileIds);
        
        const orderSame = ydocIds.length === fileIds.length &&
          ydocIds.every((id, i) => id === fileIds[i]);
        
        if (!orderSame) {
          cellOrderMatch = false;
          details.push(`元素顺序不一致`);
          
          console.log("[y-mxgraph/debug] 步骤4: 顺序不一致详情");
          console.log("  YDoc order:", ydocIds);
          console.log("  File order:", fileIds);
          
          // 找出具体哪些位置不同
          for (let i = 0; i < Math.max(ydocIds.length, fileIds.length); i++) {
            const ydocId = ydocIds[i] || '(missing)';
            const fileId = fileIds[i] || '(missing)';
            if (ydocId !== fileId) {
              console.log(`  位置 ${i}: YDoc="${ydocId}" vs File="${fileId}"`);
            }
          }
        } else {
          console.log("[y-mxgraph/debug] 步骤4: 顺序一致");
        }
      }

      const inSync = diagramCountMatch && cellCountMatch && cellOrderMatch;

      if (inSync) {
        console.log("[y-mxgraph/debug] 步骤5: 同步正常");
        details.push("同步正常");
      } else {
        console.warn("[y-mxgraph/debug] 步骤5: 同步漂移检测:", details);
      }

      return {
        inSync,
        isDraft,
        ydocXml,
        fileXml,
        diagramCountMatch,
        cellCountMatch,
        cellOrderMatch,
        details,
      };
    } catch (e) {
      console.error("[y-mxgraph/debug] 检查出错:", e);
      return {
        inSync: false,
        isDraft: false,
        ydocXml: null,
        fileXml: null,
        diagramCountMatch: false,
        cellCountMatch: false,
        cellOrderMatch: false,
        details: [`检查出错: ${e}`],
      };
    }
  }

  private extractCellIds(xml: string): string[] {
    const ids: string[] = [];
    const regex = /<mxCell[^>]*\sid="([^"]*)"/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      ids.push(match[1]);
    }
    return ids;
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
