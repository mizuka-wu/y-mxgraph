import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { bindDrawioFile, doc2xml } from "./yjs";

const demoFile = `<mxfile pages="1" id="demo">
  <diagram name="第 1 页" id="JUnyabHTdChjKBf1yHdD">
    <mxGraphModel dx="506" dy="689" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;

window.onload = function () {
  const App = (window as any).App;

  // 加载文件地址（demo base文件）
  window.location.hash = "#R" + encodeURIComponent(demoFile);
  /**
   * 设置文件
   */

  App.main((app: any) => {
    const file = app.currentFile;
    if (!file) return console.warn("no file");
    const doc = new Y.Doc();
    const roomName = "demo";
    const provider = new WebrtcProvider(roomName, doc, {
      signaling: [],
    });
    bindDrawioFile(file, {
      doc,
      awareness: provider.awareness,
    });

    Reflect.set(window, "__doc__", doc);
    Reflect.set(window, "__awareness__", provider.awareness);
    console.log("注入完成 当前room：", roomName);
  });
};
//  * 通过注入的方式拿到实例, 这个之后再考虑什么时候搞进去，3s后开发版是一定加载完成的
//  */
// setTimeout(() => {
//   (window as any).Draw.loadPlugin((app: any) => {
//     const file = app.currentFile;
//     if (!file) return console.warn("no file");
//     const doc = new Y.Doc();
//     const roomName = file.getId() || file.draftId || file.created + "";
//     const provider = new WebrtcProvider(roomName, doc, {
//       signaling: [],
//     });
//     bindDrawioFile(file, {
//       doc,
//       awareness: provider.awareness,
//     });

//     Reflect.set(window, "__doc__", doc);
//     Reflect.set(window, "__awareness__", provider.awareness);
//     console.log("注入完成 当前room：", roomName, {
//       fileId: file.getId(),
//       draftId: file.draftId,
//       created: file.created + "",
//       fileData: file.data,
//     });

//     console.log(doc2xml(doc));
//   });
// }, 3000);
