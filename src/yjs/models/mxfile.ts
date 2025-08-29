/**
 * 和drawiofile的转换
 *
 */
import * as Y from "yjs";
import {
  parse as parseDiagram,
  key as diagramKey,
  serialize as diagramSerialize,
} from "./diagram";
import type { Diagram } from "./diagram";
import type { ElementCompact } from "xml-js";

export const key = "mxfile";
export interface MxFile extends ElementCompact {
  diagram: Diagram[];
}

export function parse(object: MxFile, doc: Y.Doc) {
  doc.transact(() => {
    const xmlElement = doc.getXmlElement(key);
    xmlElement.setAttribute("pages", (object._attributes?.pages || "1") + "");
    if (object._attributes?.id) {
      xmlElement.setAttribute("id", (object._attributes?.id || "") + "");
    }
    xmlElement.nodeName = key;
    xmlElement.insert(
      0,
      object.diagram.map((diagram) => parseDiagram(diagram))
    );
  });
}

export function serializer(xmlElement: Y.XmlElement): ElementCompact {
  const obj: any = {
    _attributes: {
      ...xmlElement.getAttributes(),
    },
    [diagramKey]: (
      xmlElement.querySelectorAll(diagramKey) as Y.XmlElement[]
    ).map((diagramElement) => diagramSerialize(diagramElement)),
  };

  return obj;
}
