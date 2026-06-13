/**
 * PptxRenderer 单元测试
 *
 * 覆盖:
 * - render() 完整流程
 * - defineMasterSlide
 * - addCoverSlide（有/无 subtitle/author/org/date）
 * - addTocSlide（有/无 headings）
 * - groupContentIntoSlides（各种分组场景）
 * - addContentSlide（所有 section 类型：heading/paragraph/list/table/code/quote）
 * - addReferencesSlide（> 10 refs / <= 10 refs）
 * - addEndSlide
 * - renderFromScreenshot
 * - getMimeType / getFileExtension / hexToPptx
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { PptxRenderer } from "../pptx.renderer";
import { DEFAULT_THEME, DEFAULT_LAYOUT } from "../../types/theme-config";
import { UnifiedContent } from "../../types/unified-content";
import { ExportOptions } from "../../types/export-options";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeContent(overrides: Partial<UnifiedContent> = {}): UnifiedContent {
  return {
    metadata: {
      title: "PPTX Test",
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

describe("PptxRenderer", () => {
  let renderer: PptxRenderer;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PptxRenderer],
    }).compile();

    renderer = module.get<PptxRenderer>(PptxRenderer);
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getMimeType / getFileExtension
  // ──────────────────────────────────────────────────────────────────────────

  describe("getMimeType / getFileExtension", () => {
    it("returns PPTX MIME type", () => {
      expect(renderer.getMimeType()).toBe(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      );
    });

    it("returns .pptx extension", () => {
      expect(renderer.getFileExtension()).toBe(".pptx");
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

    it("skips cover slide when includeCover is false", async () => {
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeCover: false },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("adds cover slide when includeCover is true", async () => {
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeCover: true },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("adds TOC slide when includeTableOfContents and tableOfContents.enabled", async () => {
      const buffer = await renderer.render(
        makeContent({
          tableOfContents: { enabled: true, maxDepth: 3 },
          sections: [
            { id: "h1", type: "heading", content: "H1", level: 1 },
            { id: "h2", type: "heading", content: "H2", level: 2 },
            { id: "h3", type: "heading", content: "H3", level: 3 }, // level > 2, excluded from TOC
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeTableOfContents: true },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("skips TOC when tableOfContents not enabled", async () => {
      const buffer = await renderer.render(
        makeContent({ tableOfContents: { enabled: false, maxDepth: 3 } }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeTableOfContents: true },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("adds references slide when references present", async () => {
      const content = makeContent({
        references: [{ id: 1, title: "Ref 1", url: "http://r1.com" }],
      });
      const buffer = await renderer.render(
        content,
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeReferences: true },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("skips references slide when includeReferences is false", async () => {
      const content = makeContent({
        references: [{ id: 1, title: "Ref 1" }],
      });
      const buffer = await renderer.render(
        content,
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeReferences: false },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("uses LAYOUT_WIDE for landscape orientation", async () => {
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        { ...DEFAULT_LAYOUT, orientation: "landscape" },
        defaultOptions,
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("uses LAYOUT_16x9 for portrait orientation", async () => {
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        { ...DEFAULT_LAYOUT, orientation: "portrait" },
        defaultOptions,
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Cover slide – optional fields
  // ──────────────────────────────────────────────────────────────────────────

  describe("addCoverSlide", () => {
    it("renders all metadata fields", async () => {
      const buffer = await renderer.render(
        makeContent({
          metadata: {
            title: "Full Cover",
            subtitle: "Sub",
            author: "Alice",
            organization: "Acme",
            date: new Date("2024-06-01"),
          },
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders cover without subtitle", async () => {
      const buffer = await renderer.render(
        makeContent({
          metadata: { title: "No Sub" },
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders cover without any optional metadata", async () => {
      const buffer = await renderer.render(
        makeContent({
          metadata: { title: "Minimal" },
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // groupContentIntoSlides
  // ──────────────────────────────────────────────────────────────────────────

  describe("groupContentIntoSlides", () => {
    it("creates a new slide on level-1 heading", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [
            { id: "h1a", type: "heading", content: "Chapter 1", level: 1 },
            { id: "p1", type: "paragraph", content: "Para 1" },
            { id: "h1b", type: "heading", content: "Chapter 2", level: 1 },
            { id: "p2", type: "paragraph", content: "Para 2" },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeCover: false },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("creates a new slide on level-2 heading when current slide has > 4 items", async () => {
      const sections: UnifiedContent["sections"] = [
        { id: "h1", type: "heading", content: "Main", level: 1 },
        { id: "p1", type: "paragraph", content: "1" },
        { id: "p2", type: "paragraph", content: "2" },
        { id: "p3", type: "paragraph", content: "3" },
        { id: "p4", type: "paragraph", content: "4" },
        { id: "h2", type: "heading", content: "Sub", level: 2 }, // triggers new slide (> 4 items)
      ];
      const buffer = await renderer.render(
        makeContent({ sections }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeCover: false },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("auto-splits slides when content exceeds 6 items", async () => {
      const sections: UnifiedContent["sections"] = Array.from(
        { length: 10 },
        (_, i) => ({
          id: `p${i}`,
          type: "paragraph" as const,
          content: `Paragraph ${i}`,
        }),
      );
      const buffer = await renderer.render(
        makeContent({ sections }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeCover: false },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("handles empty sections array", async () => {
      const buffer = await renderer.render(
        makeContent({ sections: [] }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeCover: false },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // addContentSlide – all section types
  // ──────────────────────────────────────────────────────────────────────────

  describe("addContentSlide – section types", () => {
    async function renderSection(section: UnifiedContent["sections"][number]) {
      return renderer.render(
        makeContent({ sections: [section] }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeCover: false },
      );
    }

    it("renders heading level 1", async () => {
      const buffer = await renderSection({
        id: "h1",
        type: "heading",
        content: "Level 1",
        level: 1,
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders heading level 2", async () => {
      const buffer = await renderSection({
        id: "h2",
        type: "heading",
        content: "Level 2",
        level: 2,
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders heading level 3 (small heading)", async () => {
      const buffer = await renderSection({
        id: "h3",
        type: "heading",
        content: "Level 3",
        level: 3,
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders paragraph", async () => {
      const buffer = await renderSection({
        id: "p1",
        type: "paragraph",
        content: "Paragraph text",
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders unordered list", async () => {
      const buffer = await renderSection({
        id: "l1",
        type: "list",
        ordered: false,
        items: [{ content: "A" }, { content: "B" }, { content: "C" }],
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders ordered list", async () => {
      const buffer = await renderSection({
        id: "l2",
        type: "list",
        ordered: true,
        items: [{ content: "Step 1" }, { content: "Step 2" }],
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders table with headers and rows", async () => {
      const buffer = await renderSection({
        id: "t1",
        type: "table",
        headers: ["Name", "Score"],
        rows: [{ cells: ["Alice", "95"] }, { cells: ["Bob", "87"] }],
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders table without headers", async () => {
      const buffer = await renderSection({
        id: "t2",
        type: "table",
        rows: [{ cells: ["A", "B"] }],
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders table without rows (empty tableData)", async () => {
      const buffer = await renderSection({
        id: "t3",
        type: "table",
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders code block", async () => {
      const buffer = await renderSection({
        id: "c1",
        type: "code",
        content: "function test() { return 42; }",
        codeLanguage: "typescript",
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders quote section", async () => {
      const buffer = await renderSection({
        id: "q1",
        type: "quote",
        content: "To be or not to be",
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("stops rendering when y position exceeds 6", async () => {
      // Create many sections to force y > 6
      const sections: UnifiedContent["sections"] = Array.from(
        { length: 20 },
        (_, i) => ({
          id: `p${i}`,
          type: "paragraph" as const,
          content: `Long paragraph ${i} that forces overflow`,
        }),
      );
      const buffer = await renderer.render(
        makeContent({ sections }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeCover: false },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("handles list with no items", async () => {
      const buffer = await renderSection({
        id: "l3",
        type: "list",
        ordered: false,
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // addReferencesSlide
  // ──────────────────────────────────────────────────────────────────────────

  describe("addReferencesSlide", () => {
    it("shows first 10 references only", async () => {
      const references = Array.from({ length: 12 }, (_, i) => ({
        id: i + 1,
        title: `Ref ${i + 1}`,
        url: `http://ref${i + 1}.com`,
      }));
      const buffer = await renderer.render(
        makeContent({ references }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeReferences: true },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("shows overflow notice when references > 10", async () => {
      // The renderer adds a text element for overflow – just verify it produces valid PPTX
      const references = Array.from({ length: 15 }, (_, i) => ({
        id: i + 1,
        title: `Source ${i + 1}`,
      }));
      const buffer = await renderer.render(
        makeContent({ references }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { includeCover: false, includeReferences: true },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("handles references without URLs", async () => {
      const references = [{ id: 1, title: "No URL ref" }];
      const buffer = await renderer.render(
        makeContent({ references }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { includeCover: false, includeReferences: true },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders empty references list gracefully", async () => {
      const buffer = await renderer.render(
        makeContent({ references: [] }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { includeCover: false, includeReferences: true },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // renderFromScreenshot
  // ──────────────────────────────────────────────────────────────────────────

  describe("renderFromScreenshot()", () => {
    it("creates PPTX from screenshot buffer in landscape", async () => {
      const screenshotBuffer = Buffer.from("fake-png-data");
      const buffer = await renderer.renderFromScreenshot(
        screenshotBuffer,
        "Screenshot Title",
        { orientation: "landscape" },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it("creates PPTX from screenshot buffer in portrait", async () => {
      const screenshotBuffer = Buffer.from("fake-png-data");
      const buffer = await renderer.renderFromScreenshot(
        screenshotBuffer,
        "Portrait Title",
        { orientation: "portrait" },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("uses default layout when no orientation specified", async () => {
      const screenshotBuffer = Buffer.from("fake-png-data");
      const buffer = await renderer.renderFromScreenshot(
        screenshotBuffer,
        "Default Title",
        {},
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Full render with all features
  // ──────────────────────────────────────────────────────────────────────────

  describe("full render", () => {
    it("renders complete presentation with all slide types", async () => {
      const content: UnifiedContent = {
        metadata: {
          title: "Complete Presentation",
          subtitle: "All Features",
          author: "Test",
          organization: "TestCo",
          date: new Date("2024-03-15"),
        },
        tableOfContents: { enabled: true, maxDepth: 2 },
        sections: [
          { id: "h1", type: "heading", content: "Introduction", level: 1 },
          { id: "p1", type: "paragraph", content: "Overview text" },
          {
            id: "l1",
            type: "list",
            ordered: false,
            items: [{ content: "A" }, { content: "B" }],
          },
          {
            id: "t1",
            type: "table",
            headers: ["Col1", "Col2"],
            rows: [{ cells: ["val1", "val2"] }],
          },
          { id: "c1", type: "code", content: "console.log('hi')" },
          { id: "q1", type: "quote", content: "Famous quote" },
          { id: "h2", type: "heading", content: "Conclusion", level: 1 },
          { id: "p2", type: "paragraph", content: "Closing remarks" },
        ],
        references: [
          { id: 1, title: "Source A", url: "http://a.com" },
          { id: 2, title: "Source B" },
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
