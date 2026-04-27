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
      `${object._attributes?.[attribute] || ""}`
    );
  }

  if (object[mxGeometryKey]) {
    const geometry = object[mxGeometryKey];
    const geometryString = js2xml(geometry, {
      compact: true,
    });
    xmlElement.setAttribute(mxGeometryAttributeKey, geometryString);
    delete object[mxGeometryKey];
  }

  return xmlElement;
}

export function serialize(xmlElement: Y.XmlElement) {
  const attributes = {
    ...xmlElement.getAttributes(),
  };

  let mxGeometry: ElementCompact | null = null;

  if (mxGeometryAttributeKey in attributes) {
    const mxGeometryString = attributes[mxGeometryAttributeKey];
    try {
      const parsed = xml2js(mxGeometryString!, { compact: true }) as Record<string, ElementCompact>;
      mxGeometry = parsed[mxGeometryKey] ?? null;
      if (mxGeometry && mxGeometry._attributes) {
        mxGeometry._attributes["as"] = "geometry";
      }
    } catch (e) {
      console.warn("[y-mxgraph] Failed to parse mxGeometry:", e);
    }
    delete attributes[mxGeometryAttributeKey];
  }

  const obj: Record<string, unknown> = {
    _attributes: attributes,
  };

  if (mxGeometry) {
    obj[mxGeometryKey] = mxGeometry;
  }

  return obj;
}
