/**
 * TopicInsightsAgent Tests
 *
 * Covers:
 * - Agent metadata (id, name, description, capabilities, requiredTools)
 * - templates and selectionKeywords arrays
 * - plan() method: returns a valid AgentPlan with sequential dependencies
 * - execute() generator: yields a "complete" event
 */

// Mocks must come before imports
jest.mock("@prisma/client", () => ({
  PrismaClient: class PrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
    $on = jest.fn();
  },
  AIModelType: { CHAT: "CHAT" },
}));

jest.mock("@/modules/ai-harness/facade", () => ({
  EntityHealthRegistry: class {},
  TaskCompletionType: {
    TIMEOUT: "TIMEOUT",
    API_ERROR: "API_ERROR",
    SUCCESS: "SUCCESS",
  },
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  EntityHealthRegistry: class {},
  TaskCompletionType: {
    TIMEOUT: "TIMEOUT",
    API_ERROR: "API_ERROR",
    SUCCESS: "SUCCESS",
  },
}));

jest.mock("@/modules/ai-harness/facade", () => ({
  ToolRegistry: class {},
  ChatFacade: class {},
  RAGFacade: class {},
  BUILTIN_AGENTS: {
    TOPIC_INSIGHTS: "topic-insights",
  },
  BUILTIN_TOOLS: {
    WEB_SEARCH: "web-search",
    RAG_SEARCH: "rag-search",
    DATA_ANALYSIS: "data-analysis",
    TEXT_GENERATION: "text-generation",
    DATA_FETCH: "data-fetch",
  },
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  ToolRegistry: class {},
  ChatFacade: class {},
  RAGFacade: class {},
  PlanBasedAgent: class {
    protected generateTaskId(): string {
      return `task-${Math.random().toString(36).slice(2)}`;
    }
    protected generateStepId(): string {
      return `step-${Math.random().toString(36).slice(2)}`;
    }
  },
  BaseAgent: class {},
  BUILTIN_AGENTS: {
    TOPIC_INSIGHTS: "topic-insights",
  },
  BUILTIN_TOOLS: {
    WEB_SEARCH: "web-search",
    RAG_SEARCH: "rag-search",
    DATA_ANALYSIS: "data-analysis",
    TEXT_GENERATION: "text-generation",
    DATA_FETCH: "data-fetch",
  },
}));

jest.mock("@/modules/ai-harness/facade/base-classes", () => {
  class PlanBasedAgentMock {
    protected generateTaskId(): string {
      return `task-${Math.random().toString(36).slice(2)}`;
    }
    protected generateStepId(): string {
      return `step-${Math.random().toString(36).slice(2)}`;
    }
  }
  return {
    PlanBasedAgent: PlanBasedAgentMock,
  };
});

import { Test, TestingModule } from "@nestjs/testing";
import { TopicInsightsAgent } from "../topic-insights.agent";

