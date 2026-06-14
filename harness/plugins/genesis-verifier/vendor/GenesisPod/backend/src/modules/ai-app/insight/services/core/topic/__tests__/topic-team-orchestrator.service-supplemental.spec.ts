// ─── Module-level mocks (must be before any imports) ─────────────────────────
// Mock @prisma/client to provide enums that may not be available if Prisma
// schema hasn't been generated in this environment.
jest.mock("@prisma/client", () => ({
  PrismaClient: class PrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
    $on = jest.fn();
  },
  AIModelType: {
    CHAT: "CHAT",
    CHAT_FAST: "CHAT_FAST",
    REASONING: "REASONING",
    EMBEDDING: "EMBEDDING",
    IMAGE: "IMAGE",
  },
  RefreshLogStatus: {
    PENDING: "PENDING",
    RUNNING: "RUNNING",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    CANCELLED: "CANCELLED",
  },
  DimensionStatus: {
    PENDING: "PENDING",
    RESEARCHING: "RESEARCHING",
    IN_PROGRESS: "IN_PROGRESS",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
  },
  ResearchMissionStatus: {
    PENDING: "PENDING",
    RUNNING: "RUNNING",
    EXECUTING: "EXECUTING",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
  },
  ResearchTaskStatus: {
    PENDING: "PENDING",
    QUEUED: "QUEUED",
    EXECUTING: "EXECUTING",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
  },
  ResearchTodoStatus: {
    PENDING: "PENDING",
    QUEUED: "QUEUED",
    IN_PROGRESS: "IN_PROGRESS",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    ACTIVE: "ACTIVE",
  },
  ResearchTodoType: {
    LEADER_PLANNING: "LEADER_PLANNING",
    DIMENSION_RESEARCH: "DIMENSION_RESEARCH",
    REPORT_WRITING: "REPORT_WRITING",
    QUALITY_REVIEW: "QUALITY_REVIEW",
  },
  ResearchTopicStatus: {
    PENDING: "PENDING",
    ACTIVE: "ACTIVE",
    ARCHIVED: "ARCHIVED",
    FAILED: "FAILED",
  },
  AgentActivityType: {
    THINKING: "THINKING",
    TOOL_CALL: "TOOL_CALL",
  },
  TopicType: { PRIVATE: "PRIVATE", PUBLIC: "PUBLIC" },
  PrismaClient: class {
    $connect = jest.fn();
    $disconnect = jest.fn();
  },
}));
// Mock ai-harness/facade to prevent transitive imports from loading
// AIModelType.CHAT_FAST at module initialization time
jest.mock("@/modules/ai-harness/facade", () => ({
  AgentFacade: class {},
  AIFacade: class {},
  ChatFacade: class {},
  TeamFacade: class {},
  RAGFacade: class {},
  ProgressTrackerService: class {},
  // MissionContext moved from ai-kernel to ai-harness/facade in kernel-merge PR;
  // tests need a pass-through run() so nested service logic still executes.
  MissionContext: {
    run: <T>(_data: unknown, fn: () => T): T => fn(),
    get: () => undefined,
    getAgentProcessId: () => undefined,
  },
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  AgentFacade: class {},
  AIFacade: class {},
  ChatFacade: class {},
  TeamFacade: class {},
  RAGFacade: class {},
  ProgressTrackerService: class {},
  // MissionContext moved from ai-kernel to ai-harness/facade in kernel-merge PR;
  // tests need a pass-through run() so nested service logic still executes.
  MissionContext: {
    run: <T>(_data: unknown, fn: () => T): T => fn(),
    get: () => undefined,
    getAgentProcessId: () => undefined,
  },
}));
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TopicTeamOrchestratorService - Supplemental Tests
 *
 * Covers branches not in topic-team-orchestrator.service.spec.ts:
 * - cancelRefresh: no active refresh returns false
 * - cancelRefresh: active refresh cancels and returns true
 * - getRefreshStatus: not running and running variants
 * - executeRefresh: throws when refresh already in progress (from spec)
 * - getDimensionsToResearch: dimensionIds filter
 * - getDimensionsToResearch: incremental filter
 * - executeRefresh: trace starts and ends successfully
 * - executeRefresh: failure path updates log with FAILED status
 */

