import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { xml2ydoc, ydoc2xml } from "../src/transform/index";

const DIAGRAM_WITH_CUSTOM_PROPS = `<mxfile pages="1">
  <diagram name="Page-1" id="page1" 
           customAttr="customValue" 
           author="testUser" 
           createdAt="2026-01-01">
    <mxGraphModel>
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

const DIAGRAM_NO_CUSTOM_PROPS = `<mxfile pages="1">
  <diagram name="Page-1" id="page1">
    <mxGraphModel>
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

describe("diagram customProperties 同步", () => {
  it("解析带 customProperties 的 diagram", () => {
    const doc = new Y.Doc();
    xml2ydoc(DIAGRAM_WITH_CUSTOM_PROPS, doc);
    const mxfile = doc.getMap("mxfile");
    const diagrams = mxfile.get("diagram") as Y.Map<any>;
    const page1 = diagrams.get("page1") as Y.Map<any>;
    
    // 检查 customProperties 存在
    const customProperties = page1.get("customProperties") as Y.Map<string>;
    expect(customProperties).toBeDefined();
    expect(customProperties!.size).toBeGreaterThan(0);
    
    // 验证具体属性
    expect(customProperties!.get("customAttr")).toBe("customValue");
    expect(customProperties!.get("author")).toBe("testUser");
    expect(customProperties!.get("createdAt")).toBe("2026-01-01");
  });

  it("解析不带 customProperties 的 diagram 不创建自定义属性 Map", () => {
    const doc = new Y.Doc();
    xml2ydoc(DIAGRAM_NO_CUSTOM_PROPS, doc);
    const mxfile = doc.getMap("mxfile");
    const diagrams = mxfile.get("diagram") as Y.Map<any>;
    const page1 = diagrams.get("page1") as Y.Map<any>;
    
    // 检查 customProperties 不存在
    const customProperties = page1.get("customProperties");
    expect(customProperties).toBeUndefined();
  });

  it("序列化时 customProperties 正确写入 _attributes", () => {
    const doc = new Y.Doc();
    xml2ydoc(DIAGRAM_WITH_CUSTOM_PROPS, doc);
    const out = ydoc2xml(doc);
    
    // 验证 custom properties 在输出的 XML 中
    expect(out).toContain('customAttr="customValue"');
    expect(out).toContain('author="testUser"');
    expect(out).toContain('createdAt="2026-01-01"');
  });

  it("自定义属性动态修改后同步到 XML", () => {
    const doc = new Y.Doc();
    xml2ydoc(DIAGRAM_WITH_CUSTOM_PROPS, doc);
    
    const mxfile = doc.getMap("mxfile");
    const diagrams = mxfile.get("diagram") as Y.Map<any>;
    const page1 = diagrams.get("page1") as Y.Map<any>;
    const customProperties = page1.get("customProperties") as Y.Map<string>;
    
    // 添加新的自定义属性
    customProperties.set("updatedBy", "y-mxgraph");
    
    const out = ydoc2xml(doc);
    expect(out).toContain('updatedBy="y-mxgraph"');
  });

  it("删除 customProperties 后序列化为空", () => {
    const doc = new Y.Doc();
    xml2ydoc(DIAGRAM_WITH_CUSTOM_PROPS, doc);
    
    const mxfile = doc.getMap("mxfile");
    const diagrams = mxfile.get("diagram") as Y.Map<any>;
    const page1 = diagrams.get("page1") as Y.Map<any>;
    
    // 删除 customProperties
    page1.delete("customProperties");
    
    const out = ydoc2xml(doc);
    // 验证 XML 中不包含 custom properties 属性
    expect(out).not.toContain('customAttr=');
    expect(out).not.toContain('author=');
    // 但保留 id 和 name
    expect(out).toContain('name="Page-1"');
    expect(out).toContain('id="page1"');
  });

  it("id 和 name 不写入 customProperties", () => {
    const doc = new Y.Doc();
    xml2ydoc(DIAGRAM_WITH_CUSTOM_PROPS, doc);
    
    const mxfile = doc.getMap("mxfile");
    const diagrams = mxfile.get("diagram") as Y.Map<any>;
    const page1 = diagrams.get("page1") as Y.Map<any>;
    
    const customProperties = page1.get("customProperties") as Y.Map<string>;
    
    // 检查 customProperties 不包含 id 和 name
    expect(customProperties!.get("id")).toBeUndefined();
    expect(customProperties!.get("name")).toBeUndefined();
    
    // 但 page1 本身应有 id 和 name
    expect(page1.get("id")).toBe("page1");
    expect(page1.get("name")).toBe("Page-1");
  });
});
