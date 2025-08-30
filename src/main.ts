import * as Y from "yjs";
import { debounce } from "lodash-es";
import { xml2js, js2xml } from "xml-js";
import { WebrtcProvider } from "y-webrtc";
import { diffWordsWithSpace } from "diff";
import { bindDrawioFile, doc2xml } from "./yjs";

const SPACES = 2;

const demoFile = `<mxfile pages="1">
  <diagram name="第 1 页" id="JUnyabHTdChjKBf1yHdD">
    <mxGraphModel dx="506" dy="689" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
    <diagram name="第 2 页" id="ABnyabHTdChjKBf1yHdD">
    <mxGraphModel dx="506" dy="689" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;

function logXmlDiffToConsole(currentXml: string, ydocXml: string, diff: any[]) {
  try {
    const changeSegments = Array.isArray(diff)
      ? diff.reduce(
          (acc: number, part: any) =>
            acc + (part && (part.added || part.removed) ? 1 : 0),
          0
        )
      : 0;
    console.groupCollapsed(
      "XML Diff (current vs ydoc) — 更可视化输出 总变更数：" + changeSegments
    );
    console.log(
      "%cLegend:%c 添加%c 删除%c 未变",
      "font-weight:bold;color:#333;",
      "color:#1b5e20;background:#e8f5e9;padding:1px 2px;border-radius:2px;",
      "color:#b71c1c;background:#ffebee;padding:1px 2px;border-radius:2px;margin-left:4px;",
      "color:#777;margin-left:4px;"
    );
    let fmt = "";
    const styles: string[] = [];
    for (const part of diff) {
      const text = (part.value as string).replace(/%/g, "%%");
      if (part.added) {
        fmt += "%c" + text;
        styles.push("color:#1b5e20;background:#e8f5e9;");
      } else if (part.removed) {
        fmt += "%c" + text;
        styles.push("color:#b71c1c;background:#ffebee;");
      } else {
        fmt += "%c" + text;
        styles.push("color:#555;");
      }
    }
    console.log(fmt, ...styles);
    // 附加原始对象，便于进一步调试
    console.log("原始数据: ", { currentXml, ydocXml, diff });
    console.groupEnd();
  } catch (e) {
    console.warn("可视化 diff 输出失败，降级为原始对象输出。", e);
    console.log({ currentXml, ydocXml, diff });
  }
}

function getLatestXml(app: any) {
  const data = new XMLSerializer().serializeToString(
    app.currentFile.ui.getXmlFileData()
  );
  const obj = xml2js(data, { compact: false });

  // 删除 mxGraphModel 的所有 attributes
  let removedCount = 0;
  const stripAttrs = (node: any): void => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(stripAttrs);
      return;
    }
    if (typeof node === "object") {
      if (node.type === "element") {
        if (node.name === "mxGraphModel") {
          if (node.attributes && Object.keys(node.attributes).length) {
            delete node.attributes;
            removedCount++;
          }
        } else if (node.attributes && Object.keys(node.attributes).length) {
          // 对所有元素的 attributes 进行字母序排序，避免仅因顺序不同产生 diff
          const keys = Object.keys(node.attributes).sort();
          const sorted: any = {};
          for (const k of keys) sorted[k] = node.attributes[k];
          node.attributes = sorted;
        }
      }
      if (node.elements) stripAttrs(node.elements);
    }
  };
  stripAttrs(obj);
  return js2xml(obj, { compact: false, spaces: SPACES });
}

// 对任意 XML 文本进行属性字母序排序并标准化缩进
function normalizeAttrsOrderForXml(xml: string): string {
  try {
    const obj = xml2js(xml, { compact: false });
    const sortAttrs = (node: any): void => {
      if (!node) return;
      if (Array.isArray(node)) {
        node.forEach(sortAttrs);
        return;
      }
      if (typeof node === "object") {
        if (node.type === "element") {
          if (node.name === "mxGraphModel") {
            if (node.attributes && Object.keys(node.attributes).length) {
              // 保持与 getLatestXml 同步：移除 mxGraphModel 的 attributes
              delete node.attributes;
            }
          } else if (node.attributes && Object.keys(node.attributes).length) {
            // 其它元素按字母序排序 attributes
            const keys = Object.keys(node.attributes).sort();
            const sorted: any = {};
            for (const k of keys) sorted[k] = node.attributes[k];
            node.attributes = sorted;
          }
        }
        if (node.elements) node.elements.forEach(sortAttrs);
      }
    };
    sortAttrs(obj);
    return js2xml(obj, { compact: false, spaces: SPACES });
  } catch (e) {
    // 解析失败则直接返回原字符串，避免影响流程
    return xml;
  }
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
        const currentXml = getLatestXml(app);
        let ydocXml = doc2xml(doc, SPACES);
        ydocXml = normalizeAttrsOrderForXml(ydocXml);
        const diff = diffWordsWithSpace(currentXml, ydocXml, {});

        logXmlDiffToConsole(currentXml, ydocXml, diff as any[]);
      }, 1000)
    );
  });
};
