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
  geometryMatch: boolean;
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

      const isDraft = ydocDiagramCount === 0 && ydocCellCount === 0;
      const diagramCountMatch = ydocDiagramCount === fileDiagramCount;
      const cellCountMatch = ydocCellCount === fileCellCount;

      if (isDraft) {
        details.push("YDoc 未编辑（草稿状态）");
        return {
          inSync: true,
          isDraft,
          ydocXml,
          fileXml,
          diagramCountMatch: true,
          cellCountMatch: true,
          cellOrderMatch: true,
          geometryMatch: true,
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
        const ydocIds = this.extractCellIds(ydocXml);
        const fileIds = this.extractCellIds(fileXml);
        const orderSame = ydocIds.length === fileIds.length &&
          ydocIds.every((id, i) => id === fileIds[i]);
        if (!orderSame) {
          cellOrderMatch = false;
          details.push(`元素顺序不一致`);
        }
      }

      // 检查几何数据是否一致
      let geometryMatch = true;
      if (cellCountMatch && ydocCellCount > 0) {
        const ydocGeometries = this.extractGeometries(ydocXml);
        const fileGeometries = this.extractGeometries(fileXml);
        const geoDiffs: string[] = [];
        for (const [id, ydocGeo] of ydocGeometries) {
          const fileGeo = fileGeometries.get(id);
          if (!fileGeo) continue;
          const allKeys = new Set([...Object.keys(ydocGeo), ...Object.keys(fileGeo)]);
          const fieldDiffs: string[] = [];
          for (const key of allKeys) {
            const yv = ydocGeo[key] ?? '';
            const fv = fileGeo[key] ?? '';
            if (yv !== fv) {
              fieldDiffs.push(`${key}: ydoc=${yv} file=${fv}`);
            }
          }
          if (fieldDiffs.length > 0) {
            geoDiffs.push(`${id}: ${fieldDiffs.join(', ')}`);
          }
        }
        if (geoDiffs.length > 0) {
          geometryMatch = false;
          details.push(`几何数据不一致：${geoDiffs.slice(0, 3).join('; ')}${geoDiffs.length > 3 ? ` (共${geoDiffs.length}处)` : ''}`);
        }
      }

      const inSync = diagramCountMatch && cellCountMatch && cellOrderMatch && geometryMatch;

      if (inSync) {
        details.push("同步正常");
      }

      return {
        inSync,
        isDraft,
        ydocXml,
        fileXml,
        diagramCountMatch,
        cellCountMatch,
        cellOrderMatch,
        geometryMatch,
        details,
      };
    } catch (e) {
      return {
        inSync: false,
        isDraft: false,
        ydocXml: null,
        fileXml: null,
        diagramCountMatch: false,
        cellCountMatch: false,
        cellOrderMatch: false,
        geometryMatch: false,
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

  private extractGeometries(xml: string): Map<string, Record<string, string>> {
    const geometries = new Map<string, Record<string, string>>();
    const cellBlockRegex = /<mxCell[^>]*\sid="([^"]*)"[^>]*>([\s\S]*?)<\/mxCell>/g;
    let match;
    while ((match = cellBlockRegex.exec(xml)) !== null) {
      const cellId = match[1];
      const cellContent = match[2];
      const geoRegex = /<mxGeometry\s+([^>]*)\/?>/;
      const geoMatch = cellContent.match(geoRegex);
      if (geoMatch) {
        const attrs: Record<string, string> = {};
        const attrRegex = /(\w+)="([^"]*)"/g;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(geoMatch[1])) !== null) {
          attrs[attrMatch[1]] = attrMatch[2];
        }
        geometries.set(cellId, attrs);
      }
    }
    return geometries;
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
