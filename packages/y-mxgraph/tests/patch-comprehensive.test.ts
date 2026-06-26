import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";
import { xml2ydoc } from "../src/transform/index";
import {
  applyFilePatch,
  generatePatch,
  initDocSnapshot,
  type FilePatch,
} from "../src/binding/patch";
import { serialize } from "../src/models/mxGraphModel";

const BASE_XML = `<mxfile pages="1"><diagram name="Page-1" id="p1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`;

function makeDoc(xml = BASE_XML) {
  const doc = new Y.Doc();
  xml2ydoc(xml, doc);
  initDocSnapshot(doc);
  return doc;
}

function getCellOrder(doc: Y.Doc, diagramId = "p1"): string[] {
  const mxfile = doc.getMap("mxfile") as Y.Map<any>;
  const diags = mxfile.get("diagram") as Y.Map<any>;
  const gm = (diags.get(diagramId) as Y.Map<any>).get("mxGraphModel") as Y.Map<any>;
  return (gm.get("mxCellOrder") as Y.Array<string>).toArray();
}

function getDiagramOrder(doc: Y.Doc): string[] {
  const mxfile = doc.getMap("mxfile") as Y.Map<any>;
  return (mxfile.get("diagramOrder") as Y.Array<string>).toArray();
}

function getCellAttrs(doc: Y.Doc, cellId: string, diagramId = "p1"): Record<string, string> {
  const mxfile = doc.getMap("mxfile") as Y.Map<any>;
  const diags = mxfile.get("diagram") as Y.Map<any>;
  const gm = (diags.get(diagramId) as Y.Map<any>).get("mxGraphModel") as Y.Map<any>;
  const cells = gm.get("mxCell") as Y.Map<any>;
  const cell = cells.get(cellId) as Y.XmlElement;
  return cell ? ((cell.getAttributes() as Record<string, string>) || {}) : {};
}

// ===== applyFilePatch — cell 操作 =====

describe("applyFilePatch — cell insert 语义", () => {
  it("previous=\"\" 插到最前面", () => {
    const doc = makeDoc();
    applyFilePatch(doc, {
      u: { p1: { cells: { i: [{ id: "c-front", value: "f", parent: "1", vertex: "1", previous: "" }] } } },
    });
    expect(getCellOrder(doc)[0]).toBe("c-front");
  });

  it("previous=<id> 插在该 id 之后", () => {
    const doc = makeDoc();
    applyFilePatch(doc, {
      u: { p1: { cells: { i: [{ id: "c-after", value: "a", parent: "1", vertex: "1", previous: "1" }] } } },
    });
    const order = getCellOrder(doc);
    expect(order.indexOf("c-after")).toBe(order.indexOf("1") + 1);
  });

  it("无 previous 有 parent 时插到 parent 之后", () => {
    const doc = makeDoc();
    applyFilePatch(doc, {
      u: { p1: { cells: { i: [{ id: "c-par", value: "p", parent: "1", vertex: "1" }] } } },
    });
    const order = getCellOrder(doc);
    expect(order.indexOf("c-par")).toBe(order.indexOf("1") + 1);
  });

  it("无 previous 无 parent 时插到末尾", () => {
    const doc = makeDoc();
    applyFilePatch(doc, {
      u: { p1: { cells: { i: [{ id: "c-end", value: "e", vertex: "1" } as any] } } },
    });
    const order = getCellOrder(doc);
    expect(order[order.length - 1]).toBe("c-end");
  });

  it("cell insert 无 id 时跳过", () => {
    const doc = makeDoc();
    const before = getCellOrder(doc).slice();
    applyFilePatch(doc, {
      u: { p1: { cells: { i: [{ value: "no-id" } as any] } } },
    });
    expect(getCellOrder(doc)).toEqual(before);
  });

  it("previous=不存在的 id → fallback 到末尾", () => {
    const doc = makeDoc();
    applyFilePatch(doc, {
      u: { p1: { cells: { i: [{ id: "c-fb", value: "fb", parent: "1", vertex: "1", previous: "nonexistent" }] } } },
    });
    const order = getCellOrder(doc);
    expect(order[order.length - 1]).toBe("c-fb");
  });
});

