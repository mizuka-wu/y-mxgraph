import { throttle } from "lodash-es";
import { createCursorImage } from "../../helper/cursor";

import { type Awareness } from "y-protocols/awareness";
import { type RemoteCursor } from "./index";

export const CacheKey = "__remoteCursor__";

export function bindCursor(
  file: any,
  options: {
    awareness: Awareness;
    graph?: any;
    mouseMoveThrottle?: number;
  }
) {
  const graph = options.graph || file.getUi().editor.graph;
  const awareness = options.awareness;
  const mouseMoveThrottle = options.mouseMoveThrottle ?? 100;

  const listener: any = {
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
    mouseDown: function (_: any) {},
    mouseUp: function (_: any) {},
    mouseMove: throttle(function (
      _: any,
      event: { graphX: number; graphY: number; evt: MouseEvent }
    ) {
      awareness.setLocalStateField("cursor", {
        x: event.graphX,
        y: event.graphY,
        pageId: file.getUi().currentPage?.getId(),
      });
    },
    mouseMoveThrottle),
  };

  graph.addMouseListener(listener);
}

export function renderRemoteCursors(
  ui: any,
  remotes: Map<number, RemoteCursor>
) {
  if (!Reflect.has(ui, CacheKey)) {
    Reflect.set(ui, CacheKey, new Map<number, SVGElement>());
  }

  const cache = Reflect.get(ui, CacheKey) as Map<number, SVGElement>;

  const currentPageId = ui.currentPage?.getId();

  if (!currentPageId) {
    /**
     * 清理/关闭
     */
    Array.from(cache.values()).forEach((el) => {
      el.remove();
    });
    cache.clear();
    return;
  }

  const currentPageRemotes: RemoteCursor[] = [];
  const otherPageRemotes: RemoteCursor[] = [];

  Array.from(remotes.values()).forEach((remote) => {
    if (remote.cursorState?.pageId === currentPageId) {
      currentPageRemotes.push(remote);
    } else {
      otherPageRemotes.push(remote);
    }
  });

  // 移除非当前页的
  otherPageRemotes.forEach(({ clientId }) => {
    const el = cache.get(clientId);
    if (!el) return;
    el.remove();
  });

  currentPageRemotes.forEach(({ clientId, cursorState }) => {
    if (!cursorState) return;
    const el = cache.get(clientId);
    if (!el) return;

    // el.setAttribute("x", cursorState.x.toString());
    // el.setAttribute("y", cursorState.y.toString());
    // el.setAttribute("pageId", cursorState.pageId);
    // el.setAttribute("selection", JSON.stringify(selectionState));
  });
}
