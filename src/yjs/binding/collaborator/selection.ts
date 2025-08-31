import { type Awareness } from "y-protocols/awareness";
import { getId } from "../../helper/getId";
import { type RemoteCursor } from "./index";

export const SELECTION_OPACITY = 1;
export const CacheKey = "__remoteSelection__";

export function bindSelection(
  file: any,
  options: { awareness: Awareness; graph?: any }
) {
  const graph = options.graph || file.getUi().editor.graph;
  const awareness = options.awareness;

  const handler = function (_: any, evt: any) {
    const pageId = file.getUi().currentPage?.getId();
    const added = (evt.getProperty("added") || []).map(getId);
    const removed = (evt.getProperty("removed") || []).map(getId);

    awareness.setLocalStateField("selection", {
      added,
      removed,
      pageId,
    });
  };

  const selectionModel = graph.getSelectionModel();
  selectionModel.addListener("change", handler);
}

export function renderRemoteSelections(
  ui: any,
  remotes: Map<number, RemoteCursor>
) {
  if (!Reflect.has(ui, CacheKey)) {
    Reflect.set(
      ui,
      CacheKey,
      new Map<number, Map<string, { destroy: () => void }>>()
    );
  }

  const cache = Reflect.get(ui, CacheKey) as Map<
    number,
    Map<string, { destroy: () => void }>
  >;

  const currentPageId = ui.currentPage?.getId();

  if (!currentPageId) {
    /**
     * 清理/关闭
     */
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
    const highlightCellMap = cache.get(clientId);
    cache.delete(clientId);
    if (!highlightCellMap) return;
    Array.from(highlightCellMap.values()).forEach((highlightCell) => {
      highlightCell.destroy();
    });
    highlightCellMap.clear();
  });

  // 移除非当前页的
  otherPageRemotes.forEach(({ clientId }) => {
    const highlightCellMap = cache.get(clientId);
    if (!highlightCellMap) return;
    Array.from(highlightCellMap.values()).forEach((highlightCell) => {
      highlightCell.destroy();
    });
    highlightCellMap.clear();
  });

  if (!currentPageRemotes.length) {
    return;
  }

  currentPageRemotes.forEach(({ clientId, selectionState, userColor }) => {
    if (!selectionState) return;

    let highlightCellMap = cache.get(clientId);
    if (!highlightCellMap) {
      highlightCellMap = new Map<string, { destroy: () => void }>();
      cache.set(clientId, highlightCellMap);
    }

    selectionState.removed.forEach((id) => {
      const highlightCell = highlightCellMap.get(id);
      if (!highlightCell) return;
      highlightCell.destroy();
      highlightCellMap.delete(id);
    });

    const graph = ui.editor.graph;

    selectionState.added.forEach((id) => {
      const cell = graph.model.getCell(id);
      if (cell) {
        const highlightCell = graph.highlightCell(
          cell,
          userColor,
          60000,
          SELECTION_OPACITY,
          3
        );
        if (highlightCellMap.has(id)) return;
        highlightCellMap.set(id, highlightCell);
      }
    });
  });
}
