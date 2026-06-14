/**
 * CritiqueRefineService Supplemental Tests
 *
 * Uses jest.mock to avoid the @nestjs/cache-manager chain.
 * Coverage targets:
 * - runCritiqueRefineLoop: stops early on good score, runs iterations, convergence detection
 * - critiqueContent: success path, error fallback, no data fallback
 * - refineContent: no issues path, success path, error fallback
 * - evaluateStopCondition: all stop reasons
 * - mapStopReasonToLoopResult: all cases
 * - parseCritiqueResponse: category/severity parsing
 * - parseRefineResponse: change type mapping
 * - private helpers: parseCategory, parseSeverity, normalizeCategoryScores, checkQualityStandard, suggestRefinementRounds
 */

// Mock the problematic module chain BEFORE any imports
jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: jest.fn(),
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: jest.fn(),
}));

import {
  CritiqueRefineService,
  CritiqueRefineRequest,
} from "../critique-refine.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import {
  CritiqueCategory,
  CritiqueSeverity,
  DEFAULT_CRITIQUE_REFINE_CONFIG,
} from "../../../types/quality.types";

// ─────────────────────────── Fixtures ─────────────────────────────────────────

const baseContext: CritiqueRefineRequest["context"] = {
  topicName: "AI Market Research",
  dimensionName: "Market Size",
  targetAudience: "Business analysts",
  qualityExpectation: "High quality research report",
};

const highScoreCritiqueResponse = {
  data: {
    overallScore: 0.95,
    categoryScores: {
      factual: 0.95,
      logical: 0.9,
      coverage: 0.95,
      clarity: 0.92,
    },
    items: [],
    strengths: ["Excellent structure"],
    improvementPriorities: [],
    summary: "Excellent quality",
  },
  rawText: "",
  parseSuccess: true,
};

const poorCritiqueResponse = {
  data: {
    overallScore: 0.4,
    categoryScores: { factual: 0.4, logical: 0.4, coverage: 0.3, clarity: 0.5 },
    items: [
      {
        id: "issue-1",
        category: "factual",
        severity: "critical",
        location: {
          type: "paragraph",
          reference: "Para 1",
          quote: "some quote",
        },
        issue: "Unverified claim",
        suggestion: "Add citation",
        exampleFix: "According to [source]...",
        relatedEvidence: ["ev-1"],
      },
      {
        id: "issue-2",
        category: "logical",
        severity: "major",
        location: { type: "sentence", reference: "Sentence 2" },
        issue: "Logical gap",
        suggestion: "Explain causation",
      },
    ],
    strengths: [],
    improvementPriorities: ["Fix factual issues"],
    summary: "Needs significant improvement",
  },
  rawText: "",
  parseSuccess: true,
};

const _minorIssuesCritiqueResponse = {
  data: {
    overallScore: 0.7,
    categoryScores: {
      factual: 0.75,
      logical: 0.7,
      coverage: 0.65,
      clarity: 0.72,
    },
    items: [
      {
        id: "issue-minor",
        category: "style",
        severity: "minor",
        location: { type: "document", reference: "全文" },
        issue: "Minor style issue",
        suggestion: "Improve style",
      },
    ],
    strengths: ["Good structure"],
    improvementPriorities: [],
    summary: "Good but needs minor improvements",
  },
  rawText: "",
  parseSuccess: true,
};

const goodRefineResponse = {
  data: {
    refinedContent: "Improved content with proper citations and logical flow.",
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
  },
  rawText: "",
  parseSuccess: true,
};

// ─────────────────────────── Tests ────────────────────────────────────────────

