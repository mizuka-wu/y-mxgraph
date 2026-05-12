import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";
import { Binding } from "../src/binding/index";
import { xml2doc } from "../src/transformer/index";
import type { DrawioFile } from "../src/types/drawio";

const BASE_XML = `<mxfile pages="1">
  <diagram name="Page-1" id="p1">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

function createMockFile(doc: Y.Doc): DrawioFile {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const mockGraphModel = {
    addListener: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(fn);
    }),
    removeListener: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      const arr = listeners.get(event);
      if (arr) {
        const idx = arr.indexOf(fn);
        if (idx !== -1) arr.splice(idx, 1);
      }
    }),
    getCell: vi.fn(() => ({ id: "cell1" })),
  };

  const mockContainer = {
    getBoundingClientRect: vi.fn(() => ({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    })),
    scrollLeft: 0,
    scrollTop: 0,
    clientWidth: 800,
    clientHeight: 600,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLElement;

  const mockGraph = {
    model: mockGraphModel,
    container: mockContainer,
    view: { translate: { x: 0, y: 0 }, scale: 1 },
    addMouseListener: vi.fn(),
    removeMouseListener: vi.fn(),
    getSelectionModel: vi.fn(() => ({
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
    highlightCell: vi.fn(() => ({ destroy: vi.fn() })),
  };

  const pages: unknown[] = [];
  const shadowPages: unknown[] = [];

  const file = {
    data: BASE_XML,
    shadowPages,
    ui: {
      editor: { graph: mockGraph, undoManager: undefined },
      currentPage: { getId: () => "p1" },
      diagramContainer: mockContainer,
      pages,
      diffPages: vi.fn(() => ({})),
      clonePages: vi.fn((p: unknown[]) => [...p]),
      setFileData: vi.fn(),
    },
    getUi: vi.fn(function (this: typeof file) {
      return this.ui;
    }),
    setShadowPages: vi.fn(function (this: typeof file, p: unknown[]) {
      this.shadowPages = p;
    }),
    setData: vi.fn(function (this: typeof file, data: string) {
      this.data = data;
    }),
    patch: vi.fn(),
    _listeners: listeners,
    _graphModel: mockGraphModel,
    _graph: mockGraph,
  } as unknown as DrawioFile & {
    _listeners: typeof listeners;
    _graphModel: typeof mockGraphModel;
    _graph: typeof mockGraph;
  };

  return file;
}

describe("Binding", () => {
  let doc: Y.Doc;
  let file: ReturnType<typeof createMockFile>;

  beforeEach(() => {
    doc = new Y.Doc();
    xml2doc(BASE_XML, doc);
    file = createMockFile(doc);
  });

  it("构造函数初始化成功", () => {
    const binding = new Binding(file, { doc });
    expect(binding).toBeInstanceOf(Binding);
    expect(binding.doc).toBe(doc);
    binding.destroy();
  });

  it("绑定 mxGraphModel change 监听器", () => {
    new Binding(file, { doc });
    expect(file._graphModel.addListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
  });

  it("destroy 移除 mxGraphModel 监听器", () => {
    const binding = new Binding(file, { doc });
    binding.destroy();
    expect(file._graphModel.removeListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
  });

  it("本地 change 触发 diffPages 和 applyFilePatch", () => {
    new Binding(file, { doc });
    const changeHandler = file._graphModel.addListener.mock.calls.find(
      ([event]) => event === "change",
    )?.[1] as (...args: unknown[]) => void;

    expect(changeHandler).toBeDefined();
    changeHandler();

    expect(file.ui.diffPages).toHaveBeenCalled();
    expect(file.setShadowPages).toHaveBeenCalled();
  });

  it("远端变更触发 file.patch", () => {
    const binding = new Binding(file, { doc });
    expect(file.patch).not.toHaveBeenCalled();

    doc.transact(() => {
      const mxfile = doc.getMap("mxfile");
      const diagrams = mxfile.get("diagram") as Y.Map<unknown>;
      const p1 = diagrams.get("p1") as Y.Map<unknown>;
      if (p1) {
        p1.set("name", "Modified");
      }
    });

    expect(file.patch).toHaveBeenCalled();
    binding.destroy();
  });

  it("deep destroy 清理 collaborator 和 undoManager", () => {
    const mockUndoManager = new Y.UndoManager(doc.getMap("mxfile"));
    const binding = new Binding(file, {
      doc,
      awareness: {
        clientID: 1,
        getStates: vi.fn(() => new Map()),
        setLocalStateField: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        getLocalState: vi.fn(),
        setLocalState: vi.fn(),
      } as unknown as import("y-protocols/awareness").Awareness,
      undoManager: mockUndoManager,
    });

    expect(() => binding.destroy(true)).not.toThrow();
  });
});
