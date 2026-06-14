/**
 * PdfRenderer 单元测试
 *
 * 覆盖:
 * - render() Puppeteer 路径 / fallback to PDFKit
 * - renderWithPDFKit – 封面 / 正文 / 各 section 类型
 * - generateHtml / generateCss / generateCover / generateToc / generateBody
 * - generateReferences / generateWatermark / formatContent / escapeHtml
 * - renderSection (all content types)
 * - renderTable / renderPDFKitSection
 * - mapPageSize
 * - getMimeType / getFileExtension
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { PdfRenderer } from "../pdf.renderer";
import { WysiwygRenderService } from "../../services/wysiwyg-render.service";
import { DEFAULT_THEME, DEFAULT_LAYOUT } from "../../types/theme-config";
import { UnifiedContent } from "../../types/unified-content";
import { ExportOptions } from "../../types/export-options";

// ─── mocks ───────────────────────────────────────────────────────────────────

const mockPage = {
  setContent: jest.fn().mockResolvedValue(undefined),
  pdf: jest.fn().mockResolvedValue(Buffer.from("puppeteer-pdf")),
  close: jest.fn().mockResolvedValue(undefined),
};

const mockBrowser = {
  newPage: jest.fn().mockResolvedValue(mockPage),
};

const mockWysiwygRenderService = {
  getBrowser: jest.fn().mockResolvedValue(mockBrowser),
  renderByFormat: jest.fn(),
  renderToScreenshots: jest.fn(),
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeContent(overrides: Partial<UnifiedContent> = {}): UnifiedContent {
  return {
    metadata: {
      title: "PDF Test",
      subtitle: "Subtitle",
      author: "Author",
      organization: "Org",
      date: new Date("2024-01-15"),
      language: "zh-CN",
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

describe("PdfRenderer", () => {
  let renderer: PdfRenderer;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Reset Puppeteer mocks to success state for each test
    mockWysiwygRenderService.getBrowser.mockResolvedValue(mockBrowser);
    mockBrowser.newPage.mockResolvedValue(mockPage);
    mockPage.setContent.mockResolvedValue(undefined);
    mockPage.pdf.mockResolvedValue(Buffer.from("puppeteer-pdf"));
    mockPage.close.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PdfRenderer,
        { provide: WysiwygRenderService, useValue: mockWysiwygRenderService },
      ],
    }).compile();

    renderer = module.get<PdfRenderer>(PdfRenderer);
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getMimeType / getFileExtension
  // ──────────────────────────────────────────────────────────────────────────

  describe("getMimeType / getFileExtension", () => {
    it("returns application/pdf MIME type", () => {
      expect(renderer.getMimeType()).toBe("application/pdf");
    });

    it("returns .pdf extension", () => {
      expect(renderer.getFileExtension()).toBe(".pdf");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // render() – Puppeteer path
  // ──────────────────────────────────────────────────────────────────────────

  describe("render() – Puppeteer", () => {
    it("returns Buffer from Puppeteer on success", async () => {
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(mockBrowser.newPage).toHaveBeenCalled();
      expect(mockPage.pdf).toHaveBeenCalled();
    });

    it("closes page in finally block on success", async () => {
      await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(mockPage.close).toHaveBeenCalled();
    });

    it("closes page in finally block when pdf() throws", async () => {
      mockPage.pdf.mockRejectedValueOnce(new Error("PDF fail"));
      // Should fall back to PDFKit
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(mockPage.close).toHaveBeenCalled();
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("falls back to PDFKit when Puppeteer throws", async () => {
      mockWysiwygRenderService.getBrowser.mockRejectedValueOnce(
        new Error("Browser launch failed"),
      );
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("enables header/footer when includePageNumbers is true", async () => {
      await renderer.render(makeContent(), DEFAULT_THEME, DEFAULT_LAYOUT, {
        ...defaultOptions,
        includePageNumbers: true,
      });
      const pdfCallArgs = mockPage.pdf.mock.calls[0][0];
      expect(pdfCallArgs.displayHeaderFooter).toBe(true);
    });

    it("skips header/footer when includePageNumbers is false", async () => {
      await renderer.render(makeContent(), DEFAULT_THEME, DEFAULT_LAYOUT, {
        ...defaultOptions,
        includePageNumbers: false,
      });
      const pdfCallArgs = mockPage.pdf.mock.calls[0][0];
      expect(pdfCallArgs.displayHeaderFooter).toBeUndefined();
    });

    it("uses landscape orientation in PDF options", async () => {
      await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        {
          ...DEFAULT_LAYOUT,
          orientation: "landscape",
        },
        defaultOptions,
      );
      const pdfCallArgs = mockPage.pdf.mock.calls[0][0];
      expect(pdfCallArgs.landscape).toBe(true);
    });

    it("handles page.close() failure silently", async () => {
      mockPage.close.mockRejectedValueOnce(new Error("Close failed"));
      await expect(
        renderer.render(
          makeContent(),
          DEFAULT_THEME,
          DEFAULT_LAYOUT,
          defaultOptions,
        ),
      ).resolves.toBeDefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // render() – PDFKit fallback
  // ──────────────────────────────────────────────────────────────────────────

  describe("render() – PDFKit fallback", () => {
    beforeEach(() => {
      mockWysiwygRenderService.getBrowser.mockRejectedValue(
        new Error("No Chromium"),
      );
    });

    it("returns a Buffer from PDFKit", async () => {
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it("renders cover page (includeCover: true)", async () => {
      const buffer = await renderer.render(
        makeContent({
          metadata: {
            title: "Cover Test",
            subtitle: "Sub",
            date: new Date(),
          },
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { includeCover: true },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("skips cover page (includeCover: false)", async () => {
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { includeCover: false },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders all PDFKit section types", async () => {
      const content = makeContent({
        sections: [
          { id: "h1", type: "heading", content: "Title", level: 1 },
          { id: "h2", type: "heading", content: "Section", level: 2 },
          { id: "h3", type: "heading", content: "Sub", level: 3 },
          { id: "p1", type: "paragraph", content: "Paragraph" },
          {
            id: "l1",
            type: "list",
            ordered: false,
            items: [{ content: "A" }, { content: "B" }],
          },
          { id: "l2", type: "list", ordered: true, items: [{ content: "1" }] },
          { id: "c1", type: "code", content: "code block" },
          { id: "q1", type: "quote", content: "A quote" },
          { id: "d1", type: "divider" },
          { id: "x1", type: "callout", content: "Callout text" },
        ],
      });
      const buffer = await renderer.render(
        content,
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { includeCover: false },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders landscape orientation with PDFKit", async () => {
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        { ...DEFAULT_LAYOUT, orientation: "landscape" },
        { includeCover: false },
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("renders different page sizes", async () => {
      for (const pageSize of ["A4", "A3", "Letter", "Legal"] as const) {
        const buffer = await renderer.render(
          makeContent(),
          DEFAULT_THEME,
          { ...DEFAULT_LAYOUT, pageSize },
          { includeCover: false },
        );
        expect(Buffer.isBuffer(buffer)).toBe(true);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // generateHtml (tested via Puppeteer render)
  // ──────────────────────────────────────────────────────────────────────────

  describe("generateHtml features", () => {
    it("includes cover HTML when includeCover is true", async () => {
      await renderer.render(makeContent(), DEFAULT_THEME, DEFAULT_LAYOUT, {
        ...defaultOptions,
        includeCover: true,
      });
      const htmlArg = mockPage.setContent.mock.calls[0][0] as string;
      expect(htmlArg).toContain("cover");
    });

    it("includes TOC when includeTableOfContents and tableOfContents.enabled", async () => {
      await renderer.render(
        makeContent({
          tableOfContents: { enabled: true, maxDepth: 3 },
          sections: [
            { id: "h1", type: "heading", content: "H1", level: 1 },
            { id: "h2", type: "heading", content: "H2", level: 2 },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeTableOfContents: true },
      );
      const htmlArg = mockPage.setContent.mock.calls[0][0] as string;
      expect(htmlArg).toContain("toc");
    });

    it("includes references when present and includeReferences true", async () => {
      await renderer.render(
        makeContent({
          references: [
            { id: 1, title: "Ref", url: "http://r.com", snippet: "snip" },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeReferences: true },
      );
      const htmlArg = mockPage.setContent.mock.calls[0][0] as string;
      expect(htmlArg).toContain("references");
    });

    it("includes watermark when watermark option set", async () => {
      await renderer.render(makeContent(), DEFAULT_THEME, DEFAULT_LAYOUT, {
        ...defaultOptions,
        watermark: "DRAFT",
        watermarkOpacity: 0.1,
      });
      const htmlArg = mockPage.setContent.mock.calls[0][0] as string;
      expect(htmlArg).toContain("watermark");
      expect(htmlArg).toContain("DRAFT");
    });

    it("uses default opacity when watermarkOpacity not provided", async () => {
      await renderer.render(makeContent(), DEFAULT_THEME, DEFAULT_LAYOUT, {
        ...defaultOptions,
        watermark: "CONFIDENTIAL",
      });
      const htmlArg = mockPage.setContent.mock.calls[0][0] as string;
      expect(htmlArg).toContain("0.05");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // renderSection (all HTML section types)
  // ──────────────────────────────────────────────────────────────────────────

  describe("renderSection HTML output", () => {
    async function getHtml(section: UnifiedContent["sections"][number]) {
      await renderer.render(
        makeContent({ sections: [section] }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { includeCover: false, includeReferences: false },
      );
      return mockPage.setContent.mock.calls[0][0] as string;
    }

    it("renders heading as h1-h6", async () => {
      const html = await getHtml({
        id: "h1",
        type: "heading",
        content: "Title",
        level: 2,
      });
      expect(html).toContain('<h2 id="title">');
    });

    it("caps heading level at 6", async () => {
      const html = await getHtml({
        id: "h9",
        type: "heading",
        content: "Deep",
        level: 9,
      });
      expect(html).toContain('<h6 id="deep">');
    });

    it("renders paragraph", async () => {
      const html = await getHtml({
        id: "p1",
        type: "paragraph",
        content: "Para text",
      });
      expect(html).toContain("<p>");
      expect(html).toContain("Para text");
    });

    it("escapes HTML special chars in paragraph", async () => {
      const html = await getHtml({
        id: "p2",
        type: "paragraph",
        content: "<script>alert('xss')</script>",
      });
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });

    it("formats citation markers in paragraph", async () => {
      const html = await getHtml({
        id: "p3",
        type: "paragraph",
        content: "See [1] and [2]",
      });
      expect(html).toContain("citation");
    });

    it("renders unordered list", async () => {
      const html = await getHtml({
        id: "l1",
        type: "list",
        ordered: false,
        items: [{ content: "Item A" }],
      });
      expect(html).toContain("<ul>");
      expect(html).toContain("<li>");
    });

    it("renders ordered list", async () => {
      const html = await getHtml({
        id: "l2",
        type: "list",
        ordered: true,
        items: [{ content: "Step 1" }],
      });
      expect(html).toContain("<ol>");
    });

    it("renders table", async () => {
      const html = await getHtml({
        id: "t1",
        type: "table",
        headers: ["A", "B"],
        rows: [{ cells: ["1", "2"] }],
      });
      expect(html).toContain("<table>");
      expect(html).toContain("<th>");
      expect(html).toContain("<td>");
    });

    it("renders table without headers", async () => {
      const html = await getHtml({
        id: "t2",
        type: "table",
        rows: [{ cells: ["val"] }],
      });
      expect(html).toContain("<table>");
      expect(html).not.toContain("<thead>");
    });

    it("renders code block", async () => {
      const html = await getHtml({
        id: "c1",
        type: "code",
        content: "const x = 1;",
        codeLanguage: "js",
      });
      expect(html).toContain("<pre><code");
      expect(html).toContain("language-js");
    });

    it("renders blockquote", async () => {
      const html = await getHtml({
        id: "q1",
        type: "quote",
        content: "A quote",
      });
      expect(html).toContain("<blockquote>");
    });

    it("renders hr divider", async () => {
      const html = await getHtml({ id: "d1", type: "divider" });
      expect(html).toContain("<hr>");
    });

    it("renders callout with type class", async () => {
      const html = await getHtml({
        id: "ca1",
        type: "callout",
        content: "Note",
        calloutType: "warning",
      });
      expect(html).toContain("callout-warning");
    });

    it("renders image section", async () => {
      const html = await getHtml({
        id: "img1",
        type: "image",
        imageUrl: "http://example.com/img.png",
        imageAlt: "Alt text",
        imageCaption: "Caption",
      });
      expect(html).toContain("<img");
      expect(html).toContain("Caption");
    });

    it("renders default fallback for unknown type", async () => {
      const html = await getHtml({
        id: "x1",
        type: "chart" as never,
        content: "Chart",
      });
      expect(html).toContain("<p>");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // generateToc – empty headings
  // ──────────────────────────────────────────────────────────────────────────

  describe("generateToc with no headings", () => {
    it("does not render TOC when no headings exist", async () => {
      await renderer.render(
        makeContent({
          tableOfContents: { enabled: true, maxDepth: 3 },
          sections: [{ id: "p1", type: "paragraph", content: "No headings" }],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { includeCover: false, includeTableOfContents: true },
      );
      const html = mockPage.setContent.mock.calls[0][0] as string;
      expect(html).not.toContain('class="toc"');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // mapPageSize
  // ──────────────────────────────────────────────────────────────────────────

  describe("mapPageSize", () => {
    it("maps all known page sizes via PDFKit (getBrowser fail)", async () => {
      for (const pageSize of ["A4", "A3", "Letter", "Legal"] as const) {
        // Force PDFKit for each iteration
        mockWysiwygRenderService.getBrowser.mockRejectedValueOnce(
          new Error("no browser"),
        );
        const buffer = await renderer.render(
          makeContent(),
          DEFAULT_THEME,
          { ...DEFAULT_LAYOUT, pageSize },
          { includeCover: false },
        );
        expect(Buffer.isBuffer(buffer)).toBe(true);
      }
    });
  });
});
