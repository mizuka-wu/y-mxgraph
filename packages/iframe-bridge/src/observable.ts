/**
 * Minimal Observable that mirrors the subset of `lib0/observable` that
 * y-protocols' Awareness exposes (`on`, `once`, `off`, `emit`, `destroy`).
 * Keeping it local avoids pulling lib0 as a hard dep.
 */
export class Observable<EVENTS extends string = string> {
  private _observers = new Map<EVENTS, Set<(...args: any[]) => void>>();

  on(name: EVENTS, fn: (...args: any[]) => void): void {
    let set = this._observers.get(name);
    if (!set) {
      set = new Set();
      this._observers.set(name, set);
    }
    set.add(fn);
  }

  once(name: EVENTS, fn: (...args: any[]) => void): void {
    const wrap = (...args: any[]) => {
      this.off(name, wrap);
      fn(...args);
    };
    this.on(name, wrap);
  }

  off(name: EVENTS, fn: (...args: any[]) => void): void {
    const set = this._observers.get(name);
    if (set) {
      set.delete(fn);
      if (set.size === 0) this._observers.delete(name);
    }
  }

  emit(name: EVENTS, args: any[]): void {
    const set = this._observers.get(name);
    if (!set) return;
    // copy to allow off() during emit
    for (const fn of Array.from(set)) {
      try {
        fn(...args);
      } catch (err) {
        console.error("[y-mxgraph/iframe-bridge] observer threw:", err);
      }
    }
  }

  destroy(): void {
    this._observers.clear();
  }
}
