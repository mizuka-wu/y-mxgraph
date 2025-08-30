import * as Y from "yjs";
import { xml2js, js2xml } from "xml-js";
import type { ElementCompact } from "xml-js";

export const key = "mxCell";

/**
 * 针对mxGeometry的特殊处理
 */
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

  let mxGeometry: any = null;

  if (Reflect.has(attributes, mxGeometryAttributeKey)) {
    const mxGeometryString = Reflect.get(attributes, mxGeometryAttributeKey);
    try {
      mxGeometry = Reflect.get(
        xml2js(mxGeometryString!, { compact: true }),
        mxGeometryKey
      );

      mxGeometry._attributes["as"] = "geometry"; // todo
    } catch {
      //
    }

    Reflect.deleteProperty(attributes, mxGeometryAttributeKey);
  }

  const obj: any = {
    _attributes: attributes,
  };

  if (mxGeometry) {
    obj[mxGeometryKey] = mxGeometry;
  }

  return obj;
}
