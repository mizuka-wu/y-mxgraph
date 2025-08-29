/**
 * 和drawiofile的转换
 *
 */
import * as Y from "yjs";
import {
  parse as parseDiagram,
  key as diagramKey,
  serialize as serializeDiagram,
} from "./diagram";
import type { Diagram } from "./diagram";
import type { ElementCompact } from "xml-js";

export const key = "mxfile";

export type YMxFile = Y.Map<{
  pages: string;
  [diagramKey]: Y.Array<Y.XmlElement>;
}>;

export interface MxFile extends ElementCompact {
  [diagramKey]: Diagram[];
}

export function parse(object: MxFile, doc: Y.Doc) {
  const mxfile = doc.getMap(key);
  mxfile.set("pages", (object._attributes?.pages || "1") + "");
  const diagrams = new Y.Array();
  diagrams.push(object.diagram.map((diagram) => parseDiagram(diagram)));
  mxfile.set(diagramKey, diagrams);
  return mxfile;
}

export function serializer(yMxFile: YMxFile): ElementCompact {
  const obj: any = {
    _attributes: {
      pages: yMxFile.get("pages") || "1",
    },
    [diagramKey]: (
      yMxFile.get(diagramKey) as unknown as Y.Array<Y.XmlElement>
    ).map((diagramElement) => serializeDiagram(diagramElement)),
  };

  return obj;
}
