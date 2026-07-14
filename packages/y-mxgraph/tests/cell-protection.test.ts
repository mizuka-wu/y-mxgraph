import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { xml2ydoc, ydoc2xml } from "../src/transform/index";
import {
  applyFilePatch,
  generatePatch,
  initDocSnapshot,
  ensureRootCells,
  syncCellsMapAndOrder,
  PROTECTED_CELLS,
} from "../src/binding/patch";

const BASE_XML = `<mxfile pages="1"><diagram name="Page-1" id="p1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`;

function makeDoc(xml = BASE_XML) {
  const doc = new Y.Doc();
  xml2ydoc(xml, doc);
  initDocSnapshot(doc);
  return doc;
}

function getCells(doc: Y.Doc) {
  const mxfile = doc.getMap("mxfile");
  const diags = mxfile.get("diagram") as Y.Map<any>;
  const gm = (diags.get("p1") as Y.Map<any>).get("mxGraphModel") as Y.Map<any>;
  return {
    cellsMap: gm.get("mxCell") as Y.Map<Y.XmlElement>,
    cellsOrder: gm.get("mxCellOrder") as Y.Array<string>,
  };
}

// ─── PROTECTED_CELLS 常量 ───

describe("PROTECTED_CELLS", () => {
  it("包含 0 和 1", () => {
    expect(PROTECTED_CELLS.has("0")).toBe(true);
    expect(PROTECTED_CELLS.has("1")).toBe(true);
  });
});

// ─── ensureRootCells ───

describe("ensureRootCells", () => {
  it("正常 doc 不做任何修改", () => {
    const doc = makeDoc();
    const { cellsMap, cellsOrder } = getCells(doc);
    const orderBefore = cellsOrder.toArray();
    ensureRootCells(doc);
    expect(cellsMap.has("0")).toBe(true);
    expect(cellsMap.has("1")).toBe(true);
    expect(cellsOrder.toArray()).toEqual(orderBefore);
  });

  it("cellsMap 缺少 cell 0 时恢复", () => {
    const doc = makeDoc();
    const { cellsMap, cellsOrder } = getCells(doc);
    cellsMap.delete("0");
    expect(cellsMap.has("0")).toBe(false);

    ensureRootCells(doc);

    expect(cellsMap.has("0")).toBe(true);
    const cell0 = cellsMap.get("0")!;
    expect(cell0.getAttribute("id")).toBe("0");
    // cell 0 应在 cellsOrder 最前面
    expect(cellsOrder.toArray()[0]).toBe("0");
  });

  it("cellsMap 缺少 cell 1 时恢复", () => {
    const doc = makeDoc();
    const { cellsMap, cellsOrder } = getCells(doc);
    cellsMap.delete("1");
    expect(cellsMap.has("1")).toBe(false);

    ensureRootCells(doc);

    expect(cellsMap.has("1")).toBe(true);
    const cell1 = cellsMap.get("1")!;
    expect(cell1.getAttribute("id")).toBe("1");
    expect(cell1.getAttribute("parent")).toBe("0");
    // cell 1 应紧跟 cell 0
    const order = cellsOrder.toArray();
    expect(order.indexOf("0")).toBeLessThan(order.indexOf("1"));
  });

  it("cellsMap 缺少 cell 0 和 1 时同时恢复", () => {
    const doc = makeDoc();
    const { cellsMap, cellsOrder } = getCells(doc);
    cellsMap.delete("0");
    cellsMap.delete("1");

    ensureRootCells(doc);

    expect(cellsMap.has("0")).toBe(true);
    expect(cellsMap.has("1")).toBe(true);
    const order = cellsOrder.toArray();
    expect(order[0]).toBe("0");
    expect(order[1]).toBe("1");
  });

  it("cellsOrder 缺少 cell 0/1 但 cellsMap 有，补回 order", () => {
    const doc = makeDoc();
    const { cellsMap, cellsOrder } = getCells(doc);
    // 从 order 中移除 0 和 1，但保留 cellsMap
    const order = cellsOrder.toArray();
    cellsOrder.delete(0, order.length);
    cellsOrder.push(order.filter((id) => id !== "0" && id !== "1"));

    ensureRootCells(doc);

    const newOrder = cellsOrder.toArray();
    expect(newOrder[0]).toBe("0");
    expect(newOrder[1]).toBe("1");
  });
});

