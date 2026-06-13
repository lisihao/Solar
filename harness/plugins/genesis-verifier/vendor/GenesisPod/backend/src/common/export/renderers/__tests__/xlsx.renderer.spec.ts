/**
 * XlsxRenderer 单元测试
 *
 * 覆盖:
 * - render() 完整流程（Buffer 输出）
 * - addCoverSheet（有/无 subtitle/author/org/date）
 * - addTocSheet（有/无 headings）
 * - addContentSheet（所有 section 类型）
 * - addTablesSheet（有/无表格数据）
 * - addReferencesSheet（有/无 URL，hyperlink）
 * - renderSection 各 case（heading/paragraph/list/table/code/quote/divider/callout/default）
 * - hexToArgb
 * - getMimeType / getFileExtension
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { XlsxRenderer } from "../xlsx.renderer";
import { DEFAULT_THEME, DEFAULT_LAYOUT } from "../../types/theme-config";
import { UnifiedContent } from "../../types/unified-content";
import { ExportOptions } from "../../types/export-options";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeContent(overrides: Partial<UnifiedContent> = {}): UnifiedContent {
  return {
    metadata: {
      title: "Test Report",
      subtitle: "Subtitle",
      author: "Author",
      organization: "Org",
      date: new Date("2024-01-15"),
    },
    sections: [],
    ...overrides,
  };
}

const defaultOptions: ExportOptions = {
  includeCover: true,
  includeTableOfContents: false,
  includeReferences: true,
};

// ─── tests ───────────────────────────────────────────────────────────────────

describe("XlsxRenderer", () => {
  let renderer: XlsxRenderer;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [XlsxRenderer],
    }).compile();

    renderer = module.get<XlsxRenderer>(XlsxRenderer);
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getMimeType / getFileExtension
  // ──────────────────────────────────────────────────────────────────────────

  describe("getMimeType / getFileExtension", () => {
    it("returns correct MIME type", () => {
      expect(renderer.getMimeType()).toBe(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
    });

    it("returns .xlsx extension", () => {
      expect(renderer.getFileExtension()).toBe(".xlsx");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // render() – basic output
  // ──────────────────────────────────────────────────────────────────────────

  describe("render()", () => {
    it("returns a Buffer for minimal content", async () => {
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it("skips cover sheet when includeCover is false", async () => {
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeCover: false },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("skips references sheet when includeReferences is false", async () => {
      const content = makeContent({
        references: [{ id: 1, title: "Ref 1", url: "http://example.com" }],
      });
      const buffer = await renderer.render(
        content,
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeReferences: false },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("adds references sheet when references exist and includeReferences is true", async () => {
      const content = makeContent({
        references: [
          {
            id: 1,
            title: "Ref 1",
            url: "http://example.com",
            snippet: "Snippet text",
          },
          { id: 2, title: "Ref 2" },
        ],
      });
      const buffer = await renderer.render(
        content,
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("adds TOC sheet when includeTableOfContents and tableOfContents.enabled", async () => {
      const content = makeContent({
        tableOfContents: { enabled: true, maxDepth: 3 },
        sections: [
          { id: "h1", type: "heading", content: "Chapter 1", level: 1 },
          { id: "h2", type: "heading", content: "Section 1.1", level: 2 },
          { id: "h3", type: "heading", content: "Deep", level: 4 }, // level > 3, should be excluded
        ],
      });
      const buffer = await renderer.render(
        content,
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeTableOfContents: true },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Cover sheet – optional fields
  // ──────────────────────────────────────────────────────────────────────────

  describe("cover sheet", () => {
    it("renders cover with all metadata fields", async () => {
      const content = makeContent({
        metadata: {
          title: "Full Cover",
          subtitle: "Sub",
          author: "Alice",
          organization: "Acme",
          date: new Date("2024-06-01"),
        },
      });
      const buffer = await renderer.render(
        content,
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders cover without optional fields", async () => {
      const content = makeContent({
        metadata: { title: "Minimal Cover" },
      });
      const buffer = await renderer.render(
        content,
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Content sheet – all section types
  // ──────────────────────────────────────────────────────────────────────────

  describe("content section types", () => {
    async function renderWithSection(
      section: UnifiedContent["sections"][number],
    ) {
      return renderer.render(
        makeContent({ sections: [section] }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeCover: false },
      );
    }

    it("renders heading level 1", async () => {
      const buffer = await renderWithSection({
        id: "h1",
        type: "heading",
        content: "Main Title",
        level: 1,
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders heading level 3", async () => {
      const buffer = await renderWithSection({
        id: "h3",
        type: "heading",
        content: "Sub Heading",
        level: 3,
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders heading without level (defaults to 1)", async () => {
      const buffer = await renderWithSection({
        id: "hx",
        type: "heading",
        content: "No Level",
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders paragraph", async () => {
      const buffer = await renderWithSection({
        id: "p1",
        type: "paragraph",
        content: "A paragraph of text.",
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders unordered list", async () => {
      const buffer = await renderWithSection({
        id: "l1",
        type: "list",
        ordered: false,
        items: [
          { content: "Item A" },
          { content: "Item B", children: [{ content: "Sub item" }] },
        ],
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders ordered list", async () => {
      const buffer = await renderWithSection({
        id: "l2",
        type: "list",
        ordered: true,
        items: [{ content: "Step 1" }, { content: "Step 2" }],
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders list section with no items", async () => {
      const buffer = await renderWithSection({
        id: "l3",
        type: "list",
        ordered: false,
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders table with headers and rows", async () => {
      const buffer = await renderWithSection({
        id: "t1",
        type: "table",
        headers: ["Name", "Value"],
        rows: [{ cells: ["A", "1"] }, { cells: ["B", "2"] }],
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders table without headers", async () => {
      const buffer = await renderWithSection({
        id: "t2",
        type: "table",
        rows: [{ cells: ["Row 1"] }],
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders table without rows", async () => {
      const buffer = await renderWithSection({
        id: "t3",
        type: "table",
        headers: ["Col"],
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders code block", async () => {
      const buffer = await renderWithSection({
        id: "c1",
        type: "code",
        content: "const x = 1;",
        codeLanguage: "typescript",
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders blockquote", async () => {
      const buffer = await renderWithSection({
        id: "q1",
        type: "quote",
        content: "A famous quote",
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders divider", async () => {
      const buffer = await renderWithSection({
        id: "d1",
        type: "divider",
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders callout – info type", async () => {
      const buffer = await renderWithSection({
        id: "ca1",
        type: "callout",
        content: "Info message",
        calloutType: "info",
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders callout – warning type", async () => {
      const buffer = await renderWithSection({
        id: "ca2",
        type: "callout",
        content: "Warning!",
        calloutType: "warning",
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders callout – success type", async () => {
      const buffer = await renderWithSection({
        id: "ca3",
        type: "callout",
        content: "Success!",
        calloutType: "success",
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders callout – error type", async () => {
      const buffer = await renderWithSection({
        id: "ca4",
        type: "callout",
        content: "Error!",
        calloutType: "error",
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders callout without calloutType (defaults to info)", async () => {
      const buffer = await renderWithSection({
        id: "ca5",
        type: "callout",
        content: "Default callout",
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders unknown section type with content fallback", async () => {
      const buffer = await renderWithSection({
        id: "x1",
        type: "chart" as never,
        content: "Chart placeholder",
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders unknown section type without content (no crash)", async () => {
      const buffer = await renderWithSection({
        id: "x2",
        type: "image",
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Tables sheet
  // ──────────────────────────────────────────────────────────────────────────

  describe("addTablesSheet", () => {
    it("skips tables sheet when no table sections", async () => {
      const content = makeContent({
        sections: [{ id: "p1", type: "paragraph", content: "No tables" }],
      });
      const buffer = await renderer.render(
        content,
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("adds tables sheet when table sections present", async () => {
      const content = makeContent({
        sections: [
          {
            id: "t1",
            type: "table",
            headers: ["A", "B"],
            rows: [{ cells: ["1", "2"] }],
          },
          {
            id: "t2",
            type: "table",
            headers: ["X", "Y", "Z"],
            rows: [{ cells: ["a", "b", "c"] }],
          },
        ],
      });
      const buffer = await renderer.render(
        content,
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("handles table with no headers or rows in tables sheet", async () => {
      const content = makeContent({
        sections: [{ id: "t1", type: "table" }],
      });
      const buffer = await renderer.render(
        content,
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // References sheet
  // ──────────────────────────────────────────────────────────────────────────

  describe("addReferencesSheet", () => {
    it("renders references with URL hyperlinks", async () => {
      const content = makeContent({
        references: [
          {
            id: 1,
            title: "Paper A",
            url: "https://paper-a.com",
            snippet:
              "A snippet about this paper that is quite long enough to test",
          },
          { id: 2, title: "Paper B" },
        ],
      });
      const buffer = await renderer.render(
        content,
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders reference with empty snippet", async () => {
      const content = makeContent({
        references: [{ id: 1, title: "Ref", url: "http://ref.com" }],
      });
      const buffer = await renderer.render(
        content,
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Full render with all features enabled
  // ──────────────────────────────────────────────────────────────────────────

  describe("full render", () => {
    it("renders complete workbook with all worksheets", async () => {
      const content: UnifiedContent = {
        metadata: {
          title: "Complete Report",
          subtitle: "Comprehensive Test",
          author: "Test Author",
          organization: "Test Org",
          date: new Date("2024-03-15"),
        },
        tableOfContents: { enabled: true, maxDepth: 3 },
        sections: [
          { id: "h1", type: "heading", content: "Chapter 1", level: 1 },
          { id: "p1", type: "paragraph", content: "Intro text" },
          { id: "l1", type: "list", ordered: false, items: [{ content: "A" }] },
          {
            id: "t1",
            type: "table",
            headers: ["Col"],
            rows: [{ cells: ["val"] }],
          },
          { id: "c1", type: "code", content: "code here" },
          { id: "q1", type: "quote", content: "quote here" },
          { id: "div1", type: "divider" },
          { id: "ca1", type: "callout", content: "note", calloutType: "info" },
        ],
        references: [
          {
            id: 1,
            title: "Source 1",
            url: "http://s1.com",
            snippet: "Snippet",
          },
        ],
      };

      const buffer = await renderer.render(
        content,
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        {
          includeCover: true,
          includeTableOfContents: true,
          includeReferences: true,
        },
      );

      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
    });
  });
});
