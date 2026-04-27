import { type Awareness } from "y-protocols/awareness";
import {
  getAwarenessStateValue,
  setAwarenessStateValue,
} from "../../helper/awarenessStateValue";
import { generateColor, generateRandomName } from "../../helper/random";
import { bindCursor, renderRemoteCursors } from "./cursor";
import { bindSelection, renderRemoteSelections } from "./selection";
import type { DrawioFile, MxGraph } from "../../types/drawio";

export const DEFAULT_USER_NAME_KEY = "user.name";
export const DEFAULT_USER_COLOR_KEY = "user.color";

type CursorState = {
  x: number;
  y: number;
  pageId?: string | null;
  hide?: boolean;
};

type SelectionState = {
  ids: string[];
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
  file: DrawioFile,
  options: {
    awareness: Awareness;
    graph?: MxGraph;
    cursor?: boolean | { userNameKey?: string; userColorKey?: string };
    mouseMoveThrottle?: number;
  },
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

  const cleanupCursor = bindCursor(file, {
    awareness,
    graph,
    mouseMoveThrottle,
  });
  const cleanupSelection = bindSelection(file, {
    awareness,
    graph,
  });

  const showCursor = options.cursor ?? true;
  let cleanupAwareness: (() => void) | undefined;

  if (typeof showCursor === "boolean" && showCursor) {
    const awarenessHandler = (update: {
      added: number[];
      removed: number[];
      updated: number[];
    }) => {
      const states = awareness.getStates();
      const remotes = new Map<number, RemoteCursor>();

      const changedClientIds = new Set([...update.added, ...update.updated]);
      for (const [clientId] of states.entries()) {
        if (clientId === awareness.clientID) continue;
        if (!changedClientIds.has(clientId)) continue;

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
            clientId,
          ),
          selectionState: getAwarenessStateValue<SelectionState>(
            awareness,
            "selection",
            clientId,
          ),
          userColor: color,
          userName: name,
        });
      }

      renderRemoteCursors(file.getUi(), remotes);
      renderRemoteSelections(file.getUi(), remotes);
    };
    awareness.on("update", awarenessHandler);
    cleanupAwareness = () => awareness.off("update", awarenessHandler);
  }

  return () => {
    cleanupCursor?.();
    cleanupSelection?.();
    cleanupAwareness?.();
  };
}