import { Test, TestingModule } from "@nestjs/testing";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  TopicTeamOrchestratorService,
  RefreshOptions,
} from "../topic-team-orchestrator.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { AgentFacade } from "@/modules/ai-harness/facade";
import { DimensionMissionService } from "../../../dimension/dimension-mission.service";
import { ReportSynthesisService } from "../../../report/report-synthesis.service";
import { ResearchReviewerService } from "../../../collaboration/research-reviewer.service";
import { ResearchLeaderService } from "../../research/research-leader.service";
import { ResearchCheckpointService } from "../../../monitoring/research-checkpoint.service";
import { DataSourceRouterService } from "../../../data/data-source-router.service";
import { ResearchTodoService } from "../../../collaboration/research-todo.service";
import { CritiqueRefineService } from "../../../quality/critique-refine.service";
import { RefreshLogStatus, DimensionStatus } from "@prisma/client";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makePrisma() {
  return {
    topicRefreshLog: {
      create: jest.fn().mockResolvedValue({ id: "log-1" }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    researchTopic: {
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    topicDimension: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
    researchMission: {
      create: jest.fn().mockResolvedValue({ id: "mission-1" }),
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    researchTask: {
      create: jest.fn().mockResolvedValue({ id: "task-1" }),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    researchTodo: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    topicEvidence: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

const mockSearchPhaseResult = {
  dimensionId: "dim-1",
  dimensionName: "Market Size",
  enrichedResults: [],
  evidenceData: [],
  evidenceSummary: "Evidence summary for dim-1",
  searchResultsRecord: {},
  temporalContext: {},
  figuresSummary: "No figures available",
  leaderContextSummary: "Leader context",
};

const mockDimensionOutline = {
  intentUnderstanding: {
    coreQuestion: "What is the market size?",
    scope: { included: ["AI market"], excluded: [] },
    expectedDepth: "comprehensive",
  },
  sections: [
    {
      title: "Market Overview",
      purpose: "Overview",
      keyPoints: [],
      allocatedFigures: [],
    },
  ],
  writingGuidance: "Write clearly",
};

const mockWritingResult = {
  success: true,
  dimensionId: "dim-1",
  analysisResult: {
    summary: "Market is large",
    keyFindings: [],
    trends: [],
    challenges: [],
    opportunities: [],
    confidenceLevel: "high",
    evidenceUsed: 3,
    detailedContent: "Detailed market analysis content",
    sections: [],
  },
  evidenceIds: ["ev-1"],
  extractedClaims: [],
};

function makeDimensionMissionService() {
  return {
    researchDimension: jest.fn(),
    executeSearchPhase: jest.fn().mockResolvedValue(mockSearchPhaseResult),
    executeWritingPhase: jest.fn().mockResolvedValue(mockWritingResult),
    executeAnalysisPhase: jest.fn(),
    clearEvidenceCache: jest.fn(),
  };
}

function makeReportSynthesisService() {
  return {
    createDraftReport: jest.fn().mockResolvedValue({ id: "report-1" }),
    synthesizeReport: jest.fn().mockResolvedValue({
      id: "report-1",
      status: "PUBLISHED",
      totalSources: 5,
    }),
    saveDimensionAnalysis: jest.fn().mockResolvedValue({ id: "analysis-1" }),
    linkEvidenceToReport: jest.fn().mockResolvedValue({}),
    getReport: jest.fn().mockResolvedValue(null),
  };
}

function makeResearchReviewerService() {
  return {
    reviewDimension: jest.fn().mockResolvedValue({
      dimensionId: "dim-1",
      qualityLevel: "good",
      overallScore: 80,
      scores: {
        breadth: 80,
        depth: 75,
        evidence: 85,
        coherence: 80,
        currency: 75,
      },
      issues: [],
      suggestions: [],
      needsReresearch: false,
    }),
    reviewOverall: jest.fn().mockResolvedValue({
      topicId: "topic-1",
      qualityLevel: "good",
      overallScore: 80,
      dimensionReviews: [],
      crossDimensionIssues: [],
      coverageAnalysis: {
        coveredAspects: [],
        missingAspects: [],
        coverageScore: 80,
      },
      recommendations: [],
      needsReresearch: false,
      dimensionsToReresearch: [],
    }),
    factCheckReport: jest
      .fn()
      .mockResolvedValue({ accuracyScore: 85, issues: [] }),
  };
}

function makeResearchLeaderService() {
  return {
    planResearch: jest.fn().mockResolvedValue({
      assignments: [],
      agentAssignments: [],
      parallelism: 2,
      strategy: "standard",
      dimensions: [],
    }),
    evaluateAndAssign: jest.fn().mockResolvedValue([]),
    planGlobalOutline: jest.fn().mockResolvedValue({
      dimensions: [
        {
          dimensionId: "dim-1",
          dimensionName: "Market Size",
          outline: mockDimensionOutline,
        },
      ],
      researchDesign: null,
    }),
    planDimensionOutline: jest.fn().mockResolvedValue(mockDimensionOutline),
  };
}

function makeResearchCheckpointService() {
  return {
    saveCheckpoint: jest.fn().mockResolvedValue({}),
    getCheckpoint: jest.fn().mockReturnValue(null),
  };
}

function makeDataSourceRouterService() {
  return {
    fetchEvidence: jest.fn(),
    scanLiteratureBaseline: jest.fn(),
    searchForHypothesis: jest.fn(),
  };
}

function makeResearchTodoService() {
  return {
    createTodo: jest.fn().mockResolvedValue({ id: "todo-1" }),
    updateTodoStatus: jest.fn().mockResolvedValue({}),
    completeTodo: jest.fn().mockResolvedValue({}),
    failTodo: jest.fn().mockResolvedValue({}),
    getTodoSummary: jest.fn().mockResolvedValue({ total: 1, completed: 1 }),
  };
}

function makeAgentFacade() {
  return {
    chat: jest.fn(),
    startTrace: jest.fn().mockReturnValue("trace-xyz"),
    endTrace: jest.fn(),
    addSpan: jest.fn().mockReturnValue("span-xyz"),
    endSpan: jest.fn(),
  };
}

const mockTopic = {
  id: "topic-1",
  name: "AI Market Research",
  type: "TECHNOLOGY",
  userId: "user-1",
  description: "Test research topic",
  dimensions: [],
};

const mockDimension = {
  id: "dim-1",
  name: "Market Size",
  description: "Size of market",
  sortOrder: 1,
  status: DimensionStatus.PENDING,
  searchQueries: ["market size 2024"],
  searchSources: ["web"],
  topicId: "topic-1",
};

// ---------------------------------------------------------------------------
// Build service helper
// ---------------------------------------------------------------------------

async function buildModule(
  prisma = makePrisma(),
  facade = makeAgentFacade(),
  dimensionSvc = makeDimensionMissionService(),
  reportSvc = makeReportSynthesisService(),
  reviewerSvc = makeResearchReviewerService(),
  leaderSvc = makeResearchLeaderService(),
  checkpointSvc = makeResearchCheckpointService(),
  dataSvc = makeDataSourceRouterService(),
  todoSvc = makeResearchTodoService(),
) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TopicTeamOrchestratorService,
      { provide: PrismaService, useValue: prisma },
      { provide: EventEmitter2, useValue: { emit: jest.fn(), on: jest.fn() } },
      { provide: DimensionMissionService, useValue: dimensionSvc },
      { provide: ReportSynthesisService, useValue: reportSvc },
      { provide: ResearchReviewerService, useValue: reviewerSvc },
      { provide: ResearchLeaderService, useValue: leaderSvc },
      { provide: ResearchCheckpointService, useValue: checkpointSvc },
      { provide: DataSourceRouterService, useValue: dataSvc },
      { provide: ResearchTodoService, useValue: todoSvc },
      {
        provide: CritiqueRefineService,
        useValue: { critiqueAndRefine: jest.fn() },
      },
      { provide: AgentFacade, useValue: facade },
    ],
  }).compile();
  return module.get<TopicTeamOrchestratorService>(TopicTeamOrchestratorService);
}

// ---------------------------------------------------------------------------
// Tests: cancelRefresh
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService cancelRefresh()", () => {
  it("returns false when no active refresh exists", async () => {
    const prisma = makePrisma();
    const service = await buildModule(prisma);

    const result = await service.cancelRefresh("no-such-topic");
    expect(result).toBe(false);
  });

  it("cancels an active refresh and returns true", async () => {
    const prisma = makePrisma();
    prisma.topicRefreshLog.updateMany.mockResolvedValue({ count: 1 });
    const service = await buildModule(prisma);

    // Inject an active refresh
    (
      service as unknown as { activeRefreshes: Map<string, unknown> }
    ).activeRefreshes.set("topic-cancel", {
      abortController: new AbortController(),
      startedAt: new Date(),
    });

    const result = await service.cancelRefresh("topic-cancel");
    expect(result).toBe(true);
    expect(prisma.topicRefreshLog.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          topicId: "topic-cancel",
          status: RefreshLogStatus.RUNNING,
        }),
      }),
    );
    // Should be removed from active refreshes
    expect(
      (
        service as unknown as { activeRefreshes: Map<string, unknown> }
      ).activeRefreshes.has("topic-cancel"),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: getRefreshStatus
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService getRefreshStatus()", () => {
  it("returns isRunning=false when no active refresh", async () => {
    const service = await buildModule();
    const status = service.getRefreshStatus("topic-1");
    expect(status.isRunning).toBe(false);
    expect(status.startedAt).toBeUndefined();
  });

  it("returns isRunning=true with startedAt when active", async () => {
    const service = await buildModule();
    const now = new Date();
    (
      service as unknown as { activeRefreshes: Map<string, unknown> }
    ).activeRefreshes.set("topic-1", {
      abortController: new AbortController(),
      startedAt: now,
    });

    const status = service.getRefreshStatus("topic-1");
    expect(status.isRunning).toBe(true);
    expect(status.startedAt).toEqual(now);

    // Cleanup
    (
      service as unknown as { activeRefreshes: Map<string, unknown> }
    ).activeRefreshes.delete("topic-1");
  });
});