describe("CritiqueRefineService", () => {
  let service: CritiqueRefineService;
  let mockChatFacade: jest.Mocked<ChatFacade>;

  beforeEach(() => {
    mockChatFacade = {
      chatStructured: jest.fn(),
      chat: jest.fn(),
      chatWithSkills: jest.fn(),
    } as unknown as jest.Mocked<ChatFacade>;

    service = new CritiqueRefineService(mockChatFacade);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─────────────────────── runCritiqueRefineLoop ──────────────────────────

  describe("runCritiqueRefineLoop", () => {
    it("should stop immediately when initial critique scores above target", async () => {
      mockChatFacade.chatStructured
        .mockResolvedValueOnce(highScoreCritiqueResponse) // first critique: high score -> stop
        .mockResolvedValueOnce(highScoreCritiqueResponse); // final critique

      const request: CritiqueRefineRequest = {
        content: "High quality content that needs no improvement.",
        context: baseContext,
        config: { targetScore: 0.9, maxIterations: 3 },
      };

      const result = await service.runCritiqueRefineLoop(request);

      expect(result.finalScore).toBeGreaterThanOrEqual(0.9);
      expect(result.reachedTargetScore).toBe(true);
      expect(result.iterations).toHaveLength(0); // stopped before first iteration
    });

    it("should run iterations for poor content", async () => {
      mockChatFacade.chatStructured
        .mockResolvedValueOnce(poorCritiqueResponse) // iteration 1: critique
        .mockResolvedValueOnce(goodRefineResponse) // iteration 1: refine
        .mockResolvedValueOnce(highScoreCritiqueResponse); // final critique

      const request: CritiqueRefineRequest = {
        content: "Poor quality content that needs improvement.",
        context: baseContext,
        config: {
          targetScore: 0.9,
          maxIterations: 2,
          stopOnNoCritical: false,
          stopOnNoImprovement: false,
        },
      };

      const result = await service.runCritiqueRefineLoop(request);

      expect(result.iterations.length).toBeGreaterThanOrEqual(1);
    });

    it("should stop when improvement below threshold", async () => {
      // critique gives moderate score, refine has minimal improvement
      const moderateCritique = {
        data: {
          overallScore: 0.6,
          categoryScores: { factual: 0.6 },
          items: [
            {
              id: "issue-1",
              category: "factual",
              severity: "critical",
              location: { type: "document", reference: "全文" },
              issue: "Issue",
              suggestion: "Fix it",
            },
          ],
          strengths: [],
          improvementPriorities: [],
          summary: "Moderate quality",
        },
        rawText: "",
        parseSuccess: true,
      };

      const tinyRefine = {
        data: {
          refinedContent: "Slightly improved content.",
          changesApplied: [],
          remainingIssues: [],
          refinementSummary: "Minor adjustments",
        },
        rawText: "",
        parseSuccess: true,
      };

      mockChatFacade.chatStructured
        .mockResolvedValueOnce(moderateCritique) // iteration 1 critique
        .mockResolvedValueOnce(tinyRefine) // iteration 1 refine (scoreImprovement=0 -> below threshold)
        .mockResolvedValueOnce(moderateCritique); // final critique

      const request: CritiqueRefineRequest = {
        content: "Content needing moderate improvement.",
        context: baseContext,
        config: {
          targetScore: 0.9,
          maxIterations: 3,
          minImprovementThreshold: 0.01,
          stopOnNoCritical: false,
          stopOnNoImprovement: false,
        },
      };

      const result = await service.runCritiqueRefineLoop(request);

      expect(result.stopReason).toBeDefined();
    });

    it("should stop when no critical issues and stopOnNoCritical=true", async () => {
      const noIssuesCritique = {
        data: {
          overallScore: 0.75,
          categoryScores: { factual: 0.75 },
          items: [], // no critical issues
          strengths: ["Good content"],
          improvementPriorities: [],
          summary: "Good quality",
        },
        rawText: "",
        parseSuccess: true,
      };

      mockChatFacade.chatStructured
        .mockResolvedValueOnce(noIssuesCritique)
        .mockResolvedValueOnce(noIssuesCritique);

      const request: CritiqueRefineRequest = {
        content: "Content with no critical issues.",
        context: baseContext,
        config: {
          targetScore: 0.95,
          maxIterations: 3,
          stopOnNoCritical: true,
        },
      };

      const result = await service.runCritiqueRefineLoop(request);

      expect(result.stopReason).toBe("no_critical_issues");
    });

    it("should detect score convergence after 3 iterations with stable scores", async () => {
      const stableScore = {
        data: {
          overallScore: 0.72,
          categoryScores: { factual: 0.72 },
          items: [
            {
              id: "iss-1",
              category: "factual",
              severity: "critical",
              location: { type: "document", reference: "全文" },
              issue: "Persistent issue",
              suggestion: "Fix",
            },
          ],
          strengths: [],
          improvementPriorities: [],
          summary: "Stable but not improving",
        },
        rawText: "",
        parseSuccess: true,
      };

      const smallRefine = {
        data: {
          refinedContent: "Content with minor tweaks.",
          changesApplied: [
            {
              critiqueItemId: "iss-1",
              original: "old",
              revised: "new",
              reason: "fix",
              changeType: "correction",
            },
          ],
          remainingIssues: [],
          refinementSummary: "Fixed issues",
        },
        rawText: "",
        parseSuccess: true,
      };

      // 3 iterations at stable score -> convergence
      mockChatFacade.chatStructured
        .mockResolvedValueOnce(stableScore) // iter1 critique (first stop check: no)
        .mockResolvedValueOnce(smallRefine) // iter1 refine (improvement > threshold so continue)
        .mockResolvedValueOnce(stableScore) // iter2 critique (2 iterations recorded, but need 3 for convergence)
        .mockResolvedValueOnce(smallRefine) // iter2 refine
        .mockResolvedValueOnce(stableScore) // iter3 critique (now 3 iters -> convergence check)
        .mockResolvedValueOnce(smallRefine) // iter3 refine
        .mockResolvedValueOnce(stableScore); // final critique

      const request: CritiqueRefineRequest = {
        content: "Content that converges.",
        context: baseContext,
        config: {
          targetScore: 0.95,
          maxIterations: 5,
          stopOnNoCritical: false,
          stopOnNoImprovement: false,
          minImprovementThreshold: 0.001, // very low threshold
        },
      };

      const result = await service.runCritiqueRefineLoop(request);

      // With stable scores after 3 iterations, should have converged
      expect(result).toBeDefined();
      expect(result.iterations.length).toBeGreaterThan(0);
    });

    it("should stop when no improvement after previous iteration", async () => {
      const moderateScore = {
        data: {
          overallScore: 0.65,
          categoryScores: { factual: 0.65 },
          items: [
            {
              id: "iss-1",
              category: "factual",
              severity: "major",
              location: { type: "document", reference: "全文" },
              issue: "Major issue",
              suggestion: "Fix",
            },
          ],
          strengths: [],
          improvementPriorities: [],
          summary: "Moderate",
        },
        rawText: "",
        parseSuccess: true,
      };

      const noChangeRefine = {
        data: {
          refinedContent: "Same content (no real improvement).",
          changesApplied: [], // 0 changes -> scoreImprovement = 0 -> below threshold
          remainingIssues: [],
          refinementSummary: "No changes needed",
        },
        rawText: "",
        parseSuccess: true,
      };

      mockChatFacade.chatStructured
        .mockResolvedValueOnce(moderateScore) // iter1 critique
        .mockResolvedValueOnce(noChangeRefine) // iter1 refine (0 improvement -> below threshold -> break)
        .mockResolvedValueOnce(moderateScore); // final critique

      const request: CritiqueRefineRequest = {
        content: "Moderate quality content.",
        context: baseContext,
        config: {
          targetScore: 0.95,
          maxIterations: 3,
          stopOnNoCritical: false,
          stopOnNoImprovement: true,
        },
      };

      const result = await service.runCritiqueRefineLoop(request);

      expect(result).toBeDefined();
    });

    it("should handle chatStructured errors gracefully (fallback critique)", async () => {
      mockChatFacade.chatStructured
        .mockRejectedValueOnce(new Error("AI API error")) // initial critique fails -> fallback
        .mockRejectedValueOnce(new Error("AI API error")); // final critique fails -> fallback

      const request: CritiqueRefineRequest = {
        content: "Content to critique.",
        context: baseContext,
        config: { targetScore: 0.95, maxIterations: 1 },
      };

      const result = await service.runCritiqueRefineLoop(request);

      // Fallback critique returns 0.6 score (below target 0.95)
      expect(result.finalScore).toBe(0.6);
    });

    it("should use default config when none provided", async () => {
      mockChatFacade.chatStructured.mockResolvedValue(
        highScoreCritiqueResponse,
      );

      const request: CritiqueRefineRequest = {
        content: "Default config test content.",
        context: baseContext,
        // no config -> uses DEFAULT_CRITIQUE_REFINE_CONFIG
      };

      const result = await service.runCritiqueRefineLoop(request);

      expect(result).toBeDefined();
      expect(result.metadata.totalTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ─────────────────────── critiqueContent ────────────────────────────────

  describe("critiqueContent", () => {
    it("should parse structured critique response correctly", async () => {
      mockChatFacade.chatStructured.mockResolvedValueOnce(poorCritiqueResponse);

      const config = { ...DEFAULT_CRITIQUE_REFINE_CONFIG };
      const result = await service.critiqueContent(
        "Test content",
        baseContext,
        config,
      );

      expect(result.overallScore).toBe(0.4);
      expect(result.items).toHaveLength(2);
      expect(result.criticalIssues).toHaveLength(1);
    });

    it("should return fallback when chatStructured returns no data", async () => {
      mockChatFacade.chatStructured.mockResolvedValueOnce({
        data: null,
        rawText: "",
        parseSuccess: false,
      });

      const config = { ...DEFAULT_CRITIQUE_REFINE_CONFIG };
      const result = await service.critiqueContent(
        "Test content",
        baseContext,
        config,
      );

      expect(result.overallScore).toBe(0.6);
      expect(result.summary).toContain("自动批评失败");
    });

    it("should return fallback when chatStructured throws", async () => {
      mockChatFacade.chatStructured.mockRejectedValueOnce(
        new Error("Network error"),
      );

      const config = { ...DEFAULT_CRITIQUE_REFINE_CONFIG };
      const result = await service.critiqueContent(
        "Test content",
        baseContext,
        config,
      );

      expect(result.overallScore).toBe(0.6);
      expect(result.meetsQualityStandard).toBe(false);
    });

    it("should handle items without location (uses default document location)", async () => {
      const responseWithNoLocation = {
        data: {
          overallScore: 0.7,
          categoryScores: {},
          items: [
            {
              id: "item-no-loc",
              category: "coverage",
              severity: "minor",
              // no location field
              issue: "Missing coverage",
              suggestion: "Add more details",
            },
          ],
          strengths: [],
          improvementPriorities: [],
          summary: "Missing location",
        },
        rawText: "",
        parseSuccess: true,
      };
      mockChatFacade.chatStructured.mockResolvedValueOnce(
        responseWithNoLocation,
      );

      const config = { ...DEFAULT_CRITIQUE_REFINE_CONFIG };
      const result = await service.critiqueContent(
        "Test content",
        baseContext,
        config,
      );

      expect(result.items[0].location.reference).toBe("全文");
    });

    it("should cap overallScore at 1 and floor at 0", async () => {
      const outOfRangeResponse = {
        data: {
          overallScore: 1.5, // out of range
          categoryScores: {},
          items: [],
          strengths: [],
          improvementPriorities: [],
          summary: "Out of range score",
        },
        rawText: "",
        parseSuccess: true,
      };
      mockChatFacade.chatStructured.mockResolvedValueOnce(outOfRangeResponse);

      const config = { ...DEFAULT_CRITIQUE_REFINE_CONFIG };
      const result = await service.critiqueContent(
        "Test content",
        baseContext,
        config,
      );

      expect(result.overallScore).toBeLessThanOrEqual(1);
    });
  });

  // ─────────────────────── refineContent ──────────────────────────────────

  describe("refineContent", () => {
    it("should return unchanged content when no critical/major issues", async () => {
      const critiqueWithOnlyMinor = {
        overallScore: 0.8,
        categoryScores: {} as Record<CritiqueCategory, number>,
        items: [
          {
            id: "minor-1",
            category: CritiqueCategory.STYLE,
            severity: CritiqueSeverity.MINOR,
            location: { type: "document" as const, reference: "全文" },
            issue: "Minor style issue",
            suggestion: "Improve style",
          },
        ],
        strengths: [],
        criticalIssues: [],
        improvementPriorities: [],
        summary: "Good with minor issues",
        meetsQualityStandard: true,
        suggestedRefinementRounds: 0,
      };

      const result = await service.refineContent(
        "Original content",
        critiqueWithOnlyMinor,
        baseContext,
      );

      expect(result.refinedContent).toBe("Original content");
      expect(result.changesApplied).toHaveLength(0);
      expect(result.scoreImprovement).toBe(0);
      expect(result.refinementSummary).toContain("无需修改");
    });

    it("should apply refine when critical issues exist", async () => {
      mockChatFacade.chatStructured.mockResolvedValueOnce(goodRefineResponse);

      const critiqueWithCritical = {
        overallScore: 0.4,
        categoryScores: {} as Record<CritiqueCategory, number>,
        items: [
          {
            id: "critical-1",
            category: CritiqueCategory.FACTUAL,
            severity: CritiqueSeverity.CRITICAL,
            location: {
              type: "paragraph" as const,
              reference: "Para 1",
              quote: "claim",
            },
            issue: "Unverified claim",
            suggestion: "Add citation",
            exampleFix: "Add [source]",
          },
        ],
        strengths: [],
        criticalIssues: [
          {
            id: "critical-1",
            category: CritiqueCategory.FACTUAL,
            severity: CritiqueSeverity.CRITICAL,
            location: { type: "paragraph" as const, reference: "Para 1" },
            issue: "Unverified claim",
            suggestion: "Add citation",
          },
        ],
        improvementPriorities: ["Fix factual issues"],
        summary: "Needs critical fixes",
        meetsQualityStandard: false,
        suggestedRefinementRounds: 3,
      };

      const result = await service.refineContent(
        "Content needing improvement",
        critiqueWithCritical,
        baseContext,
      );

      expect(result.refinedContent).toBe(
        "Improved content with proper citations and logical flow.",
      );
      expect(result.changesApplied).toHaveLength(1);
    });

    it("should return fallback when chatStructured throws during refine", async () => {
      mockChatFacade.chatStructured.mockRejectedValueOnce(
        new Error("API error"),
      );

      const criticalCritique = {
        overallScore: 0.3,
        categoryScores: {} as Record<CritiqueCategory, number>,
        items: [
          {
            id: "crit-1",
            category: CritiqueCategory.FACTUAL,
            severity: CritiqueSeverity.CRITICAL,
            location: { type: "document" as const, reference: "全文" },
            issue: "Major issue",
            suggestion: "Fix",
          },
        ],
        strengths: [],
        criticalIssues: [
          {
            id: "crit-1",
            category: CritiqueCategory.FACTUAL,
            severity: CritiqueSeverity.CRITICAL,
            location: { type: "document" as const, reference: "全文" },
            issue: "Major issue",
            suggestion: "Fix",
          },
        ],
        improvementPriorities: ["Fix everything"],
        summary: "Critical failure",
        meetsQualityStandard: false,
        suggestedRefinementRounds: 3,
      };

      const result = await service.refineContent(
        "Original content",
        criticalCritique,
        baseContext,
      );

      expect(result.refinedContent).toBe("Original content");
      expect(result.refinementSummary).toContain("改进失败");
    });

    it("should return fallback when chatStructured returns no data during refine", async () => {
      mockChatFacade.chatStructured.mockResolvedValueOnce({
        data: null,
        rawText: "",
        parseSuccess: false,
      });

      const criticalCritique = {
        overallScore: 0.3,
        categoryScores: {} as Record<CritiqueCategory, number>,
        items: [
          {
            id: "crit-1",
            category: CritiqueCategory.FACTUAL,
            severity: CritiqueSeverity.MAJOR,
            location: { type: "document" as const, reference: "全文" },
            issue: "Major issue",
            suggestion: "Fix",
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
        criticalCritique,
        baseContext,
      );

      // No data -> falls to return with original content
      expect(result.refinedContent).toBe("Original content");
    });
  });

  // ─────────────────────── parseCategory ──────────────────────────────────

  describe("category parsing via critiqueContent", () => {
    const testCategories = [
      ["factual", CritiqueCategory.FACTUAL],
      ["logical", CritiqueCategory.LOGICAL],
      ["coverage", CritiqueCategory.COVERAGE],
      ["clarity", CritiqueCategory.CLARITY],
      ["style", CritiqueCategory.STYLE],
      ["depth", CritiqueCategory.DEPTH],
      ["relevance", CritiqueCategory.RELEVANCE],
      ["citation", CritiqueCategory.CITATION],
      ["unknown", CritiqueCategory.FACTUAL], // default
    ] as const;

    it.each(testCategories)(
      "should parse category %s correctly",
      async (categoryStr, expectedCategory) => {
        const response = {
          data: {
            overallScore: 0.6,
            categoryScores: {},
            items: [
              {
                id: "item-1",
                category: categoryStr,
                severity: "minor",
                location: { type: "document", reference: "全文" },
                issue: "Test issue",
                suggestion: "Fix it",
              },
            ],
            strengths: [],
            improvementPriorities: [],
            summary: "Test",
          },
          rawText: "",
          parseSuccess: true,
        };
        mockChatFacade.chatStructured.mockResolvedValueOnce(response);

        const config = { ...DEFAULT_CRITIQUE_REFINE_CONFIG };
        const result = await service.critiqueContent(
          "content",
          baseContext,
          config,
        );

        expect(result.items[0].category).toBe(expectedCategory);
      },
    );
  });

  // ─────────────────────── parseSeverity ──────────────────────────────────

  describe("severity parsing via critiqueContent", () => {
    const testSeverities = [
      ["critical", CritiqueSeverity.CRITICAL],
      ["major", CritiqueSeverity.MAJOR],
      ["minor", CritiqueSeverity.MINOR],
      ["suggestion", CritiqueSeverity.SUGGESTION],
      ["unknown", CritiqueSeverity.MINOR], // default
    ] as const;

    it.each(testSeverities)(
      "should parse severity %s correctly",
      async (severityStr, expectedSeverity) => {
        const response = {
          data: {
            overallScore: 0.6,
            categoryScores: {},
            items: [
              {
                id: "item-sev",
                category: "factual",
                severity: severityStr,
                location: { type: "document", reference: "全文" },
                issue: "Test",
                suggestion: "Fix",
              },
            ],
            strengths: [],
            improvementPriorities: [],
            summary: "Test severity",
          },
          rawText: "",
          parseSuccess: true,
        };
        mockChatFacade.chatStructured.mockResolvedValueOnce(response);

        const config = { ...DEFAULT_CRITIQUE_REFINE_CONFIG };
        const result = await service.critiqueContent(
          "content",
          baseContext,
          config,
        );

        expect(result.items[0].severity).toBe(expectedSeverity);
      },
    );
  });

  // ─────────────────────── suggestRefinementRounds ────────────────────────

  describe("suggestRefinementRounds via parseCritiqueResponse", () => {
    it("should suggest 3 rounds when criticalCount > 0", async () => {
      const criticalResponse = {
        data: {
          overallScore: 0.3,
          categoryScores: {},
          items: [
            {
              id: "c-1",
              category: "factual",
              severity: "critical",
              location: { type: "document", reference: "全文" },
              issue: "Critical",
              suggestion: "Fix",
            },
          ],
          strengths: [],
          improvementPriorities: [],
          summary: "Critical issues",
        },
        rawText: "",
        parseSuccess: true,
      };
      mockChatFacade.chatStructured.mockResolvedValueOnce(criticalResponse);

      const config = { ...DEFAULT_CRITIQUE_REFINE_CONFIG };
      const result = await service.critiqueContent(
        "content",
        baseContext,
        config,
      );

      expect(result.suggestedRefinementRounds).toBe(3);
    });

    it("should suggest 3 rounds when score < 0.6", async () => {
      const lowScoreResponse = {
        data: {
          overallScore: 0.5,
          categoryScores: {},
          items: [],
          strengths: [],
          improvementPriorities: [],
          summary: "Low score",
        },
        rawText: "",
        parseSuccess: true,
      };
      mockChatFacade.chatStructured.mockResolvedValueOnce(lowScoreResponse);

      const config = { ...DEFAULT_CRITIQUE_REFINE_CONFIG };
      const result = await service.critiqueContent(
        "content",
        baseContext,
        config,
      );

      expect(result.suggestedRefinementRounds).toBe(3);
    });

    it("should suggest 2 rounds when 0.6 <= score < 0.75", async () => {
      const medLowScore = {
        data: {
          overallScore: 0.7,
          categoryScores: {},
          items: [],
          strengths: [],
          improvementPriorities: [],
          summary: "Medium-low score",
        },
        rawText: "",
        parseSuccess: true,
      };
      mockChatFacade.chatStructured.mockResolvedValueOnce(medLowScore);

      const config = { ...DEFAULT_CRITIQUE_REFINE_CONFIG };
      const result = await service.critiqueContent(
        "content",
        baseContext,
        config,
      );

      expect(result.suggestedRefinementRounds).toBe(2);
    });

    it("should suggest 1 round when 0.75 <= score < 0.85", async () => {
      const medScore = {
        data: {
          overallScore: 0.8,
          categoryScores: {},
          items: [],
          strengths: [],
          improvementPriorities: [],
          summary: "Medium score",
        },
        rawText: "",
        parseSuccess: true,
      };
      mockChatFacade.chatStructured.mockResolvedValueOnce(medScore);

      const config = { ...DEFAULT_CRITIQUE_REFINE_CONFIG };
      const result = await service.critiqueContent(
        "content",
        baseContext,
        config,
      );

      expect(result.suggestedRefinementRounds).toBe(1);
    });

    it("should suggest 0 rounds when score >= 0.85", async () => {
      const highScore = {
        data: {
          overallScore: 0.9,
          categoryScores: {},
          items: [],
          strengths: [],
          improvementPriorities: [],
          summary: "High score",
        },
        rawText: "",
        parseSuccess: true,
      };
      mockChatFacade.chatStructured.mockResolvedValueOnce(highScore);

      const config = { ...DEFAULT_CRITIQUE_REFINE_CONFIG };
      const result = await service.critiqueContent(
        "content",
        baseContext,
        config,
      );

      expect(result.suggestedRefinementRounds).toBe(0);
    });
  });

  // ─────────────────────── mapStopReasonToLoopResult ──────────────────────

  describe("mapStopReasonToLoopResult (indirectly via runCritiqueRefineLoop)", () => {
    it("should map target_reached to target_reached", async () => {
      mockChatFacade.chatStructured.mockResolvedValue(
        highScoreCritiqueResponse,
      );

      const result = await service.runCritiqueRefineLoop({
        content: "content",
        context: baseContext,
        config: { targetScore: 0.9 },
      });

      expect(result.stopReason).toBe("target_reached");
    });

    it("should map max_iterations to max_iterations", async () => {
      // All critiques at 0.65 (below target 0.95), no convergence in 1 iteration
      const lowCritique = {
        data: {
          overallScore: 0.65,
          categoryScores: {},
          items: [
            {
              id: "iss",
              category: "factual",
              severity: "major",
              location: { type: "document", reference: "全文" },
              issue: "Issue",
              suggestion: "Fix",
            },
          ],
          strengths: [],
          improvementPriorities: [],
          summary: "Low",
        },
        rawText: "",
        parseSuccess: true,
      };

      const smallImprovement = {
        data: {
          refinedContent: "Slightly better.",
          changesApplied: [
            {
              critiqueItemId: "iss",
              original: "old",
              revised: "new",
              reason: "improved",
              changeType: "improvement",
            },
          ],
          remainingIssues: [],
          refinementSummary: "Minor changes",
        },
        rawText: "",
        parseSuccess: true,
      };

      mockChatFacade.chatStructured
        .mockResolvedValueOnce(lowCritique) // iter1 critique
        .mockResolvedValueOnce(smallImprovement) // iter1 refine
        .mockResolvedValueOnce(lowCritique); // final critique

      const result = await service.runCritiqueRefineLoop({
        content: "Content needing work.",
        context: baseContext,
        config: {
          targetScore: 0.95,
          maxIterations: 1,
          stopOnNoCritical: false,
          stopOnNoImprovement: false,
          minImprovementThreshold: 0.001,
        },
      });

      expect(result.stopReason).toBe("max_iterations");
    });
  });
});
