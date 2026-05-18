import * as Y from "yjs";
import { getMap, getArray } from "../helper/yjs";
import {
  parse as parseDiagram,
  key as diagramKey,
  serialize as serializeDiagram,
} from "./diagram";
import type { Diagram, YDiagram } from "./diagram";
import type { ElementCompact } from "xml-js";

export const key = "mxfile";
export const diagramOrderKey = diagramKey + "Order";

export type YMxFile = Y.Map<unknown>;

export interface MxFile extends ElementCompact {
  diagram: Diagram[];
}

export function parse(object: MxFile, doc: Y.Doc) {
  const mxfile = doc.getMap(key);
  mxfile.set("pages", (object._attributes?.pages || "1") + "");

  const diagramList = object.diagram.map((diagram) => ({
    value: parseDiagram(diagram),
    id: (diagram._attributes?.id || "") as string,
  }));
  const diagramMap = new Y.Map<YDiagram>();
  const diagramOrder = new Y.Array<string>();
  diagramList.forEach((diagram) => {
    diagramMap.set(diagram.id, diagram.value);
  });
  diagramOrder.push(diagramList.map((diagram) => diagram.id));

  mxfile.set(diagramKey, diagramMap);
  mxfile.set(diagramOrderKey, diagramOrder);
  return mxfile;
}

export function serializer(yMxFile: YMxFile): ElementCompact {
  const diagrams = getMap<YDiagram>(yMxFile, diagramKey);
  const diagramOrder = getArray<string>(yMxFile, diagramOrderKey);

  const orderIds = diagramOrder ? diagramOrder.toArray() : [];
  // 如果 diagramOrder 为空但 diagram map 不为空,使用 diagram map 中的所有 ID
  const ids =
    orderIds.length > 0
      ? orderIds
      : diagrams
        ? Array.from(diagrams.keys())
        : [];

  const obj: Record<string, unknown> = {
    _attributes: {
      pages: (yMxFile.get("pages") as string) || "1",
    },
    [diagramKey]: ids
      .map((id) => diagrams!.get(id) as YDiagram)
      .filter((d): d is YDiagram => !!d)
      .map((diagramElement) => serializeDiagram(diagramElement)),
  };

  return obj as ElementCompact;
}
