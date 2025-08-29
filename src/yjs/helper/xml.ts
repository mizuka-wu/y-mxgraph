import { xml2js, js2xml, type ElementCompact } from "xml-js";

function deepProcess(node: any): void {
  if (node == null) return;

  // 处理数组
  if (Array.isArray(node)) {
    for (const item of node) {
      deepProcess(item);
    }
    return;
  }

  // 非对象不处理
  if (typeof node !== "object") return;

  const keys = Object.keys(node);
  for (const key of keys) {
    if (key === "_attributes") continue; // 跳过属性对象

    let value = node[key];
    const keyLower = key.toLowerCase();

    // 规范化：diagram / mxCell 若为单个对象，统一转为数组
    if (
      (keyLower === "diagram" || keyLower === "mxcell") &&
      value !== undefined &&
      !Array.isArray(value)
    ) {
      node[key] = [value];
      value = node[key];
    }

    // 特殊处理 mxCell：如果包含 mxGeometry，则把它移动到 _attributes 上
    if (keyLower === "mxcell") {
      const attachGeometry = (cell: any) => {
        if (cell && typeof cell === "object" && cell.mxGeometry !== undefined) {
          if (!cell._attributes || typeof cell._attributes !== "object") {
            cell._attributes = {};
          }

          // 将 mxGeometry 移动到 _attributes，键名保持为 mxGeometry
          (cell._attributes as any).mxGeometry = js2xml(
            {
              mxGeometry: cell.mxGeometry,
            },
            {
              compact: true,
            }
          );
          delete cell.mxGeometry;
        }
      };

      if (Array.isArray(value)) {
        for (const v of value) attachGeometry(v);
      } else {
        attachGeometry(value);
      }
    }

    // 继续递归（除 _attributes 外的所有键）
    if (Array.isArray(value)) {
      for (const v of value) deepProcess(v);
    } else if (value && typeof value === "object") {
      deepProcess(value);
    }
  }
}

/**
 * xml 转换为 js 对象
 * @param xml
 * @returns
 */
export function parse(xml: string) {
  const result = xml2js(xml, { compact: true }) as any;

  // 深度遍历（紧凑结构）：跳过 _attributes；当 key 为 mxCell 时，若存在 mxGeometry，
  // 则移动到该对象的 _attributes.mxGeometry 上
  deepProcess(result);

  return result;
}

export function serializer(obj: ElementCompact) {
  return js2xml(obj, {
    compact: true,
  });
}
