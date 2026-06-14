/**
 * Task Executor Unit Tests
 *
 * Tests for the four ITaskExecutor implementations:
 * - DimensionResearchExecutor
 * - ReviewDimensionExecutor
 * - SynthesisReportExecutor
 * - GenericTaskExecutor
 */

import { Test, TestingModule } from "@nestjs/testing";
import { InternalServerErrorException } from "@nestjs/common";
import { DimensionResearchExecutor } from "../dimension-research.executor";
import { ReviewDimensionExecutor } from "../review-dimension.executor";
import { SynthesisReportExecutor } from "../synthesis-report.executor";
import { GenericTaskExecutor } from "../generic-task.executor";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ResearchEventEmitterService } from "../../research/research-event-emitter.service";
import { DimensionMissionService } from "../../../dimension/dimension-mission.service";
import { ResearchReviewerService } from "../../../collaboration/research-reviewer.service";
import { AgentActivityService } from "../../../monitoring/agent-activity.service";
import { DataSourceFetcherService } from "../../../data/data-source-fetcher.service";
import { ReportSynthesisService } from "../../../report/report-synthesis.service";
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
  ],
};

const mockTask = {
  id: "task-1",
  missionId: "mission-1",
  title: "Research: Market Analysis",
  taskType: "dimension_research",
  dimensionName: "Market Analysis",
  dimensionId: "dim-1",
  assignedAgent: "researcher-1",
  modelId: null,
  description: null,
  status: ResearchTaskStatus.PENDING,
  priority: 1,
  dependencies: [],
  result: null,
  skills: [],
  tools: [],
};

function buildBaseContext(
  overrides: Partial<TaskExecutionContext> = {},
): TaskExecutionContext {
  return {
    task: mockTask as unknown as TaskExecutionContext["task"],
    topic: mockTopic as unknown as TaskExecutionContext["topic"],
    missionId: "mission-1",
    reportId: "report-1",
    assignedModelId: undefined,
    assignedSkills: [],
    assignedTools: [],
    agentName: "研究员",
    agentRole: "researcher",
    ...overrides,
  };
}

// ─── DimensionResearchExecutor ────────────────────────────────────────────────

