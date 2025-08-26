import { applyUpdate } from "yjs";

/**
 * 通过注入的方式拿到实例, 这个之后再考虑什么时候搞进去，3s后开发版是一定加载完成的
 */
setTimeout(() => {
  (window as any).Draw.loadPlugin((app: any) => {
    const file = app.currentFile;
    console.log(file.data);
    app.editor.graph.model.addListener(
      (window as any).mxEvent ? (window as any).mxEvent.CHANGE : "change",
      () => {
        const patch = file.ui.diffPages(file.shadowPages, file.ui.pages);
        file.setShadowPages(file.ui.clonePages(file.ui.pages));

        // 更新到yjs
        console.log(patch);
      }
    );
  });
}, 3000);
