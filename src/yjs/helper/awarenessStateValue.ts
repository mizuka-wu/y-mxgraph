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
  return getByPath(clientState, key);
}

function getByPath(obj: any, path: string) {
  const parts = path.split(".");
  let cur: any = obj;
  for (const part of parts) {
    if (cur == null) return null;
    const key: any =
      Array.isArray(cur) && /^\d+$/.test(part) ? Number(part) : part;
    cur = cur?.[key];
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
  // 只能设置本地客户端的 state，其他客户端的 state 是只读的
  if (id !== awareness.clientID) return false;
  if (!key) {
    awareness.setLocalState(value as any);
    return true;
  }
  const current = awareness.getLocalState() || {};
  const next = setByPath(current, key, value);
  awareness.setLocalState(next);
  return true;
}

function setByPath(obj: any, path: string, value: any) {
  const parts = path.split(".");
  const root: any = Array.isArray(obj) ? obj.slice() : { ...obj };
  let cur: any = root;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isIndex = /^\d+$/.test(part);
    const key: any = isIndex ? Number(part) : part;
    const isLast = i === parts.length - 1;
    if (isLast) {
      if (Array.isArray(cur) && isIndex) {
        cur[key] = value;
      } else {
        cur[key] = value;
      }
    } else {
      let next = cur[key];
      const nextIsIndex = /^\d+$/.test(parts[i + 1]);
      if (next == null) {
        next = nextIsIndex ? [] : {};
      } else {
        next = Array.isArray(next) ? next.slice() : { ...next };
      }
      cur[key] = next;
      cur = next;
    }
  }
  return root;
}
