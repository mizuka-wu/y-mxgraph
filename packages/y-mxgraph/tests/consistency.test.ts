import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";
import { checkConsistency, ConsistencyChecker } from "../src/binding/consistency";
import { xml2ydoc } from "../src/transform";

const BASE_XML = `<mxfile pages="1"><diagram name="Page-1" id="p1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`;

describe("checkConsistency", () => {
  it("一致时返回 true", () => {
    const doc = new Y.Doc();
    xml2ydoc(BASE_XML, doc);
    expect(checkConsistency(doc, BASE_XML)).toBe(true);
  });

  it("不一致时返回 false", () => {
    const doc = new Y.Doc();
    xml2ydoc(BASE_XML, doc);
    // fileData 多一个 diagram
    const extraXml = BASE_XML.replace("</mxfile>", '<diagram name="Page-2" id="p2"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>');
    expect(checkConsistency(doc, extraXml)).toBe(false);
  });

  it("cell 数量不一致时返回 false", () => {
    const doc = new Y.Doc();
    xml2ydoc(BASE_XML, doc);
    const moreCells = BASE_XML.replace("</root>", '<mxCell id="extra" parent="1" vertex="1"/></root>');
    expect(checkConsistency(doc, moreCells)).toBe(false);
  });
});

describe("ConsistencyChecker", () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    xml2ydoc(BASE_XML, doc);
  });

  it("check() 一致时返回 true 并重置 drift 计数", () => {
    const checker = new ConsistencyChecker(doc, () => BASE_XML);
    expect(checker.check()).toBe(true);
    expect(checker.shouldStopAutoFix).toBe(false);
    checker.destroy();
  });

  it("check() 不一致时返回 false 并触发 drift handler", () => {
    const driftHandler = vi.fn();
    const checker = new ConsistencyChecker(doc, () => "wrong xml", { source: "binding" });
    checker.onDrift(driftHandler);

    checker.check();
    expect(driftHandler).toHaveBeenCalledTimes(1);
    expect(driftHandler.mock.calls[0][0].source).toBe("binding");
    expect(checker.check()).toBe(false);
    checker.destroy();
  });

  it("连续 drift 超过 maxAutoFixAttempts 后 shouldStopAutoFix 为 true", () => {
    const checker = new ConsistencyChecker(doc, () => "wrong", { maxAutoFixAttempts: 2 });
    checker.check(); // drift #1
    checker.check(); // drift #2
    expect(checker.shouldStopAutoFix).toBe(true);
    checker.destroy();
  });

  it("resetDriftCount 重置计数", () => {
    const checker = new ConsistencyChecker(doc, () => "wrong", { maxAutoFixAttempts: 1 });
    checker.check(); // drift #1
    expect(checker.shouldStopAutoFix).toBe(true);
    checker.resetDriftCount();
    expect(checker.shouldStopAutoFix).toBe(false);
    checker.destroy();
  });

  it("start/stop 管理定时器", () => {
    vi.useFakeTimers();
    const driftHandler = vi.fn();
    const checker = new ConsistencyChecker(doc, () => "wrong");
    checker.onDrift(driftHandler);

    checker.start(1000);
    vi.advanceTimersByTime(3000);
    expect(driftHandler).toHaveBeenCalledTimes(3);

    checker.stop();
    vi.advanceTimersByTime(3000);
    expect(driftHandler).toHaveBeenCalledTimes(3); // 不再增长

    checker.destroy();
    vi.useRealTimers();
  });
});
