import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { TopicTeamOrchestratorService } from "../topic-team-orchestrator.service";

/** Helper: create a mock function that accepts any resolved value */
const fn = () => jest.fn<() => Promise<unknown>>();

function createMockServices() {
  const mockDimension = {
    id: "dim-1",
    name: "Market",
    description: "Market analysis",
    topicId: "t1",
    searchQueries: ["market"],
    searchSources: ["web"],
    sortOrder: 1,
    isEnabled: true,
    status: "PENDING",
    minSources: 5,
  };

  const mockAnalysisResult = {
    summary: "Market analysis summary",
    keyFindings: [{ finding: "f1", significance: "high", evidenceIds: ["e1"] }],
    trends: [],
    challenges: [],
    opportunities: [],
    confidenceLevel: "high",
    evidenceUsed: 5,
    detailedContent: "Detailed content...",
  };

  const prisma = {
    topicRefreshLog: {
      create: fn().mockResolvedValue({ id: "log1" }),
      update: fn().mockResolvedValue({}),
    },
    researchTopic: {
      update: fn().mockResolvedValue({}),
    },
    topicDimension: {
      findMany: fn().mockResolvedValue([mockDimension]),
      update: fn().mockResolvedValue({}),
      updateMany: fn().mockResolvedValue({ count: 0 }),
    },
    topicEvidence: {
      findMany: fn().mockResolvedValue([
        { id: "e1", title: "Evidence 1", snippet: "data" },
      ]),
    },
    researchMission: {
      findFirst: fn().mockResolvedValue(null),
      create: fn().mockResolvedValue({ id: "mission-v5" }),
      update: fn().mockResolvedValue({}),
    },
    researchTask: {
      create: fn().mockResolvedValue({}),
      createMany: fn().mockResolvedValue({ count: 0 }),
    },
  };

  const eventEmitter = { emit: jest.fn() };

  const dimensionMissionService = {
    executeDimensionMission: jest.fn().mockResolvedValue({
      success: true,
      dimensionId: "dim-1",
      analysisResult: {
        detailedContent: "test content",
        keyFindings: ["finding1"],
        summary: "test summary",
      },
      evidenceIds: ["ev-1"],
      extractedClaims: [],
    }),
    executeSearchPhase: fn().mockResolvedValue({
      success: true,
      evidenceSummary: "summary",
      evidenceIds: ["e1"],
      figuresSummary: "",
    }),
    executeWritingPhase: fn().mockResolvedValue({
      success: true,
      analysisResult: mockAnalysisResult,
      evidenceIds: ["e1"],
      extractedClaims: [],
    }),
    clearEvidenceCache: fn(),
  };

  const reportSynthesisService = {
    createDraftReport: fn().mockResolvedValue({ id: "r1" }),
    saveDimensionAnalysis: fn().mockResolvedValue({ id: "a1" }),
    linkEvidenceToReport: fn().mockResolvedValue(undefined),
    synthesizeReport: fn().mockResolvedValue({
      id: "r1",
      content: "Report content with [1] citation.",
      totalSources: 5,
    }),
  };

  const researchReviewerService = {
    reviewDimension: fn().mockResolvedValue({
      qualityLevel: "good",
      overallScore: 80,
      scores: {
        breadth: 80,
        depth: 80,
        evidence: 80,
        coherence: 80,
        currency: 80,
      },
      issues: [],
      suggestions: [],
      needsReresearch: false,
    }),
    reviewOverall: fn().mockResolvedValue({
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
    validateClaims: fn().mockResolvedValue({
      results: [],
      stats: { verified: 0, unverified: 0, disputed: 0, total: 0 },
    }),
    factCheckReport: fn().mockResolvedValue({
      citations: [],
      accuracyScore: 90,
      issues: [],
    }),
  };

  const researchLeaderService = {
    planResearch: fn().mockResolvedValue({
      dimensions: [
        {
          id: "dim-1",
          name: "Market",
          description: "desc",
          searchQueries: ["q1"],
          dataSources: ["web"],
          priority: 1,
        },
      ],
      agentAssignments: [],
      executionStrategy: { parallelism: 1, priorityOrder: ["dim-1"] },
      taskUnderstanding: {
        topic: "Test",
        scope: "broad",
        objectives: ["analyze"],
      },
    }),
    planGlobalOutline: fn().mockResolvedValue({
      dimensions: [
        {
          dimensionId: "dim-1",
          dimensionName: "Market",
          outline: { title: "Market", sections: [], totalWordCount: 1000 },
        },
      ],
    }),
    planDimensionOutline: fn().mockResolvedValue({
      title: "Market",
      sections: [],
      totalWordCount: 1000,
    }),
    verifyHypotheses: fn().mockResolvedValue([]),
    extractClaims: fn().mockResolvedValue([]),
  };

  const researchCheckpointService = {
    saveCheckpoint: fn().mockResolvedValue(undefined),
  };

  const dataSourceRouterService = {
    scanLiteratureBaseline: fn().mockResolvedValue([]),
    searchForHypothesis: fn().mockResolvedValue({
      supportResults: [],
      counterResults: [],
    }),
    fetchDataForDimension: fn().mockResolvedValue({
      items: [],
      totalCount: 0,
      sources: ["web"],
      metadata: { searchQuery: "q", executionTimeMs: 100, sourceResults: {} },
    }),
  };

  return {
    prisma,
    eventEmitter,
    dimensionMissionService,
    reportSynthesisService,
    researchReviewerService,
    researchLeaderService,
    researchCheckpointService,
    dataSourceRouterService,
    mockDimension,
  };
}

describe("TopicTeamOrchestratorService - V5 Depth Gating", () => {
  let mocks: ReturnType<typeof createMockServices>;
  let service: TopicTeamOrchestratorService;
  const topic = {
    id: "t1",
    name: "Test Topic",
    type: "MACRO",
    description: "Test",
    status: "ACTIVE",
    topicConfig: {},
  } as any;

  beforeEach(() => {
    mocks = createMockServices();
    service = new TopicTeamOrchestratorService(
      mocks.prisma as any,
      mocks.eventEmitter as any,
      mocks.dimensionMissionService as any,
      mocks.reportSynthesisService as any,
      mocks.researchReviewerService as any,
      mocks.researchLeaderService as any,
      mocks.researchCheckpointService as any,
      mocks.dataSourceRouterService as any,
      {} as any, // researchTodoService
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("quick → skips cognitive loop, literature baseline, and fact check", async () => {
    await service.executeRefresh(topic, { researchDepth: "quick" });

    expect(
      mocks.dataSourceRouterService.scanLiteratureBaseline,
    ).not.toHaveBeenCalled();
    expect(mocks.researchReviewerService.validateClaims).not.toHaveBeenCalled();
    expect(
      mocks.researchReviewerService.factCheckReport,
    ).not.toHaveBeenCalled();
  });

  it("standard → delegates to dimensionMissionService", async () => {
    await service.executeRefresh(topic, { researchDepth: "standard" });

    expect(
      mocks.dimensionMissionService.executeDimensionMission,
    ).toHaveBeenCalled();
  });

  it("thorough → delegates to dimensionMissionService", async () => {
    await service.executeRefresh(topic, { researchDepth: "thorough" });

    expect(
      mocks.dimensionMissionService.executeDimensionMission,
    ).toHaveBeenCalled();
  });

  it("should save checkpoints at key phases", async () => {
    await service.executeRefresh(topic, { researchDepth: "standard" });

    const checkpointCalls = mocks.researchCheckpointService.saveCheckpoint.mock
      .calls as unknown[][];
    // Should have checkpoints for: L2_knowledge (after search), L2_knowledge (after Phase 2), L4_writing (per dimension)
    expect(checkpointCalls.length).toBeGreaterThanOrEqual(2);

    // Verify checkpoint phases
    const phases = checkpointCalls.map(
      (c) => (c[1] as { phase?: string })?.phase,
    );
    expect(phases).toContain("L2_knowledge");
  });

  it("should not block flow when saveCheckpoint fails", async () => {
    mocks.researchCheckpointService.saveCheckpoint.mockRejectedValue(
      new Error("DB error"),
    );

    // Should not throw
    await expect(
      service.executeRefresh(topic, { researchDepth: "standard" }),
    ).resolves.toBeDefined();
  });

  it("should call dimensionMissionService.executeDimensionMission with dimension and topic", async () => {
    await service.executeRefresh(topic, { researchDepth: "standard" });

    expect(
      mocks.dimensionMissionService.executeDimensionMission,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ id: "t1" }), // topic
      expect.objectContaining({ id: "dim-1" }), // dimension
      expect.any(String), // reportId
      undefined, // missionId
      undefined, // modelId
      undefined, // taskId
      undefined, // tools
      undefined, // skills
      expect.anything(), // maxRevisionRounds
    );
  });

  it("thorough fact check queries evidence from DB", async () => {
    mocks.reportSynthesisService.synthesizeReport.mockResolvedValue({
      id: "r1",
      content: "Report with [1] citation.",
      totalSources: 5,
    });

    await service.executeRefresh(topic, { researchDepth: "thorough" });

    expect(mocks.prisma.topicEvidence.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ reportId: "r1" }),
      }),
    );
    expect(mocks.researchReviewerService.factCheckReport).toHaveBeenCalled();
  });

  it("hypothesis verification queries are not called (behind if(false) guard)", async () => {
    await service.executeRefresh(topic, { researchDepth: "thorough" });

    expect(mocks.researchLeaderService.verifyHypotheses).not.toHaveBeenCalled();
    expect(
      mocks.dataSourceRouterService.searchForHypothesis,
    ).not.toHaveBeenCalled();
  });
});
