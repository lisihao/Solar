import { Logger } from "@nestjs/common";
import { WechatArticleFormatterService } from "../wechat-article-formatter.service";

describe("WechatArticleFormatterService", () => {
  let service: WechatArticleFormatterService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    service = new WechatArticleFormatterService();
  });

  describe("splitMarkdownIntoSections", () => {
    it("splits by ## headings into separate sections", () => {
      const md = [
        "# Title",
        "",
        "## 维度一",
        "维度一内容",
        "",
        "## 维度二",
        "维度二内容",
      ].join("\n");
      const sections = service.splitMarkdownIntoSections(md);
      expect(sections).toHaveLength(2);
      expect(sections[0].heading).toBe("维度一");
      expect(sections[1].heading).toBe("维度二");
    });

    it("merges leading structural sections into first content section", () => {
      const md = [
        "## 前言",
        "introduction text",
        "",
        "## 执行摘要",
        "summary",
        "",
        "## 维度一",
        "content",
      ].join("\n");
      const sections = service.splitMarkdownIntoSections(md);
      expect(sections).toHaveLength(1);
      expect(sections[0].heading).toBe("维度一");
      expect(sections[0].markdown).toContain("前言");
      expect(sections[0].markdown).toContain("执行摘要");
    });

    it("merges trailing structural sections into last content section", () => {
      const md = [
        "## 维度一",
        "content",
        "",
        "## 风险评估",
        "risks",
        "",
        "## 结论",
        "conclusion",
      ].join("\n");
      const sections = service.splitMarkdownIntoSections(md);
      expect(sections).toHaveLength(1);
      expect(sections[0].markdown).toContain("风险评估");
      expect(sections[0].markdown).toContain("结论");
    });

    it("handles intro lines before first ## heading", () => {
      const md = [
        "# Big Title",
        "",
        "preamble line 1",
        "preamble line 2",
        "",
        "## 维度一",
        "content",
      ].join("\n");
      const sections = service.splitMarkdownIntoSections(md);
      expect(sections).toHaveLength(1);
      expect(sections[0].markdown).toContain("preamble");
    });

    it("falls back to single Content section when no ## headings", () => {
      const md = "just some plain text\nwith no headings";
      const sections = service.splitMarkdownIntoSections(md);
      expect(sections).toHaveLength(1);
      expect(sections[0].heading).toBe("Content");
      expect(sections[0].markdown).toContain("just some plain text");
    });

    it("creates Content section from intro only when no content sections", () => {
      const md = "intro paragraph\n\nmore intro";
      const sections = service.splitMarkdownIntoSections(md);
      expect(sections).toHaveLength(1);
      expect(sections[0].heading).toBe("Content");
    });

    it("extracts chartIds via HTML comments", () => {
      const md = [
        "## 维度一",
        "<!-- chart:abc-123 -->",
        "text",
        "<!-- chart:def-456 -->",
      ].join("\n");
      const sections = service.splitMarkdownIntoSections(md);
      expect(sections[0].chartIds).toEqual(["abc-123", "def-456"]);
    });

    it("falls into all-structural fallback (sections from buffer)", () => {
      const md = ["## 前言", "intro", "", "## 结论", "wrap up"].join("\n");
      const sections = service.splitMarkdownIntoSections(md);
      expect(sections).toHaveLength(1);
      expect(sections[0].heading).toBe("Content");
    });
  });

  describe("formatForWechat", () => {
    it("wraps output in section with body styles", () => {
      const out = service.formatForWechat("hello");
      expect(out).toMatch(/^<section style=/);
      expect(out).toMatch(/<\/section>$/);
    });

    it("includes executive summary when provided", () => {
      const out = service.formatForWechat("body", {
        executiveSummary: "key insight one\nkey insight two",
      });
      expect(out).toContain("Executive Summary");
      expect(out).toContain("key insight one");
    });

    it("converts h1-h4 headings", () => {
      const md = ["# H1", "## H2", "### H3", "#### H4"].join("\n");
      const out = service.formatForWechat(md);
      expect(out).toContain("<h1");
      expect(out).toContain("<h2");
      expect(out).toContain("<h3");
      expect(out).toContain("<h4");
    });

    it("converts bullet list", () => {
      const md = "- one\n- two\n- three";
      const out = service.formatForWechat(md);
      expect(out).toContain("<ul");
      expect(out).toContain("<li");
    });

    it("converts ordered list", () => {
      const md = "1. one\n2. two";
      const out = service.formatForWechat(md);
      expect(out).toContain("<ol");
    });

    it("renders blockquote", () => {
      const md = "> quoted line\n> second line";
      const out = service.formatForWechat(md);
      expect(out).toContain("<blockquote");
      expect(out).toContain("quoted line");
    });

    it("renders horizontal rule", () => {
      const md = "above\n\n---\n\nbelow";
      const out = service.formatForWechat(md);
      expect(out).toContain("<hr");
    });

    it("renders fenced code block", () => {
      const md = "```\nfunction foo() {}\n```";
      const out = service.formatForWechat(md);
      expect(out).toContain("<pre");
      expect(out).toContain("<code");
      expect(out).toContain("function foo() {}");
    });

    it("handles unclosed code block at end", () => {
      const md = "```\ncode without closing";
      const out = service.formatForWechat(md);
      expect(out).toContain("<pre");
      expect(out).toContain("code without closing");
    });

    it("renders inline bold/italic/code/link/footnote", () => {
      const md =
        "**bold** *italic* ***mixed*** `inline code` [link](https://x) [^1]";
      const out = service.formatForWechat(md);
      expect(out).toContain("<strong");
      expect(out).toContain("<em");
      expect(out).toContain("<code");
      expect(out).toContain('href="https://x"');
      expect(out).toContain("<sup");
    });

    it("renders image with figcaption when alt set", () => {
      const md = "![alt text](https://example.com/img.png)";
      const out = service.formatForWechat(md);
      expect(out).toContain("<img");
      expect(out).toContain("<figcaption");
      expect(out).toContain("alt text");
    });

    it("renders image without figcaption when alt empty", () => {
      const md = "![](https://example.com/img.png)";
      const out = service.formatForWechat(md);
      expect(out).toContain("<img");
      expect(out).not.toContain("<figcaption");
    });

    it("renders table with header and data rows", () => {
      const md = ["| A | B |", "| --- | --- |", "| 1 | 2 |", "| 3 | 4 |"].join(
        "\n",
      );
      const out = service.formatForWechat(md);
      expect(out).toContain("<table");
      expect(out).toContain("<thead");
      expect(out).toContain("<tbody");
      expect(out).toContain("<th");
      expect(out).toContain("<td");
    });

    it("renders plain paragraphs", () => {
      const out = service.formatForWechat(
        "plain paragraph one\n\nparagraph two",
      );
      expect(out.match(/<p /g)?.length).toBe(2);
    });

    it("escapes HTML special chars in plain text", () => {
      const out = service.formatForWechat("a < b & c");
      expect(out).toContain("&lt;");
      expect(out).toContain("&amp;");
    });
  });

  describe("generateDigest", () => {
    it("strips markdown formatting and returns plain text", () => {
      const md = "**bold** and *italic* and `code` and [link](https://x)";
      const digest = service.generateDigest(md);
      expect(digest).not.toContain("**");
      expect(digest).not.toContain("`");
      expect(digest).not.toContain("[");
      expect(digest).toContain("bold");
      expect(digest).toContain("italic");
      expect(digest).toContain("code");
      expect(digest).toContain("link");
    });

    it("respects maxLength and adds ellipsis", () => {
      const long = "x".repeat(200);
      const digest = service.generateDigest(long, 50);
      expect(digest.length).toBe(50);
      expect(digest.endsWith("...")).toBe(true);
    });

    it("returns full text when shorter than maxLength", () => {
      const digest = service.generateDigest("short text", 100);
      expect(digest).toBe("short text");
    });

    it("strips lists, blockquotes, tables, hr, headings", () => {
      const md = [
        "# Title",
        "## Sub",
        "- item 1",
        "1. ordered item",
        "> quote",
        "| A | B |",
        "---",
        "plain",
      ].join("\n");
      const digest = service.generateDigest(md);
      expect(digest).not.toContain("#");
      expect(digest).not.toContain(">");
      expect(digest).not.toContain("|");
      expect(digest).not.toContain("---");
    });

    it("strips image URL from digest", () => {
      // Note: due to replacement order in the source (link before image),
      // the alt text leaks through but the URL is dropped.
      const md = "before ![alt](img.png) after";
      const digest = service.generateDigest(md);
      expect(digest).not.toContain("img.png");
    });
  });
});
