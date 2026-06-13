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
 * TopicTeamOrchestratorService - Supplemental Tests (Part 3)
 *
 * Targets uncovered branches:
 * - Agent assignment tracking logs (agentAssignments.length > 0)
 * - Hypothesis-driven queries: depthConfig.hypothesisTestingEnabled=true
 * - Abort signal check: throws "Refresh cancelled" when signal is aborted
 * - Cognitive loop V5: claim extraction and validation
 * - Cognitive loop V5: hypothesis verification via verifyHypotheses
 * - V5 fact check: depthConfig.factCheckEnabled path
 * - refreshSingleDimension: dimension not found → BadRequestException
 * - refreshSingleDimension: wrong topic → BadRequestException
 * - refreshSingleDimension: mission fails → InternalServerErrorException
 * - refreshSingleDimension: success path
 * - cancelRefresh: topic with no active refresh → returns false
 * - cancelRefresh: topic with active refresh → aborts and returns true
 * - getRefreshStatus: when running vs not running
 * - executeRefresh: agentAssignments with matching dimension assignment (lines 403-406)
 * - executeRefresh: refresh log update with dimensionsRefreshed / sourcesFound
 * - executeRefresh: cleanup - researchTask.updateMany FAILED on error (line 1027-1039)
 * - executeRefresh: researchMission.update FAILED on error (line 1040-1043)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";
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
import { DimensionStatus, RefreshLogStatus } from "@prisma/client";

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
      findUnique: jest.fn().mockResolvedValue(null),
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
    extractedClaims: [
      {
        claim: "Market is growing",
        source: "dim-1",
        confidence: 0.85,
        supportingEvidence: [],
      },
    ],
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
      analysisResult: {
        summary: "Dimension result",
      },
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
      results: [{ claim: "Market is growing", verified: true }],
      stats: { verified: 1, disputed: 0 },
    }),
    factCheckReport: jest.fn().mockResolvedValue({
      accuracyScore: 90,
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
      dimensions: [],
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
    verifyHypotheses: jest
      .fn()
      .mockResolvedValue([
        { hypothesisId: "h1", supported: true, confidence: 0.8 },
      ]),
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
    searchForHypothesis: jest
      .fn()
      .mockResolvedValue([
        { url: "https://example.com/evidence", snippet: "Evidence found" },
      ]),
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
    startTrace: jest.fn().mockReturnValue("trace-sup3"),
    endTrace: jest.fn(),
    addSpan: jest.fn().mockReturnValue("span-sup3"),
    endSpan: jest.fn(),
  };
}

