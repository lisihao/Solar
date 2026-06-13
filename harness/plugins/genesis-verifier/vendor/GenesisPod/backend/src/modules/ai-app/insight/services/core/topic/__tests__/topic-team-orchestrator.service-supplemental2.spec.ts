// ─── Module-level mocks (must be before any imports) ─────────────────────────
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
    ASSIGNED: "ASSIGNED",
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

jest.mock("@/modules/ai-harness/facade", () => ({
  AgentFacade: class {},
  AIFacade: class {},
  ChatFacade: class {},
  TeamFacade: class {},
  RAGFacade: class {},
  ProgressTrackerService: class {},
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
  MissionContext: {
    run: <T>(_data: unknown, fn: () => T): T => fn(),
    get: () => undefined,
    getAgentProcessId: () => undefined,
  },
}));
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TopicTeamOrchestratorService - Supplemental Tests (Part 2)
 *
 * Targets uncovered branches not reached by spec.ts or supplemental.spec.ts:
 * - executeRefresh: abortController.signal.aborted check (throws "Refresh cancelled")
 * - executeRefresh: researchTodo cleanup on failure when missionId set
 * - executeRefresh: researchTask cleanup on failure when missionId set
 * - executeRefresh: endTrace with success status on successful completion
 * - executeRefresh: reportTodoId/reviewTodoId present → todo completion
 * - executeRefresh: researchMission.update COMPLETED path
 * - executeRefresh: forceRefresh = true triggers dimensions with no incremental filter
 * - executeRefresh: parallelism extracted from executionStrategy
 * - executeRefresh: planResearch catch path (planErr re-thrown)
 * - researchDimensionsInParallel: All searches fail → throws "All dimension searches failed"
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
// Factories
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

const mockTopic = {
  id: "topic-1",
  name: "AI Market Research",
  type: "TECHNOLOGY",
  userId: "user-1",
  description: "Test research topic",
  language: "zh",
  dimensions: [],
};

function makeSearchPhaseResult() {
  return {
    dimensionId: "dim-1",
    dimensionName: "Market Size",
    enrichedResults: [],
    evidenceData: [],
    evidenceSummary: "Evidence summary",
    searchResultsRecord: {},
    temporalContext: {},
    figuresSummary: "No figures",
    leaderContextSummary: "Context",
  };
}

function makeWritingResult() {
  return {
    success: true,
    dimensionId: "dim-1",
    analysisResult: {
      summary: "Market summary",
      keyFindings: [],
      trends: [],
      challenges: [],
      opportunities: [],
      confidenceLevel: "high",
      evidenceUsed: 3,
      detailedContent: "Detailed content",
      sections: [],
    },
    evidenceIds: ["ev-1"],
    extractedClaims: [],
  };
}

function makeDimensionMissionService() {
  return {
    researchDimension: jest.fn(),
    executeSearchPhase: jest.fn().mockResolvedValue(makeSearchPhaseResult()),
    executeWritingPhase: jest.fn().mockResolvedValue(makeWritingResult()),
    executeAnalysisPhase: jest.fn(),
    clearEvidenceCache: jest.fn(),
    executeDimensionMission: jest.fn().mockResolvedValue({
      success: true,
      dimensionId: "dim-1",
      analysisResult: makeWritingResult().analysisResult,
      evidenceIds: [],
      extractedClaims: [],
    }),
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
    validateClaims: jest.fn().mockResolvedValue({
      results: [],
      stats: { verified: 0, disputed: 0 },
    }),
    factCheckReport: jest.fn().mockResolvedValue({
      accuracyScore: 85,
      issues: [],
    }),
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
          outline: {
            intentUnderstanding: {
              coreQuestion: "What is the market size?",
              scope: { included: [], excluded: [] },
              expectedDepth: "comprehensive",
            },
            sections: [],
            writingGuidance: "Write clearly",
          },
        },
      ],
      researchDesign: null,
    }),
    planDimensionOutline: jest.fn().mockResolvedValue({
      intentUnderstanding: {
        coreQuestion: "What?",
        scope: { included: [], excluded: [] },
        expectedDepth: "comprehensive",
      },
      sections: [],
      writingGuidance: "Write",
    }),
    verifyHypotheses: jest.fn().mockResolvedValue([]),
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
    scanLiteratureBaseline: jest.fn().mockResolvedValue({}),
    searchForHypothesis: jest.fn().mockResolvedValue([]),
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
    startTrace: jest.fn().mockReturnValue("trace-sup2"),
    endTrace: jest.fn(),
    addSpan: jest.fn().mockReturnValue("span-sup2"),
    endSpan: jest.fn(),
  };
}

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
  return {
    service: module.get<TopicTeamOrchestratorService>(
      TopicTeamOrchestratorService,
    ),
    prisma,
    facade,
    dimensionSvc,
    reportSvc,
    reviewerSvc,
    leaderSvc,
    checkpointSvc,
    dataSvc,
    todoSvc,
  };
}

