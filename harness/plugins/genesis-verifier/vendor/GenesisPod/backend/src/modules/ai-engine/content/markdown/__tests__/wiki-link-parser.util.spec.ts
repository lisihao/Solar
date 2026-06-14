/**
 * parseMarkdownWikiLinks spec — P0a-1 (llm wiki v1.5.3 §10 锁定 10 条)
 *
 * 上游：docs/architecture/ai-app/library/wiki/llm-wiki.md §10
 *
 * 用例编号 1-10 与 §10 表格一致；每个 `it` 块标注用例号。
 */

import { parseMarkdownWikiLinks } from "../wiki-link-parser.util";

describe("parseMarkdownWikiLinks (v1.5.3 §10 — 10 锁定用例)", () => {
  it("#1 basic: '[[machine-learning]]' → ['machine-learning']", () => {
    expect(parseMarkdownWikiLinks("[[machine-learning]]")).toEqual([
      "machine-learning",
    ]);
  });

  it("#2 normalized: '[[Machine Learning]]' → ['machine-learning']", () => {
    expect(parseMarkdownWikiLinks("[[Machine Learning]]")).toEqual([
      "machine-learning",
    ]);
  });

  it("#3 inline code: '`[[code-block]]`' → []", () => {
    expect(parseMarkdownWikiLinks("`[[code-block]]`")).toEqual([]);
  });

  it("#4 fenced code block: backtick fence → []", () => {
    const md = "```\n[[fenced]]\n```";
    expect(parseMarkdownWikiLinks(md)).toEqual([]);
  });

  it("#4b fenced code block: tilde fence → []", () => {
    const md = "~~~\n[[fenced]]\n~~~";
    expect(parseMarkdownWikiLinks(md)).toEqual([]);
  });

  it("#4c fenced code block with language tag → []", () => {
    const md = "```typescript\nconst x = '[[fenced]]';\n```";
    expect(parseMarkdownWikiLinks(md)).toEqual([]);
  });

  it("#5 escaped brackets: '\\[\\[escaped\\]\\]' → []", () => {
    expect(parseMarkdownWikiLinks("\\[\\[escaped\\]\\]")).toEqual([]);
  });

  it("#6 multiple on same line: '[[a]] and [[b]]' → ['a', 'b']", () => {
    expect(parseMarkdownWikiLinks("[[a]] and [[b]]")).toEqual(["a", "b"]);
  });

  it("#7 empty slug: '[[]]' → []", () => {
    expect(parseMarkdownWikiLinks("[[]]")).toEqual([]);
  });

  it("#8 mixed digits/letters: '[[slug-with-123]]' → ['slug-with-123']", () => {
    expect(parseMarkdownWikiLinks("[[slug-with-123]]")).toEqual([
      "slug-with-123",
    ]);
  });

  it("#9 path traversal rejection: '[[a/b/c]]' → []", () => {
    expect(parseMarkdownWikiLinks("[[a/b/c]]")).toEqual([]);
  });

  it("#10 HTML comment: '<!-- [[comment]] -->' → []", () => {
    expect(parseMarkdownWikiLinks("<!-- [[comment]] -->")).toEqual([]);
  });

  describe("supplementary edge cases (defensive)", () => {
    it("dedupes repeated links", () => {
      expect(parseMarkdownWikiLinks("[[foo]] [[foo]] [[foo]]")).toEqual([
        "foo",
      ]);
    });

    it("normalizes title-cased duplicates: '[[Foo]] [[foo]]' → ['foo']", () => {
      expect(parseMarkdownWikiLinks("[[Foo]] [[foo]]")).toEqual(["foo"]);
    });

    it("preserves first-seen order across many links", () => {
      const md = "[[third]] before [[first]] before [[second]]";
      // first-seen order:
      expect(parseMarkdownWikiLinks(md)).toEqual(["third", "first", "second"]);
    });

    it("ignores wiki-link inside indented fence following blank line (regression)", () => {
      // Plain prose followed by fenced block — the link must be skipped
      const md = "Some prose.\n\n```\n[[fenced]]\n```\n\nMore prose [[real]].";
      expect(parseMarkdownWikiLinks(md)).toEqual(["real"]);
    });

    it("handles wiki link spanning around inline code", () => {
      const md = "[[before]] then `code` then [[after]]";
      expect(parseMarkdownWikiLinks(md)).toEqual(["before", "after"]);
    });

    it("rejects bracket content with newline", () => {
      const md = "[[foo\nbar]]";
      expect(parseMarkdownWikiLinks(md)).toEqual([]);
    });

    it("empty body → []", () => {
      expect(parseMarkdownWikiLinks("")).toEqual([]);
    });

    it("body with only whitespace/text → []", () => {
      expect(parseMarkdownWikiLinks("just some plain markdown text")).toEqual(
        [],
      );
    });

    it("trims whitespace inside brackets: '[[  foo  ]]' → ['foo']", () => {
      expect(parseMarkdownWikiLinks("[[  foo  ]]")).toEqual(["foo"]);
    });

    it("normalizes diacritics in slug: '[[café]]' → ['cafe']", () => {
      expect(parseMarkdownWikiLinks("[[café]]")).toEqual(["cafe"]);
    });

    it("returns [] when whole body is in a fence (multi-link inside)", () => {
      const md = "```\n[[a]] [[b]] [[c]]\n```";
      expect(parseMarkdownWikiLinks(md)).toEqual([]);
    });

    it("link after closing fence is parsed", () => {
      const md = "```\n[[fenced]]\n```\n[[outside]]";
      expect(parseMarkdownWikiLinks(md)).toEqual(["outside"]);
    });

    it("skips to EOF on unclosed inline code", () => {
      // Branch coverage: unterminated inline code path (i = len fallback)
      expect(
        parseMarkdownWikiLinks("`unclosed [[ignored]] still in code"),
      ).toEqual([]);
    });

    it("skips to EOF on unclosed HTML comment", () => {
      // Branch coverage: indexOf('-->') === -1 fallback
      expect(
        parseMarkdownWikiLinks("<!-- unclosed [[ignored]] never closes"),
      ).toEqual([]);
    });
  });
});
