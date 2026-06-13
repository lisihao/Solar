import { evaluateSearchQuality } from "../quality-gate.utils";

describe("evaluateSearchQuality", () => {
  const items = [
    {
      sourceType: "web",
      publishedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    },
    {
      sourceType: "academic",
      publishedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    },
    {
      sourceType: "academic",
      publishedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    },
  ];

  it("returns sufficient=true when all gates pass", () => {
    const v = evaluateSearchQuality(
      {
        items,
        sources: ["web", "academic"],
        sourceCounts: { web: 1, academic: 2 },
      },
      { requestedSources: ["web", "academic"] },
    );
    expect(v.sufficient).toBe(true);
    expect(v.gaps).toHaveLength(0);
  });

  it("flags insufficient results below minResults", () => {
    const v = evaluateSearchQuality(
      { items: items.slice(0, 1), sources: ["web"] },
      { requestedSources: ["web"], minResults: 5 },
    );
    expect(v.sufficient).toBe(false);
    expect(v.suggestedActions).toContain("add_web_fallback");
  });

  it("flags low source diversity (<2 types)", () => {
    const onlyWeb = [
      { sourceType: "web" },
      { sourceType: "web" },
      { sourceType: "web" },
    ];
    const v = evaluateSearchQuality(
      { items: onlyWeb, sources: ["web"] },
      { requestedSources: ["web"] },
    );
    expect(v.suggestedActions).toContain("broaden_query");
  });

  it("flags low freshness (<20% items in last 6 months)", () => {
    const stale = [
      { sourceType: "web", publishedAt: new Date("2020-01-01") },
      { sourceType: "academic", publishedAt: new Date("2019-01-01") },
      { sourceType: "academic", publishedAt: new Date("2018-01-01") },
    ];
    const v = evaluateSearchQuality(
      { items: stale, sources: ["web", "academic"] },
      { requestedSources: ["web", "academic"] },
    );
    expect(v.suggestedActions).toContain("extend_time_range");
  });

  it("flags missing academic when requireAcademic", () => {
    const noAcademic = [
      { sourceType: "web", publishedAt: new Date() },
      { sourceType: "blog", publishedAt: new Date() },
      { sourceType: "news", publishedAt: new Date() },
    ];
    const v = evaluateSearchQuality(
      { items: noAcademic, sources: ["web", "blog", "news"] },
      {
        requestedSources: ["web", "blog", "news"],
        requireAcademic: true,
        academicSourceTypes: new Set(["academic", "preprint"]),
      },
    );
    expect(v.suggestedActions).toContain("add_academic_source");
  });

  it("flags failed source ratio > 50%", () => {
    const v = evaluateSearchQuality(
      {
        items: [
          { sourceType: "web", publishedAt: new Date() },
          { sourceType: "web", publishedAt: new Date() },
          { sourceType: "web", publishedAt: new Date() },
        ],
        sources: ["web"],
        sourceCounts: { web: 3, academic: 0, news: 0 },
      },
      { requestedSources: ["web", "academic", "news"] },
    );
    expect(v.suggestedActions).toContain("retry");
  });

  it("returns multiple gaps when several fail simultaneously", () => {
    const v = evaluateSearchQuality(
      { items: [], sources: [] },
      { requestedSources: ["web", "academic"], minResults: 5 },
    );
    expect(v.gaps.length).toBeGreaterThan(1);
  });
});
