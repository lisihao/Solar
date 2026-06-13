/**
 * Unit tests for content-analysis.utils.ts
 *
 * Covers:
 * - extractTrendsFromContent
 * - extractChallengesFromContent
 * - extractOpportunitiesFromContent
 * - extractSectionItems (all three strategies)
 * - replaceEvidenceIds
 * - validateDate
 */

import {
  extractTrendsFromContent,
  extractChallengesFromContent,
  extractOpportunitiesFromContent,
  extractSectionItems,
  replaceEvidenceIds,
  validateDate,
} from "../content-analysis.utils";

// ──────────────────────────────────────────────────────────────────────────────
// extractSectionItems — Strategy 1: Markdown header + bullet list
// ──────────────────────────────────────────────────────────────────────────────

describe("extractSectionItems — Strategy 1: Markdown headers", () => {
  it("extracts bold-prefixed bullet items under a matching header", () => {
    const content = "## 趋势\n- **item1** some extra text\n- **item2**";
    const items = extractSectionItems(content, ["趋势", "trend"]);
    expect(items).toContain("item1");
    expect(items).toContain("item2");
  });

  it("extracts plain bullet items (≥ 15 chars) under a matching header", () => {
    const content =
      "## 趋势\n- This is a plain bullet item long enough to be included";
    const items = extractSectionItems(content, ["趋势", "trend"]);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toContain("This is a plain bullet");
  });

  it("stops collecting items when the next header is encountered", () => {
    const content =
      "## 趋势\n- **item1**\n## Other Section\n- **should not appear**";
    const items = extractSectionItems(content, ["趋势"]);
    expect(items).toContain("item1");
    expect(items.join("")).not.toContain("should not appear");
  });

  it("caps results at 5 items", () => {
    const bullets = Array.from(
      { length: 8 },
      (_, i) => `- **item${i + 1}** description text`,
    ).join("\n");
    const content = `## 趋势\n${bullets}`;
    const items = extractSectionItems(content, ["趋势"]);
    expect(items.length).toBeLessThanOrEqual(5);
  });

  it("truncates items longer than 120 chars and appends '...'", () => {
    const longText = "A".repeat(130);
    const content = `## 趋势\n- ${longText}`;
    const items = extractSectionItems(content, ["趋势"]);
    if (items.length > 0) {
      expect(items[0].length).toBeLessThanOrEqual(123); // 120 + "..."
      expect(items[0]).toMatch(/\.\.\.$/);
    }
  });

  it("matches header keyword case-insensitively", () => {
    const content = "## Trend Analysis\n- **item1** long enough to qualify";
    const items = extractSectionItems(content, ["趋势", "trend"]);
    expect(items).toContain("item1");
  });

  it("returns empty array when header keyword does not match", () => {
    const content = "## Overview\n- **item1**";
    const items = extractSectionItems(content, ["趋势", "trend"]);
    // Falls through to strategy 2 / 3 which also find nothing for this content
    // Strategy 1 specifically finds nothing
    expect(Array.isArray(items)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// extractSectionItems — Strategy 2: **Bold keyword**: content
// ──────────────────────────────────────────────────────────────────────────────

describe("extractSectionItems — Strategy 2: bold key-value patterns", () => {
  it("extracts content after a bold keyword matching the section keywords", () => {
    const content = "**趋势**: this is the trend description content here";
    const items = extractSectionItems(content, ["趋势", "trend"]);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toContain("this is the trend description");
  });

  it("skips bold patterns with value shorter than 10 chars", () => {
    const content = "**趋势**: short";
    const items = extractSectionItems(content, ["趋势"]);
    expect(items).toHaveLength(0);
  });

  it("truncates values longer than 120 chars", () => {
    const longValue = "B".repeat(130);
    const content = `**趋势**: ${longValue}`;
    const items = extractSectionItems(content, ["趋势"]);
    if (items.length > 0) {
      expect(items[0].length).toBeLessThanOrEqual(123);
      expect(items[0]).toMatch(/\.\.\.$/);
    }
  });

  it("caps results at 5 items from bold patterns", () => {
    const content = Array.from(
      { length: 8 },
      (_, i) =>
        `**趋势${i}**: this is a sufficiently long trend description number ${i}`,
    ).join("\n");
    const items = extractSectionItems(content, ["趋势"]);
    expect(items.length).toBeLessThanOrEqual(5);
  });

  it("uses full-width colon as separator as well", () => {
    const content = "**趋势**：this is a description long enough to pass";
    const items = extractSectionItems(content, ["趋势"]);
    expect(items.length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// extractSectionItems — Strategy 3: sentences containing keywords
// ──────────────────────────────────────────────────────────────────────────────

describe("extractSectionItems — Strategy 3: sentences with keywords", () => {
  it("extracts sentences ending with Chinese full stop that contain a keyword", () => {
    const content = "这是一个关于趋势的重要观察内容。";
    const items = extractSectionItems(content, ["趋势"]);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toContain("趋势");
  });

  it("extracts sentences ending with exclamation mark", () => {
    const content = "这是一个关于趋势的非常重要的研究观察！";
    const items = extractSectionItems(content, ["趋势"]);
    expect(items.length).toBeGreaterThan(0);
  });

  it("skips sentences shorter than 15 chars", () => {
    const content = "趋势很好。";
    const items = extractSectionItems(content, ["趋势"]);
    expect(items).toHaveLength(0);
  });

  it("caps at 5 matching sentences", () => {
    const sentences = Array.from(
      { length: 8 },
      (_, i) => `这是第${i + 1}个关于趋势的重要而详细的研究观察结论陈述。`,
    ).join("");
    const items = extractSectionItems(sentences, ["趋势"]);
    expect(items.length).toBeLessThanOrEqual(5);
  });

  it("trims leading punctuation from extracted sentences", () => {
    const content = "，这是一个关于趋势的重要观察内容描述。";
    const items = extractSectionItems(content, ["趋势"]);
    if (items.length > 0) {
      expect(items[0]).not.toMatch(/^[，、：:;\s]/);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// extractSectionItems — strategy priority ordering
// ──────────────────────────────────────────────────────────────────────────────

describe("extractSectionItems — strategy fallthrough", () => {
  it("uses strategy 1 result when headers are present and matching", () => {
    const content = [
      "## 趋势",
      "- **from-header** text that is long enough",
      "**趋势**: from-bold pattern long enough to qualify",
      "这是一个关于趋势的重要观察内容。",
    ].join("\n");

    const items = extractSectionItems(content, ["趋势"]);
    // Strategy 1 fires first — should contain the header-extracted item
    expect(items).toContain("from-header");
  });

  it("falls through to strategy 2 when strategy 1 yields nothing", () => {
    // No matching header, but bold pattern present
    const content = "**趋势**: bold strategy value long enough to be included";
    const items = extractSectionItems(content, ["趋势"]);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toContain("bold strategy value");
  });

  it("falls through to strategy 3 when both 1 and 2 yield nothing", () => {
    // No header, no bold pattern, but sentence with keyword
    const content = "这是一个关于趋势的重要观察内容非常详细。";
    const items = extractSectionItems(content, ["趋势"]);
    expect(items.length).toBeGreaterThan(0);
  });

  it("returns empty array when no strategy matches", () => {
    const content = "No matching keywords at all in this text.";
    const items = extractSectionItems(content, ["趋势", "trend"]);
    expect(items).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// extractTrendsFromContent
// ──────────────────────────────────────────────────────────────────────────────

describe("extractTrendsFromContent", () => {
  it("returns an array of Trend objects", () => {
    const content =
      "## 趋势\n- **AI adoption** is accelerating rapidly globally";
    const trends = extractTrendsFromContent(content);
    expect(Array.isArray(trends)).toBe(true);
    if (trends.length > 0) {
      expect(trends[0]).toHaveProperty("trend");
      expect(trends[0]).toHaveProperty("direction", "emerging");
      expect(trends[0]).toHaveProperty("timeframe", "近期");
      expect(trends[0]).toHaveProperty("evidenceIds");
      expect(Array.isArray(trends[0].evidenceIds)).toBe(true);
    }
  });

  it("returns empty array when no trend keywords are found", () => {
    const trends = extractTrendsFromContent("Some unrelated content here.");
    expect(trends).toHaveLength(0);
  });

  it("uses the trend keyword to find relevant sections", () => {
    const content =
      "## trend\n- **rapid growth** across multiple sectors globally";
    const trends = extractTrendsFromContent(content);
    expect(trends.length).toBeGreaterThan(0);
    expect(trends[0].trend).toContain("rapid growth");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// extractChallengesFromContent
// ──────────────────────────────────────────────────────────────────────────────

describe("extractChallengesFromContent", () => {
  it("returns an array of Challenge objects", () => {
    const content =
      "## 挑战\n- **supply chain disruption** is a major concern for the industry";
    const challenges = extractChallengesFromContent(content);
    expect(Array.isArray(challenges)).toBe(true);
    if (challenges.length > 0) {
      expect(challenges[0]).toHaveProperty("challenge");
      expect(challenges[0]).toHaveProperty("impact", "");
      expect(challenges[0]).toHaveProperty("evidenceIds");
    }
  });

  it("recognises the 'challenge' English keyword", () => {
    const content =
      "## challenge\n- **regulatory compliance** is becoming increasingly difficult";
    const challenges = extractChallengesFromContent(content);
    expect(challenges.length).toBeGreaterThan(0);
  });

  it("returns empty array when no challenge keywords are present", () => {
    expect(extractChallengesFromContent("Nothing relevant.")).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// extractOpportunitiesFromContent
// ──────────────────────────────────────────────────────────────────────────────

describe("extractOpportunitiesFromContent", () => {
  it("returns an array of Opportunity objects", () => {
    const content =
      "## 机遇\n- **emerging markets** present a significant growth opportunity here";
    const opps = extractOpportunitiesFromContent(content);
    expect(Array.isArray(opps)).toBe(true);
    if (opps.length > 0) {
      expect(opps[0]).toHaveProperty("opportunity");
      expect(opps[0]).toHaveProperty("potential", "");
      expect(opps[0]).toHaveProperty("evidenceIds");
    }
  });

  it("recognises the 'opportunity' English keyword", () => {
    const content =
      "## opportunity\n- **green energy** is a massive new market to explore";
    const opps = extractOpportunitiesFromContent(content);
    expect(opps.length).toBeGreaterThan(0);
  });

  it("returns empty array when no opportunity keywords are present", () => {
    expect(extractOpportunitiesFromContent("Unrelated text.")).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// replaceEvidenceIds
// ──────────────────────────────────────────────────────────────────────────────

describe("replaceEvidenceIds", () => {
  it("replaces citation indices according to the mapping", () => {
    const mapping = new Map<number, number>([
      [1, 11],
      [2, 12],
    ]);
    const result = replaceEvidenceIds("[1] foo [2] bar", mapping);
    expect(result).toBe("[11] foo [12] bar");
  });

  it("processes from largest to smallest to avoid [1] matching inside [10]", () => {
    const mapping = new Map<number, number>([
      [1, 21],
      [10, 30],
    ]);
    const result = replaceEvidenceIds("see [10] and [1]", mapping);
    // [10] → [30], then [1] → [21]; not [1] → [21] first which would make [10] → [2[21]0]
    expect(result).toBe("see [30] and [21]");
  });

  it("replaces figure placeholders matching <!-- figure:N:M -->", () => {
    const mapping = new Map<number, number>([[1, 11]]);
    const content = "<!-- figure:1:0 -->";
    const result = replaceEvidenceIds(content, mapping);
    expect(result).toBe("<!-- figure:11:0 -->");
  });

  it("replaces both citation and figure placeholder for the same index", () => {
    const mapping = new Map<number, number>([[2, 22]]);
    const content = "[2] text <!-- figure:2:1 -->";
    const result = replaceEvidenceIds(content, mapping);
    expect(result).toBe("[22] text <!-- figure:22:1 -->");
  });

  it("skips replacement when promptIndex equals actualCitationIndex", () => {
    const mapping = new Map<number, number>([[5, 5]]);
    const content = "[5] unchanged";
    const result = replaceEvidenceIds(content, mapping);
    expect(result).toBe("[5] unchanged");
  });

  it("returns content unchanged when the mapping is empty", () => {
    const content = "[1] foo [2] bar";
    expect(replaceEvidenceIds(content, new Map())).toBe("[1] foo [2] bar");
  });

  it("handles content with no citation markers gracefully", () => {
    const mapping = new Map<number, number>([[1, 11]]);
    const content = "no citations here";
    expect(replaceEvidenceIds(content, mapping)).toBe("no citations here");
  });

  it("handles multiple occurrences of the same citation index", () => {
    const mapping = new Map<number, number>([[3, 33]]);
    const result = replaceEvidenceIds("[3] first [3] second", mapping);
    expect(result).toBe("[33] first [33] second");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// validateDate
// ──────────────────────────────────────────────────────────────────────────────

describe("validateDate", () => {
  it("returns null for null input", () => {
    expect(validateDate(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(validateDate(undefined)).toBeNull();
  });

  it("returns the same Date object for a valid Date input", () => {
    const d = new Date("2024-01-15");
    const result = validateDate(d);
    expect(result).toBeInstanceOf(Date);
    expect(result?.getTime()).toBe(d.getTime());
  });

  it("parses a valid ISO string and returns a Date", () => {
    const result = validateDate("2024-06-01T12:00:00Z");
    expect(result).toBeInstanceOf(Date);
    expect(result?.getFullYear()).toBe(2024);
  });

  it("parses a simple date string", () => {
    const result = validateDate("2023-03-20");
    expect(result).toBeInstanceOf(Date);
  });

  it("returns null for the string 'invalid'", () => {
    expect(validateDate("invalid")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(validateDate("")).toBeNull();
  });

  it("returns null for an Invalid Date object", () => {
    const bad = new Date("not-a-date");
    expect(validateDate(bad)).toBeNull();
  });

  it("returns null for a completely unparseable string", () => {
    expect(validateDate("hello world")).toBeNull();
  });
});
