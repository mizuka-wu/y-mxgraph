import { xml2js, js2xml, type ElementCompact } from "xml-js";

function deepProcess(node: any): void {
  if (node == null) return;

  if (Array.isArray(node)) {
    for (const item of node) {
      deepProcess(item);
    }
    return;
  }

  if (typeof node !== "object") return;

  const keys = Object.keys(node);
  for (const key of keys) {
    if (key === "_attributes") continue;

    let value = node[key];
    const keyLower = key.toLowerCase();

    if (
      (keyLower === "diagram" || keyLower === "mxcell") &&
      value !== undefined &&
      !Array.isArray(value)
    ) {
      node[key] = [value];
      value = node[key];
    }

    if (Array.isArray(value)) {
      for (const v of value) deepProcess(v);
    } else if (value && typeof value === "object") {
      deepProcess(value);
    }
  }
}

export function parse(xml: string) {
  const result = xml2js(xml, { compact: true }) as any;
  deepProcess(result);
  return result;
}

export function serializer(obj: ElementCompact, spaces = 2) {
  return js2xml(obj, {
    compact: true,
    spaces,
  });
}
