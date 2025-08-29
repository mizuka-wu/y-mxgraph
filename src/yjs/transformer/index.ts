/**
 * Yjs / mxGraph(drawio)转换工具
 */
import * as Y from "yjs";
import { parse } from "../helper/xml";
import { parse as parseMxFile, key as mxfileKey } from "../models/mxfile";
import {
  parse as parseMxGraphModel,
  key as mxGraphKey,
} from "../models/mxGraphModel";

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

export function doc2xml(doc: Y.Doc): string {
  if (doc.share.has(mxfileKey)) {
    return "";
  } else if (doc.share.has(mxGraphKey)) {
    console.warn("暂不支持");
    return "";
  }

  console.warn("无支持的文件类型");
  return "";
}