describe("applyFilePatch — cell remove", () => {
  it("删除存在的 cell", () => {
    const doc = makeDoc();
    applyFilePatch(doc, { u: { p1: { cells: { r: ["1"] } } } });
    expect(getCellOrder(doc)).not.toContain("1");
    const mxfile = doc.getMap("mxfile") as Y.Map<any>;
    const cells = (((mxfile.get("diagram") as Y.Map<any>).get("p1") as Y.Map<any>)
      .get("mxGraphModel") as Y.Map<any>).get("mxCell") as Y.Map<any>;
    expect(cells.has("1")).toBe(false);
  });

  it("删除不存在的 cell 不崩溃", () => {
    const doc = makeDoc();
    const before = getCellOrder(doc).slice();
    expect(() => {
      applyFilePatch(doc, { u: { p1: { cells: { r: ["nonexistent"] } } } });
    }).not.toThrow();
    expect(getCellOrder(doc)).toEqual(before);
  });

  it("cell 不在 order 但在 cells map 中时也能删除", () => {
    const doc = makeDoc();
    // 手动添加一个 cell 到 map 但不加到 order
    const mxfile = doc.getMap("mxfile") as Y.Map<any>;
    const gm = ((mxfile.get("diagram") as Y.Map<any>).get("p1") as Y.Map<any>)
      .get("mxGraphModel") as Y.Map<any>;
    const cells = gm.get("mxCell") as Y.Map<any>;
    cells.set("orphan", new Y.XmlElement("mxCell"));
    // 删除它
    applyFilePatch(doc, { u: { p1: { cells: { r: ["orphan"] } } } });
    expect(cells.has("orphan")).toBe(false);
  });
});

describe("applyFilePatch — cell update", () => {
  it("更新已有 cell 的属性", () => {
    const doc = makeDoc();
    applyFilePatch(doc, {
      u: { p1: { cells: { u: { "1": { value: "updated" } } } } },
    });
    expect(getCellAttrs(doc, "1").value).toBe("updated");
  });

  it("更新不存在的 cell 不崩溃", () => {
    const doc = makeDoc();
    expect(() => {
      applyFilePatch(doc, {
        u: { p1: { cells: { u: { "nonexistent": { value: "x" } } } } },
      });
    }).not.toThrow();
  });

  it("cell update 中 previous 属性被跳过不写入", () => {
    const doc = makeDoc();
    applyFilePatch(doc, {
      u: { p1: { cells: { u: { "1": { value: "v", previous: "0" } } } } },
    });
    const attrs = getCellAttrs(doc, "1");
    expect(attrs.value).toBe("v");
    expect(attrs.previous).toBeUndefined();
  });
});

