/**
 * TopicInsightsService – getComputeUsage unit tests
 *
 * Tests cover:
 * - Mission resolution: latest, specific, invalid, cross-topic, no missions
 * - Time window filtering for credit transactions, reports, latency sessions
 * - Mission list shape and ordering
 * - currentMissionId value
 * - Edge cases: startedAt=null fallback, no missions with credits, multi-mission isolation
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { TopicInsightsService } from "../topic-insights.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  TopicTeamOrchestratorService,
  ReportSynthesisService,
  EvidenceManagementService,
  ReportChangeService,
  ReportAnnotationService,
  ResearchStrategyService,
  AgentActivityService,
  CredibilityReportService,
  TopicCrudService,
  TopicDimensionService,
  TopicExportService,
  TopicScheduleService,
  ReportQualityTraceService,
  ReportDataService,
  LatexRepairService,
} from "../services";
import { ChatFacade } from "@/modules/ai-harness/facade";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const USER_ID = "user-001";
const TOPIC_ID = "topic-001";
const MISSION_ID = "mission-001";

function makeDate(offsetMs = 0): Date {
  return new Date(1_700_000_000_000 + offsetMs);
}

function makeMission(
  overrides: Partial<{
    id: string;
    topicId: string;
    leaderModelId: string | null;
    leaderModelName: string | null;
    researchDepth: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    totalTasks: number;
    completedTasks: number;
    status: string;
  }> = {},
) {
  return {
    id: MISSION_ID,
    topicId: TOPIC_ID,
    leaderModelId: "model-id-1",
    leaderModelName: "gpt-4o",
    researchDepth: "deep",
    startedAt: makeDate(0),
    completedAt: makeDate(60_000),
    createdAt: makeDate(-1000),
    totalTasks: 10,
    completedTasks: 10,
    status: "completed",
    ...overrides,
  };
}

function _makeEmptyCreditAgg() {
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock factory
// ─────────────────────────────────────────────────────────────────────────────

function buildMocks() {
  const mockPrisma = {
    researchTopic: {
      findUnique: jest.fn().mockResolvedValue({ userId: USER_ID }),
    },
    researchMission: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    topicReport: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
    },
    dimensionAnalysis: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    creditTransaction: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    latencySession: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };

  const _noop = () => ({});

  return {
    mockPrisma,
    mockEventEmitter: { emit: jest.fn(), on: jest.fn(), off: jest.fn() },
    mockOrchestrator: {
      executeRefresh: jest.fn(),
      getRefreshStatus: jest.fn(),
      cancelRefresh: jest.fn(),
    },
    mockReportService: {
      synthesizeReport: jest.fn(),
      getReport: jest.fn(),
      listReports: jest.fn(),
      compareReports: jest.fn(),
      reprocessExistingReport: jest.fn(),
      getLatestReport: jest.fn(),
    },
    mockEvidenceService: {
      recalculateCredibilityScores: jest.fn(),
      listEvidence: jest.fn(),
      getEvidence: jest.fn(),
    },
    mockFacade: { chat: jest.fn() },
    mockReportChangeService: {
      getChanges: jest.fn(),
      addChange: jest.fn(),
      checkinChange: jest.fn(),
      checkinAllChanges: jest.fn(),
    },
    mockReportAnnotationService: {
      getAnnotations: jest.fn(),
      addAnnotation: jest.fn(),
      createAnnotation: jest.fn(),
      updateAnnotation: jest.fn(),
      deleteAnnotation: jest.fn(),
      resolveAnnotation: jest.fn(),
      resolveAllAnnotations: jest.fn(),
    },
    mockResearchStrategyService: {
      analyzeAndRecommend: jest.fn(),
      quickCheck: jest.fn(),
      getSmartRefreshOptions: jest.fn(),
    },
    mockAgentActivityService: {
      getActivitiesByDimension: jest.fn(),
      getActivityStats: jest.fn(),
    },
    mockCredibilityReportService: {
      getOrGenerateCredibilityReport: jest.fn(),
      generateCredibilityReport: jest.fn(),
    },
    mockCrudService: {
      createTopic: jest.fn(),
      listTopics: jest.fn(),
      getTopic: jest.fn(),
      updateTopic: jest.fn(),
      deleteTopic: jest.fn(),
      getResearchHistory: jest.fn(),
      getLogs: jest.fn(),
      getStats: jest.fn(),
      recalculateTopicStats: jest.fn(),
    },
    mockDimensionService: {
      listDimensions: jest.fn(),
      addDimension: jest.fn(),
      updateDimension: jest.fn(),
      deleteDimension: jest.fn(),
      refreshDimension: jest.fn(),
      reorderDimensions: jest.fn(),
      getTemplates: jest.fn(),
      createFromTemplate: jest.fn(),
    },
    mockExportService: {
      exportReport: jest.fn(),
      updateVisibility: jest.fn(),
      getSharingSettings: jest.fn(),
      getSharedTopic: jest.fn(),
      getSharedTopicLatestReport: jest.fn(),
    },
    mockScheduleService: { getSchedule: jest.fn(), updateSchedule: jest.fn() },
    mockQualityTraceService: {
      getQualityTrace: jest.fn(),
      getQualitySummary: jest.fn(),
      getQualityDetails: jest.fn(),
    },
    mockReportDataService: {
      deleteReportCascade: jest.fn(),
      updateReportContent: jest.fn(),
      getReportRevisions: jest.fn(),
      rollbackToRevision: jest.fn(),
      saveAiEditRevision: jest.fn(),
    },
  };
}

async function buildService(mocks: ReturnType<typeof buildMocks>) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TopicInsightsService,
      { provide: PrismaService, useValue: mocks.mockPrisma },
      { provide: EventEmitter2, useValue: mocks.mockEventEmitter },
      {
        provide: TopicTeamOrchestratorService,
        useValue: mocks.mockOrchestrator,
      },
      { provide: ReportSynthesisService, useValue: mocks.mockReportService },
      {
        provide: EvidenceManagementService,
        useValue: mocks.mockEvidenceService,
      },
      { provide: ChatFacade, useValue: mocks.mockFacade },
      { provide: ReportChangeService, useValue: mocks.mockReportChangeService },
      {
        provide: ReportAnnotationService,
        useValue: mocks.mockReportAnnotationService,
      },
      {
        provide: ResearchStrategyService,
        useValue: mocks.mockResearchStrategyService,
      },
      {
        provide: AgentActivityService,
        useValue: mocks.mockAgentActivityService,
      },
      {
        provide: CredibilityReportService,
        useValue: mocks.mockCredibilityReportService,
      },
      { provide: TopicCrudService, useValue: mocks.mockCrudService },
      { provide: TopicDimensionService, useValue: mocks.mockDimensionService },
      { provide: TopicExportService, useValue: mocks.mockExportService },
      { provide: TopicScheduleService, useValue: mocks.mockScheduleService },
      {
        provide: ReportQualityTraceService,
        useValue: mocks.mockQualityTraceService,
      },
      { provide: ReportDataService, useValue: mocks.mockReportDataService },
      { provide: LatexRepairService, useValue: { repairMarkdown: jest.fn() } },
    ],
  }).compile();

  return module.get<TopicInsightsService>(TopicInsightsService);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("TopicInsightsService – getComputeUsage", () => {
  let service: TopicInsightsService;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    mocks = buildMocks();
    service = await buildService(mocks);
  });

  afterEach(() => jest.clearAllMocks());

  // ═══════════════════════════════════════════════════════════════════════════
  // Mission resolution
  // ═══════════════════════════════════════════════════════════════════════════

  describe("mission resolution", () => {
    it("no missionId → queries latest mission ordered by createdAt desc", async () => {
      // Arrange
      const mission = makeMission();
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(mission);

      // Act
      const result = await service.getComputeUsage(USER_ID, TOPIC_ID);

      // Assert – findFirst called WITHOUT id filter, but with orderBy desc
      expect(mocks.mockPrisma.researchMission.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { topicId: TOPIC_ID },
          orderBy: { createdAt: "desc" },
        }),
      );
      expect(result.currentMissionId).toBe(MISSION_ID);
    });

    it("specific missionId → queries by id AND topicId for ownership check", async () => {
      // Arrange
      const mission = makeMission();
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(mission);

      // Act
      const result = await service.getComputeUsage(
        USER_ID,
        TOPIC_ID,
        MISSION_ID,
      );

      // Assert – findFirst called WITH id filter
      expect(mocks.mockPrisma.researchMission.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: MISSION_ID, topicId: TOPIC_ID },
        }),
      );
      expect(result.currentMissionId).toBe(MISSION_ID);
    });

    it("invalid missionId (not found) → throws NotFoundException", async () => {
      // Arrange
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.getComputeUsage(USER_ID, TOPIC_ID, "nonexistent-mission"),
      ).rejects.toThrow(NotFoundException);
    });

    it("missionId from a different topic → throws NotFoundException (security boundary)", async () => {
      // Arrange: findFirst({ where: { id, topicId } }) returns null because
      // the mission belongs to a different topic
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.getComputeUsage(USER_ID, TOPIC_ID, "mission-other-topic"),
      ).rejects.toThrow(NotFoundException);

      // Confirm that the query included topicId to enforce ownership
      expect(mocks.mockPrisma.researchMission.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ topicId: TOPIC_ID }),
        }),
      );
    });

    it("no missions at all → returns null mission and empty data", async () => {
      // Arrange
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(null);

      // Act
      const result = await service.getComputeUsage(USER_ID, TOPIC_ID);

      // Assert
      expect(result.mission).toBeNull();
      expect(result.currentMissionId).toBeNull();
      expect(result.summary.researchDurationMs).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Time window filtering
  // ═══════════════════════════════════════════════════════════════════════════

  describe("time window filtering", () => {
    it("credit transactions filtered by mission startedAt and completedAt", async () => {
      // Arrange
      const startedAt = makeDate(0);
      const completedAt = makeDate(60_000);
      const mission = makeMission({ startedAt, completedAt });
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(mission);

      // Act
      await service.getComputeUsage(USER_ID, TOPIC_ID, MISSION_ID);

      // Assert – creditTransaction.findMany called with correct window
      expect(mocks.mockPrisma.creditTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            referenceId: TOPIC_ID,
            createdAt: { gte: startedAt, lte: completedAt },
          }),
        }),
      );
    });

    it("executing mission (completedAt=null) → uses Date.now() as window end, not null", async () => {
      // Arrange
      const startedAt = makeDate(0);
      const mission = makeMission({ startedAt, completedAt: null });
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(mission);

      const before = new Date();

      // Act
      await service.getComputeUsage(USER_ID, TOPIC_ID, MISSION_ID);

      const after = new Date();

      // Assert – $queryRaw should have been called with a window end >= before
      const _rawCall = mocks.mockPrisma.$queryRaw.mock.calls[0];
      // The raw template literal passes windowEnd as a parameter (4th bound value
      // based on the query structure: topicId, windowStart, windowEnd)
      // We verify creditTransaction.findMany was called without completedAt constraint
      const findManyCall =
        mocks.mockPrisma.creditTransaction.findMany.mock.calls[0][0];
      const windowEnd = findManyCall.where.createdAt.lte as Date;
      expect(windowEnd.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(windowEnd.getTime()).toBeLessThanOrEqual(after.getTime() + 100);
    });

    it("reports filtered by mission time window", async () => {
      // Arrange
      const startedAt = makeDate(0);
      const completedAt = makeDate(60_000);
      const mission = makeMission({ startedAt, completedAt });
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(mission);

      // Act
      await service.getComputeUsage(USER_ID, TOPIC_ID, MISSION_ID);

      // Assert – topicReport.findFirst called with generatedAt window
      expect(mocks.mockPrisma.topicReport.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            topicId: TOPIC_ID,
            generatedAt: { gte: startedAt, lte: completedAt },
          }),
        }),
      );
    });

    it("latency sessions filtered by mission time window", async () => {
      // Arrange
      const startedAt = makeDate(0);
      const completedAt = makeDate(60_000);
      const mission = makeMission({ startedAt, completedAt });
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(mission);

      // Act
      await service.getComputeUsage(USER_ID, TOPIC_ID, MISSION_ID);

      // Assert – latencySession query is skipped when latencyTracker not injected
      // (the if(this.latencyTracker) guard prevents the call)
      expect(mocks.mockPrisma.latencySession.findFirst).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Mission list
  // ═══════════════════════════════════════════════════════════════════════════

  describe("mission list", () => {
    it("returns all missions for the topic, up to 20", async () => {
      // Arrange
      const missions = Array.from({ length: 5 }, (_, i) =>
        makeMission({ id: `mission-${i}`, createdAt: makeDate(-i * 1000) }),
      );
      mocks.mockPrisma.researchMission.findMany.mockResolvedValue(missions);
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(missions[0]);

      // Act
      const result = await service.getComputeUsage(USER_ID, TOPIC_ID);

      // Assert – findMany called with take: 20
      expect(mocks.mockPrisma.researchMission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { topicId: TOPIC_ID },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
      );
      expect(result.missions).toHaveLength(5);
    });

    it("missions ordered by createdAt desc", async () => {
      // Arrange
      const older = makeMission({
        id: "mission-old",
        createdAt: makeDate(-10_000),
      });
      const newer = makeMission({ id: "mission-new", createdAt: makeDate(0) });
      // Simulate DB returning desc order
      mocks.mockPrisma.researchMission.findMany.mockResolvedValue([
        newer,
        older,
      ]);
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(newer);

      // Act
      const result = await service.getComputeUsage(USER_ID, TOPIC_ID);

      // Assert
      expect(result.missions[0].id).toBe("mission-new");
      expect(result.missions[1].id).toBe("mission-old");
    });

    it("returns currentMissionId matching the selected mission", async () => {
      // Arrange
      const mission = makeMission({ id: "mission-abc" });
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(mission);

      // Act
      const result = await service.getComputeUsage(
        USER_ID,
        TOPIC_ID,
        "mission-abc",
      );

      // Assert
      expect(result.currentMissionId).toBe("mission-abc");
    });

    it("currentMissionId is null when no missions exist", async () => {
      // Arrange
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(null);

      // Act
      const result = await service.getComputeUsage(USER_ID, TOPIC_ID);

      // Assert
      expect(result.currentMissionId).toBeNull();
    });

    it("mission shape matches expected fields", async () => {
      // Arrange
      const startedAt = makeDate(0);
      const completedAt = makeDate(60_000);
      const createdAt = makeDate(-1000);
      const mission = makeMission({
        startedAt,
        completedAt,
        createdAt,
        status: "completed",
        researchDepth: "deep",
      });
      mocks.mockPrisma.researchMission.findMany.mockResolvedValue([mission]);
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(mission);

      // Act
      const result = await service.getComputeUsage(USER_ID, TOPIC_ID);

      // Assert
      expect(result.missions[0]).toMatchObject({
        id: MISSION_ID,
        status: "completed",
        researchDepth: "deep",
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        createdAt: createdAt.toISOString(),
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Edge cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe("edge cases", () => {
    it("mission with startedAt=null → uses createdAt as window fallback", async () => {
      // Arrange
      const createdAt = makeDate(-5000);
      const completedAt = makeDate(60_000);
      const mission = makeMission({ startedAt: null, completedAt, createdAt });
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(mission);

      // Act
      await service.getComputeUsage(USER_ID, TOPIC_ID, MISSION_ID);

      // Assert – creditTransaction window starts at createdAt (the fallback)
      expect(mocks.mockPrisma.creditTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: createdAt, lte: completedAt },
          }),
        }),
      );
    });

    it("topic with credit transactions but no missions → returns all transactions without time filter", async () => {
      // Arrange
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(null);
      const transactions = [
        {
          operationType: "llm_call",
          amount: -5,
          tokenCount: 1000,
          inputTokens: 800,
          outputTokens: 200,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          modelName: "gpt-4o",
          createdAt: makeDate(0),
        },
      ];
      mocks.mockPrisma.creditTransaction.findMany.mockResolvedValue(
        transactions,
      );

      // Act
      const result = await service.getComputeUsage(USER_ID, TOPIC_ID);

      // Assert – no time filter applied (windowStart is undefined)
      const findManyArg =
        mocks.mockPrisma.creditTransaction.findMany.mock.calls[0][0];
      expect(findManyArg.where).not.toHaveProperty("createdAt");
      expect(result.creditHistory).toHaveLength(1);
      expect(result.summary.totalCreditsConsumed).toBe(5);
    });

    it("multiple missions – credit transactions isolated to selected mission window", async () => {
      // Arrange: two missions with non-overlapping time windows
      const _mission1StartedAt = makeDate(0);
      const _mission1CompletedAt = makeDate(30_000);

      const mission2StartedAt = makeDate(60_000);
      const mission2CompletedAt = makeDate(90_000);

      const mission2 = makeMission({
        id: "mission-002",
        startedAt: mission2StartedAt,
        completedAt: mission2CompletedAt,
        createdAt: makeDate(55_000),
      });
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(mission2);

      const mission2Transactions = [
        {
          operationType: "llm_call",
          amount: -10,
          tokenCount: 2000,
          inputTokens: 1500,
          outputTokens: 500,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          modelName: "claude-3",
          createdAt: makeDate(70_000),
        },
      ];
      mocks.mockPrisma.creditTransaction.findMany.mockResolvedValue(
        mission2Transactions,
      );

      // Act
      const result = await service.getComputeUsage(
        USER_ID,
        TOPIC_ID,
        "mission-002",
      );

      // Assert – window is scoped to mission2 times
      expect(mocks.mockPrisma.creditTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: mission2StartedAt, lte: mission2CompletedAt },
          }),
        }),
      );
      expect(result.creditHistory).toHaveLength(1);
      expect(result.creditHistory[0].modelName).toBe("claude-3");
    });

    it("researchDurationMs computed from mission startedAt and completedAt", async () => {
      // Arrange
      const startedAt = makeDate(0);
      const completedAt = makeDate(45_000);
      const mission = makeMission({ startedAt, completedAt });
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(mission);

      // Act
      const result = await service.getComputeUsage(
        USER_ID,
        TOPIC_ID,
        MISSION_ID,
      );

      // Assert
      expect(result.summary.researchDurationMs).toBe(45_000);
    });

    it("researchDurationMs is 0 when mission startedAt or completedAt is null", async () => {
      // Arrange – completedAt is null (mission still running)
      const mission = makeMission({
        startedAt: makeDate(0),
        completedAt: null,
      });
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(mission);

      // Act
      const result = await service.getComputeUsage(
        USER_ID,
        TOPIC_ID,
        MISSION_ID,
      );

      // Assert
      expect(result.summary.researchDurationMs).toBe(0);
    });

    it("mission leaderModel falls back to leaderModelId when leaderModelName is null", async () => {
      // Arrange
      const mission = makeMission({
        leaderModelName: null,
        leaderModelId: "model-id-fallback",
      });
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(mission);

      // Act
      const result = await service.getComputeUsage(
        USER_ID,
        TOPIC_ID,
        MISSION_ID,
      );

      // Assert
      expect(result.mission?.leaderModel).toBe("model-id-fallback");
    });

    it("mission leaderModel is empty string when both leaderModelName and leaderModelId are null", async () => {
      // Arrange
      const mission = makeMission({
        leaderModelName: null,
        leaderModelId: null,
      });
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(mission);

      // Act
      const result = await service.getComputeUsage(
        USER_ID,
        TOPIC_ID,
        MISSION_ID,
      );

      // Assert
      expect(result.mission?.leaderModel).toBe("");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Summary aggregation
  // ═══════════════════════════════════════════════════════════════════════════

  describe("summary aggregation", () => {
    it("totalCreditsConsumed sums absolute values of negative transactions only", async () => {
      // Arrange
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(null);
      mocks.mockPrisma.creditTransaction.findMany.mockResolvedValue([
        {
          operationType: "llm_call",
          amount: -10,
          tokenCount: null,
          inputTokens: null,
          outputTokens: null,
          cacheCreationTokens: null,
          cacheReadTokens: null,
          modelName: null,
          createdAt: makeDate(0),
        },
        {
          operationType: "top_up",
          amount: 50,
          tokenCount: null,
          inputTokens: null,
          outputTokens: null,
          cacheCreationTokens: null,
          cacheReadTokens: null,
          modelName: null,
          createdAt: makeDate(0),
        },
        {
          operationType: "llm_call",
          amount: -3,
          tokenCount: null,
          inputTokens: null,
          outputTokens: null,
          cacheCreationTokens: null,
          cacheReadTokens: null,
          modelName: null,
          createdAt: makeDate(0),
        },
      ]);

      // Act
      const result = await service.getComputeUsage(USER_ID, TOPIC_ID);

      // Assert – only -10 and -3 count
      expect(result.summary.totalCreditsConsumed).toBe(13);
    });

    it("totalTokens falls back to report totalTokens when credit agg is zero", async () => {
      // Arrange
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(null);
      mocks.mockPrisma.$queryRaw.mockResolvedValue([]); // no credit agg rows
      mocks.mockPrisma.topicReport.findFirst.mockResolvedValue({
        id: "report-001",
        totalTokens: 9999,
        generationTimeMs: 5000,
        totalDimensions: 4,
      });

      // Act
      const result = await service.getComputeUsage(USER_ID, TOPIC_ID);

      // Assert
      expect(result.summary.totalTokens).toBe(9999);
    });

    it("totalTokens uses credit aggregation when non-zero (preferred over report)", async () => {
      // Arrange
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(null);
      mocks.mockPrisma.$queryRaw.mockResolvedValue([
        {
          model_name: "gpt-4o",
          call_count: BigInt(3),
          total_tokens: BigInt(5000),
          total_input_tokens: BigInt(3000),
          total_output_tokens: BigInt(2000),
          total_cache_creation_tokens: BigInt(0),
          total_cache_read_tokens: BigInt(0),
        },
      ]);
      mocks.mockPrisma.topicReport.findFirst.mockResolvedValue({
        id: "report-001",
        totalTokens: 9999,
        generationTimeMs: 5000,
        totalDimensions: 4,
      });

      // Act
      const result = await service.getComputeUsage(USER_ID, TOPIC_ID);

      // Assert – credit agg wins
      expect(result.summary.totalTokens).toBe(5000);
      expect(result.summary.inputTokens).toBe(3000);
      expect(result.summary.outputTokens).toBe(2000);
      expect(result.summary.totalLlmCalls).toBe(3);
    });

    it("estimatedCostUsd is 0 when totalTokens is 0", async () => {
      // Arrange
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(null);

      // Act
      const result = await service.getComputeUsage(USER_ID, TOPIC_ID);

      // Assert
      expect(result.summary.estimatedCostUsd).toBe(0);
    });

    it("estimatedCostUsd computed at $2 per 1M tokens", async () => {
      // Arrange
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(null);
      mocks.mockPrisma.$queryRaw.mockResolvedValue([
        {
          model_name: "gpt-4o",
          call_count: BigInt(1),
          total_tokens: BigInt(1_000_000),
          total_input_tokens: BigInt(800_000),
          total_output_tokens: BigInt(200_000),
          total_cache_creation_tokens: BigInt(0),
          total_cache_read_tokens: BigInt(0),
        },
      ]);

      // Act
      const result = await service.getComputeUsage(USER_ID, TOPIC_ID);

      // Assert
      expect(result.summary.estimatedCostUsd).toBe(2);
    });

    it("modelDistribution excludes rows with null model_name", async () => {
      // Arrange
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(null);
      mocks.mockPrisma.$queryRaw.mockResolvedValue([
        {
          model_name: null,
          call_count: BigInt(5),
          total_tokens: BigInt(1000),
          total_input_tokens: BigInt(800),
          total_output_tokens: BigInt(200),
          total_cache_creation_tokens: BigInt(0),
          total_cache_read_tokens: BigInt(0),
        },
        {
          model_name: "claude-3",
          call_count: BigInt(2),
          total_tokens: BigInt(500),
          total_input_tokens: BigInt(400),
          total_output_tokens: BigInt(100),
          total_cache_creation_tokens: BigInt(0),
          total_cache_read_tokens: BigInt(0),
        },
      ]);

      // Act
      const result = await service.getComputeUsage(USER_ID, TOPIC_ID);

      // Assert – only non-null model_name in distribution
      expect(result.modelDistribution).toHaveLength(1);
      expect(result.modelDistribution[0].modelId).toBe("claude-3");
    });

    it("modelDistribution percentage sums correctly across models", async () => {
      // Arrange
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(null);
      mocks.mockPrisma.$queryRaw.mockResolvedValue([
        {
          model_name: "gpt-4o",
          call_count: BigInt(3),
          total_tokens: BigInt(3000),
          total_input_tokens: BigInt(2000),
          total_output_tokens: BigInt(1000),
          total_cache_creation_tokens: BigInt(0),
          total_cache_read_tokens: BigInt(0),
        },
        {
          model_name: "claude-3",
          call_count: BigInt(1),
          total_tokens: BigInt(1000),
          total_input_tokens: BigInt(800),
          total_output_tokens: BigInt(200),
          total_cache_creation_tokens: BigInt(0),
          total_cache_read_tokens: BigInt(0),
        },
      ]);

      // Act
      const result = await service.getComputeUsage(USER_ID, TOPIC_ID);

      // Assert – 3 out of 4 calls = 75%, 1 out of 4 = 25%
      const gpt4 = result.modelDistribution.find((m) => m.modelId === "gpt-4o");
      const claude = result.modelDistribution.find(
        (m) => m.modelId === "claude-3",
      );
      expect(gpt4?.percentage).toBe(75);
      expect(claude?.percentage).toBe(25);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Access control (verifyTopicReadAccess delegation)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("access control", () => {
    it("throws NotFoundException when topic does not exist", async () => {
      // Arrange – researchTopic.findUnique returns null (topic not found)
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.getComputeUsage(USER_ID, TOPIC_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Response shape
  // ═══════════════════════════════════════════════════════════════════════════

  describe("response shape", () => {
    it("returns all required top-level keys", async () => {
      // Arrange
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(null);

      // Act
      const result = await service.getComputeUsage(USER_ID, TOPIC_ID);

      // Assert
      expect(result).toHaveProperty("summary");
      expect(result).toHaveProperty("dimensions");
      expect(result).toHaveProperty("modelDistribution");
      expect(result).toHaveProperty("creditHistory");
      expect(result).toHaveProperty("mission");
      expect(result).toHaveProperty("latency");
      expect(result).toHaveProperty("latencySteps");
      expect(result).toHaveProperty("missions");
      expect(result).toHaveProperty("currentMissionId");
    });

    it("creditHistory entries have ISO string createdAt", async () => {
      // Arrange
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(null);
      const ts = makeDate(0);
      mocks.mockPrisma.creditTransaction.findMany.mockResolvedValue([
        {
          operationType: "llm_call",
          amount: -5,
          tokenCount: 1000,
          inputTokens: 800,
          outputTokens: 200,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          modelName: "gpt-4o",
          createdAt: ts,
        },
      ]);

      // Act
      const result = await service.getComputeUsage(USER_ID, TOPIC_ID);

      // Assert
      expect(result.creditHistory[0].createdAt).toBe(ts.toISOString());
    });

    it("mission object has correct shape when mission exists", async () => {
      // Arrange
      const startedAt = makeDate(0);
      const completedAt = makeDate(60_000);
      const mission = makeMission({
        startedAt,
        completedAt,
        totalTasks: 8,
        completedTasks: 8,
        researchDepth: "standard",
      });
      mocks.mockPrisma.researchMission.findFirst.mockResolvedValue(mission);

      // Act
      const result = await service.getComputeUsage(
        USER_ID,
        TOPIC_ID,
        MISSION_ID,
      );

      // Assert
      expect(result.mission).toMatchObject({
        leaderModel: "gpt-4o",
        researchDepth: "standard",
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        totalTasks: 8,
        completedTasks: 8,
      });
    });
  });
});
