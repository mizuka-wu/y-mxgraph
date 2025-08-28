/**
 * Yjs / mxGraph(drawio)转换工具
 */
import * as Y from "yjs";
import { parse } from "../helper/xml";
import { parse as parseMxFile } from "../models/mxfile";
import { parse as parseMxGraphModel } from "../models/mxGraphModel";

export function xml2doc(xml: string, _doc?: Y.Doc) {
  const doc = _doc || new Y.Doc();

  const object = parse(xml);

  if (object.mxfile) {
    // drawio文件
    parseMxFile(object.mxfile, doc);
  } else if (object.mxGraphModel) {
    // mxGraph数据
    parseMxGraphModel(object.mxGraphModel, doc);
  } else {
    throw new Error("不支持的文件格式");
  }

  return doc;
}
