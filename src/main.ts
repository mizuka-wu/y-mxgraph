import * as Y from "yjs";
import { debounce } from "lodash-es";
import { xml2js, js2xml } from "xml-js";
import { WebrtcProvider } from "y-webrtc";
import { diffWordsWithSpace } from "diff";
import { bindDrawioFile, doc2xml } from "./yjs";

const SPACES = 2;

const demoFile = `<mxfile pages="1">
  <diagram name="第 1 页" id="DEMOabHTdChjKBf1yHdD">
    <mxGraphModel dx="506" dy="689" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
    <diagram name="第 2 页" id="DEMObbHTdChjKBf1yHdD">
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
    return window.location.reload();
  }
  window.location.hash = "#R" + encodeURIComponent(demoFile);
  /**
   * 设置文件
   */

  function handleFileLoaded(app: any, file: any) {
    Reflect.set(globalThis, "app", app);

    const doc = new Y.Doc();
    const roomName = "demo";
    const provider = new WebrtcProvider(roomName, doc, {
      signaling: [],
    });

    /**
     * 最终绑定页面上的数据
     * 首先尝试等待ydoc加载成功，因为webrtc，所以是没有whenSynced的
     */
    function bind() {
      app.spinner.stop();
      bindDrawioFile(file, {
        doc,
        awareness: provider.awareness,
      });

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

      Reflect.set(window, "__doc__", doc);
      Reflect.set(window, "__awareness__", provider.awareness);
      console.log("注入完成 当前room：", roomName);

      // 显示调试工具
      const debugTools = document.getElementById("debug-tools");
      if (debugTools) debugTools.style.display = "block";

      // === Cell 0/1 损坏模拟工具 ===
      const mxfileKey = "mxfile";
      const diagramKey = "diagram";
      const diagramOrderKey = "diagramOrder";
      const mxGraphModelKey = "mxGraphModel";
      const mxCellKey = "mxCell";
      const mxCellOrderKey = "mxCellOrder";

      function getDocState() {
        const mxfile = doc.getMap(mxfileKey) as Y.Map<any>;
        if (!mxfile) return { error: "no mxfile" };
        const diags = mxfile.get(diagramKey) as Y.Map<any>;
        const order = mxfile.get(diagramOrderKey) as Y.Array<string>;
        const result: any = {
          diagramOrder: order?.toArray() || [],
          diagrams: {},
        };
        for (const did of order?.toArray() || []) {
          const diag = diags?.get(did);
          if (!diag) continue;
          const gm = diag.get(mxGraphModelKey);
          if (!gm) continue;
          const cells = gm.get(mxCellKey) as Y.Map<Y.XmlElement>;
          const cellOrder = gm.get(mxCellOrderKey) as Y.Array<string>;
          result.diagrams[did] = {
            cellOrder: cellOrder?.toArray() || [],
            cellsMapKeys: cells ? Array.from(cells.keys()) : [],
            hasCell0: cells?.has("0"),
            hasCell1: cells?.has("1"),
          };
        }
        return result;
      }

      (window as any).__showDocState = () => {
        const state = getDocState();
        const el = document.getElementById("doc-state");
        if (el) el.textContent = JSON.stringify(state, null, 2);
        console.log("Doc state:", state);
      };

      (window as any).__removeCell0 = () => {
        doc.transact(() => {
          const mxfile = doc.getMap(mxfileKey) as Y.Map<any>;
          const diags = mxfile.get(diagramKey) as Y.Map<any>;
          for (const did of (mxfile.get(diagramOrderKey) as Y.Array<string>).toArray()) {
            const diag = diags.get(did);
            if (!diag) continue;
            const gm = diag.get(mxGraphModelKey);
            if (!gm) continue;
            const cells = gm.get(mxCellKey) as Y.Map<Y.XmlElement>;
            const cellOrder = gm.get(mxCellOrderKey) as Y.Array<string>;
            if (cells?.has("0")) cells.delete("0");
            const idx = cellOrder?.toArray().indexOf("0");
            if (idx !== undefined && idx >= 0) cellOrder.delete(idx, 1);
          }
        });
        console.warn("⚠️ Cell 0 已删除（模拟损坏）");
        (window as any).__showDocState?.();
      };

      (window as any).__removeCell1 = () => {
        doc.transact(() => {
          const mxfile = doc.getMap(mxfileKey) as Y.Map<any>;
          const diags = mxfile.get(diagramKey) as Y.Map<any>;
          for (const did of (mxfile.get(diagramOrderKey) as Y.Array<string>).toArray()) {
            const diag = diags.get(did);
            if (!diag) continue;
            const gm = diag.get(mxGraphModelKey);
            if (!gm) continue;
            const cells = gm.get(mxCellKey) as Y.Map<Y.XmlElement>;
            const cellOrder = gm.get(mxCellOrderKey) as Y.Array<string>;
            if (cells?.has("1")) cells.delete("1");
            const idx = cellOrder?.toArray().indexOf("1");
            if (idx !== undefined && idx >= 0) cellOrder.delete(idx, 1);
          }
        });
        console.warn("⚠️ Cell 1 已删除（模拟损坏）");
        (window as any).__showDocState?.();
      };

      (window as any).__removeCell0And1 = () => {
        doc.transact(() => {
          const mxfile = doc.getMap(mxfileKey) as Y.Map<any>;
          const diags = mxfile.get(diagramKey) as Y.Map<any>;
          for (const did of (mxfile.get(diagramOrderKey) as Y.Array<string>).toArray()) {
            const diag = diags.get(did);
            if (!diag) continue;
            const gm = diag.get(mxGraphModelKey);
            if (!gm) continue;
            const cells = gm.get(mxCellKey) as Y.Map<Y.XmlElement>;
            const cellOrder = gm.get(mxCellOrderKey) as Y.Array<string>;
            if (cells?.has("0")) cells.delete("0");
            if (cells?.has("1")) cells.delete("1");
            const orderArr = cellOrder?.toArray() || [];
            for (let i = orderArr.length - 1; i >= 0; i--) {
              if (orderArr[i] === "0" || orderArr[i] === "1") {
                cellOrder.delete(i, 1);
              }
            }
          }
        });
        console.warn("⚠️ Cell 0 和 1 已同时删除（模拟损坏）");
        (window as any).__showDocState?.();
      };

      (window as any).__removeAllFromOrder = () => {
        doc.transact(() => {
          const mxfile = doc.getMap(mxfileKey) as Y.Map<any>;
          const diags = mxfile.get(diagramKey) as Y.Map<any>;
          for (const did of (mxfile.get(diagramOrderKey) as Y.Array<string>).toArray()) {
            const diag = diags.get(did);
            if (!diag) continue;
            const gm = diag.get(mxGraphModelKey);
            if (!gm) continue;
            const cellOrder = gm.get(mxCellOrderKey) as Y.Array<string>;
            if (cellOrder) cellOrder.delete(0, cellOrder.length);
          }
        });
        console.warn("⚠️ cellsOrder 已清空（模拟损坏）");
        (window as any).__showDocState?.();
      };

      (window as any).__ensureRootCells = async () => {
        const { ensureRootCells, syncCellsMapAndOrder } = await import("./src/yjs/binding/patch");
        doc.transact(() => {
          ensureRootCells(doc);
          syncCellsMapAndOrder(doc);
        });
        console.log("✅ ensureRootCells + syncCellsMapAndOrder 已执行");
        (window as any).__showDocState?.();
      };
    }

    app.spinner.spin(document.body);
    const connectedHandler = function (status: { connected: boolean }) {
      if (status.connected) {
        provider.off("status", connectedHandler);
        setTimeout(() => {
          bind();
          if (provider.awareness.states.size > 1) {
            file.mergeFile(new DrawioFile(file.getUi(), doc2xml(doc)));
          }
        }, 800); // 没有synced只能延迟检测
      }
    };
    provider.on("status", connectedHandler);
  }

  App.main((app: any) => {
    const file = app.currentFile;
    if (file) {
      handleFileLoaded(app, file);
    } else {
      app.editor.addListener("fileLoaded", () => {
        handleFileLoaded(app, app.currentFile);
      });
    }
  });
};
