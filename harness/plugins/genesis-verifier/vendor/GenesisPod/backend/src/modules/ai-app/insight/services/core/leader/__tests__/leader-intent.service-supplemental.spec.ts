/**
 * LeaderIntentService - Supplemental Tests
 *
 * Covers uncovered branches:
 * - handleUserMessage: intentDetector unavailable (lines 97-101)
 * - handleUserMessage: no reasoning model → ServiceUnavailableException (line 176)
 * - handleUserMessage: CREATE_DIMENSION with full ResearchTask creation flow (lines 283-397)
 * - handleUserMessage: fallback delete error handling (lines 522-527)
 * - handleUserMessage: complex action execution loop with multiple action types (lines 889-964)
 * - decodeUserInput: mission with tasks → todoList construction (lines 630, 679-682, 690)
 * - decodeUserInput: no reasoning model → ACKNOWLEDGE fallback (line 690)
 * - buildProjectContext: LLM model pool fetch (lines 736-739)
 * - recordDecision: DB error handling (line 1078)
 * - quickDecodeIntent: all branches (lines 1013, 1029, 1042)
 * - handleQuickIntent: CONTINUE, SUMMARIZE with low/high progress, GENERAL_CHAT, default
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { LeaderIntentService } from "../leader-intent.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  ChatFacade,
  AgentFacade,
  ToolFacade,
  UserIntent,
} from "@/modules/ai-harness/facade";
import { ResearchEventEmitterService } from "../../research/research-event-emitter.service";
import {
  LeaderToolService,
  LeaderActionType,
} from "../../../data/leader-tool.service";
import { ResearchTaskStatus, ResearchMissionStatus } from "@prisma/client";

// ─── Mock factories ──────────────────────────────────────────────────────────

function buildMocks() {
  const mockPrisma = {
    researchMission: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    researchTopic: {
      findUnique: jest.fn(),
    },
    researchTask: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    leaderDecision: {
      create: jest.fn(),
    },
    knowledgeBase: {
      findMany: jest.fn(),
    },
  };

  const mockIntentDetector = {
    detectIntent: jest.fn(),
  };

  const mockChatFacade = {
    chat: jest.fn(),
    getReasoningModel: jest.fn(),
  };

  const mockAgentFacade = {
    intentDetector: mockIntentDetector,
  };

  const mockToolFacade = {
    getAvailableTools: jest.fn().mockReturnValue([]),
  };

  const mockEventEmitter = {
    saveUserMessage: jest.fn().mockResolvedValue(undefined),
    emitLeaderResponse: jest.fn().mockResolvedValue(undefined),
    emitResumeMissionExecution: jest.fn(),
    getLeaderConversationHistory: jest.fn().mockResolvedValue([]),
  };

  const mockLeaderToolService = {
    createDimension: jest.fn(),
    deleteDimension: jest.fn(),
    cancelTask: jest.fn(),
    updateDimension: jest.fn(),
    mergeDimensions: jest.fn(),
  };

  return {
    mockPrisma,
    mockChatFacade,
    mockAgentFacade,
    mockToolFacade,
    mockEventEmitter,
    mockLeaderToolService,
    mockIntentDetector,
  };
}

const reasoningModel = {
  id: "gpt-o1",
  name: "GPT o1",
  provider: "openai",
  isReasoning: true,
  isAvailable: true,
};

const baseMission = {
  id: "mission-1",
  status: "EXECUTING",
  topic: {
    id: "topic-1",
    name: "AI Research",
    dimensions: [{ id: "dim-1", name: "Market Analysis", status: "PENDING" }],
  },
  tasks: [],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LeaderIntentService (supplemental)", () => {
  let service: LeaderIntentService;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    mocks = buildMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderIntentService,
        { provide: PrismaService, useValue: mocks.mockPrisma },
        { provide: ChatFacade, useValue: mocks.mockChatFacade },
        { provide: AgentFacade, useValue: mocks.mockAgentFacade },
        { provide: ToolFacade, useValue: mocks.mockToolFacade },
        {
          provide: ResearchEventEmitterService,
          useValue: mocks.mockEventEmitter,
        },
        { provide: LeaderToolService, useValue: mocks.mockLeaderToolService },
      ],
    }).compile();

    service = module.get<LeaderIntentService>(LeaderIntentService);
  });

  afterEach(() => jest.clearAllMocks());

  // ══════════════════════════════════════════════════════════════════════════
  // handleUserMessage – intentDetector unavailable (lines 97-101)
  // ══════════════════════════════════════════════════════════════════════════

  describe("handleUserMessage – intentDetector unavailable", () => {
    it("should return unavailable response when intentDetector is null", async () => {
      // Temporarily remove the intentDetector from the facade
      (mocks.mockAgentFacade as { intentDetector: unknown }).intentDetector =
        null;

      const result = await service.handleUserMessage(
        "topic-1",
        "mission-1",
        "请帮我总结研究进度",
      );

      expect(result.response).toBe("意图检测服务不可用，请稍后重试");
      expect(
        mocks.mockPrisma.researchMission.findUnique,
      ).not.toHaveBeenCalled();
    });

    it("should return unavailable response when intentDetector is undefined", async () => {
      (mocks.mockAgentFacade as { intentDetector: unknown }).intentDetector =
        undefined;

      const result = await service.handleUserMessage(
        "topic-1",
        "mission-1",
        "继续",
      );

      expect(result.response).toBe("意图检测服务不可用，请稍后重试");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // handleUserMessage – mission not found
  // ══════════════════════════════════════════════════════════════════════════

  describe("handleUserMessage – mission not found", () => {
    it("should throw NotFoundException when mission does not exist", async () => {
      mocks.mockIntentDetector.detectIntent.mockReturnValue({
        intent: UserIntent.GENERAL_CHAT,
        confidence: 0.5,
      });
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue(null);

      await expect(
        service.handleUserMessage("topic-1", "mission-missing", "hello"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // handleUserMessage – no reasoning model (line 176)
  // ══════════════════════════════════════════════════════════════════════════

  describe("handleUserMessage – no reasoning model", () => {
    it("should throw ServiceUnavailableException when no reasoning model is available", async () => {
      mocks.mockIntentDetector.detectIntent.mockReturnValue({
        intent: UserIntent.ANALYZE,
        confidence: 0.4, // below 0.75 threshold → goes to complex path
      });
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        ...baseMission,
        tasks: [{ status: "COMPLETED", dimensionName: "dim1" }],
      });
      mocks.mockChatFacade.getReasoningModel.mockResolvedValue(null);

      await expect(
        service.handleUserMessage("topic-1", "mission-1", "分析市场趋势"),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // handleUserMessage – quick intent path (confidence >= 0.75)
  // ══════════════════════════════════════════════════════════════════════════

  describe("handleUserMessage – quick intent response", () => {
    it("should return quick response for CONTINUE intent with high confidence", async () => {
      mocks.mockIntentDetector.detectIntent.mockReturnValue({
        intent: UserIntent.CONTINUE,
        confidence: 0.9,
      });
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        ...baseMission,
        tasks: [
          { status: "COMPLETED", dimensionName: "Market" },
          { status: "EXECUTING", dimensionName: "Tech" },
        ],
      });
      mocks.mockPrisma.leaderDecision.create.mockResolvedValue({});

      const result = await service.handleUserMessage(
        "topic-1",
        "mission-1",
        "继续研究",
      );

      expect(result.response).toContain("AI Research");
      expect(result.response).toContain("50%");
      expect(mocks.mockEventEmitter.emitLeaderResponse).toHaveBeenCalledWith(
        "topic-1",
        "mission-1",
        expect.any(String),
      );
    });

    it("should return quick response for SUMMARIZE intent with low progress", async () => {
      mocks.mockIntentDetector.detectIntent.mockReturnValue({
        intent: UserIntent.SUMMARIZE,
        confidence: 0.85,
      });
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        ...baseMission,
        tasks: [
          { status: "COMPLETED", dimensionName: "dim1" },
          { status: "PENDING", dimensionName: "dim2" },
          { status: "PENDING", dimensionName: "dim3" },
          { status: "PENDING", dimensionName: "dim4" },
          { status: "PENDING", dimensionName: "dim5" },
        ],
      });
      mocks.mockPrisma.leaderDecision.create.mockResolvedValue({});

      const result = await service.handleUserMessage(
        "topic-1",
        "mission-1",
        "总结一下研究",
      );

      expect(result.response).toContain("20%");
    });

    it("should fall through to AI for SUMMARIZE with high progress", async () => {
      mocks.mockIntentDetector.detectIntent.mockReturnValue({
        intent: UserIntent.SUMMARIZE,
        confidence: 0.9,
      });
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        ...baseMission,
        tasks: [
          { status: "COMPLETED", dimensionName: "d1" },
          { status: "COMPLETED", dimensionName: "d2" },
        ],
      });
      // Falls through to AI path - need reasoning model
      mocks.mockChatFacade.getReasoningModel.mockResolvedValue(reasoningModel);
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({ response: "AI 总结：研究进度良好。" }),
      });
      mocks.mockPrisma.leaderDecision.create.mockResolvedValue({});

      const result = await service.handleUserMessage(
        "topic-1",
        "mission-1",
        "总结研究",
      );

      expect(result.response).toBeDefined();
    });

    it("should return quick response for GENERAL_CHAT intent", async () => {
      mocks.mockIntentDetector.detectIntent.mockReturnValue({
        intent: UserIntent.GENERAL_CHAT,
        confidence: 0.8,
      });
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        ...baseMission,
        tasks: [],
      });
      mocks.mockPrisma.leaderDecision.create.mockResolvedValue({});

      const result = await service.handleUserMessage(
        "topic-1",
        "mission-1",
        "你好",
      );

      expect(result.response).toContain("AI Research");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // handleUserMessage – CREATE_DIMENSION full flow (lines 283-397)
  // ══════════════════════════════════════════════════════════════════════════

  describe("handleUserMessage – CREATE_DIMENSION action", () => {
    beforeEach(() => {
      mocks.mockIntentDetector.detectIntent.mockReturnValue({
        intent: UserIntent.ANALYZE,
        confidence: 0.5,
      });
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        ...baseMission,
        tasks: [],
      });
      mocks.mockChatFacade.getReasoningModel.mockResolvedValue(reasoningModel);
      mocks.mockPrisma.leaderDecision.create.mockResolvedValue({});
    });

    it("should create ResearchTask and update mission totalTasks after dimension creation", async () => {
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "已创建新维度",
          actions: [
            {
              type: LeaderActionType.CREATE_DIMENSION,
              params: {
                name: "竞争分析",
                description: "分析竞争态势",
              },
            },
          ],
        }),
      });

      mocks.mockLeaderToolService.createDimension.mockResolvedValue({
        success: true,
        action: LeaderActionType.CREATE_DIMENSION,
        message: "维度已创建",
        data: { dimensionId: "dim-new", name: "竞争分析" },
      });

      const newTask = { id: "task-new", missionId: "mission-1" };
      mocks.mockPrisma.researchTask.create.mockResolvedValue(newTask);
      mocks.mockPrisma.researchMission.update.mockResolvedValue({});
      mocks.mockPrisma.researchTask.findFirst.mockResolvedValue({
        id: "quality-task-1",
        dependencies: [],
      });
      mocks.mockPrisma.researchTask.update.mockResolvedValue({});
      mocks.mockPrisma.researchTask.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.handleUserMessage(
        "topic-1",
        "mission-1",
        "添加竞争分析维度",
      );

      expect(mocks.mockLeaderToolService.createDimension).toHaveBeenCalledWith({
        topicId: "topic-1",
        name: "竞争分析",
        description: "分析竞争态势",
      });
      expect(mocks.mockPrisma.researchTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            missionId: "mission-1",
            dimensionId: "dim-new",
            dimensionName: "竞争分析",
            taskType: "dimension_research",
            status: ResearchTaskStatus.PENDING,
          }),
        }),
      );
      expect(mocks.mockPrisma.researchMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { totalTasks: { increment: 1 } },
        }),
      );
      expect(result.response).toBeDefined();
      expect(result.actionResults).toHaveLength(1);
      expect(result.actionResults![0].success).toBe(true);
    });

    it("should reset downstream tasks to PENDING when count > 0", async () => {
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "已创建维度并重置",
          actions: [
            {
              type: LeaderActionType.CREATE_DIMENSION,
              params: { name: "新维度" },
            },
          ],
        }),
      });

      mocks.mockLeaderToolService.createDimension.mockResolvedValue({
        success: true,
        action: LeaderActionType.CREATE_DIMENSION,
        message: "已创建",
        data: { dimensionId: "dim-reset", name: "新维度" },
      });

      mocks.mockPrisma.researchTask.create.mockResolvedValue({
        id: "task-reset",
      });
      mocks.mockPrisma.researchMission.update.mockResolvedValue({});
      mocks.mockPrisma.researchTask.findFirst.mockResolvedValue(null); // no quality review task
      mocks.mockPrisma.researchTask.updateMany.mockResolvedValue({ count: 2 }); // 2 downstream tasks reset

      await service.handleUserMessage("topic-1", "mission-1", "添加新维度");

      expect(mocks.mockPrisma.researchTask.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            missionId: "mission-1",
            taskType: { in: ["quality_review", "report_synthesis"] },
          }),
          data: expect.objectContaining({
            status: ResearchTaskStatus.PENDING,
          }),
        }),
      );
      // Should reset mission status too since count > 0
      expect(mocks.mockPrisma.researchMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ResearchMissionStatus.EXECUTING,
            progressPercent: 0,
          }),
        }),
      );
    });

    it("should handle ResearchTask creation failure gracefully (non-fatal)", async () => {
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "已创建维度",
          actions: [
            {
              type: LeaderActionType.CREATE_DIMENSION,
              params: { name: "失败维度" },
            },
          ],
        }),
      });

      mocks.mockLeaderToolService.createDimension.mockResolvedValue({
        success: true,
        action: LeaderActionType.CREATE_DIMENSION,
        message: "已创建",
        data: { dimensionId: "dim-fail", name: "失败维度" },
      });

      mocks.mockPrisma.researchTask.create.mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.handleUserMessage(
        "topic-1",
        "mission-1",
        "添加失败维度",
      );

      // Should still return result since task creation error is non-fatal
      expect(result.response).toBeDefined();
      expect(result.actionResults![0].success).toBe(true);
    });

    it("should update quality review task dependencies when quality review task exists", async () => {
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "已创建维度",
          actions: [
            {
              type: LeaderActionType.CREATE_DIMENSION,
              params: { name: "新维度2" },
            },
          ],
        }),
      });

      mocks.mockLeaderToolService.createDimension.mockResolvedValue({
        success: true,
        action: LeaderActionType.CREATE_DIMENSION,
        message: "已创建",
        data: { dimensionId: "dim-dep", name: "新维度2" },
      });

      const newTask = { id: "task-dep-new" };
      mocks.mockPrisma.researchTask.create.mockResolvedValue(newTask);
      mocks.mockPrisma.researchMission.update.mockResolvedValue({});
      mocks.mockPrisma.researchTask.findFirst.mockResolvedValue({
        id: "quality-review-1",
        dependencies: ["existing-dep"],
      });
      mocks.mockPrisma.researchTask.update.mockResolvedValue({});
      mocks.mockPrisma.researchTask.updateMany.mockResolvedValue({ count: 0 });

      await service.handleUserMessage("topic-1", "mission-1", "添加维度");

      expect(mocks.mockPrisma.researchTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "quality-review-1" },
          data: {
            dependencies: ["existing-dep", "task-dep-new"],
          },
        }),
      );
    });

    it("should not re-add existing dependency if task already in list", async () => {
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "已创建维度",
          actions: [
            {
              type: LeaderActionType.CREATE_DIMENSION,
              params: { name: "重复依赖维度" },
            },
          ],
        }),
      });

      mocks.mockLeaderToolService.createDimension.mockResolvedValue({
        success: true,
        action: LeaderActionType.CREATE_DIMENSION,
        message: "已创建",
        data: { dimensionId: "dim-dup", name: "重复依赖维度" },
      });

      const newTask = { id: "existing-dep" }; // same id already in dependencies
      mocks.mockPrisma.researchTask.create.mockResolvedValue(newTask);
      mocks.mockPrisma.researchMission.update.mockResolvedValue({});
      mocks.mockPrisma.researchTask.findFirst.mockResolvedValue({
        id: "quality-review-1",
        dependencies: ["existing-dep"], // already contains new task id
      });
      mocks.mockPrisma.researchTask.update.mockResolvedValue({});
      mocks.mockPrisma.researchTask.updateMany.mockResolvedValue({ count: 0 });

      await service.handleUserMessage("topic-1", "mission-1", "重复添加维度");

      // update should NOT be called since dep already exists
      expect(mocks.mockPrisma.researchTask.update).not.toHaveBeenCalled();
    });

    it("should not call createDimension when action creation fails", async () => {
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "无法创建",
          actions: [
            {
              type: LeaderActionType.CREATE_DIMENSION,
              params: { name: "失败维度" },
            },
          ],
        }),
      });

      mocks.mockLeaderToolService.createDimension.mockResolvedValue({
        success: false,
        action: LeaderActionType.CREATE_DIMENSION,
        message: "维度已存在",
      });

      const result = await service.handleUserMessage(
        "topic-1",
        "mission-1",
        "创建已存在维度",
      );

      // No ResearchTask should be created since dimension creation failed
      expect(mocks.mockPrisma.researchTask.create).not.toHaveBeenCalled();
      expect(result.actionResults![0].success).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // handleUserMessage – multiple action types (lines 400-464)
  // ══════════════════════════════════════════════════════════════════════════

  describe("handleUserMessage – multiple action types", () => {
    beforeEach(() => {
      mocks.mockIntentDetector.detectIntent.mockReturnValue({
        intent: UserIntent.ANALYZE,
        confidence: 0.5,
      });
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        ...baseMission,
        tasks: [],
      });
      mocks.mockChatFacade.getReasoningModel.mockResolvedValue(reasoningModel);
      mocks.mockPrisma.leaderDecision.create.mockResolvedValue({});
    });

    it("should execute DELETE_DIMENSION action", async () => {
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "已删除维度",
          actions: [
            {
              type: LeaderActionType.DELETE_DIMENSION,
              params: { dimensionName: "Market Analysis" },
            },
          ],
        }),
      });

      mocks.mockLeaderToolService.deleteDimension.mockResolvedValue({
        success: true,
        action: LeaderActionType.DELETE_DIMENSION,
        message: "维度已删除",
      });

      const result = await service.handleUserMessage(
        "topic-1",
        "mission-1",
        "删除市场分析维度",
      );

      expect(mocks.mockLeaderToolService.deleteDimension).toHaveBeenCalledWith({
        topicId: "topic-1",
        dimensionName: "Market Analysis",
      });
      expect(result.actionResults![0].success).toBe(true);
    });

    it("should execute CANCEL_TASK action", async () => {
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "已停止该任务",
          actions: [
            {
              type: LeaderActionType.CANCEL_TASK,
              params: { dimensionName: "Market Analysis", taskName: "task1" },
            },
          ],
        }),
      });

      mocks.mockLeaderToolService.cancelTask.mockResolvedValue({
        success: true,
        action: LeaderActionType.CANCEL_TASK,
        message: "任务已停止",
      });

      // Use message without any delete keywords (删除/移除/取消/去掉/不要)
      const result = await service.handleUserMessage(
        "topic-1",
        "mission-1",
        "停止市场分析",
      );

      expect(mocks.mockLeaderToolService.cancelTask).toHaveBeenCalled();
      expect(result.actionResults![0].action).toBe(
        LeaderActionType.CANCEL_TASK,
      );
    });

    it("should execute UPDATE_DIMENSION action", async () => {
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "已更新维度",
          actions: [
            {
              type: LeaderActionType.UPDATE_DIMENSION,
              params: {
                dimensionName: "Market Analysis",
                newName: "市场研究",
              },
            },
          ],
        }),
      });

      mocks.mockLeaderToolService.updateDimension.mockResolvedValue({
        success: true,
        action: LeaderActionType.UPDATE_DIMENSION,
        message: "已更新",
      });

      const result = await service.handleUserMessage(
        "topic-1",
        "mission-1",
        "更新维度名称",
      );

      expect(mocks.mockLeaderToolService.updateDimension).toHaveBeenCalled();
      expect(result.actionResults![0].success).toBe(true);
    });

    it("should execute MERGE_DIMENSIONS action", async () => {
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "已合并维度",
          actions: [
            {
              type: LeaderActionType.MERGE_DIMENSIONS,
              params: {
                sourceDimensionNames: ["dim1", "dim2"],
                targetDimensionName: "merged",
              },
            },
          ],
        }),
      });

      mocks.mockLeaderToolService.mergeDimensions.mockResolvedValue({
        success: true,
        action: LeaderActionType.MERGE_DIMENSIONS,
        message: "已合并",
      });

      const result = await service.handleUserMessage(
        "topic-1",
        "mission-1",
        "合并维度",
      );

      expect(mocks.mockLeaderToolService.mergeDimensions).toHaveBeenCalled();
      expect(result.actionResults![0].action).toBe(
        LeaderActionType.MERGE_DIMENSIONS,
      );
    });

    it("should execute NO_ACTION and return success", async () => {
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "继续当前研究方向",
          actions: [
            {
              type: LeaderActionType.NO_ACTION,
              params: {},
            },
          ],
        }),
      });

      const result = await service.handleUserMessage(
        "topic-1",
        "mission-1",
        "继续",
      );

      expect(result.actionResults![0].success).toBe(true);
      expect(result.actionResults![0].action).toBe(LeaderActionType.NO_ACTION);
      expect(result.actionResults![0].message).toBe("无需执行动作");
    });

    it("should handle unknown action type gracefully", async () => {
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "未知动作",
          actions: [
            {
              type: "UNKNOWN_ACTION",
              params: {},
            },
          ],
        }),
      });

      const result = await service.handleUserMessage(
        "topic-1",
        "mission-1",
        "做点什么",
      );

      expect(result.actionResults![0].success).toBe(false);
      expect(result.actionResults![0].message).toContain("未知的动作类型");
    });

    it("should catch and recover from action execution exception", async () => {
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "删除维度",
          actions: [
            {
              type: LeaderActionType.DELETE_DIMENSION,
              params: { dimensionName: "dim1" },
            },
          ],
        }),
      });

      mocks.mockLeaderToolService.deleteDimension.mockRejectedValue(
        new Error("Service crash"),
      );

      const result = await service.handleUserMessage(
        "topic-1",
        "mission-1",
        "删除维度",
      );

      expect(result.actionResults![0].success).toBe(false);
      expect(result.actionResults![0].message).toContain("Service crash");
    });

    it("should append failed action messages to final response", async () => {
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "处理您的请求",
          actions: [
            {
              type: LeaderActionType.DELETE_DIMENSION,
              params: { dimensionName: "dim1" },
            },
          ],
        }),
      });

      mocks.mockLeaderToolService.deleteDimension.mockResolvedValue({
        success: false,
        action: LeaderActionType.DELETE_DIMENSION,
        message: "维度不存在",
      });

      const result = await service.handleUserMessage(
        "topic-1",
        "mission-1",
        "删除维度",
      );

      expect(result.response).toContain("维度不存在");
      expect(result.response).toContain("⚠️");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // handleUserMessage – fallback delete detection (lines 470-531)
  // ══════════════════════════════════════════════════════════════════════════

  describe("handleUserMessage – fallback delete intent detection", () => {
    beforeEach(() => {
      mocks.mockIntentDetector.detectIntent.mockReturnValue({
        intent: UserIntent.ANALYZE,
        confidence: 0.5,
      });
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        ...baseMission,
        tasks: [],
      });
      mocks.mockChatFacade.getReasoningModel.mockResolvedValue(reasoningModel);
      mocks.mockPrisma.leaderDecision.create.mockResolvedValue({});
    });

    it("should attempt fallback delete when message has delete keyword but AI didn't produce DELETE action", async () => {
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "好的",
          actions: [],
        }),
      });

      mocks.mockLeaderToolService.deleteDimension.mockResolvedValue({
        success: true,
        action: LeaderActionType.DELETE_DIMENSION,
        message: "维度已删除",
      });

      const result = await service.handleUserMessage(
        "topic-1",
        "mission-1",
        "删除维度：市场分析",
      );

      expect(mocks.mockLeaderToolService.deleteDimension).toHaveBeenCalledWith({
        topicId: "topic-1",
        dimensionName: "市场分析",
      });
      // Response should be updated to reflect the deletion
      expect(result.response).toBe("维度已删除");
    });

    it("should handle fallback delete failure gracefully (lines 522-527)", async () => {
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "好的",
          actions: [],
        }),
      });

      mocks.mockLeaderToolService.deleteDimension.mockRejectedValue(
        new Error("Delete service failed"),
      );

      // Should not throw
      const result = await service.handleUserMessage(
        "topic-1",
        "mission-1",
        "删除维度：某维度",
      );

      expect(result.response).toBeDefined();
    });

    it("should log warning when no dimension name can be extracted from delete intent", async () => {
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "好的",
          actions: [],
        }),
      });

      // Message has delete keyword but no extractable dimension name
      const result = await service.handleUserMessage(
        "topic-1",
        "mission-1",
        "删除",
      );

      // deleteDimension should NOT be called since no name extracted
      expect(
        mocks.mockLeaderToolService.deleteDimension,
      ).not.toHaveBeenCalled();
      expect(result.response).toBeDefined();
    });

    it("should extract dimension name with 移除 pattern", async () => {
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "好的",
          actions: [],
        }),
      });

      mocks.mockLeaderToolService.deleteDimension.mockResolvedValue({
        success: true,
        action: LeaderActionType.DELETE_DIMENSION,
        message: "已移除",
      });

      await service.handleUserMessage("topic-1", "mission-1", "移除竞争分析");

      expect(mocks.mockLeaderToolService.deleteDimension).toHaveBeenCalledWith(
        expect.objectContaining({ dimensionName: "竞争分析" }),
      );
    });

    it("should handle AI response JSON parse failure with fallback", async () => {
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: "not valid json at all",
      });

      const result = await service.handleUserMessage(
        "topic-1",
        "mission-1",
        "查询状态",
      );

      expect(result.response).toBe("收到您的指令，我会继续推进研究工作。");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // decodeUserInput (lines 574-803)
  // ══════════════════════════════════════════════════════════════════════════

  describe("decodeUserInput", () => {
    it("should throw NotFoundException when topic not found", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await expect(
        service.decodeUserInput("topic-missing", "hello"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should return quick decode result for progress query", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-1",
        name: "AI Research",
        description: "Research on AI",
        dimensions: [],
      });

      const result = await service.decodeUserInput("topic-1", "进度如何");

      expect(result.decisionType).toBe("DIRECT_ANSWER");
      expect(result.response).toContain("AI Research");
    });

    it("should return quick decode ACKNOWLEDGE for simple confirmation", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-1",
        name: "AI Research",
        description: "Research on AI",
        dimensions: [],
      });

      const result = await service.decodeUserInput("topic-1", "好的");

      expect(result.decisionType).toBe("ACKNOWLEDGE");
      expect(result.response).toContain("有需要随时告诉我");
    });

    it("should return CLARIFY for vague request", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-1",
        name: "AI Research",
        description: "Research on AI",
        dimensions: [],
      });

      const result = await service.decodeUserInput("topic-1", "再研究一下");

      expect(result.decisionType).toBe("CLARIFY");
    });

    it("should use missionId tasks to build todoList (lines 630, 679-682)", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-1",
        name: "AI Research",
        description: "Research",
        dimensions: [],
        topicConfig: null,
      });

      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        id: "mission-1",
        status: "EXECUTING",
        tasks: [
          { status: "COMPLETED", dimensionName: "market", title: "研究市场" },
          { status: "EXECUTING", dimensionName: "tech", title: "研究技术" },
          { status: "PENDING", dimensionName: "policy", title: "研究政策" },
          { status: "ASSIGNED", dimensionName: "social", title: "研究社会" },
        ],
      });

      // Project context requires researchTopic with dimensions
      mocks.mockPrisma.researchTopic.findUnique
        .mockResolvedValueOnce({
          id: "topic-1",
          name: "AI Research",
          description: "Research",
          dimensions: [],
          topicConfig: null,
        })
        .mockResolvedValueOnce({
          id: "topic-1",
          name: "AI Research",
          description: "Research",
          dimensions: [],
          topicConfig: null,
        });

      // Falls through to AI since it's not a project config question
      // But "工具" is not in message so quickDecodeIntent is tried first
      // "工具" is a project config keyword but won't match for this message
      mocks.mockChatFacade.getReasoningModel.mockResolvedValue(reasoningModel);
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          decisionType: "DIRECT_ANSWER",
          understanding: "用户询问复杂问题",
          response: "我来处理您的请求",
        }),
      });

      const result = await service.decodeUserInput(
        "topic-1",
        "分析当前研究状态",
        "mission-1",
      );

      expect(result.decisionType).toBe("DIRECT_ANSWER");
      expect(result.understanding).toBeDefined();
    });

    it("should return ACKNOWLEDGE fallback when no reasoning model (line 690)", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-1",
        name: "AI Research",
        description: "Research",
        dimensions: [],
        topicConfig: null,
      });

      // No mission
      mocks.mockChatFacade.getReasoningModel.mockResolvedValue(null);

      const result = await service.decodeUserInput(
        "topic-1",
        "请分析一个复杂的研究问题",
      );

      expect(result.decisionType).toBe("ACKNOWLEDGE");
      expect(result.response).toContain("请分析一个复杂的研究问题");
    });

    it("should include conversation history in AI call when available (line 739)", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-1",
        name: "AI Research",
        description: "Research on AI",
        dimensions: [],
        topicConfig: null,
      });

      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        id: "mission-1",
        status: "EXECUTING",
        tasks: [],
        leaderPlan: null,
      });

      const conversationHistory = [
        { role: "user" as const, content: "之前的问题" },
        { role: "assistant" as const, content: "之前的回答" },
      ];
      mocks.mockEventEmitter.getLeaderConversationHistory.mockResolvedValue(
        conversationHistory,
      );

      mocks.mockChatFacade.getReasoningModel.mockResolvedValue(reasoningModel);
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          decisionType: "DIRECT_ANSWER",
          understanding: "理解了",
          response: "回答",
        }),
      });

      await service.decodeUserInput(
        "topic-1",
        "继续我们之前的讨论",
        "mission-1",
      );

      // Verify that chat was called with messages including the conversation history
      expect(mocks.mockChatFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "user", content: "之前的问题" }),
          ]),
        }),
      );
    });

    it("should fall back to ACKNOWLEDGE when AI response JSON parse fails (line 771)", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-1",
        name: "AI Research",
        description: null,
        dimensions: [],
        topicConfig: null,
      });

      mocks.mockChatFacade.getReasoningModel.mockResolvedValue(reasoningModel);
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: "not valid json response",
      });

      const result = await service.decodeUserInput(
        "topic-1",
        "帮我分析市场趋势",
      );

      expect(result.decisionType).toBe("ACKNOWLEDGE");
      expect(result.response).toBe("收到！我会处理您的请求。");
    });

    it("should normalize invalid decisionType to ACKNOWLEDGE (line 787)", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-1",
        name: "AI Research",
        description: null,
        dimensions: [],
        topicConfig: null,
      });

      mocks.mockChatFacade.getReasoningModel.mockResolvedValue(reasoningModel);
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          decisionType: "INVALID_TYPE",
          understanding: "理解",
          response: "回答",
          todoTitle: "Todo",
        }),
      });

      const result = await service.decodeUserInput("topic-1", "做某些事情");

      expect(result.decisionType).toBe("ACKNOWLEDGE");
      expect(result.todoTitle).toBe("Todo");
    });

    it("should skip project config question check when keywords present", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-1",
        name: "AI Research",
        description: null,
        dimensions: [],
        topicConfig: null,
      });

      mocks.mockChatFacade.getReasoningModel.mockResolvedValue(reasoningModel);
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          decisionType: "DIRECT_ANSWER",
          understanding: "关于工具配置",
          response: "以下是可用工具列表...",
        }),
      });

      // Message contains "工具" - should skip quick decode
      const result = await service.decodeUserInput(
        "topic-1",
        "你有哪些工具可用？",
      );

      expect(result.decisionType).toBe("DIRECT_ANSWER");
      // Should call AI (quickDecodeIntent skipped for config questions)
      expect(mocks.mockChatFacade.chat).toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // recordDecision – error handling (line 1078)
  // ══════════════════════════════════════════════════════════════════════════

  describe("recordDecision – DB error handling", () => {
    it("should not throw when leaderDecision.create fails", async () => {
      mocks.mockIntentDetector.detectIntent.mockReturnValue({
        intent: UserIntent.CONTINUE,
        confidence: 0.9,
      });
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        ...baseMission,
        tasks: [{ status: "COMPLETED", dimensionName: "dim1" }],
      });
      // recordDecision will fail
      mocks.mockPrisma.leaderDecision.create.mockRejectedValue(
        new Error("DB connection lost"),
      );

      // Should not throw even though DB recording fails
      const result = await service.handleUserMessage(
        "topic-1",
        "mission-1",
        "继续研究",
      );

      expect(result.response).toBeDefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // buildProjectContext – knowledge base fetching
  // ══════════════════════════════════════════════════════════════════════════

  describe("buildProjectContext – knowledge base and tools", () => {
    it("should include knowledge base names when knowledgeBaseIds configured", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-1",
        name: "AI Research",
        description: "Research on AI",
        dimensions: [],
        topicConfig: {
          knowledgeBaseIds: ["kb-1", "kb-2"],
          searchTimeRange: "最近1年",
        },
      });

      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        id: "mission-1",
        status: "EXECUTING",
        tasks: [],
        leaderPlan: {
          agentAssignments: [
            {
              agentId: "researcher-1",
              agentName: "研究员",
              agentType: "researcher",
              modelId: "gpt-4o",
              skills: ["analysis"],
              tools: ["web-search"],
              role: "主研究员",
            },
          ],
        },
      });

      mocks.mockPrisma.knowledgeBase.findMany.mockResolvedValue([
        { id: "kb-1", name: "AI知识库" },
        { id: "kb-2", name: "市场数据库" },
      ]);

      mocks.mockToolFacade.getAvailableTools.mockReturnValue([
        { name: "web-search", description: "搜索网络" },
        { name: "academic-search", description: "学术搜索" },
      ]);

      mocks.mockChatFacade.getReasoningModel.mockResolvedValue(reasoningModel);
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          decisionType: "DIRECT_ANSWER",
          understanding: "了解配置",
          response: "您的项目已配置知识库",
        }),
      });

      const result = await service.decodeUserInput(
        "topic-1",
        "你有哪些知识库？",
        "mission-1",
      );

      expect(result.decisionType).toBe("DIRECT_ANSWER");
      // AI was called with project context containing KB names
      expect(mocks.mockPrisma.knowledgeBase.findMany).toHaveBeenCalledWith({
        where: { id: { in: ["kb-1", "kb-2"] } },
        select: { id: true, name: true },
      });
    });

    it("should handle knowledge base fetch error gracefully", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-1",
        name: "AI Research",
        description: null,
        dimensions: [],
        topicConfig: {
          knowledgeBaseIds: ["kb-invalid"],
        },
      });

      mocks.mockPrisma.knowledgeBase.findMany.mockRejectedValue(
        new Error("KB service unavailable"),
      );

      mocks.mockChatFacade.getReasoningModel.mockResolvedValue(reasoningModel);
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          decisionType: "ACKNOWLEDGE",
          understanding: "了解",
          response: "好的",
        }),
      });

      // Should not throw even when KB fetch fails
      const result = await service.decodeUserInput("topic-1", "配置是什么？");

      expect(result).toBeDefined();
    });

    it("should return error context when buildProjectContext throws", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-1",
        name: "AI Research",
        description: null,
        dimensions: [],
        topicConfig: null,
      });

      // Make prisma throw during parallel query
      mocks.mockPrisma.researchTopic.findUnique
        .mockResolvedValueOnce({
          id: "topic-1",
          name: "AI Research",
          description: null,
          dimensions: [],
          topicConfig: null,
        })
        .mockRejectedValueOnce(new Error("DB error in buildProjectContext"));

      mocks.mockChatFacade.getReasoningModel.mockResolvedValue(reasoningModel);
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          decisionType: "ACKNOWLEDGE",
          understanding: "了解",
          response: "好的",
        }),
      });

      // Should not throw
      const result = await service.decodeUserInput("topic-1", "配置有哪些？");

      expect(result).toBeDefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getReasoningModel – wrapper behavior
  // ══════════════════════════════════════════════════════════════════════════

  describe("getReasoningModel", () => {
    it("should return null when chatFacade.getReasoningModel returns null", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-1",
        name: "AI Research",
        description: null,
        dimensions: [],
        topicConfig: null,
      });

      mocks.mockChatFacade.getReasoningModel.mockResolvedValue(null);

      const result = await service.decodeUserInput(
        "topic-1",
        "什么是人工智能发展趋势？",
      );

      // Falls back to ACKNOWLEDGE when no model
      expect(result.decisionType).toBe("ACKNOWLEDGE");
    });

    it("should map model fields correctly from facade response", async () => {
      mocks.mockIntentDetector.detectIntent.mockReturnValue({
        intent: UserIntent.ANALYZE,
        confidence: 0.5,
      });
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        ...baseMission,
        tasks: [],
      });
      mocks.mockChatFacade.getReasoningModel.mockResolvedValue({
        id: "claude-3-opus",
        name: "Claude 3 Opus",
        provider: "anthropic",
        isReasoning: true,
        isAvailable: true,
      });
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({ response: "分析完成" }),
      });
      mocks.mockPrisma.leaderDecision.create.mockResolvedValue({});

      const result = await service.handleUserMessage(
        "topic-1",
        "mission-1",
        "分析研究进展",
      );

      expect(mocks.mockChatFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({ model: "claude-3-opus" }),
      );
      expect(result.response).toBeDefined();
    });

    it("should default isReasoning to false when not provided", async () => {
      mocks.mockIntentDetector.detectIntent.mockReturnValue({
        intent: UserIntent.ANALYZE,
        confidence: 0.5,
      });
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        ...baseMission,
        tasks: [],
      });
      mocks.mockChatFacade.getReasoningModel.mockResolvedValue({
        id: "some-model",
        name: "Some Model",
        provider: "openai",
        // isReasoning is undefined → should default to false
      });
      mocks.mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify({ response: "完成" }),
      });
      mocks.mockPrisma.leaderDecision.create.mockResolvedValue({});

      await service.handleUserMessage("topic-1", "mission-1", "处理请求");

      expect(mocks.mockChatFacade.chat).toHaveBeenCalled();
    });
  });
});
