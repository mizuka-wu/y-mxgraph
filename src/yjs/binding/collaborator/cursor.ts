import { throttle } from "lodash-es";
import { colord } from "colord";
import { createCursorImage } from "../../helper/cursor";

import { type Awareness } from "y-protocols/awareness";
import { type RemoteCursor } from "./index";

export const CacheKey = "__remoteCursor__";

function createCursorEl(color: string, username: string) {
  const cursor = document.createElement("div");
  cursor.style.position = "absolute";
  cursor.style.opacity = "0.9";
  cursor.style.transition = "all 0.3s ease-in-out";

  const img = document.createElement("img");
  img.style.transform = "rotate(-45deg)translateX(-14px)";
  img.setAttribute("src", createCursorImage(color));
  img.style.width = "10px";
  img.style.transition = "all 0.3s ease-in-out";
  cursor.appendChild(img);

  const name = document.createElement("div");
  name.style.backgroundColor = color;
  name.style.color = colord(color).isDark() ? "#fff" : "#000";
  name.style.fontSize = "9pt";
  name.style.padding = "3px 7px";
  name.style.marginTop = "8px";
  name.style.borderRadius = "10px";
  name.style.maxWidth = "100px";
  name.style.overflow = "hidden";
  name.style.textOverflow = "ellipsis";
  name.style.whiteSpace = "nowrap";

  name.innerText = username;
  cursor.appendChild(name);
  return cursor;
}

function getOffset(a: any, b: any) {
  for (
    var c = 0,
      d = 0,
      e = !1,
      f = a,
      g = document.body,
      k = document.documentElement;
    null != f && f != g && f != k && !e;

  ) {
    var l = mxUtils.getCurrentStyle(f);
    null != l && (e = e || "fixed" == l.position);
    f = f.parentNode;
  }
  b ||
    e ||
    ((b = mxUtils.getDocumentScrollOrigin(a.ownerDocument)),
    (c += b.x),
    (d += b.y));
  a = a.getBoundingClientRect();
  null != a && ((c += a.left), (d += a.top));
  return new mxPoint(c, d);
}

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
      const containerRect = graph.container.getBoundingClientRect();
      const { translate, scale } = graph.view;

      const x = Math.round(
        (event.evt.clientX - containerRect.x + graph.container.scrollLeft) /
          scale -
          translate.x
      );
      const y = Math.round(
        (event.evt.clientY - containerRect.y + graph.container.scrollTop) /
          scale -
          translate.y
      );

      awareness.setLocalStateField("cursor", {
        x,
        y,
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
    Reflect.set(ui, CacheKey, new Map<number, HTMLDivElement>());
  }

  const cache = Reflect.get(ui, CacheKey) as Map<number, HTMLDivElement>;

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
  const leaveRemotesIds = new Set<number>();

  Array.from(cache.keys()).forEach((clientId) => {
    if (!remotes.has(clientId)) {
      leaveRemotesIds.add(clientId);
    }
  });

  Array.from(remotes.values()).forEach((remote) => {
    if (remote.cursorState?.pageId === currentPageId) {
      currentPageRemotes.push(remote);
    } else {
      otherPageRemotes.push(remote);
    }
  });

  // 移除离开的
  leaveRemotesIds.forEach((clientId) => {
    const el = cache.get(clientId);
    cache.delete(clientId);
    if (!el) return;
    el.remove();
  });

  // 移除非当前页的
  otherPageRemotes.forEach(({ clientId }) => {
    const el = cache.get(clientId);
    if (!el) return;
    el.remove();
  });

  if (!currentPageRemotes.length) {
    return;
  }

  const graph = ui.editor.graph;
  const { translate, scale } = graph.view;

  currentPageRemotes.forEach(
    ({ clientId, cursorState, userColor, userName }) => {
      if (!cursorState) return;
      let el = cache.get(clientId);
      if (!el) {
        el = createCursorEl(userColor, userName);
        ui.diagramContainer.appendChild(el);
        cache.set(clientId, el);
      }

      const x = (translate.x + cursorState.x) * scale + 8;
      const y = (translate.y + cursorState.y) * scale - 12;

      const cx = Math.max(
        graph.container.scrollLeft,
        Math.min(
          graph.container.scrollLeft +
            graph.container.clientWidth -
            el.clientWidth,
          x
        )
      );

      const cy = Math.max(
        graph.container.scrollTop - 22,
        Math.min(
          graph.container.scrollTop +
            graph.container.clientHeight -
            el.clientHeight,
          y
        )
      );
      el.style.left = cx + "px";
      el.style.top = cy + "px";
      el.style.display = "";
    }
  );
}
