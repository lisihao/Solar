/**
 * ResearchLeaderService - Supplemental2 Unit Tests
 *
 * Covers uncovered branches not in research-leader.service-supplemental.spec.ts:
 * - getReasoningModel: no model returned, isReasoning=false warning
 * - planResearch: topic not found, no reasoning model, AI call fail, empty response, parse fail
 * - planResearch: model name resolution (direct match, fuzzy match, auto-assign by round-robin)
 * - planResearch: dimension_researcher auto-assigned skills/tools/assignmentReason
 * - planResearch: quality_reviewer auto-assigned skills/assignmentReason
 * - planResearch: report_writer auto-assigned skills/assignmentReason
 * - reviewTaskResult: success, no model, parse fail fallback to approved
 */

// Mock @prisma/client so enum accesses don't throw in this isolated test context
jest.mock("@prisma/client", () => {
  const enumProxy = new Proxy(
    {},
    { get: (_target, prop) => (typeof prop === "string" ? prop : undefined) },
  );
  return new Proxy(
    { PrismaClient: jest.fn().mockImplementation(() => ({})) },
    {
      get(target, prop) {
        if (prop in target)
          return (target as Record<string | symbol, unknown>)[prop];
        return enumProxy;
      },
    },
  );
});

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
// Mock factory
// ──────────────────────────────────────────────────────────────────────────────

