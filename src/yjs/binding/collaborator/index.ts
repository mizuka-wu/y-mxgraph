import { type Awareness } from "y-protocols/awareness";
import {
  getAwarenessStateValue,
  setAwarenessStateValue,
} from "../../helper/awarenessStateValue";
import { generateColor, generateRandomName } from "../../helper/random";
import { bindCursor, renderRemoteCursors } from "./cursor";
import { bindSelection } from "./selection";

export const DEFAULT_USER_NAME_KEY = "user.name";
export const DEFAULT_USER_COLOR_KEY = "user.color";

type CursorState = {
  x: number;
  y: number;
  pageId?: string | null;
  hide?: boolean;
};

type SelectionState = {
  added: string[];
  removed: string[];
  pageId?: string | null;
};

export type RemoteCursor = {
  clientId: number;
  cursorState: CursorState | null;
  selectionState: SelectionState | null;
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
  }
) {
  const graph = options.graph || file.getUi().editor.graph;
  const awareness = options.awareness;
  const mouseMoveThrottle = options.mouseMoveThrottle ?? 100;

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
  let userName = getAwarenessStateValue<string>(awareness, userNameKey);
  if (!userName) {
    userName = generateRandomName();
    setAwarenessStateValue(awareness, userNameKey, userName);
  }
  let userColor = getAwarenessStateValue<string>(awareness, userColorKey);
  if (!userColor) {
    userColor = generateColor(userName);
    setAwarenessStateValue(awareness, userColorKey, userColor);
  }

  // 绑定监听
  bindCursor(file, {
    awareness,
    graph,
    mouseMoveThrottle,
  });
  bindSelection(file, {
    awareness,
    graph,
  });

  // 渲染远端光标
  const showCursor = options.cursor ?? true;
  const remotes = new Map<number, RemoteCursor>();

  if (typeof showCursor === "boolean" && showCursor) {
    awareness.on("update", () => {
      const states = awareness.getStates();

      for (const [clientId] of states.entries()) {
        if (clientId === awareness.clientID) continue;

        const name =
          getAwarenessStateValue<string>(awareness, userNameKey, clientId) ||
          clientId + "";
        const color =
          getAwarenessStateValue<string>(awareness, userColorKey, clientId) ||
          "#000000";

        remotes.set(clientId, {
          clientId,
          cursorState: getAwarenessStateValue<CursorState>(
            awareness,
            "cursor",
            clientId
          ),
          selectionState: getAwarenessStateValue<SelectionState>(
            awareness,
            "selection",
            clientId
          ),
          userColor: color,
          userName: name,
        });
      }

      // 渲染cursor
      renderRemoteCursors(file.getUi(), remotes);
    });
  }
}
