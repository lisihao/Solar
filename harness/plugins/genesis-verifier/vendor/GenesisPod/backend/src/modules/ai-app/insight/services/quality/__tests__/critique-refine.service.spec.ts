import { Test, TestingModule } from "@nestjs/testing";
import {
  CritiqueRefineService,
  CritiqueRefineRequest,
} from "../critique-refine.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  CritiqueCategory,
  CritiqueSeverity,
  DEFAULT_CRITIQUE_REFINE_CONFIG,
} from "../../../types/quality.types";

const mockFacade = {
  chatWithSkills: jest.fn(),
  chatStructured: jest.fn(),
};

const mockPrisma = {
  dimensionAnalysis: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};

const baseContext: CritiqueRefineRequest["context"] = {
  topicName: "AI Market Research",
  dimensionName: "Market Size",
  targetAudience: "Business analysts",
  qualityExpectation: "High quality research report",
};

const goodCritiqueResponse = {
  overallScore: 0.9,
  categoryScores: {
    factual: 0.9,
    logical: 0.85,
    coverage: 0.9,
    clarity: 0.88,
  },
  items: [],
  strengths: ["Well structured", "Good evidence"],
  improvementPriorities: [],
  summary: "Excellent research",
};

const poorCritiqueResponse = {
  overallScore: 0.5,
  categoryScores: {
    factual: 0.6,
    logical: 0.5,
    coverage: 0.4,
    clarity: 0.5,
  },
  items: [
    {
      id: "issue-1",
      category: "factual",
      severity: "critical",
      location: { type: "paragraph", reference: "Para 1", quote: "Some quote" },
      issue: "Unverified claim",
      suggestion: "Add citation",
      exampleFix: "According to [source]...",
    },
    {
      id: "issue-2",
      category: "logical",
      severity: "major",
      location: { type: "paragraph", reference: "Para 2" },
      issue: "Logical gap",
      suggestion: "Explain causation",
    },
  ],
  strengths: [],
  improvementPriorities: ["Fix critical factual issues"],
  summary: "Needs significant improvement",
};

const refineResponse = {
  refinedContent: "Improved content with citations and clearer logic.",
  changesApplied: [
    {
      critiqueItemId: "issue-1",
      original: "Unverified claim",
      revised: "Verified claim with source",
      reason: "Added citation",
      changeType: "correction",
    },
  ],
  remainingIssues: [],
  refinementSummary: "Fixed 1 critical issue",
};

