import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";
import { Binding } from "../src/binding/index";
import { xml2ydoc, ydoc2xml } from "../src/transformer/index";
import type { DrawioFile } from "../src/types/drawio";

const XML_FILE_ONLY = `<mxfile pages="1">
  <diagram name="From-File" id="file-1">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

const XML_DOC = `<mxfile pages="1">
  <diagram name="From-Doc" id="doc-1">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

const XML_BOTH_OVERLAP = `<mxfile pages="2">
  <diagram name="Shared-File-Side" id="shared">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
      </root>
    </mxGraphModel>
  </diagram>
  <diagram name="From-File" id="file-only">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

const XML_DOC_OVERLAP = `<mxfile pages="2">
  <diagram name="Shared-Doc-Side" id="shared">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
      </root>
    </mxGraphModel>
  </diagram>
  <diagram name="From-Doc" id="doc-only">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

function createMockFile(initialData = ""): DrawioFile {
  const mockGraphModel = {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    getCell: vi.fn(),
  };
  const mockGraph = {
    model: mockGraphModel,
    container: {} as HTMLElement,
    view: { translate: { x: 0, y: 0 }, scale: 1 },
    addMouseListener: vi.fn(),
    removeMouseListener: vi.fn(),
    getSelectionModel: vi.fn(() => ({
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
    highlightCell: vi.fn(),
  };
  const ui = {
    editor: { graph: mockGraph, undoManager: undefined },
    currentPage: null,
    diagramContainer: {} as HTMLElement,
    pages: [] as unknown[],
    diffPages: vi.fn(() => ({})),
    clonePages: vi.fn((p: unknown[]) => [...p]),
    setFileData: vi.fn(),
  };
  const file = {
    data: initialData,
    shadowPages: [] as unknown[],
    ui,
    getUi() {
      return ui;
    },
    setShadowPages(p: unknown[]) {
      this.shadowPages = p;
    },
    setData: vi.fn(function (this: { data: string }, x: string) {
      this.data = x;
    }),
    patch: vi.fn(),
  };
  return file as unknown as DrawioFile;
}

function getDiagramIds(doc: Y.Doc): string[] {
  const mxfile = doc.getMap("mxfile");
  const order = mxfile.get("diagramOrder") as Y.Array<string> | undefined;
  return order ? order.toArray() : [];
}

describe("Binding initialContent 策略", () => {
  describe("replace（默认）", () => {
    it("doc 有数据 → 用 doc XML 刷新 file UI，默认不调 setData（避开弹框）", () => {
      const doc = new Y.Doc();
      xml2ydoc(XML_DOC, doc);
      const file = createMockFile(XML_FILE_ONLY);

      new Binding(file, { doc });

      const expected = ydoc2xml(doc);
      expect(file.ui.setFileData).toHaveBeenCalledWith(expected);
      // 默认 applyFileData 不调 setData，避免标记 file 为 modified 触发
      // draw.io 弹出 "Save diagrams to:" 存储选择对话框。
      expect(file.setData).not.toHaveBeenCalled();
      // doc 内容未被 file 改写
      expect(getDiagramIds(doc)).toEqual(["doc-1"]);
    });

    it("doc 与 file 都为空 → 写入模板（默认只 setFileData）", () => {
      const doc = new Y.Doc();
      const file = createMockFile("");

      new Binding(file, { doc });

      const template = Binding.generateFileTemplate("diagram-0");
      expect(file.ui.setFileData).toHaveBeenCalledWith(template);
      expect(file.setData).not.toHaveBeenCalled();
    });

    it("仅 file 有数据 → 保持 file，不写 doc，不调 setFileData", () => {
      const doc = new Y.Doc();
      const file = createMockFile(XML_FILE_ONLY);

      new Binding(file, { doc });

      expect(file.ui.setFileData).not.toHaveBeenCalled();
      expect(file.setData).not.toHaveBeenCalled();
      // doc 仍然为空，等首次本地编辑触发 xml2ydoc
      expect(doc.getMap("mxfile").size).toBe(0);
    });

    it("file.data 存在但不含 <diagram>（如 draw.io 默认空文件）→ 不覆盖（避免触发存储对话框）", () => {
      // 回归：draw.io 默认创建的 file.data 可能是 <mxGraphModel>...</mxGraphModel>
      // 或 <mxfile></mxfile>，没有 <diagram>。旧版本 demo 在这种情况下不会改写
      // file.data，Binding 必须保留该行为，否则 setFileData(template) 会触发
      // draw.io 弹出 "Save diagrams to:" 存储选择对话框。
      const doc = new Y.Doc();
      const file = createMockFile("<mxGraphModel><root/></mxGraphModel>");

      new Binding(file, { doc });

      expect(file.ui.setFileData).not.toHaveBeenCalled();
      expect(file.setData).not.toHaveBeenCalled();
    });
  });

  describe("merge-remote（doc 优先）", () => {
    it("双方都有且 id 冲突 → doc 内容保留，file 独有 id 合并", () => {
      const doc = new Y.Doc();
      xml2ydoc(XML_DOC_OVERLAP, doc);
      const file = createMockFile(XML_BOTH_OVERLAP);

      new Binding(file, { doc, initialContent: "merge-remote" });

      const ids = getDiagramIds(doc);
      expect(ids).toContain("shared");
      expect(ids).toContain("doc-only");
      expect(ids).toContain("file-only");

      // 冲突 id 仍是 doc 的内容（name=Shared-Doc-Side）
      const diagramMap = doc.getMap("mxfile").get("diagram") as Y.Map<
        Y.Map<unknown>
      >;
      const shared = diagramMap.get("shared") as Y.Map<unknown>;
      expect(shared.get("name")).toBe("Shared-Doc-Side");

      // setFileData 被调用 + 内容包含全部三个 diagram
      expect(file.ui.setFileData).toHaveBeenCalled();
      const writtenXml = (file.ui.setFileData as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(writtenXml).toContain('id="shared"');
      expect(writtenXml).toContain('id="doc-only"');
      expect(writtenXml).toContain('id="file-only"');
    });

    it("仅 file 有 → 把 file 写入 doc，file 不动", () => {
      const doc = new Y.Doc();
      const file = createMockFile(XML_FILE_ONLY);

      new Binding(file, { doc, initialContent: "merge-remote" });

      expect(getDiagramIds(doc)).toEqual(["file-1"]);
      // 仅 file 有时不需要再回写 file
      expect(file.ui.setFileData).not.toHaveBeenCalled();
    });
  });

  describe("merge-client（file 优先）", () => {
    it("双方都有且 id 冲突 → file 覆盖 doc 的对应 diagram", () => {
      const doc = new Y.Doc();
      xml2ydoc(XML_DOC_OVERLAP, doc);
      const file = createMockFile(XML_BOTH_OVERLAP);

      new Binding(file, { doc, initialContent: "merge-client" });

      const diagramMap = doc.getMap("mxfile").get("diagram") as Y.Map<
        Y.Map<unknown>
      >;
      const shared = diagramMap.get("shared") as Y.Map<unknown>;
      // 冲突 id 现在被 file 覆盖
      expect(shared.get("name")).toBe("Shared-File-Side");

      const ids = getDiagramIds(doc);
      expect(ids).toContain("doc-only");
      expect(ids).toContain("file-only");
    });
  });

  describe("applyFileData 自定义钩子", () => {
    it("自定义钩子被调用，默认 setFileData 不再被触发", () => {
      const doc = new Y.Doc();
      xml2ydoc(XML_DOC, doc);
      const file = createMockFile(XML_FILE_ONLY);
      const customApply = vi.fn();

      new Binding(file, { doc, applyFileData: customApply });

      expect(customApply).toHaveBeenCalledTimes(1);
      const [passedFile, passedXml] = customApply.mock.calls[0];
      expect(passedFile).toBe(file);
      expect(passedXml).toBe(ydoc2xml(doc));
      // 用户自定义钩子接管后，默认实现不再调用 setFileData
      expect(file.ui.setFileData).not.toHaveBeenCalled();
      expect(file.setData).not.toHaveBeenCalled();
    });
  });

  describe("XML 解析失败回退", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    it("merge-* 模式下 file XML 非法时回退到 replace（用 doc 覆盖）", () => {
      const doc = new Y.Doc();
      xml2ydoc(XML_DOC, doc);
      const file = createMockFile("<not valid mxfile><diagram></diagram>");

      new Binding(file, { doc, initialContent: "merge-remote" });

      // 回退仍然写回 file（用 doc XML）
      expect(file.ui.setFileData).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    });
  });
});
