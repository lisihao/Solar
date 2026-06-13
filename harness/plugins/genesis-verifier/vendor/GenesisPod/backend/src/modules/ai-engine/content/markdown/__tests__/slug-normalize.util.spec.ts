/**
 * normalizeMarkdownSlug spec — P0a-1 (llm wiki v1.5.3 §4.4 锁定)
 *
 * 上游：docs/architecture/ai-app/library/wiki/llm-wiki.md §4.4
 */

import { normalizeMarkdownSlug } from "../slug-normalize.util";

describe("normalizeMarkdownSlug (v1.5.3 §4.4)", () => {
  describe("§4.4 example table", () => {
    it("basic: 'Machine Learning' → 'machine-learning'", () => {
      expect(normalizeMarkdownSlug("Machine Learning")).toBe(
        "machine-learning",
      );
    });

    it("apostrophe + digit: \"OpenAI's GPT-4\" → 'openai-s-gpt-4'", () => {
      expect(normalizeMarkdownSlug("OpenAI's GPT-4")).toBe("openai-s-gpt-4");
    });

    it("leading/trailing whitespace: '   spaces   ' → 'spaces'", () => {
      expect(normalizeMarkdownSlug("   spaces   ")).toBe("spaces");
    });

    it("non-ASCII (Chinese) → '' after NFKD + non-ascii strip", () => {
      // 中文经 NFKD 后无 combining marks 可剥，仍非 [a-z0-9]，
      // 整段折叠为单连字符后被头尾 trim 移除 → 空串
      expect(normalizeMarkdownSlug("数据科学")).toBe("");
    });

    it("brackets injection: '[[evil]]' → 'evil'", () => {
      expect(normalizeMarkdownSlug("[[evil]]")).toBe("evil");
    });

    it("path traversal: '../etc/passwd' → 'etc-passwd'", () => {
      expect(normalizeMarkdownSlug("../etc/passwd")).toBe("etc-passwd");
    });
  });

  describe("NFKD diacritic decomposition", () => {
    it("'café' → 'cafe'", () => {
      expect(normalizeMarkdownSlug("café")).toBe("cafe");
    });

    it("'naïve' → 'naive'", () => {
      expect(normalizeMarkdownSlug("naïve")).toBe("naive");
    });

    it("'Zürich' → 'zurich'", () => {
      expect(normalizeMarkdownSlug("Zürich")).toBe("zurich");
    });
  });

  describe("edge cases", () => {
    it("length cap at 200 chars", () => {
      const longInput = "a".repeat(500);
      const result = normalizeMarkdownSlug(longInput);
      expect(result).toHaveLength(200);
      expect(result).toBe("a".repeat(200));
    });

    it("strips trailing hyphen produced by truncation at boundary", () => {
      // 199 a + '-' + 50 b → slice(0,200) = 199a + '-' → trim → 199a
      // Regression: previous trim → slice order would output 'aaa...aaa-'
      // and violate DTO regex `[a-z0-9]$` tail constraint.
      const input = "a".repeat(199) + "-" + "b".repeat(50);
      const result = normalizeMarkdownSlug(input);
      expect(result.length).toBe(199);
      expect(result).toMatch(/[a-z0-9]$/); // tail must be alnum (DTO §11)
      expect(result).toBe("a".repeat(199));
    });

    it("handles length boundary 199 / 200 / 201 chars", () => {
      expect(normalizeMarkdownSlug("a".repeat(199)).length).toBe(199);
      expect(normalizeMarkdownSlug("a".repeat(200)).length).toBe(200);
      expect(normalizeMarkdownSlug("a".repeat(201)).length).toBe(200);
    });

    it("returns empty string for all-hyphen input after truncation", () => {
      expect(normalizeMarkdownSlug("-".repeat(250))).toBe("");
    });

    it("produces single-char output for single alnum input (DTO will reject len < 2)", () => {
      // util does not enforce ≥ 2 char length; DTO `@Matches` regex
      // (start alnum + `[a-z0-9-]{0,198}` + end alnum) rejects len < 2 itself.
      expect(normalizeMarkdownSlug("a")).toBe("a");
    });

    it("strips leading/trailing hyphen runs", () => {
      expect(normalizeMarkdownSlug("---hello---")).toBe("hello");
    });

    it("empty string → ''", () => {
      expect(normalizeMarkdownSlug("")).toBe("");
    });

    it("symbols only → ''", () => {
      expect(normalizeMarkdownSlug("!@#$%^")).toBe("");
    });

    it("collapses internal symbol runs to single hyphen", () => {
      expect(normalizeMarkdownSlug("foo!!!@@@bar")).toBe("foo-bar");
    });

    it("idempotent: running twice yields same result", () => {
      const inputs = [
        "Machine Learning",
        "OpenAI's GPT-4",
        "café",
        "---hello---",
        "",
      ];
      for (const input of inputs) {
        const once = normalizeMarkdownSlug(input);
        const twice = normalizeMarkdownSlug(once);
        expect(twice).toBe(once);
      }
    });
  });

  describe("DTO contract alignment", () => {
    // DTO regex: /^[a-z0-9][a-z0-9-]{0,198}[a-z0-9]$/
    // (i.e. start/end alphanumeric, 2-200 chars, kebab inside)
    it("output (when non-empty and len>=2) satisfies DTO regex", () => {
      const dtoRegex = /^[a-z0-9][a-z0-9-]{0,198}[a-z0-9]$/;
      const samples = [
        "Machine Learning",
        "OpenAI's GPT-4",
        "café",
        "Zürich",
        "foo!!!@@@bar",
      ];
      for (const s of samples) {
        const out = normalizeMarkdownSlug(s);
        if (out.length >= 2) {
          expect(out).toMatch(dtoRegex);
        }
      }
    });
  });
});
