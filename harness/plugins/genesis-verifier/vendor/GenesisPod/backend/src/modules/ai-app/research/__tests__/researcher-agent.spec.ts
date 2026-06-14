/**
 * Tests for ResearcherAgent
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ResearcherAgent, ResearchTaskType } from "../agents/researcher.agent";
import { RESEARCH_SERVICE_TOKEN } from "../ports/research-service.port";

jest.mock("../../../ai-harness/agents/base/plan-based-agent", () => {
  class MockPlanBasedAgent {
    protected templates: unknown[] = [];
    protected selectionKeywords: string[] = [];

    generateTaskId() {
      return `task-${Date.now()}`;
    }

    generateStepId() {
      return `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    }
  }

  return {
    PlanBasedAgent: MockPlanBasedAgent,
    BUILTIN_AGENTS: {
      SLIDES: "slides",
      DOCS: "docs",
      DESIGNER: "designer",
      RESEARCHER: "researcher",
      SIMULATOR: "simulator",
      IMAGE_DESIGNER: "image-designer",
      TEAM_COLLABORATION: "team-collaboration",
    },
  };
});

jest.mock("@/modules/ai-harness/facade", () => ({
  BUILTIN_AGENTS: {
    RESEARCHER: "researcher",
  },
  BUILTIN_TOOLS: {
    WEB_SEARCH: "web-search",
    RAG_SEARCH: "rag-search",
    KNOWLEDGE_GRAPH: "knowledge-graph",
    DATA_ANALYSIS: "data-analysis",
    TEXT_GENERATION: "text-generation",
    LONG_TERM_MEMORY: "long-term-memory",
    DATA_FETCH: "data-fetch",
  },
  RESEARCH_SERVICE_TOKEN: "RESEARCH_SERVICE_TOKEN",
  PlanBasedAgent: class {
    protected templates: unknown[] = [];
    protected selectionKeywords: string[] = [];
    generateTaskId() {
      return `task-${Date.now()}`;
    }
    generateStepId() {
      return `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    }
  },
  BaseAgent: class {},
}));

describe("ResearcherAgent", () => {
  let agent: ResearcherAgent;
  let mockResearchService: { saveResearchOutput: jest.Mock };

  beforeEach(async () => {
    mockResearchService = {
      saveResearchOutput: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearcherAgent,
        {
          provide: RESEARCH_SERVICE_TOKEN,
          useValue: mockResearchService,
        },
      ],
    }).compile();

    agent = module.get<ResearcherAgent>(ResearcherAgent);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("agent properties", () => {
    it("should have correct id", () => {
      expect(agent.id).toBe("researcher");
    });

    it("should have a name", () => {
      expect(agent.name).toBeDefined();
      expect(agent.name.length).toBeGreaterThan(0);
    });

    it("should have capabilities defined", () => {
      expect(Array.isArray(agent.capabilities)).toBe(true);
      expect(agent.capabilities.length).toBeGreaterThan(0);
    });

    it("should have requiredTools defined", () => {
      expect(Array.isArray(agent.requiredTools)).toBe(true);
      expect(agent.requiredTools).toContain("web-search");
    });
  });

  describe("plan", () => {
    it("should generate a plan for general research", async () => {
      const plan = await agent.plan({ prompt: "Research AI technology" });

      expect(plan).toBeDefined();
      expect(plan.taskId).toBeDefined();
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.agentId).toBe("researcher");
    });

    it("should include web-search step", async () => {
      const plan = await agent.plan({ prompt: "Research AI technology" });

      const webSearchStep = plan.steps.find((s) => s.toolId === "web-search");
      expect(webSearchStep).toBeDefined();
    });

    it("should include knowledge base search step by default", async () => {
      const plan = await agent.plan({ prompt: "Research AI technology" });

      const ragStep = plan.steps.find((s) => s.toolId === "rag-search");
      expect(ragStep).toBeDefined();
    });

    it("should skip knowledge base search when useKnowledgeBase is false", async () => {
      const plan = await agent.plan({
        prompt: "Research AI technology",
        options: { useKnowledgeBase: false },
      });

      const ragStep = plan.steps.find((s) => s.toolId === "rag-search");
      expect(ragStep).toBeUndefined();
    });

    it("should include data analysis step for data analysis tasks", async () => {
      const plan = await agent.plan({ prompt: "数据分析AI市场规模" });

      const dataStep = plan.steps.find((s) => s.toolId === "data-analysis");
      expect(dataStep).toBeDefined();
    });

    it("should include knowledge graph step when buildKnowledgeGraph is true", async () => {
      const plan = await agent.plan({
        prompt: "Research AI",
        options: { buildKnowledgeGraph: true },
      });

      const kgStep = plan.steps.find((s) => s.toolId === "knowledge-graph");
      expect(kgStep).toBeDefined();
    });

    it("should include long-term memory step by default", async () => {
      const plan = await agent.plan({ prompt: "Research AI" });

      const memStep = plan.steps.find((s) => s.toolId === "long-term-memory");
      expect(memStep).toBeDefined();
    });

    it("should skip long-term memory step when saveToMemory is false", async () => {
      const plan = await agent.plan({
        prompt: "Research AI",
        options: { saveToMemory: false },
      });

      const memStep = plan.steps.find((s) => s.toolId === "long-term-memory");
      expect(memStep).toBeUndefined();
    });

    it("should have estimated time based on steps", async () => {
      const plan = await agent.plan({ prompt: "Research AI" });

      expect(plan.estimatedTime).toBeGreaterThan(0);
    });

    it("should classify literature review tasks", async () => {
      const plan = await agent.plan({ prompt: "文献综述和分析" });

      expect(plan.metadata?.taskType).toBe(ResearchTaskType.LITERATURE_REVIEW);
    });

    it("should classify report generation tasks", async () => {
      const plan = await agent.plan({ prompt: "生成研究报告" });

      expect(plan.metadata?.taskType).toBe(ResearchTaskType.REPORT_GENERATION);
    });

    it("should classify knowledge extraction tasks", async () => {
      const plan = await agent.plan({ prompt: "提取知识点" });

      expect(plan.metadata?.taskType).toBe(
        ResearchTaskType.KNOWLEDGE_EXTRACTION,
      );
    });
  });

  describe("execute", () => {
    it("should yield error event when no input in plan", async () => {
      const plan = {
        taskId: "test-task",
        agentId: "researcher",
        steps: [
          {
            id: "step-1",
            name: "Test Step",
            description: "Test",
            toolId: "text-generation",
            dependencies: [],
            estimatedDuration: 1000,
          },
        ],
        estimatedTime: 1000,
        toolsRequired: [],
        modelsRequired: ["chat"],
        metadata: {},
      };

      const events = [];
      for await (const event of agent.execute(plan as any)) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("error");
    });

    it("should yield complete event when plan executes successfully", async () => {
      const planWithInput: any = {
        taskId: "test-task",
        agentId: "researcher",
        steps: [
          {
            id: "step-1",
            name: "Research",
            description: "Research step",
            toolId: "web-search",
            dependencies: [],
            estimatedDuration: 1000,
          },
          {
            id: "step-2",
            name: "Generate",
            description: "Generate content",
            toolId: "text-generation",
            dependencies: ["step-1"],
            estimatedDuration: 2000,
          },
        ],
        estimatedTime: 3000,
        toolsRequired: [],
        modelsRequired: ["chat"],
        metadata: { taskType: ResearchTaskType.GENERAL_RESEARCH },
        input: {
          prompt: "Research AI trends",
          options: { userId: "user-123" },
        },
      };

      const events = [];
      for await (const event of agent.execute(planWithInput)) {
        events.push(event);
      }

      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent).toBeDefined();
      expect(completeEvent.result.success).toBe(true);
    });

    it("should yield plan_ready event first", async () => {
      const planWithInput: any = {
        taskId: "test-task",
        agentId: "researcher",
        steps: [],
        estimatedTime: 0,
        toolsRequired: [],
        modelsRequired: [],
        metadata: {},
        input: { prompt: "Test", options: {} },
      };

      const events = [];
      for await (const event of agent.execute(planWithInput)) {
        events.push(event);
      }

      expect(events[0].type).toBe("plan_ready");
    });

    it("should save research output when projectId and researchService are available", async () => {
      const planWithInput: any = {
        taskId: "test-task",
        agentId: "researcher",
        steps: [
          {
            id: "step-1",
            name: "Memory",
            description: "Save",
            toolId: "long-term-memory",
            dependencies: [],
            estimatedDuration: 1000,
          },
        ],
        estimatedTime: 1000,
        toolsRequired: [],
        modelsRequired: [],
        metadata: {},
        input: {
          prompt: "Test",
          options: { projectId: "project-123", userId: "user-123" },
        },
      };

      const events = [];
      for await (const event of agent.execute(planWithInput)) {
        events.push(event);
      }

      // Note: saveResearchOutput is called with empty previousContent on first LONG_TERM_MEMORY step
      expect(mockResearchService.saveResearchOutput).toHaveBeenCalled();
    });
  });

  describe("ResearchTaskType enum", () => {
    it("should have all required task types", () => {
      expect(ResearchTaskType.LITERATURE_REVIEW).toBe("literature_review");
      expect(ResearchTaskType.DATA_ANALYSIS).toBe("data_analysis");
      expect(ResearchTaskType.REPORT_GENERATION).toBe("report_generation");
      expect(ResearchTaskType.KNOWLEDGE_EXTRACTION).toBe(
        "knowledge_extraction",
      );
      expect(ResearchTaskType.GENERAL_RESEARCH).toBe("general_research");
    });
  });
});
