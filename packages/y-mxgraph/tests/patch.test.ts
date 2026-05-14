import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { xml2ydoc } from "../src/transformer/index";
import {
  applyFilePatch,
  generatePatch,
  initDocSnapshot,
} from "../src/binding/patch";

const BASE_XML = `<mxfile pages="1"><diagram name="Page-1" id="p1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`;

function makeDoc(xml = BASE_XML) {
  const doc = new Y.Doc();
  xml2ydoc(xml, doc);
  initDocSnapshot(doc);
  return doc;
}

describe("applyFilePatch — cell 操作", () => {
  it("插入新 cell", () => {
    const doc = makeDoc();
    applyFilePatch(doc, {
      u: {
        p1: {
          cells: {
            i: [{ id: "cell2", value: "hello", parent: "1", vertex: "1", previous: "" }],
          },
        },
      },
    });
    const mxfile = doc.getMap("mxfile");
    const diags = mxfile.get("diagram") as Y.Map<any>;
    const gm = (diags.get("p1") as Y.Map<any>).get("mxGraphModel") as Y.Map<any>;
    const cells = gm.get("mxCell") as Y.Map<any>;
    expect(cells.has("cell2")).toBe(true);
  });

  it("删除 cell", () => {
    const XML_WITH_CELL = `<mxfile pages="1"><diagram name="Page-1" id="p1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="c1" parent="1" vertex="1"/></root></mxGraphModel></diagram></mxfile>`;
    const doc = makeDoc(XML_WITH_CELL);
    applyFilePatch(doc, {
      u: { p1: { cells: { r: ["c1"] } } },
    });
    const mxfile = doc.getMap("mxfile");
    const diags = mxfile.get("diagram") as Y.Map<any>;
    const gm = (diags.get("p1") as Y.Map<any>).get("mxGraphModel") as Y.Map<any>;
    const cells = gm.get("mxCell") as Y.Map<any>;
    expect(cells.has("c1")).toBe(false);
  });

  it("更新 cell 属性", () => {
    const XML_WITH_CELL = `<mxfile pages="1"><diagram name="Page-1" id="p1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="c1" parent="1" vertex="1" value="old"/></root></mxGraphModel></diagram></mxfile>`;
    const doc = makeDoc(XML_WITH_CELL);
    applyFilePatch(doc, {
      u: { p1: { cells: { u: { c1: { value: "new" } } } } },
    });
    const mxfile = doc.getMap("mxfile");
    const diags = mxfile.get("diagram") as Y.Map<any>;
    const gm = (diags.get("p1") as Y.Map<any>).get("mxGraphModel") as Y.Map<any>;
    const cells = gm.get("mxCell") as Y.Map<any>;
    const cell = cells.get("c1") as Y.XmlElement;
    expect(cell.getAttribute("value")).toBe("new");
  });
});

describe("applyFilePatch — diagram 操作", () => {
  it("删除 diagram", () => {
    const doc = makeDoc(
      `<mxfile pages="2"><diagram name="A" id="dA"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram><diagram name="B" id="dB"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`
    );
    applyFilePatch(doc, { r: ["dB"] });
    const mxfile = doc.getMap("mxfile");
    const diags = mxfile.get("diagram") as Y.Map<any>;
    expect(diags.has("dB")).toBe(false);
    const order = mxfile.get("diagramOrder") as Y.Array<string>;
    expect(order.toArray()).not.toContain("dB");
  });

  it("更新 diagram name", () => {
    const doc = makeDoc();
    applyFilePatch(doc, { u: { p1: { name: "Renamed" } } });
    const mxfile = doc.getMap("mxfile");
    const diags = mxfile.get("diagram") as Y.Map<any>;
    const diag = diags.get("p1") as Y.Map<any>;
    expect(diag.get("name")).toBe("Renamed");
  });
});

describe("generatePatch", () => {
  it("无变更时返回空 patch", () => {
    const doc = makeDoc();
    const patch = generatePatch([]);
    expect(Object.keys(patch)).toHaveLength(0);
  });

  it("快照初始化后结构正确", () => {
    const doc = makeDoc();
    const mxfile = doc.getMap("mxfile");
    expect(mxfile.has("diagram")).toBe(true);
    expect(mxfile.has("diagramOrder")).toBe(true);
  });
});

describe("initDocSnapshot", () => {
  it("可多次调用而不抛出", () => {
    const doc = makeDoc();
    expect(() => initDocSnapshot(doc)).not.toThrow();
    expect(() => initDocSnapshot(doc)).not.toThrow();
  });
});