// ─── syncCellsMapAndOrder ───

describe("syncCellsMapAndOrder", () => {
  it("清理 order 中不在 cellsMap 的孤儿 id", () => {
    const doc = makeDoc();
    const { cellsMap, cellsOrder } = getCells(doc);
    // 添加一个孤儿 id 到 order
    cellsOrder.push(["orphan1", "orphan2"]);

    syncCellsMapAndOrder(doc);

    const order = cellsOrder.toArray();
    expect(order).not.toContain("orphan1");
    expect(order).not.toContain("orphan2");
  });

  it("不会删除受保护的孤儿 id（0/1）", () => {
    const doc = makeDoc();
    const { cellsMap, cellsOrder } = getCells(doc);
    // 即使 0/1 不在 cellsMap 中（理论上不该发生），也不从 order 删除
    cellsMap.delete("0");
    cellsMap.delete("1");
    // 重新添加到 order 但不加到 map
    cellsOrder.insert(0, ["0", "1"]);

    syncCellsMapAndOrder(doc);

    const order = cellsOrder.toArray();
    expect(order).toContain("0");
    expect(order).toContain("1");
  });

  it("补回 map 中存在但 order 中缺失的 id", () => {
    const doc = makeDoc();
    const { cellsMap, cellsOrder } = getCells(doc);
    // 添加一个 cell 到 map 但不加到 order
    const cell = new Y.XmlElement("mxCell");
    cell.setAttribute("id", "extra");
    cellsMap.set("extra", cell);

    syncCellsMapAndOrder(doc);

    expect(cellsOrder.toArray()).toContain("extra");
  });
});

// ─── applyFilePatch 保护 ───

describe("applyFilePatch — cell 0/1 保护", () => {
  it("删除 cell 0 被阻止", () => {
    const doc = makeDoc();
    const { cellsMap } = getCells(doc);
    expect(cellsMap.has("0")).toBe(true);

    applyFilePatch(doc, {
      u: { p1: { cells: { r: ["0"] } } },
    });

    // cell 0 仍然存在
    expect(cellsMap.has("0")).toBe(true);
  });

  it("删除 cell 1 被阻止", () => {
    const doc = makeDoc();
    const { cellsMap } = getCells(doc);
    expect(cellsMap.has("1")).toBe(true);

    applyFilePatch(doc, {
      u: { p1: { cells: { r: ["1"] } } },
    });

    expect(cellsMap.has("1")).toBe(true);
  });

  it("同时删除 cell 0 和 cell 1 都被阻止", () => {
    const doc = makeDoc();
    const { cellsMap } = getCells(doc);

    applyFilePatch(doc, {
      u: { p1: { cells: { r: ["0", "1"] } } },
    });

    expect(cellsMap.has("0")).toBe(true);
    expect(cellsMap.has("1")).toBe(true);
  });

  it("删除普通 cell 不受影响", () => {
    const XML_WITH_CELL = `<mxfile pages="1"><diagram name="Page-1" id="p1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="c1" parent="1" vertex="1"/></root></mxGraphModel></diagram></mxfile>`;
    const doc = makeDoc(XML_WITH_CELL);
    const { cellsMap } = getCells(doc);
    expect(cellsMap.has("c1")).toBe(true);

    applyFilePatch(doc, {
      u: { p1: { cells: { r: ["c1"] } } },
    });

    expect(cellsMap.has("c1")).toBe(false);
  });

  it("删除混合列表：只删除普通 cell，保留 0/1", () => {
    const XML_WITH_CELLS = `<mxfile pages="1"><diagram name="Page-1" id="p1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="c1" parent="1" vertex="1"/><mxCell id="c2" parent="1" vertex="1"/></root></mxGraphModel></diagram></mxfile>`;
    const doc = makeDoc(XML_WITH_CELLS);
    const { cellsMap } = getCells(doc);

    applyFilePatch(doc, {
      u: { p1: { cells: { r: ["0", "1", "c1", "c2"] } } },
    });

    expect(cellsMap.has("0")).toBe(true);
    expect(cellsMap.has("1")).toBe(true);
    expect(cellsMap.has("c1")).toBe(false);
    expect(cellsMap.has("c2")).toBe(false);
  });
});

