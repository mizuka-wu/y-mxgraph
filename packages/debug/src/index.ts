import * as Y from "yjs";
import { UpdateTracker, type UpdateStats } from "./update-tracker";
import { SyncChecker, type SyncStatus, type SyncCheckResult } from "./sync-checker";

export { UpdateTracker, type UpdateStats, type PendingUpdate } from "./update-tracker";
export { SyncChecker, type SyncStatus, type SyncCheckResult } from "./sync-checker";

export interface DebugTools {
  updateTracker: UpdateTracker;
  syncChecker: SyncChecker;
  getStatus: () => DebugStatus;
  checkNow: () => CheckResult;
  startAutoCheck: (intervalMs?: number) => void;
  stopAutoCheck: () => void;
  destroy: () => void;
}

export interface DebugStatus {
  updateStats: UpdateStats;
  syncStatus: SyncStatus | null;
  timeSinceLastUpdate: number | null;
}

export interface CheckResult {
  timestamp: number;
  updates: UpdateStats;
  sync: SyncCheckResult;
}

export function createDebugTools(
  doc: Y.Doc,
  getFileData: () => string,
  options: {
    maxUpdateHistory?: number;
    maxSyncHistory?: number;
    autoCleanupMs?: number;
  } = {},
): DebugTools {
  const updateTracker = new UpdateTracker(doc, {
    maxHistory: options.maxUpdateHistory,
    autoCleanupMs: options.autoCleanupMs,
  });

  const syncChecker = new SyncChecker(doc, getFileData, {
    maxHistory: options.maxSyncHistory,
  });

  let autoCheckTimer: ReturnType<typeof setInterval> | null = null;

  const getStatus = (): DebugStatus => ({
    updateStats: updateTracker.getStats(),
    syncStatus: syncChecker.getLastCheck()?.status ?? null,
    timeSinceLastUpdate: updateTracker.getTimeSinceLastUpdate(),
  });

  const checkNow = (): CheckResult => ({
    timestamp: Date.now(),
    updates: updateTracker.getStats(),
    sync: syncChecker.check(),
  });

  const startAutoCheck = (intervalMs = 5000): void => {
    stopAutoCheck();
    autoCheckTimer = setInterval(() => {
      const result = checkNow();
    if (!result.sync.status.inSync) {
      console.warn("[y-mxgraph/debug] 检测到同步漂移:", result.sync.status.details);
    }
    }, intervalMs);
  };

  const stopAutoCheck = (): void => {
    if (autoCheckTimer) {
      clearInterval(autoCheckTimer);
      autoCheckTimer = null;
    }
  };

  const destroy = (): void => {
    stopAutoCheck();
    updateTracker.destroy();
    syncChecker.destroy();
  };

  return {
    updateTracker,
    syncChecker,
    getStatus,
    checkNow,
    startAutoCheck,
    stopAutoCheck,
    destroy,
  };
}

export function installDebugTools(
  doc: Y.Doc,
  getFileData: () => string,
  options: {
    maxUpdateHistory?: number;
    maxSyncHistory?: number;
    autoCleanupMs?: number;
    autoStart?: boolean;
    autoCheckIntervalMs?: number;
    windowKey?: string;
  } = {},
): DebugTools {
  const tools = createDebugTools(doc, getFileData, options);

  const windowKey = options.windowKey ?? "__y_mxgraph_debug__";
  if (typeof window !== "undefined") {
    (window as any)[windowKey] = tools;
    console.log(`[y-mxgraph/debug] 调试工具已安装到 window.${windowKey}`);
    console.log(`[y-mxgraph/debug] 用法: window.${windowKey}.checkNow()`);
  }

  if (options.autoStart) {
    tools.startAutoCheck(options.autoCheckIntervalMs);
  }

  return tools;
}
