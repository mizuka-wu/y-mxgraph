import * as Y from "yjs";
import { ydoc2xml } from "../transform";

/**
 * Drift 检测事件。当 ydoc 与 file XML 检测到不一致时触发。
 */
export interface DriftEvent {
  timestamp: number;
  /** 检测来源 */
  source: "binding" | "iframe-server" | "iframe-provider";
  /** 不一致方向（基于检测时的状态推断） */
  direction: "ydoc-ahead" | "file-ahead" | "unknown";
  /** 详情描述 */
  details?: string;
}

export type DriftHandler = (event: DriftEvent) => void;

/**
 * 轻量级一致性检查：比较 ydoc 序列化后的 XML 与 file.data 是否等价。
 *
 * 由于 draw.io 内部可能添加编辑器状态属性（如 background 标记），这里
 * 做结构级比较而非严格字符串等价。
 *
 * @returns true 表示一致，false 表示存在 drift
 */
export function checkConsistency(doc: Y.Doc, fileData: string): boolean {
  try {
    const xmlFromYdoc = ydoc2xml(doc);
    // 快速路径：字符串完全一致
    if (xmlFromYdoc === fileData) return true;

    // 结构级比较：两者都可能因格式差异（空白、属性顺序）而不同
    // 但 diagram 数量和 cell 数量应该一致
    const diagramCountFromYdoc = (xmlFromYdoc.match(/<diagram /g) || []).length;
    const diagramCountFromFile = (fileData.match(/<diagram /g) || []).length;
    if (diagramCountFromYdoc !== diagramCountFromFile) return false;

    // cell 数量比较（mxCell 标签）
    const cellCountFromYdoc = (xmlFromYdoc.match(/<mxCell /g) || []).length;
    const cellCountFromFile = (fileData.match(/<mxCell /g) || []).length;
    if (cellCountFromYdoc !== cellCountFromFile) return false;

    // 如果 diagram/cell 数量都一致，认为结构上一致
    // （属性差异如 background 等由 patch 机制处理，不算 drift）
    return true;
  } catch {
    // 序列化失败视为不一致
    return false;
  }
}

/**
 * 一致性检查器，管理定时检测和 DriftEvent 分发。
 */
export class ConsistencyChecker {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private handlers = new Set<DriftHandler>();
  private consecutiveDriftCount = 0;
  private readonly maxAutoFixAttempts: number;
  private source: DriftEvent["source"];

  constructor(
    private doc: Y.Doc,
    private getFileData: () => string,
    options: {
      source?: DriftEvent["source"];
      maxAutoFixAttempts?: number;
    } = {},
  ) {
    this.source = options.source ?? "binding";
    this.maxAutoFixAttempts = options.maxAutoFixAttempts ?? 3;
  }

  /** 注册 drift 事件监听 */
  onDrift(handler: DriftHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** 启动定期检查（毫秒间隔），0 或负数表示禁用 */
  start(intervalMs: number): void {
    this.stop();
    if (intervalMs <= 0) return;
    this.intervalId = setInterval(() => {
      this.check();
    }, intervalMs);
  }

  /** 停止定期检查 */
  stop(): void {
    if (this.intervalId != null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * 执行一次一致性检查。
   * @returns true = 一致，false = 存在 drift
   */
  check(): boolean {
    const consistent = checkConsistency(this.doc, this.getFileData());
    if (consistent) {
      this.consecutiveDriftCount = 0;
      return true;
    }

    this.consecutiveDriftCount++;
    const event: DriftEvent = {
      timestamp: Date.now(),
      source: this.source,
      direction: "unknown",
      details: `drift detected (consecutive #${this.consecutiveDriftCount})`,
    };

    // 通知所有监听器
    this.handlers.forEach((handler) => {
      try {
        handler(event);
      } catch (e) {
        console.warn("[y-mxgraph] drift handler error:", e);
      }
    });

    return false;
  }

  /** 重置连续 drift 计数（forceSync 成功后调用） */
  resetDriftCount(): void {
    this.consecutiveDriftCount = 0;
  }

  /** 是否已超过最大自动修复次数 */
  get shouldStopAutoFix(): boolean {
    return this.consecutiveDriftCount >= this.maxAutoFixAttempts;
  }

  destroy(): void {
    this.stop();
    this.handlers.clear();
  }
}
