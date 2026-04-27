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

export function xml2doc(xml: string, doc: Y.Doc): Y.Doc {
  const object = parse(xml);

  if (object.mxfile) {
    doc.transact(() => {
      parseMxFile(object.mxfile, doc);
    });
  } else if (object.mxGraphModel) {
    doc.transact(() => {
      parseMxGraphModel(object.mxGraphModel, doc);
    });
  } else {
    throw new Error("不支持的文件格式");
  }

  return doc;
}

export function doc2xml(doc: Y.Doc, spaces = 0): string {
  if (doc.share.has(mxfileKey)) {
    return serializer(
      {
        [mxfileKey]: serializerMxFile(
          doc.share.get(mxfileKey) as unknown as YMxFile,
        ),
      },
      spaces,
    );
  } else if (doc.share.has(mxGraphModelKey)) {
    return serializer(
      {
        [mxGraphModelKey]: serializerMxGraphModel(
          doc.share.get(mxGraphModelKey) as unknown as YMxGraphModel,
        ),
      },
      spaces,
    );
  }

  return "";
}