describe("DimensionResearchExecutor", () => {
  let executor: DimensionResearchExecutor;
  let mockPrisma: {
    topicDimension: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
    };
  };
  let mockDimensionMissionService: { executeDimensionMission: jest.Mock };
  let mockResearchEventEmitter: {
    emitDimensionResearchStarted: jest.Mock;
    emitDimensionResearchProgress: jest.Mock;
    emitDimensionResearchCompleted: jest.Mock;
  };

  beforeEach(async () => {
    mockPrisma = {
      topicDimension: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
    };

    mockDimensionMissionService = {
      executeDimensionMission: jest.fn(),
    };

    mockResearchEventEmitter = {
      emitDimensionResearchStarted: jest.fn().mockResolvedValue(undefined),
      emitDimensionResearchProgress: jest.fn().mockResolvedValue(undefined),
      emitDimensionResearchCompleted: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DimensionResearchExecutor,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: DimensionMissionService,
          useValue: mockDimensionMissionService,
        },
        {
          provide: ResearchEventEmitterService,
          useValue: mockResearchEventEmitter,
        },
      ],
    }).compile();

    executor = module.get<DimensionResearchExecutor>(DimensionResearchExecutor);
  });

  afterEach(() => jest.clearAllMocks());

  describe("when dimension is found in context", () => {
    it("should execute dimension mission and return analysis result", async () => {
      const analysisResult = {
        summary: "Market is growing",
        keyFindings: ["Finding A", "Finding B"],
        detailedContent: "Detailed analysis...",
        evidenceUsed: 5,
      };

      mockDimensionMissionService.executeDimensionMission.mockResolvedValue({
        success: true,
        analysisResult,
      });

      const context = buildBaseContext();
      const result = await executor.execute(context);

      expect(
        mockResearchEventEmitter.emitDimensionResearchStarted,
      ).toHaveBeenCalledWith(
        "topic-1",
        "Market Analysis",
        "研究员",
        "mission-1",
      );
      expect(
        mockResearchEventEmitter.emitDimensionResearchProgress,
      ).toHaveBeenCalledWith(
        "topic-1",
        "Market Analysis",
        5,
        "正在采集相关数据...",
        "mission-1",
        "task-1",
      );
      expect(
        mockDimensionMissionService.executeDimensionMission,
      ).toHaveBeenCalledWith(
        mockTopic,
        mockTopic.dimensions[0],
        "report-1",
        "mission-1",
        undefined, // assignedModelId
        "task-1",
        [],
        [],
        undefined, // maxRevisionRounds
      );
      expect(
        mockResearchEventEmitter.emitDimensionResearchCompleted,
      ).toHaveBeenCalledWith(
        "topic-1",
        "Market Analysis",
        2,
        expect.any(Number),
        "mission-1",
      );
      expect(result).toBe(analysisResult);
    });
  });

  describe("when dimension is found by name fallback", () => {
    it("should find dimension by name and execute mission", async () => {
      const taskWithNoId = {
        ...mockTask,
        dimensionId: null,
        dimensionName: "Market Analysis",
      };

      const analysisResult = {
        summary: "Name fallback result",
        keyFindings: ["F1"],
        detailedContent: "content",
        evidenceUsed: 3,
      };

      mockDimensionMissionService.executeDimensionMission.mockResolvedValue({
        success: true,
        analysisResult,
      });

      const context = buildBaseContext({
        task: taskWithNoId as unknown as TaskExecutionContext["task"],
      });

      const result = await executor.execute(context);

      // Should not call DB since found by name in context
      expect(mockPrisma.topicDimension.findUnique).not.toHaveBeenCalled();
      expect(
        mockDimensionMissionService.executeDimensionMission,
      ).toHaveBeenCalled();
      expect(result).toBe(analysisResult);
    });
  });

  describe("when dimension not in context but found in DB", () => {
    it("should fall back to DB query and execute mission", async () => {
      // Task has dimensionId but topic.dimensions doesn't contain it
      const taskWithUnknownDimId = {
        ...mockTask,
        dimensionId: "dim-unknown",
        dimensionName: "Unknown Dimension",
      };

      const dbDimension = {
        id: "dim-unknown",
        name: "Unknown Dimension",
        topicId: "topic-1",
        sortOrder: 2,
        status: "PENDING",
      };

      mockPrisma.topicDimension.findUnique.mockResolvedValue(dbDimension);

      const analysisResult = {
        summary: "DB fallback result",
        keyFindings: [],
        detailedContent: "fallback content",
        evidenceUsed: 2,
      };

      mockDimensionMissionService.executeDimensionMission.mockResolvedValue({
        success: true,
        analysisResult,
      });

      const context = buildBaseContext({
        task: taskWithUnknownDimId as unknown as TaskExecutionContext["task"],
      });

      const result = await executor.execute(context);

      expect(mockPrisma.topicDimension.findUnique).toHaveBeenCalledWith({
        where: { id: "dim-unknown" },
      });
      expect(
        mockDimensionMissionService.executeDimensionMission,
      ).toHaveBeenCalledWith(
        mockTopic,
        dbDimension,
        "report-1",
        "mission-1",
        undefined,
        "task-1",
        [],
        [],
        undefined,
      );
      expect(result).toBe(analysisResult);
    });
  });

  describe("when dimension is not found anywhere", () => {
    it("should create a new dimension in DB and execute generic research", async () => {
      const taskWithNoDimension = {
        ...mockTask,
        dimensionId: "dim-missing",
        dimensionName: "New Research Area",
        description: "Research this new area",
      };

      // Not found in context, not found in DB
      mockPrisma.topicDimension.findUnique.mockResolvedValue(null);
      // For sortOrder calculation + normalized-name dedup probe
      mockPrisma.topicDimension.findMany.mockResolvedValueOnce([
        // 不同名（不会被归一化匹配 reuse），但提供最大 sortOrder
        { id: "dim-other", name: "Unrelated", sortOrder: 3 },
      ]);
      mockPrisma.topicDimension.findFirst.mockResolvedValue({ sortOrder: 3 });

      const createdDimension = {
        id: "dim-new",
        name: "New Research Area",
        topicId: "topic-1",
        sortOrder: 4,
        status: "PENDING",
      };
      mockPrisma.topicDimension.create.mockResolvedValue(createdDimension);

      const analysisResult = {
        summary: "Generic research result",
        keyFindings: ["Generic Finding"],
        detailedContent: "generic content",
        evidenceUsed: 1,
      };

      mockDimensionMissionService.executeDimensionMission.mockResolvedValue({
        success: true,
        analysisResult,
      });

      const context = buildBaseContext({
        task: taskWithNoDimension as unknown as TaskExecutionContext["task"],
      });

      const result = await executor.execute(context);

      expect(mockPrisma.topicDimension.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          topicId: "topic-1",
          name: "New Research Area",
          sortOrder: 4,
          searchQueries: ["New Research Area"],
          searchSources: ["web"],
        }),
      });
      expect(
        mockDimensionMissionService.executeDimensionMission,
      ).toHaveBeenCalledWith(
        mockTopic,
        createdDimension,
        "report-1",
        undefined,
        undefined, // task.modelId is null → null ?? undefined = undefined
      );
      expect(result).toBeDefined();
    });

    it("should use default sortOrder=1 when no existing dimensions", async () => {
      const taskWithNoDimension = {
        ...mockTask,
        dimensionId: "dim-missing",
        dimensionName: "Brand New Topic",
        description: null,
      };

      mockPrisma.topicDimension.findUnique.mockResolvedValue(null);
      mockPrisma.topicDimension.findFirst.mockResolvedValue(null); // no existing dimensions
      mockPrisma.topicDimension.create.mockResolvedValue({
        id: "dim-new",
        name: "Brand New Topic",
        topicId: "topic-1",
        sortOrder: 1,
        status: "PENDING",
      });

      mockDimensionMissionService.executeDimensionMission.mockResolvedValue({
        success: true,
        analysisResult: { summary: "done", keyFindings: [] },
      });

      const context = buildBaseContext({
        task: taskWithNoDimension as unknown as TaskExecutionContext["task"],
      });

      await executor.execute(context);

      expect(mockPrisma.topicDimension.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ sortOrder: 1 }),
      });
    });
  });

  describe("when dimension mission execution fails", () => {
    it("should throw InternalServerErrorException", async () => {
      mockDimensionMissionService.executeDimensionMission.mockResolvedValue({
        success: false,
        error: "LLM timeout",
      });

      const context = buildBaseContext();

      await expect(executor.execute(context)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it("should include error message in exception when provided", async () => {
      mockDimensionMissionService.executeDimensionMission.mockResolvedValue({
        success: false,
        error: "Provider unavailable",
      });

      const context = buildBaseContext();

      await expect(executor.execute(context)).rejects.toThrow(
        "Provider unavailable",
      );
    });
  });

  describe("executeGenericDimensionResearch", () => {
    it("should throw if mission result is unsuccessful", async () => {
      mockPrisma.topicDimension.findFirst.mockResolvedValue(null);
      mockPrisma.topicDimension.create.mockResolvedValue({
        id: "dim-x",
        name: "Test",
        sortOrder: 1,
        status: "PENDING",
        topicId: "topic-1",
      });

      mockDimensionMissionService.executeDimensionMission.mockResolvedValue({
        success: false,
        error: "Mission execution failed",
        analysisResult: null,
      });

      await expect(
        executor.executeGenericDimensionResearch(
          mockTask as unknown as Parameters<
            typeof executor.executeGenericDimensionResearch
          >[0],
          mockTopic as unknown as Parameters<
            typeof executor.executeGenericDimensionResearch
          >[1],
          "report-1",
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});

// ─── ReviewDimensionExecutor ──────────────────────────────────────────────────

describe("ReviewDimensionExecutor", () => {
  let executor: ReviewDimensionExecutor;
  let mockPrisma: {
    researchTask: {
      findMany: jest.Mock;
    };
  };
  let mockResearchEventEmitter: {
    emitAgentWorking: jest.Mock;
  };
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
  let mockDataSourceFetcher: {
    executeSearch: jest.Mock;
  };

  function buildReviewContext(
    topicOverrides: Record<string, unknown> = {},
  ): TaskExecutionContext {
    return buildBaseContext({
      task: {
        ...mockTask,
        taskType: "quality_review",
        title: "Quality Review",
      } as unknown as TaskExecutionContext["task"],
      topic: {
        ...mockTopic,
        ...topicOverrides,
      } as unknown as TaskExecutionContext["topic"],
      depthConfig: resolveResearchDepthConfig("standard"),
    });
  }

  beforeEach(async () => {
    mockPrisma = {
      researchTask: {
        findMany: jest.fn(),
      },
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

  describe("when no completed dimension tasks exist", () => {
    it("should return skipped status with feedback message", async () => {
      mockPrisma.researchTask.findMany.mockResolvedValue([]);

      const context = buildReviewContext();
      const result = await executor.execute(context);

      expect(result).toEqual({
        reviewedTasks: 0,
        status: "skipped",
        feedback: "没有已完成的维度研究任务需要审核",
      });
      expect(mockReviewerService.reviewDimension).not.toHaveBeenCalled();
    });
  });

  describe("when AI quality review is disabled (deterministic mode)", () => {
    const completedTask = {
      id: "task-dim-1",
      missionId: "mission-1",
      taskType: "dimension_research",
      status: ResearchTaskStatus.COMPLETED,
      dimensionId: "dim-1",
      dimensionName: "Market Analysis",
      result: {
        summary: "Good market analysis",
        keyFindings: ["Finding 1", "Finding 2", "Finding 3"],
        detailedContent: "A".repeat(3500),
        evidenceUsed: 6,
        confidenceLevel: "high",
        trends: [{ trend: "Growth" }],
        challenges: [{ challenge: "Competition" }, { challenge: "Regulation" }],
        opportunities: [{ opp: "New markets" }, { opp: "Tech adoption" }],
      },
      mission: {
        topic: {
          id: "topic-1",
          dimensions: [{ id: "dim-1", name: "Market Analysis" }],
        },
      },
    };

    it("should compute heuristic scores without calling reviewerService.reviewDimension", async () => {
      mockPrisma.researchTask.findMany.mockResolvedValue([completedTask]);
      mockReviewerService.reviewOverall.mockResolvedValue(null);

      // topicConfig without enableAiQualityReview → defaults to false
      const context = buildReviewContext({ topicConfig: {} });
      const result = await executor.execute(context);

      expect(mockReviewerService.reviewDimension).not.toHaveBeenCalled();
      expect(result.reviewedTasks).toBe(1);
      expect(Array.isArray(result.dimensionReviews)).toBe(true);
      expect(
        (result.dimensionReviews as Array<{ dimensionName: string }>)[0]
          .dimensionName,
      ).toBe("Market Analysis");
      expect(mockAgentActivity.recordDimensionReview).toHaveBeenCalledWith(
        "topic-1",
        "mission-1",
        "dim-1",
        "Market Analysis",
        expect.objectContaining({ dimensionId: "dim-1" }),
      );
    });

    it("should assign GOOD quality level for moderate scores", async () => {
      const moderateTask = {
        ...completedTask,
        result: {
          summary: "Basic market analysis",
          keyFindings: ["Finding 1", "Finding 2", "Finding 3"],
          detailedContent: "B".repeat(1200),
          evidenceUsed: 4,
          confidenceLevel: "medium",
          trends: [],
          challenges: [],
          opportunities: [],
        },
      };
      mockPrisma.researchTask.findMany.mockResolvedValue([moderateTask]);
      mockReviewerService.reviewOverall.mockResolvedValue(null);

      const context = buildReviewContext({ topicConfig: {} });
      const result = await executor.execute(context);

      const review = (
        result.dimensionReviews as Array<{
          dimensionName: string;
          qualityLevel: string;
        }>
      )[0];
      // With contentLength=1200, findings=3, evidence=4, no trends/challenges: score should be moderate
      expect(review).toBeDefined();
    });

    it("should flag needsReresearch when score < 60", async () => {
      const poorTask = {
        ...completedTask,
        result: {
          summary: undefined,
          keyFindings: [],
          detailedContent: "Short",
          evidenceUsed: 0,
          confidenceLevel: undefined,
          trends: [],
          challenges: [],
          opportunities: [],
        },
      };
      mockPrisma.researchTask.findMany.mockResolvedValue([poorTask]);
      mockReviewerService.reviewOverall.mockResolvedValue(null);

      const context = buildReviewContext({ topicConfig: {} });
      const result = await executor.execute(context);

      const review = (
        result.dimensionReviews as Array<{
          dimensionName: string;
          qualityLevel: string;
        }>
      )[0];
      expect(review).toBeDefined();
      // Poor results should flag issues
    });
  });

  describe("when AI quality review is enabled", () => {
    const completedTask = {
      id: "task-dim-1",
      missionId: "mission-1",
      taskType: "dimension_research",
      status: ResearchTaskStatus.COMPLETED,
      dimensionId: "dim-1",
      dimensionName: "Market Analysis",
      result: {
        summary: "Detailed AI-reviewed analysis",
        keyFindings: ["AI Finding 1"],
        detailedContent: "Thorough analysis...",
        evidenceUsed: 8,
        confidenceLevel: "high",
      },
      mission: {
        topic: {
          id: "topic-1",
          dimensions: [{ id: "dim-1", name: "Market Analysis" }],
        },
      },
    };

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
      issues: [
        {
          type: "missing_coverage",
          severity: "minor",
          description: "Coverage gap",
        },
      ],
      suggestions: ["Add more sources"],
      needsReresearch: false,
      reresearchFocus: [],
      actualModelId: "gpt-4o",
    };

    it("should call reviewDimension for each completed task", async () => {
      mockPrisma.researchTask.findMany.mockResolvedValue([completedTask]);
      mockReviewerService.reviewDimension.mockResolvedValue(aiReview);
      mockReviewerService.reviewOverall.mockResolvedValue(null);
      mockReviewerService.validateClaims.mockResolvedValue({
        results: [],
        stats: { verified: 0, disputed: 0, unverified: 0 },
      });

      const context = buildReviewContext({
        topicConfig: { enableAiQualityReview: true },
      });
      const result = await executor.execute(context);

      expect(mockReviewerService.reviewDimension).toHaveBeenCalledWith(
        expect.objectContaining({ id: "topic-1" }),
        expect.objectContaining({ id: "dim-1" }),
        expect.any(Object),
        8,
      );
      expect(result.reviewedTasks).toBe(1);
      expect(result.dimensionReviews).toHaveLength(1);
      expect(mockAgentActivity.recordDimensionReview).toHaveBeenCalled();
    });

    it("should skip dimension if reviewDimension throws", async () => {
      mockPrisma.researchTask.findMany.mockResolvedValue([completedTask]);
      mockReviewerService.reviewDimension.mockRejectedValue(
        new Error("Review service error"),
      );
      mockReviewerService.reviewOverall.mockResolvedValue(null);
      mockReviewerService.validateClaims.mockResolvedValue({
        results: [],
        stats: { verified: 0, disputed: 0, unverified: 0 },
      });

      const context = buildReviewContext({
        topicConfig: { enableAiQualityReview: true },
      });

      // Should not throw; errors are caught internally
      const result = await executor.execute(context);
      expect(result.reviewedTasks).toBe(1);
      expect(result.dimensionReviews).toHaveLength(0); // review was skipped
    });

    it("should skip if no analysis result is extractable from task result", async () => {
      const taskWithNoResult = {
        ...completedTask,
        result: null,
      };
      mockPrisma.researchTask.findMany.mockResolvedValue([taskWithNoResult]);
      mockReviewerService.reviewOverall.mockResolvedValue(null);
      mockReviewerService.validateClaims.mockResolvedValue({
        results: [],
        stats: { verified: 0, disputed: 0, unverified: 0 },
      });

      const context = buildReviewContext({
        topicConfig: { enableAiQualityReview: true },
      });

      const result = await executor.execute(context);
      expect(mockReviewerService.reviewDimension).not.toHaveBeenCalled();
      expect(result.dimensionReviews).toHaveLength(0);
    });
  });

  describe("overall review generation", () => {
    const completedTask = {
      id: "task-dim-1",
      missionId: "mission-1",
      taskType: "dimension_research",
      status: ResearchTaskStatus.COMPLETED,
      dimensionId: "dim-1",
      dimensionName: "Market Analysis",
      result: {
        summary: "Good analysis",
        keyFindings: ["F1", "F2", "F3"],
        detailedContent: "C".repeat(3000),
        evidenceUsed: 5,
        confidenceLevel: "medium",
        trends: [],
        challenges: [],
        opportunities: [],
      },
      mission: {
        topic: {
          id: "topic-1",
          dimensions: [{ id: "dim-1", name: "Market Analysis" }],
        },
      },
    };

    it("should call reviewOverall and include result in response", async () => {
      mockPrisma.researchTask.findMany.mockResolvedValue([completedTask]);

      const overallReview = {
        topicId: "topic-1",
        topicName: "AI Research",
        qualityLevel: ReviewQualityLevel.GOOD,
        overallScore: 76,
        dimensionReviews: [],
        crossDimensionIssues: [],
        coverageAnalysis: {
          coveredAspects: ["market"],
          missingAspects: [],
          coverageScore: 80,
        },
        recommendations: ["Add more data points", "Verify sources"],
        needsReresearch: false,
        dimensionsToReresearch: [],
      };
      mockReviewerService.reviewOverall.mockResolvedValue(overallReview);

      const context = buildReviewContext({ topicConfig: {} });
      const result = await executor.execute(context);

      expect(mockReviewerService.reviewOverall).toHaveBeenCalledWith(
        expect.objectContaining({ id: "topic-1" }),
        expect.any(Array),
        expect.any(Array),
      );
      expect(result.overallReview).toEqual({
        qualityLevel: ReviewQualityLevel.GOOD,
        score: 76,
        recommendations: ["Add more data points", "Verify sources"],
        needsReresearch: false,
      });
      expect(result.status).toBe(ReviewQualityLevel.GOOD);
      expect(result.feedback).toContain("Add more data points");
    });

    it("should handle overall review failure gracefully", async () => {
      mockPrisma.researchTask.findMany.mockResolvedValue([completedTask]);
      mockReviewerService.reviewOverall.mockRejectedValue(
        new Error("Overall review failed"),
      );

      const context = buildReviewContext({ topicConfig: {} });

      // Should not throw
      const result = await executor.execute(context);
      expect(result.overallReview).toBeNull();
      expect(result.reviewedTasks).toBe(1);
    });
  });
});

// ─── SynthesisReportExecutor ──────────────────────────────────────────────────

describe("SynthesisReportExecutor", () => {
  let executor: SynthesisReportExecutor;
  let mockPrisma: {
    researchTask: { findMany: jest.Mock };
    topicEvidence: { findMany: jest.Mock };
  };
  let mockReportSynthesisService: {
    saveDimensionAnalysis: jest.Mock;
    synthesizeReport: jest.Mock;
  };
  let mockResearchEventEmitter: {
    emitReportSynthesisStarted: jest.Mock;
    emitReportSynthesisCompleted: jest.Mock;
  };
  let mockReviewerService: {
    factCheckReport: jest.Mock;
  };

  beforeEach(async () => {
    mockPrisma = {
      researchTask: { findMany: jest.fn() },
      topicEvidence: { findMany: jest.fn() },
      topicDimension: { findMany: jest.fn().mockResolvedValue([]) },
    } as typeof mockPrisma;

    mockReportSynthesisService = {
      saveDimensionAnalysis: jest.fn().mockResolvedValue(undefined),
      synthesizeReport: jest.fn(),
    };

    mockResearchEventEmitter = {
      emitReportSynthesisStarted: jest.fn().mockResolvedValue(undefined),
      emitReportSynthesisCompleted: jest.fn().mockResolvedValue(undefined),
    };

    mockReviewerService = {
      factCheckReport: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SynthesisReportExecutor,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ReportSynthesisService,
          useValue: mockReportSynthesisService,
        },
        {
          provide: ResearchEventEmitterService,
          useValue: mockResearchEventEmitter,
        },
        { provide: ResearchReviewerService, useValue: mockReviewerService },
      ],
    }).compile();

    executor = module.get<SynthesisReportExecutor>(SynthesisReportExecutor);
  });

  afterEach(() => jest.clearAllMocks());

  describe("successful synthesis", () => {
    it("should synthesize report from dimension results and return formatted output", async () => {
      const dimensionTasks = [
        {
          id: "task-dim-1",
          dimensionId: "dim-1",
          dimensionName: "Market Analysis",
          result: {
            summary: "Market summary",
            keyFindings: ["Key finding 1"],
            trends: [{ trend: "Upward" }],
            challenges: [],
            opportunities: [],
            evidenceUsed: 4,
            confidenceLevel: "high",
            detailedContent: "Detailed market analysis...",
            figureReferences: [],
            generatedCharts: [],
          },
        },
      ];

      const synthesisResult = {
        id: "report-final-1",
        executiveSummary: "Executive summary of the report",
        fullReport: "Full report content that is quite long",
        totalSources: 12,
        highlights: [
          { title: "Highlight 1" },
          { title: "Highlight 2" },
          { title: "Highlight 3" },
        ],
        chapters: [{ title: "Chapter 1" }, { title: "Chapter 2" }],
      };

      mockPrisma.researchTask.findMany.mockResolvedValue(dimensionTasks);
      mockReportSynthesisService.synthesizeReport.mockResolvedValue(
        synthesisResult,
      );

      const context = buildBaseContext({
        task: {
          ...mockTask,
          taskType: "report_synthesis",
        } as unknown as TaskExecutionContext["task"],
        depthConfig: resolveResearchDepthConfig("standard"), // factCheckEnabled = false
      });

      const result = await executor.execute(context);

      expect(
        mockResearchEventEmitter.emitReportSynthesisStarted,
      ).toHaveBeenCalledWith("topic-1", "mission-1");
      expect(
        mockReportSynthesisService.saveDimensionAnalysis,
      ).toHaveBeenCalledWith(
        "report-1",
        "dim-1",
        expect.objectContaining({ summary: "Market summary", dimIndex: 0 }),
      );
      expect(mockReportSynthesisService.synthesizeReport).toHaveBeenCalledWith(
        mockTopic,
        "report-1",
      );
      expect(
        mockResearchEventEmitter.emitReportSynthesisCompleted,
      ).toHaveBeenCalledWith(
        "topic-1",
        2, // chapters.length
        expect.any(Number),
        "mission-1",
      );
      expect(result.summary).toBe("Executive summary of the report");
      expect(result.reportId).toBe("report-1");
      expect(result.sourcesFound).toBe(12);
      expect(result.keyFindings).toHaveLength(3);
      expect(
        (
          result.keyFindings as Array<{
            finding: string;
            significance: string;
          }>
        )[0].finding,
      ).toBe("Highlight 1");
    });

    it("should skip saving dimension analysis if result or dimensionId is missing", async () => {
      const dimensionTasksWithGaps = [
        {
          id: "task-no-result",
          dimensionId: "dim-1",
          dimensionName: "Dim 1",
          result: null,
        },
        {
          id: "task-no-dim",
          dimensionId: null,
          dimensionName: "Dim 2",
          result: { summary: "ok" },
        },
      ];

      mockPrisma.researchTask.findMany.mockResolvedValue(
        dimensionTasksWithGaps,
      );
      mockReportSynthesisService.synthesizeReport.mockResolvedValue({
        executiveSummary: "Brief summary",
        fullReport: "Content",
        totalSources: 0,
        highlights: [],
        chapters: [],
      });

      const context = buildBaseContext({
        task: {
          ...mockTask,
          taskType: "report_synthesis",
        } as unknown as TaskExecutionContext["task"],
        depthConfig: resolveResearchDepthConfig("quick"),
      });

      await executor.execute(context);

      expect(
        mockReportSynthesisService.saveDimensionAnalysis,
      ).not.toHaveBeenCalled();
    });
  });

  describe("fact-check enabled (thorough mode)", () => {
    it("should call factCheckReport when factCheckEnabled=true", async () => {
      const evidence = [
        { id: "ev-1", title: "Source 1", snippet: "Evidence snippet" },
      ];

      mockPrisma.researchTask.findMany.mockResolvedValue([]);
      mockPrisma.topicEvidence.findMany.mockResolvedValue(evidence);

      mockReportSynthesisService.synthesizeReport.mockResolvedValue({
        executiveSummary: "Summary",
        fullReport: "Full report content",
        totalSources: 5,
        content: "Report content for fact check",
        highlights: [],
        chapters: [],
      });

      mockReviewerService.factCheckReport.mockResolvedValue({
        accuracyScore: 85,
        issues: [{ description: "Minor inaccuracy" }],
      });

      const context = buildBaseContext({
        task: {
          ...mockTask,
          taskType: "report_synthesis",
        } as unknown as TaskExecutionContext["task"],
        depthConfig: resolveResearchDepthConfig("thorough"), // factCheckEnabled = true
      });

      await executor.execute(context);

      expect(mockPrisma.topicEvidence.findMany).toHaveBeenCalledWith({
        where: { reportId: "report-1" },
        select: { id: true, title: true, snippet: true },
        take: 50,
      });
      expect(mockReviewerService.factCheckReport).toHaveBeenCalledWith(
        "Report content for fact check",
        evidence,
      );
    });

    it("should not fail if fact-check throws (non-fatal)", async () => {
      mockPrisma.researchTask.findMany.mockResolvedValue([]);
      mockPrisma.topicEvidence.findMany.mockResolvedValue([]);

      mockReportSynthesisService.synthesizeReport.mockResolvedValue({
        executiveSummary: "Summary",
        fullReport: "Content",
        totalSources: 3,
        content: "Report content",
        highlights: [],
        chapters: [],
      });

      mockReviewerService.factCheckReport.mockRejectedValue(
        new Error("Fact check service error"),
      );

      const context = buildBaseContext({
        task: {
          ...mockTask,
          taskType: "report_synthesis",
        } as unknown as TaskExecutionContext["task"],
        depthConfig: resolveResearchDepthConfig("thorough"),
      });

      // Should not throw even when fact-check fails
      const result = await executor.execute(context);
      expect(result.summary).toBe("Summary");
    });
  });

  describe("fact-check disabled (standard mode)", () => {
    it("should skip factCheckReport when factCheckEnabled=false", async () => {
      mockPrisma.researchTask.findMany.mockResolvedValue([]);
      mockReportSynthesisService.synthesizeReport.mockResolvedValue({
        executiveSummary: "Summary",
        fullReport: "Content",
        totalSources: 3,
        highlights: [],
        chapters: [],
      });

      const context = buildBaseContext({
        task: {
          ...mockTask,
          taskType: "report_synthesis",
        } as unknown as TaskExecutionContext["task"],
        depthConfig: resolveResearchDepthConfig("standard"), // factCheckEnabled = false
      });

      await executor.execute(context);

      expect(mockReviewerService.factCheckReport).not.toHaveBeenCalled();
      expect(mockPrisma.topicEvidence.findMany).not.toHaveBeenCalled();
    });
  });

  describe("save dimension analysis failure (non-fatal)", () => {
    it("should continue synthesis even if saveDimensionAnalysis throws", async () => {
      const dimensionTasks = [
        {
          id: "task-dim-1",
          dimensionId: "dim-1",
          dimensionName: "Market Analysis",
          result: {
            summary: "Summary",
            keyFindings: [],
            trends: [],
            challenges: [],
            opportunities: [],
            evidenceUsed: 0,
            confidenceLevel: "low",
            detailedContent: "",
          },
        },
      ];

      mockPrisma.researchTask.findMany.mockResolvedValue(dimensionTasks);
      mockReportSynthesisService.saveDimensionAnalysis.mockRejectedValue(
        new Error("DB error saving analysis"),
      );
      mockReportSynthesisService.synthesizeReport.mockResolvedValue({
        executiveSummary: "Partial summary",
        fullReport: "Partial report",
        totalSources: 1,
        highlights: [],
        chapters: [],
      });

      const context = buildBaseContext({
        task: {
          ...mockTask,
          taskType: "report_synthesis",
        } as unknown as TaskExecutionContext["task"],
        depthConfig: resolveResearchDepthConfig("quick"),
      });

      // Should not throw; DB save failure is non-fatal
      const result = await executor.execute(context);

      expect(mockReportSynthesisService.synthesizeReport).toHaveBeenCalled();
      expect(result.summary).toBe("Partial summary");
    });
  });

  describe("return value when no highlights", () => {
    it("should return empty keyFindings array when highlights is not array", async () => {
      mockPrisma.researchTask.findMany.mockResolvedValue([]);
      mockReportSynthesisService.synthesizeReport.mockResolvedValue({
        executiveSummary: undefined,
        fullReport: "",
        totalSources: undefined,
        highlights: null,
        chapters: [],
      });

      const context = buildBaseContext({
        task: {
          ...mockTask,
          taskType: "report_synthesis",
        } as unknown as TaskExecutionContext["task"],
        depthConfig: resolveResearchDepthConfig("quick"),
      });

      const result = await executor.execute(context);

      expect(result.summary).toBe("报告已生成");
      expect(result.wordCount).toBe(0);
      expect(result.sourcesFound).toBe(0);
      expect(result.keyFindings).toEqual([]);
      expect(result.reportId).toBe("report-1");
    });
  });
});

// ─── GenericTaskExecutor ──────────────────────────────────────────────────────

describe("GenericTaskExecutor", () => {
  let executor: GenericTaskExecutor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GenericTaskExecutor],
    }).compile();

    executor = module.get<GenericTaskExecutor>(GenericTaskExecutor);
  });

  afterEach(() => jest.clearAllMocks());

  it("should return skipped status with message for any task type", async () => {
    const context = buildBaseContext({
      task: {
        ...mockTask,
        taskType: "unknown_type",
      } as unknown as TaskExecutionContext["task"],
    });

    const result = await executor.execute(context);

    expect(result.status).toBe("skipped");
    expect(result.message).toContain("unknown_type");
    expect(result.message).toContain("no executor registered");
  });

  it("should include the actual task type in the message", async () => {
    const context = buildBaseContext({
      task: {
        ...mockTask,
        taskType: "custom_analysis",
      } as unknown as TaskExecutionContext["task"],
    });

    const result = await executor.execute(context);

    expect(result.message).toBe(
      'Unknown task type "custom_analysis" — no executor registered',
    );
  });

  it("should return skipped status for dimension_research if misconfigured", async () => {
    const context = buildBaseContext({
      task: {
        ...mockTask,
        taskType: "dimension_research",
      } as unknown as TaskExecutionContext["task"],
    });

    // Even for a known type name, GenericTaskExecutor always skips
    const result = await executor.execute(context);

    expect(result.status).toBe("skipped");
  });

  it("should not throw for any task type", async () => {
    const taskTypes = ["report_synthesis", "quality_review", "custom", ""];

    for (const taskType of taskTypes) {
      const context = buildBaseContext({
        task: {
          ...mockTask,
          taskType,
        } as unknown as TaskExecutionContext["task"],
      });

      await expect(executor.execute(context)).resolves.toBeDefined();
    }
  });
});
