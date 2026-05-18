import * as Y from "yjs";
import { getMap } from "../helper/yjs";
import {
  parse as parseMxGraphModel,
  serialize as serializeMxGraphModel,
  key as mxGraphModelKey,
  type MxGraphModel,
  type YMxGraphModel,
} from "./mxGraphModel";
import type { ElementCompact } from "xml-js";

export const key = "diagram";

export interface Diagram extends ElementCompact {
  mxGraphModel: MxGraphModel;
}

export type YDiagram = Y.Map<unknown>;

export function parse(object: Diagram): YDiagram {
  const yDiagramElement = new Y.Map();
  yDiagramElement.set("name", `${object._attributes?.name || ""}`);
  yDiagramElement.set("id", `${object._attributes?.id || ""}`);

  const mxGraphModel = parseMxGraphModel(object[mxGraphModelKey]);

  yDiagramElement.set(mxGraphModelKey, mxGraphModel);
  return yDiagramElement as YDiagram;
}

export function serialize(yDiagram: YDiagram) {
  const mxGraphModel = getMap(yDiagram, mxGraphModelKey);

  return {
    _attributes: {
      name: yDiagram.get("name") as string,
      id: yDiagram.get("id") as string,
    },
    [mxGraphModelKey]: mxGraphModel
      ? serializeMxGraphModel(mxGraphModel)
      : undefined,
  };
}