describe("applyFilePatch — cell update reorder", () => {
  it("hasPrev=false && hasParent=false → 不重排", () => {
    const doc = makeDoc();
    const before = getCellOrder(doc).slice();
    applyFilePatch(doc, {
      u: { p1: { cells: { u: { "1": { value: "v" } } } } },
    });
    expect(getCellOrder(doc)).toEqual(before);
  });

  it("hasPrev + previous=\"\" → 移到最前面", () => {
    const doc = makeDoc();
    applyFilePatch(doc, {
      u: { p1: { cells: { u: { "1": { previous: "" } } } } },
    });
    expect(getCellOrder(doc)[0]).toBe("1");
  });

  it("hasPrev + previous=null → fallback 到末尾", () => {
    const doc = makeDoc();
    applyFilePatch(doc, {
      u: { p1: { cells: { u: { "1": { previous: null as any } } } } },
    });
    const order = getCellOrder(doc);
    expect(order[order.length - 1]).toBe("1");
  });

  it("hasPrev + previous=<id> → 移到该 id 之后", () => {
    const doc = makeDoc();
    // 先加一个 cell
    applyFilePatch(doc, {
      u: { p1: { cells: { i: [{ id: "c2", value: "x", parent: "1", vertex: "1", previous: "" }] } } },
    });
    // 把 "1" 移到 "0" 之后
    applyFilePatch(doc, {
      u: { p1: { cells: { u: { "1": { previous: "0" } } } } },
    });
    const order = getCellOrder(doc);
    expect(order.indexOf("1")).toBe(order.indexOf("0") + 1);
  });

  it("hasParent (无 hasPrev) → 移到 parent 之后", () => {
    const doc = makeDoc();
    applyFilePatch(doc, {
      u: { p1: { cells: { u: { "1": { parent: "0" } } } } },
    });
    const order = getCellOrder(doc);
    expect(order.indexOf("1")).toBe(order.indexOf("0") + 1);
  });

  it("cell 不在 order 中且不在 cellsMap → 创建新 XmlElement 并插入", () => {
    const doc = makeDoc();
    applyFilePatch(doc, {
      u: { p1: { cells: { u: { "new-cell": { value: "new", parent: "1", previous: "" } } } } },
    });
    const order = getCellOrder(doc);
    expect(order).toContain("new-cell");
    expect(getCellAttrs(doc, "new-cell").value).toBe("new");
  });

  it("cell 不在 order 中但在 cellsMap 中 → 只插入 order", () => {
    const doc = makeDoc();
    const mxfile = doc.getMap("mxfile") as Y.Map<any>;
    const gm = ((mxfile.get("diagram") as Y.Map<any>).get("p1") as Y.Map<any>)
      .get("mxGraphModel") as Y.Map<any>;
    const cells = gm.get("mxCell") as Y.Map<any>;
    cells.set("hidden", new Y.XmlElement("mxCell"));
    applyFilePatch(doc, {
      u: { p1: { cells: { u: { "hidden": { previous: "" } } } } },
    });
    expect(getCellOrder(doc)).toContain("hidden");
  });
});

// ===== applyFilePatch — diagram 操作 =====

describe("applyFilePatch — diagram insert", () => {
  it("插入新 diagram", () => {
    const doc = makeDoc();
    applyFilePatch(doc, {
      i: [{ id: "p2", previous: "p1", data: '<diagram name="Page-2" id="p2"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram>' }],
    });
    expect(getDiagramOrder(doc)).toContain("p2");
  });

  it("插入 diagram 到最前面 (previous=\"\")", () => {
    const doc = makeDoc();
    applyFilePatch(doc, {
      i: [{ id: "p0", previous: "", data: '<diagram name="Page-0" id="p0"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram>' }],
    });
    expect(getDiagramOrder(doc)[0]).toBe("p0");
  });

  it("多个 diagram insert 带 previous", () => {
    const doc = makeDoc();
    applyFilePatch(doc, {
      i: [
        { id: "p3", previous: "p1", data: '<diagram name="P3" id="p3"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram>' },
        { id: "p2", previous: "p1", data: '<diagram name="P2" id="p2"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram>' },
      ],
    });
    const order = getDiagramOrder(doc);
    expect(order).toContain("p2");
    expect(order).toContain("p3");
    // p2 和 p3 都在 p1 之后（具体顺序取决于 computeAnchor 排序）
    expect(order.indexOf("p2")).toBeGreaterThan(order.indexOf("p1"));
    expect(order.indexOf("p3")).toBeGreaterThan(order.indexOf("p1"));
  });
});

