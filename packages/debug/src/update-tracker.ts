import * as Y from "yjs";

export interface PendingUpdate {
  timestamp: number;
  origin: unknown;
  updateSize: number;
  applied: boolean;
}

export interface UpdateStats {
  totalUpdates: number;
  pendingCount: number;
  lastUpdate: number | null;
  updates: PendingUpdate[];
}

export class UpdateTracker {
  private updates: PendingUpdate[] = [];
  private maxHistory: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private doc: Y.Doc,
    options: { maxHistory?: number; autoCleanupMs?: number } = {},
  ) {
    this.maxHistory = options.maxHistory ?? 100;
    this.doc.on("update", this.onUpdate);

    if (options.autoCleanupMs && options.autoCleanupMs > 0) {
      this.cleanupTimer = setInterval(() => this.cleanup(), options.autoCleanupMs);
    }
  }

  private onUpdate = (update: Uint8Array, origin: unknown) => {
    const entry: PendingUpdate = {
      timestamp: Date.now(),
      origin,
      updateSize: update.byteLength,
      applied: true,
    };

    this.updates.push(entry);

    if (this.updates.length > this.maxHistory) {
      this.updates = this.updates.slice(-this.maxHistory);
    }
  };

  getStats(): UpdateStats {
    return {
      totalUpdates: this.updates.length,
      pendingCount: this.updates.filter((u) => !u.applied).length,
      lastUpdate: this.updates.length > 0 ? this.updates[this.updates.length - 1].timestamp : null,
      updates: [...this.updates],
    };
  }

  getRecentUpdates(count = 10): PendingUpdate[] {
    return this.updates.slice(-count);
  }

  getTimeSinceLastUpdate(): number | null {
    if (this.updates.length === 0) return null;
    return Date.now() - this.updates[this.updates.length - 1].timestamp;
  }

  markPending(origin?: unknown): void {
    const pending = this.updates.filter((u) => !u.applied);
    if (origin !== undefined) {
      pending.filter((u) => u.origin === origin).forEach((u) => (u.applied = false));
    } else {
      pending.forEach((u) => (u.applied = false));
    }
  }

  clearHistory(): void {
    this.updates = [];
  }

  private cleanup(): void {
    const cutoff = Date.now() - 60000;
    this.updates = this.updates.filter((u) => u.timestamp > cutoff);
  }

  destroy(): void {
    this.doc.off("update", this.onUpdate);
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.updates = [];
  }
}