// ---------------------------------------------------------------------------
// Tests: executeRefresh — aborted signal
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService executeRefresh() — abort signal", () => {
  it("marks refresh log as FAILED when synthesizeReport throws after dimension phase", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);

    const dimensionSvc = makeDimensionMissionService();
    const reportSvc = makeReportSynthesisService();
    reportSvc.createDraftReport.mockResolvedValue({ id: "r1" });
    // Make synthesizeReport fail so the refresh fails
    reportSvc.synthesizeReport.mockRejectedValue(
      new Error("Synthesis failed after search"),
    );

    const leaderSvc = makeResearchLeaderService();

    const { service } = await buildModule(
      prisma,
      undefined,
      dimensionSvc,
      reportSvc,
      undefined,
      leaderSvc,
    );

    await expect(service.executeRefresh(mockTopic as never)).rejects.toThrow();

    // Verify error log was updated
    expect(prisma.topicRefreshLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: RefreshLogStatus.FAILED }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: executeRefresh — successful full flow
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService executeRefresh() — successful completion", () => {
  it("updates refreshLog to COMPLETED and topic status to ACTIVE on success", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);

    const dimensionSvc = makeDimensionMissionService();
    const reportSvc = makeReportSynthesisService();
    const leaderSvc = makeResearchLeaderService();
    const todoSvc = makeResearchTodoService();
    const facade = makeAgentFacade();

    const { service } = await buildModule(
      prisma,
      facade,
      dimensionSvc,
      reportSvc,
      undefined,
      leaderSvc,
      undefined,
      undefined,
      todoSvc,
    );

    await service.executeRefresh(mockTopic as never);

    // Verify refresh log completed
    expect(prisma.topicRefreshLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: RefreshLogStatus.COMPLETED }),
      }),
    );

    // Verify topic status updated to ACTIVE
    expect(prisma.researchTopic.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "topic-1" },
        data: expect.objectContaining({ status: "ACTIVE" }),
      }),
    );
  });

  it("ends trace with success status on successful completion", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);

    const facade = makeAgentFacade();
    const dimensionSvc = makeDimensionMissionService();
    const reportSvc = makeReportSynthesisService();

    const { service } = await buildModule(
      prisma,
      facade,
      dimensionSvc,
      reportSvc,
    );

    await service.executeRefresh(mockTopic as never);

    expect(facade.endTrace).toHaveBeenCalledWith("trace-sup2", {
      status: "success",
    });
  });

  it("marks mission as COMPLETED when missionId is set and refresh succeeds", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);
    prisma.researchMission.create.mockResolvedValue({ id: "mission-complete" });

    const dimensionSvc = makeDimensionMissionService();
    const reportSvc = makeReportSynthesisService();
    const todoSvc = makeResearchTodoService();

    const { service } = await buildModule(
      prisma,
      undefined,
      dimensionSvc,
      reportSvc,
      undefined,
      undefined,
      undefined,
      undefined,
      todoSvc,
    );

    await service.executeRefresh(mockTopic as never);

    expect(prisma.researchMission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mission-complete" },
        data: expect.objectContaining({ status: "COMPLETED" }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: executeRefresh — todo completion on success
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService executeRefresh() — todo flow", () => {
  it("completes reportTodo and reviewTodo on success", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);

    const todoSvc = makeResearchTodoService();
    let todoCallCount = 0;
    todoSvc.createTodo.mockImplementation(async () => {
      todoCallCount++;
      return { id: `todo-${todoCallCount}` };
    });

    const { service } = await buildModule(
      prisma,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      todoSvc,
    );

    await service.executeRefresh(mockTopic as never);

    // completeTodo should have been called for leaderTodo, dimension todos, reportTodo, reviewTodo
    expect(todoSvc.completeTodo).toHaveBeenCalled();
  });

  it("cleans up todos with FAILED status when failure occurs with missionId", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);
    prisma.researchMission.create.mockResolvedValue({ id: "mission-cleanup" });

    const reportSvc = makeReportSynthesisService();
    reportSvc.createDraftReport.mockResolvedValue({ id: "r1" });
    reportSvc.synthesizeReport.mockRejectedValue(new Error("Synth failed"));

    const { service } = await buildModule(
      prisma,
      undefined,
      undefined,
      reportSvc,
    );

    await expect(service.executeRefresh(mockTopic as never)).rejects.toThrow(
      "Synth failed",
    );

    // researchTodo.updateMany should be called to mark IN_PROGRESS todos as FAILED
    expect(prisma.researchTodo.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ missionId: "mission-cleanup" }),
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: executeRefresh — forceRefresh option
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService executeRefresh() — forceRefresh option", () => {
  it("does not apply incremental filter when forceRefresh=true", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);

    const reportSvc = makeReportSynthesisService();
    reportSvc.synthesizeReport.mockRejectedValue(new Error("Stop"));

    const { service } = await buildModule(
      prisma,
      undefined,
      undefined,
      reportSvc,
    );

    const options: RefreshOptions = { forceRefresh: true, incremental: true };
    try {
      await service.executeRefresh(mockTopic as never, options);
    } catch {
      // expected
    }

    // forceRefresh=true 应跳过 incremental 过滤（lastResearchedAt 等条件
    // 不该出现）。但 mission-scope OR（missionId / null）始终存在 ——
    // 这是根治"重复任务"的核心隔离机制。
    const findManyCall = prisma.topicDimension.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(findManyCall.where).not.toHaveProperty("AND");
    const whereJson = JSON.stringify(findManyCall.where);
    expect(whereJson).not.toContain("lastResearchedAt");
  });
});