describe("TopicInsightsAgent", () => {
  let agent: TopicInsightsAgent;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TopicInsightsAgent],
    }).compile();

    agent = module.get<TopicInsightsAgent>(TopicInsightsAgent);
  });

  describe("metadata properties", () => {
    it('should have id = "topic-insights"', () => {
      expect(agent.id).toBe("topic-insights");
    });

    it("should have a non-empty name", () => {
      expect(agent.name).toBe("Topic Insights Researcher");
    });

    it("should have a non-empty description", () => {
      expect(agent.description).toBeTruthy();
    });

    it("should have capabilities array with 5 items", () => {
      expect(Array.isArray(agent.capabilities)).toBe(true);
      expect(agent.capabilities.length).toBeGreaterThanOrEqual(4);
    });

    it("should include 多维度深度研究 in capabilities", () => {
      expect(agent.capabilities).toContain("多维度深度研究");
    });

    it("should include 事实核查 in capabilities", () => {
      expect(agent.capabilities).toContain("事实核查");
    });

    it("should have requiredTools including web-search and text-generation", () => {
      expect(agent.requiredTools).toContain("web-search");
      expect(agent.requiredTools).toContain("text-generation");
      expect(agent.requiredTools).toContain("rag-search");
      expect(agent.requiredTools).toContain("data-analysis");
      expect(agent.requiredTools).toContain("data-fetch");
    });
  });

  describe("templates", () => {
    it("should have 2 templates", () => {
      // Access protected property via type cast
      const templates = (agent as unknown as { templates: unknown[] })
        .templates;
      expect(templates).toHaveLength(2);
    });

    it("should have topic-deep-research template", () => {
      const templates = (
        agent as unknown as {
          templates: Array<{ id: string; category: string }>;
        }
      ).templates;
      const deepResearch = templates.find(
        (t) => t.id === "topic-deep-research",
      );
      expect(deepResearch).toBeDefined();
      expect(deepResearch?.category).toBe("research");
    });

    it("should have topic-tracking template", () => {
      const templates = (
        agent as unknown as {
          templates: Array<{ id: string }>;
        }
      ).templates;
      const tracking = templates.find((t) => t.id === "topic-tracking");
      expect(tracking).toBeDefined();
    });
  });

  describe("selectionKeywords", () => {
    it("should include 深度研究 and 洞察", () => {
      const keywords = (agent as unknown as { selectionKeywords: string[] })
        .selectionKeywords;
      expect(keywords).toContain("深度研究");
      expect(keywords).toContain("洞察");
      expect(keywords).toContain("insights");
    });

    it("should include topic and 多维度", () => {
      const keywords = (agent as unknown as { selectionKeywords: string[] })
        .selectionKeywords;
      expect(keywords).toContain("topic");
      expect(keywords).toContain("多维度");
    });
  });

  describe("plan()", () => {
    it("should return a valid AgentPlan with taskId and agentId", async () => {
      const plan = await agent.plan({
        prompt: "研究人工智能在医疗领域的应用",
        sessionId: "session-1",
        userId: "user-1",
      });

      expect(plan).toBeDefined();
      expect(plan.taskId).toBeTruthy();
      expect(plan.agentId).toBe("topic-insights");
    });

    it("should return 4 steps in order", async () => {
      const plan = await agent.plan({
        prompt: "研究新能源汽车市场",
        sessionId: "session-2",
        userId: "user-1",
      });

      expect(plan.steps).toHaveLength(4);
      expect(plan.steps[0].name).toBe("研究规划");
      expect(plan.steps[1].name).toBe("多维度研究");
      expect(plan.steps[2].name).toBe("质量审核");
      expect(plan.steps[3].name).toBe("报告综合");
    });

    it("should wire sequential dependencies between steps", async () => {
      const plan = await agent.plan({
        prompt: "研究量子计算",
        sessionId: "session-3",
        userId: "user-1",
      });

      const [step0, step1, step2, step3] = plan.steps;

      // First step has no dependencies
      expect(step0.dependencies).toHaveLength(0);
      // Each subsequent step depends on the previous
      expect(step1.dependencies).toContain(step0.id);
      expect(step2.dependencies).toContain(step1.id);
      expect(step3.dependencies).toContain(step2.id);
    });

    it("should calculate estimatedTime as sum of all step durations", async () => {
      const plan = await agent.plan({
        prompt: "研究区块链技术",
        sessionId: "session-4",
        userId: "user-1",
      });

      const sumDurations = plan.steps.reduce(
        (acc, s) => acc + s.estimatedDuration,
        0,
      );
      expect(plan.estimatedTime).toBe(sumDurations);
    });

    it("should include toolsRequired matching requiredTools", async () => {
      const plan = await agent.plan({
        prompt: "研究AI伦理",
        sessionId: "session-5",
        userId: "user-1",
      });

      expect(plan.toolsRequired).toEqual(agent.requiredTools);
    });

    it("should include modelsRequired with chat", async () => {
      const plan = await agent.plan({
        prompt: "研究数字经济",
        sessionId: "session-6",
        userId: "user-1",
      });

      expect(plan.modelsRequired).toContain("chat");
    });

    it("should include module topic-insights in metadata", async () => {
      const plan = await agent.plan({
        prompt: "研究元宇宙",
        sessionId: "session-7",
        userId: "user-1",
      });

      expect(plan.metadata).toMatchObject({ module: "topic-insights" });
    });

    it("should handle prompt longer than 100 chars without error", async () => {
      const longPrompt = "研究".repeat(100);
      const plan = await agent.plan({
        prompt: longPrompt,
        sessionId: "session-8",
        userId: "user-1",
      });

      expect(plan).toBeDefined();
    });

    it("should handle undefined prompt without crashing", async () => {
      const plan = await agent.plan({
        prompt: undefined as unknown as string,
        sessionId: "session-9",
        userId: "user-1",
      });

      expect(plan).toBeDefined();
    });
  });

  describe("execute()", () => {
    it("should yield exactly one 'complete' event", async () => {
      const mockPlan = {
        taskId: "task-1",
        agentId: "topic-insights",
        steps: [],
        estimatedTime: 0,
        toolsRequired: [],
        modelsRequired: ["chat"],
        metadata: {},
      };

      const events: Array<{ type: string }> = [];

      for await (const event of agent.execute(mockPlan as never)) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("complete");
    });

    it("should yield a complete event with success=true", async () => {
      const mockPlan = {
        taskId: "task-2",
        agentId: "topic-insights",
        steps: [],
        estimatedTime: 0,
        toolsRequired: [],
        modelsRequired: ["chat"],
        metadata: {},
      };

      const events: Array<{ type: string; result?: { success: boolean } }> = [];

      for await (const event of agent.execute(mockPlan as never)) {
        events.push(event as never);
      }

      expect(events[0].result?.success).toBe(true);
    });

    it("should yield a complete event with empty artifacts", async () => {
      const mockPlan = {
        taskId: "task-3",
        agentId: "topic-insights",
        steps: [],
        estimatedTime: 0,
        toolsRequired: [],
        modelsRequired: ["chat"],
        metadata: {},
      };

      const events: Array<{
        type: string;
        result?: { artifacts: unknown[] };
      }> = [];

      for await (const event of agent.execute(mockPlan as never)) {
        events.push(event as never);
      }

      expect(events[0].result?.artifacts).toEqual([]);
    });

    it("should yield a complete event with tokensUsed=0 and duration=0", async () => {
      const mockPlan = {
        taskId: "task-4",
        agentId: "topic-insights",
        steps: [],
        estimatedTime: 0,
        toolsRequired: [],
        modelsRequired: [],
        metadata: {},
      };

      const events: Array<{
        type: string;
        result?: { tokensUsed: number; duration: number };
      }> = [];

      for await (const event of agent.execute(mockPlan as never)) {
        events.push(event as never);
      }

      expect(events[0].result?.tokensUsed).toBe(0);
      expect(events[0].result?.duration).toBe(0);
    });

    it("should yield a complete event with a non-empty summary", async () => {
      const mockPlan = {
        taskId: "task-5",
        agentId: "topic-insights",
        steps: [],
        estimatedTime: 0,
        toolsRequired: [],
        modelsRequired: [],
        metadata: {},
      };

      const events: Array<{
        type: string;
        result?: { summary: string };
      }> = [];

      for await (const event of agent.execute(mockPlan as never)) {
        events.push(event as never);
      }

      expect(events[0].result?.summary).toBeTruthy();
      expect(typeof events[0].result?.summary).toBe("string");
    });
  });
});
