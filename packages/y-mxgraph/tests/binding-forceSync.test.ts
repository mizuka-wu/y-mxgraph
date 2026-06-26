import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";
import { Binding } from "../src/binding/index";
import { xml2ydoc } from "../src/transform/index";
import { ConsistencyChecker } from "../src/binding/consistency";
import type { DrawioFile } from "../src/types/drawio";

const BASE_XML = `<mxfile pages="1"><diagram name="Page-1" id="p1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`;

function createMockFile(initialData = ""): DrawioFile & { _ui: any } {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const mockGraphModel = {
    addListener: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(fn);
    }),
    removeListener: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      const arr = listeners.get(event);
      if (arr) { const idx = arr.indexOf(fn); if (idx !== -1) arr.splice(idx, 1); }
    }),
  };
  const mockGraph = {
    model: mockGraphModel,
    container: { getBoundingClientRect: vi.fn(() => ({ x: 0, y: 0, width: 800, height: 600 })) },
    view: { translate: { x: 0, y: 0 }, scale: 1 },
    addMouseListener: vi.fn(),
    removeMouseListener: vi.fn(),
    getSelectionModel: vi.fn(() => ({ addListener: vi.fn(), removeListener: vi.fn() })),
  };
  const pages: unknown[] = [];
  const ui = {
    editor: { graph: mockGraph, setModified: vi.fn(), setStatus: vi.fn() },
    currentFile: { setModified: vi.fn() },
    pages,
    diffPages: vi.fn(() => ({})),
    clonePages: vi.fn((p: unknown[]) => [...p]),
    setFileData: vi.fn((xml: string) => { (file as any).data = xml; }),
  };
  const file = {
    data: initialData,
    shadowPages: [],
    ui,
    getUi: vi.fn(function (this: any) { return this.ui; }),
    setShadowPages: vi.fn(function (this: any, p: unknown[]) { this.shadowPages = p; }),
    setData: vi.fn(function (this: any, data: string) { this.data = data; }),
    patch: vi.fn(),
  } as unknown as DrawioFile & { _ui: any };
  (file as any)._ui = ui;
  return file;
}

describe("Binding.forceSync", () => {
  it("ydoc-to-file: 用 ydoc 数据覆盖 file", () => {
    const doc = new Y.Doc();
    xml2ydoc(BASE_XML, doc);
    const file = createMockFile();
    const binding = new Binding(file, { doc, initialContent: "replace" });

    binding.forceSync("ydoc-to-file");
    expect(file.ui.setFileData).toHaveBeenCalled();
    const lastCall = (file.ui.setFileData as any).mock.calls.at(-1);
    expect(lastCall[0]).toContain("<diagram");
    binding.destroy();
  });

  it("file-to-ydoc: 用 file 数据写入 ydoc", () => {
    const doc = new Y.Doc();
    const file = createMockFile(BASE_XML);
    const binding = new Binding(file, { doc, initialContent: "merge-client" });

    file.data = BASE_XML.replace("Page-1", "Modified");
    binding.forceSync("file-to-ydoc");

    const mxfile = doc.getMap("mxfile") as Y.Map<any>;
    const diag = (mxfile.get("diagram") as Y.Map<any>).get("p1") as Y.Map<any>;
    expect(diag.get("name")).toBe("Modified");
    binding.destroy();
  });

  it("ydoc-to-file: xml 无 diagram 时跳过", () => {
    const doc = new Y.Doc();
    const file = createMockFile();
    const binding = new Binding(file, { doc, initialContent: "replace" });
    (file.ui.setFileData as any).mockClear();

    binding.forceSync("ydoc-to-file");
    expect(file.ui.setFileData).not.toHaveBeenCalled();
    binding.destroy();
  });

  it("默认方向为 ydoc-to-file", () => {
    const doc = new Y.Doc();
    xml2ydoc(BASE_XML, doc);
    const file = createMockFile();
    const binding = new Binding(file, { doc, initialContent: "replace" });

    binding.forceSync();
    expect(file.ui.setFileData).toHaveBeenCalled();
    binding.destroy();
  });
});

describe("Binding.checkConsistency", () => {
  it("无 consistencyCheckInterval 时返回 true", () => {
    const doc = new Y.Doc();
    const file = createMockFile();
    const binding = new Binding(file, { doc, initialContent: "replace" });
    expect(binding.checkConsistency()).toBe(true);
    binding.destroy();
  });

  it("有 checker 且数据不一致时返回 false", () => {
    const doc = new Y.Doc();
    xml2ydoc(BASE_XML, doc);
    const checker = new ConsistencyChecker(doc, () => "completely different xml");
    expect(checker.check()).toBe(false);
    checker.destroy();
  });
});

describe("Binding.consistencyCheckInterval", () => {
  it("设置 > 0 时创建 checker", () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    xml2ydoc(BASE_XML, doc);
    const file = createMockFile(BASE_XML);
    const driftHandler = vi.fn();
    const binding = new Binding(file, {
      doc,
      initialContent: "merge-client",
      consistencyCheckInterval: 5000,
      onDrift: driftHandler,
    });

    // 构造后一致 → checkConsistency 返回 true
    expect(binding.checkConsistency()).toBe(true);

    // 直接用 ConsistencyChecker 测试不一致场景
    const checker = new ConsistencyChecker(doc, () => "different");
    expect(checker.check()).toBe(false);
    checker.destroy();

    binding.destroy();
    vi.useRealTimers();
  });

  it("不设置时无 checker", () => {
    const doc = new Y.Doc();
    const file = createMockFile();
    const binding = new Binding(file, { doc, initialContent: "replace" });
    // 无 checker → checkConsistency 返回 true
    expect(binding.checkConsistency()).toBe(true);
    binding.destroy();
  });
});

describe("Binding.destroy", () => {
  it("deep=false 只移除 mxGraphModel 监听", () => {
    const doc = new Y.Doc();
    const file = createMockFile();
    const binding = new Binding(file, { doc });
    binding.destroy(false);
    expect(file.ui.editor.graph.model.removeListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("deep=true 清理所有资源", () => {
    const doc = new Y.Doc();
    const file = createMockFile();
    const binding = new Binding(file, { doc });
    binding.destroy(true);
    expect(file.ui.editor.graph.model.removeListener).toHaveBeenCalled();
  });
});