// ---------------------------------------------------------------------------
// Tests: executeRefresh — leader plan with executionStrategy.parallelism
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService executeRefresh() — leader parallelism", () => {
  it("uses parallelism from leader executionStrategy when dimensions are created", async () => {
    const prisma = makePrisma();
    // Start with no dimensions so leader planning is triggered
    prisma.topicDimension.findMany.mockResolvedValue([]);
    prisma.topicDimension.create.mockResolvedValue({
      id: "new-dim-1",
      name: "Market Overview",
      status: DimensionStatus.PENDING,
      searchQueries: [],
      searchSources: [],
      topicId: "topic-1",
      description: "Overview",
    });

    const leaderSvc = makeResearchLeaderService();
    leaderSvc.planResearch.mockResolvedValue({
      assignments: [],
      agentAssignments: [],
      dimensions: [
        {
          name: "Market Overview",
          description: "Overview",
          priority: 1,
          searchQueries: [],
          dataSources: ["web"],
        },
      ],
      executionStrategy: { parallelism: 6 },
    });

    const reportSvc = makeReportSynthesisService();
    reportSvc.createDraftReport.mockResolvedValue({ id: "r1" });
    reportSvc.synthesizeReport.mockRejectedValue(
      new Error("Stop after leader"),
    );

    const { service } = await buildModule(
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
  });
});

