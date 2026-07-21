import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { xml2ydoc } from "../src/transform/index";
import {
  applyFilePatch,
  generatePatch,
  initDocSnapshot,
  ensureBasicCell,
  validateDocIntegrity,
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

describe("ensureBasicCell", () => {
  /** 构造一个有 mxfile 结构的 doc，不经过 xml2ydoc/initDocSnapshot（无 observer） */
  function makeRawDoc() {
    const doc = new Y.Doc();
    const mxfile = doc.getMap("mxfile");
    const diagrams = new Y.Map<Y.Map<unknown>>();
    mxfile.set("diagram", diagrams);

    const diagram = new Y.Map<unknown>();
    diagrams.set("p1", diagram);

    const gm = new Y.Map<unknown>();
    diagram.set("mxGraphModel", gm);

    const cellsMap = new Y.Map<Y.XmlElement>();
    const c0 = new Y.XmlElement("mxCell");
    c0.setAttribute("id", "0");
    cellsMap.set("0", c0);

    const c1 = new Y.XmlElement("mxCell");
    c1.setAttribute("id", "1");
    c1.setAttribute("parent", "0");
    cellsMap.set("1", c1);

    gm.set("mxCell", cellsMap);

    const cellsOrder = new Y.Array<string>();
    cellsOrder.insert(0, ["0", "1"]);
    gm.set("mxCellOrder", cellsOrder);

    return { doc, cellsMap, cellsOrder };
  }

  it("正常 doc 调用多次不产生重复", () => {
    const { cellsOrder, doc } = makeRawDoc();
    expect(cellsOrder.toArray()).toEqual(["0", "1"]);

    ensureBasicCell(doc);
    expect(cellsOrder.toArray()).toEqual(["0", "1"]);

    ensureBasicCell(doc);
    expect(cellsOrder.toArray()).toEqual(["0", "1"]);
  });

  it("缺失 cell 0 时补回", () => {
    const { cellsMap, cellsOrder, doc } = makeRawDoc();

    cellsMap.delete("0");
    cellsOrder.delete(cellsOrder.toArray().indexOf("0"), 1);
    expect(cellsOrder.toArray()).toEqual(["1"]);

    ensureBasicCell(doc);
    expect(cellsOrder.toArray().includes("0")).toBe(true);
    expect(cellsOrder.toArray().indexOf("0")).toBeLessThan(cellsOrder.toArray().indexOf("1"));
  });

  it("缺失 cell 1 时补回", () => {
    const { cellsMap, cellsOrder, doc } = makeRawDoc();

    cellsMap.delete("1");
    cellsOrder.delete(cellsOrder.toArray().indexOf("1"), 1);
    expect(cellsOrder.toArray()).toEqual(["0"]);

    ensureBasicCell(doc);
    expect(cellsOrder.toArray().includes("1")).toBe(true);
    expect(cellsOrder.toArray().indexOf("0")).toBeLessThan(cellsOrder.toArray().indexOf("1"));
  });

  it("cell 存在但 order 缺失时补回，不重复", () => {
    const { cellsMap, cellsOrder, doc } = makeRawDoc();

    // cell map 里有 "1"，但从 order 里移除
    expect(cellsMap.has("1")).toBe(true);
    const idx = cellsOrder.toArray().indexOf("1");
    cellsOrder.delete(idx, 1);
    expect(cellsOrder.toArray()).toEqual(["0"]);
    expect(cellsMap.has("1")).toBe(true);

    // ensureBasicCell 应该把 "1" 加回 order
    ensureBasicCell(doc);
    expect(cellsOrder.toArray().includes("1")).toBe(true);
    expect(cellsOrder.toArray().indexOf("0")).toBeLessThan(cellsOrder.toArray().indexOf("1"));

    // 多次调用不重复
    ensureBasicCell(doc);
    const count = cellsOrder.toArray().filter((id) => id === "1").length;
    expect(count).toBe(1);
  });

  it("两个都缺失时正确恢复", () => {
    const { cellsMap, cellsOrder, doc } = makeRawDoc();

    cellsMap.delete("0");
    cellsMap.delete("1");
    cellsOrder.delete(0, cellsOrder.length);

    ensureBasicCell(doc);
    expect(cellsOrder.toArray()).toEqual(["0", "1"]);
    expect(cellsMap.has("0")).toBe(true);
    expect(cellsMap.has("1")).toBe(true);
  });

  it("顺序打乱时纠正", () => {
    const { cellsOrder, doc } = makeRawDoc();

    // 人造错误顺序：1 在 0 前面
    cellsOrder.delete(0, cellsOrder.length);
    cellsOrder.insert(0, ["1", "0"]);

    ensureBasicCell(doc);
    expect(cellsOrder.toArray()).toEqual(["0", "1"]);
  });
});

describe("validateDocIntegrity", () => {
  function makeRawDoc() {
    const doc = new Y.Doc();
    const mxfile = doc.getMap("mxfile");
    const diagrams = new Y.Map<Y.Map<unknown>>();
    mxfile.set("diagram", diagrams);

    const diagram = new Y.Map<unknown>();
    diagrams.set("p1", diagram);

    const gm = new Y.Map<unknown>();
    diagram.set("mxGraphModel", gm);

    const cellsMap = new Y.Map<Y.XmlElement>();
    const c0 = new Y.XmlElement("mxCell");
    c0.setAttribute("id", "0");
    cellsMap.set("0", c0);

    const c1 = new Y.XmlElement("mxCell");
    c1.setAttribute("id", "1");
    c1.setAttribute("parent", "0");
    cellsMap.set("1", c1);

    gm.set("mxCell", cellsMap);

    const cellsOrder = new Y.Array<string>();
    cellsOrder.insert(0, ["0", "1"]);
    gm.set("mxCellOrder", cellsOrder);

    return { doc, cellsMap, cellsOrder };
  }

  it("健康 doc 返回 0", () => {
    const { doc } = makeRawDoc();
    expect(validateDocIntegrity(doc)).toBe(0);
  });

  it("检测并修复 order 重复", () => {
    const { cellsOrder, doc } = makeRawDoc();
    // 人造重复
    cellsOrder.insert(1, ["1"]);
    expect(cellsOrder.toArray()).toEqual(["0", "1", "1"]);

    const issues = validateDocIntegrity(doc);
    expect(issues).toBeGreaterThan(0);
    // 去重后只有一个 "1"
    const count = cellsOrder.toArray().filter((id) => id === "1").length;
    expect(count).toBe(1);
  });

  it("检测 order 有 map 里不存在的 id 并清理", () => {
    const { cellsOrder, doc } = makeRawDoc();
    // 插入一个不存在的 id
    cellsOrder.push(["ghost"]);
    expect(cellsOrder.toArray()).toContain("ghost");

    const issues = validateDocIntegrity(doc);
    expect(issues).toBeGreaterThan(0);
    expect(cellsOrder.toArray()).not.toContain("ghost");
  });

  it("检测 map 有但 order 没有的 id 并补充", () => {
    const { cellsMap, cellsOrder, doc } = makeRawDoc();
    // map 里加一个 cell 但不加到 order
    const c2 = new Y.XmlElement("mxCell");
    c2.setAttribute("id", "2");
    c2.setAttribute("parent", "1");
    cellsMap.set("2", c2);
    expect(cellsOrder.toArray()).not.toContain("2");

    const issues = validateDocIntegrity(doc);
    expect(issues).toBeGreaterThan(0);
    expect(cellsOrder.toArray()).toContain("2");
  });

  it("检测 parent 链断裂并 warn", () => {
    const { cellsMap, cellsOrder, doc } = makeRawDoc();
    // 加一个 cell 指向不存在的 parent
    const c2 = new Y.XmlElement("mxCell");
    c2.setAttribute("id", "2");
    c2.setAttribute("parent", "nonexistent");
    cellsMap.set("2", c2);
    cellsOrder.push(["2"]);

    const issues = validateDocIntegrity(doc);
    expect(issues).toBeGreaterThan(0);
  });

  it("多种问题同时存在", () => {
    const { cellsMap, cellsOrder, doc } = makeRawDoc();
    // 重复
    cellsOrder.insert(1, ["1"]);
    // 幽灵 id
    cellsOrder.push(["ghost"]);
    // map 有 order 没有
    const c2 = new Y.XmlElement("mxCell");
    c2.setAttribute("id", "2");
    c2.setAttribute("parent", "1");
    cellsMap.set("2", c2);

    const issues = validateDocIntegrity(doc);
    expect(issues).toBeGreaterThanOrEqual(3);
  });
});

describe("validateDocIntegrity — diagram 级别", () => {
  function makeDocWithDiagrams() {
    const doc = new Y.Doc();
    const mxfile = doc.getMap("mxfile");
    const diagrams = new Y.Map<Y.Map<unknown>>();
    const diagramOrder = new Y.Array<string>();
    mxfile.set("diagram", diagrams);
    mxfile.set("diagramOrder", diagramOrder);

    // 两个正常 diagram
    for (const did of ["d1", "d2"]) {
      const diag = new Y.Map<unknown>();
      diag.set("name", `Page ${did}`);
      const gm = new Y.Map<unknown>();
      const cellsMap = new Y.Map<Y.XmlElement>();
      const cellsOrder = new Y.Array<string>();
      const c0 = new Y.XmlElement("mxCell"); c0.setAttribute("id", "0");
      const c1 = new Y.XmlElement("mxCell"); c1.setAttribute("id", "1"); c1.setAttribute("parent", "0");
      cellsMap.set("0", c0); cellsMap.set("1", c1);
      cellsOrder.insert(0, ["0", "1"]);
      gm.set("mxCell", cellsMap); gm.set("mxCellOrder", cellsOrder);
      diag.set("mxGraphModel", gm);
      diagrams.set(did, diag);
    }
    diagramOrder.insert(0, ["d1", "d2"]);
    return { doc, mxfile, diagrams, diagramOrder };
  }

  it("健康 doc 返回 0", () => {
    const { doc } = makeDocWithDiagrams();
    expect(validateDocIntegrity(doc)).toBe(0);
  });

  it("diagramOrder 重复时去重", () => {
    const { diagramOrder, doc } = makeDocWithDiagrams();
    diagramOrder.push(["d1"]);
    expect(diagramOrder.toArray()).toEqual(["d1", "d2", "d1"]);
    expect(validateDocIntegrity(doc)).toBeGreaterThan(0);
    expect(diagramOrder.toArray().filter((id) => id === "d1").length).toBe(1);
  });

  it("diagramOrder 有 map 不存在的 id 时移除", () => {
    const { diagramOrder, doc } = makeDocWithDiagrams();
    diagramOrder.push(["ghost"]);
    expect(validateDocIntegrity(doc)).toBeGreaterThan(0);
    expect(diagramOrder.toArray()).not.toContain("ghost");
  });

  it("map 有但 order 没有的 diagram 时补充", () => {
    const { diagrams, diagramOrder, doc } = makeDocWithDiagrams();
    const extraDiag = new Y.Map<unknown>();
    extraDiag.set("name", "Extra");
    const gm = new Y.Map<unknown>();
    const cellsMap = new Y.Map<Y.XmlElement>();
    const cellsOrder = new Y.Array<string>();
    const c0 = new Y.XmlElement("mxCell"); c0.setAttribute("id", "0");
    const c1 = new Y.XmlElement("mxCell"); c1.setAttribute("id", "1"); c1.setAttribute("parent", "0");
    cellsMap.set("0", c0); cellsMap.set("1", c1);
    cellsOrder.insert(0, ["0", "1"]);
    gm.set("mxCell", cellsMap); gm.set("mxCellOrder", cellsOrder);
    extraDiag.set("mxGraphModel", gm);
    diagrams.set("d3", extraDiag);
    expect(diagramOrder.toArray()).not.toContain("d3");
    expect(validateDocIntegrity(doc)).toBeGreaterThan(0);
    expect(diagramOrder.toArray()).toContain("d3");
  });

  it("diagram 缺 mxGraphModel 时补建", () => {
    const { diagrams, doc } = makeDocWithDiagrams();
    const brokenDiag = new Y.Map<unknown>();
    brokenDiag.set("name", "Broken");
    // 不设置 mxGraphModel
    diagrams.set("broken", brokenDiag);
    expect(validateDocIntegrity(doc)).toBeGreaterThan(0);
    expect(brokenDiag.get("mxGraphModel")).toBeDefined();
  });
});
