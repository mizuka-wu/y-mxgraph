import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as Y from "yjs";
import { xml2ydoc, ydoc2xml } from "../src/transform/index";

const DEMO_XML_PATH = path.resolve(import.meta.dirname, "../../../demo.xml");

describe("demo.xml 往返", () => {
  const xml = fs.readFileSync(DEMO_XML_PATH, "utf-8");

  it("mxGeometry 不丢失", () => {
    const doc = new Y.Doc();
    xml2ydoc(xml, doc);
    const out = ydoc2xml(doc);

    const originalGeometryCount = (xml.match(/<mxGeometry/g) || []).length;
    const outputGeometryCount = (out.match(/<mxGeometry/g) || []).length;

    expect(outputGeometryCount).toBe(originalGeometryCount);
  });

  it("mxPoint 子元素不丢失", () => {
    const doc = new Y.Doc();
    xml2ydoc(xml, doc);
    const out = ydoc2xml(doc);

    const originalPointCount = (xml.match(/<mxPoint/g) || []).length;
    const outputPointCount = (out.match(/<mxPoint/g) || []).length;

    expect(outputPointCount).toBe(originalPointCount);
  });

  it("mxCell 数量一致", () => {
    const doc = new Y.Doc();
    xml2ydoc(xml, doc);
    const out = ydoc2xml(doc);

    const originalCellCount = (xml.match(/<mxCell/g) || []).length;
    const outputCellCount = (out.match(/<mxCell/g) || []).length;

    expect(outputCellCount).toBe(originalCellCount);
  });
});