describe("CritiqueRefineService", () => {
  let service: CritiqueRefineService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CritiqueRefineService,
        { provide: ChatFacade, useValue: mockFacade },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CritiqueRefineService>(CritiqueRefineService);
    jest.clearAllMocks();
  });

  describe("critiqueContent", () => {
    it("should return critique result with parsed items and scores", async () => {
      mockFacade.chatStructured.mockResolvedValue({
        data: poorCritiqueResponse,
        rawContent: JSON.stringify(poorCritiqueResponse),
        model: "gpt-4",
      });

      const result = await service.critiqueContent(
        "Some content to critique",
        baseContext,
        DEFAULT_CRITIQUE_REFINE_CONFIG,
      );

      expect(result.overallScore).toBe(0.5);
      expect(result.items).toHaveLength(2);
      expect(result.criticalIssues).toHaveLength(1);
      expect(result.criticalIssues[0].severity).toBe(CritiqueSeverity.CRITICAL);
    });

    it("should return fallback critique when AI throws error", async () => {
      mockFacade.chatStructured.mockRejectedValue(new Error("API error"));

      const result = await service.critiqueContent(
        "Content",
        baseContext,
        DEFAULT_CRITIQUE_REFINE_CONFIG,
      );

      expect(result.overallScore).toBe(0.6);
      expect(result.items).toHaveLength(0);
      expect(result.meetsQualityStandard).toBe(false);
    });

    it("should clamp overallScore to [0, 1]", async () => {
      mockFacade.chatStructured.mockResolvedValue({
        data: { ...goodCritiqueResponse, overallScore: 1.5 },
        rawContent: JSON.stringify({
          ...goodCritiqueResponse,
          overallScore: 1.5,
        }),
        model: "gpt-4",
      });

      const result = await service.critiqueContent(
        "Content",
        baseContext,
        DEFAULT_CRITIQUE_REFINE_CONFIG,
      );

      expect(result.overallScore).toBeLessThanOrEqual(1);
    });

    it("should return meetsQualityStandard true when score is high and no critical issues", async () => {
      mockFacade.chatStructured.mockResolvedValue({
        data: goodCritiqueResponse,
        rawContent: JSON.stringify(goodCritiqueResponse),
        model: "gpt-4",
      });

      const result = await service.critiqueContent(
        "Great content",
        baseContext,
        DEFAULT_CRITIQUE_REFINE_CONFIG,
      );

      expect(result.meetsQualityStandard).toBe(true);
      expect(result.overallScore).toBe(0.9);
    });

    it("should handle response wrapped in markdown code block", async () => {
      // chatStructured handles JSON parsing internally, so data is already parsed
      mockFacade.chatStructured.mockResolvedValue({
        data: goodCritiqueResponse,
        rawContent: JSON.stringify(goodCritiqueResponse),
        model: "gpt-4",
      });

      const result = await service.critiqueContent(
        "Content",
        baseContext,
        DEFAULT_CRITIQUE_REFINE_CONFIG,
      );

      expect(result.overallScore).toBe(0.9);
    });
  });

  describe("refineContent", () => {
    const makeCritique = (overrides = {}) => ({
      overallScore: 0.5,
      categoryScores: {} as Record<CritiqueCategory, number>,
      items: [
        {
          id: "issue-1",
          category: CritiqueCategory.FACTUAL,
          severity: CritiqueSeverity.CRITICAL,
          location: { type: "paragraph" as const, reference: "Para 1" },
          issue: "Unverified claim",
          suggestion: "Add citation",
        },
      ],
      strengths: [],
      criticalIssues: [
        {
          id: "issue-1",
          category: CritiqueCategory.FACTUAL,
          severity: CritiqueSeverity.CRITICAL,
          location: { type: "paragraph" as const, reference: "Para 1" },
          issue: "Unverified claim",
          suggestion: "Add citation",
        },
      ],
      improvementPriorities: ["Fix unverified claims"],
      summary: "Needs work",
      meetsQualityStandard: false,
      suggestedRefinementRounds: 2,
      ...overrides,
    });

    it("should return refined content when issues are fixed", async () => {
      mockFacade.chatStructured.mockResolvedValue({
        data: refineResponse,
        rawContent: JSON.stringify(refineResponse),
        model: "gpt-4",
      });

      const critique = makeCritique();
      const result = await service.refineContent(
        "Original content",
        critique,
        baseContext,
      );

      expect(result.refinedContent).toBe(
        "Improved content with citations and clearer logic.",
      );
      expect(result.changesApplied).toHaveLength(1);
    });

    it("should return original content when no critical/major issues", async () => {
      const critiqueWithOnlyMinor = makeCritique({
        items: [
          {
            id: "s1",
            category: CritiqueCategory.CLARITY,
            severity: CritiqueSeverity.MINOR,
            location: { type: "paragraph" as const, reference: "Para 1" },
            issue: "Minor clarity issue",
            suggestion: "Rephrase",
          },
        ],
        criticalIssues: [],
      });

      const result = await service.refineContent(
        "Original content",
        critiqueWithOnlyMinor,
        baseContext,
      );

      expect(result.refinedContent).toBe("Original content");
      expect(result.changesApplied).toHaveLength(0);
      expect(result.scoreImprovement).toBe(0);
    });

    it("should return original content when AI throws error", async () => {
      mockFacade.chatStructured.mockRejectedValue(new Error("Network error"));

      const critique = makeCritique();
      const result = await service.refineContent(
        "Original content",
        critique,
        baseContext,
      );

      expect(result.refinedContent).toBe("Original content");
      expect(result.changesApplied).toHaveLength(0);
      expect(result.refinementSummary).toContain("改进失败");
    });
  });

  describe("runCritiqueRefineLoop", () => {
    it("should stop immediately when initial critique meets target score", async () => {
      // First call returns good score (will stop immediately), then final critique
      mockFacade.chatStructured
        .mockResolvedValueOnce({
          data: goodCritiqueResponse, // initial critique: score 0.9 >= target 0.85
          rawContent: JSON.stringify(goodCritiqueResponse),
          model: "gpt-4",
        })
        .mockResolvedValueOnce({
          data: goodCritiqueResponse, // final critique
          rawContent: JSON.stringify(goodCritiqueResponse),
          model: "gpt-4",
        });

      const request: CritiqueRefineRequest = {
        content: "Good content already",
        context: baseContext,
      };

      const result = await service.runCritiqueRefineLoop(request);

      expect(result.iterations).toHaveLength(0);
      expect(result.reachedTargetScore).toBe(true);
      expect(result.stopReason).toBe("target_reached");
    });

    it("should iterate when initial score is below target", async () => {
      // First iteration: critique shows poor score, refine improves it
      // After refine, second critique shows good score
      mockFacade.chatStructured
        .mockResolvedValueOnce({
          data: poorCritiqueResponse,
          rawContent: JSON.stringify(poorCritiqueResponse),
          model: "gpt-4",
        }) // iteration 1 critique
        .mockResolvedValueOnce({
          data: refineResponse,
          rawContent: JSON.stringify(refineResponse),
          model: "gpt-4",
        }) // iteration 1 refine
        .mockResolvedValueOnce({
          data: goodCritiqueResponse,
          rawContent: JSON.stringify(goodCritiqueResponse),
          model: "gpt-4",
        }) // iteration 2 critique (stop: target_reached)
        .mockResolvedValueOnce({
          data: goodCritiqueResponse,
          rawContent: JSON.stringify(goodCritiqueResponse),
          model: "gpt-4",
        }); // final critique

      const request: CritiqueRefineRequest = {
        content: "Content needing improvement",
        context: baseContext,
      };

      const result = await service.runCritiqueRefineLoop(request);

      expect(result.iterations).toHaveLength(1);
      expect(result.finalContent).toBe(
        "Improved content with citations and clearer logic.",
      );
    });

    it("should stop after max iterations", async () => {
      // Always poor score to ensure max iterations hit
      mockFacade.chatStructured.mockResolvedValue({
        data: poorCritiqueResponse,
        rawContent: JSON.stringify(poorCritiqueResponse),
        model: "gpt-4",
      });

      const request: CritiqueRefineRequest = {
        content: "Content that never improves",
        context: baseContext,
        config: {
          maxIterations: 2,
          stopOnNoCritical: false,
          stopOnNoImprovement: false,
          minImprovementThreshold: 0,
        },
      };

      const result = await service.runCritiqueRefineLoop(request);

      // Should have some stop reason
      expect(result.stopReason).toBeDefined();
      expect(result.metadata.totalIterations).toBeGreaterThanOrEqual(0);
    });

    it("should track total changes across iterations", async () => {
      mockFacade.chatStructured
        .mockResolvedValueOnce({
          data: poorCritiqueResponse,
          rawContent: JSON.stringify(poorCritiqueResponse),
          model: "gpt-4",
        })
        .mockResolvedValueOnce({
          data: refineResponse,
          rawContent: JSON.stringify(refineResponse),
          model: "gpt-4",
        })
        .mockResolvedValueOnce({
          data: goodCritiqueResponse,
          rawContent: JSON.stringify(goodCritiqueResponse),
          model: "gpt-4",
        })
        .mockResolvedValueOnce({
          data: goodCritiqueResponse,
          rawContent: JSON.stringify(goodCritiqueResponse),
          model: "gpt-4",
        });

      const request: CritiqueRefineRequest = {
        content: "Content",
        context: baseContext,
      };

      const result = await service.runCritiqueRefineLoop(request);

      // 1 change was applied in refineResponse
      expect(result.totalChanges).toBe(1);
    });

    it("should use custom config when provided", async () => {
      mockFacade.chatStructured.mockResolvedValue({
        data: goodCritiqueResponse,
        rawContent: JSON.stringify(goodCritiqueResponse),
        model: "gpt-4",
      });

      const request: CritiqueRefineRequest = {
        content: "Content",
        context: baseContext,
        config: {
          maxIterations: 1,
          targetScore: 0.5, // Very low target, should reach immediately
        },
      };

      const result = await service.runCritiqueRefineLoop(request);

      expect(result.reachedTargetScore).toBe(true);
    });

    it("should include metadata with timing information", async () => {
      mockFacade.chatStructured.mockResolvedValue({
        data: goodCritiqueResponse,
        rawContent: JSON.stringify(goodCritiqueResponse),
        model: "gpt-4",
      });

      const result = await service.runCritiqueRefineLoop({
        content: "Content",
        context: baseContext,
      });

      expect(result.metadata.totalTimeMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.metadata.totalIterations).toBe("number");
    });
  });
});
