/**
 * 和drawiofile的转换
 *
 */
import * as Y from "yjs";
import { parse as parseDiagram } from "./diagram";
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
    xmlElement.nodeName = "xmlfile";
    xmlElement.insert(
      0,
      object.diagram.map((diagram) => parseDiagram(diagram))
    );
  });
}