// ---------------------------------------------------------------------------
// Tests: executeRefresh — throws when refresh already in progress
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService executeRefresh() — duplicate guard", () => {
  it("throws error when refresh already in progress for same topic", async () => {
    const service = await buildModule();
    (
      service as unknown as { activeRefreshes: Map<string, unknown> }
    ).activeRefreshes.set("topic-1", {
      abortController: new AbortController(),
      startedAt: new Date(),
    });

    await expect(service.executeRefresh(mockTopic as never)).rejects.toThrow(
      "Refresh already in progress",
    );

    // Cleanup
    (
      service as unknown as { activeRefreshes: Map<string, unknown> }
    ).activeRefreshes.delete("topic-1");
  });
});

// ---------------------------------------------------------------------------
// Tests: getDimensionsToResearch — via executeRefresh (error path)
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService getDimensionsToResearch()", () => {
  it("passes dimensionIds filter when provided in options", async () => {
    const prisma = makePrisma();
    // Return a dimension so leader planning is skipped and getDimensionsToResearch is called
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);

    // Make executeSearchPhase fail so all searches fail → throws "All dimension searches failed"
    // This causes a fatal failure AFTER getDimensionsToResearch has been called
    const dimSvc = makeDimensionMissionService();
    dimSvc.executeSearchPhase.mockRejectedValue(new Error("Search failed"));

    const service = await buildModule(prisma, undefined, dimSvc);

    const options: RefreshOptions = { dimensionIds: ["dim-1", "dim-2"] };
    try {
      await service.executeRefresh(mockTopic as never, options);
    } catch {
      // expected to throw after getDimensionsToResearch is called
    }

    expect(prisma.topicDimension.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["dim-1", "dim-2"] },
        }),
      }),
    );
  });

  it("applies incremental filter when incremental=true and forceRefresh=false", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);

    // Make executeSearchPhase fail so all searches fail → throws "All dimension searches failed"
    const dimSvc = makeDimensionMissionService();
    dimSvc.executeSearchPhase.mockRejectedValue(new Error("Search failed"));

    const service = await buildModule(prisma, undefined, dimSvc);

    const options: RefreshOptions = { incremental: true, forceRefresh: false };
    try {
      await service.executeRefresh(mockTopic as never, options);
    } catch {
      // expected
    }

    // incremental=true → where.AND 嵌套 [mission-scope OR, incremental OR]
    // 验证 incremental 子句存在（lastResearchedAt 是它的标志）
    expect(prisma.topicDimension.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.any(Array),
        }),
      }),
    );
    const findManyCall = prisma.topicDimension.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(JSON.stringify(findManyCall.where)).toContain("lastResearchedAt");
  });
});

