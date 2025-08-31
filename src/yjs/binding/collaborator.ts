import { throttle } from "lodash-es";
import { type Awareness } from "y-protocols/awareness";
import {
  getAwarenessStateValue,
  setAwarenessStateValue,
} from "../helper/awarenessStateValue";
import { generateColor, generateRandomName } from "../helper/random";
import { getId } from "../helper/getId";
import { createCursorImage } from "../helper/cursor";

export const DEFAULT_USER_NAME_KEY = "user.name";
export const DEFAULT_USER_COLOR_KEY = "user.color";

type CursorState = {
  x: number;
  y: number;
  pageId?: string | null;
  hide?: boolean;
};

type RemoteEntry = {
  clientId: number;
  cursorEl: HTMLDivElement;
  imgEl: HTMLImageElement;
  labelEl: HTMLDivElement;
  lastCursor?: CursorState | null;
  userColor: string;
  userName: string;
};

export function bindCollaborator(
  file: any,
  options: {
    awareness: Awareness;
    graph?: any;
    cursor?: boolean | { userNameKey?: string; userColorKey?: string };
    mouseMoveThrottle?: number;
    debug?: boolean;
  }
) {
  const graph = options.graph || file.getUi().editor.graph;
  const awareness = options.awareness;
  const mouseMoveThrottle = options.mouseMoveThrottle ?? 100;
  const debug = options.debug ?? false;

  const dlog = (...args: any[]) => {
    if (debug) console.log("[collab]", ...args);
  };

  // 确保容器可作为绝对定位参考（避免 left/top 参照 body）
  if (graph?.container && getComputedStyle(graph.container).position === "static") {
    graph.container.style.position = "relative";
  }
  dlog("container-position", getComputedStyle(graph.container).position);

  const cursorOption = options.cursor;
  const userNameKey =
    typeof cursorOption === "object" && cursorOption?.userNameKey
      ? cursorOption.userNameKey
      : DEFAULT_USER_NAME_KEY;
  const userColorKey =
    typeof cursorOption === "object" && cursorOption?.userColorKey
      ? cursorOption.userColorKey
      : DEFAULT_USER_COLOR_KEY;

  // 设置本地用户信息（名称/颜色）
  let userName = getAwarenessStateValue(awareness, userNameKey);
  if (!userName) {
    userName = generateRandomName();
    setAwarenessStateValue(awareness, userNameKey, userName);
  }
  let userColor = getAwarenessStateValue(awareness, userColorKey);
  if (!userColor) {
    userColor = generateColor(userName);
    setAwarenessStateValue(awareness, userColorKey, userColor);
  }

  // 绑定鼠标事件 -> 同步到 awareness.cursor
  graph.addMouseListener({
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
      dlog("local-mouse", { graphX: event.graphX, graphY: event.graphY, pageId: file.getUi().currentPage?.getId() });
      awareness.setLocalStateField("cursor", {
        x: event.graphX,
        y: event.graphY,
        pageId: file.getUi().currentPage?.getId(),
      });
    }, mouseMoveThrottle),
  });

  // 绑定选区事件 -> 同步到 awareness.selection
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

  // 渲染远端光标
  const showCursor = options.cursor ?? true;
  const remoteEntries = new Map<number, RemoteEntry>();
  const cursorDelay = 100; // ms

  function ensureEntry(
    clientId: number,
    userName: string,
    userColor: string
  ): RemoteEntry {
    let entry = remoteEntries.get(clientId);
    if (entry) {
      entry.userName = userName;
      entry.userColor = userColor;
      return entry;
    }

    const cursorEl = document.createElement("div");
    cursorEl.className = "y-remote-cursor";
    cursorEl.style.position = "absolute";
    cursorEl.style.pointerEvents = "none";
    cursorEl.style.zIndex = "1000";
    cursorEl.style.display = "none";

    const imgEl = document.createElement("img");
    try {
      const GraphCtor = (graph as any)?.constructor || (window as any).Graph || null;
      const src = GraphCtor ? createCursorImage(GraphCtor, userColor || "#000") : "";
      if (src) imgEl.src = src;
    } catch {}
    imgEl.style.width = "8px";
    imgEl.style.height = "12px";

    const labelEl = document.createElement("div");
    labelEl.style.marginTop = "2px";
    labelEl.style.padding = "1px 4px";
    labelEl.style.borderRadius = "3px";
    labelEl.style.fontSize = "11px";
    labelEl.style.color = "#fff";
    labelEl.style.background = userColor || "#000";
    labelEl.style.whiteSpace = "nowrap";
    labelEl.textContent = userName;

    cursorEl.appendChild(imgEl);
    cursorEl.appendChild(labelEl);
    graph.container.appendChild(cursorEl);

    entry = {
      clientId,
      cursorEl,
      imgEl,
      labelEl,
      lastCursor: null,
      userColor,
      userName,
    };
    remoteEntries.set(clientId, entry);
    dlog("ensure-entry:create", { clientId, userName, userColor });
    return entry;
  }

  function removeStaleEntries(validClientIds: Set<number>) {
    for (const [clientId, entry] of remoteEntries) {
      if (!validClientIds.has(clientId)) {
        try {
          entry.cursorEl.remove();
        } catch {}
        remoteEntries.delete(clientId);
      }
    }
  }

  function updateCursor(entry: RemoteEntry, transition: boolean) {
    const ui = file.getUi();
    const pageId = ui.currentPage != null ? ui.currentPage.getId() : null;

    if (entry != null && entry.cursorEl != null && entry.lastCursor != null) {
      const last = entry.lastCursor;

      // 兼容 ui.isShowRemoteCursors() 或布尔值
      let showRemote = true as boolean;
      const flag = (ui as any).isShowRemoteCursors;
      if (typeof flag === "function") showRemote = !!flag.call(ui);
      else if (typeof flag === "boolean") showRemote = flag;

      if (
        (last as any).hide != null ||
        !showRemote ||
        (last.pageId != null && last.pageId !== pageId)
      ) {
        dlog("cursor:hide", {
          clientId: entry.clientId,
          reason: {
            hide: (last as any).hide != null,
            showRemote,
            pageMismatch: last.pageId != null && last.pageId !== pageId,
          },
          last,
          currentPageId: pageId,
        });
        entry.cursorEl.style.display = "none";
      } else {
        const tr = graph.view.translate;
        const s = graph.view.scale;
        // 与参考实现一致的偏移
        const x = (tr.x + (last.x ?? 0)) * s + 8;
        const y = (tr.y + (last.y ?? 0)) * s - 12;

        function setPosition() {
          const cont = graph.container;
          const xMin = cont.scrollLeft;
          const xMax = cont.scrollLeft + cont.clientWidth - entry.cursorEl.clientWidth;
          const yMin = cont.scrollTop - 22;
          const yMax = cont.scrollTop + cont.clientHeight - entry.cursorEl.clientHeight;

          const cx = Math.max(xMin, Math.min(xMax, x));
          const cy = Math.max(yMin, Math.min(yMax, y));

          dlog("cursor:position", {
            clientId: entry.clientId,
            last,
            translate: { x: tr.x, y: tr.y },
            scale: s,
            computed: { x, y },
            container: {
              scrollLeft: cont.scrollLeft,
              scrollTop: cont.scrollTop,
              clientWidth: cont.clientWidth,
              clientHeight: cont.clientHeight,
              cursorElW: entry.cursorEl.clientWidth,
              cursorElH: entry.cursorEl.clientHeight,
            },
            clamped: { cx, cy },
            transition,
          });

          entry.imgEl.style.opacity = cx !== x || cy !== y ? "0" : "1";
          entry.cursorEl.style.left = cx + "px";
          entry.cursorEl.style.top = cy + "px";
          entry.cursorEl.style.display = "";

          // 更新颜色/名称
          entry.labelEl.style.background = entry.userColor;
          entry.labelEl.textContent = entry.userName;
        }

        if (transition) {
          const t = `all ${3 * cursorDelay}ms ease-out`;
          (entry.cursorEl.style as any).transition = t;
          (entry.imgEl.style as any).transition = t;
          window.setTimeout(setPosition, 0);
        } else {
          (entry.cursorEl.style as any).transition = "";
          (entry.imgEl.style as any).transition = "";
          setPosition();
        }
      }
    }
  }

  if (typeof showCursor === "boolean" && showCursor) {
    awareness.on("update", () => {
      const otherStates = awareness.getStates();
      const valid = new Set<number>();
      dlog("awareness:update", { size: otherStates.size, self: awareness.clientID });

      for (const [clientId] of otherStates.entries()) {
        if (clientId === awareness.clientID) continue;

        const cursor = getAwarenessStateValue(
          awareness,
          "cursor",
          clientId
        ) as CursorState | null;
        dlog("remote:state", { clientId, cursor });
        // 目前不渲染选区，只做保留
        // const selection = getAwarenessStateValue(awareness, "selection", clientId);

        const name =
          getAwarenessStateValue(awareness, userNameKey, clientId) ||
          clientId + "";
        const color =
          getAwarenessStateValue(awareness, userColorKey, clientId) ||
          "#000000";

        const entry = ensureEntry(clientId, name, color);
        entry.lastCursor = cursor ?? null;
        updateCursor(entry, true);

        valid.add(clientId);
      }

      removeStaleEntries(valid);
      dlog("cleanup:remain", { clientIds: Array.from(remoteEntries.keys()) });
    });
  }

  return {
    dispose() {
      for (const entry of remoteEntries.values()) {
        try {
          entry.cursorEl.remove();
        } catch {}
      }
      remoteEntries.clear();
    },
  };
}
