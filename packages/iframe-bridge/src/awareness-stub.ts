import * as Y from "yjs";
import { Observable } from "./observable";

export type AwarenessStubEvent = "change" | "update" | "destroy";

export interface AwarenessChange {
  added: number[];
  updated: number[];
  removed: number[];
}

/**
 * Duck-typed replacement for `y-protocols/awareness`'s `Awareness` that lives
 * inside the iframe. It does not actually maintain CRDT state on its own – the
 * source of truth is the host's `Awareness`. The stub:
 *
 *  - holds a snapshot Map<clientID, state> updated via `_applySnapshot`
 *  - forwards `setLocalState`/`setLocalStateField` to the host via `onSetState`
 *  - emits `change` and `update` events matching the real Awareness signature,
 *    so existing consumers (e.g. `y-mxgraph`'s `Binding`) keep working.
 */
export class AwarenessStub extends Observable<AwarenessStubEvent> {
  readonly doc: Y.Doc;
  readonly clientID: number;
  /** Mirrors the host's view of this iframe's local state. */
  private localState: Record<string, unknown> | null = null;
  private states = new Map<number, Record<string, unknown>>();

  constructor(
    doc: Y.Doc,
    private readonly onSetState: (
      state: Record<string, unknown> | null,
    ) => void,
  ) {
    super();
    this.doc = doc;
    this.clientID = doc.clientID;
  }

  // ---- public API matching y-protocols Awareness ------------------------

  getLocalState(): Record<string, unknown> | null {
    return this.localState;
  }

  setLocalState(state: Record<string, unknown> | null): void {
    this.localState = state ? { ...state } : null;
    this.onSetState(this.localState);
  }

  setLocalStateField(field: string, value: unknown): void {
    const next: Record<string, unknown> = { ...(this.localState ?? {}) };
    if (value === undefined) {
      delete next[field];
    } else {
      next[field] = value;
    }
    this.setLocalState(next);
  }

  getStates(): Map<number, Record<string, unknown>> {
    return this.states;
  }

  // ---- bridge-internal --------------------------------------------------

  /**
   * Apply a snapshot from the host. Diffs against the current states map and
   * emits `change`/`update` events with the same payload shape as Awareness.
   */
  _applySnapshot(
    snapshot: Array<[number, Record<string, unknown>]>,
    origin: unknown = "remote",
  ): void {
    const next = new Map<number, Record<string, unknown>>(snapshot);
    const prev = this.states;

    const added: number[] = [];
    const updated: number[] = [];
    const removed: number[] = [];

    for (const [id, state] of next) {
      if (!prev.has(id)) {
        added.push(id);
      } else if (!shallowEqual(prev.get(id)!, state)) {
        updated.push(id);
      }
    }
    for (const id of prev.keys()) {
      if (!next.has(id)) removed.push(id);
    }

    this.states = next;
    // Track our local state mirror, so getLocalState() stays in sync after host
    // applied our setLocalState (the host may have transformed/cleared it).
    if (next.has(this.clientID)) {
      this.localState = next.get(this.clientID)!;
    } else {
      this.localState = null;
    }

    if (added.length + updated.length + removed.length > 0) {
      const change: AwarenessChange = { added, updated, removed };
      this.emit("change", [change, origin]);
      this.emit("update", [change, origin]);
    }
  }

  destroy(): void {
    this.emit("destroy", [this]);
    super.destroy();
  }
}

function shallowEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}
