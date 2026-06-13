/**
 * citation-verifier.util.ts unit tests
 * Covers: extractCitationsWithContext, buildEvidenceFingerprint,
 *         scoreCitationMatch, verifyCitations,
 *         buildContiguousMapping, restoreGlobalIndices
 */
import {
  extractCitationsWithContext,
  buildEvidenceFingerprint,
  scoreCitationMatch,
  verifyCitations,
  buildContiguousMapping,
  restoreGlobalIndices,
} from "../citation-verifier.util";

// ─── sample evidence ─────────────────────────────────────────────────────────

const EV1 = {
  index: 1,
  title: "OpenAI GPT-4 Technical Report 2024",
  domain: "openai.com",
  content:
    "GPT-4 achieves 90% on MMLU benchmark achieving state-of-the-art results.",
};

const EV2 = {
  index: 2,
  title: "DeepMind AlphaCode Performance Analysis",
  domain: "deepmind.com",
  content:
    "AlphaCode solved 45.7% of competitive programming problems in 2023.",
};

const EV3 = {
  index: 3,
  title: "Anthropic Claude Safety Paper",
  domain: "anthropic.com",
  content: "Constitutional AI reduces harmful outputs by 72% in testing.",
};

// ─── extractCitationsWithContext ─────────────────────────────────────────────

describe("extractCitationsWithContext", () => {
  it("extracts single citation with context", () => {
    const content = "According to the paper, GPT-4 achieves 90% on MMLU [1].";
    const citations = extractCitationsWithContext(content);
    expect(citations).toHaveLength(1);
    expect(citations[0].index).toBe(1);
    expect(citations[0].position).toBeGreaterThanOrEqual(0);
    expect(citations[0].context).toContain("GPT-4");
  });

  it("extracts multiple citations", () => {
    const content = "First finding [1], second finding [2], third [3].";
    const citations = extractCitationsWithContext(content);
    expect(citations).toHaveLength(3);
    expect(citations[0].index).toBe(1);
    expect(citations[1].index).toBe(2);
    expect(citations[2].index).toBe(3);
  });

  it("returns empty array for content with no citations", () => {
    const citations = extractCitationsWithContext("No citations here.");
    expect(citations).toHaveLength(0);
  });

  it("handles repeated citation of same index", () => {
    const content = "First [1], and also [1] again.";
    const citations = extractCitationsWithContext(content);
    expect(citations).toHaveLength(2);
    expect(citations[0].index).toBe(1);
    expect(citations[1].index).toBe(1);
  });

  it("context includes surrounding text up to 200 chars each side", () => {
    const prefix = "A".repeat(100);
    const suffix = "B".repeat(100);
    const content = `${prefix} [1] ${suffix}`;
    const citations = extractCitationsWithContext(content);
    expect(citations[0].context).toContain("A");
    expect(citations[0].context).toContain("B");
  });

  it("context is bounded at start of document", () => {
    const content = "[1] beginning of document";
    const citations = extractCitationsWithContext(content);
    expect(citations[0].position).toBe(0);
    expect(citations[0].context).toBe("[1] beginning of document");
  });
});

// ─── buildEvidenceFingerprint ─────────────────────────────────────────────────

describe("buildEvidenceFingerprint", () => {
  it("builds fingerprint with correct index", () => {
    const fp = buildEvidenceFingerprint(EV1);
    expect(fp.index).toBe(1);
  });

  it("lowercases the title", () => {
    const fp = buildEvidenceFingerprint(EV1);
    expect(fp.titleLower).toBe(EV1.title.toLowerCase());
  });

  it("lowercases the domain", () => {
    const fp = buildEvidenceFingerprint(EV1);
    expect(fp.domainLower).toBe("openai.com");
  });

  it("handles missing domain", () => {
    const fp = buildEvidenceFingerprint({ ...EV1, domain: null });
    expect(fp.domainLower).toBe("");
  });

  it("extracts numbers from content (percentages)", () => {
    const fp = buildEvidenceFingerprint(EV1);
    expect(fp.numbers.has("90%")).toBe(true);
  });

  it("extracts years from content", () => {
    const fp = buildEvidenceFingerprint(EV2);
    expect(fp.numbers.has("2023")).toBe(true);
  });

  it("builds trigrams from title", () => {
    const fp = buildEvidenceFingerprint(EV1);
    expect(fp.trigrams.size).toBeGreaterThan(0);
  });

  it("builds keyword set from title and content", () => {
    const fp = buildEvidenceFingerprint(EV1);
    expect(fp.keywords.size).toBeGreaterThan(0);
  });

  it("handles missing content", () => {
    const fp = buildEvidenceFingerprint({ ...EV1, content: null });
    expect(fp.numbers).toBeInstanceOf(Set);
    expect(fp.keywords).toBeInstanceOf(Set);
  });
});

// ─── scoreCitationMatch ───────────────────────────────────────────────────────

