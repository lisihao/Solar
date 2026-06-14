import {
  normalizeUrl,
  dedupeByUrlAndTitle,
  tokenizeQuery,
  computeRelevanceScore,
  extractDomain,
  enforceDomainDiversity,
} from "../result-fusion.utils";

describe("normalizeUrl", () => {
  it("strips trailing slash and hash", () => {
    expect(normalizeUrl("https://example.com/page/#section1")).toBe(
      "https://example.com/page",
    );
  });

  it("strips utm_*/fbclid tracking params", () => {
    expect(
      normalizeUrl(
        "https://example.com/p?utm_source=x&fbclid=abc&id=42&utm_medium=mail",
      ),
    ).toBe("https://example.com/p?id=42");
  });

  it("lowercases hostname", () => {
    expect(normalizeUrl("https://Example.COM/p")).toBe("https://example.com/p");
  });

  it("falls back gracefully for malformed URL", () => {
    expect(normalizeUrl("not-a-url/")).toBe("not-a-url");
    expect(normalizeUrl("")).toBe("");
  });
});

describe("dedupeByUrlAndTitle", () => {
  it("dedupes by normalized URL", () => {
    const items = [
      { url: "https://a.com/p", title: "A" },
      { url: "https://A.COM/p#x", title: "A2" },
      { url: "https://b.com/p", title: "B" },
    ];
    expect(dedupeByUrlAndTitle(items)).toHaveLength(2);
  });

  it("dedupes by title token set after URL pass", () => {
    const items = [
      { url: "https://a.com/p1", title: "AI Trends 2025" },
      { url: "https://b.com/p2", title: "Trends AI 2025" }, // 同词集 → 视为重复
      { url: "https://c.com/p3", title: "Different topic" },
    ];
    const out = dedupeByUrlAndTitle(items);
    expect(out).toHaveLength(2);
  });

  it("keeps items without title", () => {
    const items = [
      { url: "https://a.com/p", title: "" },
      { url: "https://b.com/p", title: "" },
    ];
    expect(dedupeByUrlAndTitle(items)).toHaveLength(2);
  });
});

describe("tokenizeQuery", () => {
  it("removes stop words and short tokens", () => {
    expect(tokenizeQuery("the quick brown a fox")).toEqual([
      "quick",
      "brown",
      "fox",
    ]);
  });

  it("strips site:filter / OR / quotes", () => {
    expect(
      tokenizeQuery('"quantum computing" site:nature.com OR arxiv'),
    ).toContain("quantum");
    expect(
      tokenizeQuery('"quantum computing" site:nature.com OR arxiv'),
    ).not.toContain("site:nature.com");
  });

  it("preserves CJK", () => {
    expect(tokenizeQuery("人工智能 趋势")).toEqual(["人工智能", "趋势"]);
  });

  it("dedupes repeated terms", () => {
    expect(tokenizeQuery("ai ai ai ml")).toEqual(["ai", "ml"]);
  });
});

describe("computeRelevanceScore", () => {
  const item = {
    url: "https://x.com/a",
    title: "AI in healthcare 2025",
    snippet: "Discusses AI applications in healthcare and medicine",
  };

  it("scores 0.5 for empty query", () => {
    expect(computeRelevanceScore(item, "")).toBe(0.5);
  });

  it("higher score for title match than snippet match", () => {
    const titleHit = computeRelevanceScore(
      { url: "x", title: "AI healthcare 2025", snippet: "" },
      "AI healthcare",
    );
    const snippetHit = computeRelevanceScore(
      { url: "x", title: "Other", snippet: "AI healthcare" },
      "AI healthcare",
    );
    expect(titleHit).toBeGreaterThan(snippetHit);
  });

  it("bonus for exact phrase match in title", () => {
    const exact = computeRelevanceScore(
      {
        url: "x",
        title: "machine learning fundamentals course",
        snippet:
          "A comprehensive overview of machine learning fundamentals across modern AI applications and historical context provided in detail",
      },
      "machine learning fundamentals",
    );
    expect(exact).toBeGreaterThan(0.5);
  });

  it("penalty for short snippet+title combined", () => {
    const short = computeRelevanceScore(
      { url: "x", title: "AI", snippet: "" },
      "AI",
    );
    expect(short).toBeLessThanOrEqual(0.5);
  });
});

describe("extractDomain", () => {
  it("strips www.", () => {
    expect(extractDomain("https://www.example.com/p")).toBe("example.com");
  });

  it("returns empty for invalid", () => {
    expect(extractDomain("")).toBe("");
    expect(extractDomain("not-a-url")).toBe("");
  });
});

describe("enforceDomainDiversity", () => {
  it("limits items per domain", () => {
    const items = [
      { url: "https://a.com/1", title: "A1" },
      { url: "https://a.com/2", title: "A2" },
      { url: "https://a.com/3", title: "A3" },
      { url: "https://a.com/4", title: "A4" },
      { url: "https://b.com/1", title: "B1" },
    ];
    const out = enforceDomainDiversity(items, 2);
    expect(out).toHaveLength(3); // a.com 2 + b.com 1
    expect(out.map((i) => i.title)).toEqual(["A1", "A2", "B1"]);
  });

  it("uses provided domain field when present", () => {
    const items = [
      { url: "https://a.com/1", title: "A1", domain: "x.com" },
      { url: "https://b.com/1", title: "B1", domain: "x.com" },
    ];
    expect(enforceDomainDiversity(items, 1)).toHaveLength(1);
  });
});
