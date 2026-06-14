/**
 * evidence-summary.utils — Business Simulation Tests
 *
 * Simulates real production data patterns observed in DB:
 * - Mixed figure types (chart/photo/diagram) with empty captions
 * - Decorative news images (whitehouse banners, stock photos)
 * - Valid informational charts (Fed data, Pew Research surveys)
 * - Deduplication of same image across multiple evidences
 * - Caption fallback chain: fig.caption → fig.alt → evidence.title + type suffix
 */

import {
  createEvidenceSummary,
  buildFiguresSummary,
} from "../evidence-summary.utils";
import type {
  EnrichedEvidenceData,
  EvidenceData,
  ExtractedFigure,
} from "../../../types/research.types";

// ============================================================
// Helpers — Production-realistic data factories
// ============================================================

const makeEvidence = (
  overrides: Partial<EnrichedEvidenceData> = {},
): EnrichedEvidenceData => ({
  id: `ev-${Math.random().toString(36).slice(2, 8)}`,
  title: "AI Policy Update 2026",
  url: "https://example.com/article",
  domain: "example.com",
  snippet: "Sample snippet",
  sourceType: "web",
  publishedAt: "2026-01-15",
  credibilityScore: 0.8,
  ...overrides,
});

const makeFigure = (
  overrides: Partial<ExtractedFigure> = {},
): ExtractedFigure => ({
  imageUrl: "https://example.com/image.png",
  caption: "Sample chart",
  type: "chart",
  ...overrides,
});

// ============================================================
// Production data: mirrors real DB patterns from 39-chart report
// ============================================================

/** Decorative news images that should NOT get meaningful captions */
const DECORATIVE_FIGURES: ExtractedFigure[] = [
  {
    imageUrl: "https://www.whitehouse.gov/Wire-Banner.jpg",
    caption: "",
    type: "photo",
    alt: "",
  },
  {
    imageUrl: "https://cdn.cfr.org/sites/default/files/image/champagne.jpg",
    caption: "",
    type: "photo",
    alt: "Champagne celebration",
  },
  {
    imageUrl: "https://cdn.arstechnica.net/anthropicstandoff.jpg",
    caption: "",
    type: "photo",
    alt: "",
  },
];

/** Informational charts with proper captions */
const INFORMATIONAL_FIGURES: ExtractedFigure[] = [
  {
    imageUrl: "https://fred.stlouisfed.org/graph/fredgraph.png?g=abc",
    caption: "Federal Funds Rate 2020-2026",
    type: "chart",
    alt: "Line chart showing interest rate trends",
  },
  {
    imageUrl: "https://www.pewresearch.org/wp-content/uploads/survey-chart.png",
    caption: "Public Opinion on AI Regulation",
    type: "chart",
    alt: "Bar chart of survey results",
  },
  {
    imageUrl: "https://example.com/architecture-diagram.svg",
    caption: "",
    type: "diagram",
    alt: "System architecture overview",
  },
];

// ============================================================
// createEvidenceSummary
// ============================================================

describe("createEvidenceSummary", () => {
  it("should format evidence list with source types and domains", () => {
    const evidences: EvidenceData[] = [
      makeEvidence({
        title: "White House AI Executive Order",
        sourceType: "government",
        domain: "whitehouse.gov",
      }),
      makeEvidence({
        title: "Gartner Hype Cycle 2026",
        sourceType: "industry_report",
        domain: "gartner.com",
      }),
    ];

    const result = createEvidenceSummary(evidences);

    expect(result).toContain("共收集到 2 条证据");
    expect(result).toContain("[government] White House AI Executive Order");
    expect(result).toContain("(whitehouse.gov)");
    expect(result).toContain("[industry_report] Gartner Hype Cycle 2026");
  });

  it("should truncate at 10 items and show remainder count", () => {
    const evidences = Array.from({ length: 15 }, (_, i) =>
      makeEvidence({ title: `Evidence ${i + 1}` }),
    );

    const result = createEvidenceSummary(evidences);

    expect(result).toContain("共收集到 15 条证据");
    expect(result).toContain("Evidence 10");
    expect(result).not.toContain("Evidence 11");
    expect(result).toContain("还有 5 条");
  });

  it("should handle null domain and sourceType gracefully", () => {
    const evidences: EvidenceData[] = [
      makeEvidence({ title: "Unknown Source", domain: null, sourceType: null }),
    ];

    const result = createEvidenceSummary(evidences);

    expect(result).toContain("[web]");
    expect(result).toContain("(未知来源)");
  });
});

// ============================================================
// buildFiguresSummary — Core business logic
// ============================================================

