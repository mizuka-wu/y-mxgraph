import { describe, it, expect, vi, afterEach } from "vitest";
import * as Y from "yjs";
import { xml2ydoc } from "../src/transform/index";
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

function getCellStructures(doc: Y.Doc, diagramId = "p1") {
  const mxfile = doc.getMap("mxfile") as Y.Map<unknown>;
  const diags = mxfile.get("diagram") as Y.Map<unknown>;
  const d = diags.get(diagramId) as Y.Map<unknown>;
  const gm = d.get("mxGraphModel") as Y.Map<unknown>;
  const cellsMap = gm.get("mxCell") as Y.Map<Y.XmlElement>;
  const orderArr = gm.get("mxCellOrder") as Y.Array<string>;
  return { mxfile, diags, d, gm, cellsMap, orderArr };
}

function getCellOrder(doc: Y.Doc, diagramId = "p1"): string[] {
  return getCellStructures(doc, diagramId).orderArr.toArray();
}

function getCellAttrs(doc: Y.Doc, cellId: string, diagramId = "p1"): Record<string, string> {
  const { cellsMap } = getCellStructures(doc, diagramId);
  const cell = cellsMap.get(cellId) as Y.XmlElement | undefined;
  return cell ? ((cell.getAttributes() as Record<string, string>) || {}) : {};
}

describe("P0: cellsMap.delete guarded with has() check", () => {
  it("删除不存在的 cell 时 cellsMap.has 检查保护不报错", () => {
    const doc = makeDoc();
    expect(() => {
      applyFilePatch(doc, {
        u: { p1: { cells: { r: ["nonexistent"] } } },
      });
    }).not.toThrow();
    expect(getCellOrder(doc)).toEqual(["0", "1"]);
  });

  it("删除 orderArr 中存在但 cellsMap 中不存在的 cell 不崩溃", () => {
    const doc = makeDoc();
    const { cellsMap } = getCellStructures(doc);
    cellsMap.delete("1");
    expect(() => {
      applyFilePatch(doc, {
        u: { p1: { cells: { r: ["1"] } } },
      });
    }).not.toThrow();
    expect(getCellOrder(doc)).not.toContain("1");
  });

  it("删除 cellsMap 中存在的 cell 正常删除", () => {
    const doc = makeDoc();
    applyFilePatch(doc, {
      u: { p1: { cells: { r: ["1"] } } },
    });
    const { cellsMap } = getCellStructures(doc);
    expect(cellsMap.has("1")).toBe(false);
    expect(getCellOrder(doc)).not.toContain("1");
  });
});

describe("P0: cell update with missing cell -> console.warn", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("更新存在的 cell 正常生效且不触发 warn", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = makeDoc();
    applyFilePatch(doc, {
      u: { p1: { cells: { u: { "1": { value: "updated" } } } } },
    });
    expect(getCellAttrs(doc, "1").value).toBe("updated");
    const warnCalls = (console.warn as any).mock.calls.filter(
      (args: string[]) => args[0]?.includes?.("cell") && args[0]?.includes?.("not found")
    );
    expect(warnCalls.length).toBe(0);
  });

  it("更新不存在的 cell 触发 console.warn", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = makeDoc();
    applyFilePatch(doc, {
      u: { p1: { cells: { u: { "nonexistent": { value: "x" } } } } },
    });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("cell nonexistent not found in cellsMap"),
    );
  });

  it("更新不存在的 cell 不破坏其他 cells", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = makeDoc();
    applyFilePatch(doc, {
      u: { p1: { cells: { u: { "nonexistent": { value: "x" }, "1": { value: "ok" } } } } },
    });
    expect(getCellAttrs(doc, "1").value).toBe("ok");
    expect(getCellOrder(doc)).toEqual(["0", "1"]);
  });
});

describe("P0: yMxGraphModel missing -> warn and skip", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("diagram 中无 mxGraphModel 时 warn 并跳过 cell 操作", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = makeDoc();
    const { d } = getCellStructures(doc);
    d.delete("mxGraphModel");
    expect(() => {
      applyFilePatch(doc, {
        u: { p1: { cells: { r: ["1"] } } },
      });
    }).not.toThrow();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("yMxGraphModel not found"),
    );
  });

  it("yMxGraphModel 缺失时 diagram name 仍然可以更新", () => {
    const doc = makeDoc();
    const { d } = getCellStructures(doc);
    d.delete("mxGraphModel");
    applyFilePatch(doc, {
      u: { p1: { name: "Renamed", cells: { r: ["1"] } } },
    });
    expect((d as Y.Map<unknown>).get("name")).toBe("Renamed");
  });
});