// ---------------------------------------------------------------------------
// Tests: executeRefresh — failure path updates refresh log
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService executeRefresh() — failure log update", () => {
  it("marks refresh log as FAILED when an error occurs", async () => {
    const prisma = makePrisma();
    const reportSvc = makeReportSynthesisService();
    // Make createDraftReport fail after refreshLog is created
    reportSvc.createDraftReport.mockRejectedValue(
      new Error("Report creation failed"),
    );

    const service = await buildModule(prisma, undefined, undefined, reportSvc);

    await expect(service.executeRefresh(mockTopic as never)).rejects.toThrow(
      "Report creation failed",
    );

    expect(prisma.topicRefreshLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: RefreshLogStatus.FAILED,
        }),
      }),
    );
  });

  it("ends trace with error status on failure", async () => {
    const prisma = makePrisma();
    const facade = makeAgentFacade();
    const reportSvc = makeReportSynthesisService();
    reportSvc.createDraftReport.mockResolvedValue({ id: "r1" });
    reportSvc.synthesizeReport.mockRejectedValue(new Error("Synth failed"));

    // Set up dimensions for research to proceed
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);

    const dimensionSvc = makeDimensionMissionService();
    const leaderSvc = makeResearchLeaderService();

    const service = await buildModule(
      prisma,
      facade,
      dimensionSvc,
      reportSvc,
      undefined,
      leaderSvc,
    );

    try {
      await service.executeRefresh(mockTopic as never);
    } catch {
      // expected
    }

    expect(facade.endTrace).toHaveBeenCalledWith("trace-xyz", {
      status: "error",
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: executeRefresh — trace start on successful flow begin
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService executeRefresh() — trace start", () => {
  it("starts a trace with research_mission type", async () => {
    const prisma = makePrisma();
    const facade = makeAgentFacade();
    // Fail immediately after trace start to keep test simple
    const reportSvc = makeReportSynthesisService();
    reportSvc.createDraftReport.mockResolvedValue({ id: "r1" });
    reportSvc.synthesizeReport.mockRejectedValue(new Error("Stop after trace"));
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);

    const service = await buildModule(prisma, facade, undefined, reportSvc);

    try {
      await service.executeRefresh(mockTopic as never);
    } catch {
      // expected
    }

    expect(facade.startTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "research_mission",
        metadata: expect.objectContaining({ topicId: "topic-1" }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: executeRefresh — no dimensions leads to leader planning
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService executeRefresh() — leader AI planning", () => {
  it("calls planResearch when no dimensions exist", async () => {
    const prisma = makePrisma();
    const leaderSvc = makeResearchLeaderService();
    // Leader returns dimensions but no agentAssignments
    leaderSvc.planResearch.mockResolvedValue({
      assignments: [],
      agentAssignments: [],
      parallelism: 2,
      strategy: "standard",
      dimensions: [
        {
          name: "Market Overview",
          description: "Overview",
          priority: 1,
          searchQueries: ["overview"],
          dataSources: ["web"],
        },
      ],
    });

    // No existing dimensions
    prisma.topicDimension.findMany.mockResolvedValue([]);
    prisma.topicDimension.create.mockResolvedValue({
      id: "new-dim-1",
      name: "Market Overview",
      status: DimensionStatus.PENDING,
      searchQueries: [],
      searchSources: [],
      topicId: "topic-1",
    });

    const reportSvc = makeReportSynthesisService();
    reportSvc.createDraftReport.mockResolvedValue({ id: "r1" });
    // Fail after leader planning step to avoid full run
    reportSvc.synthesizeReport.mockRejectedValue(
      new Error("Stop after leader"),
    );

    const service = await buildModule(
      prisma,
      undefined,
      undefined,
      reportSvc,
      undefined,
      leaderSvc,
    );

    try {
      await service.executeRefresh(mockTopic as never);
    } catch {
      // expected
    }

    expect(leaderSvc.planResearch).toHaveBeenCalledWith("topic-1");
    expect(prisma.topicDimension.create).toHaveBeenCalled();
  });

  it("throws when leader returns no dimensions", async () => {
    const prisma = makePrisma();
    const leaderSvc = makeResearchLeaderService();
    leaderSvc.planResearch.mockResolvedValue({
      assignments: [],
      agentAssignments: [],
      dimensions: [], // empty
    });

    prisma.topicDimension.findMany.mockResolvedValue([]);

    const service = await buildModule(
      prisma,
      undefined,
      undefined,
      undefined,
      undefined,
      leaderSvc,
    );

    await expect(service.executeRefresh(mockTopic as never)).rejects.toThrow(
      "Leader AI failed to plan dimensions",
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: executeRefresh — researchDepth option
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService executeRefresh() — researchDepth option", () => {
  it("passes custom researchDepth to mission creation", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);

    const reportSvc = makeReportSynthesisService();
    reportSvc.createDraftReport.mockResolvedValue({ id: "r1" });
    reportSvc.synthesizeReport.mockRejectedValue(new Error("Stop"));

    const service = await buildModule(prisma, undefined, undefined, reportSvc);

    const options: RefreshOptions = { researchDepth: "thorough" };
    try {
      await service.executeRefresh(mockTopic as never, options);
    } catch {
      // expected
    }

    expect(prisma.researchMission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          researchDepth: "thorough",
        }),
      }),
    );
  });

  it("defaults to standard depth", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);

    const reportSvc = makeReportSynthesisService();
    reportSvc.createDraftReport.mockResolvedValue({ id: "r1" });
    reportSvc.synthesizeReport.mockRejectedValue(new Error("Stop"));

    const service = await buildModule(prisma, undefined, undefined, reportSvc);

    try {
      await service.executeRefresh(mockTopic as never);
    } catch {
      // expected
    }

    expect(prisma.researchMission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          researchDepth: "standard",
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: executeRefresh — mission cleanup on failure
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService executeRefresh() — failure cleanup", () => {
  it("marks mission as FAILED when missionId is set and failure occurs", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);
    prisma.researchMission.create.mockResolvedValue({ id: "mission-fail" });

    const reportSvc = makeReportSynthesisService();
    reportSvc.createDraftReport.mockResolvedValue({ id: "r1" });
    reportSvc.synthesizeReport.mockRejectedValue(new Error("Synthesis failed"));

    const service = await buildModule(prisma, undefined, undefined, reportSvc);

    await expect(service.executeRefresh(mockTopic as never)).rejects.toThrow();

    expect(prisma.researchMission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mission-fail" },
        data: expect.objectContaining({
          status: "FAILED",
        }),
      }),
    );
  });
});
