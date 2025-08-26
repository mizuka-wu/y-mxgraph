import { applyUpdate } from "yjs";

/**
 * 通过注入的方式拿到实例, 这个之后再考虑什么时候搞进去，3s后开发版是一定加载完成的
 */
setTimeout(() => {
  (window as any).Draw.loadPlugin((app: any) => {
    const file = app.currentFile;
    app.editor.graph.model.addListener(
      (window as any).mxEvent ? (window as any).mxEvent.CHANGE : "change",
      () => {
        console.log("graph changed");
      }
    );
  });
}, 3000);
