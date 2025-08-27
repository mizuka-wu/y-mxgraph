/**
 * Yjs / mxGraph(drawio)转换工具
 */
import * as Y from "yjs";
import { parse } from "./helper/xml";

export function createDocFromXml(xml: string) {
  const doc = new Y.Doc();

  const object = parse(xml);
  console.log(object);

  return doc;
}
