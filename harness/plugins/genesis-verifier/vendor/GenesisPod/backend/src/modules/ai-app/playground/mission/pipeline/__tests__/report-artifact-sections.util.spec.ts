import {
  extractSectionBodyMarkdown,
  extractSubstantiveSectionText,
  normalizeSectionMarkdown,
  rebuildSectionLayout,
  type SectionLike,
} from "../../artifacts/report-artifact-sections.util";

describe("report-artifact-sections.util", () => {
  describe("normalizeSectionMarkdown", () => {
    it("returns canonical empty section for blank markdown", () => {
      expect(normalizeSectionMarkdown("Market", "   ")).toBe("## Market\n\n");
    });

    it("rewrites matching h2 heading to canonical title", () => {
      expect(normalizeSectionMarkdown("Market", "## Old title\n\nBody")).toBe(
        "## Market\n\nBody\n",
      );
    });

    it("drops foreign heading levels and keeps body", () => {
      expect(normalizeSectionMarkdown("Market", "# Foreign\n\nBody")).toBe(
        "## Market\n\nBody\n",
      );
    });

    it("prepends canonical heading when body has no heading", () => {
      expect(normalizeSectionMarkdown("Market", "Body only")).toBe(
        "## Market\n\nBody only\n",
      );
    });
  });

  describe("rebuildSectionLayout", () => {
    it("recomputes offsets and word counts from headings", () => {
      const sections: SectionLike[] = [
        { title: "Overview", startOffset: 0, endOffset: 0 },
        { title: "Market", startOffset: 0, endOffset: 0 },
      ];
      const fullMarkdown =
        "## Overview\n\nOverview body text.\n\n## Market\n\nMarket body text.\n";

      rebuildSectionLayout(sections, fullMarkdown, "en-US");

      expect(sections[0].startOffset).toBe(0);
      expect(sections[0].endOffset).toBe(fullMarkdown.indexOf("## Market"));
      expect(sections[0].wordCount).toBeGreaterThan(0);
      expect(sections[0].readingTimeMinutes).toBe(1);
      expect(sections[1].startOffset).toBe(fullMarkdown.indexOf("## Market"));
      expect(sections[1].endOffset).toBe(fullMarkdown.length);
      expect(sections[1].wordCount).toBeGreaterThan(0);
    });

    it("marks unmatched sections as empty", () => {
      const sections: SectionLike[] = [
        {
          title: "Missing",
          startOffset: 1,
          endOffset: 2,
          wordCount: 10,
          readingTimeMinutes: 2,
        },
      ];

      rebuildSectionLayout(sections, "## Other\n\nBody\n", "en-US");

      expect(sections[0]).toMatchObject({
        startOffset: -1,
        endOffset: -1,
        wordCount: 0,
        readingTimeMinutes: 0,
      });
    });
  });

  describe("extractSectionBodyMarkdown", () => {
    const fullMarkdown = "## Overview\n\nLine one.\n\nLine two.\n";

    it("returns empty string for invalid ranges", () => {
      expect(
        extractSectionBodyMarkdown(fullMarkdown, {
          startOffset: -1,
          endOffset: 10,
        }),
      ).toBe("");
      expect(
        extractSectionBodyMarkdown(fullMarkdown, {
          startOffset: 4,
          endOffset: 4,
        }),
      ).toBe("");
      expect(
        extractSectionBodyMarkdown(fullMarkdown, {
          startOffset: fullMarkdown.length + 1,
          endOffset: fullMarkdown.length + 10,
        }),
      ).toBe("");
    });

    it("strips the h2 heading and keeps body markdown", () => {
      expect(
        extractSectionBodyMarkdown(fullMarkdown, {
          startOffset: 0,
          endOffset: fullMarkdown.length,
        }),
      ).toBe("Line one.\n\nLine two.");
    });
  });

  describe("extractSubstantiveSectionText", () => {
    it("removes formatting-only wrappers", () => {
      const fullMarkdown =
        "## Overview\n\n> **Point** [1]\n\n- Bullet item\n\nActual paragraph.\n";

      expect(
        extractSubstantiveSectionText(fullMarkdown, {
          startOffset: 0,
          endOffset: fullMarkdown.length,
        }),
      ).toBe("Point \nBullet item\nActual paragraph.");
    });
  });
});
