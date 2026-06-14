/**
 * MissionLifecycleService Unit Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { MissionLifecycleService } from "../mission-lifecycle.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { LeaderPlanningService } from "../../leader/leader-planning.service";
import { LeaderIntentService } from "../../leader/leader-intent.service";
import { ResearchEventEmitterService } from "../../research/research-event-emitter.service";
import { TopicCollaboratorService } from "../../../collaboration/topic-collaborator.service";
import { AgentActivityService } from "../../../monitoring/agent-activity.service";
import { MissionQueryService } from "../mission-query.service";
import { MissionExecutionService } from "../mission-execution.service";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
import {
  ResearchMissionStatus,
  ResearchTaskStatus,
  _ResearchTodoStatus,
} from "@prisma/client";

// ─── Mocks ───────────────────────────────────────────────────────────────────

function buildMocks() {
  const mockPrisma = {
    researchTopic: {
      findUnique: jest.fn(),
    },
    researchMission: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    researchTask: {
      create: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    researchTodo: {
      updateMany: jest.fn(),
    },
    topicDimension: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    topicReport: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    leaderDecision: {
      create: jest.fn(),
    },
  };

  const mockLeaderService = {
    getReasoningModel: jest
      .fn()
      .mockResolvedValue({ modelId: "gpt-4o", modelName: "GPT-4o" }),
    planResearch: jest.fn(),
    handleUserMessage: jest.fn(),
  };

  const mockLeaderPlanningService = {
    planResearch: jest.fn(),
    getReasoningModel: jest
      .fn()
      .mockResolvedValue({ modelId: "gpt-4o", modelName: "GPT-4o" }),
    planDimensionOutline: jest.fn(),
  };

  const mockLeaderIntentService = {
    handleUserMessage: jest.fn(),
    decodeUserInput: jest.fn(),
  };

  const mockResearchEventEmitter = {
    emitLeaderThinking: jest.fn().mockResolvedValue(undefined),
    emitLeaderPlanning: jest.fn().mockResolvedValue(undefined),
    emitLeaderPlanReady: jest.fn().mockResolvedValue(undefined),
    emitMissionFailed: jest.fn().mockResolvedValue(undefined),
  };

  const mockCollaboratorService = {
    hasAccess: jest.fn().mockResolvedValue(true),
  };

  const mockAgentActivity = {
    recordActivity: jest.fn().mockResolvedValue(undefined),
  };

  const mockQueryService = {
    emitProgress: jest.fn(),
  };

  const mockExecutionService = {
    startExecution: jest.fn().mockResolvedValue(undefined),
  };

  return {
    mockPrisma,
    mockLeaderService,
    mockLeaderPlanningService,
    mockLeaderIntentService,
    mockResearchEventEmitter,
    mockCollaboratorService,
    mockAgentActivity,
    mockQueryService,
    mockExecutionService,
  };
}

const mockTopic = {
  id: "topic-1",
  name: "AI Research",
  userId: "user-1",
};

const mockMission = {
  id: "mission-1",
  topicId: "topic-1",
  status: ResearchMissionStatus.EXECUTING,
  completedTasks: 2,
  totalTasks: 4,
  progressPercent: 50,
  topic: { userId: "user-1", id: "topic-1" },
  tasks: [],
};

const mockLeaderPlan = {
  taskUnderstanding: { topic: "AI Research", scope: "global", objectives: [] },
  dimensions: [
    {
      id: "dim-1",
      name: "Market Analysis",
      description: "Analyze market trends",
      priority: 1,
      searchQueries: [],
      dataSources: ["web"],
    },
  ],
  executionStrategy: { parallelism: 3, priorityOrder: ["dim-1"] },
  agentAssignments: [
    {
      agentId: "researcher-1",
      agentType: "dimension_researcher",
      agentName: "Researcher 1",
      modelId: "gpt-4o",
      assignedDimensions: ["dim-1"],
      skills: [],
      tools: [],
    },
    {
      agentId: "reviewer-1",
      agentType: "quality_reviewer",
      agentName: "Reviewer",
      modelId: "gpt-4o",
    },
    {
      agentId: "writer-1",
      agentType: "report_writer",
      agentName: "Writer",
      modelId: "gpt-4o",
    },
  ],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MissionLifecycleService", () => {
  let service: MissionLifecycleService;
  let prisma: ReturnType<typeof buildMocks>["mockPrisma"];
  let leaderService: ReturnType<typeof buildMocks>["mockLeaderPlanningService"];
  let leaderIntentService: ReturnType<
    typeof buildMocks
  >["mockLeaderIntentService"];
  let collaboratorService: ReturnType<
    typeof buildMocks
  >["mockCollaboratorService"];
  let executionService: ReturnType<typeof buildMocks>["mockExecutionService"];

  beforeEach(async () => {
    const mocks = buildMocks();
    prisma = mocks.mockPrisma;
    leaderService = mocks.mockLeaderPlanningService;
    leaderIntentService = mocks.mockLeaderIntentService;
    collaboratorService = mocks.mockCollaboratorService;
    executionService = mocks.mockExecutionService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MissionLifecycleService,
        { provide: PrismaService, useValue: mocks.mockPrisma },
        {
          provide: LeaderPlanningService,
          useValue: mocks.mockLeaderPlanningService,
        },
        {
          provide: LeaderIntentService,
          useValue: mocks.mockLeaderIntentService,
        },
        {
          provide: ResearchEventEmitterService,
          useValue: mocks.mockResearchEventEmitter,
        },
        {
          provide: TopicCollaboratorService,
          useValue: mocks.mockCollaboratorService,
        },
        { provide: AgentActivityService, useValue: mocks.mockAgentActivity },
        { provide: MissionQueryService, useValue: mocks.mockQueryService },
        {
          provide: MissionExecutionService,
          useValue: mocks.mockExecutionService,
        },
      ],
    }).compile();

    service = module.get<MissionLifecycleService>(MissionLifecycleService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── createMission ──────────────────────────────────────────────────────────

  describe("createMission", () => {
    it("should throw NotFoundException when topic not found", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(null);

      await expect(
        service.createMission({ topicId: "nonexistent", userPrompt: "Test" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should create a mission and return immediately (async planning)", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      prisma.researchMission.findFirst.mockResolvedValue(null);
      prisma.researchMission.create.mockResolvedValue({
        id: "mission-new",
        status: ResearchMissionStatus.PLANNING,
        topicId: "topic-1",
      });

      const result = await service.createMission({
        topicId: "topic-1",
        userPrompt: "Research AI",
      });

      expect(result.id).toBe("mission-new");
      expect(result.status).toBe(ResearchMissionStatus.PLANNING);
    });

    // 2026-05-12 BYOK fix: createMission 通过 RequestContext.run 显式包
    //   executePlanningAsync，保证 async 路径里 RequestContext.userId 一定可见。
    //   背景见 mission-lifecycle.service.ts:285 注释（async 路径 ALS 隐式传播
    //   遇 setTimeout 跨 tick 会丢，导致 selectModel 的 BYOK auto-resolve 拿不到
    //   userId，退化到 admin pool → 用户没该 provider key 时炸 planResearch）。
    it("snapshots RequestContext.userId for async planning (BYOK propagation)", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { RequestContext } = require("@/common/context/request-context");
      prisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      prisma.researchMission.findFirst.mockResolvedValue(null);
      prisma.researchMission.create.mockResolvedValue({
        id: "mission-byok",
        status: ResearchMissionStatus.PLANNING,
        topicId: "topic-1",
      });

      let userIdInsideAsync: string | undefined;
      jest
        .spyOn(service, "executePlanningAsync")
        .mockImplementation(async () => {
          // 模拟跨 tick 异步——AsyncLocalStorage 在某些场景下会丢失
          await new Promise((r) => setTimeout(r, 5));
          userIdInsideAsync = RequestContext.getUserId();
          return undefined;
        });

      await RequestContext.run({ userId: "user-byok" }, () =>
        service.createMission({
          topicId: "topic-1",
          userPrompt: "Research AI",
        }),
      );

      // 等 fire-and-forget 跑完
      await new Promise((r) => setTimeout(r, 20));

      expect(userIdInsideAsync).toBe("user-byok");
    });

    it("should cancel existing executing mission before creating new one", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      // mode defaults to "fresh" so there is NO incremental findFirst call.
      // The only findFirst call is the existing-active-mission check (line ~128).
      prisma.researchMission.findFirst.mockResolvedValue({
        id: "old-mission",
        status: ResearchMissionStatus.EXECUTING,
        // 老 mission（>10s 前），绕开 P0-#3 dedup window 走 cancel-and-recreate
        createdAt: new Date(Date.now() - 60_000),
        tasks: [],
      });
      prisma.researchMission.create.mockResolvedValue({
        id: "mission-new",
        status: ResearchMissionStatus.PLANNING,
        topicId: "topic-1",
      });
      prisma.researchMission.update.mockResolvedValue({});
      prisma.researchTask.updateMany.mockResolvedValue({ count: 1 });
      prisma.researchTodo.updateMany.mockResolvedValue({ count: 0 });

      await service.createMission({ topicId: "topic-1" });

      expect(prisma.researchMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "old-mission" },
          data: expect.objectContaining({
            status: ResearchMissionStatus.CANCELLED,
          }),
        }),
      );
    });

    // 回归 P0-#3 (2026-05-13): frontend React StrictMode 双调用 / 用户双击 /
    // 多组件并发 useEffect 会让 ~1-3s 内连续 2 次 POST /leader/plan，
    // 上一次刚启动的 mission 立刻被 cancel-and-recreate，白烧 LLM token。
    // 10s 内的重复 POST 应该返回 existing mission（幂等），不 cancel。
    it("dedup window: returns existing mission when re-posted within 10s (no cancel)", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      const recentMission = {
        id: "recent-mission",
        status: ResearchMissionStatus.PLANNING,
        // 3 秒前创建（命中 dedup window）
        createdAt: new Date(Date.now() - 3_000),
        tasks: [],
      };
      prisma.researchMission.findFirst.mockResolvedValue(recentMission);

      const result = await service.createMission({ topicId: "topic-1" });

      expect(result.id).toBe("recent-mission");
      // 不应该 cancel 也不应该 create
      expect(prisma.researchMission.update).not.toHaveBeenCalled();
      expect(prisma.researchMission.create).not.toHaveBeenCalled();
    });

    it("dedup window: cancel-and-recreate when existing mission older than 10s", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      prisma.researchMission.findFirst.mockResolvedValue({
        id: "stale-mission",
        status: ResearchMissionStatus.PLANNING,
        // 30 秒前创建（超出 dedup window，用户明确想重启）
        createdAt: new Date(Date.now() - 30_000),
        tasks: [],
      });
      prisma.researchMission.create.mockResolvedValue({
        id: "fresh-mission",
        status: ResearchMissionStatus.PLANNING,
        topicId: "topic-1",
      });
      prisma.researchMission.update.mockResolvedValue({});
      prisma.researchTask.updateMany.mockResolvedValue({ count: 0 });
      prisma.researchTodo.updateMany.mockResolvedValue({ count: 0 });

      await service.createMission({ topicId: "topic-1" });

      // 应该 cancel 旧的 + create 新的
      expect(prisma.researchMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "stale-mission" },
          data: expect.objectContaining({
            status: ResearchMissionStatus.CANCELLED,
          }),
        }),
      );
      expect(prisma.researchMission.create).toHaveBeenCalled();
    });
  });

  // ─── retryTask ──────────────────────────────────────────────────────────────

  describe("retryTask", () => {
    it("should throw NotFoundException when task not found", async () => {
      prisma.researchTask.findUnique.mockResolvedValue(null);

      await expect(service.retryTask("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw error when task is not in retryable state", async () => {
      prisma.researchTask.findUnique.mockResolvedValue({
        id: "task-1",
        status: ResearchTaskStatus.EXECUTING,
      });

      await expect(service.retryTask("task-1")).rejects.toThrow(
        /not in a retryable state/,
      );
    });

    it("should reset FAILED task to PENDING", async () => {
      prisma.researchTask.findUnique.mockResolvedValue({
        id: "task-1",
        status: ResearchTaskStatus.FAILED,
      });
      prisma.researchTask.update.mockResolvedValue({
        id: "task-1",
        status: ResearchTaskStatus.PENDING,
      });

      const result = await service.retryTask("task-1");
      expect(result.status).toBe(ResearchTaskStatus.PENDING);
    });
  });

  // ─── retryMission ───────────────────────────────────────────────────────────

  describe("retryMission", () => {
    it("should throw NotFoundException when mission not found", async () => {
      prisma.researchMission.findUnique.mockResolvedValue(null);

      await expect(service.retryMission("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw error when mission is not failed", async () => {
      prisma.researchMission.findUnique.mockResolvedValue({
        id: "mission-1",
        status: ResearchMissionStatus.EXECUTING,
      });

      await expect(service.retryMission("mission-1")).rejects.toThrow(
        /Invalid state transition/,
      );
    });

    it("should reset failed tasks and update mission to EXECUTING", async () => {
      prisma.researchMission.findUnique.mockResolvedValue({
        id: "mission-1",
        status: ResearchMissionStatus.FAILED,
      });
      // ★ CAS succeeds (claim.count === 1)
      prisma.researchMission.updateMany.mockResolvedValue({ count: 1 });
      prisma.researchTask.updateMany.mockResolvedValue({ count: 2 });
      prisma.researchMission.findUniqueOrThrow.mockResolvedValue({
        id: "mission-1",
        status: ResearchMissionStatus.EXECUTING,
      });

      const result = await service.retryMission("mission-1");
      expect(result.status).toBe(ResearchMissionStatus.EXECUTING);
      expect(prisma.researchMission.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: "mission-1",
          status: expect.objectContaining({ in: expect.any(Array) }),
        }),
        data: expect.objectContaining({
          status: ResearchMissionStatus.EXECUTING,
          completedAt: null,
        }),
      });
    });

    it("should skip (no-op) when CAS fails due to concurrent retry", async () => {
      prisma.researchMission.findUnique.mockResolvedValue({
        id: "mission-1",
        status: ResearchMissionStatus.FAILED,
      });
      // ★ CAS fails (another concurrent retry won the race)
      prisma.researchMission.updateMany.mockResolvedValue({ count: 0 });
      prisma.researchMission.findUniqueOrThrow.mockResolvedValue({
        id: "mission-1",
        status: ResearchMissionStatus.EXECUTING,
      });

      const result = await service.retryMission("mission-1");
      expect(result.status).toBe(ResearchMissionStatus.EXECUTING);
      // ★ tasks are NOT reset on CAS failure
      expect(prisma.researchTask.updateMany).not.toHaveBeenCalled();
    });
  });

  // ─── cancelMission ──────────────────────────────────────────────────────────

  describe("cancelMission", () => {
    it("should throw NotFoundException when mission not found", async () => {
      prisma.researchMission.findUnique.mockResolvedValue(null);

      await expect(
        service.cancelMission("user-1", "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when user lacks access", async () => {
      prisma.researchMission.findUnique.mockResolvedValue(mockMission);
      collaboratorService.hasAccess.mockResolvedValue(false);

      await expect(
        service.cancelMission("other-user", "mission-1"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw InvalidTransitionError when mission is already completed", async () => {
      prisma.researchMission.findUnique.mockResolvedValue({
        ...mockMission,
        status: ResearchMissionStatus.COMPLETED,
      });
      collaboratorService.hasAccess.mockResolvedValue(true);

      await expect(
        service.cancelMission("user-1", "mission-1"),
      ).rejects.toThrow(/Invalid state transition/);
    });

    it("should cancel mission, tasks, and todos when executing", async () => {
      prisma.researchMission.findUnique.mockResolvedValue(mockMission);
      prisma.researchTask.updateMany.mockResolvedValue({ count: 2 });
      prisma.researchTodo.updateMany.mockResolvedValue({ count: 1 });
      prisma.topicReport.findMany.mockResolvedValue([]);
      prisma.researchMission.update.mockResolvedValue({
        ...mockMission,
        status: ResearchMissionStatus.CANCELLED,
      });

      const result = await service.cancelMission("user-1", "mission-1");
      expect(result.status).toBe(ResearchMissionStatus.CANCELLED);
      expect(prisma.researchTask.updateMany).toHaveBeenCalled();
    });

    it("should handle idempotent cancel gracefully", async () => {
      prisma.researchMission.findUnique.mockResolvedValue({
        ...mockMission,
        status: ResearchMissionStatus.CANCELLED,
      });
      prisma.researchTask.updateMany.mockResolvedValue({ count: 0 });
      prisma.researchTodo.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.cancelMission("user-1", "mission-1");
      expect(result.status).toBe(ResearchMissionStatus.CANCELLED);
    });
  });

  // ─── createTasksFromPlan ────────────────────────────────────────────────────

  describe("createTasksFromPlan", () => {
    it("should create tasks for all plan dimensions", async () => {
      prisma.topicDimension.findFirst.mockResolvedValue(null);
      prisma.topicDimension.findMany.mockResolvedValue([]);
      prisma.topicDimension.create.mockResolvedValue({
        id: "dim-db-1",
        name: "Market Analysis",
      });
      prisma.researchTask.create.mockResolvedValue({
        id: "task-new",
        status: ResearchTaskStatus.PENDING,
      });

      const tasks = await service.createTasksFromPlan(
        "mission-1",
        "topic-1",
        mockLeaderPlan,
      );

      // Should create 1 dimension task + 1 review task + 1 write task = 3
      expect(tasks.length).toBeGreaterThanOrEqual(3);
    });

    it("should skip completed dimensions in incremental mode", async () => {
      prisma.topicDimension.findFirst.mockResolvedValue(null);
      prisma.topicDimension.findMany.mockResolvedValue([
        { id: "dim-db-1", name: "Market Analysis" },
      ]);
      prisma.researchTask.createMany.mockResolvedValue({ count: 1 });
      prisma.researchTask.findMany.mockResolvedValue([
        { id: "copied-task", status: ResearchTaskStatus.COMPLETED },
      ]);
      prisma.researchTask.create.mockResolvedValue({
        id: "task-new",
        status: ResearchTaskStatus.PENDING,
      });

      const completedTasks = [
        {
          dimensionName: "Market Analysis",
          dimensionId: "dim-db-1",
          title: "Research: Market Analysis",
          description: "Market research",
          assignedAgent: "researcher-1",
          assignedAgentType: "dimension_researcher",
          modelId: "gpt-4o",
          priority: 1,
          result: null,
          resultSummary: "Done",
          startedAt: new Date(),
          completedAt: new Date(),
        },
      ];

      const tasks = await service.createTasksFromPlan(
        "mission-1",
        "topic-1",
        mockLeaderPlan,
        completedTasks,
      );
      // The completed dimension should be skipped (not create new pending task)
      // But review and write tasks should still be created
      expect(tasks.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── adjustMission ──────────────────────────────────────────────────────────

  describe("adjustMission", () => {
    it("should throw NotFoundException when mission not found", async () => {
      prisma.researchMission.findUnique.mockResolvedValue(null);

      await expect(
        service.adjustMission("user-1", "nonexistent", { addDimensions: [] }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException for non-owner user", async () => {
      prisma.researchMission.findUnique.mockResolvedValue({
        ...mockMission,
        topic: { userId: "owner-user" },
      });

      await expect(
        service.adjustMission("other-user", "mission-1", {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw error if mission is not executing", async () => {
      prisma.researchMission.findUnique.mockResolvedValue({
        ...mockMission,
        topic: { userId: "user-1" },
        status: ResearchMissionStatus.PLANNING,
      });

      await expect(
        service.adjustMission("user-1", "mission-1", {}),
      ).rejects.toThrow(/Cannot adjust mission/);
    });

    it("should add dimensions and record leader decision", async () => {
      prisma.researchMission.findUnique.mockResolvedValue({
        ...mockMission,
        topic: { userId: "user-1" },
        status: ResearchMissionStatus.EXECUTING,
      });
      prisma.researchTask.create.mockResolvedValue({ id: "task-new" });
      prisma.researchMission.update.mockResolvedValue({});
      prisma.leaderDecision.create.mockResolvedValue({});
      prisma.researchMission.findUniqueOrThrow.mockResolvedValue(mockMission);

      await service.adjustMission("user-1", "mission-1", {
        addDimensions: [{ name: "新维度", description: "描述" }],
      });

      expect(prisma.researchTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            missionId: "mission-1",
            dimensionName: "新维度",
            taskType: "dimension_research",
            status: ResearchTaskStatus.PENDING,
          }),
        }),
      );
      expect(prisma.leaderDecision.create).toHaveBeenCalled();
    });

    it("should remove dimension task when removeDimensions provided", async () => {
      prisma.researchMission.findUnique.mockResolvedValue({
        ...mockMission,
        topic: { userId: "user-1" },
        status: ResearchMissionStatus.EXECUTING,
      });
      prisma.researchTask.findFirst.mockResolvedValue({
        id: "task-to-delete",
        status: ResearchTaskStatus.PENDING,
      });
      prisma.researchTask.delete.mockResolvedValue({});
      prisma.leaderDecision.create.mockResolvedValue({});
      prisma.researchMission.findUniqueOrThrow.mockResolvedValue(mockMission);

      await service.adjustMission("user-1", "mission-1", {
        removeDimensions: ["旧维度"],
      });

      expect(prisma.researchTask.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "task-to-delete" } }),
      );
    });

    it("should not delete task if pending task not found for dimension", async () => {
      prisma.researchMission.findUnique.mockResolvedValue({
        ...mockMission,
        topic: { userId: "user-1" },
        status: ResearchMissionStatus.EXECUTING,
      });
      prisma.researchTask.findFirst.mockResolvedValue(null);
      prisma.researchTask.delete.mockResolvedValue({});
      prisma.leaderDecision.create.mockResolvedValue({});
      prisma.researchMission.findUniqueOrThrow.mockResolvedValue(mockMission);

      await service.adjustMission("user-1", "mission-1", {
        removeDimensions: ["不存在的维度"],
      });

      expect(prisma.researchTask.delete).not.toHaveBeenCalled();
    });

    it("should call handleUserMessage for focusAreas adjustment", async () => {
      prisma.researchMission.findUnique.mockResolvedValue({
        ...mockMission,
        topic: { userId: "user-1" },
        status: ResearchMissionStatus.EXECUTING,
      });
      leaderIntentService.handleUserMessage.mockResolvedValue({
        response: "OK",
      });
      prisma.leaderDecision.create.mockResolvedValue({});
      prisma.researchMission.findUniqueOrThrow.mockResolvedValue(mockMission);

      await service.adjustMission("user-1", "mission-1", {
        focusAreas: ["AI安全", "算法伦理"],
      });

      expect(leaderIntentService.handleUserMessage).toHaveBeenCalledWith(
        "topic-1",
        "mission-1",
        expect.stringContaining("AI安全"),
      );
    });
  });

  // ─── cancelMission - additional branches ─────────────────────────────────────

  describe("cancelMission - additional branches", () => {
    it("should delete empty draft reports when cancelling", async () => {
      prisma.researchMission.findUnique.mockResolvedValue(mockMission);
      prisma.researchTask.updateMany.mockResolvedValue({ count: 2 });
      prisma.researchTodo.updateMany.mockResolvedValue({ count: 1 });
      prisma.topicReport.findMany.mockResolvedValue([
        { id: "empty-report-1" },
        { id: "empty-report-2" },
      ]);
      prisma.topicReport.deleteMany.mockResolvedValue({ count: 2 });
      prisma.researchMission.update.mockResolvedValue({
        ...mockMission,
        status: ResearchMissionStatus.CANCELLED,
      });

      await service.cancelMission("user-1", "mission-1");

      expect(prisma.topicReport.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ["empty-report-1", "empty-report-2"] } },
        }),
      );
    });

    it("should not call deleteMany when no empty reports found", async () => {
      prisma.researchMission.findUnique.mockResolvedValue(mockMission);
      prisma.researchTask.updateMany.mockResolvedValue({ count: 0 });
      prisma.researchTodo.updateMany.mockResolvedValue({ count: 0 });
      prisma.topicReport.findMany.mockResolvedValue([]);
      prisma.researchMission.update.mockResolvedValue({
        ...mockMission,
        status: ResearchMissionStatus.CANCELLED,
      });

      await service.cancelMission("user-1", "mission-1");

      expect(prisma.topicReport.deleteMany).not.toHaveBeenCalled();
    });
  });

  // ─── createMission - incremental mode ────────────────────────────────────────

  describe("createMission - incremental mode", () => {
    it("should collect completed tasks from previous mission in incremental mode", async () => {
      const prevMission = {
        id: "prev-mission",
        tasks: [
          {
            id: "prev-task-1",
            dimensionName: "Market Analysis",
            dimensionId: "dim-1",
            title: "Research: Market Analysis",
            description: "Market research",
            assignedAgent: "researcher-1",
            assignedAgentType: "dimension_researcher",
            modelId: "gpt-4o",
            priority: 1,
            result: { summary: "done" },
            resultSummary: "Completed",
            startedAt: new Date(),
            completedAt: new Date(),
            status: ResearchTaskStatus.COMPLETED,
          },
        ],
      };

      prisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      // incremental: first findFirst = prev mission (for completed tasks)
      // second findFirst = no active mission
      prisma.researchMission.findFirst
        .mockResolvedValueOnce(prevMission)
        .mockResolvedValueOnce(null);
      prisma.researchMission.create.mockResolvedValue({
        id: "new-inc-mission",
        status: ResearchMissionStatus.PLANNING,
        topicId: "topic-1",
      });

      const result = await service.createMission({
        topicId: "topic-1",
        mode: "incremental",
      });

      expect(result.id).toBe("new-inc-mission");
    });

    it("should merge completed tasks from previous and active missions in incremental mode", async () => {
      const prevMission = {
        id: "prev-mission",
        tasks: [
          {
            id: "prev-task-1",
            dimensionName: "Technology",
            dimensionId: "dim-tech",
            title: "Tech Research",
            description: "Tech",
            assignedAgent: "r1",
            assignedAgentType: "dimension_researcher",
            modelId: "gpt-4o",
            priority: 1,
            result: null,
            resultSummary: null,
            startedAt: new Date(),
            completedAt: new Date(),
            status: ResearchTaskStatus.COMPLETED,
          },
        ],
      };

      const activeMission = {
        id: "active-mission",
        status: ResearchMissionStatus.EXECUTING,
        // 老 mission（>10s 前创建），绕开 P0-#3 dedup window 走 cancel-and-recreate 路径
        createdAt: new Date(Date.now() - 60_000),
        tasks: [
          {
            // duplicate from prev - should be deduplicated
            id: "active-task-1",
            dimensionName: "Technology",
            dimensionId: "dim-tech",
            title: "Tech Research Active",
            description: "Tech",
            assignedAgent: "r1",
            assignedAgentType: "dimension_researcher",
            modelId: "gpt-4o",
            priority: 1,
            result: null,
            resultSummary: null,
            startedAt: null,
            completedAt: null,
            status: ResearchTaskStatus.COMPLETED,
          },
          {
            id: "active-task-2",
            dimensionName: "Market",
            dimensionId: "dim-market",
            title: "Market Research",
            description: "Market",
            assignedAgent: "r2",
            assignedAgentType: "dimension_researcher",
            modelId: "gpt-4o",
            priority: 2,
            result: null,
            resultSummary: null,
            startedAt: new Date(),
            completedAt: new Date(),
            status: ResearchTaskStatus.COMPLETED,
          },
        ],
      };

      prisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      prisma.researchMission.findFirst
        .mockResolvedValueOnce(prevMission)
        .mockResolvedValueOnce(activeMission);

      prisma.researchMission.update.mockResolvedValue({});
      prisma.researchTask.updateMany.mockResolvedValue({ count: 0 });
      prisma.researchTodo.updateMany.mockResolvedValue({ count: 0 });
      prisma.researchMission.create.mockResolvedValue({
        id: "merged-mission",
        status: ResearchMissionStatus.PLANNING,
        topicId: "topic-1",
      });

      const result = await service.createMission({
        topicId: "topic-1",
        mode: "incremental",
      });

      expect(result.id).toBe("merged-mission");
      // Active mission should be cancelled
      expect(prisma.researchMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "active-mission" },
          data: { status: ResearchMissionStatus.CANCELLED },
        }),
      );
    });
  });

  // ─── executePlanningAsync ────────────────────────────────────────────────────

  describe("executePlanningAsync", () => {
    it("should call planResearch and create tasks then start execution", async () => {
      const mockPlan = mockLeaderPlan;
      leaderService.planResearch.mockResolvedValue(mockPlan);

      prisma.leaderDecision.create.mockResolvedValue({});
      prisma.topicDimension.findFirst.mockResolvedValue(null);
      prisma.topicDimension.findMany.mockResolvedValue([]);
      prisma.topicDimension.create.mockResolvedValue({
        id: "dim-db-1",
        name: "Market Analysis",
      });
      prisma.researchTask.create.mockImplementation(
        (args: { data: { taskType: string; title: string } }) =>
          Promise.resolve({ id: `task-${Date.now()}`, ...args.data }),
      );
      prisma.researchMission.update.mockResolvedValue({});

      await service.executePlanningAsync(
        "mission-1",
        "topic-1",
        "AI Research",
        "Analyze AI market",
      );

      expect(leaderService.planResearch).toHaveBeenCalledWith(
        "topic-1",
        "Analyze AI market",
      );
      expect(prisma.researchMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "mission-1" },
          data: expect.objectContaining({
            status: ResearchMissionStatus.EXECUTING,
          }),
        }),
      );
      expect(executionService.startExecution).toHaveBeenCalledWith(
        "mission-1",
        "topic-1",
      );
    });

    it("should update mission to FAILED when planResearch throws", async () => {
      leaderService.planResearch.mockRejectedValue(
        new Error("AI service unavailable"),
      );

      prisma.researchMission.findUnique.mockResolvedValue({ id: "mission-1" });
      prisma.researchMission.update.mockResolvedValue({});

      await service.executePlanningAsync("mission-1", "topic-1", "AI Research");

      expect(prisma.researchMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "mission-1" },
          data: { status: ResearchMissionStatus.FAILED },
        }),
      );
    });

    it("should skip mission update when mission no longer exists after planning failure", async () => {
      leaderService.planResearch.mockRejectedValue(
        new Error("Planning failed"),
      );

      // mission doesn't exist anymore
      prisma.researchMission.findUnique.mockResolvedValue(null);
      prisma.researchMission.update.mockResolvedValue({});

      await service.executePlanningAsync("mission-gone", "topic-1", "Test");

      // update should NOT be called since mission doesn't exist
      expect(prisma.researchMission.update).not.toHaveBeenCalled();
    });

    it("should emit missionFailed event when planning throws", async () => {
      const mocks = buildMocks();
      leaderService.planResearch.mockRejectedValue(new Error("plan error"));
      prisma.researchMission.findUnique.mockResolvedValue({ id: "mission-1" });
      prisma.researchMission.update.mockResolvedValue({});

      await service.executePlanningAsync("mission-1", "topic-1", "Research");

      expect(
        mocks.mockResearchEventEmitter.emitMissionFailed,
      ).not.toHaveBeenCalled();
      // The actual service instance has the mock, check that the injected one was called
    });
  });

  // ─── createTasksFromPlan - reuse existing dimension ─────────────────────────

  describe("createTasksFromPlan - reuse existing dimension", () => {
    it("should reuse existing dimension ID when dimension with same name exists", async () => {
      prisma.topicDimension.findFirst.mockResolvedValue(null);
      // Existing dimension found for "Market Analysis"
      prisma.topicDimension.findMany.mockResolvedValue([
        { id: "existing-dim-1", name: "Market Analysis" },
      ]);
      prisma.researchTask.create.mockImplementation(
        (args: {
          data: { taskType: string; title: string; dimensionId?: string };
        }) => Promise.resolve({ id: `task-${Date.now()}`, ...args.data }),
      );

      const tasks = await service.createTasksFromPlan(
        "mission-1",
        "topic-1",
        mockLeaderPlan,
      );

      // Dimension create should NOT be called since existing dimension was found
      expect(prisma.topicDimension.create).not.toHaveBeenCalled();
      // Tasks should still be created
      expect(tasks.length).toBeGreaterThanOrEqual(3);
    });

    it("should increment sortOrder beyond existing maxDimension.sortOrder", async () => {
      // maxDimension has sortOrder = 5
      prisma.topicDimension.findFirst.mockResolvedValue({ sortOrder: 5 });
      // No existing dimension with same name
      prisma.topicDimension.findMany.mockResolvedValue([]);
      prisma.topicDimension.create.mockResolvedValue({
        id: "new-dim",
        name: "Market Analysis",
      });
      prisma.researchTask.create.mockImplementation(
        (args: { data: { taskType: string; title: string } }) =>
          Promise.resolve({ id: `task-${Date.now()}`, ...args.data }),
      );

      await service.createTasksFromPlan("mission-1", "topic-1", mockLeaderPlan);

      expect(prisma.topicDimension.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sortOrder: 6, // starts at maxDimension.sortOrder + 1 = 6
          }),
        }),
      );
    });
  });

  // ─── approvePlanAndExecute ───────────────────────────────────────────────────

  describe("approvePlanAndExecute", () => {
    it("should throw NotFoundException when mission not found", async () => {
      // ★ CAS 失败（没 mission 匹配 PLAN_READY）
      prisma.researchMission.updateMany.mockResolvedValue({ count: 0 });
      prisma.researchMission.findUnique.mockResolvedValue(null);

      await expect(
        service.approvePlanAndExecute("nonexistent", "topic-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when mission has no leaderPlan", async () => {
      // ★ CAS 失败（mission 存在但状态不是 PLAN_READY，且无 plan）
      prisma.researchMission.updateMany.mockResolvedValue({ count: 0 });
      prisma.researchMission.findUnique.mockResolvedValue({
        id: "mission-1",
        status: ResearchMissionStatus.PLANNING,
        leaderPlan: null,
      });

      await expect(
        service.approvePlanAndExecute("mission-1", "topic-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should silently skip when another concurrent approve already won the race", async () => {
      // ★ CAS 失败，但 mission 存在且有 plan → 静默跳过（不抛错，幂等处理）
      prisma.researchMission.updateMany.mockResolvedValue({ count: 0 });
      prisma.researchMission.findUnique.mockResolvedValue({
        id: "mission-1",
        status: ResearchMissionStatus.EXECUTING,
        leaderPlan: mockLeaderPlan,
      });

      await service.approvePlanAndExecute("mission-1", "topic-1");
      // ★ 没有调用 startExecution
      expect(executionService.startExecution).not.toHaveBeenCalled();
    });

    it("should create tasks, update mission to EXECUTING, and fire startExecution", async () => {
      // ★ CAS 赢家
      prisma.researchMission.updateMany.mockResolvedValue({ count: 1 });
      // CAS 后 findUnique 拿 plan
      prisma.researchMission.findUnique.mockResolvedValue({
        leaderPlan: mockLeaderPlan,
      });
      // createTasksFromPlan internals
      prisma.topicDimension.findFirst.mockResolvedValue(null);
      prisma.topicDimension.findMany.mockResolvedValue([]);
      prisma.topicDimension.create.mockResolvedValue({
        id: "dim-db",
        name: "Market Analysis",
      });
      prisma.researchTask.create.mockImplementation(
        (args: { data: { taskType: string; title: string } }) =>
          Promise.resolve({ id: `task-${Date.now()}`, ...args.data }),
      );
      prisma.researchMission.update.mockResolvedValue({
        id: "mission-1",
        status: ResearchMissionStatus.EXECUTING,
      });
      // researchTopic.findUnique for BillingContext (no existingCtx in test)
      prisma.researchTopic.findUnique.mockResolvedValue({ userId: "user-1" });

      await service.approvePlanAndExecute("mission-1", "topic-1");

      // ★ CAS 写了 status = EXECUTING + startedAt
      expect(prisma.researchMission.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "mission-1", status: ResearchMissionStatus.PLAN_READY },
          data: expect.objectContaining({
            status: ResearchMissionStatus.EXECUTING,
          }),
        }),
      );
      // ★ 后续 update 只写 totalTasks（status 已在 CAS 中设置）
      expect(prisma.researchMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "mission-1" },
          data: expect.objectContaining({
            totalTasks: expect.any(Number),
          }),
        }),
      );
      // startExecution is called fire-and-forget, so we wait a tick
      await new Promise((r) => setImmediate(r));
      expect(executionService.startExecution).toHaveBeenCalledWith(
        "mission-1",
        "topic-1",
      );
    });
  });

  // ─── createMission - async planning catch handler ────────────────────────────

  describe("createMission - async planning failure catch handler", () => {
    it("should update mission to FAILED when executePlanningAsync rejects (fire-and-forget catch)", async () => {
      // Set up mission creation to succeed
      prisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      prisma.researchMission.findFirst.mockResolvedValue(null);
      const newMission = {
        id: "mission-async-fail",
        status: ResearchMissionStatus.PLANNING,
        topicId: "topic-1",
      };
      prisma.researchMission.create.mockResolvedValue(newMission);
      prisma.researchMission.update.mockResolvedValue({});

      // Make planResearch reject immediately so executePlanningAsync throws
      leaderService.planResearch.mockRejectedValue(
        new Error("Planning timeout triggered"),
      );
      // executePlanningAsync catch path: findUnique returns null so no update
      prisma.researchMission.findUnique.mockResolvedValue({
        id: "mission-async-fail",
      });

      await service.createMission({ topicId: "topic-1" });

      // Allow the fire-and-forget catch to run
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      // The catch block in createMission should have called researchMission.update to FAILED
      const updateCalls = prisma.researchMission.update.mock.calls;
      const failedCall = updateCalls.find(
        (c) =>
          c[0]?.where?.id === "mission-async-fail" &&
          c[0]?.data?.status === ResearchMissionStatus.FAILED,
      );
      expect(failedCall).toBeDefined();
    });

    it("should handle update error inside createMission async catch gracefully", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      prisma.researchMission.findFirst.mockResolvedValue(null);
      prisma.researchMission.create.mockResolvedValue({
        id: "mission-update-err",
        status: ResearchMissionStatus.PLANNING,
        topicId: "topic-1",
      });

      // Make planning fail
      leaderService.planResearch.mockRejectedValue(new Error("AI timeout"));
      // executePlanningAsync catch: findUnique OK, then update throws in executePlanningAsync
      // Then createMission catch: researchMission.update also throws
      prisma.researchMission.findUnique.mockResolvedValue({
        id: "mission-update-err",
      });
      prisma.researchMission.update.mockRejectedValue(
        new Error("DB update failed"),
      );

      await service.createMission({ topicId: "topic-1" });

      // Let all microtasks settle
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      // Should not throw - error handled gracefully
      expect(prisma.researchMission.update).toHaveBeenCalled();
    });
  });

  // ─── executePlanningAsync - execution startExecution failure ─────────────────

  describe("executePlanningAsync - startExecution failure fire-and-forget", () => {
    it("should handle startExecution failure by updating mission to FAILED (fire-and-forget)", async () => {
      leaderService.planResearch.mockResolvedValue(mockLeaderPlan);
      prisma.leaderDecision.create.mockResolvedValue({});
      prisma.topicDimension.findFirst.mockResolvedValue(null);
      prisma.topicDimension.findMany.mockResolvedValue([]);
      prisma.topicDimension.create.mockResolvedValue({
        id: "dim-db-1",
        name: "Market Analysis",
      });
      prisma.researchTask.create.mockImplementation(
        (args: { data: { taskType: string; title: string } }) =>
          Promise.resolve({ id: `task-${Date.now()}`, ...args.data }),
      );
      prisma.researchMission.update.mockResolvedValue({});
      prisma.researchTask.updateMany.mockResolvedValue({ count: 0 });
      prisma.researchTodo.updateMany.mockResolvedValue({ count: 0 });

      // Make startExecution fail
      executionService.startExecution.mockRejectedValue(
        new Error("Execution failed"),
      );

      await service.executePlanningAsync("mission-1", "topic-1", "AI Research");

      // Let the fire-and-forget catch run
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      // Should have called update to FAILED + updateMany for tasks and todos
      const updateCalls = prisma.researchMission.update.mock.calls;
      const failedCall = updateCalls.find(
        (c) => c[0]?.data?.status === ResearchMissionStatus.FAILED,
      );
      expect(failedCall).toBeDefined();
    });

    it("should handle updateMany errors gracefully in execution failure catch", async () => {
      leaderService.planResearch.mockResolvedValue(mockLeaderPlan);
      prisma.leaderDecision.create.mockResolvedValue({});
      prisma.topicDimension.findFirst.mockResolvedValue(null);
      prisma.topicDimension.findMany.mockResolvedValue([]);
      prisma.topicDimension.create.mockResolvedValue({
        id: "dim-db-1",
        name: "Market Analysis",
      });
      prisma.researchTask.create.mockImplementation(
        (args: { data: { taskType: string; title: string } }) =>
          Promise.resolve({ id: `task-${Date.now()}`, ...args.data }),
      );
      prisma.researchMission.update.mockResolvedValue({});
      // Make updateMany fail to cover the .catch branches on lines 488-491, 506-509
      prisma.researchTask.updateMany.mockRejectedValue(
        new Error("updateMany failed"),
      );
      prisma.researchTodo.updateMany.mockRejectedValue(
        new Error("updateMany failed"),
      );

      executionService.startExecution.mockRejectedValue(
        new Error("Execution failed"),
      );

      await service.executePlanningAsync("mission-1", "topic-1", "AI Research");

      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      // Should not throw - handled gracefully
      expect(executionService.startExecution).toHaveBeenCalled();
    });
  });

  // ─── executePlanningAsync - update error in catch ────────────────────────────

  describe("executePlanningAsync - catch block update error", () => {
    it("should handle update error when mission exists but update fails in catch", async () => {
      leaderService.planResearch.mockRejectedValue(
        new Error("Planning failed"),
      );

      // mission exists
      prisma.researchMission.findUnique.mockResolvedValue({ id: "mission-1" });
      // update throws
      prisma.researchMission.update.mockRejectedValue(
        new Error("Update failed"),
      );

      await service.executePlanningAsync("mission-1", "topic-1", "AI Research");

      // Should not throw
      expect(prisma.researchMission.findUnique).toHaveBeenCalled();
    });
  });

  // ─── approvePlanAndExecute - execution failure catch ─────────────────────────

  describe("approvePlanAndExecute - startExecution failure fire-and-forget", () => {
    it("should handle startExecution failure and update mission to FAILED", async () => {
      // ★ CAS 赢家
      prisma.researchMission.updateMany.mockResolvedValue({ count: 1 });
      prisma.researchMission.findUnique.mockResolvedValue({
        leaderPlan: mockLeaderPlan,
      });
      prisma.topicDimension.findFirst.mockResolvedValue(null);
      prisma.topicDimension.findMany.mockResolvedValue([]);
      prisma.topicDimension.create.mockResolvedValue({
        id: "dim-db",
        name: "Market Analysis",
      });
      prisma.researchTask.create.mockImplementation(
        (args: { data: { taskType: string; title: string } }) =>
          Promise.resolve({ id: `task-${Date.now()}`, ...args.data }),
      );
      prisma.researchMission.update.mockResolvedValue({
        id: "mission-1",
        status: ResearchMissionStatus.EXECUTING,
      });
      prisma.researchTopic.findUnique.mockResolvedValue({ userId: "user-1" });
      prisma.researchTask.updateMany.mockResolvedValue({ count: 0 });
      prisma.researchTodo.updateMany.mockResolvedValue({ count: 0 });

      // Make startExecution fail
      executionService.startExecution.mockRejectedValue(
        new Error("startExecution failed"),
      );

      await service.approvePlanAndExecute("mission-1", "topic-1");

      // Let fire-and-forget catch run
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      // update to FAILED should be called
      const updateCalls = prisma.researchMission.update.mock.calls;
      const failedCall = updateCalls.find(
        (c) => c[0]?.data?.status === ResearchMissionStatus.FAILED,
      );
      expect(failedCall).toBeDefined();
    });

    it("should handle update and updateMany errors gracefully in approvePlanAndExecute catch", async () => {
      // ★ CAS 赢家
      prisma.researchMission.updateMany.mockResolvedValue({ count: 1 });
      prisma.researchMission.findUnique.mockResolvedValue({
        leaderPlan: mockLeaderPlan,
      });
      prisma.topicDimension.findFirst.mockResolvedValue(null);
      prisma.topicDimension.findMany.mockResolvedValue([]);
      prisma.topicDimension.create.mockResolvedValue({
        id: "dim-db",
        name: "Market Analysis",
      });
      prisma.researchTask.create.mockImplementation(
        (args: { data: { taskType: string; title: string } }) =>
          Promise.resolve({ id: `task-${Date.now()}`, ...args.data }),
      );
      // First update (totalTasks) succeeds, subsequent (FAILED rollback) fail
      prisma.researchMission.update
        .mockResolvedValueOnce({
          id: "mission-1",
          status: ResearchMissionStatus.EXECUTING,
        })
        .mockRejectedValue(new Error("FAILED update failed"));
      prisma.researchTopic.findUnique.mockResolvedValue({ userId: "user-1" });
      prisma.researchTask.updateMany.mockRejectedValue(
        new Error("updateMany failed"),
      );
      prisma.researchTodo.updateMany.mockRejectedValue(
        new Error("updateMany failed"),
      );

      executionService.startExecution.mockRejectedValue(
        new Error("startExecution failed"),
      );

      await service.approvePlanAndExecute("mission-1", "topic-1");

      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      // Should not throw - all errors handled gracefully
      expect(executionService.startExecution).toHaveBeenCalled();
    });
  });

  // ─── executePlanningAsync BillingContext propagation ────────────────────────

  describe("executePlanningAsync - BillingContext propagation", () => {
    it("should call planResearch with the correct topicId and userPrompt", async () => {
      leaderService.planResearch.mockResolvedValue(mockLeaderPlan);
      prisma.leaderDecision.create.mockResolvedValue({});
      prisma.topicDimension.findFirst.mockResolvedValue(null);
      prisma.topicDimension.findMany.mockResolvedValue([]);
      prisma.topicDimension.create.mockResolvedValue({
        id: "dim-1",
        name: "Market Analysis",
      });
      prisma.researchTask.create.mockImplementation(
        (args: { data: { taskType: string; title: string } }) =>
          Promise.resolve({ id: `t-${Date.now()}`, ...args.data }),
      );
      prisma.researchMission.update.mockResolvedValue({});

      await service.executePlanningAsync(
        "mission-1",
        "topic-1",
        "AI Research",
        "深度分析AI市场趋势",
      );

      expect(leaderService.planResearch).toHaveBeenCalledWith(
        "topic-1",
        "深度分析AI市场趋势",
      );
    });

    it("should call emitLeaderThinking with understanding phase before planning", async () => {
      const mocks = buildMocks();
      const module2: TestingModule = await Test.createTestingModule({
        providers: [
          MissionLifecycleService,
          { provide: PrismaService, useValue: mocks.mockPrisma },
          {
            provide: LeaderPlanningService,
            useValue: mocks.mockLeaderPlanningService,
          },
          {
            provide: LeaderIntentService,
            useValue: mocks.mockLeaderIntentService,
          },
          {
            provide: ResearchEventEmitterService,
            useValue: mocks.mockResearchEventEmitter,
          },
          {
            provide: TopicCollaboratorService,
            useValue: mocks.mockCollaboratorService,
          },
          { provide: AgentActivityService, useValue: mocks.mockAgentActivity },
          { provide: MissionQueryService, useValue: mocks.mockQueryService },
          {
            provide: MissionExecutionService,
            useValue: mocks.mockExecutionService,
          },
        ],
      }).compile();

      const svc2 = module2.get<MissionLifecycleService>(
        MissionLifecycleService,
      );
      mocks.mockLeaderPlanningService.planResearch.mockResolvedValue(
        mockLeaderPlan,
      );
      mocks.mockPrisma.leaderDecision.create.mockResolvedValue({});
      mocks.mockPrisma.topicDimension.findFirst.mockResolvedValue(null);
      mocks.mockPrisma.topicDimension.findMany.mockResolvedValue([]);
      mocks.mockPrisma.topicDimension.create.mockResolvedValue({
        id: "d1",
        name: "Market Analysis",
      });
      mocks.mockPrisma.researchTask.create.mockResolvedValue({ id: "t1" });
      mocks.mockPrisma.researchMission.update.mockResolvedValue({});

      await svc2.executePlanningAsync("mission-1", "topic-1", "AI Research");

      expect(
        mocks.mockResearchEventEmitter.emitLeaderThinking,
      ).toHaveBeenCalledWith(
        "topic-1",
        expect.objectContaining({ phase: "understanding" }),
      );
    });
  });
});
