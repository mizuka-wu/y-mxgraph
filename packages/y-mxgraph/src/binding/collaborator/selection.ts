import { type Awareness } from "y-protocols/awareness";
import { getId } from "../../helper/getId";
import { type RemoteCursor } from "./index";
import type { DrawioFile, MxGraph } from "../../types/drawio";

export const SELECTION_OPACITY = 70;
export const CacheKey = "__remoteSelection__";

export function bindSelection(
  file: DrawioFile,
  options: { awareness: Awareness; graph?: MxGraph },
) {
  const graph = options.graph || file.getUi().editor.graph;
  const awareness = options.awareness;

  const handler = function () {
    const pageId = file.getUi().currentPage?.getId();
    const cells = graph.getSelectionModel().cells as Record<string, unknown>;
    const ids = Object.keys(cells || {})
      .map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (key) => getId(cells[key] as any) as string,
      )
      .filter(Boolean);
    awareness.setLocalStateField("selection", { ids, pageId });
  };

  const selectionModel = graph.getSelectionModel();
  selectionModel.addListener("change", handler);

  return () => {
    selectionModel.removeListener("change", handler);
  };
}

export function renderRemoteSelections(
  ui: { editor: { graph: MxGraph }; currentPage?: { getId(): string } | null },
  remotes: Map<number, RemoteCursor>,
) {
  if (!(CacheKey in ui)) {
    (ui as Record<string, unknown>)[CacheKey] = new Map<
      number,
      Map<string, { destroy: () => void }>
    >();
  }

  const cache = (ui as Record<string, unknown>)[CacheKey] as Map<
    number,
    Map<string, { destroy: () => void }>
  >;

  const currentPageId = ui.currentPage?.getId();

  if (!currentPageId) {
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
    if (remote.selectionState?.pageId === currentPageId) {
      currentPageRemotes.push(remote);
    } else {
      otherPageRemotes.push(remote);
    }
  });

  leaveRemotesIds.forEach((clientId) => {
    const highlightCellMap = cache.get(clientId);
    cache.delete(clientId);
    if (!highlightCellMap) return;
    Array.from(highlightCellMap.values()).forEach((h) => h.destroy());
    highlightCellMap.clear();
  });

  otherPageRemotes.forEach(({ clientId }) => {
    const highlightCellMap = cache.get(clientId);
    if (!highlightCellMap) return;
    Array.from(highlightCellMap.values()).forEach((h) => h.destroy());
    highlightCellMap.clear();
  });

  if (!currentPageRemotes.length) return;

  const graph = ui.editor.graph;

  currentPageRemotes.forEach(({ clientId, selectionState, userColor }) => {
    let highlightCellMap = cache.get(clientId);
    if (!highlightCellMap) {
      highlightCellMap = new Map<string, { destroy: () => void }>();
      cache.set(clientId, highlightCellMap);
    }

    const currentIds = new Set<string>(selectionState?.ids ?? []);

    // 移除不再选中的高亮
    Array.from(highlightCellMap.keys()).forEach((id) => {
      if (!currentIds.has(id)) {
        highlightCellMap.get(id)?.destroy();
        highlightCellMap.delete(id);
      }
    });

    // 添加新选中的高亮
    currentIds.forEach((id) => {
      if (highlightCellMap.has(id)) return;
      const cell = graph.model.getCell(id);
      if (cell) {
        const highlightCell = graph.highlightCell(
          cell,
          userColor,
          60000,
          SELECTION_OPACITY,
          3,
        );
        highlightCellMap.set(id, highlightCell);
      }
    });
  });
}