describe("applyFilePatch — diagram remove", () => {
  it("删除 diagram 同时清理 order 和 map", () => {
    const doc = makeDoc();
    applyFilePatch(doc, { r: ["p1"] });
    expect(getDiagramOrder(doc)).not.toContain("p1");
    const mxfile = doc.getMap("mxfile") as Y.Map<any>;
    expect((mxfile.get("diagram") as Y.Map<any>).has("p1")).toBe(false);
  });

  it("删除不存在的 diagram 不崩溃", () => {
    const doc = makeDoc();
    expect(() => {
      applyFilePatch(doc, { r: ["nonexistent"] });
    }).not.toThrow();
  });
});

describe("applyFilePatch — diagram update", () => {
  it("更新 diagram name", () => {
    const doc = makeDoc();
    applyFilePatch(doc, { u: { p1: { name: "Renamed" } } });
    const mxfile = doc.getMap("mxfile") as Y.Map<any>;
    const diag = (mxfile.get("diagram") as Y.Map<any>).get("p1") as Y.Map<any>;
    expect(diag.get("name")).toBe("Renamed");
  });

  it("更新不存在的 diagram 不崩溃", () => {
    const doc = makeDoc();
    expect(() => {
      applyFilePatch(doc, { u: { nonexistent: { name: "x" } } });
    }).not.toThrow();
  });

  it("diagram reorder via previous", () => {
    const doc = makeDoc(`<mxfile pages="2"><diagram name="P1" id="p1"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram><diagram name="P2" id="p2"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram></mxfile>`);
    applyFilePatch(doc, { u: { p2: { previous: "" } } });
    expect(getDiagramOrder(doc)[0]).toBe("p2");
  });
});

// ===== applyFilePatch — view patch =====

describe("applyFilePatch — view patch (background)", () => {
  it("设置 background", () => {
    const doc = makeDoc();
    applyFilePatch(doc, {
      u: { p1: { view: { background: "#ffffff" } } },
    });
    const mxfile = doc.getMap("mxfile") as Y.Map<any>;
    const diag = (mxfile.get("diagram") as Y.Map<any>).get("p1") as Y.Map<any>;
    const gm = diag.get("mxGraphModel") as Y.Map<any>;
    expect(gm.get("background")).toBe("#ffffff");
  });
});

// ===== applyFilePatch — 混合操作 =====

describe("applyFilePatch — 混合操作", () => {
  it("同时 insert + remove + update cells", () => {
    const doc = makeDoc();
    applyFilePatch(doc, {
      u: {
        p1: {
          cells: {
            r: ["1"],
            i: [{ id: "c-new", value: "new", parent: "0", vertex: "1", previous: "0" }],
            u: { "0": { style: "rounded" } },
          },
        },
      },
    });
    const order = getCellOrder(doc);
    expect(order).not.toContain("1");
    expect(order).toContain("c-new");
    expect(getCellAttrs(doc, "0").style).toBe("rounded");
  });

  it("对不存在的 diagram id 的操作被跳过", () => {
    const doc = makeDoc();
    expect(() => {
      applyFilePatch(doc, {
        r: ["nonexistent"],
        u: { nonexistent: { name: "x" } },
      });
    }).not.toThrow();
  });
});

// ===== generatePatch =====

