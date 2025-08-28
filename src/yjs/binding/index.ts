/**
 * 绑定yDoc和drawioFile/mxGraphModel
 * @todo 绑定mxGraphModel
 */
import { createDocFromXml } from "../transformer";
import { applyFilePath } from "./patch";
import * as Y from "yjs";

/**
 * 绑定yDoc和drawioFile
 */
export function bindDrawioFile(file: any, _doc?: Y.Doc) {
  const doc = _doc || createDocFromXml(file.data);

  console.log(doc.share.get("mxfile")?.toJSON(), doc.share.get("mxfile"));

  const mxGraphModel = file.getUi().editor.graph.model;
  mxGraphModel.addListener("change", () => {
    const patch = file.ui.diffPages(file.shadowPages, file.ui.pages);
    file.setShadowPages(file.ui.clonePages(file.ui.pages));
    applyFilePath(doc, patch);
  });
}
