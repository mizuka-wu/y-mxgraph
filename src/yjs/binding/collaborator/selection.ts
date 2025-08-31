import { type Awareness } from "y-protocols/awareness";
import { getId } from "../../helper/getId";

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
