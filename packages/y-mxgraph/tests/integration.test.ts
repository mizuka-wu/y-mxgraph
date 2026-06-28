import { describe, it, expect, beforeEach } from "vitest";
import * as Y from "yjs";
import { xml2ydoc, ydoc2xml } from "../src/transform/index";
import {
  applyFilePatch,
  generatePatch,
  initDocSnapshot,
} from "../src/binding/patch";
import { checkConsistency } from "../src/binding/consistency";

const BASE_XML = `<mxfile pages="1"><diagram name="Page-1" id="p1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0" value="Hello" style="rounded=1"/></root></mxGraphModel></diagram></mxfile>`;

function makeDoc(xml = BASE_XML) {
  const doc = new Y.Doc();
  xml2ydoc(xml, doc);
  initDocSnapshot(doc);
  return doc;
}

function getCellOrder(doc: Y.Doc, diagramId = "p1"): string[] {
  const mxfile = doc.getMap("mxfile") as Y.Map<unknown>;
  const diags = mxfile.get("diagram") as Y.Map<unknown>;
  const d = diags.get(diagramId) as Y.Map<unknown>;
  const gm = d.get("mxGraphModel") as Y.Map<unknown>;
  return ((gm.get("mxCellOrder") as Y.Array<string>)?.toArray() ?? []);
}

function getCellAttrs(doc: Y.Doc, cellId: string, diagramId = "p1"): Record<string, string> {
  const mxfile = doc.getMap("mxfile") as Y.Map<unknown>;
  const diags = mxfile.get("diagram") as Y.Map<unknown>;
  const d = diags.get(diagramId) as Y.Map<unknown>;
  const gm = d.get("mxGraphModel") as Y.Map<unknown>;
  const cells = gm.get("mxCell") as Y.Map<Y.XmlElement>;
  const cell = cells?.get(cellId) as Y.XmlElement | undefined;
  return cell ? ((cell.getAttributes() as Record<string, string>) || {}) : {};
}

function getDiagramOrder(doc: Y.Doc): string[] {
  const mxfile = doc.getMap("mxfile") as Y.Map<unknown>;
  return ((mxfile.get("diagramOrder") as Y.Array<string>)?.toArray() ?? []);
}

function verifyDocState(doc: Y.Doc, expectedXml?: string) {
  const xml = ydoc2xml(doc);
  expect(xml).toContain("<mxfile");
  expect(xml).toContain("</mxfile>");

  if (expectedXml) {
    expect(checkConsistency(doc, expectedXml)).toBe(true);
  }

  return xml;
}