// ─── generatePatch 保护 ───

describe("generatePatch — cell 0/1 保护", () => {
  it("不产生 cell 0/1 的删除 patch", () => {
    const doc = makeDoc();
    initDocSnapshot(doc);

    // 从 cellsMap 中移除 cell 0 和 1（模拟损坏）
    const { cellsMap, cellsOrder } = getCells(doc);
    cellsMap.delete("0");
    cellsMap.delete("1");
    // 从 order 中也移除
    const order = cellsOrder.toArray();
    cellsOrder.delete(0, order.length);
    cellsOrder.push(order.filter((id) => id !== "0" && id !== "1"));

    const patch = generatePatch([]);

    // patch 中不应包含 0/1 的删除操作
    if (patch.u?.p1?.cells?.r) {
      expect(patch.u.p1.cells.r).not.toContain("0");
      expect(patch.u.p1.cells.r).not.toContain("1");
    }
  });
});

// ─── parse 保护 ───

describe("mxGraphModel.parse — cell 0/1 保护", () => {
  it("XML 缺少 cell 0 时自动创建", () => {
    const xml = `<mxfile pages="1"><diagram name="Page-1" id="p1"><mxGraphModel><root><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`;
    const doc = new Y.Doc();
    xml2ydoc(xml, doc);

    const { cellsMap } = getCells(doc);
    expect(cellsMap.has("0")).toBe(true);
    expect(cellsMap.get("0")!.getAttribute("id")).toBe("0");
  });

  it("XML 缺少 cell 1 时自动创建", () => {
    const xml = `<mxfile pages="1"><diagram name="Page-1" id="p1"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram></mxfile>`;
    const doc = new Y.Doc();
    xml2ydoc(xml, doc);

    const { cellsMap } = getCells(doc);
    expect(cellsMap.has("1")).toBe(true);
    const cell1 = cellsMap.get("1")!;
    expect(cell1.getAttribute("id")).toBe("1");
    expect(cell1.getAttribute("parent")).toBe("0");
  });

  it("XML 缺少 cell 0 和 1 时同时创建", () => {
    const xml = `<mxfile pages="1"><diagram name="Page-1" id="p1"><mxGraphModel><root><mxCell id="2" parent="1" vertex="1"/></root></mxGraphModel></diagram></mxfile>`;
    const doc = new Y.Doc();
    xml2ydoc(xml, doc);

    const { cellsMap } = getCells(doc);
    expect(cellsMap.has("0")).toBe(true);
    expect(cellsMap.has("1")).toBe(true);
  });
});

// ─── serialize 保护 ───

describe("mxGraphModel.serialize — cell 0/1 保护", () => {
  it("输出始终包含 cell 0 和 1", () => {
    const doc = makeDoc();
    // ydoc2xml already imported at top
    const xml = ydoc2xml(doc);
    expect(xml).toContain('id="0"');
    expect(xml).toContain('id="1"');
  });

  it("cellsMap 缺少 0/1 时 serialize 输出仍包含", () => {
    const doc = makeDoc();
    const { cellsMap } = getCells(doc);
    cellsMap.delete("0");
    cellsMap.delete("1");

    // ydoc2xml already imported at top
    const xml = ydoc2xml(doc);
    expect(xml).toContain('id="0"');
    expect(xml).toContain('id="1"');
  });
});
