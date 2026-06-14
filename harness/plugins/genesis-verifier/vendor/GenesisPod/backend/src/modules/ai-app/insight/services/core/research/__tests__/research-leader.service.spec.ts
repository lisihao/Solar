/**
 * ResearchLeaderService Unit Tests
 *
 * Coverage targets:
 * - getReasoningModel: delegates to facade, handles null
 * - planResearch: topic not found, AI call, post-processing agent assignments
 * - reviewTaskResult: approved/needs_revision, parse failure fallback
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ResearchLeaderService } from "../research-leader.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ChatFacade, AgentFacade, ToolFacade } from "@/modules/ai-harness/facade";
import { ResearchEventEmitterService } from "../research-event-emitter.service";
import { LeaderToolService } from "../../../data/leader-tool.service";
import { LeaderPlanningService } from "../../leader/leader-planning.service";
import { LeaderIntentService } from "../../leader/leader-intent.service";
import { LeaderAgentSelectionService } from "../../leader/leader-agent-selection.service";
import { LeaderReviewService } from "../../leader/leader-review.service";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function buildMocks() {
  const mockPrisma = {
    researchTopic: {
      findUnique: jest.fn(),
    },
    leaderDecision: {
      create: jest.fn(),
    },
    researchTask: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    researchMission: {
      update: jest.fn(),
    },
  };

  const mockFacade = {
    getAvailableModelsExtended: jest.fn(),
    getReasoningModel: jest.fn(),
    chat: jest.fn(),
    chatStructured: jest.fn(),
    intentDetector: {
      detectIntent: jest.fn(),
    },
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

  const mockToolFacade = {
    getAvailableTools: jest.fn().mockReturnValue([]),
  };

  return {
    mockPrisma,
    mockFacade,
    mockEventEmitter,
    mockLeaderToolService,
    mockToolFacade,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Common fixtures
// ──────────────────────────────────────────────────────────────────────────────

const mockTopic = {
  id: "topic-001",
  name: "AI Chip Market",
  type: "technology",
  description: "AI chip analysis",
  language: "zh",
  dimensions: [],
  topicConfig: null,
};

const mockModel = {
  id: "gpt-reasoning",
  name: "GPT Reasoning",
  provider: "openai",
  isReasoning: true,
  isAvailable: true,
};

const mockChatModel = {
  id: "gpt-4",
  name: "GPT-4",
  provider: "openai",
  isReasoning: false,
  isAvailable: true,
};

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("ResearchLeaderService", () => {
  let service: ResearchLeaderService;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    mocks = buildMocks();
    const {
      mockPrisma,
      mockFacade,
      mockEventEmitter,
      mockLeaderToolService,
      mockToolFacade,
    } = mocks;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchLeaderService,
        LeaderPlanningService,
        LeaderIntentService,
        LeaderAgentSelectionService,
        LeaderReviewService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockFacade },
        { provide: AgentFacade, useValue: mockFacade },
        { provide: ToolFacade, useValue: mockToolFacade },
        { provide: ResearchEventEmitterService, useValue: mockEventEmitter },
        { provide: LeaderToolService, useValue: mockLeaderToolService },
      ],
    }).compile();

    service = module.get<ResearchLeaderService>(ResearchLeaderService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== getReasoningModel ====================

  describe("getReasoningModel", () => {
    it("should return model info when facade provides a reasoning model", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([
        mockModel,
      ]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockModel);

      const result = await service.getReasoningModel();

      expect(result).not.toBeNull();
      expect(result?.modelId).toBe("gpt-reasoning");
      expect(result?.provider).toBe("openai");
      expect(result?.isReasoning).toBe(true);
    });

    it("should return null when facade returns null model", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(null);

      const result = await service.getReasoningModel();

      expect(result).toBeNull();
    });

    it("should return model with isReasoning false when no reasoning model available", async () => {
      const chatOnlyModel = { ...mockModel, isReasoning: false };
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([
        chatOnlyModel,
      ]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(chatOnlyModel);

      const result = await service.getReasoningModel();

      expect(result).not.toBeNull();
      expect(result?.isReasoning).toBe(false);
    });

    it("should handle undefined isReasoning from facade and default to false", async () => {
      const modelNoReasoning = { ...mockModel, isReasoning: undefined };
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([
        modelNoReasoning,
      ]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(modelNoReasoning);

      const result = await service.getReasoningModel();

      expect(result?.isReasoning).toBe(false);
    });
  });

  // ==================== planResearch ====================

  describe("planResearch", () => {
    function setupBasicPlanResearch(
      plan: Record<string, unknown> = { dimensions: [], agentAssignments: [] },
    ) {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([
        mockChatModel,
      ]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockModel);
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify(plan),
      });
    }

    it("should throw when topic is not found", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await expect(service.planResearch("nonexistent-topic")).rejects.toThrow(
        "not found",
      );
    });

    it("should throw when no reasoning model is available", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(null);

      await expect(service.planResearch("topic-001")).rejects.toThrow(
        "No reasoning model available",
      );
    });

    it("should return a plan on happy path", async () => {
      const plan = {
        dimensions: [{ id: "dim-1", name: "Market" }],
        agentAssignments: [],
      };
      setupBasicPlanResearch(plan);

      const result = await service.planResearch("topic-001");

      expect(result.dimensions).toHaveLength(1);
      expect(mocks.mockFacade.chat).toHaveBeenCalled();
    });

    it("should throw when AI returns empty response", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockModel);
      mocks.mockFacade.chat.mockResolvedValue({ content: "" });

      await expect(service.planResearch("topic-001")).rejects.toThrow(
        "AI 返回空响应",
      );
    });

    it("should throw when AI response cannot be parsed", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockModel);
      mocks.mockFacade.chat.mockResolvedValue({
        content: "not json at all",
      });

      await expect(service.planResearch("topic-001")).rejects.toThrow(
        "无法解析",
      );
    });

    it("should auto-assign skills to dimension_researcher agents missing skills", async () => {
      const plan = {
        dimensions: [{ id: "dim-1", name: "市场趋势" }],
        agentAssignments: [
          {
            agentId: "agent-1",
            agentName: "研究员1",
            agentType: "dimension_researcher",
            assignedDimensions: ["dim-1"],
            modelId: "gpt-4",
            skills: [],
            tools: [],
          },
        ],
      };
      setupBasicPlanResearch(plan);

      const result = await service.planResearch("topic-001");

      const assignment = result.agentAssignments?.[0];
      expect(assignment?.skills).toBeDefined();
      expect(assignment?.skills?.length).toBeGreaterThan(0);
      expect(assignment?.tools).toContain("web-search");
    });

    it("should auto-assign model to agents with no modelId using round-robin", async () => {
      const plan = {
        dimensions: [],
        agentAssignments: [
          {
            agentId: "agent-1",
            agentType: "dimension_researcher",
            assignedDimensions: [],
            modelId: null,
            skills: ["deep-dive"],
            tools: ["web-search"],
          },
        ],
      };
      setupBasicPlanResearch(plan);

      const result = await service.planResearch("topic-001");

      const assignment = result.agentAssignments?.[0];
      expect(assignment?.modelId).toBe("gpt-4");
    });

    it("should filter out unavailable models", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([
        { ...mockChatModel, isAvailable: false },
        mockModel,
      ]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockModel);
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({ dimensions: [], agentAssignments: [] }),
      });

      const result = await service.planResearch("topic-001");

      expect(result).toBeDefined();
    });

    it("should wrap AI call error in a descriptive message", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockModel);
      mocks.mockFacade.chat.mockRejectedValue(
        new Error("API connection timeout"),
      );

      await expect(service.planResearch("topic-001")).rejects.toThrow(
        "AI 调用失败",
      );
    });

    it("should include userPrompt in plan research call", async () => {
      const plan = { dimensions: [], agentAssignments: [] };
      setupBasicPlanResearch(plan);

      await service.planResearch("topic-001", "Focus on technology trends");

      const callArgs = mocks.mockFacade.chat.mock.calls[0][0];
      const userMsg = callArgs.messages.find(
        (m: { role: string }) => m.role === "user",
      );
      expect(userMsg?.content).toBeDefined();
    });
  });

  // ==================== reviewTaskResult ====================

  describe("reviewTaskResult", () => {
    function setupReviewModel() {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockModel);
      mocks.mockPrisma.leaderDecision.create.mockResolvedValue({});
    }

    it("should return approved when AI returns approved status", async () => {
      setupReviewModel();
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          status: "approved",
          feedback: "Good quality research",
        }),
      });

      const result = await service.reviewTaskResult(
        "mission-001",
        "task-001",
        "research result",
        "Market Analysis",
      );

      expect(result.status).toBe("approved");
      expect(result.feedback).toBe("Good quality research");
    });

    it("should return needs_revision with revision instructions", async () => {
      setupReviewModel();
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          status: "needs_revision",
          feedback: "Incomplete analysis",
          suggestions: ["Add more data points"],
          revisionInstructions: "Please add 5 more references",
        }),
      });

      const result = await service.reviewTaskResult(
        "mission-001",
        "task-001",
        "partial result",
      );

      expect(result.status).toBe("needs_revision");
      expect(result.revisionInstructions).toBe("Please add 5 more references");
      expect(result.suggestions).toContain("Add more data points");
    });

    it("should default to approved when AI response cannot be parsed", async () => {
      setupReviewModel();
      mocks.mockFacade.chat.mockResolvedValue({
        content: "Not valid JSON",
      });

      const result = await service.reviewTaskResult(
        "mission-001",
        "task-001",
        "result",
      );

      expect(result.status).toBe("approved");
    });

    it("should throw when no reasoning model available", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(null);

      await expect(
        service.reviewTaskResult("mission-001", "task-001", "result"),
      ).rejects.toThrow("No reasoning model available");
    });

    it("should record decision after review", async () => {
      setupReviewModel();
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({ status: "approved", feedback: "OK" }),
      });

      await service.reviewTaskResult("mission-001", "task-001", "result");

      expect(mocks.mockPrisma.leaderDecision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            missionId: "mission-001",
          }),
        }),
      );
    });

    it("should pass string result directly to AI prompt", async () => {
      setupReviewModel();
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({ status: "approved" }),
      });

      await service.reviewTaskResult(
        "mission-001",
        "task-001",
        "plain string result",
      );

      const callArgs = mocks.mockFacade.chat.mock.calls[0][0];
      const userMsg = callArgs.messages.find(
        (m: { role: string }) => m.role === "user",
      );
      expect(userMsg?.content).toContain("plain string result");
    });

    it("should work with dimensionName undefined", async () => {
      setupReviewModel();
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({ status: "approved" }),
      });

      const result = await service.reviewTaskResult("mission-001", "task-001", {
        key: "value",
      });

      expect(result.taskId).toBe("task-001");
    });
  });

  // ==================== handleUserMessage ====================

  describe("handleUserMessage", () => {
    const mockMission = {
      id: "mission-001",
      status: "RUNNING",
      topic: {
        name: "AI Research",
        dimensions: [{ name: "Market", status: "COMPLETED" }],
      },
      tasks: [
        {
          id: "task-1",
          status: "COMPLETED",
          dimensionName: "Market",
          title: "Research market",
        },
        {
          id: "task-2",
          status: "EXECUTING",
          dimensionName: "Tech",
          title: "Research tech",
        },
      ],
    };

    function setupUserMessageHandling() {
      mocks.mockFacade.intentDetector.detectIntent.mockReturnValue({
        intent: "UNKNOWN",
        confidence: 0.1,
      });
      mocks.mockPrisma.researchMission = {
        findUnique: jest.fn().mockResolvedValue(mockMission),
        update: jest.fn(),
      };
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockModel);
    }

    it("should return fallback response when AI returns unparseable content", async () => {
      setupUserMessageHandling();
      mocks.mockFacade.chat.mockResolvedValue({
        content: "no json here",
      });

      const result = await service.handleUserMessage(
        "topic-001",
        "mission-001",
        "hello",
      );

      expect(result.response).toBeDefined();
      expect(typeof result.response).toBe("string");
    });

    it("should execute DELETE_DIMENSION action", async () => {
      setupUserMessageHandling();
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "Deleted",
          actions: [
            {
              type: "DELETE_DIMENSION",
              params: { dimensionName: "Market" },
            },
          ],
        }),
      });
      mocks.mockLeaderToolService.deleteDimension.mockResolvedValue({
        success: true,
        action: "DELETE_DIMENSION",
        message: "Deleted",
      });

      const result = await service.handleUserMessage(
        "topic-001",
        "mission-001",
        "delete dimension",
      );

      expect(mocks.mockLeaderToolService.deleteDimension).toHaveBeenCalled();
      expect(result.actionResults?.[0]?.success).toBe(true);
    });

    it("should execute CANCEL_TASK action", async () => {
      setupUserMessageHandling();
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "Cancelled",
          actions: [
            {
              type: "CANCEL_TASK",
              params: { dimensionName: "Market" },
            },
          ],
        }),
      });
      mocks.mockLeaderToolService.cancelTask.mockResolvedValue({
        success: true,
        action: "CANCEL_TASK",
        message: "Cancelled",
      });

      const result = await service.handleUserMessage(
        "topic-001",
        "mission-001",
        "cancel task",
      );

      expect(mocks.mockLeaderToolService.cancelTask).toHaveBeenCalled();
      expect(result.actionResults?.[0]?.success).toBe(true);
    });

    it("should execute UPDATE_DIMENSION action", async () => {
      setupUserMessageHandling();
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "Updated",
          actions: [
            {
              type: "UPDATE_DIMENSION",
              params: {
                dimensionName: "Market",
                newName: "Market Analysis",
              },
            },
          ],
        }),
      });
      mocks.mockLeaderToolService.updateDimension.mockResolvedValue({
        success: true,
        action: "UPDATE_DIMENSION",
        message: "Updated",
      });

      const result = await service.handleUserMessage(
        "topic-001",
        "mission-001",
        "update dimension",
      );

      expect(mocks.mockLeaderToolService.updateDimension).toHaveBeenCalled();
      expect(result.actionResults?.[0]?.success).toBe(true);
    });

    it("should execute MERGE_DIMENSIONS action", async () => {
      setupUserMessageHandling();
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "Merged",
          actions: [
            {
              type: "MERGE_DIMENSIONS",
              params: {
                sourceDimensionNames: ["Market", "Competition"],
                targetDimensionName: "Market & Competition",
              },
            },
          ],
        }),
      });
      mocks.mockLeaderToolService.mergeDimensions.mockResolvedValue({
        success: true,
        action: "MERGE_DIMENSIONS",
        message: "Merged",
      });

      const result = await service.handleUserMessage(
        "topic-001",
        "mission-001",
        "merge dimensions",
      );

      expect(mocks.mockLeaderToolService.mergeDimensions).toHaveBeenCalled();
      expect(result.actionResults?.[0]?.success).toBe(true);
    });

    it("should execute NO_ACTION and return response", async () => {
      setupUserMessageHandling();
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "No action needed",
          actions: [{ type: "NO_ACTION" }],
        }),
      });

      const result = await service.handleUserMessage(
        "topic-001",
        "mission-001",
        "just checking",
      );

      expect(result.actionResults?.[0]?.success).toBe(true);
      expect(result.actionResults?.[0]?.message).toBe("无需执行动作");
    });

    it("should handle unknown action type gracefully", async () => {
      setupUserMessageHandling();
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "Processing",
          actions: [
            {
              type: "UNKNOWN_ACTION",
              params: {},
            },
          ],
        }),
      });

      const result = await service.handleUserMessage(
        "topic-001",
        "mission-001",
        "do something",
      );

      expect(result.actionResults?.[0]?.success).toBe(false);
      expect(result.actionResults?.[0]?.message).toContain("未知的动作类型");
    });

    it("should throw when mission not found", async () => {
      mocks.mockFacade.intentDetector.detectIntent.mockReturnValue({
        intent: "UNKNOWN",
        confidence: 0.1,
      });
      mocks.mockPrisma.researchMission = {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      };

      await expect(
        service.handleUserMessage("topic-001", "missing-mission", "hello"),
      ).rejects.toThrow("not found");
    });

    it("should append error notice to response when actions fail", async () => {
      setupUserMessageHandling();
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "Processing",
          actions: [
            {
              type: "DELETE_DIMENSION",
              params: { dimensionName: "NonExistent" },
            },
          ],
        }),
      });
      mocks.mockLeaderToolService.deleteDimension.mockResolvedValue({
        success: false,
        action: "DELETE_DIMENSION",
        message: "Dimension not found",
      });

      const result = await service.handleUserMessage(
        "topic-001",
        "mission-001",
        "delete dimension",
      );

      expect(result.response).toContain("部分操作未成功");
      expect(result.response).toContain("Dimension not found");
    });

    it("should use quick response for CONTINUE intent with high confidence", async () => {
      const { UserIntent } = jest.requireActual("@/modules/ai-harness/facade");

      mocks.mockFacade.intentDetector.detectIntent.mockReturnValue({
        intent: UserIntent?.CONTINUE ?? "CONTINUE",
        confidence: 0.9,
      });
      mocks.mockPrisma.researchMission = {
        findUnique: jest.fn().mockResolvedValue(mockMission),
        update: jest.fn(),
      };
      mocks.mockPrisma.leaderDecision = { create: jest.fn() };

      const result = await service.handleUserMessage(
        "topic-001",
        "mission-001",
        "继续",
      );

      expect(result.response).toContain("继续推进");
      expect(mocks.mockFacade.chat).not.toHaveBeenCalled();
    });

    it("should use quick response for SUMMARIZE intent when progress < 50", async () => {
      const { UserIntent } = jest.requireActual("@/modules/ai-harness/facade");

      mocks.mockFacade.intentDetector.detectIntent.mockReturnValue({
        intent: UserIntent?.SUMMARIZE ?? "SUMMARIZE",
        confidence: 0.9,
      });
      // Only 1 of 4 tasks completed → progress = 25%
      mocks.mockPrisma.researchMission = {
        findUnique: jest.fn().mockResolvedValue({
          ...mockMission,
          tasks: [
            { id: "t1", status: "COMPLETED", dimensionName: "A", title: "A" },
            { id: "t2", status: "PENDING", dimensionName: "B", title: "B" },
            { id: "t3", status: "PENDING", dimensionName: "C", title: "C" },
            { id: "t4", status: "PENDING", dimensionName: "D", title: "D" },
          ],
        }),
        update: jest.fn(),
      };
      mocks.mockPrisma.leaderDecision = { create: jest.fn() };

      const result = await service.handleUserMessage(
        "topic-001",
        "mission-001",
        "总结",
      );

      expect(result.response).toContain("25%");
      expect(mocks.mockFacade.chat).not.toHaveBeenCalled();
    });

    it("should fall through to AI for SUMMARIZE when progress >= 50", async () => {
      const { UserIntent } = jest.requireActual("@/modules/ai-harness/facade");

      mocks.mockFacade.intentDetector.detectIntent.mockReturnValue({
        intent: UserIntent?.SUMMARIZE ?? "SUMMARIZE",
        confidence: 0.9,
      });
      // 2 of 2 completed → progress 100%
      mocks.mockPrisma.researchMission = {
        findUnique: jest.fn().mockResolvedValue({
          ...mockMission,
          tasks: [
            {
              id: "t1",
              status: "COMPLETED",
              dimensionName: "A",
              title: "A",
            },
            {
              id: "t2",
              status: "COMPLETED",
              dimensionName: "B",
              title: "B",
            },
          ],
        }),
        update: jest.fn(),
      };
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockModel);
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({ response: "AI summary" }),
      });
      mocks.mockPrisma.leaderDecision = { create: jest.fn() };

      const result = await service.handleUserMessage(
        "topic-001",
        "mission-001",
        "总结",
      );

      expect(mocks.mockFacade.chat).toHaveBeenCalled();
      expect(result.response).toBeDefined();
    });
  });

  // ==================== selectAgentForTask ====================

  describe("selectAgentForTask", () => {
    it("should select existing agent with lowest workload", async () => {
      mocks.mockPrisma.researchMission = {
        findUnique: jest.fn().mockResolvedValue({
          id: "mission-001",
          tasks: [
            {
              assignedAgent: "agent-1",
              assignedAgentType: "dimension_researcher",
              modelId: "gpt-4",
              status: "COMPLETED",
            },
            {
              assignedAgent: "agent-1",
              assignedAgentType: "dimension_researcher",
              modelId: "gpt-4",
              status: "COMPLETED",
            },
            {
              assignedAgent: "agent-2",
              assignedAgentType: "dimension_researcher",
              modelId: "gpt-3",
              status: "COMPLETED",
            },
          ],
        }),
        update: jest.fn(),
      };
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([
        mockChatModel,
      ]);
      mocks.mockPrisma.leaderDecision = { create: jest.fn() };

      const result = await service.selectAgentForTask(
        "topic-001",
        "mission-001",
        "Market research",
      );

      // agent-2 has load 1, agent-1 has load 2 → select agent-2
      expect(result.agentId).toBe("agent-2");
    });

    it("should create a new agent when no existing agents found", async () => {
      mocks.mockPrisma.researchMission = {
        findUnique: jest.fn().mockResolvedValue({
          id: "mission-001",
          tasks: [],
        }),
        update: jest.fn(),
      };
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([
        mockChatModel,
      ]);
      mocks.mockPrisma.leaderDecision = { create: jest.fn() };

      const result = await service.selectAgentForTask(
        "topic-001",
        "mission-001",
        "New research task",
      );

      expect(result.agentId).toContain("researcher_user_");
      expect(result.agentType).toBe("dimension_researcher");
    });

    it("should create new agent with default model when no models available", async () => {
      mocks.mockPrisma.researchMission = {
        findUnique: jest.fn().mockResolvedValue({
          id: "mission-001",
          tasks: [],
        }),
        update: jest.fn(),
      };
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockPrisma.leaderDecision = { create: jest.fn() };

      const result = await service.selectAgentForTask(
        "topic-001",
        "mission-001",
        "Research",
      );

      expect(result.modelId).toBe("");
    });

    it("should select skills and tools based on policy-related task title", async () => {
      mocks.mockPrisma.researchMission = {
        findUnique: jest.fn().mockResolvedValue({
          id: "mission-001",
          tasks: [],
        }),
        update: jest.fn(),
      };
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([
        mockChatModel,
      ]);
      mocks.mockPrisma.leaderDecision = { create: jest.fn() };

      const result = await service.selectAgentForTask(
        "topic-001",
        "mission-001",
        "AI Policy Regulation Analysis",
        "Analysis of federal regulatory frameworks",
      );

      // policy keywords → policy skills
      expect(
        result.skills.some(
          (s) =>
            s.includes("policy") ||
            s.includes("regulatory") ||
            s === "critical-thinking",
        ),
      ).toBe(true);
    });

    it("should select market skills for market-related tasks", async () => {
      mocks.mockPrisma.researchMission = {
        findUnique: jest.fn().mockResolvedValue({
          id: "mission-001",
          tasks: [],
        }),
        update: jest.fn(),
      };
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([
        mockChatModel,
      ]);
      mocks.mockPrisma.leaderDecision = { create: jest.fn() };

      const result = await service.selectAgentForTask(
        "topic-001",
        "mission-001",
        "Market competition analysis",
        "Analyze market share and competition",
      );

      expect(result.skills).toContain("competitive-analysis");
      expect(result.tools).toContain("web-search");
    });

    it("should use default skills when no keywords match", async () => {
      mocks.mockPrisma.researchMission = {
        findUnique: jest.fn().mockResolvedValue({
          id: "mission-001",
          tasks: [],
        }),
        update: jest.fn(),
      };
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([
        mockChatModel,
      ]);
      mocks.mockPrisma.leaderDecision = { create: jest.fn() };

      const result = await service.selectAgentForTask(
        "topic-001",
        "mission-001",
        "Something completely generic",
        "No matching keywords here at all",
      );

      // Default skills
      expect(result.skills).toContain("deep-dive");
      expect(result.skills).toContain("synthesis");
      expect(result.tools).toContain("web-search");
    });
  });

  // ==================== getDecisionHistory ====================

  describe("getDecisionHistory", () => {
    it("should return decision history ordered by createdAt desc", async () => {
      const decisions = [
        { id: "d1", type: "PLAN", createdAt: new Date() },
        { id: "d2", type: "REVIEW", createdAt: new Date() },
      ];
      mocks.mockPrisma.leaderDecision = {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue(decisions),
      };

      const result = await service.getDecisionHistory("mission-001");

      expect(result).toHaveLength(2);
      expect(mocks.mockPrisma.leaderDecision.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { missionId: "mission-001" },
          orderBy: { createdAt: "desc" },
        }),
      );
    });

    it("should return empty array when no decisions exist", async () => {
      mocks.mockPrisma.leaderDecision = {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      };

      const result = await service.getDecisionHistory("mission-001");

      expect(result).toEqual([]);
    });
  });

  // ==================== extractClaims ====================

  describe("extractClaims", () => {
    it("should return claims when AI returns valid claims JSON", async () => {
      const mockClaims = [
        {
          id: "claim-1",
          statement: "AI market will grow 30%",
          sectionId: "section-001",
          sourceEvidenceIndices: [1, 2],
          importance: "high",
        },
      ];
      mocks.mockFacade.chatStructured = jest.fn().mockResolvedValue({
        data: { claims: mockClaims },
        rawContent: "",
      });

      const result = await service.extractClaims(
        "section-001",
        "AI market analysis content",
      );

      expect(result).toHaveLength(1);
      expect(result[0].statement).toBe("AI market will grow 30%");
    });

    it("should return empty array when chatStructured returns null data", async () => {
      mocks.mockFacade.chatStructured = jest.fn().mockResolvedValue({
        data: null,
        rawContent: "some content",
      });

      const result = await service.extractClaims("section-001", "some content");

      expect(result).toEqual([]);
    });

    it("should return empty array when AI call throws", async () => {
      mocks.mockFacade.chatStructured = jest
        .fn()
        .mockRejectedValue(new Error("AI service down"));

      const result = await service.extractClaims("section-001", "content");

      expect(result).toEqual([]);
    });

    it("should truncate very long section content to 4000 chars", async () => {
      const longContent = "A".repeat(5000);
      mocks.mockFacade.chatStructured = jest.fn().mockResolvedValue({
        data: { claims: [] },
      });

      await service.extractClaims("section-001", longContent);

      const callArgs = mocks.mockFacade.chatStructured.mock.calls[0][0];
      const userMsg = callArgs.messages[0];
      // Content should be truncated in the prompt
      expect(userMsg.content.length).toBeLessThan(5000 + 200);
    });

    it("should return empty array when response has no claims key", async () => {
      mocks.mockFacade.chatStructured = jest.fn().mockResolvedValue({
        data: { other: "value" },
      });

      const result = await service.extractClaims("section-001", "content");

      expect(result).toEqual([]);
    });
  });

  // ==================== verifyHypotheses ====================

  describe("verifyHypotheses", () => {
    it("should return empty array when hypotheses list is empty", async () => {
      const result = await service.verifyHypotheses([], "evidence");
      expect(result).toEqual([]);
      expect(mocks.mockFacade.chatStructured).not.toHaveBeenCalled();
    });

    it("should return verification results when AI returns valid JSON", async () => {
      const mockResults = [
        {
          hypothesisId: "h1",
          status: "supported",
          supportingEvidence: "Strong market growth data",
          contradictingEvidence: "",
          confidence: 0.9,
          refinedStatement: "AI market will grow",
        },
      ];
      mocks.mockFacade.chatStructured = jest.fn().mockResolvedValue({
        data: { results: mockResults },
      });

      const result = await service.verifyHypotheses(
        [{ id: "h1", statement: "AI will grow" } as any],
        "evidence summary",
      );

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("supported");
    });

    it("should return empty array when chatStructured returns null data", async () => {
      mocks.mockFacade.chatStructured = jest.fn().mockResolvedValue({
        data: null,
      });

      const result = await service.verifyHypotheses(
        [{ id: "h1", statement: "test" } as any],
        "evidence",
      );

      expect(result).toEqual([]);
    });

    it("should return empty array when AI call throws", async () => {
      mocks.mockFacade.chatStructured = jest
        .fn()
        .mockRejectedValue(new Error("AI failed"));

      const result = await service.verifyHypotheses(
        [{ id: "h1", statement: "test" } as any],
        "evidence",
      );

      expect(result).toEqual([]);
    });

    it("should return empty array when response has no results key", async () => {
      mocks.mockFacade.chatStructured = jest.fn().mockResolvedValue({
        data: { other: [] },
      });

      const result = await service.verifyHypotheses(
        [{ id: "h1", statement: "test" } as any],
        "evidence",
      );

      expect(result).toEqual([]);
    });
  });

  // ==================== handleUserMessage - fallback delete mechanism ====================

  describe("handleUserMessage - fallback delete mechanism", () => {
    const mockMissionForDelete = {
      id: "mission-001",
      status: "RUNNING",
      topic: {
        name: "AI Research",
        dimensions: [{ name: "市场分析", status: "COMPLETED" }],
      },
      tasks: [
        {
          id: "t1",
          status: "COMPLETED",
          dimensionName: "市场分析",
          title: "Market",
        },
      ],
    };

    it("should trigger fallback delete when AI omits DELETE_DIMENSION but user message has delete intent", async () => {
      mocks.mockFacade.intentDetector.detectIntent.mockReturnValue({
        intent: "UNKNOWN",
        confidence: 0.1,
      });
      mocks.mockPrisma.researchMission = {
        findUnique: jest.fn().mockResolvedValue(mockMissionForDelete),
        update: jest.fn(),
      };
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockModel);
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "处理中",
          actions: [], // AI forgot to include DELETE_DIMENSION
        }),
      });
      mocks.mockLeaderToolService.deleteDimension.mockResolvedValue({
        success: true,
        action: "DELETE_DIMENSION",
        message: "已删除维度「市场分析」",
      });
      mocks.mockPrisma.leaderDecision = { create: jest.fn() };

      const result = await service.handleUserMessage(
        "topic-001",
        "mission-001",
        "删除维度：市场分析",
      );

      expect(mocks.mockLeaderToolService.deleteDimension).toHaveBeenCalledWith(
        expect.objectContaining({ dimensionName: "市场分析" }),
      );
      expect(result.response).toContain("已删除");
    });

    it("should not trigger fallback delete when AI already produced DELETE_DIMENSION action", async () => {
      mocks.mockFacade.intentDetector.detectIntent.mockReturnValue({
        intent: "UNKNOWN",
        confidence: 0.1,
      });
      mocks.mockPrisma.researchMission = {
        findUnique: jest.fn().mockResolvedValue(mockMissionForDelete),
        update: jest.fn(),
      };
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockModel);
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "Deleted",
          actions: [
            {
              type: "DELETE_DIMENSION",
              params: { dimensionName: "市场分析" },
            },
          ],
        }),
      });
      mocks.mockLeaderToolService.deleteDimension.mockResolvedValue({
        success: true,
        action: "DELETE_DIMENSION",
        message: "Deleted",
      });
      mocks.mockPrisma.leaderDecision = { create: jest.fn() };

      await service.handleUserMessage(
        "topic-001",
        "mission-001",
        "删除维度：市场分析",
      );

      // Should call deleteDimension exactly once (from the action, not the fallback)
      expect(mocks.mockLeaderToolService.deleteDimension).toHaveBeenCalledTimes(
        1,
      );
    });

    it("should handle action execution error gracefully and add to actionResults", async () => {
      mocks.mockFacade.intentDetector.detectIntent.mockReturnValue({
        intent: "UNKNOWN",
        confidence: 0.1,
      });
      mocks.mockPrisma.researchMission = {
        findUnique: jest.fn().mockResolvedValue(mockMissionForDelete),
        update: jest.fn(),
      };
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockModel);
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          response: "Processing",
          actions: [
            {
              type: "CREATE_DIMENSION",
              params: { name: "New Dim" },
            },
          ],
        }),
      });
      mocks.mockLeaderToolService.createDimension.mockRejectedValue(
        new Error("DB Error"),
      );
      mocks.mockPrisma.leaderDecision = { create: jest.fn() };

      const result = await service.handleUserMessage(
        "topic-001",
        "mission-001",
        "create dimension",
      );

      const failedAction = result.actionResults?.find((r) => !r.success);
      expect(failedAction).toBeDefined();
      expect(failedAction?.message).toContain("执行失败");
    });
  });

  // ==================== planResearch - quality_reviewer and report_writer assignment ====================

  describe("planResearch - quality_reviewer and report_writer assignment", () => {
    function setupPlanWithAgents(agentAssignments: Record<string, unknown>[]) {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([
        mockChatModel,
      ]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockModel);
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({ dimensions: [], agentAssignments }),
      });
    }

    it("should auto-assign skills to quality_reviewer agents missing skills", async () => {
      setupPlanWithAgents([
        {
          agentId: "reviewer-1",
          agentName: "质量审核员",
          agentType: "quality_reviewer",
          modelId: "gpt-4",
          skills: [],
          tools: [],
        },
      ]);

      const result = await service.planResearch("topic-001");
      const assignment = result.agentAssignments?.[0];

      expect(assignment?.skills).toContain("critical-thinking");
      expect(assignment?.skills).toContain("synthesis");
    });

    it("should auto-assign skills to report_writer agents missing skills", async () => {
      setupPlanWithAgents([
        {
          agentId: "writer-1",
          agentName: "报告撰写员",
          agentType: "report_writer",
          modelId: "gpt-4",
          skills: [],
        },
      ]);

      const result = await service.planResearch("topic-001");
      const assignment = result.agentAssignments?.[0];

      expect(assignment?.skills).toContain("synthesis");
    });

    it("should auto-assign assignmentReason to researcher agents missing it", async () => {
      setupPlanWithAgents([
        {
          agentId: "agent-1",
          agentName: "研究员1",
          agentType: "dimension_researcher",
          assignedDimensions: [],
          modelId: "gpt-4",
          skills: ["deep-dive"],
          tools: ["web-search"],
          assignmentReason: null,
        },
      ]);

      const result = await service.planResearch("topic-001");
      const assignment = result.agentAssignments?.[0];

      expect(assignment?.assignmentReason).toBeDefined();
      expect(assignment?.assignmentReason?.agentReason).toBeDefined();
    });

    it("should handle topic with no existing dimensions", async () => {
      setupPlanWithAgents([]);

      const result = await service.planResearch("topic-001");

      expect(result).toBeDefined();
      expect(result.agentAssignments).toHaveLength(0);
    });
  });
});
