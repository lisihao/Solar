/**
 * MissionQueryService Unit Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { MissionQueryService } from "../mission-query.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { ResearchEventEmitterService } from "../../research/research-event-emitter.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { ResearchLeaderService } from "../../research/research-leader.service";
import { NotFoundException } from "@nestjs/common";
import { ResearchMissionStatus, ResearchTaskStatus } from "@prisma/client";

// ─── Mocks ───────────────────────────────────────────────────────────────────

function buildMocks() {
  const mockPrisma = {
    researchMission: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    researchTask: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    researchAgentActivity: {
      findMany: jest.fn(),
    },
    aIModel: {
      findFirst: jest.fn(),
      findMany: jest
        .fn()
        .mockResolvedValue([{ modelId: "gpt-4o", displayName: "GPT-4o" }]),
    },
  };

  const mockEventEmitter = { emit: jest.fn(), on: jest.fn() };

  const mockResearchEventEmitter = {
    emitMissionProgress: jest.fn(),
  };

  const mockAiFacade = {
    getDefaultModelByType: jest
      .fn()
      .mockResolvedValue({ displayName: "GPT-4o", modelId: "gpt-4o" }),
    getReasoningModel: jest.fn().mockResolvedValue({
      id: "gpt-4o",
      name: "GPT-4o",
      provider: "openai",
      isReasoning: false,
    }),
  };

  const mockLeaderService = {
    getReasoningModel: jest.fn().mockResolvedValue(null),
  };

  return {
    mockPrisma,
    mockEventEmitter,
    mockResearchEventEmitter,
    mockAiFacade,
    mockLeaderService,
  };
}

const mockTask = {
  id: "task-1",
  title: "Research Task",
  description: "Test task",
  taskType: "dimension_research",
  dimensionName: "Market Analysis",
  assignedAgent: "researcher-1",
  modelId: "gpt-4o",
  status: ResearchTaskStatus.PENDING,
  progress: 0,
  reviewStatus: null,
  result: null,
  resultSummary: null,
  startedAt: null,
  completedAt: null,
  dependencies: [],
  priority: 1,
  assignedAgentType: "dimension_researcher",
  missionId: "mission-1",
  mission: { topicId: "topic-1" },
  dimensionId: "dim-1",
};

const mockMission = {
  id: "mission-1",
  status: ResearchMissionStatus.EXECUTING,
  progressPercent: 50,
  totalTasks: 4,
  completedTasks: 2,
  leaderPlan: null,
  researchDepth: "standard",
  leaderModelId: "gpt-4o",
  leaderModelName: "GPT-4o",
  topicId: "topic-1",
  tasks: [mockTask],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MissionQueryService", () => {
  let service: MissionQueryService;
  let prisma: ReturnType<typeof buildMocks>["mockPrisma"];
  let eventEmitter: ReturnType<typeof buildMocks>["mockEventEmitter"];
  let researchEventEmitter: ReturnType<
    typeof buildMocks
  >["mockResearchEventEmitter"];

  beforeEach(async () => {
    const {
      mockPrisma,
      mockEventEmitter,
      mockResearchEventEmitter,
      mockAiFacade,
      mockLeaderService,
    } = buildMocks();
    prisma = mockPrisma;
    eventEmitter = mockEventEmitter;
    researchEventEmitter = mockResearchEventEmitter;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MissionQueryService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        {
          provide: ResearchEventEmitterService,
          useValue: mockResearchEventEmitter,
        },
        { provide: ChatFacade, useValue: mockAiFacade },
        { provide: ResearchLeaderService, useValue: mockLeaderService },
      ],
    }).compile();

    service = module.get<MissionQueryService>(MissionQueryService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── getMissionStatus ───────────────────────────────────────────────────────

  describe("getMissionStatus", () => {
    it("should return mission status with tasks", async () => {
      prisma.researchMission.findUnique.mockResolvedValue(mockMission);

      const result = await service.getMissionStatus("mission-1");

      expect(result.id).toBe("mission-1");
      expect(result.status).toBe(ResearchMissionStatus.EXECUTING);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].id).toBe("task-1");
    });

    it("should throw NotFoundException when mission not found", async () => {
      prisma.researchMission.findUnique.mockResolvedValue(null);

      await expect(service.getMissionStatus("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should return correct phase from status", async () => {
      prisma.researchMission.findUnique.mockResolvedValue({
        ...mockMission,
        status: ResearchMissionStatus.PLANNING,
      });

      const result = await service.getMissionStatus("mission-1");
      expect(result.currentPhase).toBe("planning");
    });
  });

  // ─── getMissionByTopicId ────────────────────────────────────────────────────

  describe("getMissionByTopicId", () => {
    it("should return null when no mission found", async () => {
      prisma.researchMission.findFirst.mockResolvedValue(null);

      const result = await service.getMissionByTopicId("topic-1");
      expect(result).toBeNull();
    });

    it("should return mission status when found", async () => {
      prisma.researchMission.findFirst.mockResolvedValue(mockMission);

      const result = await service.getMissionByTopicId("topic-1");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("mission-1");
    });
  });

  // ─── getTaskActivities ──────────────────────────────────────────────────────

  describe("getTaskActivities", () => {
    it("should throw NotFoundException when task not found", async () => {
      prisma.researchTask.findUnique.mockResolvedValue(null);

      await expect(service.getTaskActivities("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should return task and activities for dimension task", async () => {
      prisma.researchTask.findUnique.mockResolvedValue(mockTask);
      prisma.researchAgentActivity.findMany.mockResolvedValue([]);

      const result = await service.getTaskActivities("task-1");

      expect(result.task.id).toBe("task-1");
      expect(result.activities).toEqual([]);
    });

    it("should use leader role filter for leader_planning tasks", async () => {
      const leaderTask = {
        ...mockTask,
        taskType: "leader_planning",
        dimensionId: null,
      };
      prisma.researchTask.findUnique.mockResolvedValue(leaderTask);
      prisma.researchAgentActivity.findMany.mockResolvedValue([]);

      await service.getTaskActivities("task-1");

      expect(prisma.researchAgentActivity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ agentRole: "leader" }),
        }),
      );
    });
  });

  // ─── updateTaskStatus ───────────────────────────────────────────────────────

  describe("updateTaskStatus", () => {
    it("should use conditional update for terminal COMPLETED status", async () => {
      prisma.researchTask.updateMany.mockResolvedValue({ count: 1 });
      prisma.researchTask.findUnique.mockResolvedValue({
        ...mockTask,
        status: ResearchTaskStatus.COMPLETED,
        missionId: "mission-1",
      });
      prisma.researchTask.findMany.mockResolvedValue([
        { ...mockTask, status: ResearchTaskStatus.COMPLETED },
      ]);
      prisma.researchMission.update.mockResolvedValue({});

      const result = await service.updateTaskStatus(
        "task-1",
        ResearchTaskStatus.COMPLETED,
      );
      expect(result.status).toBe(ResearchTaskStatus.COMPLETED);
      expect(prisma.researchTask.updateMany).toHaveBeenCalled();
    });

    it("should use regular update for non-terminal status", async () => {
      prisma.researchTask.update.mockResolvedValue({
        ...mockTask,
        status: ResearchTaskStatus.EXECUTING,
        missionId: "mission-1",
      });
      prisma.researchTask.findMany.mockResolvedValue([]);
      prisma.researchMission.update.mockResolvedValue({});

      await service.updateTaskStatus("task-1", ResearchTaskStatus.EXECUTING);
      expect(prisma.researchTask.update).toHaveBeenCalled();
    });

    it("should throw NotFoundException if task not found after terminal update", async () => {
      prisma.researchTask.updateMany.mockResolvedValue({ count: 0 });
      prisma.researchTask.findUnique.mockResolvedValue(null);

      await expect(
        service.updateTaskStatus("task-1", ResearchTaskStatus.COMPLETED),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getExecutableTasks ─────────────────────────────────────────────────────

  describe("getExecutableTasks", () => {
    it("should return pending tasks with no dependencies", async () => {
      const pendingTask = {
        ...mockTask,
        status: ResearchTaskStatus.PENDING,
        dependencies: [],
      };
      prisma.researchTask.findMany.mockResolvedValue([pendingTask]);

      const result = await service.getExecutableTasks("mission-1");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("task-1");
    });

    it("should exclude tasks with incomplete dependencies", async () => {
      const completedTask = {
        ...mockTask,
        id: "task-0",
        status: ResearchTaskStatus.COMPLETED,
      };
      const pendingTaskWithDep = {
        ...mockTask,
        id: "task-dep",
        status: ResearchTaskStatus.PENDING,
        dependencies: ["task-missing"],
      };
      prisma.researchTask.findMany.mockResolvedValue([
        completedTask,
        pendingTaskWithDep,
      ]);

      const result = await service.getExecutableTasks("mission-1");
      expect(result).toHaveLength(0);
    });

    it("should sort tasks by priority", async () => {
      const highPriority = {
        ...mockTask,
        id: "task-high",
        priority: 1,
        status: ResearchTaskStatus.PENDING,
        dependencies: [],
      };
      const lowPriority = {
        ...mockTask,
        id: "task-low",
        priority: 10,
        status: ResearchTaskStatus.PENDING,
        dependencies: [],
      };
      prisma.researchTask.findMany.mockResolvedValue([
        lowPriority,
        highPriority,
      ]);

      const result = await service.getExecutableTasks("mission-1");
      expect(result[0].id).toBe("task-high");
    });
  });

  // ─── emitProgress ──────────────────────────────────────────────────────────

  describe("emitProgress", () => {
    it("should emit both internal and websocket events", () => {
      service.emitProgress({
        missionId: "mission-1",
        topicId: "topic-1",
        status: ResearchMissionStatus.EXECUTING,
        progress: 50,
        phase: "executing",
        message: "Running",
        completedTasks: 2,
        totalTasks: 4,
      });

      expect(eventEmitter.emit).toHaveBeenCalled();
      expect(researchEventEmitter.emitMissionProgress).toHaveBeenCalledWith(
        "topic-1",
        expect.objectContaining({ missionId: "mission-1", progress: 50 }),
      );
    });
  });

  // ─── Helper methods ─────────────────────────────────────────────────────────

  describe("getAgentRole", () => {
    it("should return correct role for dimension_researcher", () => {
      expect(service.getAgentRole("dimension_researcher")).toBe("维度研究员");
    });

    it("should return default role for unknown type", () => {
      expect(service.getAgentRole("unknown")).toBe("研究员");
    });
  });

  describe("getPhaseFromStatus", () => {
    it("should return correct phases for each status", () => {
      expect(service.getPhaseFromStatus(ResearchMissionStatus.PLANNING)).toBe(
        "planning",
      );
      expect(service.getPhaseFromStatus(ResearchMissionStatus.EXECUTING)).toBe(
        "researching",
      );
      expect(service.getPhaseFromStatus(ResearchMissionStatus.COMPLETED)).toBe(
        "completed",
      );
      expect(service.getPhaseFromStatus(ResearchMissionStatus.FAILED)).toBe(
        "failed",
      );
    });

    it("should return reviewing phase for REVIEWING status", () => {
      expect(service.getPhaseFromStatus(ResearchMissionStatus.REVIEWING)).toBe(
        "reviewing",
      );
    });

    it("should return unknown for unrecognized status", () => {
      expect(
        service.getPhaseFromStatus("SOME_UNKNOWN" as ResearchMissionStatus),
      ).toBe("unknown");
    });
  });

  // ─── getAgentRole - more branches ──────────────────────────────────────────

  describe("getAgentRole - all branches", () => {
    it("should return quality_reviewer role", () => {
      expect(service.getAgentRole("quality_reviewer")).toBe("质量审核员");
    });

    it("should return report_writer role", () => {
      expect(service.getAgentRole("report_writer")).toBe("报告撰写员");
    });

    it("should return default researcher role for null", () => {
      expect(service.getAgentRole(null)).toBe("研究员");
    });

    it("should return default researcher role for undefined", () => {
      expect(service.getAgentRole(undefined)).toBe("研究员");
    });
  });

  // ─── getAgentRoleFromTaskType ───────────────────────────────────────────────

  describe("getAgentRoleFromTaskType", () => {
    it("should return researcher for dimension_research", () => {
      expect(service.getAgentRoleFromTaskType("dimension_research")).toBe(
        "researcher",
      );
    });

    it("should return reviewer for quality_review", () => {
      expect(service.getAgentRoleFromTaskType("quality_review")).toBe(
        "reviewer",
      );
    });

    it("should return synthesizer for report_synthesis", () => {
      expect(service.getAgentRoleFromTaskType("report_synthesis")).toBe(
        "synthesizer",
      );
    });

    it("should return researcher as default for unknown type", () => {
      expect(service.getAgentRoleFromTaskType("unknown_type")).toBe(
        "researcher",
      );
    });
  });

  // ─── getAgentNameFromTaskType ───────────────────────────────────────────────

  describe("getAgentNameFromTaskType", () => {
    it("should return 研究员 for dimension_research", () => {
      expect(service.getAgentNameFromTaskType("dimension_research")).toBe(
        "研究员",
      );
    });

    it("should return 质量审核员 for quality_review", () => {
      expect(service.getAgentNameFromTaskType("quality_review")).toBe(
        "质量审核员",
      );
    });

    it("should return 报告撰写员 for report_synthesis", () => {
      expect(service.getAgentNameFromTaskType("report_synthesis")).toBe(
        "报告撰写员",
      );
    });

    it("should return 研究员 as default", () => {
      expect(service.getAgentNameFromTaskType("unknown")).toBe("研究员");
    });
  });

  // ─── getModelForAgentType ───────────────────────────────────────────────────

  describe("getModelForAgentType", () => {
    it("should return CHAT model for any agent type", () => {
      const { AIModelType } = jest.requireActual("@prisma/client");
      const modelMap = new Map([[AIModelType.CHAT, "gpt-4o"]]);
      expect(
        service.getModelForAgentType("dimension_researcher", modelMap),
      ).toBe("gpt-4o");
    });

    it("should return undefined if no CHAT model in map", () => {
      const modelMap = new Map<import("@prisma/client").AIModelType, string>();
      expect(
        service.getModelForAgentType("dimension_researcher", modelMap),
      ).toBeUndefined();
    });
  });

  // ─── getDefaultModelNames ───────────────────────────────────────────────────

  describe("getDefaultModelNames", () => {
    it("should return a map with CHAT model when facade returns one", async () => {
      const { AIModelType } = jest.requireActual("@prisma/client");
      const result = await service.getDefaultModelNames();
      expect(result.get(AIModelType.CHAT)).toBe("GPT-4o");
    });

    it("should return empty map when facade returns null", async () => {
      const mocks = buildMocks();
      mocks.mockAiFacade.getDefaultModelByType = jest
        .fn()
        .mockResolvedValue(null);

      const module2 = await Test.createTestingModule({
        providers: [
          MissionQueryService,
          { provide: PrismaService, useValue: mocks.mockPrisma },
          { provide: EventEmitter2, useValue: mocks.mockEventEmitter },
          {
            provide: ResearchEventEmitterService,
            useValue: mocks.mockResearchEventEmitter,
          },
          { provide: ChatFacade, useValue: mocks.mockAiFacade },
          { provide: ResearchLeaderService, useValue: mocks.mockLeaderService },
        ],
      }).compile();

      const svc = module2.get<MissionQueryService>(MissionQueryService);
      const result = await svc.getDefaultModelNames();
      expect(result.size).toBe(0);
    });
  });

  // ─── getTaskActivities - additional branches ────────────────────────────────

  describe("getTaskActivities - additional branches", () => {
    it("should query by reviewer role for quality_review tasks", async () => {
      const reviewTask = {
        ...mockTask,
        taskType: "quality_review",
        dimensionId: null,
        assignedAgent: "reviewer-1",
      };
      prisma.researchTask.findUnique.mockResolvedValue(reviewTask);
      prisma.researchAgentActivity.findMany.mockResolvedValue([]);

      await service.getTaskActivities("task-1");

      expect(prisma.researchAgentActivity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ agentRole: "reviewer" }),
        }),
      );
    });

    it("should query by synthesizer role for report_synthesis tasks", async () => {
      const synthTask = {
        ...mockTask,
        taskType: "report_synthesis",
        dimensionId: null,
        assignedAgent: "writer-1",
      };
      prisma.researchTask.findUnique.mockResolvedValue(synthTask);
      prisma.researchAgentActivity.findMany.mockResolvedValue([]);

      await service.getTaskActivities("task-1");

      expect(prisma.researchAgentActivity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ agentRole: "synthesizer" }),
        }),
      );
    });

    it("should use agentId filter for unknown task types", async () => {
      const unknownTask = {
        ...mockTask,
        taskType: "custom_task",
        dimensionId: null,
        assignedAgent: "custom-agent",
      };
      prisma.researchTask.findUnique.mockResolvedValue(unknownTask);
      prisma.researchAgentActivity.findMany.mockResolvedValue([]);

      await service.getTaskActivities("task-1");

      expect(prisma.researchAgentActivity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            missionId: "mission-1",
            agentId: "custom-agent",
          }),
        }),
      );
    });
  });

  // ─── updateTaskStatus - additional branches ─────────────────────────────────

  describe("updateTaskStatus - additional branches", () => {
    it("should use conditional update for terminal FAILED status", async () => {
      prisma.researchTask.updateMany.mockResolvedValue({ count: 1 });
      prisma.researchTask.findUnique.mockResolvedValue({
        ...mockTask,
        status: ResearchTaskStatus.FAILED,
        missionId: "mission-1",
      });
      prisma.researchTask.findMany.mockResolvedValue([
        { ...mockTask, status: ResearchTaskStatus.FAILED },
      ]);
      prisma.researchMission.update.mockResolvedValue({});

      await service.updateTaskStatus("task-1", ResearchTaskStatus.FAILED);

      expect(prisma.researchTask.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "task-1",
            status: {
              notIn: [ResearchTaskStatus.FAILED, ResearchTaskStatus.COMPLETED],
            },
          }),
        }),
      );
    });

    it("should still return task when count is 0 (already in terminal state)", async () => {
      prisma.researchTask.updateMany.mockResolvedValue({ count: 0 });
      prisma.researchTask.findUnique.mockResolvedValue({
        ...mockTask,
        status: ResearchTaskStatus.COMPLETED,
        missionId: "mission-1",
      });
      prisma.researchTask.findMany.mockResolvedValue([
        { ...mockTask, status: ResearchTaskStatus.COMPLETED },
      ]);
      prisma.researchMission.update.mockResolvedValue({});

      const result = await service.updateTaskStatus(
        "task-1",
        ResearchTaskStatus.COMPLETED,
      );

      expect(result.status).toBe(ResearchTaskStatus.COMPLETED);
    });

    it("should update result and resultSummary when provided for non-terminal status", async () => {
      prisma.researchTask.update.mockResolvedValue({
        ...mockTask,
        status: ResearchTaskStatus.EXECUTING,
        missionId: "mission-1",
      });
      prisma.researchTask.findMany.mockResolvedValue([]);
      prisma.researchMission.update.mockResolvedValue({});

      await service.updateTaskStatus("task-1", ResearchTaskStatus.EXECUTING, {
        result: { summary: "In progress" },
        resultSummary: "Working",
        actualModelId: "gpt-4o",
      });

      expect(prisma.researchTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            result: { summary: "In progress" },
            resultSummary: "Working",
            modelId: "gpt-4o",
          }),
        }),
      );
    });
  });

  // ─── updateMissionProgress ──────────────────────────────────────────────────

  describe("updateMissionProgress", () => {
    it("should set COMPLETED when all tasks completed", async () => {
      prisma.researchTask.findMany.mockResolvedValue([
        { status: ResearchTaskStatus.COMPLETED },
        { status: ResearchTaskStatus.COMPLETED },
      ]);
      prisma.researchMission.updateMany.mockResolvedValue({ count: 1 });

      await service.updateMissionProgress("mission-1");

      expect(prisma.researchMission.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ResearchMissionStatus.COMPLETED,
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it("should set FAILED when all terminal and some failed", async () => {
      prisma.researchTask.findMany.mockResolvedValue([
        { status: ResearchTaskStatus.COMPLETED },
        { status: ResearchTaskStatus.FAILED },
      ]);
      prisma.researchMission.updateMany.mockResolvedValue({ count: 1 });

      await service.updateMissionProgress("mission-1");

      expect(prisma.researchMission.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ResearchMissionStatus.FAILED,
          }),
        }),
      );
    });

    it("should not update status when tasks still running", async () => {
      prisma.researchTask.findMany.mockResolvedValue([
        { status: ResearchTaskStatus.COMPLETED },
        { status: ResearchTaskStatus.EXECUTING },
      ]);
      prisma.researchMission.updateMany.mockResolvedValue({ count: 1 });

      await service.updateMissionProgress("mission-1");

      // When tasks still running, no terminal status update should be called
      const updateManyCalls = prisma.researchMission.updateMany.mock.calls as {
        data?: { status?: string };
      }[][];
      const statusUpdateCalls = updateManyCalls.filter(
        (call) => call[0]?.data?.status !== undefined,
      );
      expect(statusUpdateCalls).toHaveLength(0);
    });

    it("should calculate 0 progress when no tasks", async () => {
      prisma.researchTask.findMany.mockResolvedValue([]);
      prisma.researchMission.updateMany.mockResolvedValue({ count: 1 });

      await service.updateMissionProgress("mission-1");

      expect(prisma.researchMission.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            progressPercent: 0,
          }),
        }),
      );
    });
  });

  // ─── getTeamInfo ────────────────────────────────────────────────────────────

  describe("getTeamInfo", () => {
    it("should throw NotFoundException when mission not found", async () => {
      prisma.researchMission.findUnique.mockResolvedValue(null);

      await expect(service.getTeamInfo("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should return team info with agents from tasks", async () => {
      const missionWithTasks = {
        ...mockMission,
        leaderModelId: "o3-mini",
        leaderModelName: "o3-mini",
        leaderPlan: null,
        tasks: [
          {
            id: "task-1",
            title: "Tech Research",
            assignedAgent: "researcher-1",
            assignedAgentType: "dimension_researcher",
            status: ResearchTaskStatus.EXECUTING,
            dimensionName: "Technology",
            modelId: "gpt-4o",
          },
        ],
      };
      prisma.researchMission.findUnique.mockResolvedValue(missionWithTasks);

      const result = await service.getTeamInfo("mission-1");

      expect(result.leaderId).toBe("leader");
      expect(result.leaderModel).toBe("o3-mini");
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].status).toBe("working");
    });

    it("should use chatFacade fallback when no stored model", async () => {
      const mocks = buildMocks();

      const missionNoModel = {
        ...mockMission,
        leaderModelId: null,
        leaderModelName: null,
        leaderPlan: null,
        tasks: [],
      };
      prisma.researchMission.findUnique.mockResolvedValue(missionNoModel);

      const module2 = await Test.createTestingModule({
        providers: [
          MissionQueryService,
          { provide: PrismaService, useValue: prisma },
          { provide: EventEmitter2, useValue: mocks.mockEventEmitter },
          {
            provide: ResearchEventEmitterService,
            useValue: mocks.mockResearchEventEmitter,
          },
          {
            provide: ChatFacade,
            useValue: {
              getDefaultModelByType: jest.fn().mockResolvedValue(null),
              getReasoningModel: jest.fn().mockResolvedValue({
                id: "dynamic-model",
                name: "Dynamic Model",
              }),
            },
          },
        ],
      }).compile();

      const svc = module2.get<MissionQueryService>(MissionQueryService);
      const result = await svc.getTeamInfo("mission-1");

      expect(result.leaderModel).toBe("dynamic-model");
    });

    it("should parse leaderPlan agentAssignments to extract skills and tools", async () => {
      const missionWithPlan = {
        ...mockMission,
        leaderModelId: "o3-mini",
        leaderModelName: "o3-mini",
        leaderPlan: {
          agentAssignments: [
            {
              agentId: "researcher-1",
              agentType: "dimension_researcher",
              skills: ["deep_research", "synthesis"],
              tools: ["web-search"],
              modelId: "gpt-4o",
            },
          ],
        },
        tasks: [
          {
            id: "task-1",
            title: "Tech Research",
            assignedAgent: "researcher-1",
            assignedAgentType: "dimension_researcher",
            status: ResearchTaskStatus.PENDING,
            dimensionName: "Technology",
            modelId: null,
          },
        ],
      };
      prisma.researchMission.findUnique.mockResolvedValue(missionWithPlan);

      const result = await service.getTeamInfo("mission-1");

      const agent = result.agents.find((a) => a.id === "researcher-1");
      expect(agent?.skills).toEqual(["deep_research", "synthesis"]);
      expect(agent?.tools).toEqual(["web-search"]);
    });

    it("should mark agent as failed when task status is FAILED", async () => {
      const missionWithFailedTask = {
        ...mockMission,
        leaderModelId: "o3-mini",
        leaderModelName: "o3-mini",
        leaderPlan: null,
        tasks: [
          {
            id: "task-1",
            title: "Failed Task",
            assignedAgent: "researcher-1",
            assignedAgentType: "dimension_researcher",
            status: ResearchTaskStatus.FAILED,
            dimensionName: null,
            modelId: null,
          },
        ],
      };
      prisma.researchMission.findUnique.mockResolvedValue(
        missionWithFailedTask,
      );

      const result = await service.getTeamInfo("mission-1");

      const agent = result.agents.find((a) => a.id === "researcher-1");
      expect(agent?.status).toBe("failed");
    });

    it("should handle empty/invalid leaderPlan without throwing", async () => {
      const missionWithInvalidPlan = {
        ...mockMission,
        leaderModelId: "o3-mini",
        leaderModelName: "o3-mini",
        leaderPlan: "invalid json",
        tasks: [],
      };
      prisma.researchMission.findUnique.mockResolvedValue(
        missionWithInvalidPlan,
      );

      await expect(service.getTeamInfo("mission-1")).resolves.toBeDefined();
    });
  });

  // ─── getMissionByTopicId - additional branches ──────────────────────────────

  describe("getMissionByTopicId - additional branches", () => {
    it("should include leaderModelId and leaderModelName in result", async () => {
      prisma.researchMission.findFirst.mockResolvedValue({
        ...mockMission,
        leaderModelId: "claude-opus",
        leaderModelName: "Claude Opus",
        tasks: [],
      });

      const result = await service.getMissionByTopicId("topic-1");

      expect(result?.leaderModelId).toBe("claude-opus");
      expect(result?.leaderModelName).toBe("Claude Opus");
    });

    it("should handle mission with tasks including modelId", async () => {
      prisma.researchMission.findFirst.mockResolvedValue({
        ...mockMission,
        tasks: [
          {
            ...mockTask,
            modelId: "gpt-4o",
          },
        ],
      });

      const result = await service.getMissionByTopicId("topic-1");

      expect(result?.tasks[0].modelId).toBe("gpt-4o");
    });
  });

  // ─── getMissionStatus - additional branches ─────────────────────────────────

  describe("getMissionStatus - additional branches", () => {
    it("should map task fields correctly including null values", async () => {
      prisma.researchMission.findUnique.mockResolvedValue({
        ...mockMission,
        tasks: [
          {
            ...mockTask,
            progress: null,
            reviewStatus: null,
            result: null,
            resultSummary: null,
            startedAt: null,
            completedAt: null,
            dimensionName: null,
            modelId: null,
          },
        ],
      });

      const result = await service.getMissionStatus("mission-1");

      const task = result.tasks[0];
      expect(task.progress).toBe(0);
      expect(task.dimensionName).toBeUndefined();
      expect(task.modelId).toBeUndefined();
    });
  });
});
