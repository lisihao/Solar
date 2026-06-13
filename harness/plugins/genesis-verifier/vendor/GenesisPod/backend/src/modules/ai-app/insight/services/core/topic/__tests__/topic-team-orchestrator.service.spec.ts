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

const mockPrisma = {
  topicRefreshLog: {
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  researchTopic: {
    update: jest.fn(),
    findUnique: jest.fn(),
  },
  topicDimension: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  researchMission: {
    create: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  researchTask: {
    create: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  researchTodo: {
    updateMany: jest.fn(),
  },
};

const mockEventEmitter = {
  emit: jest.fn(),
  on: jest.fn(),
};

const mockDimensionMissionService = {
  researchDimension: jest.fn(),
  executeSearchPhase: jest.fn(),
  executeAnalysisPhase: jest.fn(),
  clearEvidenceCache: jest.fn(),
};

const mockReportSynthesisService = {
  createDraftReport: jest.fn(),
  synthesizeReport: jest.fn(),
  getReport: jest.fn(),
};

const mockResearchReviewerService = {
  reviewDimension: jest.fn(),
  reviewOverall: jest.fn(),
};

const mockResearchLeaderService = {
  planResearch: jest.fn(),
  evaluateAndAssign: jest.fn(),
};

const mockResearchCheckpointService = {
  saveCheckpoint: jest.fn(),
  getCheckpoint: jest.fn(),
};

const mockDataSourceRouterService = {
  fetchEvidence: jest.fn(),
};

const mockResearchTodoService = {
  createTodo: jest.fn(),
  updateTodoStatus: jest.fn(),
  getTodoSummary: jest.fn(),
};

const mockCritiqueRefineService = {
  critiqueAndRefine: jest.fn(),
};

const mockFacade = {
  chat: jest.fn(),
  startTrace: jest.fn().mockReturnValue("trace-123"),
  endTrace: jest.fn(),
  addSpan: jest.fn().mockReturnValue("span-123"),
  endSpan: jest.fn(),
};

const mockTopic = {
  id: "topic-1",
  name: "AI Market Research",
  type: "TECHNOLOGY",
  userId: "user-1",
  description: "Test research topic",
  dimensions: [],
};

const mockDraft = {
  id: "report-1",
  topicId: "topic-1",
  version: 1,
  status: "DRAFT",
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

describe("TopicTeamOrchestratorService", () => {
  let service: TopicTeamOrchestratorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicTeamOrchestratorService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        {
          provide: DimensionMissionService,
          useValue: mockDimensionMissionService,
        },
        {
          provide: ReportSynthesisService,
          useValue: mockReportSynthesisService,
        },
        {
          provide: ResearchReviewerService,
          useValue: mockResearchReviewerService,
        },
        { provide: ResearchLeaderService, useValue: mockResearchLeaderService },
        {
          provide: ResearchCheckpointService,
          useValue: mockResearchCheckpointService,
        },
        {
          provide: DataSourceRouterService,
          useValue: mockDataSourceRouterService,
        },
        { provide: ResearchTodoService, useValue: mockResearchTodoService },
        { provide: CritiqueRefineService, useValue: mockCritiqueRefineService },
        { provide: AgentFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<TopicTeamOrchestratorService>(
      TopicTeamOrchestratorService,
    );
    jest.clearAllMocks();
  });

  describe("executeRefresh", () => {
    beforeEach(() => {
      mockPrisma.topicRefreshLog.create.mockResolvedValue({
        id: "log-1",
        topicId: "topic-1",
      });
      mockPrisma.topicRefreshLog.update.mockResolvedValue({});
      mockPrisma.researchTopic.update.mockResolvedValue({});
      mockPrisma.topicDimension.findMany.mockResolvedValue([mockDimension]);
      mockPrisma.topicDimension.updateMany.mockResolvedValue({ count: 0 });
      // 默认无卡死 mission（不触发清理）
      mockPrisma.researchMission.findFirst.mockResolvedValue(null);
      mockPrisma.researchMission.create.mockResolvedValue({
        id: "mission-new",
        topicId: "topic-1",
        status: "PLANNING",
      });
      mockPrisma.researchMission.update.mockResolvedValue({});
      mockPrisma.researchTask.create.mockResolvedValue({});
      mockPrisma.researchTask.createMany.mockResolvedValue({ count: 0 });
      mockPrisma.researchTask.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.researchTodo.updateMany.mockResolvedValue({ count: 0 });
      mockReportSynthesisService.createDraftReport.mockResolvedValue(mockDraft);
      mockReportSynthesisService.synthesizeReport.mockResolvedValue({
        ...mockDraft,
        status: "PUBLISHED",
      });
      mockResearchLeaderService.planResearch.mockResolvedValue({
        assignments: [],
        parallelism: 2,
        strategy: "standard",
        estimatedMinutes: 5,
      });
      mockResearchLeaderService.evaluateAndAssign.mockResolvedValue([]);
      const mockSearchResult = {
        dimension: mockDimension,
        evidence: [
          {
            id: "ev-1",
            title: "Evidence 1",
            url: "https://example.com",
            snippet: "Snippet",
            contentSource: "fetched",
          },
        ],
        evidenceCount: 3,
        searchQueries: ["market size 2024"],
      };
      mockDimensionMissionService.researchDimension.mockResolvedValue({
        analysis: {
          summary: "Market summary",
          keyFindings: [],
          trends: [],
          challenges: [],
          opportunities: [],
          confidenceLevel: "high",
          evidenceUsed: 3,
          detailedContent: "Detailed content",
        },
        evidenceCount: 3,
      });
      mockDimensionMissionService.executeSearchPhase.mockResolvedValue(
        mockSearchResult,
      );
      mockDimensionMissionService.executeAnalysisPhase.mockResolvedValue({
        analysis: {
          summary: "Market summary",
          keyFindings: [],
          trends: [],
          challenges: [],
          opportunities: [],
          confidenceLevel: "high",
          evidenceUsed: 3,
          detailedContent: "Detailed content",
        },
        evidenceCount: 3,
      });
      mockResearchReviewerService.reviewDimension.mockResolvedValue({
        dimensionId: "dim-1",
        dimensionName: "Market Size",
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
      });
      mockResearchReviewerService.reviewOverall.mockResolvedValue({
        topicId: "topic-1",
        topicName: "AI Market Research",
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
      });
      mockResearchCheckpointService.saveCheckpoint.mockResolvedValue({});
      mockResearchCheckpointService.getCheckpoint.mockReturnValue(null);
      mockResearchTodoService.createTodo.mockResolvedValue({});
      mockResearchTodoService.updateTodoStatus.mockResolvedValue({});
      mockResearchTodoService.getTodoSummary.mockResolvedValue({
        total: 1,
        completed: 1,
      });
    });

    it("should throw error when refresh already in progress", async () => {
      // Simulate an active refresh
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

    it("should create refresh log with RUNNING status", async () => {
      await service.executeRefresh(mockTopic as never);

      expect(mockPrisma.topicRefreshLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            topicId: "topic-1",
            status: RefreshLogStatus.RUNNING,
          }),
        }),
      );
    });

    it("should create draft report before researching", async () => {
      await service.executeRefresh(mockTopic as never);

      expect(mockReportSynthesisService.createDraftReport).toHaveBeenCalledWith(
        "topic-1",
      );
    });

    it("should emit progress events during execution", async () => {
      await service.executeRefresh(mockTopic as never);

      expect(mockEventEmitter.emit).toHaveBeenCalled();
    });

    it("should pass forceRefresh option to dimension selection", async () => {
      const options: RefreshOptions = { forceRefresh: true };
      await service.executeRefresh(mockTopic as never, options);

      expect(mockPrisma.topicDimension.findMany).toHaveBeenCalled();
    });

    it("should mark stuck mission as FAILED + disable its own dims", async () => {
      // 上一次 mission 卡在 EXECUTING / PLANNING / REVIEWING 等中间状态时，
      // 入口处应（1）把它 mark 为 FAILED（2）按 missionId 反查 disable 它创建的 dim。
      // 不动 missionId IS NULL 的模板维度（用户 addDimension / topic 创建落下的）。
      mockPrisma.researchMission.findFirst.mockResolvedValue({
        id: "mission-stuck",
        status: "EXECUTING",
      });

      await service.executeRefresh(mockTopic as never);

      expect(mockPrisma.researchMission.update).toHaveBeenCalledWith({
        where: { id: "mission-stuck" },
        data: { status: "FAILED" },
      });
      expect(mockPrisma.topicDimension.updateMany).toHaveBeenCalledWith({
        where: { missionId: "mission-stuck", isEnabled: true },
        data: { isEnabled: false },
      });
    });

    it("should NOT touch dimensions when no stuck mission exists", async () => {
      // 上一次 mission COMPLETED / FAILED 已经正常结束（findFirst 只查中间状态）
      mockPrisma.researchMission.findFirst.mockResolvedValue(null);

      await service.executeRefresh(mockTopic as never);

      // updateMany 不应该被调用（没有 stuck mission）
      // 注意：dimensions 默认 mock 返回 [mockDimension] 让流程能跑下去
      const updateManyCalls = mockPrisma.topicDimension.updateMany.mock.calls;
      const stuckDisableCall = updateManyCalls.find((args: unknown[]) => {
        const arg = args[0] as { where?: { missionId?: string } };
        return (
          typeof arg?.where?.missionId === "string" &&
          arg.where.missionId !== ""
        );
      });
      expect(stuckDisableCall).toBeUndefined();
    });

    it("should ALWAYS create a new mission with PLANNING status at entry", async () => {
      await service.executeRefresh(mockTopic as never);

      // 入口处应创建 mission（status=PLANNING），后续才能给 dim 绑 missionId
      expect(mockPrisma.researchMission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            topicId: "topic-1",
            status: "PLANNING",
          }),
        }),
      );
    });

    // ============= 仿真：4 个核心场景闭环验证 =============

    it("scenario A: first run with empty dim table → leader plans + binds missionId", async () => {
      // 首次启动：dim 表完全空 → getDimensions 0 条 → 走 LLM 规划 → dim 落库带 missionId
      mockPrisma.topicDimension.findMany.mockResolvedValue([]);
      mockPrisma.topicDimension.create = jest.fn().mockResolvedValue({
        ...mockDimension,
        missionId: "mission-new",
      });
      mockResearchLeaderService.planResearch.mockResolvedValue({
        dimensions: [{ name: "Market", description: "d", priority: 1 }],
        agentAssignments: [],
        executionStrategy: { parallelism: 2 },
        strategy: "standard",
        estimatedMinutes: 5,
      });

      await service.executeRefresh(mockTopic as never);

      // dim 落库时必须带 missionId
      expect(mockPrisma.topicDimension.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            topicId: "topic-1",
            missionId: "mission-new",
            name: "Market",
          }),
        }),
      );
    });

    it("scenario B: stuck mission restart → old mission FAILED, its dims disabled, new mission gets fresh plan", async () => {
      // 失败重启：上次 EXECUTING 卡死 → 入口处 FAILED + disable 该 mission 的 dim →
      // 创建新 mission → getDimensions 拉新 mission（0 条）+ 模板（0 条）→ 走 leader 重规划
      mockPrisma.researchMission.findFirst.mockResolvedValue({
        id: "mission-stuck-old",
        status: "EXECUTING",
      });

      await service.executeRefresh(mockTopic as never);

      // 1. 旧 mission 被 mark FAILED
      expect(mockPrisma.researchMission.update).toHaveBeenCalledWith({
        where: { id: "mission-stuck-old" },
        data: { status: "FAILED" },
      });
      // 2. 它自己的 dim 被 disable（按 missionId 反查，不动 NULL 模板）
      expect(mockPrisma.topicDimension.updateMany).toHaveBeenCalledWith({
        where: { missionId: "mission-stuck-old", isEnabled: true },
        data: { isEnabled: false },
      });
      // 3. 创建新 mission
      expect(mockPrisma.researchMission.create).toHaveBeenCalled();
    });

    it("scenario C: getDimensions filter scopes mission AND keeps NULL templates", async () => {
      // 用户 addDimension 加了"模板维度"（missionId IS NULL）→ 应该被新 mission 读到
      // 验证 where 子句包含 OR: [{ missionId }, { missionId: null }]
      mockPrisma.topicDimension.findMany.mockResolvedValue([]);
      mockResearchLeaderService.planResearch.mockResolvedValue({
        dimensions: [{ name: "M", description: "d", priority: 1 }],
        agentAssignments: [],
        strategy: "standard",
        estimatedMinutes: 5,
      });

      await service.executeRefresh(mockTopic as never);

      const findManyCalls = mockPrisma.topicDimension.findMany.mock.calls;
      const dimQuery = findManyCalls.find((args: unknown[]) => {
        const arg = args[0] as { where?: { OR?: unknown[] } };
        return Array.isArray(arg?.where?.OR);
      });
      expect(dimQuery).toBeDefined();
      const where = (dimQuery as unknown[])[0] as {
        where: { OR: Array<{ missionId: string | null }> };
      };
      expect(where.where.OR).toEqual(
        expect.arrayContaining([
          { missionId: "mission-new" },
          { missionId: null },
        ]),
      );
    });

    it("scenario D: completed mission then '开始' → still creates new mission, leader re-plans", async () => {
      // 上次 mission COMPLETED 不是卡死状态 → findFirst (filter 中间状态) 返回 null
      // 仍然创建新 mission，dim 由 leader 重规划绑新 missionId
      mockPrisma.researchMission.findFirst.mockResolvedValue(null);
      mockPrisma.topicDimension.findMany.mockResolvedValue([]);
      mockResearchLeaderService.planResearch.mockResolvedValue({
        dimensions: [{ name: "X", description: "x", priority: 1 }],
        agentAssignments: [],
        strategy: "standard",
        estimatedMinutes: 5,
      });

      await service.executeRefresh(mockTopic as never);

      // 旧 mission 不应被 update（findFirst 没找到中间状态）
      const updateCalls = mockPrisma.researchMission.update.mock.calls;
      const failedUpdate = updateCalls.find((args: unknown[]) => {
        const arg = args[0] as { data?: { status?: string } };
        return arg?.data?.status === "FAILED";
      });
      expect(failedUpdate).toBeUndefined();
      // 新 mission 仍然创建
      expect(mockPrisma.researchMission.create).toHaveBeenCalled();
    });
  });

  describe("cancelRefresh", () => {
    it("should cancel active refresh and return true", async () => {
      const abortController = new AbortController();
      (
        service as unknown as { activeRefreshes: Map<string, unknown> }
      ).activeRefreshes.set("topic-1", {
        abortController,
        startedAt: new Date(),
      });

      const result = await service.cancelRefresh("topic-1");

      expect(result).toBe(true);
    });

    it("should return false when no active refresh", async () => {
      const result = await service.cancelRefresh("topic-no-refresh");

      expect(result).toBe(false);
    });

    it("should call abort() on the AbortController", async () => {
      const abortController = new AbortController();
      const abortSpy = jest.spyOn(abortController, "abort");
      (
        service as unknown as { activeRefreshes: Map<string, unknown> }
      ).activeRefreshes.set("topic-1", {
        abortController,
        startedAt: new Date(),
      });

      mockPrisma.topicRefreshLog.updateMany.mockResolvedValue({ count: 1 });

      await service.cancelRefresh("topic-1");

      expect(abortSpy).toHaveBeenCalled();
    });

    it("should update refresh log to CANCELLED status", async () => {
      const abortController = new AbortController();
      (
        service as unknown as { activeRefreshes: Map<string, unknown> }
      ).activeRefreshes.set("topic-1", {
        abortController,
        startedAt: new Date(),
      });

      mockPrisma.topicRefreshLog.updateMany.mockResolvedValue({ count: 1 });

      await service.cancelRefresh("topic-1");

      expect(mockPrisma.topicRefreshLog.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            topicId: "topic-1",
            status: RefreshLogStatus.RUNNING,
          }),
          data: expect.objectContaining({
            status: RefreshLogStatus.CANCELLED,
          }),
        }),
      );
    });

    it("should remove topic from activeRefreshes after cancel", async () => {
      const abortController = new AbortController();
      const activeRefreshes = (
        service as unknown as { activeRefreshes: Map<string, unknown> }
      ).activeRefreshes;
      activeRefreshes.set("topic-1", {
        abortController,
        startedAt: new Date(),
      });

      mockPrisma.topicRefreshLog.updateMany.mockResolvedValue({ count: 1 });

      await service.cancelRefresh("topic-1");

      expect(activeRefreshes.has("topic-1")).toBe(false);
    });
  });

  describe("getRefreshStatus", () => {
    it("should return isRunning=false when no active refresh", () => {
      const status = service.getRefreshStatus("topic-no-refresh");

      expect(status.isRunning).toBe(false);
      expect(status.startedAt).toBeUndefined();
    });

    it("should return isRunning=true with startedAt when active refresh exists", () => {
      const startedAt = new Date("2026-01-01T10:00:00.000Z");
      const abortController = new AbortController();
      (
        service as unknown as { activeRefreshes: Map<string, unknown> }
      ).activeRefreshes.set("topic-1", {
        abortController,
        startedAt,
      });

      const status = service.getRefreshStatus("topic-1");

      expect(status.isRunning).toBe(true);
      expect(status.startedAt).toEqual(startedAt);

      // Cleanup
      (
        service as unknown as { activeRefreshes: Map<string, unknown> }
      ).activeRefreshes.delete("topic-1");
    });
  });

  describe("executeRefresh - error handling", () => {
    beforeEach(() => {
      mockPrisma.topicRefreshLog.create.mockResolvedValue({
        id: "log-1",
        topicId: "topic-1",
      });
      mockPrisma.topicRefreshLog.update.mockResolvedValue({});
      mockPrisma.topicRefreshLog.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.researchTopic.update.mockResolvedValue({});
      mockPrisma.topicDimension.findMany.mockResolvedValue([mockDimension]);
      mockPrisma.topicDimension.updateMany.mockResolvedValue({});
      mockPrisma.researchMission.create.mockResolvedValue({ id: "mission-1" });
      mockPrisma.researchMission.update.mockResolvedValue({});
      mockPrisma.researchTask.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.researchTask.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.researchTodo.updateMany.mockResolvedValue({ count: 1 });
      mockReportSynthesisService.createDraftReport.mockResolvedValue(mockDraft);
      mockReportSynthesisService.synthesizeReport.mockResolvedValue({
        ...mockDraft,
        status: "PUBLISHED",
        totalSources: 5,
      });
      mockResearchLeaderService.planResearch.mockResolvedValue({
        assignments: [],
        parallelism: 2,
        strategy: "standard",
        estimatedMinutes: 5,
      });
      mockResearchLeaderService.evaluateAndAssign.mockResolvedValue([]);
      mockDimensionMissionService.researchDimension.mockResolvedValue({
        analysis: {
          summary: "Market summary",
          keyFindings: [],
          trends: [],
          challenges: [],
          opportunities: [],
          confidenceLevel: "high",
          evidenceUsed: 3,
          detailedContent: "Detailed content",
        },
        evidenceCount: 3,
      });
      mockDimensionMissionService.executeSearchPhase.mockResolvedValue({
        dimension: mockDimension,
        evidence: [],
        evidenceCount: 0,
        searchQueries: [],
      });
      mockDimensionMissionService.executeAnalysisPhase.mockResolvedValue({
        analysis: {
          summary: "Market summary",
          keyFindings: [],
          trends: [],
          challenges: [],
          opportunities: [],
          confidenceLevel: "high",
          evidenceUsed: 3,
          detailedContent: "Detailed content",
        },
        evidenceCount: 3,
      });
      mockResearchReviewerService.reviewDimension.mockResolvedValue({
        dimensionId: "dim-1",
        dimensionName: "Market Size",
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
      });
      mockResearchReviewerService.reviewOverall.mockResolvedValue({
        topicId: "topic-1",
        topicName: "AI Market Research",
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
      });
      mockResearchCheckpointService.saveCheckpoint.mockResolvedValue({});
      mockResearchCheckpointService.getCheckpoint.mockReturnValue(null);
      mockResearchTodoService.createTodo.mockResolvedValue({ id: "todo-1" });
      mockResearchTodoService.updateTodoStatus.mockResolvedValue({});
      mockResearchTodoService.getTodoSummary.mockResolvedValue({
        total: 1,
        completed: 1,
      });
    });

    it("should update refresh log to FAILED when synthesizeReport throws", async () => {
      mockReportSynthesisService.synthesizeReport.mockRejectedValue(
        new Error("Synthesis failed"),
      );

      await expect(service.executeRefresh(mockTopic as never)).rejects.toThrow(
        "Synthesis failed",
      );

      expect(mockPrisma.topicRefreshLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: RefreshLogStatus.FAILED,
            error: "Synthesis failed",
          }),
        }),
      );
    });

    it("should remove topic from activeRefreshes after failure", async () => {
      mockReportSynthesisService.synthesizeReport.mockRejectedValue(
        new Error("Synthesis failed"),
      );

      const activeRefreshes = (
        service as unknown as { activeRefreshes: Map<string, unknown> }
      ).activeRefreshes;

      await expect(
        service.executeRefresh(mockTopic as never),
      ).rejects.toThrow();

      expect(activeRefreshes.has("topic-1")).toBe(false);
    });

    it("should call planResearch and create dimensions when no dimensions found", async () => {
      mockPrisma.topicDimension.findMany.mockResolvedValue([]);
      mockResearchLeaderService.planResearch.mockResolvedValue({
        dimensions: [
          {
            name: "Market Overview",
            description: "Overview of the market",
            priority: 1,
            searchQueries: ["market overview 2024"],
            dataSources: ["web"],
          },
        ],
        agentAssignments: [],
        executionStrategy: { parallelism: 2 },
      });
      mockPrisma.topicDimension.create = jest.fn().mockResolvedValue({
        id: "new-dim-1",
        name: "Market Overview",
        description: "Overview of the market",
        sortOrder: 1,
        status: DimensionStatus.PENDING,
        searchQueries: [],
        searchSources: [],
        topicId: "topic-1",
      });

      await service.executeRefresh(mockTopic as never);

      expect(mockResearchLeaderService.planResearch).toHaveBeenCalledWith(
        "topic-1",
      );
      expect(mockPrisma.topicDimension.create).toHaveBeenCalled();
    });

    it("should throw error when no dimensions found and leader plan returns empty dimensions", async () => {
      mockPrisma.topicDimension.findMany.mockResolvedValue([]);
      mockResearchLeaderService.planResearch.mockResolvedValue({
        dimensions: [],
        agentAssignments: [],
      });

      await expect(service.executeRefresh(mockTopic as never)).rejects.toThrow(
        "Leader AI failed to plan dimensions",
      );
    });

    it("should throw error when no dimensions found and leader plan has no dimensions key", async () => {
      mockPrisma.topicDimension.findMany.mockResolvedValue([]);
      mockResearchLeaderService.planResearch.mockResolvedValue({
        agentAssignments: [],
      });

      await expect(service.executeRefresh(mockTopic as never)).rejects.toThrow(
        "Leader AI failed to plan dimensions",
      );
    });
  });
});