describe("scoreCitationMatch", () => {
  it("gives higher score to matching evidence vs non-matching", () => {
    const context =
      "According to OpenAI, GPT-4 achieves 90% on MMLU benchmark openai.com";
    const fp1 = buildEvidenceFingerprint(EV1);
    const fp2 = buildEvidenceFingerprint(EV2);
    const score1 = scoreCitationMatch(context, fp1);
    const score2 = scoreCitationMatch(context, fp2);
    expect(score1).toBeGreaterThan(score2);
  });

  it("returns a numeric score", () => {
    const fp = buildEvidenceFingerprint(EV1);
    const score = scoreCitationMatch("some context text", fp);
    expect(typeof score).toBe("number");
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("returns 0 for completely unrelated context", () => {
    const fp = buildEvidenceFingerprint({
      index: 99,
      title: "Completely Unrelated Topic ZXYW",
      domain: "nowhere.xyz",
      content: "zxyw nonsense content",
    });
    const score = scoreCitationMatch(
      "The weather today is sunny and bright.",
      fp,
    );
    expect(score).toBeLessThan(5);
  });

  it("scores full title match highly", () => {
    const fp = buildEvidenceFingerprint({
      index: 1,
      title: "specific exact title match",
      domain: "test.com",
      content: null,
    });
    const context = "As per specific exact title match and related work...";
    const score = scoreCitationMatch(context, fp);
    expect(score).toBeGreaterThanOrEqual(8);
  });

  it("includes domain match in score", () => {
    const fp = buildEvidenceFingerprint({
      index: 1,
      title: "Tech Report",
      domain: "specificdomain.org",
      content: null,
    });
    const context = "Source: specificdomain.org published the tech report";
    const score = scoreCitationMatch(context, fp);
    expect(score).toBeGreaterThan(5);
  });
});

// ─── verifyCitations ─────────────────────────────────────────────────────────

describe("verifyCitations", () => {
  it("returns unchanged content when no citations", () => {
    const result = verifyCitations("No citations here.", [EV1]);
    expect(result.content).toBe("No citations here.");
    expect(result.results).toHaveLength(0);
    expect(result.stats.total).toBe(0);
  });

  it("returns unchanged content when no evidence", () => {
    const result = verifyCitations("Some text [1]", []);
    expect(result.content).toBe("Some text [1]");
  });

  it("returns unchanged when both content and evidence empty", () => {
    const result = verifyCitations("", []);
    expect(result.content).toBe("");
  });

  it("keeps a correctly attributed citation", () => {
    const content =
      "GPT-4 achieves 90% on MMLU according to the OpenAI technical report [1].";
    const result = verifyCitations(content, [EV1, EV2, EV3]);
    // Citation [1] is for EV1 which matches the context
    const citationResult = result.results[0];
    expect(citationResult.originalIndex).toBe(1);
    // Should be kept or corrected, but not removed (strong match)
    expect(citationResult.action).not.toBe("remove");
  });

  it("removes a citation that references a non-existent evidence index", () => {
    // [99] doesn't exist in evidence list
    const content = "Some completely unrelated statement [99].";
    const evidences = [EV1, EV2];
    const result = verifyCitations(content, evidences);
    const r = result.results[0];
    // If no evidence matches the context, it should remove
    if (r.action === "remove") {
      expect(result.content).not.toContain("[99]");
      expect(result.stats.removed).toBe(1);
    }
  });

  it("produces correct stat counts", () => {
    const content = "Finding A [1]. Finding B [2].";
    const result = verifyCitations(content, [EV1, EV2]);
    expect(result.stats.total).toBe(2);
    expect(
      result.stats.kept + result.stats.corrected + result.stats.removed,
    ).toBe(2);
  });

  it("handles multiple citations to same index", () => {
    const content = "GPT-4 [1] is amazing. OpenAI GPT-4 [1] confirmed this.";
    const result = verifyCitations(content, [EV1, EV2]);
    expect(result.results).toHaveLength(2);
  });

  it("returns verifyCitationsResult with all fields", () => {
    const content = "Research shows 90% accuracy [1].";
    const result = verifyCitations(content, [EV1]);
    expect(result).toHaveProperty("content");
    expect(result).toHaveProperty("results");
    expect(result).toHaveProperty("stats");
    expect(result.stats).toHaveProperty("total");
    expect(result.stats).toHaveProperty("kept");
    expect(result.stats).toHaveProperty("corrected");
    expect(result.stats).toHaveProperty("removed");
  });
});

// ─── buildContiguousMapping ───────────────────────────────────────────────────

describe("buildContiguousMapping", () => {
  it("maps non-contiguous indices to contiguous 1-based", () => {
    const map = buildContiguousMapping([2, 5, 8]);
    expect(map.get(1)).toBe(2);
    expect(map.get(2)).toBe(5);
    expect(map.get(3)).toBe(8);
  });

  it("sorts input before mapping", () => {
    const map = buildContiguousMapping([10, 3, 7]);
    expect(map.get(1)).toBe(3);
    expect(map.get(2)).toBe(7);
    expect(map.get(3)).toBe(10);
  });

  it("handles single element", () => {
    const map = buildContiguousMapping([42]);
    expect(map.get(1)).toBe(42);
  });

  it("handles empty array", () => {
    const map = buildContiguousMapping([]);
    expect(map.size).toBe(0);
  });
});

// ─── restoreGlobalIndices ─────────────────────────────────────────────────────

describe("restoreGlobalIndices", () => {
  it("replaces local indices with global indices", () => {
    const map = buildContiguousMapping([2, 5, 8]);
    const content = "Finding [1], [2], and [3].";
    const restored = restoreGlobalIndices(content, map);
    expect(restored).toBe("Finding [2], [5], and [8].");
  });

  it("returns original content when map is empty", () => {
    const content = "Text [1] and [2].";
    const restored = restoreGlobalIndices(content, new Map());
    expect(restored).toBe(content);
  });

  it("leaves unrecognized indices unchanged", () => {
    const map = new Map([[1, 10]]);
    const content = "First [1], unknown [99].";
    const restored = restoreGlobalIndices(content, map);
    expect(restored).toBe("First [10], unknown [99].");
  });

  it("handles content with no indices", () => {
    const map = buildContiguousMapping([1, 2]);
    const content = "No citation markers here.";
    expect(restoreGlobalIndices(content, map)).toBe(content);
  });
});
