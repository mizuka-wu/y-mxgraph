import { xml2js, js2xml, type ElementCompact } from "xml-js";

function deepProcess(node: unknown): void {
  if (node == null) return;

  if (Array.isArray(node)) {
    for (const item of node) {
      deepProcess(item);
    }
    return;
  }

  if (typeof node !== "object") return;

  const obj = node as Record<string, unknown>;
  const keys = Object.keys(obj);
  for (const key of keys) {
    if (key === "_attributes") continue;

    let value = obj[key];
    const keyLower = key.toLowerCase();

    if (
      (keyLower === "diagram" || keyLower === "mxcell") &&
      value !== undefined &&
      !Array.isArray(value)
    ) {
      obj[key] = [value];
      value = obj[key];
    }

    if (Array.isArray(value)) {
      for (const v of value) deepProcess(v);
    } else if (value && typeof value === "object") {
      deepProcess(value);
    }
  }
}

export function parse(xml: string) {
  const result = xml2js(xml, { compact: true }) as Record<string, unknown>;
  deepProcess(result);
  return result;
}

export function serializer(obj: ElementCompact, spaces = 2) {
  return js2xml(obj, {
    compact: true,
    spaces,
  });
}