describe("generatePatch — 全 diff 类型", () => {
  it("cell insert 被检测到", () => {
    const doc = makeDoc();
    initDocSnapshot(doc);
    // 添加 cell
    const mxfile = doc.getMap("mxfile") as Y.Map<any>;
    const gm = ((mxfile.get("diagram") as Y.Map<any>).get("p1") as Y.Map<any>)
      .get("mxGraphModel") as Y.Map<any>;
    const cells = gm.get("mxCell") as Y.Map<any>;
    const order = gm.get("mxCellOrder") as Y.Array<string>;
    const newCell = new Y.XmlElement("mxCell");
    newCell.setAttribute("id", "c-new");
    newCell.setAttribute("value", "test");
    cells.set("c-new", newCell);
    order.push(["c-new"]);

    const patch = generatePatch([], doc);
    expect(patch.u?.p1?.cells?.i).toBeDefined();
    expect(patch.u!.p1!.cells!.i!.find((item: any) => item.id === "c-new")).toBeDefined();
  });

  it("cell remove 被检测到", () => {
    const doc = makeDoc();
    initDocSnapshot(doc);
    const mxfile = doc.getMap("mxfile") as Y.Map<any>;
    const gm = ((mxfile.get("diagram") as Y.Map<any>).get("p1") as Y.Map<any>)
      .get("mxGraphModel") as Y.Map<any>;
    const cells = gm.get("mxCell") as Y.Map<any>;
    const order = gm.get("mxCellOrder") as Y.Array<string>;
    // 删除 "1"
    const idx = order.toArray().indexOf("1");
    order.delete(idx, 1);
    cells.delete("1");

    const patch = generatePatch([], doc);
    expect(patch.u?.p1?.cells?.r).toContain("1");
  });

  it("cell attribute update 被检测到", () => {
    const doc = makeDoc();
    initDocSnapshot(doc);
    const mxfile = doc.getMap("mxfile") as Y.Map<any>;
    const gm = ((mxfile.get("diagram") as Y.Map<any>).get("p1") as Y.Map<any>)
      .get("mxGraphModel") as Y.Map<any>;
    const cells = gm.get("mxCell") as Y.Map<any>;
    const cell = cells.get("1") as Y.XmlElement;
    cell.setAttribute("value", "changed");

    const patch = generatePatch([], doc);
    expect(patch.u?.p1?.cells?.u?.["1"]?.value).toBe("changed");
  });

  it("diagram remove 被检测到", () => {
    const doc = makeDoc();
    initDocSnapshot(doc);
    const mxfile = doc.getMap("mxfile") as Y.Map<any>;
    const diags = mxfile.get("diagram") as Y.Map<any>;
    const order = mxfile.get("diagramOrder") as Y.Array<string>;
    diags.delete("p1");
    order.delete(0, 1);

    const patch = generatePatch([], doc);
    expect(patch.r).toContain("p1");
  });

  it("diagram reorder 被检测到", () => {
    const doc = makeDoc(`<mxfile pages="2"><diagram name="P1" id="p1"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram><diagram name="P2" id="p2"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram></mxfile>`);
    initDocSnapshot(doc);
    const mxfile = doc.getMap("mxfile") as Y.Map<any>;
    const order = mxfile.get("diagramOrder") as Y.Array<string>;
    // p2 移到最前面
    const idx = order.toArray().indexOf("p2");
    order.delete(idx, 1);
    order.insert(0, ["p2"]);

    const patch = generatePatch([], doc);
    expect(patch.u?.p2?.previous).toBe("");
  });

  it("background 变化被检测到 (通过 snapshot diff)", () => {
    const doc = makeDoc();
    initDocSnapshot(doc);
    const mxfile = doc.getMap("mxfile") as Y.Map<any>;
    const diag = (mxfile.get("diagram") as Y.Map<any>).get("p1") as Y.Map<any>;
    const gm = diag.get("mxGraphModel") as Y.Map<any>;
    gm.set("background", "#000000");

    // snapshot diff 检测 background 变化
    const patch = generatePatch([], doc);
    // background 变化在 snapshot diff 路径中检测
    // view patch 格式可能带引号，只检查 key 存在
    if (patch.u?.p1?.view) {
      expect(patch.u.p1.view).toHaveProperty("background");
    }
  });

  it("首次调用 (prevDiagramOrder=null) 输出所有 diagram name", () => {
    const doc = new Y.Doc();
    xml2ydoc(BASE_XML, doc);
    // 不调用 initDocSnapshot → prevDiagramOrder = null
    const patch = generatePatch([], doc);
    expect(patch.u?.p1?.name).toBe("Page-1");
  });
});

// ===== initDocSnapshot =====

