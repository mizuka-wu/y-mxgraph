/**
 * 绑定yDoc和drawioFile/mxGraphModel
 */
import * as Y from "yjs";
import { throttle } from "lodash-es";
import { xml2doc } from "../transformer";
import { applyFilePatch, generatePatch } from "./patch";
import { getId } from "../helper/getId";
import { key as mxfileKey, type YMxFile } from "../models/mxfile";
import { getAwarenessStateValue } from "../helper/awarenessStateValue";
import { type Awareness } from "y-protocols/awareness";

export const DEFAULT_USER_NAME_KEY = "user.name";
export const DEFAULT_USER_COLOR_KEY = "user.color";

/**
 * 绑定yDoc和drawioFile
 */
export function bindDrawioFile(
  file: any,
  options: {
    mouseMoveThrottle?: number;
    doc?: Y.Doc | null;
    awareness?: Awareness;
    cursor?:
      | boolean
      | {
          userNameKey?: string;
          userColorKey?: string;
        };
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
    console.log("local patch", patch);
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
        console.log("remote patch", patch);

        /**
         * 应用patch
         */
        file.patch([patch]);
      }
    );

  // 当前用户信息到awareness
  if (options.awareness) {
    const awareness = options.awareness!;
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
        awareness.setLocalStateField("cursor", {
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

        awareness.setLocalStateField("selection", {
          added,
          removed,
          pageId,
        });
      });

    // 绘制其他人选区
    const showCursor = options.cursor ?? true;
    if (typeof showCursor === "boolean" && showCursor) {
      // 同步光标
      options.awareness.on("update", () => {
        const otherCursors = awareness.getStates();
        const cursorOpt = options.cursor;
        const userNameKey =
          typeof cursorOpt === "object" && cursorOpt?.userNameKey
            ? cursorOpt.userNameKey
            : DEFAULT_USER_NAME_KEY;
        const userColorKey =
          typeof cursorOpt === "object" && cursorOpt?.userColorKey
            ? cursorOpt.userColorKey
            : DEFAULT_USER_COLOR_KEY;
        /**
         * 排除自己的client以及非当前页面的 cursor/selection 整理一个列表
         */
        const cursorList = Array.from(otherCursors.entries())
          .filter(([clientId]) => clientId !== awareness.clientID)
          .map(([clientId]) => {
            const cursor = getAwarenessStateValue(
              awareness,
              "cursor",
              clientId
            );
            const selection = getAwarenessStateValue(
              awareness,
              "selection",
              clientId
            );
            return {
              clientId,
              cursor,
              selection,
              userName: getAwarenessStateValue(
                awareness,
                userNameKey,
                clientId
              ),
              userColor: getAwarenessStateValue(
                awareness,
                userColorKey,
                clientId
              ),
            };
          });

        console.log(cursorList);
      });
    }
  }

  return doc;
}