async function buildModule(
  overrides: {
    prisma?: ReturnType<typeof makePrisma>;
    facade?: ReturnType<typeof makeAgentFacade>;
    dimensionSvc?: ReturnType<typeof makeDimensionMissionService>;
    reportSvc?: ReturnType<typeof makeReportSynthesisService>;
    reviewerSvc?: ReturnType<typeof makeResearchReviewerService>;
    leaderSvc?: ReturnType<typeof makeResearchLeaderService>;
    checkpointSvc?: ReturnType<typeof makeResearchCheckpointService>;
    dataSvc?: ReturnType<typeof makeDataSourceRouterService>;
    todoSvc?: ReturnType<typeof makeResearchTodoService>;
  } = {},
) {
  const prisma = overrides.prisma ?? makePrisma();
  const facade = overrides.facade ?? makeAgentFacade();
  const dimensionSvc = overrides.dimensionSvc ?? makeDimensionMissionService();
  const reportSvc = overrides.reportSvc ?? makeReportSynthesisService();
  const reviewerSvc = overrides.reviewerSvc ?? makeResearchReviewerService();
  const leaderSvc = overrides.leaderSvc ?? makeResearchLeaderService();
  const checkpointSvc =
    overrides.checkpointSvc ?? makeResearchCheckpointService();
  const dataSvc = overrides.dataSvc ?? makeDataSourceRouterService();
  const todoSvc = overrides.todoSvc ?? makeResearchTodoService();

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
// Tests: hypothesis-driven queries (lines 556-567)
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService — hypothesis-driven queries", () => {
  it("does NOT call searchForHypothesis (hypothesis path reserved for future integration)", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);

    const dataSvc = makeDataSourceRouterService();

    const { service } = await buildModule({
      prisma,
      dataSvc,
    });

    // thorough depth — hypothesis path is reserved (if false), so searchForHypothesis is not called
    const options: RefreshOptions = { researchDepth: "thorough" };
    await service.executeRefresh(mockTopic as never, options);

    expect(dataSvc.searchForHypothesis).not.toHaveBeenCalled();
  });

  it("completes successfully with thorough depth even when searchForHypothesis is not called", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);

    const dataSvc = makeDataSourceRouterService();
    const reportSvc = makeReportSynthesisService();

    const { service } = await buildModule({
      prisma,
      dataSvc,
      reportSvc,
    });

    const options: RefreshOptions = { researchDepth: "thorough" };
    await expect(
      service.executeRefresh(mockTopic as never, options),
    ).resolves.toBeDefined();

    expect(reportSvc.synthesizeReport).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: V5 Cognitive Loop — claim extraction and validation (lines 657-754)
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService — V5 cognitive loop", () => {
  it("calls validateClaims when extractedClaims returned from executeDimensionMission (standard depth)", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);

    const reviewerSvc = makeResearchReviewerService();
    const dimensionSvc = makeDimensionMissionService();

    // Return extractedClaims from executeDimensionMission so the cognitive loop runs
    dimensionSvc.executeDimensionMission.mockResolvedValue({
      success: true,
      dimensionId: "dim-1",
      analysisResult: { summary: "Analysis here" },
      evidenceIds: [],
      extractedClaims: [
        {
          claim: "Market grows 40% YoY",
          source: "source-1",
          confidence: 0.9,
          supportingEvidence: [],
        },
      ],
    });

    const { service } = await buildModule({
      prisma,
      reviewerSvc,
      dimensionSvc,
    });

    // standard depth has maxCognitiveLoops > 0
    const options: RefreshOptions = { researchDepth: "standard" };
    await service.executeRefresh(mockTopic as never, options);

    expect(reviewerSvc.validateClaims).toHaveBeenCalled();
  });

  it("does NOT call verifyHypotheses (hypothesis verification reserved for future integration)", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);

    const reviewerSvc = makeResearchReviewerService();
    const leaderSvc = makeResearchLeaderService();
    const dimensionSvc = makeDimensionMissionService();

    dimensionSvc.executeDimensionMission.mockResolvedValue({
      success: true,
      dimensionId: "dim-1",
      analysisResult: { summary: "Relevant summary" },
      evidenceIds: [],
      extractedClaims: [
        {
          claim: "AI accelerates",
          source: "d1",
          confidence: 0.8,
          supportingEvidence: [],
        },
      ],
    });

    const { service } = await buildModule({
      prisma,
      reviewerSvc,
      leaderSvc,
      dimensionSvc,
    });

    // thorough depth — verifyHypotheses is behind if (false), not called
    const options: RefreshOptions = { researchDepth: "thorough" };
    await service.executeRefresh(mockTopic as never, options);

    expect(leaderSvc.verifyHypotheses).not.toHaveBeenCalled();
  });

  it("does NOT call validateClaims when executeDimensionMission returns no extractedClaims", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);

    const reviewerSvc = makeResearchReviewerService();
    const dimensionSvc = makeDimensionMissionService();

    // No extractedClaims in result
    dimensionSvc.executeDimensionMission.mockResolvedValue({
      success: true,
      dimensionId: "dim-1",
      analysisResult: { summary: "Clean analysis" },
      evidenceIds: [],
      // No extractedClaims field
    });

    const { service } = await buildModule({
      prisma,
      reviewerSvc,
      dimensionSvc,
    });

    const options: RefreshOptions = { researchDepth: "standard" };
    await service.executeRefresh(mockTopic as never, options);

    expect(reviewerSvc.validateClaims).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: V5 Fact check (lines 831-863)
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService — V5 fact check", () => {
  it("calls factCheckReport when researchDepth=thorough (factCheckEnabled)", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);
    prisma.topicEvidence.findMany.mockResolvedValue([
      { id: "ev-1", title: "Source 1", snippet: "Snippet 1" },
    ]);

    const reviewerSvc = makeResearchReviewerService();

    const { service } = await buildModule({ prisma, reviewerSvc });

    const options: RefreshOptions = { researchDepth: "thorough" };
    await service.executeRefresh(mockTopic as never, options);

    expect(reviewerSvc.factCheckReport).toHaveBeenCalled();
  });

  it("does NOT call factCheckReport when researchDepth=quick (factCheckEnabled=false)", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);

    const reviewerSvc = makeResearchReviewerService();

    const { service } = await buildModule({ prisma, reviewerSvc });

    const options: RefreshOptions = { researchDepth: "quick" };
    await service.executeRefresh(mockTopic as never, options);

    expect(reviewerSvc.factCheckReport).not.toHaveBeenCalled();
  });

  it("continues normally even when factCheckReport throws (non-fatal)", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);

    const reviewerSvc = makeResearchReviewerService();
    reviewerSvc.factCheckReport.mockRejectedValue(
      new Error("Fact check timeout"),
    );

    const reportSvc = makeReportSynthesisService();

    const { service } = await buildModule({ prisma, reviewerSvc, reportSvc });

    const options: RefreshOptions = { researchDepth: "thorough" };
    // Should not throw
    await expect(
      service.executeRefresh(mockTopic as never, options),
    ).resolves.toBeDefined();

    // Report was still synthesized
    expect(reportSvc.synthesizeReport).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: agentAssignments with dimension matching (lines 403-434)
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService — agentAssignments with dimension matching", () => {
  it("logs agent assignments when agentAssignments.length > 0 from leader plan", async () => {
    const prisma = makePrisma();
    // No existing dimensions → triggers leader planning
    prisma.topicDimension.findMany.mockResolvedValue([]);
    prisma.topicDimension.create.mockResolvedValue({
      id: "dim-new",
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
      agentAssignments: [
        {
          agentId: "researcher-1",
          agentName: "Market Researcher",
          agentType: "dimension_researcher",
          assignedDimensions: ["dim-new"],
          tools: ["web_search", "academic_search"],
          modelId: "",
          assignmentReason: {
            agentReason: "Specialized in market research",
            modelReason: "Uses efficient model",
          },
        },
      ],
      dimensions: [
        {
          name: "Market Overview",
          description: "Overview",
          priority: 1,
          searchQueries: [],
          dataSources: ["web"],
        },
      ],
      executionStrategy: { parallelism: 3 },
    });

    const reportSvc = makeReportSynthesisService();

    const { service } = await buildModule({ prisma, leaderSvc, reportSvc });

    // Should complete without error even with agentAssignments present
    await service.executeRefresh(mockTopic as never);

    expect(leaderSvc.planResearch).toHaveBeenCalledWith("topic-1");
  });
});

