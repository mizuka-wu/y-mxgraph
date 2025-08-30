/**
 * 绑定yDoc和drawioFile/mxGraphModel
 * @todo 绑定mxGraphModel
 */
import { throttle } from "lodash-es";
import { xml2doc } from "../transformer";
import { applyFilePatch, generatePatch } from "./patch";
import { getId } from "../helper/getId";
import { key as mxfileKey, type YMxFile } from "../models/mxfile";
import * as Y from "yjs";
import { type Awareness } from "y-protocols/awareness";

/**
 * 绑定yDoc和drawioFile
 */
export function bindDrawioFile(
  file: any,
  options: {
    mouseMoveThrottle?: number;
    doc?: Y.Doc | null;
    awareness?: Awareness;
  } = {}
) {
  const doc = options?.doc || new Y.Doc();

  if (!doc.share.has(mxfileKey)) {
    xml2doc(file.data, doc);
  }

  const graph = file.getUi().editor.graph;
  const mxGraphModel = graph.model;
  const mouseMoveThrottle = options.mouseMoveThrottle || 100;
  // 绑定本地的change到yDoc
  mxGraphModel.addListener("change", () => {
    const patch = file.ui.diffPages(file.shadowPages, file.ui.pages);
    file.setShadowPages(file.ui.clonePages(file.ui.pages));
    applyFilePatch(doc, patch);
  });

  // 监听remoteChange
  doc
    .getMap(mxfileKey)
    .observeDeep(
      (
        events: Y.YEvent<
          Y.XmlElement | Y.Array<string> | Y.Map<Y.XmlElement> | YMxFile
        >[],
        transaction: Y.Transaction
      ) => {
        // 远端的origin
        if (transaction.local) return;
        const patch = generatePatch(events);
        console.log(patch, events);
      }
    );

  // 当前用户信息到awareness
  if (options.awareness) {
    // 绑定鼠标事件
    graph.addMouseListener({
      startX: 0,
      startY: 0,
      scrollLeft: 0,
      scrollTop: 0,
      mouseDown: function (_: any) {
        //
      },
      mouseUp: function (_: any) {
        //
      },
      mouseMove: throttle(function (
        _: any,
        event: {
          graphX: number;
          graphY: number;
          evt: MouseEvent;
        }
      ) {
        options.awareness?.setLocalStateField("cursor", {
          x: event.graphX,
          y: event.graphY,
          pageId: file.getUi().currentPage?.getId(),
        });
      }, mouseMoveThrottle),
    });

    // 绑定选区事件
    graph
      .getSelectionModel()
      .addListener("change", function (_: any, evt: any) {
        const pageId = file.getUi().currentPage?.getId();
        const added = (evt.getProperty("added") || []).map(getId);
        const removed = (evt.getProperty("removed") || []).map(getId);

        options.awareness?.setLocalStateField("selection", {
          added,
          removed,
          pageId,
        });
      });
  }

  return doc;
}
