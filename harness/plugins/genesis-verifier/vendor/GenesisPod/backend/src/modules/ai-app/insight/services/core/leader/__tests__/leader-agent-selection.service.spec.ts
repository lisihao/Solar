/**
 * LeaderAgentSelectionService Unit Tests
 *
 * Coverage:
 * - selectAgentForTask: existing agents (picks min workload), no agents (creates new),
 *   keyword-based skill selection (policy/market/tech), default skills, DB recording
 */

import { Test, TestingModule } from "@nestjs/testing";
import { LeaderAgentSelectionService } from "../leader-agent-selection.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function buildMocks() {
  const mockPrisma = {
    researchMission: {
      findUnique: jest.fn(),
    },
    leaderDecision: {
      create: jest.fn().mockResolvedValue({}),
    },
  };

  const mockChatFacade = {
    getAvailableModelsExtended: jest.fn(),
  };

  return { mockPrisma, mockChatFacade };
}

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

const mockChatModel = {
  id: "gpt-4",
  name: "GPT-4",
  provider: "openai",
  isReasoning: false,
  isAvailable: true,
};

const mockReasoningModel = {
  id: "gpt-o1",
  name: "GPT o1",
  provider: "openai",
  isReasoning: true,
  isAvailable: true,
};

function buildMission(
  tasks: Array<{
    assignedAgent: string;
    modelId?: string | null;
    status: string;
  }>,
) {
  return {
    id: "mission-001",
    tasks: tasks.map((t) => ({
      assignedAgent: t.assignedAgent,
      assignedAgentType: "dimension_researcher",
      modelId: t.modelId ?? null,
      status: t.status,
    })),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("LeaderAgentSelectionService", () => {
  let service: LeaderAgentSelectionService;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    mocks = buildMocks();
    const { mockPrisma, mockChatFacade } = mocks;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderAgentSelectionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockChatFacade },
      ],
    }).compile();

    service = module.get<LeaderAgentSelectionService>(
      LeaderAgentSelectionService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== selectAgentForTask — agent workload ====================

  describe("selectAgentForTask — agent workload selection", () => {
    it("should select the existing agent with minimum workload", async () => {
      // researcher_1 has 3 tasks, researcher_2 has 1 task → pick researcher_2
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue(
        buildMission([
          { assignedAgent: "researcher_1", modelId: "gpt-4", status: "done" },
          { assignedAgent: "researcher_1", modelId: "gpt-4", status: "done" },
          { assignedAgent: "researcher_1", modelId: "gpt-4", status: "done" },
          {
            assignedAgent: "researcher_2",
            modelId: "gpt-4o",
            status: "running",
          },
        ]),
      );
      mocks.mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        mockChatModel,
      ]);

      const result = await service.selectAgentForTask(
        "topic-001",
        "mission-001",
        "任意任务标题",
      );

      expect(result.agentId).toBe("researcher_2");
      expect(result.modelId).toBe("gpt-4o");
      expect(result.agentType).toBe("dimension_researcher");
    });

    it("should reuse the single existing agent when only one exists", async () => {
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue(
        buildMission([
          {
            assignedAgent: "researcher_5",
            modelId: "claude-3",
            status: "done",
          },
        ]),
      );
      mocks.mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        mockChatModel,
      ]);

      const result = await service.selectAgentForTask(
        "topic-001",
        "mission-001",
        "研究任务",
      );

      expect(result.agentId).toBe("researcher_5");
      expect(result.modelId).toBe("claude-3");
    });

    it("should fall back to default model when existing agent has no modelId", async () => {
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue(
        buildMission([
          { assignedAgent: "researcher_3", modelId: null, status: "pending" },
        ]),
      );
      mocks.mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        mockChatModel,
      ]);

      const result = await service.selectAgentForTask(
        "topic-001",
        "mission-001",
        "任务",
      );

      expect(result.agentId).toBe("researcher_3");
      expect(result.modelId).toBe("gpt-4"); // falls back to first chat model
    });
  });

  // ==================== selectAgentForTask — no existing agents ====================

  describe("selectAgentForTask — no existing agents", () => {
    it("should create a new agent ID when mission has no tasks", async () => {
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue(
        buildMission([]),
      );
      mocks.mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        mockChatModel,
      ]);

      const result = await service.selectAgentForTask(
        "topic-001",
        "mission-001",
        "brand new task",
      );

      expect(result.agentId).toMatch(/^researcher_user_\d+$/);
      expect(result.modelId).toBe("gpt-4");
    });

    it("should create a new agent ID when mission is null", async () => {
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue(null);
      mocks.mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        mockChatModel,
      ]);

      const result = await service.selectAgentForTask(
        "topic-001",
        "mission-999",
        "some task",
      );

      expect(result.agentId).toMatch(/^researcher_user_\d+$/);
    });

    it("should use empty string as modelId when no models are available", async () => {
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue(
        buildMission([]),
      );
      mocks.mockChatFacade.getAvailableModelsExtended.mockResolvedValue([]);

      const result = await service.selectAgentForTask(
        "topic-001",
        "mission-001",
        "task without models",
      );

      expect(result.modelId).toBe("");
    });

    it("should filter out reasoning models and use only chat models", async () => {
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue(
        buildMission([]),
      );
      mocks.mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        mockReasoningModel,
        mockChatModel,
      ]);

      const result = await service.selectAgentForTask(
        "topic-001",
        "mission-001",
        "research task",
      );

      // Should use the chat model, not the reasoning model
      expect(result.modelId).toBe("gpt-4");
    });
  });

  // ==================== selectAgentForTask — skill selection ====================

  describe("selectAgentForTask — keyword-based skill selection", () => {
    beforeEach(() => {
      // No existing agents for skill tests
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue(
        buildMission([]),
      );
      mocks.mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        mockChatModel,
      ]);
    });

    it("should select fact-verification skills for policy-related tasks", async () => {
      const result = await service.selectAgentForTask(
        "topic-001",
        "mission-001",
        "AI 监管政策分析",
        "分析美国联邦政府的 AI 法规框架",
      );

      expect(result.skills).toContain("fact-verification");
      expect(result.tools).toEqual(
        expect.arrayContaining(["federal-register"]),
      );
    });

    it("should select trend-analysis skills for market-related tasks", async () => {
      const result = await service.selectAgentForTask(
        "topic-001",
        "mission-001",
        "AI 芯片市场竞争格局",
        "分析主要厂商市场份额",
      );

      expect(result.skills).toContain("trend-analysis");
      expect(result.tools).toContain("web-search");
    });

    it("should select deep-dive skills for technology-related tasks", async () => {
      const result = await service.selectAgentForTask(
        "topic-001",
        "mission-001",
        "大模型技术架构研究",
        "深入分析 Transformer 核心算法",
      );

      expect(result.skills).toContain("deep-dive");
      expect(result.tools).toContain("academic-search");
    });

    it("should select default skills when no keywords match", async () => {
      const result = await service.selectAgentForTask(
        "topic-001",
        "mission-001",
        "general overview",
        "a brief summary",
      );

      expect(result.skills).toEqual([
        "deep-dive",
        "synthesis",
        "data-interpretation",
      ]);
      expect(result.tools).toEqual(["web-search"]);
    });

    it("should deduplicate skills across multiple keyword matches", async () => {
      // "数据分析" matches both data keywords and potentially others
      const result = await service.selectAgentForTask(
        "topic-001",
        "mission-001",
        "市场数据分析趋势报告",
        "统计各项指标",
      );

      // skills array must not contain duplicates
      const uniqueSkills = [...new Set(result.skills)];
      expect(result.skills).toHaveLength(uniqueSkills.length);
    });

    it("should limit skills to maximum 5 entries", async () => {
      // Title with many keyword categories to trigger multiple skill sets
      const result = await service.selectAgentForTask(
        "topic-001",
        "mission-001",
        "AI政策市场技术数据战略综合分析",
        "评估利弊风险",
      );

      expect(result.skills.length).toBeLessThanOrEqual(5);
    });

    it("should limit tools to maximum 3 entries", async () => {
      const result = await service.selectAgentForTask(
        "topic-001",
        "mission-001",
        "AI政策市场技术数据战略综合分析",
        "评估利弊风险",
      );

      expect(result.tools.length).toBeLessThanOrEqual(3);
    });
  });

  // ==================== selectAgentForTask — DB recording ====================

  describe("selectAgentForTask — records decision to DB", () => {
    it("should record a ADJUST type leader decision after selection", async () => {
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue(
        buildMission([
          { assignedAgent: "researcher_1", modelId: "gpt-4", status: "done" },
        ]),
      );
      mocks.mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        mockChatModel,
      ]);

      await service.selectAgentForTask(
        "topic-001",
        "mission-001",
        "市场分析任务",
        "分析竞争格局",
      );

      expect(mocks.mockPrisma.leaderDecision.create).toHaveBeenCalledTimes(1);
      expect(mocks.mockPrisma.leaderDecision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            missionId: "mission-001",
          }),
        }),
      );
    });

    it("should not throw if DB recording fails", async () => {
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue(
        buildMission([]),
      );
      mocks.mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        mockChatModel,
      ]);
      mocks.mockPrisma.leaderDecision.create.mockRejectedValue(
        new Error("DB connection error"),
      );

      await expect(
        service.selectAgentForTask("topic-001", "mission-001", "任务"),
      ).resolves.toBeDefined();
    });
  });

  // ==================== selectAgentForTask — return shape ====================

  describe("selectAgentForTask — return shape", () => {
    it("should return correct AgentAssignment shape", async () => {
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue(
        buildMission([]),
      );
      mocks.mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        mockChatModel,
      ]);

      const result = await service.selectAgentForTask(
        "topic-001",
        "mission-001",
        "research task",
      );

      expect(result).toMatchObject({
        agentId: expect.any(String),
        agentType: "dimension_researcher",
        role: expect.any(String),
        modelId: expect.any(String),
        skills: expect.any(Array),
        tools: expect.any(Array),
      });
      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.tools.length).toBeGreaterThan(0);
    });
  });
});
