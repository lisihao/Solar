/**
 * HtmlRenderer unit tests
 *
 * Coverage:
 * - render() happy path (returns Buffer with valid HTML structure)
 * - render() with/without cover, TOC, references, watermark
 * - All section types: heading (levels 1-6), paragraph, list (ordered/unordered),
 *   table, code, quote, divider, callout (info/warning/success/error), image, default
 * - escapeHtml - XSS prevention via special chars in content
 * - generateWatermark with custom opacity
 * - renderFromHtml() - WYSIWYG mode wraps HTML+CSS into standalone document
 * - TOC generation - includes only headings up to level 3
 * - getMimeType / getFileExtension
 * - generateCover with/without optional fields (subtitle, author, organization, date)
 * - references with/without URL and snippet
 * - formatContent - citation marker conversion [1] -> <span class="citation">
 * - slugify - Chinese + ASCII text to anchor-safe strings
 */

// Mock @prisma/client to avoid issues with ExportFormat enum not being generated
jest.mock("@prisma/client", () => ({
  ExportFormat: {
    HTML: "HTML",
    DOCX: "DOCX",
    PDF: "PDF",
    MARKDOWN: "MARKDOWN",
    PPTX: "PPTX",
    XLSX: "XLSX",
  },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { HtmlRenderer } from "../html.renderer";
import { DEFAULT_THEME, DEFAULT_LAYOUT } from "../../types/theme-config";
import { UnifiedContent, ContentSection } from "../../types/unified-content";
import { ExportOptions } from "../../types/export-options";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContent(overrides: Partial<UnifiedContent> = {}): UnifiedContent {
  return {
    metadata: {
      title: "HTML Test Report",
      subtitle: "Subtitle",
      author: "Test Author",
      organization: "Test Org",
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

function makeSection(overrides: Partial<ContentSection>): ContentSection {
  return {
    id: "s-1",
    type: "paragraph",
    content: "Default content",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HtmlRenderer", () => {
  let renderer: HtmlRenderer;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HtmlRenderer],
    }).compile();

    renderer = module.get<HtmlRenderer>(HtmlRenderer);
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // getMimeType / getFileExtension
  // =========================================================================
  describe("getMimeType / getFileExtension", () => {
    it("returns text/html MIME type", () => {
      expect(renderer.getMimeType()).toBe("text/html");
    });

    it("returns .html file extension", () => {
      expect(renderer.getFileExtension()).toBe(".html");
    });
  });

  // =========================================================================
  // render() - basic output
  // =========================================================================
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

    it("produces valid HTML5 structure", async () => {
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      const html = buffer.toString("utf-8");
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<html");
      expect(html).toContain("</html>");
      expect(html).toContain("<head>");
      expect(html).toContain("<body>");
      expect(html).toContain("</body>");
    });

    it("includes title in <head>", async () => {
      const buffer = await renderer.render(
        makeContent({
          metadata: { title: "My Custom Report", language: "zh-CN" },
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      const html = buffer.toString("utf-8");
      expect(html).toContain("<title>My Custom Report</title>");
    });

    it("sets lang attribute from content metadata", async () => {
      const buffer = await renderer.render(
        makeContent({ metadata: { title: "Report", language: "en-US" } }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      const html = buffer.toString("utf-8");
      expect(html).toContain('lang="en-US"');
    });

    it("defaults lang to zh-CN when language not set", async () => {
      const buffer = await renderer.render(
        makeContent({ metadata: { title: "Report" } }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      const html = buffer.toString("utf-8");
      expect(html).toContain('lang="zh-CN"');
    });

    it("renders cover when includeCover is true", async () => {
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeCover: true },
      );
      const html = buffer.toString("utf-8");
      expect(html).toContain("cover");
      expect(html).toContain("HTML Test Report");
    });

    it("skips cover when includeCover is false", async () => {
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeCover: false },
      );
      const html = buffer.toString("utf-8");
      expect(html).not.toContain('class="cover"');
    });

    it("includes TOC when includeTableOfContents and tableOfContents.enabled", async () => {
      const buffer = await renderer.render(
        makeContent({
          tableOfContents: { enabled: true, maxDepth: 3 },
          sections: [
            makeSection({
              id: "h1",
              type: "heading",
              content: "Chapter 1",
              level: 1,
            }),
            makeSection({
              id: "h2",
              type: "heading",
              content: "Section 1.1",
              level: 2,
            }),
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeTableOfContents: true },
      );
      const html = buffer.toString("utf-8");
      expect(html).toContain("toc");
      expect(html).toContain("Chapter 1");
    });

    it("skips TOC when tableOfContents.enabled is false", async () => {
      const buffer = await renderer.render(
        makeContent({ tableOfContents: { enabled: false } }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeTableOfContents: true },
      );
      const html = buffer.toString("utf-8");
      expect(html).not.toContain('class="toc"');
    });

    it("skips TOC when includeTableOfContents option is false", async () => {
      const buffer = await renderer.render(
        makeContent({
          tableOfContents: { enabled: true },
          sections: [makeSection({ type: "heading", level: 1, content: "H1" })],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeTableOfContents: false },
      );
      const html = buffer.toString("utf-8");
      expect(html).not.toContain('class="toc"');
    });

    it("includes references when present and includeReferences is not false", async () => {
      const buffer = await renderer.render(
        makeContent({
          references: [
            { id: "1", title: "Reference One", url: "https://example.com" },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeReferences: true },
      );
      const html = buffer.toString("utf-8");
      expect(html).toContain("references");
      expect(html).toContain("Reference One");
    });

    it("skips references when includeReferences is false", async () => {
      const buffer = await renderer.render(
        makeContent({
          references: [{ id: "1", title: "Reference One" }],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeReferences: false },
      );
      const html = buffer.toString("utf-8");
      expect(html).not.toContain('class="references"');
    });

    it("includes watermark when watermark option is set", async () => {
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, watermark: "CONFIDENTIAL" },
      );
      const html = buffer.toString("utf-8");
      expect(html).toContain("CONFIDENTIAL");
      expect(html).toContain("watermark");
    });

    it("uses custom watermark opacity", async () => {
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, watermark: "DRAFT", watermarkOpacity: 0.15 },
      );
      const html = buffer.toString("utf-8");
      expect(html).toContain("0.15");
    });

    it("does not include watermark element when watermark option is not set", async () => {
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions },
      );
      const html = buffer.toString("utf-8");
      expect(html).not.toContain('class="watermark"');
    });
  });

  // =========================================================================
  // Section rendering
  // =========================================================================
  describe("section rendering", () => {
    async function renderSections(sections: ContentSection[]): Promise<string> {
      const buffer = await renderer.render(
        makeContent({ sections }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeCover: false },
      );
      return buffer.toString("utf-8");
    }

    it("renders heading level 1", async () => {
      const html = await renderSections([
        makeSection({ id: "h1", type: "heading", content: "Title", level: 1 }),
      ]);
      expect(html).toContain("<h1");
      expect(html).toContain("Title");
    });

    it("renders heading level 2", async () => {
      const html = await renderSections([
        makeSection({
          id: "h2",
          type: "heading",
          content: "Subtitle",
          level: 2,
        }),
      ]);
      expect(html).toContain("<h2");
    });

    it("renders heading level 6 (max)", async () => {
      const html = await renderSections([
        makeSection({ id: "h6", type: "heading", content: "Deep", level: 6 }),
      ]);
      expect(html).toContain("<h6");
    });

    it("clamps heading level to max 6", async () => {
      const html = await renderSections([
        makeSection({ id: "h7", type: "heading", content: "Deep", level: 9 }),
      ]);
      expect(html).toContain("<h6");
    });

    it("renders paragraph with <p> tag", async () => {
      const html = await renderSections([
        makeSection({ type: "paragraph", content: "Hello world" }),
      ]);
      expect(html).toContain("<p>");
      expect(html).toContain("Hello world");
    });

    it("renders citation markers in paragraph content", async () => {
      const html = await renderSections([
        makeSection({ type: "paragraph", content: "See [1] for details [2]." }),
      ]);
      expect(html).toContain('class="citation"');
      expect(html).toContain('data-ref="1"');
      expect(html).toContain('data-ref="2"');
    });

    it("renders unordered list", async () => {
      const html = await renderSections([
        makeSection({
          type: "list",
          ordered: false,
          items: [{ content: "Item A" }, { content: "Item B" }],
        }),
      ]);
      expect(html).toContain("<ul>");
      expect(html).toContain("Item A");
      expect(html).toContain("Item B");
    });

    it("renders ordered list", async () => {
      const html = await renderSections([
        makeSection({
          type: "list",
          ordered: true,
          items: [{ content: "First" }, { content: "Second" }],
        }),
      ]);
      expect(html).toContain("<ol>");
    });

    it("renders nested list items", async () => {
      const html = await renderSections([
        makeSection({
          type: "list",
          ordered: false,
          items: [
            {
              content: "Parent",
              children: [{ content: "Child" }],
            },
          ],
        }),
      ]);
      expect(html).toContain("Parent");
      expect(html).toContain("Child");
    });

    it("renders code block with <pre><code>", async () => {
      const html = await renderSections([
        makeSection({
          type: "code",
          content: "const x = 1;",
          codeLanguage: "typescript",
        }),
      ]);
      expect(html).toContain("<pre>");
      expect(html).toContain("<code");
      expect(html).toContain("language-typescript");
      expect(html).toContain("const x = 1;");
    });

    it("renders quote with <blockquote>", async () => {
      const html = await renderSections([
        makeSection({ type: "quote", content: "Famous quote here" }),
      ]);
      expect(html).toContain("<blockquote>");
      expect(html).toContain("Famous quote here");
    });

    it("renders divider as <hr>", async () => {
      const html = await renderSections([makeSection({ type: "divider" })]);
      expect(html).toContain("<hr>");
    });

    it("renders callout info type", async () => {
      const html = await renderSections([
        makeSection({
          type: "callout",
          calloutType: "info",
          content: "Info message",
        }),
      ]);
      expect(html).toContain("callout-info");
      expect(html).toContain("Info message");
    });

    it("renders callout warning type", async () => {
      const html = await renderSections([
        makeSection({
          type: "callout",
          calloutType: "warning",
          content: "Warning",
        }),
      ]);
      expect(html).toContain("callout-warning");
    });

    it("renders callout success type", async () => {
      const html = await renderSections([
        makeSection({
          type: "callout",
          calloutType: "success",
          content: "Done",
        }),
      ]);
      expect(html).toContain("callout-success");
    });

    it("renders callout error type", async () => {
      const html = await renderSections([
        makeSection({
          type: "callout",
          calloutType: "error",
          content: "Error",
        }),
      ]);
      expect(html).toContain("callout-error");
    });

    it("renders callout with default info type when calloutType is undefined", async () => {
      const html = await renderSections([
        makeSection({ type: "callout", content: "No type" }),
      ]);
      expect(html).toContain("callout-info");
    });

    it("renders image with <figure> and <img>", async () => {
      const html = await renderSections([
        makeSection({
          type: "image",
          imageUrl: "https://example.com/photo.jpg",
          imageAlt: "A photo",
          imageCaption: "Figure caption",
        }),
      ]);
      expect(html).toContain("<figure>");
      expect(html).toContain("<img");
      expect(html).toContain("photo.jpg");
      expect(html).toContain("A photo");
      expect(html).toContain("Figure caption");
      expect(html).toContain("<figcaption>");
    });

    it("renders image without caption", async () => {
      const html = await renderSections([
        makeSection({
          type: "image",
          imageUrl: "https://example.com/photo.jpg",
        }),
      ]);
      expect(html).not.toContain("<figcaption>");
    });

    it("renders table with headers and rows", async () => {
      const html = await renderSections([
        makeSection({
          type: "table",
          headers: ["Name", "Value"],
          rows: [{ cells: ["Alice", "100"] }, { cells: ["Bob", "200"] }],
        }),
      ]);
      expect(html).toContain("<table>");
      expect(html).toContain("<thead>");
      expect(html).toContain("<th>Name</th>");
      expect(html).toContain("<td>Alice</td>");
    });

    it("renders table without headers", async () => {
      const html = await renderSections([
        makeSection({
          type: "table",
          headers: undefined,
          rows: [{ cells: ["Cell1", "Cell2"] }],
        }),
      ]);
      expect(html).toContain("<table>");
      expect(html).not.toContain("<thead>");
    });

    it("renders unknown section type as paragraph fallback", async () => {
      const html = await renderSections([
        makeSection({
          type: "unknown-type" as ContentSection["type"],
          content: "Fallback text",
        }),
      ]);
      expect(html).toContain("<p>");
      expect(html).toContain("Fallback text");
    });
  });

  // =========================================================================
  // HTML escaping (XSS prevention)
  // =========================================================================
  describe("HTML escaping", () => {
    it("escapes < and > in paragraph content", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [
            makeSection({
              type: "paragraph",
              content: "<script>alert(1)</script>",
            }),
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeCover: false },
      );
      const html = buffer.toString("utf-8");
      // The page always contains a legitimate <script> tag for smooth scroll,
      // so we verify the user-injected script content is escaped, not that
      // no <script> tag exists at all.
      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).toContain("&lt;script&gt;");
    });

    it("escapes & in title metadata", async () => {
      const buffer = await renderer.render(
        makeContent({ metadata: { title: "A & B Report" } }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      const html = buffer.toString("utf-8");
      expect(html).toContain("A &amp; B Report");
    });

    it("escapes quotes in author meta tag", async () => {
      const buffer = await renderer.render(
        makeContent({
          metadata: { title: "Report", author: 'Test "Author"' },
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      const html = buffer.toString("utf-8");
      expect(html).toContain("&quot;Author&quot;");
    });
  });

  // =========================================================================
  // Cover generation
  // =========================================================================
  describe("cover generation", () => {
    it("includes subtitle in cover when present", async () => {
      const buffer = await renderer.render(
        makeContent({ metadata: { title: "Report", subtitle: "My Subtitle" } }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      const html = buffer.toString("utf-8");
      expect(html).toContain("My Subtitle");
      expect(html).toContain("cover-subtitle");
    });

    it("does not render author line when author is missing", async () => {
      const buffer = await renderer.render(
        makeContent({ metadata: { title: "Report" } }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      const html = buffer.toString("utf-8");
      expect(html).not.toContain("作者:");
    });

    it("includes formatted date in cover when date is set", async () => {
      const buffer = await renderer.render(
        makeContent({
          metadata: {
            title: "Report",
            date: new Date("2024-06-15"),
          },
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      const html = buffer.toString("utf-8");
      expect(html).toContain("日期:");
    });
  });

  // =========================================================================
  // TOC generation
  // =========================================================================
  describe("TOC generation", () => {
    it("generates TOC with custom title from tableOfContents config", async () => {
      const buffer = await renderer.render(
        makeContent({
          tableOfContents: {
            enabled: true,
            title: "Table of Contents",
            maxDepth: 3,
          },
          sections: [
            makeSection({
              id: "h1",
              type: "heading",
              content: "Introduction",
              level: 1,
            }),
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeTableOfContents: true },
      );
      const html = buffer.toString("utf-8");
      expect(html).toContain("Table of Contents");
    });

    it("excludes headings deeper than level 3 from TOC", async () => {
      const buffer = await renderer.render(
        makeContent({
          tableOfContents: { enabled: true },
          sections: [
            makeSection({ id: "h1", type: "heading", content: "H1", level: 1 }),
            makeSection({
              id: "h4",
              type: "heading",
              content: "DeepSection",
              level: 4,
            }),
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeTableOfContents: true },
      );
      const html = buffer.toString("utf-8");
      // H1 should appear in TOC
      expect(html).toMatch(/toc.*H1/s);
      // Level 4 should NOT appear in TOC nav
      const tocSection = html.match(/class="toc"[\s\S]*?<\/nav>/);
      if (tocSection) {
        expect(tocSection[0]).not.toContain("DeepSection");
      }
    });

    it("returns empty string for TOC when no level 1-3 headings exist", async () => {
      const buffer = await renderer.render(
        makeContent({
          tableOfContents: { enabled: true },
          sections: [
            makeSection({
              id: "h4",
              type: "heading",
              content: "Deep Heading",
              level: 4,
            }),
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeTableOfContents: true },
      );
      const html = buffer.toString("utf-8");
      expect(html).not.toContain('class="toc"');
    });
  });

  // =========================================================================
  // References rendering
  // =========================================================================
  describe("references rendering", () => {
    it("renders reference with URL as clickable link", async () => {
      const buffer = await renderer.render(
        makeContent({
          references: [
            {
              id: "1",
              title: "Arxiv Paper",
              url: "https://arxiv.org/abs/123",
            },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      const html = buffer.toString("utf-8");
      expect(html).toContain('href="https://arxiv.org/abs/123"');
    });

    it("renders reference snippet (truncated to 200 chars)", async () => {
      const longSnippet = "A".repeat(250);
      const buffer = await renderer.render(
        makeContent({
          references: [{ id: "1", title: "Ref1", snippet: longSnippet }],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      const html = buffer.toString("utf-8");
      // snippet should be rendered with ... suffix
      expect(html).toContain("...");
      // Should not contain all 250 A's
      expect(html).not.toContain("A".repeat(210));
    });

    it("renders reference without URL when URL is missing", async () => {
      const buffer = await renderer.render(
        makeContent({
          references: [{ id: "1", title: "No URL Reference" }],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      const html = buffer.toString("utf-8");
      expect(html).toContain("No URL Reference");
      // No anchor tag for URL
      expect(html).not.toContain('class="reference-url"');
    });
  });

  // =========================================================================
  // renderFromHtml() - WYSIWYG mode
  // =========================================================================
  describe("renderFromHtml()", () => {
    it("returns a Buffer with DOCTYPE and wraps captured HTML", async () => {
      const capturedHtml = "<div>Report Content</div>";
      const capturedCss = "body { color: red; }";
      const title = "My Export";

      const buffer = await renderer.renderFromHtml(
        capturedHtml,
        capturedCss,
        title,
      );

      expect(Buffer.isBuffer(buffer)).toBe(true);
      const html = buffer.toString("utf-8");
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<div>Report Content</div>");
      expect(html).toContain("body { color: red; }");
      expect(html).toContain("My Export");
    });

    it("escapes title in WYSIWYG mode", async () => {
      const buffer = await renderer.renderFromHtml(
        "",
        "",
        "<script>xss</script>",
      );
      const html = buffer.toString("utf-8");
      expect(html).not.toContain("<script>xss</script>");
      expect(html).toContain("&lt;script&gt;xss&lt;/script&gt;");
    });

    it("includes Google Fonts link in WYSIWYG mode", async () => {
      const buffer = await renderer.renderFromHtml(
        "<p>Content</p>",
        "body {}",
        "Title",
      );
      const html = buffer.toString("utf-8");
      expect(html).toContain("fonts.googleapis.com");
    });
  });

  // =========================================================================
  // Theme-dependent CSS generation
  // =========================================================================
  describe("CSS generation", () => {
    it("includes theme colors as CSS variables", async () => {
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeCover: false },
      );
      const html = buffer.toString("utf-8");
      expect(html).toContain("--color-primary:");
      expect(html).toContain("--color-text:");
      expect(html).toContain("--font-heading:");
    });

    it("generates script with smooth scroll and citation click handling", async () => {
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions },
      );
      const html = buffer.toString("utf-8");
      expect(html).toContain("scrollIntoView");
      expect(html).toContain(".citation");
    });
  });
});