describe("buildFiguresSummary", () => {
  // ----------------------------------------------------------
  // Basic functionality
  // ----------------------------------------------------------

  it("should return empty summary when no figures exist", () => {
    const evidences = [makeEvidence({ extractedFigures: [] })];
    const { summary, figureRegistry } = buildFiguresSummary(evidences);

    expect(summary).toBe("");
    expect(figureRegistry.size).toBe(0);
  });

  it("should return empty summary when evidences have no extractedFigures", () => {
    const evidences = [makeEvidence()];
    const { summary, figureRegistry } = buildFiguresSummary(evidences);

    expect(summary).toBe("");
    expect(figureRegistry.size).toBe(0);
  });

  // ----------------------------------------------------------
  // Caption fallback chain (v10 enhancement)
  // ----------------------------------------------------------

  describe("caption fallback chain", () => {
    it("should use fig.caption when available", () => {
      const evidences = [
        makeEvidence({
          title: "Fed Rate Analysis",
          extractedFigures: [
            makeFigure({
              caption: "Federal Funds Rate 2020-2026",
              alt: "Interest rate chart",
              type: "chart",
            }),
          ],
        }),
      ];

      const { figureRegistry } = buildFiguresSummary(evidences);

      const entry = figureRegistry.get("FIG-1");
      expect(entry?.caption).toBe("Federal Funds Rate 2020-2026");
    });

    it("should fall back to fig.alt when caption is empty", () => {
      const evidences = [
        makeEvidence({
          title: "Fed Rate Analysis",
          extractedFigures: [
            makeFigure({
              caption: "",
              alt: "Line chart showing interest rate trends",
              type: "chart",
            }),
          ],
        }),
      ];

      const { figureRegistry } = buildFiguresSummary(evidences);

      const entry = figureRegistry.get("FIG-1");
      expect(entry?.caption).toBe("Line chart showing interest rate trends");
    });

    it("should fall back to evidence.title + type suffix when both caption and alt are empty (chart type)", () => {
      const evidences = [
        makeEvidence({
          title: "Federal Reserve Interest Rate Decision",
          extractedFigures: [
            makeFigure({
              imageUrl: "https://fred.stlouisfed.org/graph.png",
              caption: "",
              alt: "",
              type: "chart",
            }),
          ],
        }),
      ];

      const { figureRegistry } = buildFiguresSummary(evidences);

      const entry = figureRegistry.get("FIG-1");
      expect(entry?.caption).toBe(
        "Federal Reserve Interest Rate Decision — 图表",
      );
    });

    it("should return empty caption for photo type with no caption/alt (v11)", () => {
      const evidences = [
        makeEvidence({
          title: "White House AI Policy Briefing",
          extractedFigures: [
            makeFigure({
              imageUrl: "https://whitehouse.gov/banner.jpg",
              caption: "",
              alt: "",
              type: "photo",
            }),
          ],
        }),
      ];

      const { figureRegistry } = buildFiguresSummary(evidences);

      const entry = figureRegistry.get("FIG-1");
      expect(entry?.caption).toBe(""); // v11: photo type with empty caption+alt → empty string
    });

    it("should produce empty caption when evidence title is also empty", () => {
      const evidences = [
        makeEvidence({
          title: "",
          extractedFigures: [
            makeFigure({
              imageUrl: "https://example.com/image.png",
              caption: "",
              alt: "",
              type: "photo",
            }),
          ],
        }),
      ];

      const { figureRegistry } = buildFiguresSummary(evidences);

      const entry = figureRegistry.get("FIG-1");
      expect(entry?.caption).toBe("");
    });
  });

  // ----------------------------------------------------------
  // Production simulation: mixed decorative + informational
  // ----------------------------------------------------------

  describe("production data simulation", () => {
    it("should handle mixed decorative and informational figures from real evidence patterns", () => {
      const evidences: EnrichedEvidenceData[] = [
        // Evidence 1: White House — decorative banner + no useful alt
        makeEvidence({
          title: "White House Executive Order on AI Safety",
          domain: "whitehouse.gov",
          extractedFigures: [DECORATIVE_FIGURES[0]], // Wire-Banner.jpg, empty caption+alt
        }),
        // Evidence 2: St. Louis Fed — informational chart
        makeEvidence({
          title: "Federal Reserve Economic Data",
          domain: "fred.stlouisfed.org",
          extractedFigures: [INFORMATIONAL_FIGURES[0]], // fredgraph.png with caption
        }),
        // Evidence 3: CFR — decorative photo with alt
        makeEvidence({
          title: "Council on Foreign Relations: AI Diplomacy",
          domain: "cfr.org",
          extractedFigures: [DECORATIVE_FIGURES[1]], // champagne.jpg
        }),
        // Evidence 4: Pew Research — informational chart
        makeEvidence({
          title: "Pew Research Center Survey",
          domain: "pewresearch.org",
          extractedFigures: [INFORMATIONAL_FIGURES[1]], // survey-chart.png
        }),
      ];

      const { summary, figureRegistry } = buildFiguresSummary(evidences);

      // All 4 figures registered (filtering happens later in FigureRelevanceService)
      expect(figureRegistry.size).toBe(4);

      // Verify caption quality
      const fig1 = figureRegistry.get("FIG-1")!;
      expect(fig1.type).toBe("photo");
      // v11: photo type with empty caption+alt → empty string (no fake "配图" caption)
      expect(fig1.caption).toBe("");

      const fig2 = figureRegistry.get("FIG-2")!;
      expect(fig2.type).toBe("chart");
      expect(fig2.caption).toBe("Federal Funds Rate 2020-2026"); // has its own caption

      const fig3 = figureRegistry.get("FIG-3")!;
      expect(fig3.type).toBe("photo");
      expect(fig3.caption).toBe("Champagne celebration"); // falls back to alt

      const fig4 = figureRegistry.get("FIG-4")!;
      expect(fig4.type).toBe("chart");
      expect(fig4.caption).toBe("Public Opinion on AI Regulation");

      // Summary should contain allocation guidance
      expect(summary).toContain("图表分配原则");
      expect(summary).toContain("数据图表");
      expect(summary).toContain("共 4 个可用图表");
    });

    it("should deduplicate figures with same imageUrl across evidences", () => {
      const sharedUrl = "https://fred.stlouisfed.org/graph/fredgraph.png?g=abc";
      const evidences: EnrichedEvidenceData[] = [
        makeEvidence({
          title: "Evidence A",
          extractedFigures: [
            makeFigure({
              imageUrl: sharedUrl,
              caption: "Fed Funds Rate",
              type: "chart",
            }),
          ],
        }),
        makeEvidence({
          title: "Evidence B",
          extractedFigures: [
            makeFigure({
              imageUrl: sharedUrl, // same URL
              caption: "Federal Funds Rate",
              type: "chart",
            }),
          ],
        }),
      ];

      const { figureRegistry } = buildFiguresSummary(evidences);

      // Only 1 entry — second occurrence deduplicated
      expect(figureRegistry.size).toBe(1);
      const entry = figureRegistry.get("FIG-1")!;
      expect(entry.caption).toBe("Fed Funds Rate"); // keeps first occurrence
    });

    it("should skip invalid URLs (base64, placeholders, PDFs)", () => {
      const evidences: EnrichedEvidenceData[] = [
        makeEvidence({
          title: "Test Evidence",
          extractedFigures: [
            makeFigure({
              imageUrl: "data:image/png;base64,iVBOR...",
              caption: "Base64 image",
              type: "chart",
            }),
            makeFigure({
              imageUrl: "https://example.com/valid-chart.png",
              caption: "Valid chart",
              type: "chart",
            }),
          ],
        }),
      ];

      const { figureRegistry } = buildFiguresSummary(evidences);

      // Only the valid URL should be registered
      expect(figureRegistry.size).toBe(1);
      expect(figureRegistry.get("FIG-1")?.imageUrl).toBe(
        "https://example.com/valid-chart.png",
      );
    });

    it("should cap displayed entries at MAX_FIGURES_FOR_LEADER (40)", () => {
      const evidences: EnrichedEvidenceData[] = [
        makeEvidence({
          title: "Many Figures Evidence",
          extractedFigures: Array.from({ length: 45 }, (_, i) =>
            makeFigure({
              imageUrl: `https://example.com/chart-${i}.png`,
              caption: `Chart ${i + 1}`,
              type: "chart",
            }),
          ),
        }),
      ];

      const { summary, figureRegistry } = buildFiguresSummary(evidences);

      expect(figureRegistry.size).toBe(45);
      expect(summary).toContain(
        "共 45 个可用图表（展示前 40 个，数据图表优先）",
      );
      expect(summary).toContain("还有 5 个图表未列出");
    });
  });

  // ----------------------------------------------------------
  // Figure registry metadata
  // ----------------------------------------------------------

  describe("figure registry metadata", () => {
    it("should correctly populate evidenceIndex and figureIndex", () => {
      const evidences: EnrichedEvidenceData[] = [
        makeEvidence({
          title: "First Evidence",
          extractedFigures: [
            makeFigure({ imageUrl: "https://example.com/a.png" }),
            makeFigure({ imageUrl: "https://example.com/b.png" }),
          ],
        }),
        makeEvidence({
          title: "Second Evidence",
          extractedFigures: [
            makeFigure({ imageUrl: "https://example.com/c.png" }),
          ],
        }),
      ];

      const { figureRegistry } = buildFiguresSummary(evidences);

      // FIG-1: evidence[0], figure[0] → evidenceIndex=1 (1-based), figureIndex=0
      expect(figureRegistry.get("FIG-1")?.evidenceIndex).toBe(1);
      expect(figureRegistry.get("FIG-1")?.figureIndex).toBe(0);
      // FIG-2: evidence[0], figure[1]
      expect(figureRegistry.get("FIG-2")?.evidenceIndex).toBe(1);
      expect(figureRegistry.get("FIG-2")?.figureIndex).toBe(1);
      // FIG-3: evidence[1], figure[0] → evidenceIndex=2
      expect(figureRegistry.get("FIG-3")?.evidenceIndex).toBe(2);
      expect(figureRegistry.get("FIG-3")?.figureIndex).toBe(0);
    });

    it("should store evidenceTitle and evidenceDomain", () => {
      const evidences: EnrichedEvidenceData[] = [
        makeEvidence({
          title: "Federal Reserve Economic Data",
          domain: "fred.stlouisfed.org",
          extractedFigures: [
            makeFigure({ imageUrl: "https://fred.stlouisfed.org/graph.png" }),
          ],
        }),
      ];

      const { figureRegistry } = buildFiguresSummary(evidences);

      const entry = figureRegistry.get("FIG-1")!;
      expect(entry.evidenceTitle).toBe("Federal Reserve Economic Data");
      expect(entry.evidenceDomain).toBe("fred.stlouisfed.org");
    });

    it("should handle undefined domain gracefully", () => {
      const evidences: EnrichedEvidenceData[] = [
        makeEvidence({
          title: "No Domain Evidence",
          domain: null,
          extractedFigures: [
            makeFigure({ imageUrl: "https://example.com/chart.png" }),
          ],
        }),
      ];

      const { figureRegistry } = buildFiguresSummary(evidences);

      expect(figureRegistry.get("FIG-1")?.evidenceDomain).toBeUndefined();
    });
  });

  // ----------------------------------------------------------
  // Allocation guidance control
  // ----------------------------------------------------------

  describe("allocation guidance", () => {
    const evidenceWithFigure: EnrichedEvidenceData[] = [
      makeEvidence({
        extractedFigures: [
          makeFigure({ imageUrl: "https://example.com/chart.png" }),
        ],
      }),
    ];

    it("should include guidance by default", () => {
      const { summary } = buildFiguresSummary(evidenceWithFigure);

      expect(summary).toContain("图表分配原则");
      expect(summary).toContain("才分配 0 张");
      expect(summary).toContain("纯装饰性新闻配图不分配");
    });

    it("should exclude guidance when includeGuidance=false", () => {
      const { summary } = buildFiguresSummary(evidenceWithFigure, false);

      expect(summary).not.toContain("图表分配原则");
      // Still has the figure list
      expect(summary).toContain("共 1 个可用图表");
    });
  });

  // ----------------------------------------------------------
  // Summary text format
  // ----------------------------------------------------------

  describe("summary text format", () => {
    it("should include type, caption, evidence source, and URL in summary lines", () => {
      const evidences: EnrichedEvidenceData[] = [
        makeEvidence({
          title: "Fed Analysis Report",
          extractedFigures: [
            makeFigure({
              imageUrl: "https://fred.stlouisfed.org/chart.png",
              caption: "Interest Rate Trends",
              type: "chart",
            }),
          ],
        }),
      ];

      const { summary } = buildFiguresSummary(evidences);

      // Check summary line format: "图表 FIG-1: chart - "Interest Rate Trends" (来源: 证据[1] Fed Analysis Report) (URL: ...)"
      expect(summary).toContain("图表 FIG-1");
      expect(summary).toContain("chart");
      expect(summary).toContain("Interest Rate Trends");
      expect(summary).toContain("来源: 证据[1]");
      expect(summary).toContain("Fed Analysis Report");
      expect(summary).toContain("URL: https://fred.stlouisfed.org/chart.png");
    });

    it("should show '无标题' when all caption fallbacks are empty", () => {
      const evidences: EnrichedEvidenceData[] = [
        makeEvidence({
          title: "",
          extractedFigures: [
            makeFigure({
              imageUrl: "https://example.com/mystery.png",
              caption: "",
              alt: "",
              type: "photo",
            }),
          ],
        }),
      ];

      const { summary } = buildFiguresSummary(evidences);

      expect(summary).toContain("无标题");
    });
  });
});
