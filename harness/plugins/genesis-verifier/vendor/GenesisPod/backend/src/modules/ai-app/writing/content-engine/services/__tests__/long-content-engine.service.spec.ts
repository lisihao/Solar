/**
 * Unit tests for LongContentEngineService
 *
 * Covers:
 * - Project lifecycle (init, clear, updateTotalTasks, getProjectConfig)
 * - Task decomposition (estimateTaskScale, buildGranularityConstraintPrompt, validateTaskDecomposition)
 * - Task execution (buildTaskExecutionContext, processTaskCompletion)
 * - Continuation prompt building
 * - Report generation (getAllCompletedTaskContents, getQualityDashboard, buildFinalReport)
 * - Error paths for missing projects
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  LongContentEngineService,
  LongContentProjectConfig,
} from "../long-content-engine.service";
import { TaskGranularityService } from "../task-granularity.service";
import { ContinuationProtocolService } from "../continuation-protocol.service";
import { SlidingWindowContextService } from "../sliding-window-context.service";
import { QualityMonitorService } from "../quality-monitor.service";
import {
  DEFAULT_CONTINUATION_CONFIG,
  QualityMetrics,
  QualityTrend,
  QualityDashboard,
  TaskEstimate,
  DecompositionValidation,
  ContinuationState,
  ExpectedOutput,
} from "../../interfaces";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProjectConfig(
  overrides: Partial<LongContentProjectConfig> = {},
): LongContentProjectConfig {
  return {
    projectId: "proj-1",
    projectTitle: "Test Project",
    projectDescription: "A test project",
    totalTasks: 5,
    granularityLevel: "chapter",
    expectedWordsPerTask: 1000,
    ...overrides,
  };
}

function makeQualityMetrics(
  overrides: Partial<QualityMetrics> = {},
): QualityMetrics {
  return {
    wordCount: 1000,
    completionRatio: 1.0,
    hasStructuredEnd: true,
    overallScore: 8,
    evaluatedAt: new Date(),
    ...overrides,
  };
}

function makeQualityTrend(overrides: Partial<QualityTrend> = {}): QualityTrend {
  return {
    trend: "stable",
    trendConfidence: 0.8,
    recentScores: [8, 8, 8],
    averageScore: 8,
    scoreStdDev: 0,
    consecutiveDeclines: 0,
    consecutiveBelowThreshold: 0,
    calculatedAt: new Date(),
    ...overrides,
  };
}

function makeQualityDashboard(projectId = "proj-1"): QualityDashboard {
  return {
    projectId,
    projectTitle: "Test Project",
    progress: { completedTasks: 3, totalTasks: 5, percentage: 60 },
    quality: {
      overallScore: 8,
      trend: makeQualityTrend(),
      recentAverage: 8,
    },
    wordStats: {
      totalWords: 3000,
      averagePerTask: 1000,
      minTask: null,
      maxTask: null,
    },
    anomalies: [],
    interventions: [],
    generatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGranularityService = {
  estimateTaskScale: jest.fn(),
  buildDefaultConstraint: jest.fn(),
  buildGranularityConstraintPrompt: jest.fn(),
  validateDecomposition: jest.fn(),
};

const mockContinuationService = {
  detectContinuation: jest.fn(),
  getState: jest.fn(),
  initState: jest.fn(),
  updateState: jest.fn(),
  shouldStopContinuation: jest.fn(),
  getFinalResult: jest.fn(),
  clearState: jest.fn(),
  buildContinuationPrompt: jest.fn(),
};

const mockSlidingWindowService = {
  initProject: jest.fn(),
  clearProject: jest.fn(),
  buildWorkingMemory: jest.fn(),
  slideWindow: jest.fn(),
  getAllCompletedTaskContents: jest.fn(),
};

const mockQualityService = {
  initProject: jest.fn(),
  clearProject: jest.fn(),
  updateTotalTasks: jest.fn(),
  evaluateTask: jest.fn(),
  updateTrend: jest.fn(),
  getInterventionRecommendation: jest.fn(),
  applyIntervention: jest.fn(),
  getDashboard: jest.fn(),
  buildQualityReminderPrompt: jest.fn(),
};

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("LongContentEngineService", () => {
  let service: LongContentEngineService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LongContentEngineService,
        { provide: TaskGranularityService, useValue: mockGranularityService },
        {
          provide: ContinuationProtocolService,
          useValue: mockContinuationService,
        },
        {
          provide: SlidingWindowContextService,
          useValue: mockSlidingWindowService,
        },
        { provide: QualityMonitorService, useValue: mockQualityService },
      ],
    }).compile();

    service = module.get<LongContentEngineService>(LongContentEngineService);
  });

  // =========================================================================
  // Project lifecycle
  // =========================================================================

  describe("initProject", () => {
    it("stores config and delegates to sliding window + quality services", async () => {
      const config = makeProjectConfig();
      await service.initProject(config);

      expect(mockSlidingWindowService.initProject).toHaveBeenCalledWith(
        "proj-1",
        expect.objectContaining({ title: "Test Project", totalTasks: 5 }),
      );
      expect(mockQualityService.initProject).toHaveBeenCalledWith(
        "proj-1",
        expect.objectContaining({ title: "Test Project", totalTasks: 5 }),
      );
    });

    it("stores the project config so getProjectConfig returns it", async () => {
      const config = makeProjectConfig();
      await service.initProject(config);

      expect(service.getProjectConfig("proj-1")).toEqual(config);
    });
  });

  describe("clearProject", () => {
    it("removes config and delegates to sub-services", async () => {
      await service.initProject(makeProjectConfig());
      service.clearProject("proj-1");

      expect(service.getProjectConfig("proj-1")).toBeUndefined();
      expect(mockSlidingWindowService.clearProject).toHaveBeenCalledWith(
        "proj-1",
      );
      expect(mockQualityService.clearProject).toHaveBeenCalledWith("proj-1");
    });
  });

  describe("updateTotalTasks", () => {
    it("updates stored config and delegates to quality service", async () => {
      await service.initProject(makeProjectConfig({ totalTasks: 5 }));
      service.updateTotalTasks("proj-1", 10);

      expect(service.getProjectConfig("proj-1")!.totalTasks).toBe(10);
      expect(mockQualityService.updateTotalTasks).toHaveBeenCalledWith(
        "proj-1",
        10,
      );
    });

    it("does not throw when project is not found", () => {
      expect(() => service.updateTotalTasks("unknown-proj", 10)).not.toThrow();
      expect(mockQualityService.updateTotalTasks).toHaveBeenCalledWith(
        "unknown-proj",
        10,
      );
    });
  });

  describe("getProjectConfig", () => {
    it("returns undefined for unknown project", () => {
      expect(service.getProjectConfig("nonexistent")).toBeUndefined();
    });
  });

  // =========================================================================
  // Task decomposition
  // =========================================================================

  describe("estimateTaskScale", () => {
    it("delegates to granularity service", async () => {
      const estimate: TaskEstimate = {
        estimatedTokensPerTask: 2000,
        recommendedGranularity: "chapter",
        totalTasks: 10,
        parallelBatches: 2,
        tasksPerBatch: 5,
        estimatedTotalTokens: 20000,
        warnings: [],
        requiresContinuation: false,
      };
      mockGranularityService.estimateTaskScale.mockResolvedValue(estimate);

      const result = await service.estimateTaskScale("Write a novel");

      expect(mockGranularityService.estimateTaskScale).toHaveBeenCalledWith(
        "Write a novel",
        undefined,
      );
      expect(result).toBe(estimate);
    });

    it("passes options through to granularity service", async () => {
      mockGranularityService.estimateTaskScale.mockResolvedValue(
        {} as TaskEstimate,
      );
      const opts = { totalTargetWords: 50000 };

      await service.estimateTaskScale("Write something", opts);

      expect(mockGranularityService.estimateTaskScale).toHaveBeenCalledWith(
        "Write something",
        opts,
      );
    });
  });

  describe("buildGranularityConstraintPrompt", () => {
    it("throws when project not found", () => {
      expect(() => service.buildGranularityConstraintPrompt("unknown")).toThrow(
        "Project not found: unknown",
      );
    });

    it("builds constraint and delegates to granularity service", async () => {
      await service.initProject(makeProjectConfig());
      const fakeConstraint = { level: "chapter" } as never;
      mockGranularityService.buildDefaultConstraint.mockReturnValue(
        fakeConstraint,
      );
      mockGranularityService.buildGranularityConstraintPrompt.mockReturnValue(
        "Your task is a CHAPTER.",
      );

      const result = service.buildGranularityConstraintPrompt("proj-1");

      expect(
        mockGranularityService.buildDefaultConstraint,
      ).toHaveBeenCalledWith(
        "chapter",
        expect.objectContaining({
          expectedTotalTasks: 5,
          maxOutputPerTask: 2000,
        }),
      );
      expect(result).toBe("Your task is a CHAPTER.");
    });

    it("passes options through to granularity service", async () => {
      await service.initProject(makeProjectConfig());
      mockGranularityService.buildDefaultConstraint.mockReturnValue({});
      mockGranularityService.buildGranularityConstraintPrompt.mockReturnValue(
        "prompt",
      );

      const opts = { projectType: "novel" };
      service.buildGranularityConstraintPrompt("proj-1", opts);

      expect(
        mockGranularityService.buildGranularityConstraintPrompt,
      ).toHaveBeenCalledWith({}, opts);
    });
  });

  describe("validateTaskDecomposition", () => {
    it("throws when project not found", () => {
      expect(() => service.validateTaskDecomposition("unknown", [])).toThrow(
        "Project not found: unknown",
      );
    });

    it("delegates to granularity service with built constraint", async () => {
      await service.initProject(makeProjectConfig());
      const fakeConstraint = { level: "chapter" } as never;
      mockGranularityService.buildDefaultConstraint.mockReturnValue(
        fakeConstraint,
      );
      const fakeValidation: DecompositionValidation = {
        valid: true,
        violations: [],
        stats: { originalTaskCount: 2, totalEstimatedWords: 2000 },
      };
      mockGranularityService.validateDecomposition.mockReturnValue(
        fakeValidation,
      );

      const tasks = [
        { title: "Ch1", description: "First chapter" },
        { title: "Ch2", description: "Second chapter" },
      ];
      const result = service.validateTaskDecomposition("proj-1", tasks);

      expect(mockGranularityService.validateDecomposition).toHaveBeenCalledWith(
        tasks,
        fakeConstraint,
      );
      expect(result).toBe(fakeValidation);
    });
  });

  // =========================================================================
  // Task execution
  // =========================================================================

  describe("buildTaskExecutionContext", () => {
    it("throws when project not found", async () => {
      await expect(
        service.buildTaskExecutionContext("unknown", "task-1", "content"),
      ).rejects.toThrow("Project not found: unknown");
    });

    it("returns execution context with workingMemory, granularityPrompt, qualityReminder", async () => {
      await service.initProject(makeProjectConfig());

      const workingMemory = {
        projectContext: "ctx",
        recentHistory: [],
        currentTask: { id: "t1", title: "T1", content: "content" },
        relevantHistory: [],
        windowMetadata: {} as never,
      };
      mockSlidingWindowService.buildWorkingMemory.mockResolvedValue(
        workingMemory,
      );

      const fakeConstraint = { level: "chapter" } as never;
      mockGranularityService.buildDefaultConstraint.mockReturnValue(
        fakeConstraint,
      );
      mockGranularityService.buildGranularityConstraintPrompt.mockReturnValue(
        "granularity-prompt",
      );

      const dashboard = makeQualityDashboard();
      mockQualityService.getDashboard.mockReturnValue(dashboard);
      mockQualityService.buildQualityReminderPrompt.mockReturnValue(
        "quality-reminder",
      );

      const result = await service.buildTaskExecutionContext(
        "proj-1",
        "task-1",
        "my content",
      );

      expect(result.workingMemory).toBe(workingMemory);
      expect(result.granularityPrompt).toBe("granularity-prompt");
      expect(result.qualityReminder).toBe("quality-reminder");
      expect(result.qualityTrend).toBeDefined();
    });

    it("silently ignores quality service errors (no quality data yet)", async () => {
      await service.initProject(makeProjectConfig());
      mockSlidingWindowService.buildWorkingMemory.mockResolvedValue({});
      mockGranularityService.buildDefaultConstraint.mockReturnValue({});
      mockGranularityService.buildGranularityConstraintPrompt.mockReturnValue(
        "prompt",
      );
      mockQualityService.getDashboard.mockImplementation(() => {
        throw new Error("No data yet");
      });

      const result = await service.buildTaskExecutionContext(
        "proj-1",
        "task-1",
        "content",
      );

      expect(result.qualityReminder).toBe("");
      expect(result.qualityTrend).toBeUndefined();
    });

    it("passes relevantQuery option to slidingWindowService", async () => {
      await service.initProject(makeProjectConfig());
      mockSlidingWindowService.buildWorkingMemory.mockResolvedValue({});
      mockGranularityService.buildDefaultConstraint.mockReturnValue({});
      mockGranularityService.buildGranularityConstraintPrompt.mockReturnValue(
        "",
      );
      mockQualityService.getDashboard.mockImplementation(() => {
        throw new Error();
      });

      await service.buildTaskExecutionContext("proj-1", "task-1", "c", {
        relevantQuery: "search term",
      });

      expect(mockSlidingWindowService.buildWorkingMemory).toHaveBeenCalledWith(
        "proj-1",
        "task-1",
        "c",
        expect.objectContaining({ relevantQuery: "search term" }),
      );
    });
  });

  describe("processTaskCompletion", () => {
    const expected: ExpectedOutput = {
      minWords: 500,
      requireStructuredEnd: false,
    };

    beforeEach(async () => {
      await service.initProject(makeProjectConfig());
    });

    it("throws when project not found", async () => {
      await expect(
        service.processTaskCompletion(
          "unknown",
          "t1",
          "T1",
          "result",
          expected,
        ),
      ).rejects.toThrow("Project not found: unknown");
    });

    it("returns finalContent when no continuation needed", async () => {
      mockContinuationService.detectContinuation.mockReturnValue({
        needsContinuation: false,
        completedPortion: 1,
        lastCheckpoint: "end",
        confidence: 1,
      });
      const metrics = makeQualityMetrics();
      const trend = makeQualityTrend();
      mockQualityService.evaluateTask.mockResolvedValue(metrics);
      mockQualityService.updateTrend.mockReturnValue(trend);
      mockQualityService.getInterventionRecommendation.mockReturnValue(null);
      mockSlidingWindowService.slideWindow.mockResolvedValue(undefined);

      const result = await service.processTaskCompletion(
        "proj-1",
        "task-1",
        "Chapter 1",
        "My content here.",
        expected,
      );

      expect(result.needsContinuation).toBe(false);
      expect(result.finalContent).toBe("My content here.");
      expect(result.qualityMetrics).toBe(metrics);
      expect(result.qualityTrend).toBe(trend);
    });

    it("triggers auto-apply intervention when autoApply is true", async () => {
      mockContinuationService.detectContinuation.mockReturnValue({
        needsContinuation: false,
        completedPortion: 1,
        lastCheckpoint: "",
        confidence: 1,
      });
      mockQualityService.evaluateTask.mockResolvedValue(makeQualityMetrics());
      mockQualityService.updateTrend.mockReturnValue(makeQualityTrend());
      const intervention = {
        level: 1 as const,
        action: "soft_reminder" as const,
        reason: "quality dip",
        details: "scores dropped",
        autoApply: true,
        suggestedAt: new Date(),
      };
      mockQualityService.getInterventionRecommendation.mockReturnValue(
        intervention,
      );
      mockQualityService.applyIntervention.mockResolvedValue(undefined);
      mockSlidingWindowService.slideWindow.mockResolvedValue(undefined);

      const result = await service.processTaskCompletion(
        "proj-1",
        "task-1",
        "T1",
        "content",
        expected,
      );

      expect(mockQualityService.applyIntervention).toHaveBeenCalledWith(
        "proj-1",
        intervention,
      );
      expect(result.intervention).toBe(intervention);
    });

    it("does not call applyIntervention when autoApply is false", async () => {
      mockContinuationService.detectContinuation.mockReturnValue({
        needsContinuation: false,
        completedPortion: 1,
        lastCheckpoint: "",
        confidence: 1,
      });
      mockQualityService.evaluateTask.mockResolvedValue(makeQualityMetrics());
      mockQualityService.updateTrend.mockReturnValue(makeQualityTrend());
      const intervention = {
        level: 2 as const,
        action: "adjust_temperature" as const,
        reason: "low quality",
        details: "details",
        autoApply: false,
        suggestedAt: new Date(),
      };
      mockQualityService.getInterventionRecommendation.mockReturnValue(
        intervention,
      );
      mockSlidingWindowService.slideWindow.mockResolvedValue(undefined);

      await service.processTaskCompletion(
        "proj-1",
        "task-1",
        "T1",
        "content",
        expected,
      );

      expect(mockQualityService.applyIntervention).not.toHaveBeenCalled();
    });

    it("returns needsContinuation=true when continuation detected and stop condition is false", async () => {
      mockContinuationService.detectContinuation.mockReturnValue({
        needsContinuation: true,
        reason: "short_content" as const,
        completedPortion: 0.4,
        lastCheckpoint: "mid",
        confidence: 0.9,
      });
      mockContinuationService.getState.mockReturnValue(null);
      const fakeState: ContinuationState = {
        taskId: "task-1",
        needsContinuation: true,
        reason: "short_content",
        completedPortion: 0.4,
        lastCheckpoint: "mid",
        continuationCount: 1,
        maxContinuations: 5,
        accumulatedResult: "partial content",
        expectedTotalWords: 500,
        currentTotalWords: 200,
        startedAt: new Date(),
        lastUpdatedAt: new Date(),
      };
      mockContinuationService.initState.mockReturnValue(fakeState);
      mockContinuationService.shouldStopContinuation.mockReturnValue({
        shouldStop: false,
        reason: "completed" as const,
        details: "not done yet",
      });
      mockQualityService.evaluateTask.mockResolvedValue(makeQualityMetrics());

      const result = await service.processTaskCompletion(
        "proj-1",
        "task-1",
        "Ch1",
        "partial content",
        expected,
      );

      expect(result.needsContinuation).toBe(true);
      expect(result.continuationState).toBe(fakeState);
    });

    it("updates existing continuation state when state already exists", async () => {
      mockContinuationService.detectContinuation.mockReturnValue({
        needsContinuation: true,
        reason: "short_content" as const,
        completedPortion: 0.6,
        lastCheckpoint: "mid",
        confidence: 0.9,
      });
      const existingState: ContinuationState = {
        taskId: "task-1",
        needsContinuation: true,
        reason: "short_content",
        completedPortion: 0.4,
        lastCheckpoint: "mid",
        continuationCount: 1,
        maxContinuations: 5,
        accumulatedResult: "prev content",
        expectedTotalWords: 500,
        currentTotalWords: 200,
        startedAt: new Date(),
        lastUpdatedAt: new Date(),
      };
      mockContinuationService.getState.mockReturnValue(existingState);
      const updatedState = {
        ...existingState,
        continuationCount: 2,
        completedPortion: 0.6,
      };
      mockContinuationService.updateState.mockReturnValue(updatedState);
      mockContinuationService.shouldStopContinuation.mockReturnValue({
        shouldStop: false,
        reason: "completed" as const,
        details: "",
      });
      mockQualityService.evaluateTask.mockResolvedValue(makeQualityMetrics());

      const result = await service.processTaskCompletion(
        "proj-1",
        "task-1",
        "Ch1",
        "more content",
        expected,
      );

      expect(mockContinuationService.updateState).toHaveBeenCalled();
      expect(result.needsContinuation).toBe(true);
    });

    it("uses accumulated result when continuation stop condition triggers", async () => {
      mockContinuationService.detectContinuation.mockReturnValue({
        needsContinuation: true,
        reason: "short_content" as const,
        completedPortion: 1,
        lastCheckpoint: "end",
        confidence: 1,
      });
      mockContinuationService.getState.mockReturnValue(null);
      const state: ContinuationState = {
        taskId: "task-1",
        needsContinuation: false,
        reason: "short_content",
        completedPortion: 1,
        lastCheckpoint: "end",
        continuationCount: 5,
        maxContinuations: 5,
        accumulatedResult: "full accumulated content",
        expectedTotalWords: 500,
        currentTotalWords: 500,
        startedAt: new Date(),
        lastUpdatedAt: new Date(),
      };
      mockContinuationService.initState.mockReturnValue(state);
      mockContinuationService.shouldStopContinuation.mockReturnValue({
        shouldStop: true,
        reason: "max_continuations" as const,
        details: "max reached",
      });
      mockContinuationService.getFinalResult.mockReturnValue(
        "full accumulated content",
      );
      mockQualityService.evaluateTask.mockResolvedValue(makeQualityMetrics());
      mockQualityService.updateTrend.mockReturnValue(makeQualityTrend());
      mockQualityService.getInterventionRecommendation.mockReturnValue(null);
      mockSlidingWindowService.slideWindow.mockResolvedValue(undefined);

      const result = await service.processTaskCompletion(
        "proj-1",
        "task-1",
        "Ch1",
        "partial",
        expected,
      );

      expect(mockContinuationService.clearState).toHaveBeenCalledWith("task-1");
      expect(result.finalContent).toBe("full accumulated content");
      expect(result.needsContinuation).toBe(false);
    });

    it("uses raw taskResult when getFinalResult returns null", async () => {
      mockContinuationService.detectContinuation.mockReturnValue({
        needsContinuation: true,
        reason: "short_content" as const,
        completedPortion: 1,
        lastCheckpoint: "end",
        confidence: 1,
      });
      const state: ContinuationState = {
        taskId: "t1",
        needsContinuation: false,
        reason: "short_content",
        completedPortion: 1,
        lastCheckpoint: "end",
        continuationCount: 5,
        maxContinuations: 5,
        accumulatedResult: "",
        expectedTotalWords: 500,
        currentTotalWords: 500,
        startedAt: new Date(),
        lastUpdatedAt: new Date(),
      };
      mockContinuationService.getState.mockReturnValue(null);
      mockContinuationService.initState.mockReturnValue(state);
      mockContinuationService.shouldStopContinuation.mockReturnValue({
        shouldStop: true,
        reason: "completed" as const,
        details: "",
      });
      mockContinuationService.getFinalResult.mockReturnValue(null);
      mockQualityService.evaluateTask.mockResolvedValue(makeQualityMetrics());
      mockQualityService.updateTrend.mockReturnValue(makeQualityTrend());
      mockQualityService.getInterventionRecommendation.mockReturnValue(null);
      mockSlidingWindowService.slideWindow.mockResolvedValue(undefined);

      const result = await service.processTaskCompletion(
        "proj-1",
        "t1",
        "T1",
        "raw result",
        expected,
      );

      expect(result.finalContent).toBe("raw result");
    });

    it("uses continuationConfig from project config when provided", async () => {
      const customConfig = {
        ...DEFAULT_CONTINUATION_CONFIG,
        maxContinuations: 10,
      };
      await service.initProject(
        makeProjectConfig({ continuationConfig: customConfig }),
      );

      mockContinuationService.detectContinuation.mockReturnValue({
        needsContinuation: false,
        completedPortion: 1,
        lastCheckpoint: "",
        confidence: 1,
      });
      mockQualityService.evaluateTask.mockResolvedValue(makeQualityMetrics());
      mockQualityService.updateTrend.mockReturnValue(makeQualityTrend());
      mockQualityService.getInterventionRecommendation.mockReturnValue(null);
      mockSlidingWindowService.slideWindow.mockResolvedValue(undefined);

      await service.processTaskCompletion(
        "proj-1",
        "t1",
        "T1",
        "content",
        expected,
      );

      expect(mockContinuationService.detectContinuation).toHaveBeenCalledWith(
        "content",
        expect.any(Object),
        customConfig,
      );
    });
  });

  // =========================================================================
  // buildContinuationPrompt
  // =========================================================================

  describe("buildContinuationPrompt", () => {
    it("throws when no continuation state found", () => {
      mockContinuationService.getState.mockReturnValue(null);

      expect(() =>
        service.buildContinuationPrompt("task-1", {
          taskTitle: "Ch1",
          taskDescription: "First chapter",
        }),
      ).toThrow("No continuation state found for task: task-1");
    });

    it("delegates to continuation service when state exists", () => {
      const fakeState = { taskId: "task-1" } as ContinuationState;
      mockContinuationService.getState.mockReturnValue(fakeState);
      mockContinuationService.buildContinuationPrompt.mockReturnValue(
        "continue from here",
      );

      const opts = { taskTitle: "Ch1", taskDescription: "desc" };
      const result = service.buildContinuationPrompt("task-1", opts);

      expect(
        mockContinuationService.buildContinuationPrompt,
      ).toHaveBeenCalledWith(fakeState, opts);
      expect(result).toBe("continue from here");
    });
  });

  // =========================================================================
  // Report generation
  // =========================================================================

  describe("getAllCompletedTaskContents", () => {
    it("delegates to sliding window service", async () => {
      await service.initProject(makeProjectConfig());
      const contents = [{ taskId: "t1", title: "T1", content: "text" }];
      mockSlidingWindowService.getAllCompletedTaskContents.mockReturnValue(
        contents,
      );

      const result = service.getAllCompletedTaskContents("proj-1");

      expect(
        mockSlidingWindowService.getAllCompletedTaskContents,
      ).toHaveBeenCalledWith("proj-1");
      expect(result).toBe(contents);
    });
  });

  describe("getQualityDashboard", () => {
    it("delegates to quality service", async () => {
      await service.initProject(makeProjectConfig());
      const dashboard = makeQualityDashboard();
      mockQualityService.getDashboard.mockReturnValue(dashboard);

      const result = service.getQualityDashboard("proj-1");

      expect(mockQualityService.getDashboard).toHaveBeenCalledWith("proj-1");
      expect(result).toBe(dashboard);
    });
  });

  describe("buildFinalReport", () => {
    it("throws when project not found", async () => {
      await expect(service.buildFinalReport("unknown")).rejects.toThrow(
        "Project not found: unknown",
      );
    });

    it("builds a full report with all chapters", async () => {
      await service.initProject(
        makeProjectConfig({ projectTitle: "My Novel" }),
      );

      mockSlidingWindowService.getAllCompletedTaskContents.mockReturnValue([
        {
          taskId: "t1",
          title: "Introduction",
          content: "Hello world content here.",
        },
        {
          taskId: "t2",
          title: "Chapter One",
          content: "More content follows.",
        },
      ]);

      const dashboard = makeQualityDashboard();
      mockQualityService.getDashboard.mockReturnValue(dashboard);

      const result = await service.buildFinalReport("proj-1");

      expect(result.fullContent).toContain("My Novel");
      expect(result.fullContent).toContain("Introduction");
      expect(result.fullContent).toContain("Chapter One");
      expect(result.fullContent).toContain("Hello world content here.");
      expect(result.fullContent).toContain("第1章");
      expect(result.fullContent).toContain("第2章");
      expect(result.dashboard).toBe(dashboard);
    });

    it("includes quality stats in the executive summary", async () => {
      await service.initProject(makeProjectConfig());
      mockSlidingWindowService.getAllCompletedTaskContents.mockReturnValue([]);
      const dashboard = makeQualityDashboard();
      mockQualityService.getDashboard.mockReturnValue(dashboard);

      const result = await service.buildFinalReport("proj-1");

      expect(result.fullContent).toContain("60.0%");
      expect(result.fullContent).toContain("3000");
      expect(result.fullContent).toContain("8.0/10");
    });

    it("handles empty task contents gracefully", async () => {
      await service.initProject(makeProjectConfig());
      mockSlidingWindowService.getAllCompletedTaskContents.mockReturnValue([]);
      mockQualityService.getDashboard.mockReturnValue(makeQualityDashboard());

      const result = await service.buildFinalReport("proj-1");

      expect(result.fullContent).toBeDefined();
      expect(result.fullContent).not.toContain("第1章");
    });
  });
});
