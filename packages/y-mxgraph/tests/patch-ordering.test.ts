import { describe, it, expect } from "vitest";
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

function getOrder(doc: Y.Doc, diagramId = "p1"): string[] {
  const mxfile = doc.getMap("mxfile") as Y.Map<any>;
  const diags = mxfile.get("diagram") as Y.Map<any>;
  const gm = (diags.get(diagramId) as Y.Map<any>).get("mxGraphModel") as Y.Map<any>;
  return (gm.get("mxCellOrder") as Y.Array<string>).toArray();
}

describe("insertAfterUnique — 空串语义修复", () => {
  it("previous=\"\" 将 cell 插到最前面", () => {
    const doc = makeDoc();
    applyFilePatch(doc, {
      u: {
        p1: {
          cells: {
            i: [{ id: "c-front", value: "front", parent: "1", vertex: "1", previous: "" }],
          },
        },
      },
    });
    const order = getOrder(doc);
    // previous="" 表示插到最前面
    expect(order.indexOf("c-front")).toBe(0);
  });

  it("previous=null 表示未找到，fallbackToEnd=true 时插到末尾", () => {
    const doc = makeDoc();
    applyFilePatch(doc, {
      u: {
        p1: {
          cells: {
            i: [{ id: "c-end", value: "end", parent: "1", vertex: "1" } as any],
          },
        },
      },
    });
    const order = getOrder(doc);
    expect(order[order.length - 1]).toBe("c-end");
  });

  it("previous=某个id 时插在该 id 之后", () => {
    const doc = makeDoc();
    applyFilePatch(doc, {
      u: {
        p1: {
          cells: {
            i: [{ id: "c-after", value: "after", parent: "1", vertex: "1", previous: "1" }],
          },
        },
      },
    });
    const order = getOrder(doc);
    const idx1 = order.indexOf("1");
    const idxAfter = order.indexOf("c-after");
    expect(idxAfter).toBe(idx1 + 1);
  });
});

describe("prevNeighbor — null vs \"\" 语义", () => {
  it("generatePatch: 新 diagram previous 为空串表示在最前面", () => {
    const doc = makeDoc();
    // 先建立 snapshot 基线
    initDocSnapshot(doc);
    const mxfile = doc.getMap("mxfile") as Y.Map<any>;
    const diags = mxfile.get("diagram") as Y.Map<any>;
    const order = mxfile.get("diagramOrder") as Y.Array<string>;

    // 添加新 diagram 到最前面
    const newDiag = new Y.Map();
    newDiag.set("id", "p0");
    newDiag.set("name", "Page-0");
    const gm = new Y.Map();
    const cellsMap = new Y.Map();
    const cellOrder = new Y.Array<string>();
    cellsMap.set("0", new Y.XmlElement("mxCell"));
    cellOrder.push(["0"]);
    gm.set("mxCell", cellsMap);
    gm.set("mxCellOrder", cellOrder);
    newDiag.set("mxGraphModel", gm);

    diags.set("p0", newDiag);
    order.insert(0, ["p0"]);

    // generatePatch 需要事件，但 explicitDoc 模式可以直接用
    const events: any[] = [];
    const patch = generatePatch(events, doc);

    // p0 是新增的，previous 应为 ""（在最前面）
    expect(patch.i).toBeDefined();
    const insert = patch.i!.find((item) => item.id === "p0");
    expect(insert).toBeDefined();
    expect(insert!.previous).toBe("");
  });
});

describe("mxGraphModel.serialize 防御性过滤", () => {
  it("cellsOrder 中缺失的 id 不会导致崩溃", () => {
    const doc = makeDoc();
    const mxfile = doc.getMap("mxfile") as Y.Map<any>;
    const diags = mxfile.get("diagram") as Y.Map<any>;
    const gm = (diags.get("p1") as Y.Map<any>).get("mxGraphModel") as Y.Map<any>;
    const cells = gm.get("mxCell") as Y.Map<any>;
    const cellOrder = gm.get("mxCellOrder") as Y.Array<string>;

    // 删除 cells 中的一个 id，但保留在 cellsOrder 中
    cells.delete("1");
    // 不应该崩溃
    expect(() => {
      serialize(gm);
    }).not.toThrow();
  });
});
