/**
 * MarkdownRenderer unit tests
 *
 * Covers:
 * - render() – all branches (subtitle, author, date, TOC, references)
 * - getMimeType / getFileExtension
 * - renderSection – all content types
 * - renderList – ordered/unordered/nested
 * - renderTable – with and without headers
 * - generateToc – headings / no headings / slugify
 * - generateReferences – with and without snippets
 * - getCalloutEmoji – all known types + unknown fallback
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { MarkdownRenderer } from "../markdown.renderer";
import { DEFAULT_THEME, DEFAULT_LAYOUT } from "../../types/theme-config";
import { UnifiedContent } from "../../types/unified-content";
import { ExportOptions } from "../../types/export-options";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeContent(overrides: Partial<UnifiedContent> = {}): UnifiedContent {
  return {
    metadata: {
      title: "Test Document",
    },
    sections: [],
    ...overrides,
  };
}

const defaultOptions: ExportOptions = {
  includeCover: false,
  includeTableOfContents: false,
  includeReferences: true,
};

// ─── tests ───────────────────────────────────────────────────────────────────

describe("MarkdownRenderer", () => {
  let renderer: MarkdownRenderer;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MarkdownRenderer],
    }).compile();

    renderer = module.get<MarkdownRenderer>(MarkdownRenderer);
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "log").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getMimeType / getFileExtension
  // ──────────────────────────────────────────────────────────────────────────

  describe("getMimeType", () => {
    it("returns text/markdown MIME type", () => {
      expect(renderer.getMimeType()).toBe("text/markdown");
    });
  });

  describe("getFileExtension", () => {
    it("returns .md extension", () => {
      expect(renderer.getFileExtension()).toBe(".md");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // render() – metadata section
  // ──────────────────────────────────────────────────────────────────────────

  describe("render() - metadata", () => {
    it("returns a Buffer", async () => {
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("includes document title as h1", async () => {
      const buffer = await renderer.render(
        makeContent({ metadata: { title: "My Report" } }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(buffer.toString("utf-8")).toContain("# My Report");
    });

    it("includes subtitle as blockquote when present", async () => {
      const buffer = await renderer.render(
        makeContent({ metadata: { title: "T", subtitle: "The Subtitle" } }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(buffer.toString("utf-8")).toContain("> The Subtitle");
    });

    it("omits subtitle when absent", async () => {
      const buffer = await renderer.render(
        makeContent({ metadata: { title: "T" } }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(buffer.toString("utf-8")).not.toContain("> ");
    });

    it("includes author when present", async () => {
      const buffer = await renderer.render(
        makeContent({ metadata: { title: "T", author: "Jane Doe" } }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(buffer.toString("utf-8")).toContain("**作者**: Jane Doe");
    });

    it("includes formatted date when present", async () => {
      const buffer = await renderer.render(
        makeContent({
          metadata: { title: "T", date: new Date("2024-06-01") },
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(buffer.toString("utf-8")).toContain("**日期**:");
    });

    it("includes both author and date with pipe separator", async () => {
      const buffer = await renderer.render(
        makeContent({
          metadata: {
            title: "T",
            author: "Bob",
            date: new Date("2024-01-01"),
          },
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(buffer.toString("utf-8")).toContain("|");
    });

    it("always includes horizontal rule divider", async () => {
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(buffer.toString("utf-8")).toContain("---");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // render() – Table of Contents
  // ──────────────────────────────────────────────────────────────────────────

  describe("render() - table of contents", () => {
    it("generates TOC when includeTableOfContents and tableOfContents.enabled", async () => {
      const buffer = await renderer.render(
        makeContent({
          tableOfContents: { enabled: true, maxDepth: 3 },
          sections: [
            { id: "h1", type: "heading", content: "Chapter One", level: 1 },
            { id: "h2", type: "heading", content: "Sub Section", level: 2 },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeTableOfContents: true },
      );
      const md = buffer.toString("utf-8");
      expect(md).toContain("## 目录");
      expect(md).toContain("Chapter One");
      expect(md).toContain("Sub Section");
    });

    it("omits TOC when includeTableOfContents is false", async () => {
      const buffer = await renderer.render(
        makeContent({
          tableOfContents: { enabled: true, maxDepth: 3 },
          sections: [
            { id: "h1", type: "heading", content: "Chapter", level: 1 },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeTableOfContents: false },
      );
      expect(buffer.toString("utf-8")).not.toContain("## 目录");
    });

    it("omits TOC when tableOfContents is undefined", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [
            { id: "h1", type: "heading", content: "Chapter", level: 1 },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeTableOfContents: true },
      );
      expect(buffer.toString("utf-8")).not.toContain("## 目录");
    });

    it("returns empty string from TOC generator when no headings exist", async () => {
      const buffer = await renderer.render(
        makeContent({
          tableOfContents: { enabled: true, maxDepth: 3 },
          sections: [{ id: "p1", type: "paragraph", content: "Paragraph" }],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeTableOfContents: true },
      );
      expect(buffer.toString("utf-8")).not.toContain("## 目录");
    });

    it("skips headings deeper than level 3 from TOC", async () => {
      const buffer = await renderer.render(
        makeContent({
          tableOfContents: { enabled: true, maxDepth: 3 },
          sections: [
            { id: "h4", type: "heading", content: "Deep Section", level: 4 },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeTableOfContents: true },
      );
      expect(buffer.toString("utf-8")).not.toContain("## 目录");
    });

    it("generates anchor from heading content using slugify", async () => {
      const buffer = await renderer.render(
        makeContent({
          tableOfContents: { enabled: true, maxDepth: 3 },
          sections: [
            { id: "h1", type: "heading", content: "Hello World!", level: 1 },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeTableOfContents: true },
      );
      const md = buffer.toString("utf-8");
      expect(md).toContain("#hello-world");
    });

    it("indents subheadings in TOC", async () => {
      const buffer = await renderer.render(
        makeContent({
          tableOfContents: { enabled: true, maxDepth: 3 },
          sections: [
            { id: "h1", type: "heading", content: "Main", level: 1 },
            { id: "h2", type: "heading", content: "Sub", level: 2 },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeTableOfContents: true },
      );
      const md = buffer.toString("utf-8");
      // h2 should be indented with 2 spaces
      expect(md).toContain("  - [Sub]");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // renderSection – all content types
  // ──────────────────────────────────────────────────────────────────────────

  describe("renderSection - heading", () => {
    it("renders h1 with single #", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [{ id: "h", type: "heading", content: "Title", level: 1 }],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(buffer.toString("utf-8")).toContain("# Title");
    });

    it("renders h3 with three ##", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [
            { id: "h", type: "heading", content: "Section", level: 3 },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(buffer.toString("utf-8")).toContain("### Section");
    });

    it("defaults to # when level is undefined", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [{ id: "h", type: "heading", content: "No Level" }],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(buffer.toString("utf-8")).toContain("# No Level");
    });
  });

  describe("renderSection - paragraph", () => {
    it("renders paragraph text with newline", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [
            { id: "p", type: "paragraph", content: "Some text content." },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(buffer.toString("utf-8")).toContain("Some text content.");
    });
  });

  describe("renderSection - code", () => {
    it("wraps code in triple backticks with language", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [
            {
              id: "c",
              type: "code",
              content: "const x = 1;",
              codeLanguage: "typescript",
            },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      const md = buffer.toString("utf-8");
      expect(md).toContain("```typescript");
      expect(md).toContain("const x = 1;");
      expect(md).toContain("```");
    });

    it("uses empty language string when codeLanguage is undefined", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [{ id: "c", type: "code", content: "code here" }],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(buffer.toString("utf-8")).toContain("```\ncode here");
    });
  });

  describe("renderSection - quote", () => {
    it("renders quote as blockquote with >", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [{ id: "q", type: "quote", content: "Famous quote." }],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(buffer.toString("utf-8")).toContain("> Famous quote.");
    });
  });

  describe("renderSection - divider", () => {
    it("renders divider as --- line", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [{ id: "d", type: "divider" }],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(buffer.toString("utf-8")).toContain("---");
    });
  });

  describe("renderSection - callout", () => {
    it("renders info callout with info emoji", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [
            {
              id: "ca",
              type: "callout",
              content: "Note text",
              calloutType: "info",
            },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(buffer.toString("utf-8")).toContain("提示");
    });

    it("renders warning callout", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [
            {
              id: "ca",
              type: "callout",
              content: "Warning!",
              calloutType: "warning",
            },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(buffer.toString("utf-8")).toContain("警告");
    });

    it("renders success callout", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [
            {
              id: "ca",
              type: "callout",
              content: "Done",
              calloutType: "success",
            },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(buffer.toString("utf-8")).toContain("成功");
    });

    it("renders error callout", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [
            {
              id: "ca",
              type: "callout",
              content: "Error",
              calloutType: "error",
            },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(buffer.toString("utf-8")).toContain("错误");
    });

    it("defaults to info when calloutType is undefined", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [{ id: "ca", type: "callout", content: "Generic callout" }],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(buffer.toString("utf-8")).toContain("提示");
    });

    it("defaults to info for unknown callout type", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [
            {
              id: "ca",
              type: "callout",
              content: "Unknown",
              calloutType: "custom" as never,
            },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(buffer.toString("utf-8")).toContain("提示");
    });
  });

  describe("renderSection - image", () => {
    it("renders image with alt and url", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [
            {
              id: "img",
              type: "image",
              imageUrl: "http://example.com/img.png",
              imageAlt: "Alt text",
            },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      const md = buffer.toString("utf-8");
      expect(md).toContain("![Alt text](http://example.com/img.png)");
    });

    it("renders image caption when present", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [
            {
              id: "img",
              type: "image",
              imageUrl: "http://example.com/img.png",
              imageCaption: "Figure 1",
            },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(buffer.toString("utf-8")).toContain("*Figure 1*");
    });

    it("omits caption markup when caption is absent", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [
            {
              id: "img",
              type: "image",
              imageUrl: "http://example.com/img.png",
            },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(buffer.toString("utf-8")).not.toContain("**");
    });
  });

  describe("renderSection - default fallback", () => {
    it("renders unknown section type using content property", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [
            {
              id: "x",
              type: "chart" as never,
              content: "Chart fallback text",
            },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(buffer.toString("utf-8")).toContain("Chart fallback text");
    });

    it("renders empty string for unknown section with no content", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [{ id: "x", type: "chart" as never }],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // renderList
  // ──────────────────────────────────────────────────────────────────────────

  describe("renderSection - list", () => {
    it("renders unordered list with - marker", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [
            {
              id: "l",
              type: "list",
              ordered: false,
              items: [{ content: "Item A" }, { content: "Item B" }],
            },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      const md = buffer.toString("utf-8");
      expect(md).toContain("- Item A");
      expect(md).toContain("- Item B");
    });

    it("renders ordered list with 1. marker", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [
            {
              id: "l",
              type: "list",
              ordered: true,
              items: [{ content: "Step 1" }, { content: "Step 2" }],
            },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      const md = buffer.toString("utf-8");
      expect(md).toContain("1. Step 1");
      expect(md).toContain("1. Step 2");
    });

    it("renders nested list items with indentation", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [
            {
              id: "l",
              type: "list",
              ordered: false,
              items: [
                {
                  content: "Parent",
                  children: [{ content: "Child" }],
                },
              ],
            },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      const md = buffer.toString("utf-8");
      expect(md).toContain("- Parent");
      expect(md).toContain("  - Child");
    });

    it("handles list with no items gracefully", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [
            {
              id: "l",
              type: "list",
              ordered: false,
            },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // renderTable
  // ──────────────────────────────────────────────────────────────────────────

  describe("renderSection - table", () => {
    it("renders table with headers and rows", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [
            {
              id: "t",
              type: "table",
              headers: ["Name", "Score"],
              rows: [{ cells: ["Alice", "100"] }, { cells: ["Bob", "90"] }],
            },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      const md = buffer.toString("utf-8");
      expect(md).toContain("| Name | Score |");
      expect(md).toContain("| --- | --- |");
      expect(md).toContain("| Alice | 100 |");
      expect(md).toContain("| Bob | 90 |");
    });

    it("renders table without headers", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [
            {
              id: "t",
              type: "table",
              rows: [{ cells: ["cell1", "cell2"] }],
            },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      const md = buffer.toString("utf-8");
      expect(md).toContain("| cell1 | cell2 |");
      expect(md).not.toContain("| --- |");
    });

    it("renders table without rows", async () => {
      const buffer = await renderer.render(
        makeContent({
          sections: [
            {
              id: "t",
              type: "table",
              headers: ["Col A", "Col B"],
            },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        defaultOptions,
      );
      const md = buffer.toString("utf-8");
      expect(md).toContain("| Col A | Col B |");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // references
  // ──────────────────────────────────────────────────────────────────────────

  describe("render() - references", () => {
    it("renders references section when present and includeReferences is true", async () => {
      const buffer = await renderer.render(
        makeContent({
          references: [
            {
              id: 1,
              title: "Research Paper",
              url: "https://example.com/paper",
              snippet: "This is a snippet from the paper.",
            },
          ],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeReferences: true },
      );
      const md = buffer.toString("utf-8");
      expect(md).toContain("## 参考文献");
      expect(md).toContain("**Research Paper**");
      expect(md).toContain("[链接](https://example.com/paper)");
      expect(md).toContain("This is a snippet");
    });

    it("omits references when includeReferences is false", async () => {
      const buffer = await renderer.render(
        makeContent({
          references: [{ id: 1, title: "Paper", url: "https://x.com" }],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeReferences: false },
      );
      expect(buffer.toString("utf-8")).not.toContain("## 参考文献");
    });

    it("omits references when references array is undefined", async () => {
      const buffer = await renderer.render(
        makeContent(),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeReferences: true },
      );
      expect(buffer.toString("utf-8")).not.toContain("## 参考文献");
    });

    it("renders reference without URL when url is absent", async () => {
      const buffer = await renderer.render(
        makeContent({
          references: [{ id: 2, title: "Book Title" }],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeReferences: true },
      );
      const md = buffer.toString("utf-8");
      expect(md).toContain("**Book Title**");
      expect(md).not.toContain("[链接]");
    });

    it("truncates snippet to 100 characters", async () => {
      const longSnippet = "A".repeat(200);
      const buffer = await renderer.render(
        makeContent({
          references: [{ id: 1, title: "Doc", snippet: longSnippet }],
        }),
        DEFAULT_THEME,
        DEFAULT_LAYOUT,
        { ...defaultOptions, includeReferences: true },
      );
      const md = buffer.toString("utf-8");
      expect(md).toContain("A".repeat(100) + "...");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // format property
  // ──────────────────────────────────────────────────────────────────────────

  describe("format property", () => {
    it("has format set to MARKDOWN", () => {
      expect(renderer.format).toBe("MARKDOWN");
    });
  });
});
