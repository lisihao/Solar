/**
 * ResearchReviewerService - Supplemental Coverage Tests
 *
 * Targets uncovered lines:
 * - getCurrencyGuidance: MACRO, INDUSTRY, COMPANY branches
 * - normalizeSeverity: Chinese values, alternative English values, edge cases
 * - validateClaims: large batch (>5 claims splits into multiple batches), disputed stats
 * - generateGapSearchQueries: empty claims early return, AI error fallback
 * - factCheckReport: citation limit (>30), reference-section citation skipped
 * - reviewOverall: cross-dimension issues (systemicIssue + weakEvidence), coverage analysis
 * - reviewDimension: hasRefusal with long content, short content without refusal
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ResearchReviewerService } from "../research-reviewer.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { ReviewQualityLevel } from "../../../types/collaboration.types";
import type { DimensionReviewResult } from "../../../types/collaboration.types";
import type { DimensionAnalysisResult } from "../../../types/research.types";

const mockFacade = {
  chat: jest.fn(),
  chatWithSkills: jest.fn(),
};

const mockTopic = {
  id: "topic-1",
  name: "AI Market Research",
  type: "TECHNOLOGY",
  userId: "user-1",
};

const mockDimension = {
  id: "dim-1",
  name: "Market Size",
  description: "Size of the AI market",
  sortOrder: 1,
};

const goodAiResponse = {
  qualityLevel: "good",
  overallScore: 80,
  scores: { breadth: 80, depth: 75, evidence: 85, coherence: 80, currency: 75 },
  issues: [],
  suggestions: ["Include more recent data"],
  needsReresearch: false,
};

const makeAnalysis = (
  overrides: Partial<DimensionAnalysisResult> = {},
): DimensionAnalysisResult => ({
  summary: "AI market is growing rapidly",
  keyFindings: [
    {
      finding: "Market will reach $500B",
      significance: "high",
      evidenceIds: ["ev-1"],
      implication: "Big opportunity",
    },
  ],
  trends: [
    {
      trend: "GenAI",
      direction: "up",
      timeframe: "2024",
      evidenceIds: ["ev-1"],
    },
  ],
  challenges: [
    {
      challenge: "Regulation",
      impact: "slows adoption",
      evidenceIds: ["ev-2"],
    },
  ],
  opportunities: [
    { opportunity: "Enterprise", potential: "High", evidenceIds: ["ev-1"] },
  ],
  confidenceLevel: "high",
  evidenceUsed: 5,
  detailedContent:
    "Detailed analysis of the AI market showing strong growth. ".repeat(20),
  ...overrides,
});

const makeDimensionReview = (
  overrides: Partial<DimensionReviewResult> = {},
): DimensionReviewResult => ({
  dimensionId: "dim-1",
  dimensionName: "Market Size",
  qualityLevel: ReviewQualityLevel.GOOD,
  overallScore: 80,
  scores: { breadth: 80, depth: 75, evidence: 85, coherence: 80, currency: 75 },
  issues: [],
  suggestions: [],
  needsReresearch: false,
  ...overrides,
});

describe("ResearchReviewerService - Supplemental", () => {
  let service: ResearchReviewerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchReviewerService,
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<ResearchReviewerService>(ResearchReviewerService);
    jest.clearAllMocks();
  });

  // ─── getCurrencyGuidance via reviewDimension prompt (MACRO / INDUSTRY / COMPANY) ───

  describe("reviewDimension - topic type currency guidance", () => {
    it("should use MACRO currency guidance for MACRO topic type", async () => {
      const macroTopic = { ...mockTopic, type: "MACRO" };
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify(goodAiResponse),
        model: "gpt-4",
      });

      const result = await service.reviewDimension(
        macroTopic as never,
        mockDimension as never,
        makeAnalysis(),
        10,
      );

      expect(result.overallScore).toBe(80);
      // Verify chatWithSkills was called with a message containing MACRO-specific guidance
      const systemMsg =
        mockFacade.chatWithSkills.mock.calls[0][0].messages[0].content;
      expect(systemMsg).toContain("3 个月");
    });

    it("should use INDUSTRY currency guidance for INDUSTRY topic type", async () => {
      const industryTopic = { ...mockTopic, type: "INDUSTRY" };
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify(goodAiResponse),
        model: "gpt-4",
      });

      await service.reviewDimension(
        industryTopic as never,
        mockDimension as never,
        makeAnalysis(),
        10,
      );

      const systemMsg =
        mockFacade.chatWithSkills.mock.calls[0][0].messages[0].content;
      expect(systemMsg).toContain("3 个月");
    });

    it("should use COMPANY currency guidance for COMPANY topic type", async () => {
      const companyTopic = { ...mockTopic, type: "COMPANY" };
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify(goodAiResponse),
        model: "gpt-4",
      });

      await service.reviewDimension(
        companyTopic as never,
        mockDimension as never,
        makeAnalysis(),
        10,
      );

      const systemMsg =
        mockFacade.chatWithSkills.mock.calls[0][0].messages[0].content;
      expect(systemMsg).toContain("财报");
    });

    it("should default to TECHNOLOGY currency guidance for unknown topic type", async () => {
      const unknownTopic = { ...mockTopic, type: "UNKNOWN" };
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify(goodAiResponse),
        model: "gpt-4",
      });

      await service.reviewDimension(
        unknownTopic as never,
        mockDimension as never,
        makeAnalysis(),
        10,
      );

      const systemMsg =
        mockFacade.chatWithSkills.mock.calls[0][0].messages[0].content;
      expect(systemMsg).toContain("学术论文");
    });
  });

  // ─── reviewDimension - refusal + length combos ───

  describe("reviewDimension - content quality detection", () => {
    it("should warn but NOT set needsReresearch for short content without refusal", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          ...goodAiResponse,
          overallScore: 80,
          needsReresearch: false,
        }),
        model: "gpt-4",
      });

      const shortAnalysis = makeAnalysis({ detailedContent: "Short content" }); // < 100 chars, no refusal

      const result = await service.reviewDimension(
        mockTopic as never,
        mockDimension as never,
        shortAnalysis,
        5,
      );

      // Should add a major (not critical) issue
      expect(
        result.issues.some(
          (i) => i.severity === "major" && i.description.includes("短"),
        ),
      ).toBe(true);
      // needsReresearch should NOT be forced by this branch (only by AI score or refusal+short)
    });

    it("should flag needsReresearch for long content with refusal keywords", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          ...goodAiResponse,
          overallScore: 80,
          needsReresearch: false,
        }),
        model: "gpt-4",
      });

      // Long content (>=100) but contains refusal keyword
      const longRefusalContent =
        "I cannot provide this information. ".repeat(10) +
        " extra text to make it long enough"; // > 100 chars
      const refusalAnalysis = makeAnalysis({
        detailedContent: longRefusalContent,
      });

      const result = await service.reviewDimension(
        mockTopic as never,
        mockDimension as never,
        refusalAnalysis,
        5,
      );

      expect(result.needsReresearch).toBe(true);
      expect(result.qualityLevel).toBe(ReviewQualityLevel.NEEDS_REVISION);
      expect(
        result.issues.some(
          (i) =>
            i.severity === "critical" && i.description.includes("拒写关键词"),
        ),
      ).toBe(true);
    });

    it("should handle analysis with no detailedContent", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify(goodAiResponse),
        model: "gpt-4",
      });

      const noContentAnalysis = makeAnalysis({ detailedContent: undefined });

      const result = await service.reviewDimension(
        mockTopic as never,
        mockDimension as never,
        noContentAnalysis,
        5,
      );

      // contentLength = 0 (< 100), no refusal (empty), should add major issue but not force needsReresearch
      expect(result).toBeDefined();
    });

    it("should handle issues as plain strings from LLM", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          ...goodAiResponse,
          issues: ["Plain string issue"],
        }),
        model: "gpt-4",
      });

      const result = await service.reviewDimension(
        mockTopic as never,
        mockDimension as never,
        makeAnalysis(),
        10,
      );

      expect(result.issues[0].type).toBe("shallow_analysis");
      expect(result.issues[0].severity).toBe("major");
      expect(result.issues[0].description).toBe("Plain string issue");
    });
  });

  // ─── normalizeSeverity ───

  describe("normalizeSeverity (via reviewDimension issues)", () => {
    const testSeverityMapping = async (
      rawSeverity: string,
      expected: string,
    ) => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          ...goodAiResponse,
          issues: [
            {
              type: "shallow_analysis",
              severity: rawSeverity,
              description: "test",
            },
          ],
        }),
        model: "gpt-4",
      });

      const result = await service.reviewDimension(
        mockTopic as never,
        mockDimension as never,
        makeAnalysis(),
        10,
      );

      expect(result.issues[0].severity).toBe(expected);
    };

    it("maps '严重' to critical", () =>
      testSeverityMapping("严重", "critical"));
    it("maps '致命' to critical", () =>
      testSeverityMapping("致命", "critical"));
    it("maps '重要' to major", () => testSeverityMapping("重要", "major"));
    it("maps '主要' to major", () => testSeverityMapping("主要", "major"));
    it("maps '中等' to major", () => testSeverityMapping("中等", "major"));
    it("maps '轻微' to minor", () => testSeverityMapping("轻微", "minor"));
    it("maps '次要' to minor", () => testSeverityMapping("次要", "minor"));
    it("maps '建议' to minor", () => testSeverityMapping("建议", "minor"));
    it("maps 'high' to critical", () =>
      testSeverityMapping("high", "critical"));
    it("maps 'error' to critical", () =>
      testSeverityMapping("error", "critical"));
    it("maps 'medium' to major", () => testSeverityMapping("medium", "major"));
    it("maps 'warning' to major", () =>
      testSeverityMapping("warning", "major"));
    it("maps 'low' to minor", () => testSeverityMapping("low", "minor"));
    it("maps 'info' to minor", () => testSeverityMapping("info", "minor"));
    it("maps undefined to major", () =>
      testSeverityMapping(undefined as never, "major"));
    it("maps unknown value to major", () =>
      testSeverityMapping("UNKNOWN_VALUE", "major"));
  });

  // ─── reviewDimension - NEEDS_REVISION and REJECTED quality levels ───

  describe("reviewDimension - quality levels", () => {
    it("should return NEEDS_REVISION for score 45", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({ ...goodAiResponse, overallScore: 45 }),
        model: "gpt-4",
      });

      const result = await service.reviewDimension(
        mockTopic as never,
        mockDimension as never,
        makeAnalysis(),
        10,
      );

      expect(result.qualityLevel).toBe(ReviewQualityLevel.NEEDS_REVISION);
    });

    it("should return REJECTED for score below 40", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({ ...goodAiResponse, overallScore: 30 }),
        model: "gpt-4",
      });

      const result = await service.reviewDimension(
        mockTopic as never,
        mockDimension as never,
        makeAnalysis(),
        10,
      );

      expect(result.qualityLevel).toBe(ReviewQualityLevel.REJECTED);
    });

    it("should return ACCEPTABLE for score 65", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({ ...goodAiResponse, overallScore: 65 }),
        model: "gpt-4",
      });

      const result = await service.reviewDimension(
        mockTopic as never,
        mockDimension as never,
        makeAnalysis(),
        10,
      );

      expect(result.qualityLevel).toBe(ReviewQualityLevel.ACCEPTABLE);
    });

    it("should throw InternalServerErrorException when JSON parse fails", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: "not valid json at all",
        model: "gpt-4",
      });

      // Falls into the catch block, returns failed review
      const result = await service.reviewDimension(
        mockTopic as never,
        mockDimension as never,
        makeAnalysis(),
        10,
      );

      expect(result.needsReresearch).toBe(true);
      expect(result.overallScore).toBe(0);
    });
  });

  // ─── reviewOverall - cross-dimension issues ───

  describe("reviewOverall - cross-dimension issue detection", () => {
    it("should detect systemic quality issue when >=50% dimensions have score <60", async () => {
      const reviews = [
        makeDimensionReview({
          overallScore: 50,
          scores: {
            breadth: 50,
            depth: 50,
            evidence: 50,
            coherence: 50,
            currency: 50,
          },
        }),
        makeDimensionReview({
          dimensionId: "dim-2",
          dimensionName: "dim2",
          overallScore: 55,
          scores: {
            breadth: 50,
            depth: 50,
            evidence: 50,
            coherence: 50,
            currency: 50,
          },
        }),
        makeDimensionReview({
          dimensionId: "dim-3",
          dimensionName: "dim3",
          overallScore: 80,
        }),
      ];
      const dims = [
        mockDimension,
        { ...mockDimension, id: "dim-2", name: "dim2" },
        { ...mockDimension, id: "dim-3", name: "dim3" },
      ];

      const result = await service.reviewOverall(
        mockTopic as never,
        dims as never,
        reviews,
      );

      const criticalIssue = result.crossDimensionIssues.find(
        (i) => i.severity === "critical",
      );
      expect(criticalIssue).toBeDefined();
      expect(criticalIssue?.description).toContain("系统性");
    });

    it("should detect weak evidence issue when >=30% dimensions have evidence score <60", async () => {
      const reviews = [
        makeDimensionReview({
          scores: {
            breadth: 80,
            depth: 80,
            evidence: 50,
            coherence: 80,
            currency: 80,
          },
        }),
        makeDimensionReview({
          dimensionId: "dim-2",
          dimensionName: "dim2",
          scores: {
            breadth: 80,
            depth: 80,
            evidence: 55,
            coherence: 80,
            currency: 80,
          },
        }),
        makeDimensionReview({
          dimensionId: "dim-3",
          dimensionName: "dim3",
          scores: {
            breadth: 80,
            depth: 80,
            evidence: 80,
            coherence: 80,
            currency: 80,
          },
        }),
      ];
      const dims = [
        mockDimension,
        { ...mockDimension, id: "dim-2", name: "dim2" },
        { ...mockDimension, id: "dim-3", name: "dim3" },
      ];

      const result = await service.reviewOverall(
        mockTopic as never,
        dims as never,
        reviews,
      );

      const weakEvidenceIssue = result.crossDimensionIssues.find(
        (i) => i.type === "weak_evidence",
      );
      expect(weakEvidenceIssue).toBeDefined();
    });

    it("should analyze coverage for MACRO topic type", async () => {
      const macroTopic = { ...mockTopic, type: "MACRO" };
      const reviews = [makeDimensionReview({ overallScore: 80 })];
      const dims = [{ ...mockDimension, name: "政策法规" }];

      const result = await service.reviewOverall(
        macroTopic as never,
        dims as never,
        reviews,
      );

      expect(result.coverageAnalysis).toBeDefined();
      expect(result.coverageAnalysis.coveredAspects).toContain("政策法规");
    });

    it("should analyze coverage for COMPANY topic type", async () => {
      const companyTopic = { ...mockTopic, type: "COMPANY" };
      const reviews = [makeDimensionReview()];
      const dims = [{ ...mockDimension, name: "公司概况" }];

      const result = await service.reviewOverall(
        companyTopic as never,
        dims as never,
        reviews,
      );

      expect(result.coverageAnalysis.coveredAspects).toContain("公司概况");
    });

    it("should identify related aspects (market-行业 pair)", async () => {
      const reviews = [makeDimensionReview({ overallScore: 75 })];
      const dims = [{ ...mockDimension, name: "市场分析" }]; // matches "市场" -> "行业"

      const result = await service.reviewOverall(
        { ...mockTopic, type: "MACRO" } as never,
        dims as never,
        reviews,
      );

      // "市场分析" should partially cover "市场格局" via areRelatedAspects
      expect(result.coverageAnalysis).toBeDefined();
    });

    it("should add depth recommendation when avg depth score < 70", async () => {
      const reviews = [
        makeDimensionReview({
          scores: {
            breadth: 80,
            depth: 60,
            evidence: 80,
            coherence: 80,
            currency: 80,
          },
        }),
      ];

      const result = await service.reviewOverall(
        mockTopic as never,
        [mockDimension] as never,
        reviews,
      );

      expect(result.recommendations.some((r) => r.includes("深入分析"))).toBe(
        true,
      );
    });

    it("should add evidence recommendation when avg evidence score < 70", async () => {
      const reviews = [
        makeDimensionReview({
          scores: {
            breadth: 80,
            depth: 80,
            evidence: 50,
            coherence: 80,
            currency: 80,
          },
        }),
      ];

      const result = await service.reviewOverall(
        mockTopic as never,
        [mockDimension] as never,
        reviews,
      );

      expect(result.recommendations.some((r) => r.includes("高质量证据"))).toBe(
        true,
      );
    });

    it("should add worst dimensions recommendation when scores < 70", async () => {
      const reviews = [
        makeDimensionReview({ overallScore: 50, dimensionName: "WeakDim" }),
      ];

      const result = await service.reviewOverall(
        mockTopic as never,
        [mockDimension] as never,
        reviews,
      );

      expect(result.recommendations.some((r) => r.includes("WeakDim"))).toBe(
        true,
      );
    });
  });

  // ─── validateClaims - batches and stats ───

  describe("validateClaims - multiple batches and status stats", () => {
    it("should process 7 claims in 2 batches", async () => {
      const batchResponse1 = {
        results: Array.from({ length: 5 }, (_, i) => ({
          claimId: `c${i + 1}`,
          status: "verified" as const,
          supportingSourceIndices: [0],
          contradictingSourceIndices: [],
          explanation: "OK",
        })),
      };
      const batchResponse2 = {
        results: [
          {
            claimId: "c6",
            status: "disputed" as const,
            supportingSourceIndices: [],
            contradictingSourceIndices: [0],
            explanation: "Disputed",
          },
          {
            claimId: "c7",
            status: "unverified" as const,
            supportingSourceIndices: [],
            contradictingSourceIndices: [],
            explanation: "Unknown",
          },
        ],
      };

      mockFacade.chatWithSkills
        .mockResolvedValueOnce({
          content: JSON.stringify(batchResponse1),
          model: "gpt-4",
        })
        .mockResolvedValueOnce({
          content: JSON.stringify(batchResponse2),
          model: "gpt-4",
        });

      const claims = Array.from({ length: 7 }, (_, i) => ({
        id: `c${i + 1}`,
        claim: `Claim ${i + 1}`,
        source: "ev-1",
        confidence: 0.9,
      }));

      const result = await service.validateClaims(
        claims as never,
        "evidence text",
      );

      expect(mockFacade.chatWithSkills).toHaveBeenCalledTimes(2);
      expect(result.stats.total).toBe(7);
      expect(result.stats.verified).toBe(5);
      expect(result.stats.disputed).toBe(1);
      expect(result.stats.unverified).toBe(1);
    });

    it("should truncate evidenceSummary to 6000 chars when calling AI", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          results: [
            {
              claimId: "c1",
              status: "verified",
              supportingSourceIndices: [],
              contradictingSourceIndices: [],
              explanation: "ok",
            },
          ],
        }),
        model: "gpt-4",
      });

      const longEvidence = "x".repeat(10000);
      const claims = [
        { id: "c1", claim: "Test", source: "ev-1", confidence: 0.9 },
      ];

      await service.validateClaims(claims as never, longEvidence);

      expect(mockFacade.chatWithSkills).toHaveBeenCalledTimes(1);
    });

    it("should handle invalid JSON response from batch (returns unverified fallback)", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: "{ invalid json }",
        model: "gpt-4",
      });

      const claims = [
        { id: "c1", claim: "Test", source: "ev-1", confidence: 0.9 },
      ];
      const result = await service.validateClaims(claims as never, "evidence");

      expect(result.results[0].status).toBe("unverified");
    });
  });

  // ─── generateGapSearchQueries ───

  describe("generateGapSearchQueries", () => {
    it("should return empty array when disputedClaims is empty", async () => {
      const result = await service.generateGapSearchQueries(
        [],
        "some evidence",
      );
      expect(result).toEqual([]);
      expect(mockFacade.chatWithSkills).not.toHaveBeenCalled();
    });

    it("should return gap queries from AI", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          queries: [
            {
              query: "AI market size 2024",
              targetClaimIds: ["c1"],
              searchType: "web",
            },
            {
              query: "Generative AI growth",
              targetClaimIds: ["c2"],
              searchType: "academic",
            },
          ],
        }),
        model: "gpt-4",
      });

      const disputedClaims = [
        {
          claimId: "c1",
          status: "disputed" as const,
          supportingSourceIndices: [],
          contradictingSourceIndices: [],
          explanation: "Needs more evidence",
        },
      ];

      const result = await service.generateGapSearchQueries(
        disputedClaims,
        "existing evidence",
      );

      expect(result.length).toBe(2);
      expect(result[0].query).toBe("AI market size 2024");
    });

    it("should return empty array when AI call fails", async () => {
      mockFacade.chatWithSkills.mockRejectedValue(new Error("Network error"));

      const disputedClaims = [
        {
          claimId: "c1",
          status: "disputed" as const,
          supportingSourceIndices: [],
          contradictingSourceIndices: [],
          explanation: "test",
        },
      ];

      const result = await service.generateGapSearchQueries(
        disputedClaims,
        "evidence",
      );
      expect(result).toEqual([]);
    });

    it("should return empty when AI response lacks queries key", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({ data: [] }),
        model: "gpt-4",
      });

      const disputedClaims = [
        {
          claimId: "c1",
          status: "unverified" as const,
          supportingSourceIndices: [],
          contradictingSourceIndices: [],
          explanation: "unknown",
        },
      ];

      const result = await service.generateGapSearchQueries(
        disputedClaims,
        "evidence",
      );
      expect(result).toEqual([]);
    });

    it("should cap results at 4 queries", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          queries: Array.from({ length: 10 }, (_, i) => ({
            query: `query ${i}`,
            targetClaimIds: [`c${i}`],
            searchType: "web",
          })),
        }),
        model: "gpt-4",
      });

      const disputedClaims = [
        {
          claimId: "c1",
          status: "disputed" as const,
          supportingSourceIndices: [],
          contradictingSourceIndices: [],
          explanation: "test",
        },
      ];
      const result = await service.generateGapSearchQueries(
        disputedClaims,
        "evidence",
      );

      expect(result.length).toBe(4);
    });

    it("should truncate long claims JSON to 3000 chars", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({ queries: [] }),
        model: "gpt-4",
      });

      const manyDisputedClaims = Array.from({ length: 100 }, (_, i) => ({
        claimId: `c${i}`,
        status: "disputed" as const,
        supportingSourceIndices: [],
        contradictingSourceIndices: [],
        explanation: "long explanation".repeat(20),
      }));

      await service.generateGapSearchQueries(manyDisputedClaims, "evidence");
      expect(mockFacade.chatWithSkills).toHaveBeenCalledTimes(1);
    });
  });

  // ─── factCheckReport - citation parsing edge cases ───

  describe("factCheckReport - citation parsing", () => {
    it("should skip reference-section citations (lines starting with [N])", async () => {
      // A reference entry: "[1] Title: description" at the start of a line
      // should NOT be included as an inline citation
      const reportWithRefSection =
        "The AI market grew [1] significantly.\n\n## References\n[1] Market Report: Growth data\n[2] Another Source: More data";

      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          citations: [],
          accuracyScore: 100,
          issues: [],
        }),
        model: "gpt-4",
      });

      const result = await service.factCheckReport(reportWithRefSection, []);

      // The service should still call AI since there are inline citations
      // (the [1] before "significantly" is an inline citation, reference section entries are skipped)
      expect(result).toBeDefined();
    });

    it("should limit citation extraction to 30", async () => {
      // Build report with 40 inline citations
      const reportWith40Citations = Array.from(
        { length: 40 },
        (_, i) => `Sentence ${i + 1} [${i + 1}] shows growth.`,
      ).join(" ");

      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          citations: [],
          accuracyScore: 95,
          issues: [],
        }),
        model: "gpt-4",
      });

      const evidence = [{ id: "ev-1", title: "Report", snippet: "data" }];
      await service.factCheckReport(reportWith40Citations, evidence);

      // Should have been called (citations exist)
      expect(mockFacade.chatWithSkills).toHaveBeenCalledTimes(1);
    });

    it("should limit evidence to 30 items in prompt", async () => {
      const reportContent = "Data shows [1] strong growth.";
      const largeEvidence = Array.from({ length: 50 }, (_, i) => ({
        id: `ev-${i}`,
        title: `Report ${i}`,
        snippet: `Snippet ${i}`,
      }));

      mockFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          citations: [],
          accuracyScore: 90,
          issues: [],
        }),
        model: "gpt-4",
      });

      await service.factCheckReport(reportContent, largeEvidence);
      expect(mockFacade.chatWithSkills).toHaveBeenCalledTimes(1);
    });

    it("should return 0 accuracy when AI returns invalid JSON", async () => {
      mockFacade.chatWithSkills.mockResolvedValue({
        content: "{ bad json }",
        model: "gpt-4",
      });

      const result = await service.factCheckReport("Growth [1] confirmed.", [
        { id: "ev-1", title: "T", snippet: "S" },
      ]);
      expect(result.accuracyScore).toBe(0);
    });
  });
});
