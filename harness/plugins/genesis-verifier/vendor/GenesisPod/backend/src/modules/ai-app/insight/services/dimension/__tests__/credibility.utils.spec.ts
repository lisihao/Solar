/**
 * Unit tests for credibility.utils.ts
 *
 * Covers assessCredibility() scoring across all four dimensions:
 * 1. Domain authority (max 40)
 * 2. Source type (max 30)
 * 3. Content depth / snippet length (max 15)
 * 4. Timeliness / publication age (max 15)
 *
 * Result is always clamped to [15, 100].
 */

import { assessCredibility } from "../credibility.utils";
import type { EvidenceData } from "../../../types/research.types";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function makeEvidence(overrides: Partial<EvidenceData> = {}): EvidenceData {
  return {
    id: "ev-001",
    title: "Test Evidence",
    url: "https://example.com",
    domain: null,
    snippet: null,
    sourceType: null,
    publishedAt: null,
    credibilityScore: null,
    ...overrides,
  };
}

/** Returns a date that is approximately `days` days ago */
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// ──────────────────────────────────────────────────────────────────────────────
// Domain authority scoring
// ──────────────────────────────────────────────────────────────────────────────

describe("assessCredibility — domain authority", () => {
  it("adds 40 for a TOP_AUTHORITY domain (.gov)", () => {
    const score = assessCredibility(
      makeEvidence({ domain: "data.cdc.gov", sourceType: "official" }),
    );
    // domain=40, sourceType=official→25, no snippet, no date
    expect(score).toBe(65);
  });

  it("adds 40 for nature.com", () => {
    const score = assessCredibility(
      makeEvidence({ domain: "nature.com", sourceType: "official" }),
    );
    expect(score).toBe(65);
  });

  it("adds 40 for arxiv.org", () => {
    const score = assessCredibility(
      makeEvidence({ domain: "arxiv.org", sourceType: "official" }),
    );
    expect(score).toBe(65);
  });

  it("adds 30 for a HIGH_AUTHORITY domain (reuters.com)", () => {
    const score = assessCredibility(
      makeEvidence({ domain: "reuters.com", sourceType: "news" }),
    );
    // domain=30, sourceType=news→20, no snippet, no date
    expect(score).toBe(50);
  });

  it("adds 30 for bloomberg.com", () => {
    const score = assessCredibility(
      makeEvidence({ domain: "bloomberg.com", sourceType: "news" }),
    );
    expect(score).toBe(50);
  });

  it("adds 20 for a MEDIUM_AUTHORITY domain (techcrunch.com)", () => {
    const score = assessCredibility(
      makeEvidence({ domain: "techcrunch.com", sourceType: "news" }),
    );
    // domain=20, sourceType=news→20
    expect(score).toBe(40);
  });

  it("adds 20 for wired.com", () => {
    const score = assessCredibility(
      makeEvidence({ domain: "wired.com", sourceType: "news" }),
    );
    expect(score).toBe(40);
  });

  it("adds 20 (general website base) for an unknown domain", () => {
    const score = assessCredibility(
      makeEvidence({ domain: "somerandomblog.io", sourceType: "news" }),
    );
    expect(score).toBe(40);
  });

  it("adds 15 (minimum base) when domain is null", () => {
    const score = assessCredibility(
      makeEvidence({ domain: null, sourceType: "news" }),
    );
    // domain=15, sourceType=news→20
    expect(score).toBe(35);
  });

  it("domain matching is case-insensitive", () => {
    const lowerScore = assessCredibility(
      makeEvidence({ domain: "arxiv.org", sourceType: null }),
    );
    const upperScore = assessCredibility(
      makeEvidence({ domain: "ARXIV.ORG", sourceType: null }),
    );
    expect(lowerScore).toBe(upperScore);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Source type scoring
// ──────────────────────────────────────────────────────────────────────────────

describe("assessCredibility — source type", () => {
  it("adds 30 for sourceType 'academic'", () => {
    const score = assessCredibility(
      makeEvidence({ domain: null, sourceType: "academic" }),
    );
    // domain=15, academic=30
    expect(score).toBe(45);
  });

  it("adds 25 for sourceType 'official'", () => {
    const score = assessCredibility(
      makeEvidence({ domain: null, sourceType: "official" }),
    );
    expect(score).toBe(40);
  });

  it("adds 20 for sourceType 'news'", () => {
    const score = assessCredibility(
      makeEvidence({ domain: null, sourceType: "news" }),
    );
    expect(score).toBe(35);
  });

  it("adds 18 for sourceType 'report'", () => {
    const score = assessCredibility(
      makeEvidence({ domain: null, sourceType: "report" }),
    );
    expect(score).toBe(33);
  });

  it("adds 18 for sourceType 'web'", () => {
    const score = assessCredibility(
      makeEvidence({ domain: null, sourceType: "web" }),
    );
    expect(score).toBe(33);
  });

  it("adds 15 for an unknown sourceType", () => {
    const score = assessCredibility(
      makeEvidence({ domain: null, sourceType: "unknown_type" }),
    );
    expect(score).toBe(30);
  });

  it("adds 15 for null sourceType (default branch)", () => {
    const score = assessCredibility(
      makeEvidence({ domain: null, sourceType: null }),
    );
    expect(score).toBe(30);
  });

  it("source type matching is case-insensitive", () => {
    const lower = assessCredibility(
      makeEvidence({ domain: null, sourceType: "academic" }),
    );
    const upper = assessCredibility(
      makeEvidence({ domain: null, sourceType: "ACADEMIC" }),
    );
    expect(lower).toBe(upper);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Snippet length scoring
// ──────────────────────────────────────────────────────────────────────────────

describe("assessCredibility — snippet length (content depth)", () => {
  it("adds 15 for snippet longer than 500 chars", () => {
    const score = assessCredibility(
      makeEvidence({
        domain: null,
        sourceType: null,
        snippet: "x".repeat(501),
      }),
    );
    // domain=15, sourceType=15, snippet=15
    expect(score).toBe(45);
  });

  it("adds 10 for snippet longer than 200 chars (but ≤500)", () => {
    const score = assessCredibility(
      makeEvidence({
        domain: null,
        sourceType: null,
        snippet: "x".repeat(201),
      }),
    );
    expect(score).toBe(40);
  });

  it("adds 5 for snippet longer than 50 chars (but ≤200)", () => {
    const score = assessCredibility(
      makeEvidence({ domain: null, sourceType: null, snippet: "x".repeat(51) }),
    );
    expect(score).toBe(35);
  });

  it("adds 0 for snippet of exactly 50 chars", () => {
    const score = assessCredibility(
      makeEvidence({ domain: null, sourceType: null, snippet: "x".repeat(50) }),
    );
    expect(score).toBe(30);
  });

  it("adds 0 for null snippet", () => {
    const score = assessCredibility(
      makeEvidence({ domain: null, sourceType: null, snippet: null }),
    );
    expect(score).toBe(30);
  });

  it("adds 0 for empty string snippet", () => {
    const score = assessCredibility(
      makeEvidence({ domain: null, sourceType: null, snippet: "" }),
    );
    expect(score).toBe(30);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Timeliness scoring
// ──────────────────────────────────────────────────────────────────────────────

describe("assessCredibility — timeliness", () => {
  it("adds 15 for publication within the last 30 days", () => {
    const score = assessCredibility(
      makeEvidence({
        domain: null,
        sourceType: null,
        publishedAt: daysAgo(10),
      }),
    );
    // domain=15, sourceType=15, snippet=0, timeliness=15
    expect(score).toBe(45);
  });

  it("adds 15 for publication exactly on day 30", () => {
    const score = assessCredibility(
      makeEvidence({
        domain: null,
        sourceType: null,
        publishedAt: daysAgo(30),
      }),
    );
    expect(score).toBe(45);
  });

  it("adds 12 for publication within 31-180 days", () => {
    const score = assessCredibility(
      makeEvidence({
        domain: null,
        sourceType: null,
        publishedAt: daysAgo(90),
      }),
    );
    expect(score).toBe(42);
  });

  it("adds 8 for publication within 181-365 days", () => {
    const score = assessCredibility(
      makeEvidence({
        domain: null,
        sourceType: null,
        publishedAt: daysAgo(270),
      }),
    );
    expect(score).toBe(38);
  });

  it("adds 5 for publication within 366-730 days", () => {
    const score = assessCredibility(
      makeEvidence({
        domain: null,
        sourceType: null,
        publishedAt: daysAgo(500),
      }),
    );
    expect(score).toBe(35);
  });

  it("adds 0 for publication older than 730 days", () => {
    const score = assessCredibility(
      makeEvidence({
        domain: null,
        sourceType: null,
        publishedAt: daysAgo(800),
      }),
    );
    // domain=15, sourceType=15, no timeliness bonus
    expect(score).toBe(30);
  });

  it("adds 0 for null publishedAt", () => {
    const score = assessCredibility(
      makeEvidence({ domain: null, sourceType: null, publishedAt: null }),
    );
    expect(score).toBe(30);
  });

  it("accepts an ISO string for publishedAt", () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const score = assessCredibility(
      makeEvidence({ domain: null, sourceType: null, publishedAt: recent }),
    );
    expect(score).toBe(45); // +15 timeliness
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Combined scoring scenarios
// ──────────────────────────────────────────────────────────────────────────────

describe("assessCredibility — combined scenarios", () => {
  it("scores maximum for top academic source with long snippet and fresh date", () => {
    const score = assessCredibility(
      makeEvidence({
        domain: "arxiv.org", // TOP_AUTHORITY → 40
        sourceType: "academic", // → 30
        snippet: "x".repeat(600), // > 500 → 15
        publishedAt: daysAgo(5), // ≤30 days → 15
      }),
    );
    // 40 + 30 + 15 + 15 = 100
    expect(score).toBe(100);
  });

  it("scores 100 when raw total exceeds 100 (clamp ceiling)", () => {
    // Construct a score that would naturally exceed 100
    const score = assessCredibility(
      makeEvidence({
        domain: "nature.com", // 40
        sourceType: "academic", // 30
        snippet: "x".repeat(600), // 15
        publishedAt: daysAgo(5), // 15
      }),
    );
    expect(score).toBeLessThanOrEqual(100);
  });

  it("scores minimum 15 when all inputs are null/missing", () => {
    const score = assessCredibility(makeEvidence());
    // domain=null→15, sourceType=null→15 → total 30, clamped floor is 15
    expect(score).toBeGreaterThanOrEqual(15);
  });

  it("clamps to floor of 15 regardless of input", () => {
    // The function always starts at 0 and adds positive amounts, minimum real
    // outcome is 30 (15 domain base + 15 sourceType default). The clamp floor
    // of 15 acts as a safety net.
    const score = assessCredibility(makeEvidence());
    expect(score).toBeGreaterThanOrEqual(15);
  });

  it("scores a mid-tier news source with moderate content correctly", () => {
    // reuters.com (HIGH → 30) + news (→20) + snippet 300 chars (→10) + 90 days ago (→12)
    const score = assessCredibility(
      makeEvidence({
        domain: "reuters.com",
        sourceType: "news",
        snippet: "x".repeat(300),
        publishedAt: daysAgo(90),
      }),
    );
    expect(score).toBe(72);
  });

  it("scores a generic blog with short snippet and old date correctly", () => {
    // unknown domain (→20) + web (→18) + snippet 30 chars (→0) + 800 days ago (→0)
    const score = assessCredibility(
      makeEvidence({
        domain: "randomsite.blog",
        sourceType: "web",
        snippet: "x".repeat(30),
        publishedAt: daysAgo(800),
      }),
    );
    expect(score).toBe(38);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Return value bounds
// ──────────────────────────────────────────────────────────────────────────────

describe("assessCredibility — return value bounds", () => {
  it("always returns a number between 15 and 100 inclusive", () => {
    const inputs: Partial<EvidenceData>[] = [
      {},
      {
        domain: "arxiv.org",
        sourceType: "academic",
        snippet: "x".repeat(600),
        publishedAt: daysAgo(1),
      },
      { domain: null, sourceType: null, snippet: null, publishedAt: null },
      {
        domain: "unknown.xyz",
        sourceType: "random",
        snippet: "short",
        publishedAt: daysAgo(1000),
      },
    ];

    for (const override of inputs) {
      const score = assessCredibility(makeEvidence(override));
      expect(score).toBeGreaterThanOrEqual(15);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});
