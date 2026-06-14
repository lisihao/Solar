/**
 * DocxRenderer unit tests
 *
 * Coverage:
 * - render() happy path (returns Buffer)
 * - render() with/without cover, TOC, references, page numbers
 * - renderFromScreenshot() (WYSIWYG mode, A4/Letter page sizes)
 * - getMimeType / getFileExtension
 * - All section types: heading (levels 1-6), paragraph, list (ordered/unordered), table, code, quote, divider, callout
 * - Default fallback section type
 * - References with/without URL and snippet
 * - generateCover with subtitle, author, organization, date
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { DocxRenderer } from "../docx.renderer";
import { DEFAULT_THEME, DEFAULT_LAYOUT } from "../../types/theme-config";
import { UnifiedContent, ContentSection } from "../../types/unified-content";
import { ExportOptions } from "../../types/export-options";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeContent(overrides: Partial<UnifiedContent> = {}): UnifiedContent {
  return {
    metadata: {
      title: "DOCX Test Report",
      subtitle: "Subtitle",
      author: "Test Author",
      organization: "Test Org",
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
  includePageNumbers: true,
};

// ─── tests ───────────────────────────────────────────────────────────────────

describe("DocxRenderer", () => {
  let renderer: DocxRenderer;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DocxRenderer],
    }).compile();

    renderer = module.get<DocxRenderer>(DocxRenderer);
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getMimeType / getFileExtension
  // ──────────────────────────────────────────────────────────────────────────

  describe("getMimeType / getFileExtension", () => {
    it("returns the correct MIME type for DOCX", () => {
      expect(renderer.getMimeType()).toBe(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
    });

    it("returns .docx extension", () => {
      expect(renderer.getFileExtension()).toBe(".docx");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // render() – basic output
  // ──────────────────────────────────────────────────────────────────────────

  describe("render()", () => {
    it("returns a non-empty Buffer", async () => {
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it("renders without cover when includeCover is false", async () => {
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeCover: false },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders with TOC when includeTableOfContents and tableOfContents.enabled", async () => {
      const buffer = await renderer.render(
        makeContent({
          tableOfContents: { enabled: true, maxDepth: 3 },
          sections: [
            { id: "h1", type: "heading", content: "Chapter 1", level: 1 },
            { id: "h2", type: "heading", content: "Section 1.1", level: 2 },
            {
              id: "h4",
              type: "heading",
              content: "Deep section",
              level: 4,
            },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeTableOfContents: true },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("skips TOC when tableOfContents is not enabled", async () => {
      const buffer = await renderer.render(
        makeContent({
          tableOfContents: { enabled: false, maxDepth: 3 },
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeTableOfContents: true },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders without page numbers when includePageNumbers is false", async () => {
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includePageNumbers: false },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders references with URL and snippet", async () => {
      const buffer = await renderer.render(
        makeContent({
          references: [
            {
              id: 1,
              title: "Ref 1",
              url: "https://example.com",
              snippet:
                "A snippet of text that exceeds the 150-character slice boundary...",
            },
            {
              id: 2,
              title: "Ref 2 No URL",
            },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("skips references when includeReferences is false", async () => {
      const buffer = await renderer.render(
        makeContent({
          references: [{ id: 1, title: "Ref", url: "https://example.com" }],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeReferences: false },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Cover generation – metadata combinations
  // ──────────────────────────────────────────────────────────────────────────

  describe("generateCover metadata", () => {
    it("renders cover with only title (no subtitle, author, org, date)", async () => {
      const buffer = await renderer.render(
        {
          metadata: { title: "Minimal Title" },
          sections: [],
        },
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { includeCover: true },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders cover with all metadata fields", async () => {
      const buffer = await renderer.render(
        makeContent({
          metadata: {
            title: "Full Report",
            subtitle: "A complete subtitle",
            author: "John Doe",
            organization: "Acme Corp",
            date: new Date("2024-06-01"),
          },
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { includeCover: true },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Section rendering
  // ──────────────────────────────────────────────────────────────────────────

  describe("renderSection – all content types", () => {
    async function renderWithSections(
      sections: ContentSection[],
    ): Promise<Buffer> {
      return renderer.render(
        makeContent({ sections }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { includeCover: false, includeReferences: false },
      );
    }

    it("renders heading at level 1", async () => {
      const buf = await renderWithSections([
        { id: "h1", type: "heading", content: "Top Heading", level: 1 },
      ]);
      expect(Buffer.isBuffer(buf)).toBe(true);
    });

    it("renders headings at all levels 1-6", async () => {
      const sections: ContentSection[] = [1, 2, 3, 4, 5, 6].map((l) => ({
        id: `h${l}`,
        type: "heading" as const,
        content: `Heading ${l}`,
        level: l,
      }));
      const buf = await renderWithSections(sections);
      expect(Buffer.isBuffer(buf)).toBe(true);
    });

    it("clamps heading level at 6 when above 6", async () => {
      const buf = await renderWithSections([
        { id: "h9", type: "heading", content: "Deep", level: 9 },
      ]);
      expect(Buffer.isBuffer(buf)).toBe(true);
    });

    it("renders paragraph section", async () => {
      const buf = await renderWithSections([
        {
          id: "p1",
          type: "paragraph",
          content: "This is a paragraph.",
        },
      ]);
      expect(Buffer.isBuffer(buf)).toBe(true);
    });

    it("renders unordered list with nested items", async () => {
      const buf = await renderWithSections([
        {
          id: "l1",
          type: "list",
          ordered: false,
          items: [
            {
              content: "Item A",
              children: [{ content: "Nested A1" }],
            },
            { content: "Item B" },
          ],
        },
      ]);
      expect(Buffer.isBuffer(buf)).toBe(true);
    });

    it("renders ordered list", async () => {
      const buf = await renderWithSections([
        {
          id: "l2",
          type: "list",
          ordered: true,
          items: [{ content: "Step 1" }, { content: "Step 2" }],
        },
      ]);
      expect(Buffer.isBuffer(buf)).toBe(true);
    });

    it("renders list with no items gracefully", async () => {
      const buf = await renderWithSections([
        {
          id: "l3",
          type: "list",
          ordered: false,
        },
      ]);
      expect(Buffer.isBuffer(buf)).toBe(true);
    });

    it("renders table with headers and rows", async () => {
      const buf = await renderWithSections([
        {
          id: "t1",
          type: "table",
          headers: ["Name", "Value"],
          rows: [{ cells: ["Alpha", "1"] }, { cells: ["Beta", "2"] }],
        },
      ]);
      expect(Buffer.isBuffer(buf)).toBe(true);
    });

    it("renders table without headers", async () => {
      const buf = await renderWithSections([
        {
          id: "t2",
          type: "table",
          rows: [{ cells: ["A", "B"] }],
        },
      ]);
      expect(Buffer.isBuffer(buf)).toBe(true);
    });

    it("renders code block", async () => {
      const buf = await renderWithSections([
        {
          id: "c1",
          type: "code",
          content: "const x = 42;",
          codeLanguage: "typescript",
        },
      ]);
      expect(Buffer.isBuffer(buf)).toBe(true);
    });

    it("renders blockquote", async () => {
      const buf = await renderWithSections([
        { id: "q1", type: "quote", content: "To be or not to be." },
      ]);
      expect(Buffer.isBuffer(buf)).toBe(true);
    });

    it("renders divider", async () => {
      const buf = await renderWithSections([{ id: "d1", type: "divider" }]);
      expect(Buffer.isBuffer(buf)).toBe(true);
    });

    it("renders callout with type info", async () => {
      const buf = await renderWithSections([
        {
          id: "ca1",
          type: "callout",
          content: "An info callout",
          calloutType: "info",
        },
      ]);
      expect(Buffer.isBuffer(buf)).toBe(true);
    });

    it("renders callout with type warning", async () => {
      const buf = await renderWithSections([
        {
          id: "ca2",
          type: "callout",
          content: "A warning callout",
          calloutType: "warning",
        },
      ]);
      expect(Buffer.isBuffer(buf)).toBe(true);
    });

    it("renders callout with default (info) when calloutType is absent", async () => {
      const buf = await renderWithSections([
        {
          id: "ca3",
          type: "callout",
          content: "Default callout",
        },
      ]);
      expect(Buffer.isBuffer(buf)).toBe(true);
    });

    it("renders unknown section type via default fallback", async () => {
      const buf = await renderWithSections([
        {
          id: "x1",
          type: "image" as const,
          content: "Fallback text",
        },
      ]);
      expect(Buffer.isBuffer(buf)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // renderFromScreenshot (WYSIWYG mode)
  // ──────────────────────────────────────────────────────────────────────────

  describe("renderFromScreenshot()", () => {
    it("returns a Buffer from a screenshot buffer (A4)", async () => {
      const screenshotBuf = Buffer.from("fake-png-data");
      const buffer = await renderer.renderFromScreenshot(
        screenshotBuf,
        "My Report",
        { pageSize: "A4" },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it("returns a Buffer from a screenshot buffer (Letter)", async () => {
      const screenshotBuf = Buffer.from("fake-png-data");
      const buffer = await renderer.renderFromScreenshot(
        screenshotBuf,
        "Letter Report",
        { pageSize: "Letter" },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("uses A4 dimensions when no pageSize provided", async () => {
      const screenshotBuf = Buffer.from("fake-png-data");
      const buffer = await renderer.renderFromScreenshot(
        screenshotBuf,
        "Default",
        {},
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // format property
  // ──────────────────────────────────────────────────────────────────────────

  describe("format property", () => {
    it("exposes ExportFormat.DOCX as format", () => {
      expect(renderer.format).toBe("DOCX");
    });
  });
});
