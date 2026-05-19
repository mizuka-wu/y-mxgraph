import { throttle } from "../../helper/throttle";
import { colord } from "colord";
import { createCursorImage } from "../../helper/cursor";

import { type Awareness } from "y-protocols/awareness";
import { type RemoteCursor } from "./index";
import type { DrawioFile, MxGraph } from "../../types/drawio";

export const CacheKey = "__remoteCursor__";

function createCursorEl(color: string, username: string, userAccount?: string) {
  const cursor = document.createElement("div");
  cursor.style.position = "absolute";
  cursor.style.opacity = "0.9";
  cursor.style.transition = "all 0.3s ease-in-out";

  const img = document.createElement("img");
  img.style.transform = "rotate(-45deg) translateX(-14px)";
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
  name.style.maxWidth = "140px";
  name.style.overflow = "hidden";
  name.style.textOverflow = "ellipsis";
  name.style.whiteSpace = "nowrap";

  name.innerText = userAccount ? `${username} (${userAccount})` : username;
  cursor.appendChild(name);
  return cursor;
}

export function bindCursor(
  file: DrawioFile,
  options: {
    awareness: Awareness;
    graph?: MxGraph;
    mouseMoveThrottle?: number;
  },
) {
  const graph = options.graph || file.getUi().editor.graph;
  const awareness = options.awareness;
  const mouseMoveThrottle = options.mouseMoveThrottle ?? 100;

  const listener = {
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
    mouseDown: function () {},
    mouseUp: function () {},
    mouseMove: throttle(function (
      _sender: unknown,
      event: { graphX: number; graphY: number; evt: MouseEvent },
    ) {
      const containerRect = graph.container.getBoundingClientRect();
      const { translate, scale } = graph.view;

      const x = Math.round(
        (event.evt.clientX - containerRect.x + graph.container.scrollLeft) /
          scale -
          translate.x,
      );
      const y = Math.round(
        (event.evt.clientY - containerRect.y + graph.container.scrollTop) /
          scale -
          translate.y,
      );

      awareness.setLocalStateField("cursor", {
        x,
        y,
        pageId: file.getUi().currentPage?.getId(),
      });
    }, mouseMoveThrottle),
  };

  graph.addMouseListener(listener);

  // 鼠标离开画布时隐藏光标
  const handleMouseLeave = () => {
    awareness.setLocalStateField("cursor", {
      x: 0,
      y: 0,
      pageId: file.getUi().currentPage?.getId(),
      hide: true,
    });
  };
  graph.container.addEventListener("mouseleave", handleMouseLeave);

  return () => {
    graph.removeMouseListener(listener);
    graph.container.removeEventListener("mouseleave", handleMouseLeave);
  };
}

export function renderRemoteCursors(
  ui: {
    editor: { graph: MxGraph };
    currentPage?: { getId(): string } | null;
    diagramContainer: HTMLElement;
  },
  remotes: Map<number, RemoteCursor>,
) {
  if (!(CacheKey in ui)) {
    (ui as Record<string, unknown>)[CacheKey] = new Map<
      number,
      HTMLDivElement
    >();
  }

  const cache = (ui as Record<string, unknown>)[CacheKey] as Map<
    number,
    HTMLDivElement
  >;
  const currentPageId = ui.currentPage?.getId();

  if (!currentPageId) {
    Array.from(cache.values()).forEach((el) => el.remove());
    cache.clear();
    return;
  }

  const currentPageRemotes: RemoteCursor[] = [];
  const otherPageRemotes: RemoteCursor[] = [];
  const leaveRemotesIds = new Set<number>();

  Array.from(cache.keys()).forEach((clientId) => {
    if (!remotes.has(clientId)) leaveRemotesIds.add(clientId);
  });

  Array.from(remotes.values()).forEach((remote) => {
    if (remote.cursorState?.pageId === currentPageId) {
      currentPageRemotes.push(remote);
    } else {
      otherPageRemotes.push(remote);
    }
  });

  leaveRemotesIds.forEach((clientId) => {
    const el = cache.get(clientId);
    cache.delete(clientId);
    if (!el) return;
    el.remove();
  });

  otherPageRemotes.forEach(({ clientId }) => {
    const el = cache.get(clientId);
    if (!el) return;
    el.remove();
  });

  if (!currentPageRemotes.length) return;

  const graph = ui.editor.graph;
  const { translate, scale } = graph.view;

  currentPageRemotes.forEach(
    ({ clientId, cursorState, userColor, userName, userAccount }) => {
      if (!cursorState) return;
      let el = cache.get(clientId);

      // 隐藏状态：移除光标元素
      if (cursorState.hide) {
        if (el) {
          el.remove();
          cache.delete(clientId);
        }
        return;
      }

      if (!el) {
        el = createCursorEl(userColor, userName, userAccount);
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
          x,
        ),
      );

      const cy = Math.max(
        graph.container.scrollTop - 22,
        Math.min(
          graph.container.scrollTop +
            graph.container.clientHeight -
            el.clientHeight,
          y,
        ),
      );
      el.style.left = cx + "px";
      el.style.top = cy + "px";
      el.style.display = "";
    },
  );
}