describe("集成测试：模拟 draw.io 操作并验证 Y.Doc 状态", () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = makeDoc();
  });

  describe("Cell 操作", () => {
    it("添加节点", () => {
      applyFilePatch(doc, {
        u: {
          p1: {
            cells: {
              i: [{
                id: "c-new",
                value: "New Node",
                parent: "0",
                vertex: "1",
                style: "ellipse",
                previous: "1",
              }],
            },
          },
        },
      });

      expect(getCellOrder(doc)).toEqual(["0", "1", "c-new"]);
      expect(getCellAttrs(doc, "c-new").value).toBe("New Node");
      expect(getCellAttrs(doc, "c-new").style).toBe("ellipse");

      const xml = verifyDocState(doc);
      expect(xml).toContain("c-new");
    });

    it("删除节点", () => {
      applyFilePatch(doc, {
        u: { p1: { cells: { r: ["1"] } } },
      });

      expect(getCellOrder(doc)).toEqual(["0"]);
      expect(getCellAttrs(doc, "1")).toEqual({});

      const xml = verifyDocState(doc);
      expect(xml).not.toContain('id="1"');
    });

    it("修改节点属性", () => {
      applyFilePatch(doc, {
        u: {
          p1: {
            cells: {
              u: {
                "1": { value: "Updated", style: "rounded=0;fillColor=#ff0000" },
              },
            },
          },
        },
      });

      expect(getCellAttrs(doc, "1").value).toBe("Updated");
      expect(getCellAttrs(doc, "1").style).toBe("rounded=0;fillColor=#ff0000");

      verifyDocState(doc);
    });

    it("移动节点位置（reorder）", () => {
      applyFilePatch(doc, {
        u: {
          p1: {
            cells: {
              i: [{ id: "c-2", value: "Node 2", parent: "0", vertex: "1", previous: "1" }],
            },
          },
        },
      });
      expect(getCellOrder(doc)).toEqual(["0", "1", "c-2"]);

      applyFilePatch(doc, {
        u: {
          p1: {
            cells: {
              u: { "c-2": { previous: "" } },
            },
          },
        },
      });

      // previous="" 表示插到最前面，但 root cell "0" 和 default layer "1" 始终在最前
      expect(getCellOrder(doc)).toEqual(["0", "1", "c-2"]);
      verifyDocState(doc);
    });

    it("批量操作：同时添加、删除、修改", () => {
      applyFilePatch(doc, {
        u: {
          p1: {
            cells: {
              r: ["1"],
              i: [{ id: "c-new", value: "New", parent: "0", vertex: "1", previous: "0" }],
              u: { "0": { style: "container" } },
            },
          },
        },
      });

      expect(getCellOrder(doc)).toEqual(["0", "c-new"]);
      expect(getCellAttrs(doc, "0").style).toBe("container");
      expect(getCellAttrs(doc, "c-new").value).toBe("New");

      verifyDocState(doc);
    });
  });

  describe("Diagram 操作", () => {
    it("添加页面", () => {
      applyFilePatch(doc, {
        i: [{
          id: "p2",
          previous: "p1",
          data: '<diagram name="Page-2" id="p2"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram>',
        }],
      });

      expect(getDiagramOrder(doc)).toEqual(["p1", "p2"]);

      const xml = verifyDocState(doc);
      expect(xml).toContain("Page-2");
    });

    it("删除页面", () => {
      applyFilePatch(doc, {
        i: [{
          id: "p2",
          previous: "p1",
          data: '<diagram name="Page-2" id="p2"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram>',
        }],
      });
      expect(getDiagramOrder(doc)).toEqual(["p1", "p2"]);

      applyFilePatch(doc, { r: ["p2"] });
      expect(getDiagramOrder(doc)).toEqual(["p1"]);

      verifyDocState(doc);
    });

    it("重命名页面", () => {
      applyFilePatch(doc, {
        u: { p1: { name: "Renamed Page" } },
      });

      const mxfile = doc.getMap("mxfile") as Y.Map<unknown>;
      const diags = mxfile.get("diagram") as Y.Map<unknown>;
      const d = diags.get("p1") as Y.Map<unknown>;
      expect(d.get("name")).toBe("Renamed Page");

      verifyDocState(doc);
    });

    it("移动页面顺序", () => {
      applyFilePatch(doc, {
        i: [{
          id: "p2",
          previous: "p1",
          data: '<diagram name="Page-2" id="p2"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram>',
        }],
      });
      expect(getDiagramOrder(doc)).toEqual(["p1", "p2"]);

      applyFilePatch(doc, {
        u: { p2: { previous: "" } },
      });
      expect(getDiagramOrder(doc)).toEqual(["p2", "p1"]);

      verifyDocState(doc);
    });

    it("修改页面背景", () => {
      applyFilePatch(doc, {
        u: { p1: { view: { background: "#ffffff" } } },
      });

      verifyDocState(doc);
    });
  });

  describe("混合操作", () => {
    it("同时操作多个页面", () => {
      applyFilePatch(doc, {
        i: [{
          id: "p2",
          previous: "p1",
          data: '<diagram name="Page-2" id="p2"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram>',
        }],
        u: {
          p1: {
            name: "Updated P1",
            cells: {
              i: [{ id: "c-new", value: "New", parent: "0", vertex: "1", previous: "1" }],
            },
          },
          p2: {
            cells: {
              i: [{ id: "c-p2", value: "P2 Cell", parent: "0", vertex: "1" }],
            },
          },
        },
      });

      expect(getDiagramOrder(doc)).toEqual(["p1", "p2"]);
      expect(getCellOrder(doc, "p1")).toEqual(["0", "1", "c-new"]);
      expect(getCellOrder(doc, "p2")).toEqual(["0", "c-p2"]);
      expect(getCellAttrs(doc, "c-new").value).toBe("New");
      expect(getCellAttrs(doc, "c-p2", "p2").value).toBe("P2 Cell");

      verifyDocState(doc);
    });
  });

  describe("Round-trip 验证", () => {
    it("xml → ydoc → xml 保持结构一致", () => {
      const xml1 = ydoc2xml(doc);
      expect(xml1).toContain('id="0"');
      expect(xml1).toContain('id="1"');
      expect(xml1).toContain("Hello");

      const doc2 = new Y.Doc();
      xml2ydoc(xml1, doc2);
      const xml2 = ydoc2xml(doc2);

      expect(xml2).toContain('id="0"');
      expect(xml2).toContain('id="1"');
      expect(xml2).toContain("Hello");
    });

    it("多次操作后 round-trip 仍保持一致", () => {
      applyFilePatch(doc, {
        u: {
          p1: {
            cells: {
              i: [{ id: "c-new", value: "New", parent: "0", vertex: "1", previous: "1" }],
              u: { "1": { value: "Modified" } },
            },
          },
        },
      });

      const xml1 = ydoc2xml(doc);
      expect(xml1).toContain("c-new");
      expect(xml1).toContain("Modified");

      const doc2 = new Y.Doc();
      xml2ydoc(xml1, doc2);
      const xml2 = ydoc2xml(doc2);

      expect(xml2).toContain("c-new");
      expect(xml2).toContain("Modified");

      const doc3 = new Y.Doc();
      xml2ydoc(xml2, doc3);
      const xml3 = ydoc2xml(doc3);

      expect(xml3).toBe(xml2);
    });
  });

  describe("generatePatch 验证", () => {
    it("检测新增 cell", () => {
      initDocSnapshot(doc);

      const mxfile = doc.getMap("mxfile") as Y.Map<unknown>;
      const diags = mxfile.get("diagram") as Y.Map<unknown>;
      const d = diags.get("p1") as Y.Map<unknown>;
      const gm = d.get("mxGraphModel") as Y.Map<unknown>;
      const cells = gm.get("mxCell") as Y.Map<Y.XmlElement>;
      const order = gm.get("mxCellOrder") as Y.Array<string>;

      const newCell = new Y.XmlElement("mxCell");
      newCell.setAttribute("id", "c-detected");
      newCell.setAttribute("value", "Detected");
      cells.set("c-detected", newCell);
      order.push(["c-detected"]);

      const patch = generatePatch([], doc);
      expect(patch.u?.p1?.cells?.i).toBeDefined();
      expect(patch.u!.p1!.cells!.i!.find((item: any) => item.id === "c-detected")).toBeDefined();
    });

    it("检测删除 cell", () => {
      initDocSnapshot(doc);

      const mxfile = doc.getMap("mxfile") as Y.Map<unknown>;
      const diags = mxfile.get("diagram") as Y.Map<unknown>;
      const d = diags.get("p1") as Y.Map<unknown>;
      const gm = d.get("mxGraphModel") as Y.Map<unknown>;
      const cells = gm.get("mxCell") as Y.Map<Y.XmlElement>;
      const order = gm.get("mxCellOrder") as Y.Array<string>;

      const idx = order.toArray().indexOf("1");
      order.delete(idx, 1);
      cells.delete("1");

      const patch = generatePatch([], doc);
      expect(patch.u?.p1?.cells?.r).toContain("1");
    });

    it("检测修改 cell 属性", () => {
      initDocSnapshot(doc);

      const mxfile = doc.getMap("mxfile") as Y.Map<unknown>;
      const diags = mxfile.get("diagram") as Y.Map<unknown>;
      const d = diags.get("p1") as Y.Map<unknown>;
      const gm = d.get("mxGraphModel") as Y.Map<unknown>;
      const cells = gm.get("mxCell") as Y.Map<Y.XmlElement>;
      const cell = cells.get("1") as Y.XmlElement;
      cell.setAttribute("value", "Changed");

      const patch = generatePatch([], doc);
      expect(patch.u?.p1?.cells?.u?.["1"]?.value).toBe("Changed");
    });

    it("无变更时返回空 patch", () => {
      initDocSnapshot(doc);
      const patch = generatePatch([], doc);
      expect(Object.keys(patch).length).toBe(0);
    });
  });

  describe("复杂场景", () => {
    it("模拟完整的 draw.io 编辑流程", () => {
      applyFilePatch(doc, {
        u: {
          p1: {
            name: "Architecture",
            view: { background: "#f5f5f5" },
            cells: {
              i: [
                { id: "c-server", value: "Server", parent: "0", vertex: "1", style: "rounded=1;fillColor=#dae8fc", previous: "1" },
                { id: "c-db", value: "Database", parent: "0", vertex: "1", style: "shape=cylinder3;fillColor=#d5e8d4", previous: "c-server" },
              ],
              u: {
                "1": { value: "Client", style: "ellipse;fillColor=#fff2cc" },
              },
            },
          },
        },
      });

      applyFilePatch(doc, {
        u: {
          p1: {
            cells: {
              i: [
                { id: "c-edge", value: "HTTP", parent: "0", edge: "1", source: "1", target: "c-server", previous: "c-db" },
              ],
            },
          },
        },
      });

      expect(getCellOrder(doc)).toEqual(["0", "1", "c-server", "c-db", "c-edge"]);
      expect(getCellAttrs(doc, "1").value).toBe("Client");
      expect(getCellAttrs(doc, "c-server").value).toBe("Server");
      expect(getCellAttrs(doc, "c-db").value).toBe("Database");
      expect(getCellAttrs(doc, "c-edge").value).toBe("HTTP");
      expect(getCellAttrs(doc, "c-edge").edge).toBe("1");

      verifyDocState(doc);
    });

    it("多页面编辑流程", () => {
      applyFilePatch(doc, {
        i: [{
          id: "p2",
          previous: "p1",
          data: '<diagram name="Page-2" id="p2"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram>',
        }],
      });

      applyFilePatch(doc, {
        u: {
          p1: {
            cells: {
              u: { "1": { value: "P1 Cell" } },
            },
          },
          p2: {
            cells: {
              i: [{ id: "c-p2", value: "P2 Cell", parent: "0", vertex: "1" }],
            },
          },
        },
      });

      applyFilePatch(doc, {
        u: { p2: { previous: "" } },
      });

      expect(getDiagramOrder(doc)).toEqual(["p2", "p1"]);
      expect(getCellAttrs(doc, "1").value).toBe("P1 Cell");
      expect(getCellAttrs(doc, "c-p2", "p2").value).toBe("P2 Cell");

      const xml = verifyDocState(doc);
      expect(xml).toContain("P1 Cell");
      expect(xml).toContain("P2 Cell");
    });

    it("撤销模拟：通过反向操作恢复状态", () => {
      const originalXml = ydoc2xml(doc);

      applyFilePatch(doc, {
        u: {
          p1: {
            cells: {
              i: [{ id: "c-undo", value: "Should be removed", parent: "0", vertex: "1", previous: "1" }],
              u: { "1": { value: "Changed" } },
            },
          },
        },
      });

      expect(getCellOrder(doc)).toContain("c-undo");
      expect(getCellAttrs(doc, "1").value).toBe("Changed");

      applyFilePatch(doc, {
        u: {
          p1: {
            cells: {
              r: ["c-undo"],
              u: { "1": { value: "Hello" } },
            },
          },
        },
      });

      expect(getCellOrder(doc)).not.toContain("c-undo");
      expect(getCellAttrs(doc, "1").value).toBe("Hello");

      const restoredXml = ydoc2xml(doc);
      const doc2 = new Y.Doc();
      xml2ydoc(restoredXml, doc2);
      const xml2 = ydoc2xml(doc2);

      expect(xml2).toContain('id="0"');
      expect(xml2).toContain('id="1"');
      expect(xml2).toContain("Hello");
    });
  });

  describe("边界情况", () => {
    it("空 doc 不崩溃", () => {
      const emptyDoc = new Y.Doc();
      expect(() => applyFilePatch(emptyDoc, { u: { p1: { cells: { r: ["1"] } } } })).not.toThrow();
    });

    it("重复 ID 自动清理", () => {
      applyFilePatch(doc, {
        u: {
          p1: {
            cells: {
              i: [
                { id: "c-dup", value: "First", parent: "0", vertex: "1", previous: "1" },
                { id: "c-dup", value: "Second", parent: "0", vertex: "1", previous: "c-dup" },
              ],
            },
          },
        },
      });

      const order = getCellOrder(doc);
      const dupCount = order.filter((id) => id === "c-dup").length;
      expect(dupCount).toBe(1);

      verifyDocState(doc);
    });

    it("大量操作后状态仍正确", () => {
      for (let i = 0; i < 20; i++) {
        applyFilePatch(doc, {
          u: {
            p1: {
              cells: {
                i: [{
                  id: `c-${i}`,
                  value: `Node ${i}`,
                  parent: "0",
                  vertex: "1",
                  previous: i === 0 ? "1" : `c-${i - 1}`,
                }],
              },
            },
          },
        });
      }

      expect(getCellOrder(doc).length).toBe(22);

      for (let i = 19; i >= 0; i -= 2) {
        applyFilePatch(doc, {
          u: { p1: { cells: { r: [`c-${i}`] } } },
        });
      }

      expect(getCellOrder(doc).length).toBe(12);

      verifyDocState(doc);
    });
  });
});