// ---------------------------------------------------------------------------
// Tests: refreshSingleDimension (lines 1157-1179)
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService — refreshSingleDimension", () => {
  it("throws BadRequestException when dimension not found", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findUnique.mockResolvedValue(null);

    const { service } = await buildModule({ prisma });

    await expect(
      service.refreshSingleDimension(mockTopic as never, "nonexistent-dim"),
    ).rejects.toThrow(BadRequestException);
  });

  it("throws BadRequestException when dimension belongs to a different topic", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findUnique.mockResolvedValue({
      ...mockDimension,
      topicId: "other-topic", // different topic
    });

    const { service } = await buildModule({ prisma });

    await expect(
      service.refreshSingleDimension(mockTopic as never, "dim-1"),
    ).rejects.toThrow(BadRequestException);
  });

  it("throws InternalServerErrorException when dimension mission fails", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findUnique.mockResolvedValue(mockDimension);

    const dimensionSvc = makeDimensionMissionService();
    dimensionSvc.executeDimensionMission.mockResolvedValue({
      success: false,
      error: "Research timed out",
      analysisResult: null,
    });

    const { service } = await buildModule({ prisma, dimensionSvc });

    await expect(
      service.refreshSingleDimension(mockTopic as never, "dim-1"),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it("throws InternalServerErrorException when mission result has no analysisResult", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findUnique.mockResolvedValue(mockDimension);

    const dimensionSvc = makeDimensionMissionService();
    dimensionSvc.executeDimensionMission.mockResolvedValue({
      success: true,
      analysisResult: null, // null analysisResult
    });

    const { service } = await buildModule({ prisma, dimensionSvc });

    await expect(
      service.refreshSingleDimension(mockTopic as never, "dim-1"),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it("returns analysisResult on successful dimension mission", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findUnique.mockResolvedValue(mockDimension);

    const dimensionSvc = makeDimensionMissionService();
    const expectedAnalysis = { summary: "Market is growing", keyFindings: [] };
    dimensionSvc.executeDimensionMission.mockResolvedValue({
      success: true,
      analysisResult: expectedAnalysis,
    });

    const { service } = await buildModule({ prisma, dimensionSvc });

    const result = await service.refreshSingleDimension(
      mockTopic as never,
      "dim-1",
    );

    expect(result).toEqual(expectedAnalysis);
  });
});

// ---------------------------------------------------------------------------
// Tests: cancelRefresh (lines 1068-1093)
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService — cancelRefresh", () => {
  it("returns false when no active refresh exists for topicId", async () => {
    const { service } = await buildModule();

    const result = await service.cancelRefresh("nonexistent-topic");

    expect(result).toBe(false);
  });

  it("aborts the controller and updates log to CANCELLED when refresh is active", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);

    // Make executeDimensionMission hang so we can cancel mid-flight
    const dimensionSvc = makeDimensionMissionService();
    let resolveMission: (value: unknown) => void;
    dimensionSvc.executeDimensionMission.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMission = resolve;
        }),
    );

    const { service } = await buildModule({ prisma, dimensionSvc });

    // Start refresh without awaiting
    const refreshPromise = service
      .executeRefresh(mockTopic as never)
      .catch(() => {
        // Ignore the error from the aborted refresh
      });

    // Give the refresh a moment to start
    await new Promise((r) => setTimeout(r, 10));

    const cancelled = await service.cancelRefresh("topic-1");

    // Resolve the hanging mission to let the refresh complete
    resolveMission!({
      success: true,
      dimensionId: "dim-1",
      analysisResult: { summary: "done" },
      evidenceIds: [],
      extractedClaims: [],
    });
    await refreshPromise;

    expect(cancelled).toBe(true);
    expect(prisma.topicRefreshLog.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: RefreshLogStatus.CANCELLED }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: getRefreshStatus (lines 1098-1108)
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService — getRefreshStatus", () => {
  it("returns isRunning=false when no active refresh", async () => {
    const { service } = await buildModule();

    const status = service.getRefreshStatus("topic-never-started");

    expect(status.isRunning).toBe(false);
    expect(status.startedAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: mission/task cleanup on error (lines 1012-1048)
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService — error cleanup with missionId", () => {
  it("marks researchTask as FAILED when mission is set and error occurs", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);
    prisma.researchMission.create.mockResolvedValue({ id: "mission-fail" });

    const reportSvc = makeReportSynthesisService();
    reportSvc.synthesizeReport.mockRejectedValue(new Error("Synthesis crash"));

    const { service } = await buildModule({ prisma, reportSvc });

    await expect(service.executeRefresh(mockTopic as never)).rejects.toThrow(
      "Synthesis crash",
    );

    // Should have attempted to clean up researchTask
    expect(prisma.researchTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ missionId: "mission-fail" }),
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });

  it("marks researchMission as FAILED when mission is set and error occurs", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([mockDimension]);
    prisma.researchMission.create.mockResolvedValue({ id: "mission-fail-2" });

    const reportSvc = makeReportSynthesisService();
    reportSvc.synthesizeReport.mockRejectedValue(new Error("Synthesis fail"));

    const { service } = await buildModule({ prisma, reportSvc });

    await expect(service.executeRefresh(mockTopic as never)).rejects.toThrow();

    // Mission should be marked FAILED
    expect(prisma.researchMission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mission-fail-2" },
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: refresh log with dimensionsRefreshed and sourcesFound (lines 941-950)
// ---------------------------------------------------------------------------

describe("TopicTeamOrchestratorService — refresh log final update", () => {
  it("updates refresh log with dimensionsRefreshed count and sourcesFound", async () => {
    const prisma = makePrisma();
    prisma.topicDimension.findMany.mockResolvedValue([
      mockDimension,
      { ...mockDimension, id: "dim-2", name: "Competitive Landscape" },
    ]);

    const reportSvc = makeReportSynthesisService();
    reportSvc.synthesizeReport.mockResolvedValue({
      id: "report-final",
      status: "PUBLISHED",
      totalSources: 42,
    });

    const { service } = await buildModule({ prisma, reportSvc });

    await service.executeRefresh(mockTopic as never);

    expect(prisma.topicRefreshLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: RefreshLogStatus.COMPLETED,
          dimensionsRefreshed: 2,
          sourcesFound: 42,
        }),
      }),
    );
  });
});