describe("P0: both cellsMap and orderArr missing -> warn", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("cellsMap 和 orderArr 都缺失时 warn 并跳过", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = makeDoc();
    const { gm } = getCellStructures(doc);
    gm.delete("mxCell");
    gm.delete("mxCellOrder");
    expect(() => {
      applyFilePatch(doc, {
        u: { p1: { cells: { r: ["1"] } } },
      });
    }).not.toThrow();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("both cellsMap and orderArr missing"),
    );
  });
});

describe("P0: cellsMap missing -> degraded orderArr-only operations", () => {
  it("cellsMap 缺失时 cell remove 只从 orderArr 删除", () => {
    const doc = makeDoc();
    const { gm } = getCellStructures(doc);
    gm.delete("mxCell");
    expect(() => {
      applyFilePatch(doc, {
        u: { p1: { cells: { r: ["1"] } } },
      });
    }).not.toThrow();
    expect(getCellOrder(doc)).not.toContain("1");
  });

  it("cellsMap 缺失时 cell insert 只插入 orderArr", () => {
    const doc = makeDoc();
    const { gm } = getCellStructures(doc);
    gm.delete("mxCell");
    expect(() => {
      applyFilePatch(doc, {
        u: { p1: { cells: { i: [{ id: "c2", value: "2", parent: "1", vertex: "1", previous: "" }] } } },
      });
    }).not.toThrow();
    expect(getCellOrder(doc)).toContain("c2");
  });

  it("cellsMap 缺失时 cell update 跳过属性更新但处理 reorder", () => {
    const doc = makeDoc();
    const { gm } = getCellStructures(doc);
    gm.delete("mxCell");
    expect(() => {
      applyFilePatch(doc, {
        u: { p1: { cells: { u: { "1": { previous: "0" } } } } },
      });
    }).not.toThrow();
    const order = getCellOrder(doc);
    expect(order.indexOf("1")).toBe(order.indexOf("0") + 1);
  });
});

describe("P0: orderArr missing -> degraded cellsMap-only operations", () => {
  it("orderArr 缺失时 cell remove 只从 cellsMap 删除", () => {
    const doc = makeDoc();
    const { gm, cellsMap } = getCellStructures(doc);
    gm.delete("mxCellOrder");
    expect(cellsMap.has("1")).toBe(true);
    expect(() => {
      applyFilePatch(doc, {
        u: { p1: { cells: { r: ["1"] } } },
      });
    }).not.toThrow();
    expect(cellsMap.has("1")).toBe(false);
  });

  it("orderArr 缺失时 cell insert 只插入 cellsMap", () => {
    const doc = makeDoc();
    const { gm, cellsMap } = getCellStructures(doc);
    gm.delete("mxCellOrder");
    expect(() => {
      applyFilePatch(doc, {
        u: { p1: { cells: { i: [{ id: "c2", value: "2", parent: "1", vertex: "1", previous: "" }] } } },
      });
    }).not.toThrow();
    expect(cellsMap.has("c2")).toBe(true);
  });

  it("orderArr 缺失时 cell update reorder 降级不崩溃", () => {
    const doc = makeDoc();
    const { gm } = getCellStructures(doc);
    gm.delete("mxCellOrder");
    expect(() => {
      applyFilePatch(doc, {
        u: { p1: { cells: { u: { "1": { previous: "" } } } } },
      });
    }).not.toThrow();
  });
});

describe("P0: diagram-level defensive behavior", () => {
  it("空 doc 调用 applyFilePatch 不崩溃", () => {
    const doc = new Y.Doc();
    expect(() => {
      applyFilePatch(doc, {
        r: ["p1"],
        i: [{ id: "p2", previous: "", data: '<diagram name="P2" id="p2"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram>' }],
        u: { p1: { name: "x" } },
      });
    }).not.toThrow();
  });
});

