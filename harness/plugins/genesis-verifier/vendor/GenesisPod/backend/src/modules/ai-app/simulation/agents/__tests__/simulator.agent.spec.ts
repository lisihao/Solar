/**
 * SimulatorAgent Unit Tests
 *
 * Tests the plan-based AI simulation agent.
 * ISimulationService is optional and omitted in these tests
 * to exercise the graceful degradation path.
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  SimulatorAgent,
  SimulationTaskType,
  SimulationTeam,
} from "../simulator.agent";
import { SIMULATION_SERVICE_TOKEN } from "../../ports/simulation-service.port";

describe("SimulatorAgent", () => {
  let agent: SimulatorAgent;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SimulatorAgent,
        // Provide a null simulation service (optional dependency)
        { provide: SIMULATION_SERVICE_TOKEN, useValue: null },
      ],
    }).compile();

    agent = module.get<SimulatorAgent>(SimulatorAgent);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("agent metadata", () => {
    it("should have a defined agent id", () => {
      expect(agent.id).toBeDefined();
      expect(typeof agent.id).toBe("string");
    });

    it("should have a name", () => {
      expect(agent.name).toBe("AI Simulator");
    });

    it("should have a description", () => {
      expect(agent.description).toContain("推演");
    });

    it("should have capabilities", () => {
      expect(Array.isArray(agent.capabilities)).toBe(true);
      expect(agent.capabilities.length).toBeGreaterThan(0);
    });

    it("should have required tools", () => {
      expect(Array.isArray(agent.requiredTools)).toBe(true);
      expect(agent.requiredTools.length).toBeGreaterThan(0);
    });

    it("should expose templates via getTemplates()", () => {
      const templates = agent.getTemplates();
      expect(Array.isArray(templates)).toBe(true);
      expect(templates.length).toBeGreaterThan(0);
    });

    it("should include market-competition template", () => {
      const templates = agent.getTemplates();
      const template = templates.find((t) => t.id === "market-competition");
      expect(template).toBeDefined();
      expect(template!.category).toBe("business");
    });
  });

  describe("plan()", () => {
    it("should generate a plan with steps for basic prompt", async () => {
      const plan = await agent.plan({
        prompt: "模拟A公司与B公司的市场竞争",
      });

      expect(plan).toBeDefined();
      expect(plan.taskId).toBeDefined();
      expect(plan.agentId).toBe(agent.id);
      expect(Array.isArray(plan.steps)).toBe(true);
      expect(plan.steps.length).toBeGreaterThan(0);
    });

    it("should include correct number of rounds in steps", async () => {
      const plan = await agent.plan({
        prompt: "推演市场竞争",
        options: { rounds: 3 },
      });

      // Steps: 场景分析 + 数据收集 + 场景构建 + 3 rounds + 结果分析 + 策略建议
      const roundSteps = plan.steps.filter((s) => s.name.startsWith("推演第"));
      expect(roundSteps.length).toBe(3);
    });

    it("should default to 5 rounds when not specified", async () => {
      const plan = await agent.plan({ prompt: "推演博弈场景" });

      const roundSteps = plan.steps.filter((s) => s.name.startsWith("推演第"));
      expect(roundSteps.length).toBe(5);
    });

    it("should include metadata with task type and rounds", async () => {
      const plan = await agent.plan({
        prompt: "模拟市场竞争",
        options: { rounds: 2 },
      });

      expect(plan.metadata).toBeDefined();
      expect(plan.metadata!.rounds).toBe(2);
    });

    it("should classify SCENARIO_CREATION task for '创建' keyword", async () => {
      const plan = await agent.plan({ prompt: "创建一个市场竞争场景" });

      expect(plan.metadata!.taskType).toBe(
        SimulationTaskType.SCENARIO_CREATION,
      );
    });

    it("should classify ANALYSIS task for '分析' keyword", async () => {
      const plan = await agent.plan({ prompt: "分析竞争对手的策略" });

      expect(plan.metadata!.taskType).toBe(SimulationTaskType.ANALYSIS);
    });

    it("should classify STRATEGY_ADVICE task for '策略' keyword", async () => {
      const plan = await agent.plan({ prompt: "给出策略建议" });

      expect(plan.metadata!.taskType).toBe(SimulationTaskType.STRATEGY_ADVICE);
    });

    it("should default to RUN_SIMULATION for generic prompts", async () => {
      const plan = await agent.plan({ prompt: "simulate a negotiation" });

      expect(plan.metadata!.taskType).toBe(SimulationTaskType.RUN_SIMULATION);
    });

    it("should compute positive estimated time", async () => {
      const plan = await agent.plan({ prompt: "推演任务" });

      expect(plan.estimatedTime).toBeGreaterThan(0);
    });

    it("should include modelsRequired", async () => {
      const plan = await agent.plan({ prompt: "推演任务" });

      expect(plan.modelsRequired).toContain("chat");
    });
  });

  describe("execute()", () => {
    it("should yield error event when plan has no input", async () => {
      const plan = await agent.plan({ prompt: "博弈推演" });
      // plan has no .input property by default

      const events: unknown[] = [];
      for await (const event of agent.execute(plan)) {
        events.push(event);
      }

      const errorEvent = events.find(
        (e) => (e as { type: string }).type === "error",
      );
      expect(errorEvent).toBeDefined();
    });

    it("should yield plan_ready, step events, and complete for valid plan", async () => {
      const plan = await agent.plan({
        prompt: "模拟市场博弈",
        options: { rounds: 1 },
      });

      // Attach input to plan (as the execute method expects it)
      (plan as typeof plan & { input: unknown }).input = {
        prompt: "模拟市场博弈",
        options: {
          rounds: 1,
          teams: [SimulationTeam.BLUE, SimulationTeam.RED],
        },
      };

      const events: Array<{ type: string }> = [];
      for await (const event of agent.execute(plan)) {
        events.push(event as { type: string });
        // Stop after complete or error to avoid hanging
        if (event.type === "complete" || event.type === "error") break;
      }

      const types = events.map((e) => e.type);
      expect(types).toContain("plan_ready");
      expect(types).toContain("complete");
    });

    it("should yield step_start and step_complete for each step", async () => {
      const plan = await agent.plan({
        prompt: "推演模拟",
        options: { rounds: 1 },
      });

      (plan as typeof plan & { input: unknown }).input = {
        prompt: "推演模拟",
        options: { rounds: 1 },
      };

      const startEvents: unknown[] = [];
      const completeEvents: unknown[] = [];

      for await (const event of agent.execute(plan)) {
        if ((event as { type: string }).type === "step_start")
          startEvents.push(event);
        if ((event as { type: string }).type === "step_complete")
          completeEvents.push(event);
        if (
          (event as { type: string }).type === "complete" ||
          (event as { type: string }).type === "error"
        )
          break;
      }

      // Should have step events for each step in the plan
      expect(startEvents.length).toBeGreaterThan(0);
      expect(completeEvents.length).toBeGreaterThan(0);
    });

    it("should include round results in complete event artifact", async () => {
      const plan = await agent.plan({
        prompt: "博弈推演",
        options: { rounds: 2 },
      });

      (plan as typeof plan & { input: unknown }).input = {
        prompt: "博弈推演",
        options: {
          rounds: 2,
          teams: [SimulationTeam.BLUE, SimulationTeam.RED],
        },
      };

      let completeEvent: {
        type: string;
        result?: { artifacts?: unknown[] };
      } | null = null;
      for await (const event of agent.execute(plan)) {
        const e = event as { type: string; result?: { artifacts?: unknown[] } };
        if (e.type === "complete") {
          completeEvent = e;
          break;
        }
        if (e.type === "error") break;
      }

      expect(completeEvent).not.toBeNull();
      expect(completeEvent!.result).toBeDefined();
      expect(Array.isArray(completeEvent!.result!.artifacts)).toBe(true);
    });
  });

  describe("getConfig()", () => {
    it("should return agent config", () => {
      const config = agent.getConfig();
      expect(config).toBeDefined();
    });
  });
});
