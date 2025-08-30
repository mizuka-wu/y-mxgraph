import * as Y from "yjs";
import { debounce } from "lodash-es";
import { xml2js, js2xml } from "xml-js";
import { WebrtcProvider } from "y-webrtc";
import { diffLines } from "diff";
import { bindDrawioFile, doc2xml } from "./yjs";

const SPACE = 2;

const demoFile = `<mxfile pages="1">
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

function getLatestXml(app: any) {
  return js2xml(xml2js(app.currentFile.ui.getXmlFileData()), { spaces: SPACE });
}

window.onload = function () {
  const App = (window as any).App;

  // 加载文件地址（demo base文件）
  if (window.location.hash) {
    window.location.hash = "";
    window.location.reload();
  }
  window.location.hash = "#R" + encodeURIComponent(demoFile);
  /**
   * 设置文件
   */

  App.main((app: any) => {
    const file = app.currentFile;
    if (!file) return console.warn("no file");

    Reflect.set(globalThis, "app", app);

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

    const graph = app.editor.graph;
    const mxGraphModel = graph.model;
    mxGraphModel.addListener(
      "change",
      debounce(() => {
        const current = getLatestXml(app);
        const ydoc = doc2xml(doc);
        const diff = diffLines(current, ydoc);

        console.log("生成当前和ydoc转换的xml对比", {
          current,
          ydoc,
          diff,
        });
      }, 1000)
    );
  });
};
