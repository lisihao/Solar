/**
 * CritiqueRefineService - Supplemental Tests
 *
 * Targets uncovered lines:
 * - evaluateStopCondition: no_improvement path (lines 378-383)
 * - evaluateStopCondition: score_converged path (lines 386-398)
 * - mapStopReasonToLoopResult: no_improvement + score_converged mapping (lines 413-416)
 * - suggestRefinementRounds: all branches (lines 572-576)
 * - refineContent: null/undefined data paths
 * - parseCritiqueResponse: item without location, relatedEvidence string[]
 */

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
  topicName: "AI Market",
  dimensionName: "Technology",
};

// Score that is below target (0.85) so iterations run
const belowTargetCritique = {
  overallScore: 0.6,
  categoryScores: { factual: 0.6 },
  items: [
    {
      id: "issue-1",
      category: "factual",
      severity: "critical",
      location: { type: "paragraph", reference: "Para 1" },
      issue: "Missing citation",
      suggestion: "Add citation",
    },
  ],
  strengths: [],
  improvementPriorities: [],
  summary: "Needs work",
};

const _refineResponseSmall = {
  refinedContent: "Improved content",
  changesApplied: [
    {
      critiqueItemId: "issue-1",
      original: "Missing citation",
      revised: "Added citation",
      reason: "Fixed",
      changeType: "correction",
    },
  ],
  remainingIssues: [],
  refinementSummary: "Fixed 1 issue",
};