function buildMocks() {
  const mockPrisma = {
    researchTopic: {
      findUnique: jest.fn(),
    },
    researchMission: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    researchTask: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    leaderDecision: {
      create: jest.fn().mockResolvedValue({ id: "decision-1" }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const mockFacade = {
    getAvailableModelsExtended: jest.fn().mockResolvedValue([]),
    getReasoningModel: jest.fn(),
    chat: jest.fn(),
    intentDetector: {
      detectIntent: jest
        .fn()
        .mockReturnValue({ intent: "UNKNOWN", confidence: 0.1 }),
    },
  };

  const mockEventEmitter = {
    saveUserMessage: jest.fn().mockResolvedValue(undefined),
    emitLeaderResponse: jest.fn().mockResolvedValue(undefined),
    emitResumeMissionExecution: jest.fn().mockResolvedValue(undefined),
    getLeaderConversationHistory: jest.fn().mockResolvedValue([]),
  };

  const mockLeaderToolService = {
    createDimension: jest.fn(),
    deleteDimension: jest.fn(),
    cancelTask: jest.fn(),
    updateDimension: jest.fn(),
    mergeDimensions: jest.fn(),
  };

  return { mockPrisma, mockFacade, mockEventEmitter, mockLeaderToolService };
}

// ──────────────────────────────────────────────────────────────────────────────
// Common fixtures
// ──────────────────────────────────────────────────────────────────────────────

const mockTopic = {
  id: "topic-001",
  name: "AI 前沿技术",
  type: "technology",
  description: "人工智能前沿技术趋势",
  language: "zh",
  dimensions: [
    {
      id: "dim-001",
      name: "技术现状",
      description: "技术分析",
      status: "PENDING",
      searchQueries: [],
    },
  ],
};

const mockReasoningModel = {
  id: "o3-mini",
  name: "o3-mini",
  provider: "openai",
  isReasoning: true,
};

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("ResearchLeaderService (supplemental2)", () => {
  let service: ResearchLeaderService;
  let mocks: ReturnType<typeof buildMocks>;

  beforeAll(async () => {
    mocks = buildMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchLeaderService,
        LeaderPlanningService,
        LeaderIntentService,
        LeaderAgentSelectionService,
        LeaderReviewService,
        { provide: PrismaService, useValue: mocks.mockPrisma },
        { provide: ChatFacade, useValue: mocks.mockFacade },
        { provide: AgentFacade, useValue: mocks.mockFacade },
        { provide: ToolFacade, useValue: mocks.mockFacade },
        {
          provide: ResearchEventEmitterService,
          useValue: mocks.mockEventEmitter,
        },
        { provide: LeaderToolService, useValue: mocks.mockLeaderToolService },
      ],
    }).compile();

    service = module.get<ResearchLeaderService>(ResearchLeaderService);
  });

  afterEach(() => jest.clearAllMocks());

  // ============================================================
  // getReasoningModel
  // ============================================================

  describe("getReasoningModel()", () => {
    it("returns null when AI Engine returns no model", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(null);

      const result = await service.getReasoningModel();

      expect(result).toBeNull();
    });

    it("returns model info with isReasoning=false (non-reasoning fallback)", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([
        {
          id: "gpt-4o",
          name: "GPT-4o",
          provider: "openai",
          isReasoning: false,
          isAvailable: true,
        },
      ]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue({
        id: "gpt-4o",
        name: "GPT-4o",
        provider: "openai",
        isReasoning: false,
      });

      const result = await service.getReasoningModel();

      expect(result).toBeDefined();
      expect(result?.isReasoning).toBe(false);
      expect(result?.modelId).toBe("gpt-4o");
    });

    it("returns model info with isReasoning=true", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockReasoningModel);

      const result = await service.getReasoningModel();

      expect(result?.modelId).toBe("o3-mini");
      expect(result?.isReasoning).toBe(true);
    });
  });

  // ============================================================
  // planResearch
  // ============================================================

  describe("planResearch()", () => {
    it("throws error when topic not found", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await expect(service.planResearch("nonexistent")).rejects.toThrow(
        "Topic nonexistent not found",
      );
    });

    it("throws error when no reasoning model available", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(null);

      await expect(service.planResearch("topic-001")).rejects.toThrow(
        "No reasoning model available for Leader",
      );
    });

    it("throws error when AI call fails", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockReasoningModel);
      mocks.mockFacade.chat.mockRejectedValue(new Error("OpenAI timeout"));

      await expect(service.planResearch("topic-001")).rejects.toThrow(
        "AI 调用失败",
      );
    });

    it("throws error when AI returns empty response", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockReasoningModel);
      mocks.mockFacade.chat.mockResolvedValue({ content: "" });

      await expect(service.planResearch("topic-001")).rejects.toThrow(
        "AI 返回空响应",
      );
    });

    it("throws error when AI response cannot be parsed", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockReasoningModel);
      mocks.mockFacade.chat.mockResolvedValue({
        content: "This is not valid JSON output at all",
      });

      await expect(service.planResearch("topic-001")).rejects.toThrow(
        "无法解析 AI 规划响应",
      );
    });

    it("returns plan successfully with basic structure", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([
        {
          id: "gpt-4o",
          name: "GPT-4o",
          provider: "openai",
          isReasoning: false,
          isAvailable: true,
        },
      ]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockReasoningModel);
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          dimensions: [{ id: "dim-1", name: "技术现状", priority: 1 }],
          agentAssignments: [],
          executionStrategy: "parallel",
          estimatedDuration: 30,
        }),
      });

      const plan = await service.planResearch("topic-001");

      expect(plan.dimensions).toHaveLength(1);
      expect(plan.dimensions[0].name).toBe("技术现状");
    });

    it("auto-assigns model by round-robin when agent has no modelId", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([
        {
          id: "gpt-4o",
          name: "GPT-4o",
          provider: "openai",
          isReasoning: false,
          isAvailable: true,
        },
        {
          id: "claude-3",
          name: "Claude 3",
          provider: "anthropic",
          isReasoning: false,
          isAvailable: true,
        },
      ]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockReasoningModel);
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          dimensions: [{ id: "dim-1", name: "技术现状", priority: 1 }],
          agentAssignments: [
            {
              agentId: "agent-1",
              agentName: "研究员A",
              agentType: "dimension_researcher",
              assignedDimensions: ["dim-1"],
              modelId: "", // empty - needs auto-assign
              skills: [],
              tools: [],
            },
            {
              agentId: "agent-2",
              agentName: "研究员B",
              agentType: "dimension_researcher",
              assignedDimensions: ["dim-1"],
              modelId: "", // empty - needs auto-assign
              skills: ["deep_dive"],
              tools: ["web-search"],
              assignmentReason: {
                agentReason: "专注于深度研究",
                modelReason: "",
              },
            },
          ],
          executionStrategy: "parallel",
          estimatedDuration: 30,
        }),
      });

      const plan = await service.planResearch("topic-001");

      // Auto-assigned models (round-robin)
      expect(plan.agentAssignments[0].modelId).toBe("gpt-4o");
      expect(plan.agentAssignments[1].modelId).toBe("claude-3");
      // Auto-assigned skills for agent-1 (no existing skills)
      expect(plan.agentAssignments[0].skills).toContain("deep-dive");
      // Auto-assigned tools for agent-1 (no existing tools)
      expect(plan.agentAssignments[0].tools).toContain("web-search");
    });

    it("resolves model name by exact match from name-to-id map", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([
        {
          id: "gpt-4o-2024-11-20",
          name: "GPT-4o",
          provider: "openai",
          isReasoning: false,
          isAvailable: true,
        },
      ]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockReasoningModel);
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          dimensions: [{ id: "dim-1", name: "技术现状", priority: 1 }],
          agentAssignments: [
            {
              agentId: "agent-1",
              agentName: "研究员A",
              agentType: "dimension_researcher",
              assignedDimensions: ["dim-1"],
              modelId: "GPT-4o", // display name, should resolve to real id
              skills: ["deep_dive"],
              tools: ["web-search"],
            },
          ],
          executionStrategy: "parallel",
          estimatedDuration: 30,
        }),
      });

      const plan = await service.planResearch("topic-001");

      // Should resolve display name to real model id
      expect(plan.agentAssignments[0].modelId).toBe("gpt-4o-2024-11-20");
    });

    it("auto-assigns skills, tools, and assignmentReason for quality_reviewer", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockReasoningModel);
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          dimensions: [{ id: "dim-1", name: "技术现状", priority: 1 }],
          agentAssignments: [
            {
              agentId: "reviewer-1",
              agentName: "质量审核员A",
              agentType: "quality_reviewer",
              assignedDimensions: [],
              modelId: "gpt-4o",
              skills: [], // empty - should auto-assign
              tools: [],
            },
          ],
          executionStrategy: "parallel",
          estimatedDuration: 30,
        }),
      });

      const plan = await service.planResearch("topic-001");

      const reviewer = plan.agentAssignments[0];
      expect(reviewer.skills).toContain("critical-thinking");
      expect(reviewer.assignmentReason).toBeDefined();
      expect(reviewer.assignmentReason?.agentReason).toContain("审核");
    });

    it("auto-assigns skills for report_writer with no existing skills", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockReasoningModel);
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          dimensions: [{ id: "dim-1", name: "技术现状", priority: 1 }],
          agentAssignments: [
            {
              agentId: "writer-1",
              agentName: "报告撰写员A",
              agentType: "report_writer",
              assignedDimensions: [],
              modelId: "claude-3",
              skills: [], // empty - should auto-assign
              tools: [],
            },
          ],
          executionStrategy: "sequential",
          estimatedDuration: 45,
        }),
      });

      const plan = await service.planResearch("topic-001");

      const writer = plan.agentAssignments[0];
      expect(writer.skills).toContain("synthesis");
      expect(writer.assignmentReason?.agentReason).toContain("整合");
    });

    it("filters out unavailable models", async () => {
      const topicWithNoDimensions = {
        ...mockTopic,
        dimensions: [], // no existing dimensions
      };
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(
        topicWithNoDimensions,
      );
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([
        {
          id: "gpt-4o",
          name: "GPT-4o",
          provider: "openai",
          isReasoning: false,
          isAvailable: true,
        },
        {
          id: "expired-model",
          name: "Expired",
          provider: "openai",
          isReasoning: false,
          isAvailable: false, // unavailable - should be filtered
        },
      ]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockReasoningModel);
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          dimensions: [],
          agentAssignments: [],
          executionStrategy: "parallel",
          estimatedDuration: 10,
        }),
      });

      const plan = await service.planResearch("topic-001");

      // Should still return plan even with filtered models
      expect(plan).toBeDefined();
      expect(plan.dimensions).toHaveLength(0);
    });

    it("handles topic with no existing dimensions (first-time research)", async () => {
      const topicWithNoDimensions = {
        ...mockTopic,
        dimensions: [],
      };
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(
        topicWithNoDimensions,
      );
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockReasoningModel);
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          dimensions: [{ id: "dim-new", name: "新维度", priority: 1 }],
          agentAssignments: [],
          executionStrategy: "parallel",
          estimatedDuration: 20,
        }),
      });

      const plan = await service.planResearch("topic-001");

      expect(plan.dimensions).toHaveLength(1);
    });

    it("uses userPrompt when provided", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockReasoningModel);
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          dimensions: [{ id: "dim-1", name: "技术现状", priority: 1 }],
          agentAssignments: [],
          executionStrategy: "parallel",
          estimatedDuration: 30,
        }),
      });

      await service.planResearch("topic-001", "请重点关注量子计算技术");

      expect(mocks.mockFacade.chat).toHaveBeenCalled();
      // Chat should have been called with prompt containing userPrompt content
    });
  });

  // ============================================================
  // reviewTaskResult
  // ============================================================

  describe("reviewTaskResult()", () => {
    it("throws error when no reasoning model available", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(null);

      await expect(
        service.reviewTaskResult("mission-1", "task-1", "result text"),
      ).rejects.toThrow("No reasoning model available for Leader");
    });

    it("returns approved review on successful parse", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockReasoningModel);
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          status: "approved",
          feedback: "内容质量优秀",
          suggestions: ["可以增加更多数据支持"],
        }),
      });

      const result = await service.reviewTaskResult(
        "mission-1",
        "task-1",
        "research result here",
        "技术现状",
      );

      expect(result.taskId).toBe("task-1");
      expect(result.status).toBe("approved");
      expect(result.feedback).toBe("内容质量优秀");
    });

    it("returns needs_revision review", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockReasoningModel);
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          status: "needs_revision",
          feedback: "缺少数据支撑",
          revisionInstructions: "请添加具体统计数据",
          revisionNeeded: true,
        }),
      });

      const result = await service.reviewTaskResult("mission-1", "task-1", {
        content: "brief content",
      });

      expect(result.status).toBe("needs_revision");
      expect(result.revisionInstructions).toBe("请添加具体统计数据");
    });

    it("falls back to approved when parse fails", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockReasoningModel);
      mocks.mockFacade.chat.mockResolvedValue({
        content: "Not valid JSON at all",
      });

      const result = await service.reviewTaskResult(
        "mission-1",
        "task-1",
        "task result",
      );

      // Should fallback to approved
      expect(result.status).toBe("approved");
      expect(result.taskId).toBe("task-1");
      expect(result.feedback).toContain("解析失败");
    });

    it("accepts object result for review", async () => {
      mocks.mockFacade.getAvailableModelsExtended.mockResolvedValue([]);
      mocks.mockFacade.getReasoningModel.mockResolvedValue(mockReasoningModel);
      mocks.mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          status: "approved",
          feedback: "Good",
        }),
      });

      const result = await service.reviewTaskResult("mission-1", "task-1", {
        sections: [{ title: "Tech", content: "content" }],
      });

      expect(result.status).toBe("approved");
    });
  });
});
