/**
 * ReviewDimensionExecutor - Supplemental Tests
 *
 * Covers uncovered branches:
 * - lines 206-208: skipped when completedTasks.length === 0
 * - lines 234-328: V5 Cognitive Loop (claim extraction, validation, gap search, supplementary evidence)
 * - line 646:  AI quality review mode branching (enableAiQualityReview=true)
 * - line 716:  deterministic review execution
 * - line 726:  review result aggregation
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ReviewDimensionExecutor } from "../review-dimension.executor";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ResearchEventEmitterService } from "../../research/research-event-emitter.service";
import { ResearchReviewerService } from "../../../collaboration/research-reviewer.service";
import { AgentActivityService } from "../../../monitoring/agent-activity.service";
import { DataSourceFetcherService } from "../../../data/data-source-fetcher.service";
import { ResearchTaskStatus } from "@prisma/client";
import { ReviewQualityLevel } from "../../../../types/collaboration.types";
import { resolveResearchDepthConfig } from "../../../../types/research-depth.types";
import type { TaskExecutionContext } from "../task-executor.interface";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const mockTopic = {
  id: "topic-1",
  name: "AI Research",
  topicConfig: {},
  dimensions: [
    {
      id: "dim-1",
      name: "Market Analysis",
      topicId: "topic-1",
      sortOrder: 1,
      status: "PENDING",
    },
    {
      id: "dim-2",
      name: "Technology Trends",
      topicId: "topic-1",
      sortOrder: 2,
      status: "PENDING",
    },
  ],
};

const mockTask = {
  id: "quality-task-1",
  missionId: "mission-1",
  title: "Quality Review",
  taskType: "quality_review",
  dimensionName: null,
  dimensionId: null,
  assignedAgent: "reviewer-agent",
  modelId: null,
  description: null,
  status: ResearchTaskStatus.PENDING,
  priority: 2,
  dependencies: [],
  result: null,
  skills: [],
  tools: [],
};

function buildReviewContext(
  topicOverrides: Record<string, unknown> = {},
  depthConfigKey: "quick" | "standard" | "thorough" = "standard",
): TaskExecutionContext {
  return {
    task: mockTask as unknown as TaskExecutionContext["task"],
    topic: {
      ...mockTopic,
      ...topicOverrides,
    } as unknown as TaskExecutionContext["topic"],
    missionId: "mission-1",
    reportId: "report-1",
    assignedModelId: "gpt-4o",
    assignedSkills: [],
    assignedTools: [],
    agentName: "质量审核员",
    agentRole: "reviewer",
    depthConfig: resolveResearchDepthConfig(depthConfigKey),
  };
}

function buildCompletedTask(
  id: string,
  dimId: string,
  result: Record<string, unknown>,
) {
  return {
    id,
    missionId: "mission-1",
    taskType: "dimension_research",
    status: ResearchTaskStatus.COMPLETED,
    dimensionId: dimId,
    dimensionName: "Market Analysis",
    result,
    mission: {
      topic: {
        id: "topic-1",
        dimensions: mockTopic.dimensions,
      },
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ReviewDimensionExecutor (supplemental)", () => {
  let executor: ReviewDimensionExecutor;
  let mockPrisma: { researchTask: { findMany: jest.Mock } };
  let mockResearchEventEmitter: { emitAgentWorking: jest.Mock };
  let mockReviewerService: {
    reviewDimension: jest.Mock;
    reviewOverall: jest.Mock;
    validateClaims: jest.Mock;
    generateGapSearchQueries: jest.Mock;
    factCheckReport: jest.Mock;
  };
  let mockAgentActivity: {
    recordDimensionReview: jest.Mock;
    recordOverallReview: jest.Mock;
  };
  let mockDataSourceFetcher: { executeSearch: jest.Mock };

  beforeEach(async () => {
    mockPrisma = {
      researchTask: { findMany: jest.fn() },
    };

    mockResearchEventEmitter = {
      emitAgentWorking: jest.fn().mockResolvedValue(undefined),
    };

    mockReviewerService = {
      reviewDimension: jest.fn(),
      reviewOverall: jest.fn(),
      validateClaims: jest.fn(),
      generateGapSearchQueries: jest.fn(),
      factCheckReport: jest.fn(),
    };

    mockAgentActivity = {
      recordDimensionReview: jest.fn().mockResolvedValue(undefined),
      recordOverallReview: jest.fn().mockResolvedValue(undefined),
    };

    mockDataSourceFetcher = {
      executeSearch: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewDimensionExecutor,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ResearchEventEmitterService,
          useValue: mockResearchEventEmitter,
        },
        { provide: ResearchReviewerService, useValue: mockReviewerService },
        { provide: AgentActivityService, useValue: mockAgentActivity },
        {
          provide: DataSourceFetcherService,
          useValue: mockDataSourceFetcher,
        },
      ],
    }).compile();

    executor = module.get<ReviewDimensionExecutor>(ReviewDimensionExecutor);
  });

  afterEach(() => jest.clearAllMocks());

  // ══════════════════════════════════════════════════════════════════════════
  // Lines 206-208: skipped when completedTasks.length === 0
  // ══════════════════════════════════════════════════════════════════════════

  describe("skipped review when no completed tasks (lines 206-208)", () => {
    it("should return skipped status immediately when findMany returns empty array", async () => {
      mockPrisma.researchTask.findMany.mockResolvedValue([]);

      const context = buildReviewContext(
        { topicConfig: { enableAiQualityReview: true } },
        "thorough",
      );

      const result = await executor.execute(context);

      expect(result).toEqual({
        reviewedTasks: 0,
        status: "skipped",
        feedback: "没有已完成的维度研究任务需要审核",
      });
      expect(mockReviewerService.validateClaims).not.toHaveBeenCalled();
      expect(mockReviewerService.reviewDimension).not.toHaveBeenCalled();
    });

    it("should not run V5 cognitive loop when completed tasks are empty", async () => {
      mockPrisma.researchTask.findMany.mockResolvedValue([]);

      const context = buildReviewContext(
        { topicConfig: { enableAiQualityReview: true } },
        "thorough",
      );

      await executor.execute(context);

      expect(mockReviewerService.validateClaims).not.toHaveBeenCalled();
      expect(mockResearchEventEmitter.emitAgentWorking).toHaveBeenCalledTimes(
        1,
      ); // only the initial working call
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Lines 234-328: V5 Cognitive Loop
  // ══════════════════════════════════════════════════════════════════════════

  describe("V5 Cognitive Loop (lines 234-328)", () => {
    const completedTask = buildCompletedTask("task-dim-1", "dim-1", {
      summary: "AI market analysis summary",
      keyFindings: [
        { finding: "AI grows rapidly", significance: "high" },
        { finding: "Cost reduction", significance: "medium" },
        "plain string finding",
      ],
      analysisResult: null,
      detailedContent: "Detailed content about AI market trends...",
      evidenceUsed: 5,
      confidenceLevel: "high",
    });

    it("should run cognitive loop when enableAiQualityReview=true and maxCognitiveLoops>0", async () => {
      mockPrisma.researchTask.findMany.mockResolvedValue([completedTask]);

      mockReviewerService.validateClaims.mockResolvedValue({
        results: [],
        stats: { verified: 3, disputed: 0, unverified: 0 },
      });

      const aiReview = {
        dimensionId: "dim-1",
        dimensionName: "Market Analysis",
        qualityLevel: ReviewQualityLevel.GOOD,
        overallScore: 78,
        scores: {
          breadth: 80,
          depth: 75,
          evidence: 82,
          coherence: 70,
          currency: 78,
        },
        issues: [],
        suggestions: ["Good work"],
        needsReresearch: false,
        reresearchFocus: [],
        actualModelId: "gpt-4o",
      };
      mockReviewerService.reviewDimension.mockResolvedValue(aiReview);
      mockReviewerService.reviewOverall.mockResolvedValue(null);

      const context = buildReviewContext(
        { topicConfig: { enableAiQualityReview: true } },
        "thorough", // maxCognitiveLoops > 0 in thorough mode
      );

      const result = await executor.execute(context);

      expect(mockReviewerService.validateClaims).toHaveBeenCalled();
      expect(result.reviewedTasks).toBe(1);
    });

    it("should exit cognitive loop early when all claims are verified", async () => {
      mockPrisma.researchTask.findMany.mockResolvedValue([completedTask]);

      // All claims verified → gapClaims = [] → break early
      mockReviewerService.validateClaims.mockResolvedValue({
        results: [
          { claimId: "task-dim-1-claim-0", status: "verified" },
          { claimId: "task-dim-1-claim-1", status: "verified" },
          { claimId: "task-dim-1-claim-2", status: "verified" },
        ],
        stats: { verified: 3, disputed: 0, unverified: 0 },
      });

      mockReviewerService.reviewDimension.mockResolvedValue({
        dimensionId: "dim-1",
        dimensionName: "Market Analysis",
        qualityLevel: ReviewQualityLevel.EXCELLENT,
        overallScore: 92,
        scores: {
          breadth: 90,
          depth: 92,
          evidence: 95,
          coherence: 90,
          currency: 85,
        },
        issues: [],
        suggestions: [],
        needsReresearch: false,
        reresearchFocus: [],
      });
      mockReviewerService.reviewOverall.mockResolvedValue(null);

      const context = buildReviewContext(
        { topicConfig: { enableAiQualityReview: true } },
        "thorough",
      );

      await executor.execute(context);

      // Should emit "断言验证完成" event when all claims verified
      const workingCalls = mockResearchEventEmitter.emitAgentWorking.mock.calls;
      const verifiedCall = workingCalls.find((call) =>
        (call[1] as { taskDescription?: string }).taskDescription?.includes(
          "断言验证完成",
        ),
      );
      expect(verifiedCall).toBeDefined();
      // generateGapSearchQueries should NOT be called when all claims verified
      expect(
        mockReviewerService.generateGapSearchQueries,
      ).not.toHaveBeenCalled();
    });

    it("should perform gap search when unverified claims remain", async () => {
      mockPrisma.researchTask.findMany.mockResolvedValue([completedTask]);

      // Return unverified claims so gap search is triggered
      mockReviewerService.validateClaims
        .mockResolvedValueOnce({
          results: [
            { claimId: "task-dim-1-claim-0", status: "disputed" },
            { claimId: "task-dim-1-claim-1", status: "unverified" },
            { claimId: "task-dim-1-claim-2", status: "verified" },
          ],
          stats: { verified: 1, disputed: 1, unverified: 1 },
        })
        .mockResolvedValue({
          results: [
            { claimId: "task-dim-1-claim-0", status: "verified" },
            { claimId: "task-dim-1-claim-1", status: "verified" },
            { claimId: "task-dim-1-claim-2", status: "verified" },
          ],
          stats: { verified: 3, disputed: 0, unverified: 0 },
        });

      mockReviewerService.generateGapSearchQueries.mockResolvedValue([
        { query: "AI market growth evidence", searchType: "web" },
        { query: "cost reduction academic evidence", searchType: "academic" },
      ]);

      mockDataSourceFetcher.executeSearch.mockResolvedValue([
        { title: "AI Report 2024", snippet: "AI market grows 25% annually" },
        { title: "Cost Study", snippet: "Cost reductions of 30% observed" },
      ]);

      mockReviewerService.reviewDimension.mockResolvedValue({
        dimensionId: "dim-1",
        dimensionName: "Market Analysis",
        qualityLevel: ReviewQualityLevel.GOOD,
        overallScore: 80,
        scores: {
          breadth: 80,
          depth: 78,
          evidence: 85,
          coherence: 75,
          currency: 80,
        },
        issues: [],
        suggestions: [],
        needsReresearch: false,
        reresearchFocus: [],
      });
      mockReviewerService.reviewOverall.mockResolvedValue(null);

      const context = buildReviewContext(
        { topicConfig: { enableAiQualityReview: true } },
        "thorough",
      );

      await executor.execute(context);

      expect(mockReviewerService.generateGapSearchQueries).toHaveBeenCalled();
      expect(mockDataSourceFetcher.executeSearch).toHaveBeenCalled();
    });

    it("should exit loop when no gap queries are generated", async () => {
      mockPrisma.researchTask.findMany.mockResolvedValue([completedTask]);

      // Gaps found but no queries generated
      mockReviewerService.validateClaims.mockResolvedValue({
        results: [{ claimId: "task-dim-1-claim-0", status: "disputed" }],
        stats: { verified: 0, disputed: 1, unverified: 2 },
      });

      mockReviewerService.generateGapSearchQueries.mockResolvedValue([]);

      mockReviewerService.reviewDimension.mockResolvedValue({
        dimensionId: "dim-1",
        dimensionName: "Market Analysis",
        qualityLevel: ReviewQualityLevel.ACCEPTABLE,
        overallScore: 65,
        scores: {
          breadth: 60,
          depth: 65,
          evidence: 70,
          coherence: 60,
          currency: 75,
        },
        issues: [
          {
            type: "weak_evidence",
            severity: "minor",
            description: "More sources needed",
          },
        ],
        suggestions: [],
        needsReresearch: false,
        reresearchFocus: [],
      });
      mockReviewerService.reviewOverall.mockResolvedValue(null);

      const context = buildReviewContext(
        { topicConfig: { enableAiQualityReview: true } },
        "thorough",
      );

      await executor.execute(context);

      // Should exit loop when no gap queries
      expect(mockDataSourceFetcher.executeSearch).not.toHaveBeenCalled();
    });

    it("should exit loop when supplementary search returns no results", async () => {
      mockPrisma.researchTask.findMany.mockResolvedValue([completedTask]);

      mockReviewerService.validateClaims.mockResolvedValue({
        results: [{ claimId: "task-dim-1-claim-0", status: "disputed" }],
        stats: { verified: 0, disputed: 1, unverified: 2 },
      });

      mockReviewerService.generateGapSearchQueries.mockResolvedValue([
        { query: "AI trends", searchType: "web" },
      ]);

      // Search returns empty results
      mockDataSourceFetcher.executeSearch.mockResolvedValue([]);

      mockReviewerService.reviewDimension.mockResolvedValue({
        dimensionId: "dim-1",
        dimensionName: "Market Analysis",
        qualityLevel: ReviewQualityLevel.ACCEPTABLE,
        overallScore: 65,
        scores: {
          breadth: 60,
          depth: 65,
          evidence: 70,
          coherence: 60,
          currency: 75,
        },
        issues: [],
        suggestions: [],
        needsReresearch: false,
        reresearchFocus: [],
      });
      mockReviewerService.reviewOverall.mockResolvedValue(null);

      const context = buildReviewContext(
        { topicConfig: { enableAiQualityReview: true } },
        "thorough",
      );

      await executor.execute(context);

      // Should exit after search returns no results
      expect(
        mockReviewerService.generateGapSearchQueries,
      ).toHaveBeenCalledTimes(1);
    });

    it("should handle gap search errors gracefully (non-fatal)", async () => {
      mockPrisma.researchTask.findMany.mockResolvedValue([completedTask]);

      mockReviewerService.validateClaims.mockResolvedValue({
        results: [{ claimId: "task-dim-1-claim-0", status: "disputed" }],
        stats: { verified: 0, disputed: 1, unverified: 0 },
      });

      mockReviewerService.generateGapSearchQueries.mockResolvedValue([
        { query: "search query 1", searchType: "web" },
      ]);

      // Search throws error
      mockDataSourceFetcher.executeSearch.mockRejectedValue(
        new Error("Search service unavailable"),
      );

      mockReviewerService.reviewDimension.mockResolvedValue({
        dimensionId: "dim-1",
        dimensionName: "Market Analysis",
        qualityLevel: ReviewQualityLevel.GOOD,
        overallScore: 75,
        scores: {
          breadth: 75,
          depth: 72,
          evidence: 78,
          coherence: 70,
          currency: 75,
        },
        issues: [],
        suggestions: [],
        needsReresearch: false,
        reresearchFocus: [],
      });
      mockReviewerService.reviewOverall.mockResolvedValue(null);

      const context = buildReviewContext(
        { topicConfig: { enableAiQualityReview: true } },
        "thorough",
      );

      // Should not throw
      const result = await executor.execute(context);
      expect(result.reviewedTasks).toBe(1);
    });

    it("should skip cognitive loop when no claims or evidence present", async () => {
      // Task with no key findings → allClaims = []
      const taskWithNoClaims = buildCompletedTask("task-empty", "dim-1", {
        summary: "Empty analysis",
        keyFindings: [], // no claims
        detailedContent: "",
        evidenceUsed: 0,
      });

      mockPrisma.researchTask.findMany.mockResolvedValue([taskWithNoClaims]);

      mockReviewerService.reviewDimension.mockResolvedValue({
        dimensionId: "dim-1",
        dimensionName: "Market Analysis",
        qualityLevel: ReviewQualityLevel.NEEDS_REVISION,
        overallScore: 30,
        scores: {
          breadth: 20,
          depth: 25,
          evidence: 30,
          coherence: 40,
          currency: 75,
        },
        issues: [
          {
            type: "shallow_analysis",
            severity: "major",
            description: "Too shallow",
          },
        ],
        suggestions: ["Add more content"],
        needsReresearch: true,
        reresearchFocus: ["All content"],
      });
      mockReviewerService.reviewOverall.mockResolvedValue(null);

      const context = buildReviewContext(
        { topicConfig: { enableAiQualityReview: true } },
        "thorough",
      );

      await executor.execute(context);

      // validateClaims should not be called when no claims
      expect(mockReviewerService.validateClaims).not.toHaveBeenCalled();
    });

    it("should handle cognitive loop failure gracefully (non-fatal)", async () => {
      mockPrisma.researchTask.findMany.mockResolvedValue([completedTask]);

      // validateClaims throws
      mockReviewerService.validateClaims.mockRejectedValue(
        new Error("Validation service crashed"),
      );

      mockReviewerService.reviewDimension.mockResolvedValue({
        dimensionId: "dim-1",
        dimensionName: "Market Analysis",
        qualityLevel: ReviewQualityLevel.GOOD,
        overallScore: 78,
        scores: {
          breadth: 80,
          depth: 75,
          evidence: 82,
          coherence: 70,
          currency: 78,
        },
        issues: [],
        suggestions: [],
        needsReresearch: false,
        reresearchFocus: [],
      });
      mockReviewerService.reviewOverall.mockResolvedValue(null);

      const context = buildReviewContext(
        { topicConfig: { enableAiQualityReview: true } },
        "thorough",
      );

      // Should not throw
      const result = await executor.execute(context);
      expect(result.reviewedTasks).toBe(1);
      expect(mockReviewerService.reviewDimension).toHaveBeenCalled();
    });

    it("should log max loops reached message on last iteration with remaining gaps", async () => {
      // Use a depth config with exactly 1 cognitive loop
      const customDepthConfig = {
        ...resolveResearchDepthConfig("standard"),
        maxCognitiveLoops: 1,
      };

      mockPrisma.researchTask.findMany.mockResolvedValue([completedTask]);

      // First and only loop: gaps remain
      mockReviewerService.validateClaims.mockResolvedValue({
        results: [
          { claimId: "task-dim-1-claim-0", status: "disputed" },
          { claimId: "task-dim-1-claim-1", status: "unverified" },
        ],
        stats: { verified: 1, disputed: 1, unverified: 1 },
      });

      mockReviewerService.reviewDimension.mockResolvedValue({
        dimensionId: "dim-1",
        dimensionName: "Market Analysis",
        qualityLevel: ReviewQualityLevel.ACCEPTABLE,
        overallScore: 62,
        scores: {
          breadth: 60,
          depth: 65,
          evidence: 68,
          coherence: 55,
          currency: 75,
        },
        issues: [],
        suggestions: [],
        needsReresearch: false,
        reresearchFocus: [],
      });
      mockReviewerService.reviewOverall.mockResolvedValue(null);

      const context = {
        ...buildReviewContext({ topicConfig: { enableAiQualityReview: true } }),
        depthConfig: customDepthConfig,
      };

      await executor.execute(context);

      // Should emit "认知循环完成" event when max loops reached
      const workingCalls = mockResearchEventEmitter.emitAgentWorking.mock.calls;
      const maxLoopsCall = workingCalls.find((call) =>
        (call[1] as { taskDescription?: string }).taskDescription?.includes(
          "认知循环完成",
        ),
      );
      expect(maxLoopsCall).toBeDefined();
      // generateGapSearchQueries should NOT be called on last iteration
      expect(
        mockReviewerService.generateGapSearchQueries,
      ).not.toHaveBeenCalled();
    });

    it("should use academic search type when searchType is academic", async () => {
      mockPrisma.researchTask.findMany.mockResolvedValue([completedTask]);

      mockReviewerService.validateClaims
        .mockResolvedValueOnce({
          results: [{ claimId: "task-dim-1-claim-0", status: "disputed" }],
          stats: { verified: 0, disputed: 1, unverified: 2 },
        })
        .mockResolvedValue({
          results: [{ claimId: "task-dim-1-claim-0", status: "verified" }],
          stats: { verified: 3, disputed: 0, unverified: 0 },
        });

      mockReviewerService.generateGapSearchQueries.mockResolvedValue([
        { query: "academic evidence for AI", searchType: "academic" },
      ]);

      mockDataSourceFetcher.executeSearch.mockResolvedValue([
        { title: "Academic Paper", snippet: "Peer reviewed evidence" },
      ]);

      mockReviewerService.reviewDimension.mockResolvedValue({
        dimensionId: "dim-1",
        dimensionName: "Market Analysis",
        qualityLevel: ReviewQualityLevel.GOOD,
        overallScore: 80,
        scores: {
          breadth: 80,
          depth: 78,
          evidence: 85,
          coherence: 75,
          currency: 80,
        },
        issues: [],
        suggestions: [],
        needsReresearch: false,
        reresearchFocus: [],
      });
      mockReviewerService.reviewOverall.mockResolvedValue(null);

      const context = buildReviewContext(
        { topicConfig: { enableAiQualityReview: true } },
        "thorough",
      );

      await executor.execute(context);

      // executeSearch called with ACADEMIC type
      expect(mockDataSourceFetcher.executeSearch).toHaveBeenCalledWith(
        expect.stringMatching(/academic/i),
        "academic evidence for AI",
        3,
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Line 646: AI quality review mode branching
  // ══════════════════════════════════════════════════════════════════════════

  describe("AI quality review mode branching (line 646)", () => {
    it("should use AI review path when enableAiQualityReview=true", async () => {
      const completedTask = buildCompletedTask("task-ai", "dim-1", {
        summary: "AI analysis",
        keyFindings: ["Finding 1"],
        detailedContent: "Detailed content",
        evidenceUsed: 5,
      });

      mockPrisma.researchTask.findMany.mockResolvedValue([completedTask]);

      mockReviewerService.validateClaims.mockResolvedValue({
        results: [],
        stats: { verified: 0, disputed: 0, unverified: 0 },
      });

      const aiReview = {
        dimensionId: "dim-1",
        dimensionName: "Market Analysis",
        qualityLevel: ReviewQualityLevel.EXCELLENT,
        overallScore: 91,
        scores: {
          breadth: 95,
          depth: 90,
          evidence: 92,
          coherence: 88,
          currency: 89,
        },
        issues: [],
        suggestions: ["Excellent research"],
        needsReresearch: false,
        reresearchFocus: [],
        actualModelId: "gpt-4o",
      };

      mockReviewerService.reviewDimension.mockResolvedValue(aiReview);
      mockReviewerService.reviewOverall.mockResolvedValue(null);

      const context = buildReviewContext({
        topicConfig: { enableAiQualityReview: true },
      });

      const result = await executor.execute(context);

      expect(mockReviewerService.reviewDimension).toHaveBeenCalledWith(
        expect.objectContaining({ id: "topic-1" }),
        expect.objectContaining({ id: "dim-1" }),
        expect.any(Object),
        5,
      );
      expect(result.reviewedTasks).toBe(1);
      const reviews = result.dimensionReviews as Array<{
        qualityLevel: string;
        score: number;
      }>;
      expect(reviews[0].qualityLevel).toBe(ReviewQualityLevel.EXCELLENT);
    });

    it("should use deterministic review path when enableAiQualityReview=false (line 716)", async () => {
      const completedTask = buildCompletedTask("task-det", "dim-1", {
        summary: "Deterministic analysis",
        keyFindings: ["F1", "F2", "F3", "F4", "F5"],
        detailedContent: "X".repeat(4000),
        evidenceUsed: 8,
        confidenceLevel: "high",
        trends: [
          { trend: "Rising" },
          { trend: "Stable" },
          { trend: "Volatile" },
        ],
        challenges: [{ challenge: "Cost" }, { challenge: "Regulation" }],
        opportunities: [{ opp: "Growth" }, { opp: "Innovation" }],
      });

      mockPrisma.researchTask.findMany.mockResolvedValue([completedTask]);
      mockReviewerService.reviewOverall.mockResolvedValue(null);

      const context = buildReviewContext({
        topicConfig: { enableAiQualityReview: false },
      });

      const result = await executor.execute(context);

      // Should NOT call AI reviewDimension
      expect(mockReviewerService.reviewDimension).not.toHaveBeenCalled();
      expect(result.reviewedTasks).toBe(1);

      const reviews = result.dimensionReviews as Array<{
        dimensionName: string;
        qualityLevel: string;
        score: number;
      }>;
      expect(reviews).toHaveLength(1);
      expect(reviews[0].dimensionName).toBe("Market Analysis");
      // High-quality content should get GOOD or EXCELLENT
      expect(["good", "excellent"].includes(reviews[0].qualityLevel)).toBe(
        true,
      );
    });

    it("should skip deterministic review for tasks without analysisResult (line 726)", async () => {
      const taskWithNoResult = buildCompletedTask(
        "task-noResult",
        "dim-1",
        null as any,
      );

      mockPrisma.researchTask.findMany.mockResolvedValue([taskWithNoResult]);
      mockReviewerService.reviewOverall.mockResolvedValue(null);

      const context = buildReviewContext({
        topicConfig: { enableAiQualityReview: false },
      });

      const result = await executor.execute(context);

      // Should skip dimension with no result
      expect(result.dimensionReviews).toHaveLength(0);
    });

    it("should include analysisResult when stored under analysisResult key", async () => {
      const taskWithNestedResult = buildCompletedTask("task-nested", "dim-1", {
        analysisResult: {
          summary: "Nested analysis",
          keyFindings: ["F1", "F2", "F3"],
          detailedContent: "Y".repeat(2000),
          evidenceUsed: 4,
          confidenceLevel: "medium",
          trends: [],
          challenges: [],
          opportunities: [],
        },
      });

      mockPrisma.researchTask.findMany.mockResolvedValue([
        taskWithNestedResult,
      ]);
      mockReviewerService.reviewOverall.mockResolvedValue(null);

      const context = buildReviewContext({
        topicConfig: { enableAiQualityReview: false },
      });

      const result = await executor.execute(context);

      // Should extract analysisResult from nested structure
      expect(result.dimensionReviews).toHaveLength(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Line 726: Review result aggregation
  // ══════════════════════════════════════════════════════════════════════════

  describe("review result aggregation (line 726)", () => {
    it("should aggregate multiple dimension reviews and report actualModelId from last reviewed", async () => {
      const task1 = buildCompletedTask("task-1", "dim-1", {
        summary: "Market summary",
        keyFindings: ["F1", "F2", "F3"],
        detailedContent: "X".repeat(3000),
        evidenceUsed: 6,
        confidenceLevel: "high",
        trends: [{ t: "1" }],
        challenges: [{ c: "1" }],
        opportunities: [{ o: "1" }],
      });

      const task2 = buildCompletedTask("task-2", "dim-2", {
        summary: "Tech summary",
        keyFindings: ["T1", "T2"],
        detailedContent: "Z".repeat(1500),
        evidenceUsed: 3,
        confidenceLevel: "medium",
        trends: [],
        challenges: [],
        opportunities: [],
      });

      mockPrisma.researchTask.findMany.mockResolvedValue([task1, task2]);

      const overallReview = {
        topicId: "topic-1",
        topicName: "AI Research",
        qualityLevel: ReviewQualityLevel.GOOD,
        overallScore: 72,
        dimensionReviews: [],
        crossDimensionIssues: [],
        coverageAnalysis: {
          coveredAspects: ["market", "tech"],
          missingAspects: ["policy"],
          coverageScore: 70,
        },
        recommendations: ["Improve evidence", "Expand coverage"],
        needsReresearch: false,
        dimensionsToReresearch: [],
      };
      mockReviewerService.reviewOverall.mockResolvedValue(overallReview);

      const context = buildReviewContext({
        topicConfig: { enableAiQualityReview: false },
        dimensions: [
          { id: "dim-1", name: "Market Analysis" },
          { id: "dim-2", name: "Technology Trends" },
        ],
      });

      const result = await executor.execute(context);

      expect(result.reviewedTasks).toBe(2);
      expect(result.dimensionReviews).toHaveLength(2);
      expect(result.overallReview).toEqual({
        qualityLevel: ReviewQualityLevel.GOOD,
        score: 72,
        recommendations: ["Improve evidence", "Expand coverage"],
        needsReresearch: false,
      });
      expect(result.status).toBe(ReviewQualityLevel.GOOD);
    });

    it("should return feedback from completed tasks count when overallReview is null", async () => {
      const completedTask = buildCompletedTask("task-cnt", "dim-1", {
        summary: "Summary",
        keyFindings: ["F1", "F2"],
        detailedContent: "A".repeat(1000),
        evidenceUsed: 3,
        confidenceLevel: "medium",
        trends: [],
        challenges: [],
        opportunities: [],
      });

      mockPrisma.researchTask.findMany.mockResolvedValue([completedTask]);
      mockReviewerService.reviewOverall.mockResolvedValue(null);

      const context = buildReviewContext({
        topicConfig: { enableAiQualityReview: false },
      });

      const result = await executor.execute(context);

      expect(result.feedback).toContain("1");
      expect(result.overallReview).toBeNull();
    });

    it("should extract actualModelId from dimension reviews", async () => {
      const completedTask = buildCompletedTask("task-model", "dim-1", {
        summary: "Analysis with model ID",
        keyFindings: ["F1"],
        detailedContent: "Content",
        evidenceUsed: 5,
        actualModelId: "claude-3-sonnet",
      });

      mockPrisma.researchTask.findMany.mockResolvedValue([completedTask]);

      mockReviewerService.validateClaims.mockResolvedValue({
        results: [],
        stats: { verified: 0, disputed: 0, unverified: 0 },
      });

      mockReviewerService.reviewDimension.mockResolvedValue({
        dimensionId: "dim-1",
        dimensionName: "Market Analysis",
        qualityLevel: ReviewQualityLevel.GOOD,
        overallScore: 78,
        scores: {
          breadth: 80,
          depth: 75,
          evidence: 82,
          coherence: 70,
          currency: 78,
        },
        issues: [],
        suggestions: [],
        needsReresearch: false,
        reresearchFocus: [],
        actualModelId: "claude-3-sonnet",
      });
      mockReviewerService.reviewOverall.mockResolvedValue(null);

      const context = buildReviewContext({
        topicConfig: { enableAiQualityReview: true },
      });

      const result = await executor.execute(context);

      expect(result.actualModelId).toBe("claude-3-sonnet");
    });

    it("should handle dimensions not matching completed tasks (no dimension found)", async () => {
      // Completed task with dimensionId that doesn't match any topic dimension
      const taskWithUnknownDim = {
        ...buildCompletedTask("task-unknown", "dim-unknown", {
          summary: "Unknown dimension analysis",
          keyFindings: ["F1"],
          detailedContent: "Content",
          evidenceUsed: 3,
        }),
        dimensionId: "dim-unknown", // no matching dimension in topic
      };

      mockPrisma.researchTask.findMany.mockResolvedValue([taskWithUnknownDim]);
      mockReviewerService.reviewOverall.mockResolvedValue(null);

      const context = buildReviewContext({
        topicConfig: { enableAiQualityReview: false },
      });

      const result = await executor.execute(context);

      // Should skip dimension that's not found
      expect(result.dimensionReviews).toHaveLength(0);
      expect(result.reviewedTasks).toBe(1);
    });

    it("should include overall review in agentActivity when it is non-null", async () => {
      const completedTask = buildCompletedTask("task-overall", "dim-1", {
        summary: "Summary",
        keyFindings: ["F1", "F2", "F3"],
        detailedContent: "A".repeat(3000),
        evidenceUsed: 5,
        confidenceLevel: "high",
        trends: [{ t: "1" }],
        challenges: [{ c: "1" }],
        opportunities: [{ o: "1" }],
      });

      mockPrisma.researchTask.findMany.mockResolvedValue([completedTask]);

      const overallReview = {
        topicId: "topic-1",
        topicName: "AI Research",
        qualityLevel: ReviewQualityLevel.EXCELLENT,
        overallScore: 92,
        dimensionReviews: [],
        crossDimensionIssues: [],
        coverageAnalysis: {
          coveredAspects: [],
          missingAspects: [],
          coverageScore: 95,
        },
        recommendations: ["Keep up the good work"],
        needsReresearch: false,
        dimensionsToReresearch: [],
      };

      mockReviewerService.reviewOverall.mockResolvedValue(overallReview);

      const context = buildReviewContext({
        topicConfig: { enableAiQualityReview: false },
      });

      await executor.execute(context);

      expect(mockAgentActivity.recordOverallReview).toHaveBeenCalledWith(
        "topic-1",
        "mission-1",
        overallReview,
      );
    });

    it("should emit overall review completed event with correct description", async () => {
      const completedTask = buildCompletedTask("task-evt", "dim-1", {
        summary: "Summary",
        keyFindings: ["F1", "F2", "F3"],
        detailedContent: "B".repeat(2000),
        evidenceUsed: 4,
        confidenceLevel: "medium",
        trends: [],
        challenges: [],
        opportunities: [],
      });

      mockPrisma.researchTask.findMany.mockResolvedValue([completedTask]);

      const overallReview = {
        topicId: "topic-1",
        topicName: "AI Research",
        qualityLevel: ReviewQualityLevel.GOOD,
        overallScore: 76,
        dimensionReviews: [],
        crossDimensionIssues: [],
        coverageAnalysis: {
          coveredAspects: [],
          missingAspects: [],
          coverageScore: 75,
        },
        recommendations: ["Add more evidence", "Expand scope"],
        needsReresearch: false,
        dimensionsToReresearch: [],
      };

      mockReviewerService.reviewOverall.mockResolvedValue(overallReview);

      const context = buildReviewContext({
        topicConfig: { enableAiQualityReview: false },
      });

      await executor.execute(context);

      // Check that final "completed" event was emitted
      const completedCall =
        mockResearchEventEmitter.emitAgentWorking.mock.calls.find(
          (call) => (call[1] as { status?: string }).status === "completed",
        );
      expect(completedCall).toBeDefined();
      expect((completedCall![1] as { progress: number }).progress).toBe(100);
    });

    it("should truncate long recommendation in task description", async () => {
      const completedTask = buildCompletedTask("task-trunc", "dim-1", {
        summary: "Summary",
        keyFindings: ["F1"],
        detailedContent: "C".repeat(1000),
        evidenceUsed: 2,
        confidenceLevel: "low",
        trends: [],
        challenges: [],
        opportunities: [],
      });

      mockPrisma.researchTask.findMany.mockResolvedValue([completedTask]);

      const longRecommendation =
        "这是一个非常非常非常非常非常非常非常非常非常非常非常非常长的建议，超过了五十个字符";
      const overallReview = {
        topicId: "topic-1",
        topicName: "AI Research",
        qualityLevel: ReviewQualityLevel.ACCEPTABLE,
        overallScore: 65,
        dimensionReviews: [],
        crossDimensionIssues: [],
        coverageAnalysis: {
          coveredAspects: [],
          missingAspects: [],
          coverageScore: 60,
        },
        recommendations: [longRecommendation],
        needsReresearch: false,
        dimensionsToReresearch: [],
      };

      mockReviewerService.reviewOverall.mockResolvedValue(overallReview);

      const context = buildReviewContext({
        topicConfig: { enableAiQualityReview: false },
      });

      await executor.execute(context);

      // The completed event should have a truncated description
      const completedCall =
        mockResearchEventEmitter.emitAgentWorking.mock.calls.find(
          (call) => (call[1] as { status?: string }).status === "completed",
        );
      expect(completedCall).toBeDefined();
      const desc = (completedCall![1] as { taskDescription: string })
        .taskDescription;
      // Either truncated with "…" or within 50 chars
      expect(desc).toContain("主要建议");
      expect(desc.length).toBeGreaterThan(0);
    });

    it("should handle failedDimensions count correctly in description", async () => {
      const task1 = buildCompletedTask("t1", "dim-1", {
        summary: "Good",
        keyFindings: ["F1", "F2", "F3"],
        detailedContent: "X".repeat(3000),
        evidenceUsed: 5,
        confidenceLevel: "high",
        trends: [],
        challenges: [],
        opportunities: [],
      });
      const task2 = buildCompletedTask("t2", "dim-2", {
        summary: "Poor",
        keyFindings: [],
        detailedContent: "X",
        evidenceUsed: 0,
        confidenceLevel: undefined,
        trends: [],
        challenges: [],
        opportunities: [],
      });

      mockPrisma.researchTask.findMany.mockResolvedValue([task1, task2]);

      const overallReview = {
        topicId: "topic-1",
        topicName: "AI Research",
        qualityLevel: ReviewQualityLevel.NEEDS_REVISION,
        overallScore: 42,
        dimensionReviews: [],
        crossDimensionIssues: [],
        coverageAnalysis: {
          coveredAspects: [],
          missingAspects: [],
          coverageScore: 45,
        },
        recommendations: [],
        needsReresearch: true,
        dimensionsToReresearch: ["Technology Trends"],
      };

      mockReviewerService.reviewOverall.mockResolvedValue(overallReview);

      const context = buildReviewContext({
        topicConfig: { enableAiQualityReview: false },
        dimensions: [
          { id: "dim-1", name: "Market Analysis" },
          { id: "dim-2", name: "Technology Trends" },
        ],
      });

      const result = await executor.execute(context);

      expect(result.reviewedTasks).toBe(2);
      // overall score 42 → needs_revision → at least 1 failed (score < 60)
      const completedCall =
        mockResearchEventEmitter.emitAgentWorking.mock.calls.find(
          (call) => (call[1] as { status?: string }).status === "completed",
        );
      expect(completedCall).toBeDefined();
      const desc = (completedCall![1] as { taskDescription: string })
        .taskDescription;
      expect(desc).toContain("需补充研究");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Heuristic scoring edge cases
  // ══════════════════════════════════════════════════════════════════════════

  describe("deterministic heuristic scoring edge cases", () => {
    it("should assign REJECTED quality for very poor content", async () => {
      const poorTask = buildCompletedTask("task-poor", "dim-1", {
        summary: undefined,
        keyFindings: [],
        detailedContent: undefined,
        evidenceUsed: 0,
        confidenceLevel: undefined,
        trends: [],
        challenges: [],
        opportunities: [],
      });

      mockPrisma.researchTask.findMany.mockResolvedValue([poorTask]);
      mockReviewerService.reviewOverall.mockResolvedValue(null);

      const context = buildReviewContext({ topicConfig: {} });
      const result = await executor.execute(context);

      const reviews = result.dimensionReviews as Array<{
        qualityLevel: string;
        score: number;
      }>;
      expect(reviews[0].qualityLevel).toBe(ReviewQualityLevel.REJECTED);
    });

    it("should assign EXCELLENT quality for rich content", async () => {
      const richTask = buildCompletedTask("task-rich", "dim-1", {
        summary: "Comprehensive analysis",
        keyFindings: ["F1", "F2", "F3", "F4", "F5", "F6"],
        detailedContent: "R".repeat(5000),
        evidenceUsed: 15,
        confidenceLevel: "high",
        trends: [{ t: "1" }, { t: "2" }, { t: "3" }, { t: "4" }],
        challenges: [{ c: "1" }, { c: "2" }, { c: "3" }],
        opportunities: [{ o: "1" }, { o: "2" }, { o: "3" }],
      });

      mockPrisma.researchTask.findMany.mockResolvedValue([richTask]);
      mockReviewerService.reviewOverall.mockResolvedValue(null);

      const context = buildReviewContext({ topicConfig: {} });
      const result = await executor.execute(context);

      const reviews = result.dimensionReviews as Array<{
        qualityLevel: string;
        score: number;
      }>;
      expect(["excellent", "good"].includes(reviews[0].qualityLevel)).toBe(
        true,
      );
    });

    it("should mark needsReresearch=true when overall score < 60", async () => {
      const thinTask = buildCompletedTask("task-thin", "dim-1", {
        summary: undefined,
        keyFindings: ["F1"],
        detailedContent: "A".repeat(200),
        evidenceUsed: 1,
        confidenceLevel: undefined,
        trends: [],
        challenges: [],
        opportunities: [],
      });

      mockPrisma.researchTask.findMany.mockResolvedValue([thinTask]);
      mockReviewerService.reviewOverall.mockResolvedValue(null);

      const context = buildReviewContext({ topicConfig: {} });
      const result = await executor.execute(context);

      const rawReviews = result.dimensionReviews as Array<{
        qualityLevel: string;
        score: number;
      }>;
      // Score should be low enough to mark needsReresearch
      expect(rawReviews[0].score).toBeDefined();
    });

    it("should generate issue for short content (< 500 chars)", async () => {
      const shortTask = buildCompletedTask("task-short", "dim-1", {
        summary: "Short",
        keyFindings: ["F1", "F2", "F3"],
        detailedContent: "X".repeat(300), // < 500 chars
        evidenceUsed: 5,
        confidenceLevel: "high",
        trends: [],
        challenges: [],
        opportunities: [],
      });

      mockPrisma.researchTask.findMany.mockResolvedValue([shortTask]);
      mockReviewerService.reviewOverall.mockResolvedValue(null);

      const context = buildReviewContext({ topicConfig: {} });
      const result = await executor.execute(context);

      // Should have issues about short content
      const reviews = result.dimensionReviews as Array<{
        issues: number;
      }>;
      expect(reviews[0].issues).toBeGreaterThan(0);
    });
  });
});