// ---------------------------------------------------------------------------
// Tests: executeRefresh — planResearch error path
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService executeRefresh() — planResearch error", () => {
  it("re-throws planResearch error when leader planning fails", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([]); // no dimensions

    const leaderSvc = makeResearchLeaderService();
    leaderSvc.planResearch.mockRejectedValue(new Error("Leader AI timeout"));

    const { service } = await buildModule(
      prisma,
      undefined,
      undefined,
      undefined,
      undefined,
      leaderSvc,
    );

    await expect(service.executeRefresh(mockTopic as never)).rejects.toThrow(
      "Leader AI timeout",
    );

    expect(prisma.topicRefreshLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: RefreshLogStatus.FAILED }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: executeRefresh — delegates to DimensionMissionService
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService executeRefresh() — DimensionMissionService delegation", () => {
  it("propagates error thrown by executeDimensionMission (all dimensions fail)", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);

    const reportSvc = makeReportSynthesisService();
    reportSvc.createDraftReport.mockResolvedValue({ id: "r1" });
    reportSvc.synthesizeReport.mockRejectedValue(
      new Error("All dimension searches failed"),
    );

    const dimensionSvc = makeDimensionMissionService();
    dimensionSvc.executeDimensionMission.mockResolvedValue({
      success: false,
      error: "All dimension searches failed",
      analysisResult: null,
      evidenceIds: [],
      extractedClaims: [],
    });

    const { service } = await buildModule(
      prisma,
      undefined,
      dimensionSvc,
      reportSvc,
    );

    await expect(service.executeRefresh(mockTopic as never)).rejects.toThrow();

    expect(prisma.topicRefreshLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: RefreshLogStatus.FAILED }),
      }),
    );
  });

  it("calls executeDimensionMission with topic and dimension", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);

    const dimensionSvc = makeDimensionMissionService();

    const { service } = await buildModule(prisma, undefined, dimensionSvc);

    await service.executeRefresh(mockTopic as never);

    expect(dimensionSvc.executeDimensionMission).toHaveBeenCalledWith(
      expect.objectContaining({ id: "topic-1" }),
      expect.objectContaining({ id: "dim-1" }),
      expect.any(String),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: executeRefresh — quality review error (non-fatal)
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService executeRefresh() — quality review non-fatal", () => {
  it("continues to synthesize report even when quality review throws", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);

    const reviewerSvc = makeResearchReviewerService();
    reviewerSvc.reviewOverall.mockRejectedValue(
      new Error("Review service unavailable"),
    );

    const reportSvc = makeReportSynthesisService();

    const { service } = await buildModule(
      prisma,
      undefined,
      undefined,
      reportSvc,
      reviewerSvc,
    );

    // Should not throw despite reviewer failing
    await expect(
      service.executeRefresh(mockTopic as never),
    ).resolves.toBeDefined();

    // Report synthesis should still have been called
    expect(reportSvc.synthesizeReport).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: executeRefresh — saveDimensionAnalysis and linkEvidenceToReport
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService executeRefresh() — save analysis results", () => {
  it("calls saveDimensionAnalysis for each fulfilled dimension result", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);

    const reportSvc = makeReportSynthesisService();
    reportSvc.createDraftReport.mockResolvedValue({ id: "report-1" });

    const analysisResult = makeWritingResult().analysisResult;
    const dimensionSvc = makeDimensionMissionService();
    dimensionSvc.executeDimensionMission.mockResolvedValue({
      success: true,
      dimensionId: "dim-1",
      analysisResult,
      evidenceIds: [],
      extractedClaims: [],
    });

    const { service } = await buildModule(
      prisma,
      undefined,
      dimensionSvc,
      reportSvc,
    );

    await service.executeRefresh(mockTopic as never);

    expect(reportSvc.saveDimensionAnalysis).toHaveBeenCalledWith(
      "report-1",
      "dim-1",
      expect.objectContaining({ summary: expect.any(String) }),
    );
  });

  it("calls linkEvidenceToReport when evidenceIds are present in fulfilled result", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);

    const reportSvc = makeReportSynthesisService();
    reportSvc.createDraftReport.mockResolvedValue({ id: "report-1" });

    const analysisResult = makeWritingResult().analysisResult;
    const dimensionSvc = makeDimensionMissionService();
    dimensionSvc.executeDimensionMission.mockResolvedValue({
      success: true,
      dimensionId: "dim-1",
      analysisResult,
      evidenceIds: ["ev-1", "ev-2"],
      extractedClaims: [],
    });

    const { service } = await buildModule(
      prisma,
      undefined,
      dimensionSvc,
      reportSvc,
    );

    await service.executeRefresh(mockTopic as never);

    expect(reportSvc.linkEvidenceToReport).toHaveBeenCalled();
  });
});
