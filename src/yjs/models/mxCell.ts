import * as Y from "yjs";
import { xml2js } from "xml-js";
import type { ElementCompact } from "xml-js";

export const key = "mxCell";
const mxGeometryKey = "mxGeometry";

export function parse(object: ElementCompact): Y.XmlElement {
  const xmlElement = new Y.XmlElement("mxCell");

  for (const attribute of Object.keys(object._attributes || {})) {
    xmlElement.setAttribute(
      attribute,
      `${object._attributes?.[attribute] || ""}`
    );
  }
  return xmlElement;
}

export function serialize(xmlElement: Y.XmlElement) {
  const attributes = {
    ...xmlElement.getAttributes(),
  };

  let mxGeometry: any = {};

  if (Reflect.has(attributes, mxGeometryKey)) {
    const mxGeometryString = Reflect.get(attributes, mxGeometryKey);

    try {
      mxGeometry = Reflect.get(
        xml2js(mxGeometryString!, { compact: true }),
        mxGeometryKey
      );
    } catch {
      //
    }

    Reflect.deleteProperty(attributes, mxGeometryKey);
  }

  return {
    _attributes: attributes,
    [mxGeometryKey]: mxGeometry,
  };
}
