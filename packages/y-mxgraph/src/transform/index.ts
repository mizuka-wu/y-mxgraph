import * as Y from "yjs";
import { parse, serializer } from "../helper/xml";
import {
  parse as parseMxFile,
  key as mxfileKey,
  serializer as serializerMxFile,
  type YMxFile,
} from "../models/mxfile";
import {
  parse as parseMxGraphModel,
  key as mxGraphModelKey,
  serialize as serializerMxGraphModel,
  type YMxGraphModel,
} from "../models/mxGraphModel";

export function xml2ydoc(xml: string, doc: Y.Doc): Y.Doc {
  const object = parse(xml);

  const mxfile = (object as Record<string, unknown>).mxfile;
  const mxGraphModel = (object as Record<string, unknown>).mxGraphModel;
  if (mxfile) {
    doc.transact(() => {
      parseMxFile(mxfile as import("../models/mxfile").MxFile, doc);
    });
  } else if (mxGraphModel) {
    doc.transact(() => {
      parseMxGraphModel(
        mxGraphModel as import("../models/mxGraphModel").MxGraphModel,
        doc,
      );
    });
  } else {
    throw new Error("不支持的文件格式");
  }

  return doc;
}

export function ydoc2xml(doc: Y.Doc, spaces = 0): string {
  if (doc.share.has(mxfileKey)) {
    return serializer(
      {
        [mxfileKey]: serializerMxFile(doc.getMap(mxfileKey)),
      },
      spaces,
    );
  }
  if (doc.share.has(mxGraphModelKey)) {
    return serializer(
      {
        [mxGraphModelKey]: serializerMxGraphModel(doc.getMap(mxGraphModelKey)),
      },
      spaces,
    );
  }

  return "";
}
