import { type Awareness } from "y-protocols/awareness";

export function getAwarenessStateValue<T>(
  awareness: Awareness,
  key: string,
  clientId?: string | number
): T | null {
  const states = awareness.getStates();
  const id = clientId != null ? Number(clientId) : awareness.clientID;
  const clientState = states.get(id as number);
  if (!clientState) return null;
  if (!key) return clientState as T;
  return getByPath(clientState, key) as T | null;
}

function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null) return null;
    const key: string | number =
      Array.isArray(cur) && /^\d+$/.test(part) ? Number(part) : part;
    cur = (cur as Record<string, unknown>)?.[key];
  }
  return cur;
}

export function setAwarenessStateValue(
  awareness: Awareness,
  key: string,
  value: unknown,
  clientId?: string | number
): boolean {
  const id = clientId != null ? Number(clientId) : awareness.clientID;
  if (id !== awareness.clientID) return false;
  if (!key) {
    awareness.setLocalState(value as Record<string, unknown>);
    return true;
  }
  const current = (awareness.getLocalState() || {}) as Record<string, unknown>;
  const next = setByPath(current, key, value);
  awareness.setLocalState(next);
  return true;
}

function setByPath(obj: unknown, path: string, value: unknown): Record<string, unknown> {
  const parts = path.split(".");
  const root = Array.isArray(obj) ? obj.slice() : { ...(obj as Record<string, unknown>) };
  let cur: Record<string | number, unknown> = root as Record<string | number, unknown>;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isIndex = /^\d+$/.test(part);
    const key: string | number = isIndex ? Number(part) : part;
    const isLast = i === parts.length - 1;
    if (isLast) {
      cur[key] = value;
    } else {
      let next = cur[key];
      const nextIsIndex = /^\d+$/.test(parts[i + 1]);
      if (next == null) {
        next = nextIsIndex ? [] : {};
      } else {
        next = Array.isArray(next) ? next.slice() : { ...(next as Record<string, unknown>) };
      }
      cur[key] = next;
      cur = next as Record<string | number, unknown>;
    }
  }
  return root as Record<string, unknown>;
}
