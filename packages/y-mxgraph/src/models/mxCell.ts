import * as Y from "yjs";
import { xml2js, js2xml } from "xml-js";
import type { ElementCompact } from "xml-js";

export const key = "mxCell";

const mxGeometryKey = "mxGeometry";
const mxGeometryAttributeKey = "geometry";

export interface MxCellModel extends ElementCompact {
  [mxGeometryKey]?: ElementCompact;
}

export function parse(object: MxCellModel): Y.XmlElement {
  const xmlElement = new Y.XmlElement("mxCell");

  for (const attribute of Object.keys(object._attributes || {})) {
    xmlElement.setAttribute(
      attribute,
      `${object._attributes?.[attribute] || ""}`,
    );
  }

  if (object[mxGeometryKey]) {
    const geometry = object[mxGeometryKey];
    const geometryString = js2xml(
      { [mxGeometryKey]: geometry },
      {
        compact: true,
      },
    );
    xmlElement.setAttribute(mxGeometryAttributeKey, geometryString);
    delete object[mxGeometryKey];
  }

  return xmlElement;
}

export function serialize(xmlElement: Y.XmlElement) {
  const rawAttributes = {
    ...xmlElement.getAttributes(),
  };

  // 提取 mxGeometry(不需要转义,它本身就是 XML 字符串)
  let mxGeometry: ElementCompact | null = null;
  let mxGeometryString: string | undefined;

  if (mxGeometryAttributeKey in rawAttributes) {
    mxGeometryString = rawAttributes[mxGeometryAttributeKey];
    delete rawAttributes[mxGeometryAttributeKey];
  }

  // 转义其他属性值中的特殊字符
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawAttributes)) {
    if (typeof value === "string") {
      attributes[key] = value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
    } else if (value != null) {
      attributes[key] = String(value);
    }
  }

  // 解析 mxGeometry
  if (mxGeometryString) {
    try {
      const parsed = xml2js(mxGeometryString, { compact: true }) as Record<
        string,
        ElementCompact
      >;
      mxGeometry = parsed[mxGeometryKey] ?? null;
      if (mxGeometry && mxGeometry._attributes) {
        mxGeometry._attributes["as"] = "geometry";
      }
    } catch (e) {
      console.warn("[y-mxgraph] Failed to parse mxGeometry:", e);
    }
  }

  const obj: Record<string, unknown> = {
    _attributes: attributes,
  };

  if (mxGeometry) {
    obj[mxGeometryKey] = mxGeometry;
  }

  return obj;
}
