import { describe, it, expect, beforeEach } from "vitest";
import * as Y from "yjs";
import { xml2ydoc, ydoc2xml } from "../src/transform/index";

const MXFILE_XML = `<mxfile pages="1"><diagram name="Page-1" id="page1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`;

const MXFILE_2PAGES = `<mxfile pages="2"><diagram name="A" id="dA"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram><diagram name="B" id="dB"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`;

const MXGRAPHMODEL_XML = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>`;

describe("xml2ydoc", () => {
  it("mxfile 格式写入 doc，返回同一 doc", () => {
    const doc = new Y.Doc();
    const result = xml2ydoc(MXFILE_XML, doc);
    expect(result).toBe(doc);
    expect(doc.share.has("mxfile")).toBe(true);
  });

  it("mxGraphModel 格式写入 doc", () => {
    const doc = new Y.Doc();
    xml2ydoc(MXGRAPHMODEL_XML, doc);
    expect(doc.share.has("mxGraphModel")).toBe(true);
  });

  it("不支持的格式抛出异常", () => {
    const doc = new Y.Doc();
    expect(() => xml2ydoc("<foo/>", doc)).toThrow();
  });

  it("解析 diagram 名称正确", () => {
    const doc = new Y.Doc();
    xml2ydoc(MXFILE_XML, doc);
    const mxfile = doc.getMap("mxfile");
    const diagrams = mxfile.get("diagram") as Y.Map<any>;
    const page1 = diagrams.get("page1") as Y.Map<any>;
    expect(page1.get("name")).toBe("Page-1");
  });

  it("解析多页 diagram 顺序正确", () => {
    const doc = new Y.Doc();
    xml2ydoc(MXFILE_2PAGES, doc);
    const mxfile = doc.getMap("mxfile");
    const order = mxfile.get("diagramOrder") as Y.Array<string>;
    expect(order.toArray()).toEqual(["dA", "dB"]);
  });

  it("解析 mxCell 数量正确", () => {
    const doc = new Y.Doc();
    xml2ydoc(MXFILE_XML, doc);
    const mxfile = doc.getMap("mxfile");
    const diagrams = mxfile.get("diagram") as Y.Map<any>;
    const page1 = diagrams.get("page1") as Y.Map<any>;
    const gm = page1.get("mxGraphModel") as Y.Map<any>;
    const cells = gm.get("mxCell") as Y.Map<any>;
    expect(cells.size).toBe(2);
  });
});

describe("ydoc2xml", () => {
  it("mxfile 往返转换结构一致", () => {
    const doc = new Y.Doc();
    xml2ydoc(MXFILE_XML, doc);
    const out = ydoc2xml(doc);
    expect(out).toContain("mxfile");
    expect(out).toContain("Page-1");
    expect(out).toContain("mxCell");
  });

  it("mxGraphModel 往返转换结构一致", () => {
    const doc = new Y.Doc();
    xml2ydoc(MXGRAPHMODEL_XML, doc);
    const out = ydoc2xml(doc);
    expect(out).toContain("mxGraphModel");
    expect(out).toContain("mxCell");
  });

  it("空 doc 返回空字符串", () => {
    const doc = new Y.Doc();
    const out = ydoc2xml(doc);
    expect(out).toBe("");
  });

  it("spaces 参数影响缩进", () => {
    const doc = new Y.Doc();
    xml2ydoc(MXFILE_XML, doc);
    const compact = ydoc2xml(doc, 0);
    const indented = ydoc2xml(doc, 2);
    expect(indented.length).toBeGreaterThan(compact.length);
  });

  it("两次往返，mxCell id 保持不变", () => {
    const doc = new Y.Doc();
    xml2ydoc(MXFILE_XML, doc);
    const xml1 = ydoc2xml(doc);
    const doc2 = new Y.Doc();
    xml2ydoc(xml1, doc2);
    const xml2 = ydoc2xml(doc2);
    expect(xml2).toContain('id="0"');
    expect(xml2).toContain('id="1"');
  });

  it("mxGeometry 往返不丢失", () => {
    const xml = `<mxGraphModel><root>
      <mxCell id="0" />
      <mxCell id="1" parent="0" />
      <mxCell id="cell1" vertex="1" parent="1">
        <mxGeometry x="10" y="20" width="100" height="80" as="geometry" />
      </mxCell>
    </root></mxGraphModel>`;

    const doc = new Y.Doc();
    xml2ydoc(xml, doc);
    const out = ydoc2xml(doc);

    expect(out).toContain("mxGeometry");
    expect(out).toContain('x="10"');
    expect(out).toContain('y="20"');
    expect(out).toContain('width="100"');
    expect(out).toContain('height="80"');
    expect(out).toContain('as="geometry"');
  });

  it("带 mxPoint 子元素的 mxGeometry 往返不丢失", () => {
    const xml = `<mxGraphModel><root>
      <mxCell id="0" />
      <mxCell id="1" parent="0" />
      <mxCell id="edge1" edge="1" parent="1" source="a" target="b">
        <mxGeometry relative="1" as="geometry">
          <mxPoint x="190" y="190" as="targetPoint" />
        </mxGeometry>
      </mxCell>
    </root></mxGraphModel>`;

    const doc = new Y.Doc();
    xml2ydoc(xml, doc);
    const out = ydoc2xml(doc);

    expect(out).toContain("mxGeometry");
    expect(out).toContain("mxPoint");
    expect(out).toContain('as="targetPoint"');
    expect(out).toContain('x="190"');
  });
});