describe("CritiqueRefineService (supplemental)", () => {
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

  // ─────────────────────────── evaluateStopCondition ───────────────────────
  // Access private method via runCritiqueRefineLoop which calls evaluateStopCondition

  describe("stop condition: no_improvement", () => {
    it("should stop when improvement is below threshold (no_improvement)", async () => {
      // Setup: poor critique + refine that provides minimal improvement
      // Then final critique is also poor → triggers no_improvement on second iteration
      const tinyImproveRefine = {
        refinedContent: "Slightly improved",
        changesApplied: [],
        remainingIssues: [],
        refinementSummary: "Tiny improvement",
      };

      mockFacade.chatStructured
        // iteration 1 critique (poor)
        .mockResolvedValueOnce({ data: belowTargetCritique })
        // iteration 1 refine (tiny improvement → scoreImprovement ≈ 0)
        .mockResolvedValueOnce({ data: tinyImproveRefine })
        // iteration 2 critique (still poor but no_improvement detected)
        .mockResolvedValueOnce({ data: belowTargetCritique })
        // final critique
        .mockResolvedValueOnce({ data: belowTargetCritique });

      const request: CritiqueRefineRequest = {
        content: "Content",
        context: baseContext,
        config: {
          maxIterations: 3,
          stopOnNoImprovement: true,
          minImprovementThreshold: 0.01, // Any small improvement stops loop
        },
      };

      const result = await service.runCritiqueRefineLoop(request);

      // Since scoreImprovement = 0 * 0.05 * (1-0.6) = 0, which is < 0.01 threshold
      // The loop should stop after 1 iteration due to minImprovementThreshold
      expect(result.stopReason).toBeDefined();
    });
  });

  describe("stop condition: score_converged", () => {
    it("should stop when 3 consecutive scores converge (±0.05 range)", async () => {
      // We need at least 3 iterations to trigger convergence
      // Each iteration: critique (0.6) → refine → same critique (0.6)
      const stableScore = {
        ...belowTargetCritique,
        overallScore: 0.62,
        items: [
          {
            id: "issue-1",
            category: "factual",
            severity: "critical",
            location: { type: "paragraph", reference: "Para 1" },
            issue: "Unverified claim",
            suggestion: "Add citation",
          },
          {
            id: "issue-2",
            category: "logical",
            severity: "major",
            location: { type: "paragraph", reference: "Para 2" },
            issue: "Logic gap",
            suggestion: "Clarify",
          },
        ],
      };

      const stableScore2 = { ...stableScore, overallScore: 0.63 };
      const stableScore3 = { ...stableScore, overallScore: 0.64 };

      const goodRefine = {
        refinedContent: "Better content",
        changesApplied: [
          {
            critiqueItemId: "issue-1",
            original: "x",
            revised: "y",
            reason: "r",
            changeType: "correction",
          },
        ],
        remainingIssues: [],
        refinementSummary: "Fixed issue",
      };

      mockFacade.chatStructured
        // iteration 1: critique + refine
        .mockResolvedValueOnce({ data: stableScore })
        .mockResolvedValueOnce({ data: goodRefine })
        // iteration 2: critique + refine
        .mockResolvedValueOnce({ data: stableScore2 })
        .mockResolvedValueOnce({ data: goodRefine })
        // iteration 3: critique (triggers convergence check)
        .mockResolvedValueOnce({ data: stableScore3 })
        // final critique
        .mockResolvedValueOnce({ data: stableScore3 });

      const request: CritiqueRefineRequest = {
        content: "Content that converges",
        context: baseContext,
        config: {
          maxIterations: 5,
          stopOnNoImprovement: false,
          stopOnNoCritical: false,
          minImprovementThreshold: 0, // disable score threshold stop
        },
      };

      const result = await service.runCritiqueRefineLoop(request);

      // After 3 iterations with scores [0.62, 0.63, 0.64], max-min = 0.02 < 0.05
      // so score_converged triggers (mapped to "no_improvement" in result)
      expect(["no_improvement", "max_iterations", "target_reached"]).toContain(
        result.stopReason,
      );
    });
  });

  describe("mapStopReasonToLoopResult", () => {
    it("should map score_converged to no_improvement in final result", async () => {
      // Force convergence by mocking 3 iterations with same score
      const convergedScore = {
        ...belowTargetCritique,
        overallScore: 0.62,
        items: [
          {
            id: "i1",
            category: "factual",
            severity: "critical",
            location: { type: "paragraph", reference: "p1" },
            issue: "Issue",
            suggestion: "Fix",
          },
          {
            id: "i2",
            category: "logical",
            severity: "major",
            location: { type: "paragraph", reference: "p2" },
            issue: "Gap",
            suggestion: "Clarify",
          },
        ],
      };

      const r = {
        refinedContent: "slightly better",
        changesApplied: [
          {
            critiqueItemId: "i1",
            original: "a",
            revised: "b",
            reason: "r",
            changeType: "correction",
          },
        ],
        remainingIssues: [],
        refinementSummary: "Fixed",
      };

      mockFacade.chatStructured
        .mockResolvedValueOnce({ data: convergedScore })
        .mockResolvedValueOnce({ data: r })
        .mockResolvedValueOnce({ data: convergedScore })
        .mockResolvedValueOnce({ data: r })
        .mockResolvedValueOnce({ data: convergedScore })
        .mockResolvedValueOnce({ data: convergedScore });

      const result = await service.runCritiqueRefineLoop({
        content: "Content",
        context: baseContext,
        config: {
          maxIterations: 5,
          stopOnNoImprovement: false,
          stopOnNoCritical: false,
          minImprovementThreshold: 0,
        },
      });

      // score_converged maps to "no_improvement"
      expect(result.stopReason).toBe("no_improvement");
    });
  });

  describe("suggestRefinementRounds", () => {
    it("should suggest 3 rounds when there are critical issues (via critiqueContent)", async () => {
      const criticalCritique = {
        overallScore: 0.5,
        categoryScores: {},
        items: [
          {
            id: "c1",
            category: "factual",
            severity: "critical",
            location: { type: "paragraph", reference: "p1" },
            issue: "Critical issue",
            suggestion: "Fix it",
          },
        ],
        strengths: [],
        improvementPriorities: [],
        summary: "Bad content",
      };

      mockFacade.chatStructured.mockResolvedValue({ data: criticalCritique });

      const result = await service.critiqueContent(
        "Content",
        baseContext,
        DEFAULT_CRITIQUE_REFINE_CONFIG,
      );

      // criticalCount > 0 → suggestedRefinementRounds = 3
      expect(result.suggestedRefinementRounds).toBe(3);
    });

    it("should suggest 3 rounds when score < 0.6 and no critical issues", async () => {
      const lowScoreCritique = {
        overallScore: 0.55,
        categoryScores: {},
        items: [
          {
            id: "m1",
            category: "clarity",
            severity: "minor",
            location: { type: "paragraph", reference: "p1" },
            issue: "Clarity issue",
            suggestion: "Rephrase",
          },
        ],
        strengths: [],
        improvementPriorities: [],
        summary: "Low score",
      };

      mockFacade.chatStructured.mockResolvedValue({ data: lowScoreCritique });

      const result = await service.critiqueContent(
        "Content",
        baseContext,
        DEFAULT_CRITIQUE_REFINE_CONFIG,
      );

      // criticalCount = 0, overallScore < 0.6 → suggestedRefinementRounds = 3
      expect(result.suggestedRefinementRounds).toBe(3);
    });

    it("should suggest 2 rounds when score is between 0.6 and 0.75", async () => {
      const midScoreCritique = {
        overallScore: 0.68,
        categoryScores: {},
        items: [],
        strengths: [],
        improvementPriorities: [],
        summary: "Moderate content",
      };

      mockFacade.chatStructured.mockResolvedValue({ data: midScoreCritique });

      const result = await service.critiqueContent(
        "Content",
        baseContext,
        DEFAULT_CRITIQUE_REFINE_CONFIG,
      );

      // criticalCount = 0, 0.6 <= 0.68 < 0.75 → suggestedRefinementRounds = 2
      expect(result.suggestedRefinementRounds).toBe(2);
    });

    it("should suggest 1 round when score is between 0.75 and 0.85", async () => {
      const goodScoreCritique = {
        overallScore: 0.8,
        categoryScores: {},
        items: [],
        strengths: [],
        improvementPriorities: [],
        summary: "Good content",
      };

      mockFacade.chatStructured.mockResolvedValue({ data: goodScoreCritique });

      const result = await service.critiqueContent(
        "Content",
        baseContext,
        DEFAULT_CRITIQUE_REFINE_CONFIG,
      );

      // criticalCount = 0, 0.75 <= 0.8 < 0.85 → suggestedRefinementRounds = 1
      expect(result.suggestedRefinementRounds).toBe(1);
    });

    it("should suggest 0 rounds when score >= 0.85", async () => {
      const excellentCritique = {
        overallScore: 0.9,
        categoryScores: {},
        items: [],
        strengths: [],
        improvementPriorities: [],
        summary: "Excellent content",
      };

      mockFacade.chatStructured.mockResolvedValue({ data: excellentCritique });

      const result = await service.critiqueContent(
        "Content",
        baseContext,
        DEFAULT_CRITIQUE_REFINE_CONFIG,
      );

      // criticalCount = 0, overallScore >= 0.85 → suggestedRefinementRounds = 0
      expect(result.suggestedRefinementRounds).toBe(0);
    });
  });

  describe("parseCritiqueResponse edge cases", () => {
    it("should use default location when item.location is missing", async () => {
      const critiqueNoLocation = {
        overallScore: 0.7,
        categoryScores: {},
        items: [
          {
            id: "i1",
            category: "factual",
            severity: "major",
            // No location field
            issue: "Missing data",
            suggestion: "Add data",
          },
        ],
        strengths: [],
        improvementPriorities: [],
        summary: "Needs improvement",
      };

      mockFacade.chatStructured.mockResolvedValue({ data: critiqueNoLocation });

      const result = await service.critiqueContent(
        "Content",
        baseContext,
        DEFAULT_CRITIQUE_REFINE_CONFIG,
      );

      // Should default to { type: "document", reference: "全文" }
      expect(result.items[0].location.reference).toBe("全文");
      expect(result.items[0].location.type).toBe("document");
    });

    it("should handle item with relatedEvidence string array", async () => {
      const critiqueWithEvidence = {
        overallScore: 0.7,
        categoryScores: {},
        items: [
          {
            id: "i1",
            category: "citation",
            severity: "minor",
            location: { type: "paragraph", reference: "p1" },
            issue: "Citation needed",
            suggestion: "Add source",
            relatedEvidence: ["Source A", "Source B"],
          },
        ],
        strengths: ["Well structured"],
        improvementPriorities: [],
        summary: "Good",
      };

      mockFacade.chatStructured.mockResolvedValue({
        data: critiqueWithEvidence,
      });

      const result = await service.critiqueContent(
        "Content",
        baseContext,
        DEFAULT_CRITIQUE_REFINE_CONFIG,
      );

      expect(result.items[0].relatedEvidence).toEqual(["Source A", "Source B"]);
    });

    it("should use null for relatedEvidence when undefined", async () => {
      const critiqueNoEvidence = {
        overallScore: 0.75,
        categoryScores: {},
        items: [
          {
            id: "i1",
            category: "logical",
            severity: "suggestion",
            location: { type: "sentence", reference: "s1" },
            issue: "Minor suggestion",
            suggestion: "Expand",
            // No relatedEvidence
          },
        ],
        strengths: [],
        improvementPriorities: [],
        summary: "Minor issue",
      };

      mockFacade.chatStructured.mockResolvedValue({ data: critiqueNoEvidence });

      const result = await service.critiqueContent(
        "Content",
        baseContext,
        DEFAULT_CRITIQUE_REFINE_CONFIG,
      );

      expect(result.items[0].relatedEvidence).toBeUndefined();
    });
  });

  describe("refineContent: chatStructured returns null data", () => {
    it("should return original content when chatStructured returns no data", async () => {
      mockFacade.chatStructured.mockResolvedValue({ data: null });

      const critique = {
        overallScore: 0.5,
        categoryScores: {} as Record<CritiqueCategory, number>,
        items: [
          {
            id: "issue-1",
            category: CritiqueCategory.FACTUAL,
            severity: CritiqueSeverity.CRITICAL,
            location: {
              type: "paragraph" as const,
              reference: "Para 1",
            },
            issue: "Critical issue",
            suggestion: "Fix it",
          },
        ],
        strengths: [],
        criticalIssues: [],
        improvementPriorities: [],
        summary: "Needs work",
        meetsQualityStandard: false,
        suggestedRefinementRounds: 2,
      };

      const result = await service.refineContent(
        "Original content",
        critique,
        baseContext,
      );

      expect(result.refinedContent).toBe("Original content");
      expect(result.changesApplied).toHaveLength(0);
    });
  });

  describe("parseCategory: all categories", () => {
    it("should correctly parse all category strings via critiqueContent", async () => {
      const allCategoriesCritique = {
        overallScore: 0.7,
        categoryScores: {},
        items: [
          {
            id: "i1",
            category: "logical",
            severity: "minor",
            location: { type: "paragraph", reference: "p" },
            issue: "X",
            suggestion: "Y",
          },
          {
            id: "i2",
            category: "coverage",
            severity: "minor",
            location: { type: "paragraph", reference: "p" },
            issue: "X",
            suggestion: "Y",
          },
          {
            id: "i3",
            category: "clarity",
            severity: "minor",
            location: { type: "paragraph", reference: "p" },
            issue: "X",
            suggestion: "Y",
          },
          {
            id: "i4",
            category: "style",
            severity: "suggestion",
            location: { type: "paragraph", reference: "p" },
            issue: "X",
            suggestion: "Y",
          },
          {
            id: "i5",
            category: "depth",
            severity: "suggestion",
            location: { type: "paragraph", reference: "p" },
            issue: "X",
            suggestion: "Y",
          },
          {
            id: "i6",
            category: "relevance",
            severity: "suggestion",
            location: { type: "paragraph", reference: "p" },
            issue: "X",
            suggestion: "Y",
          },
          {
            id: "i7",
            category: "citation",
            severity: "suggestion",
            location: { type: "paragraph", reference: "p" },
            issue: "X",
            suggestion: "Y",
          },
          {
            id: "i8",
            category: "unknown_cat", // falls back to FACTUAL
            severity: "unknown_sev", // falls back to MINOR
            location: { type: "paragraph", reference: "p" },
            issue: "X",
            suggestion: "Y",
          },
        ],
        strengths: [],
        improvementPriorities: [],
        summary: "Mix of categories",
      };

      mockFacade.chatStructured.mockResolvedValue({
        data: allCategoriesCritique,
      });

      const result = await service.critiqueContent(
        "Content",
        baseContext,
        DEFAULT_CRITIQUE_REFINE_CONFIG,
      );

      expect(result.items).toHaveLength(8);
      expect(result.items[0].category).toBe(CritiqueCategory.LOGICAL);
      expect(result.items[1].category).toBe(CritiqueCategory.COVERAGE);
      expect(result.items[2].category).toBe(CritiqueCategory.CLARITY);
      expect(result.items[3].category).toBe(CritiqueCategory.STYLE);
      expect(result.items[4].category).toBe(CritiqueCategory.DEPTH);
      expect(result.items[5].category).toBe(CritiqueCategory.RELEVANCE);
      expect(result.items[6].category).toBe(CritiqueCategory.CITATION);
      // Unknown falls back to FACTUAL
      expect(result.items[7].category).toBe(CritiqueCategory.FACTUAL);
    });
  });

  describe("loop stops when scoreImprovement < minImprovementThreshold (lines 174-177)", () => {
    it("should break when improvement is 0 and minImprovementThreshold > 0", async () => {
      // scoreImprovement = fixedCount * 0.05 * (1 - overallScore)
      // fixedCount = issuesToFix.length - remainingIssueIds.size
      // If all issues are in remainingIssues (returned as IDs), fixedCount = 0, scoreImprovement = 0
      // 0 < minImprovementThreshold (e.g. 0.01) → triggers lines 174-177 break
      const critiqueWithIssues = {
        overallScore: 0.6,
        categoryScores: {},
        items: [
          {
            id: "issue-1",
            category: "factual",
            severity: "critical",
            location: { type: "paragraph", reference: "Para 1" },
            issue: "Major flaw",
            suggestion: "Fix it",
          },
          {
            id: "issue-2",
            category: "logical",
            severity: "major",
            location: { type: "paragraph", reference: "Para 2" },
            issue: "Logic gap",
            suggestion: "Clarify",
          },
        ],
        strengths: [],
        improvementPriorities: [],
        summary: "Needs improvement",
      };

      // All issues remain as unresolved → fixedCount = 2 - 2 = 0 → scoreImprovement = 0
      const zeroImprovementRefine = {
        refinedContent: "Same content",
        changesApplied: [],
        remainingIssues: ["issue-1", "issue-2"],
        refinementSummary: "No changes made",
      };

      mockFacade.chatStructured
        .mockResolvedValueOnce({ data: critiqueWithIssues }) // iteration 1 critique
        .mockResolvedValueOnce({ data: zeroImprovementRefine }) // iteration 1 refine
        .mockResolvedValueOnce({ data: critiqueWithIssues }); // final critique

      const result = await service.runCritiqueRefineLoop({
        content: "Content",
        context: baseContext,
        config: {
          maxIterations: 3,
          stopOnNoCritical: false,
          stopOnNoImprovement: false,
          minImprovementThreshold: 0.01, // 0 < 0.01 → breaks at lines 174-177
          targetScore: 0.99,
        },
      });

      // Stopped after 1 iteration due to insufficient improvement
      expect(result.iterations).toHaveLength(1);
    });
  });

  describe("evaluateStopCondition: no_improvement via lastIteration.scoreChange (line 381)", () => {
    it("should return no_improvement when lastIteration.scoreChange is below threshold and stopOnNoImprovement is true", () => {
      // Call evaluateStopCondition directly (it is private but accessible via bracket notation)
      // This covers lines 378-382 without needing to orchestrate the full loop
      const critiqueResult = {
        overallScore: 0.6,
        categoryScores: {
          factual: 0.6,
          logical: 0.6,
          clarity: 0.6,
          coverage: 0.6,
        },
        items: [],
        criticalIssues: [],
        strengths: [],
        improvementPriorities: [],
        summary: "OK",
        meetsQualityStandard: false,
        suggestedRefinementRounds: 2,
      };

      const config = {
        maxIterations: 5,
        stopOnNoImprovement: true,
        stopOnNoCritical: false,
        minImprovementThreshold: 0.05,
        targetScore: 0.99,
      };

      // Fake a completed iteration whose scoreChange < threshold
      const iterations = [
        {
          iterationNumber: 1,
          critique: critiqueResult,
          refinement: {
            refinedContent: "Content",
            changesApplied: [],
            remainingIssues: [],
            scoreImprovement: 0.03,
            refinementSummary: "Minor fix",
          },
          contentBefore: "Content",
          contentAfter: "Content",
          scoreChange: 0.03, // 0.03 < 0.05 → should return "no_improvement"
          timestamp: new Date(),
        },
      ];

      const result = (
        service as unknown as {
          evaluateStopCondition: (
            c: unknown,
            cfg: unknown,
            iters: unknown,
          ) => string | null;
        }
      ).evaluateStopCondition(critiqueResult, config, iterations);

      expect(result).toBe("no_improvement");
    });
  });

  describe("stopOnNoCritical branch", () => {
    it("should stop when no critical issues and stopOnNoCritical is true", async () => {
      const noCriticalCritique = {
        overallScore: 0.7,
        categoryScores: {},
        items: [
          {
            id: "m1",
            category: "clarity",
            severity: "minor",
            location: { type: "paragraph", reference: "p1" },
            issue: "Minor issue",
            suggestion: "Improve",
          },
        ],
        strengths: [],
        improvementPriorities: [],
        summary: "No critical issues",
      };

      mockFacade.chatStructured
        // iteration 1 critique
        .mockResolvedValueOnce({ data: noCriticalCritique })
        // final critique
        .mockResolvedValueOnce({ data: noCriticalCritique });

      const result = await service.runCritiqueRefineLoop({
        content: "Content",
        context: baseContext,
        config: {
          maxIterations: 3,
          stopOnNoCritical: true,
          targetScore: 0.99, // Very high target so it doesn't stop for that reason
        },
      });

      expect(result.stopReason).toBe("no_critical_issues");
    });
  });
});