describe("P0: generatePatch defensive behavior", () => {
  it("空 doc 调用 generatePatch 返回空 patch", () => {
    const doc = new Y.Doc();
    const patch = generatePatch([], doc);
    expect(Object.keys(patch).length).toBe(0);
  });

  it("doc 无 mxfile map 时返回空 patch", () => {
    const doc = new Y.Doc();
    const patch = generatePatch([], doc);
    expect(Object.keys(patch).length).toBe(0);
  });

  it("initDocSnapshot 在空 doc 上不崩溃", () => {
    const doc = new Y.Doc();
    expect(() => { initDocSnapshot(doc); }).not.toThrow();
  });

  it("initDocSnapshot 在无 diagram 的 mxfile 上不崩溃", () => {
    const doc = new Y.Doc();
    const mxfile = doc.getMap("mxfile");
    mxfile.set("diagram", new Y.Map());
    mxfile.set("diagramOrder", new Y.Array<string>());
    expect(() => { initDocSnapshot(doc); }).not.toThrow();
  });

  it("diagramOrder 为空但 diagram map 有数据时能恢复", () => {
    const doc = makeDoc();
    const { mxfile } = getCellStructures(doc);
    const order = mxfile.get("diagramOrder") as Y.Array<string>;
    order.delete(0, order.length);
    expect(() => { generatePatch([], doc); }).not.toThrow();
  });
});

describe("P0: initDocSnapshot error handling", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("initDocSnapshot 遇到 diagramsMap.get undefined 时跳过", () => {
    const doc = makeDoc();
    const { mxfile } = getCellStructures(doc);
    const order = mxfile.get("diagramOrder") as Y.Array<string>;
    order.push(["no-such-diagram"]);
    expect(() => { initDocSnapshot(doc); }).not.toThrow();
  });
});

describe("P1: mixed operations with defensive warnings", () => {
  it("删除多个 cell 其中有不存在的 -> 不报错，已存在的删除成功", () => {
    const doc = makeDoc(BASE_XML.replace("</root>", '<mxCell id="c1" parent="1" vertex="1"/><mxCell id="c2" parent="1" vertex="1"/></root>'));
    applyFilePatch(doc, {
      u: { p1: { cells: { r: ["c1", "nonexistent", "c2"] } } },
    });
    const { cellsMap } = getCellStructures(doc);
    expect(cellsMap.has("c1")).toBe(false);
    expect(cellsMap.has("c2")).toBe(false);
    expect(cellsMap.has("0")).toBe(true);
    expect(cellsMap.has("1")).toBe(true);
  });

  it("同时操作 insert + remove + update 全部成功", () => {
    const doc = makeDoc();
    applyFilePatch(doc, {
      u: {
        p1: {
          cells: {
            r: ["1"],
            i: [{ id: "new-cell", value: "new", parent: "0", vertex: "1", previous: "" }],
            u: { "0": { style: "rounded=1" } },
          },
        },
      },
    });
    const { cellsMap } = getCellStructures(doc);
    expect(cellsMap.has("1")).toBe(false);
    expect(cellsMap.has("new-cell")).toBe(true);
    const cell0 = cellsMap.get("0") as Y.XmlElement;
    expect(cell0.getAttribute("style")).toBe("rounded=1");
  });
});

describe("P1: diagram-level missing structures", () => {
  it("update.diagram 在 diagramsMap 中不存在 -> 跳过（不崩溃）", () => {
    const doc = makeDoc();
    expect(() => {
      applyFilePatch(doc, {
        u: { "nonexistent-diagram": { name: "x", cells: { r: ["1"] } } },
      });
    }).not.toThrow();
  });
});

describe("P2: pruneEmptyPatch cleanup", () => {
  it("空 cell update 被 pruneEmptyPatch 清理", () => {
    const doc = makeDoc();
    initDocSnapshot(doc);
    const patch = generatePatch([], doc);
    expect(Object.keys(patch).length).toBe(0);
  });
});

describe("P2: null/undefined/malformed patch values", () => {
  it('patch 中 cells.r 为 null 时不崩溃', () => {
    const doc = makeDoc();
    expect(() => {
      applyFilePatch(doc, {
        u: { p1: { cells: { r: null as any } } },
      });
    }).not.toThrow();
  });
});