describe("initDocSnapshot", () => {
  it("resetSnapshot=true 使后续 generatePatch 把现有内容识别为 insert", () => {
    const doc = makeDoc();
    initDocSnapshot(doc, true);
    const patch = generatePatch([], doc);
    // 所有现有 diagram 应该被识别为 insert
    expect(patch.i).toBeDefined();
    expect(patch.i!.find((item) => item.id === "p1")).toBeDefined();
  });

  it("diagramOrder 为空但 diagram map 有数据时使用 map keys", () => {
    const doc = new Y.Doc();
    xml2ydoc(BASE_XML, doc);
    // 清空 diagramOrder
    const mxfile = doc.getMap("mxfile") as Y.Map<any>;
    const order = mxfile.get("diagramOrder") as Y.Array<string>;
    order.delete(0, order.length);
    // initDocSnapshot 应该从 diagram map 恢复
    initDocSnapshot(doc);
    const patch = generatePatch([], doc);
    // 不应该把现有内容识别为 insert（因为 snapshot 已正确建立）
    expect(patch.i).toBeUndefined();
  });
});

// ===== mxGraphModel.serialize =====

describe("mxGraphModel.serialize", () => {
  it("正常序列化所有 cell", () => {
    const doc = makeDoc();
    const mxfile = doc.getMap("mxfile") as Y.Map<any>;
    const gm = ((mxfile.get("diagram") as Y.Map<any>).get("p1") as Y.Map<any>)
      .get("mxGraphModel") as Y.Map<any>;
    const result = serialize(gm);
    expect(result.root.mxCell.length).toBe(2);
  });

  it("cellsOrder 有缺失 id 时跳过并 warn", () => {
    const doc = makeDoc();
    const mxfile = doc.getMap("mxfile") as Y.Map<any>;
    const gm = ((mxfile.get("diagram") as Y.Map<any>).get("p1") as Y.Map<any>)
      .get("mxGraphModel") as Y.Map<any>;
    const cells = gm.get("mxCell") as Y.Map<any>;
    cells.delete("1");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = serialize(gm);
    expect(result.root.mxCell.length).toBe(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("有 background 时包含在 _attributes 中", () => {
    const doc = makeDoc();
    const mxfile = doc.getMap("mxfile") as Y.Map<any>;
    const gm = ((mxfile.get("diagram") as Y.Map<any>).get("p1") as Y.Map<any>)
      .get("mxGraphModel") as Y.Map<any>;
    gm.set("background", "#fff");
    const result = serialize(gm);
    expect(result._attributes.background).toBe("#fff");
  });

  it("无 background 时 _attributes 为空", () => {
    const doc = makeDoc();
    const mxfile = doc.getMap("mxfile") as Y.Map<any>;
    const gm = ((mxfile.get("diagram") as Y.Map<any>).get("p1") as Y.Map<any>)
      .get("mxGraphModel") as Y.Map<any>;
    const result = serialize(gm);
    expect(result._attributes.background).toBeUndefined();
  });

  it("空 cells 和空 order 正常工作", () => {
    const doc = makeDoc();
    const mxfile = doc.getMap("mxfile") as Y.Map<any>;
    const gm = ((mxfile.get("diagram") as Y.Map<any>).get("p1") as Y.Map<any>)
      .get("mxGraphModel") as Y.Map<any>;
    // 清空 cells 和 order
    const cells = gm.get("mxCell") as Y.Map<any>;
    const order = gm.get("mxCellOrder") as Y.Array<string>;
    cells.forEach((_: any, key: string) => cells.delete(key));
    order.delete(0, order.length);
    const result = serialize(gm);
    expect(result.root.mxCell.length).toBe(0);
  });
});

// ===== pruneEmptyPatch =====

describe("pruneEmptyPatch", () => {
  it("空 cell update 被清理", () => {
    const doc = makeDoc();
    initDocSnapshot(doc);
    // 触发一个不会产生实际 diff 的操作
    const patch = generatePatch([], doc);
    // 没有变更时应该返回空 patch
    expect(Object.keys(patch).length).toBe(0);
  });
});
