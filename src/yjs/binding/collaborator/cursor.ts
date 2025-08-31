import { throttle } from "lodash-es";
import { type Awareness } from "y-protocols/awareness";

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
