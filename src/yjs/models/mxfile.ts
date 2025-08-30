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
export const diagramOrderKey = diagramKey + "Order";

export type YMxFile = Y.Map<{
  pages: string;
  [diagramKey]: Y.Map<Y.XmlElement>;
  [diagramOrderKey]: Y.Array<string>;
}>;

export interface MxFile extends ElementCompact {
  [diagramKey]: Diagram[];
}

export function parse(object: MxFile, doc: Y.Doc) {
  const mxfile = doc.getMap(key);
  mxfile.set("pages", (object._attributes?.pages || "1") + "");

  const diagramList = object.diagram.map((diagram) => ({
    value: parseDiagram(diagram),
    id: diagram._attributes?.id! as string,
  }));
  const diagrams = new Y.Map<Y.XmlElement>();
  const diagramOrder = new Y.Array<string>();
  diagramList.forEach((diagram) => {
    diagrams.set(diagram.id, diagram.value);
  });
  diagramOrder.push(diagramList.map((diagram) => diagram.id));

  mxfile.set(diagramKey, diagrams);
  mxfile.set(diagramOrderKey, diagramOrder);
  return mxfile;
}

export function serializer(yMxFile: YMxFile): ElementCompact {
  const diagrams = yMxFile.get(diagramKey) as unknown as Y.Map<Y.XmlElement>;
  const diagramOrder = yMxFile.get(
    diagramOrderKey
  ) as unknown as Y.Array<string>;

  const obj: any = {
    _attributes: {
      pages: yMxFile.get("pages") || "1",
    },
    [diagramKey]: diagramOrder
      .map((id) => diagrams.get(id) as Y.XmlElement)
      .map((diagramElement) => serializeDiagram(diagramElement)),
  };

  return obj;
}
