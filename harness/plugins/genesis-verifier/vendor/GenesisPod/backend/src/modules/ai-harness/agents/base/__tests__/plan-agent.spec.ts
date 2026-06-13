/**
 * Tests for PlanAgent
 * Exercises plan-based execution, replan logic, step types, and streaming.
 */

import { Logger } from "@nestjs/common";
import { PlanAgent, PlanAgentConfig, StepResult } from "../plan-agent";
import {
  AgentContext,
  AgentInput,
  AgentOutput,
  AgentCapability,
  ExecutionPlan,
  ReActPlanStep,
} from "../../abstractions/agent.interface";
import { ToolRegistry } from "../../../tools/registry";

// ---------------------------------------------------------------------------
// Concrete test double
// ---------------------------------------------------------------------------

class TestPlanAgent extends PlanAgent<AgentInput, AgentOutput> {
  readonly id = "test-plan-agent";
  readonly name = "Test Plan Agent";
  readonly description = "Used in unit tests";
  readonly capabilities: AgentCapability[] = [];

  planImpl: (
    input: AgentInput,
    context: AgentContext,
  ) => Promise<ExecutionPlan> = async (_input, _context) => ({
    id: "plan-1",
    agentId: this.id,
    steps: [],
  });

  processResultsImpl: (
    results: StepResult[],
    context: AgentContext,
  ) => Promise<AgentOutput> = async (_results, _context) => ({
    message: "processed",
  });

  async plan(input: AgentInput, context: AgentContext): Promise<ExecutionPlan> {
    return this.planImpl(input, context);
  }

  protected async processResults(
    results: StepResult[],
    context: AgentContext,
  ): Promise<AgentOutput> {
    return this.processResultsImpl(results, context);
  }

  constructor(config?: Partial<PlanAgentConfig>) {
    super(config);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    executionId: "exec-plan",
    agentId: "test-plan-agent",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeInput(prompt = "do something"): AgentInput {
  return { prompt };
}

function makePlan(steps: ReActPlanStep[]): ExecutionPlan {
  return { id: "plan-id", agentId: "test-plan-agent", steps };
}

function makeStep(overrides: Partial<ReActPlanStep> = {}): ReActPlanStep {
  return {
    id: "step-1",
    type: "tool",
    executor: "my-tool",
    input: { q: "test" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PlanAgent", () => {
  let agent: TestPlanAgent;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, "warn").mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, "error").mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, "debug").mockReturnValue(undefined);

    agent = new TestPlanAgent();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // supportedModes
  // -------------------------------------------------------------------------

  it("supports only plan-based mode", () => {
    expect(agent.supportedModes).toEqual(["plan-based"]);
  });

  // -------------------------------------------------------------------------
  // execute – empty plan (no steps)
  // -------------------------------------------------------------------------

  describe("execute with empty plan", () => {
    it("calls processResults with empty array and returns success", async () => {
      const result = await agent.execute(makeInput(), makeContext());
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ message: "processed" });
    });
  });

  // -------------------------------------------------------------------------
  // execute – tool step
  // -------------------------------------------------------------------------

  describe("execute – tool step", () => {
    it("calls the registered tool and passes its output to processResults", async () => {
      const toolOutput = { found: true };
      const tool = {
        execute: jest
          .fn()
          .mockResolvedValue({ success: true, data: toolOutput }),
      };
      const registry = {
        tryGet: jest.fn().mockReturnValue(tool),
      } as unknown as ToolRegistry;
      agent.setToolRegistry(registry);

      agent.planImpl = async () =>
        makePlan([makeStep({ type: "tool", executor: "my-tool" })]);

      const collectedResults: StepResult[][] = [];
      agent.processResultsImpl = async (results) => {
        collectedResults.push(results);
        return { message: "done" };
      };

      const result = await agent.execute(makeInput(), makeContext());
      expect(result.success).toBe(true);
      expect(collectedResults[0][0].success).toBe(true);
      expect(collectedResults[0][0].output).toEqual(toolOutput);
    });
  });

  // -------------------------------------------------------------------------
  // execute – skill step
  // -------------------------------------------------------------------------

  describe("execute – skill step", () => {
    it("calls the registered skill", async () => {
      const skillOutput = { result: "ok" };
      const skill = {
        execute: jest
          .fn()
          .mockResolvedValue({ success: true, data: skillOutput }),
      };
      const skillRegistry = {
        tryGet: jest.fn().mockReturnValue(skill),
      } as unknown as import("../../../skills/registry").SkillRegistry;
      agent.setSkillRegistry(skillRegistry);

      agent.planImpl = async () =>
        makePlan([makeStep({ id: "s1", type: "skill", executor: "my-skill" })]);

      const result = await agent.execute(makeInput(), makeContext());
      expect(result.success).toBe(true);
      expect(skill.execute).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // execute – wait step
  // -------------------------------------------------------------------------

  describe("execute – wait step", () => {
    it("waits and returns waited output", async () => {
      // Use a very short wait time (1ms) so the test completes quickly without fake timers
      agent.planImpl = async () =>
        makePlan([
          makeStep({ id: "w1", type: "wait", executor: "", input: 1 }),
        ]);

      const result = await agent.execute(makeInput(), makeContext());

      expect(result.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // execute – decision step
  // -------------------------------------------------------------------------

  describe("execute – decision step", () => {
    it("returns a decision object from the default executeDecision", async () => {
      agent.planImpl = async () =>
        makePlan([
          makeStep({
            id: "d1",
            type: "decision",
            executor: "",
            condition: "a > b",
          }),
        ]);

      const collectedResults: StepResult[][] = [];
      agent.processResultsImpl = async (results) => {
        collectedResults.push(results);
        return { message: "ok" };
      };

      const result = await agent.execute(makeInput(), makeContext());
      expect(result.success).toBe(true);
      expect(collectedResults[0][0].output).toEqual({ decision: "a > b" });
    });
  });

  // -------------------------------------------------------------------------
  // execute – parallel step
  // -------------------------------------------------------------------------

  describe("execute – parallel step", () => {
    it("executes substeps in parallel and collects results", async () => {
      const tool = {
        execute: jest.fn().mockResolvedValue({ success: true, data: "x" }),
      };
      const registry = {
        tryGet: jest.fn().mockReturnValue(tool),
      } as unknown as ToolRegistry;
      agent.setToolRegistry(registry);

      const subStep1: ReActPlanStep = {
        id: "sub-1",
        type: "tool",
        executor: "my-tool",
      };
      const subStep2: ReActPlanStep = {
        id: "sub-2",
        type: "tool",
        executor: "my-tool",
      };

      agent.planImpl = async () =>
        makePlan([
          makeStep({
            id: "p1",
            type: "parallel",
            executor: "",
            input: [subStep1, subStep2],
          }),
        ]);

      const result = await agent.execute(makeInput(), makeContext());
      expect(result.success).toBe(true);
      expect(tool.execute).toHaveBeenCalledTimes(2);
    });

    it("handles empty substeps gracefully", async () => {
      agent.planImpl = async () =>
        makePlan([
          makeStep({ id: "p2", type: "parallel", executor: "", input: [] }),
        ]);

      const result = await agent.execute(makeInput(), makeContext());
      expect(result.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // execute – unknown step type
  // -------------------------------------------------------------------------

  describe("execute – unknown step type", () => {
    it("marks the step as failed (step error is caught internally)", async () => {
      agent.planImpl = async () =>
        makePlan([
          makeStep({
            id: "u1",
            type: "agent" as ReActPlanStep["type"],
            executor: "",
          }),
        ]);

      // onStepFailure default is 'replan' → will replan until maxReplans is exceeded
      // Set onStepFailure to 'skip' so we can reach processResults
      const agentWithSkip = new TestPlanAgent({ onStepFailure: "skip" });
      agentWithSkip.planImpl = async () =>
        makePlan([
          makeStep({
            id: "u1",
            type: "agent" as ReActPlanStep["type"],
            executor: "",
          }),
        ]);

      const result = await agentWithSkip.execute(makeInput(), makeContext());
      // With 'skip', failed step is skipped and processResults is called
      expect(result.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // execute – step failure with onStepFailure: 'abort'
  // -------------------------------------------------------------------------

  describe("execute – onStepFailure: abort", () => {
    it("stops processing remaining steps and calls processResults with the failed step result", async () => {
      // Tool not found → executeStep returns { success: false }
      // With onStepFailure: 'abort', executePlan returns { needReplan: false }
      // doExecute then calls processResults with the collected results (including failed step).
      const registry = {
        tryGet: jest.fn().mockReturnValue(undefined),
      } as unknown as ToolRegistry;

      const agentAbort = new TestPlanAgent({ onStepFailure: "abort" });
      agentAbort.setToolRegistry(registry);

      // Two steps: first fails, second should NOT run
      const step2Executed = { called: false };
      agentAbort.planImpl = async () =>
        makePlan([
          makeStep({ id: "s1", type: "tool", executor: "bad-tool" }),
          makeStep({ id: "s2", type: "tool", executor: "bad-tool" }),
        ]);

      const collectedResults: StepResult[][] = [];
      agentAbort.processResultsImpl = async (results) => {
        collectedResults.push(results);
        // Mark whether step 2 ran
        step2Executed.called = results.some((r) => r.stepId === "s2");
        return { message: "aborted" };
      };

      const result = await agentAbort.execute(makeInput(), makeContext());
      // processResults is called and execution succeeds (abort only stops further steps)
      expect(result.success).toBe(true);
      // Only the failed step (s1) was passed to processResults; s2 was aborted
      expect(step2Executed.called).toBe(false);
      expect(collectedResults[0][0].stepId).toBe("s1");
      expect(collectedResults[0][0].success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // execute – step failure with onStepFailure: 'replan'
  // -------------------------------------------------------------------------

  describe("execute – onStepFailure: replan", () => {
    it("replans and eventually exhausts maxReplans", async () => {
      const registry = {
        tryGet: jest.fn().mockReturnValue(undefined),
      } as unknown as ToolRegistry;

      const agentReplan = new TestPlanAgent({
        onStepFailure: "replan",
        maxReplans: 2,
      });
      agentReplan.setToolRegistry(registry);
      agentReplan.planImpl = async () =>
        makePlan([makeStep({ id: "bad", type: "tool", executor: "missing" })]);

      const result = await agentReplan.execute(makeInput(), makeContext());
      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/replan/i);
    });

    it("succeeds on replan if second plan has no failing steps", async () => {
      let callCount = 0;
      const registry = {
        tryGet: jest.fn().mockReturnValue(undefined),
      } as unknown as ToolRegistry;

      const agentReplan = new TestPlanAgent({
        onStepFailure: "replan",
        maxReplans: 2,
      });
      agentReplan.setToolRegistry(registry);
      agentReplan.planImpl = async () => {
        callCount++;
        if (callCount === 1) {
          // First plan has a bad step
          return makePlan([
            makeStep({ id: "bad", type: "tool", executor: "missing" }),
          ]);
        }
        // Second plan is empty → succeeds
        return makePlan([]);
      };

      const result = await agentReplan.execute(makeInput(), makeContext());
      expect(result.success).toBe(true);
      expect(callCount).toBeGreaterThanOrEqual(2);
    });
  });

  // -------------------------------------------------------------------------
  // execute – cancellation
  // -------------------------------------------------------------------------

  describe("execute – cancellation", () => {
    it("stops execution when AbortSignal is triggered", async () => {
      const controller = new AbortController();
      controller.abort();
      const ctx = makeContext({ signal: controller.signal });

      const result = await agent.execute(makeInput(), ctx);
      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/cancelled/i);
    });
  });

  // -------------------------------------------------------------------------
  // execute – dependency check
  // -------------------------------------------------------------------------

  describe("execute – step dependency", () => {
    it("skips a step whose dependency was not met", async () => {
      const tool = {
        execute: jest.fn().mockResolvedValue({ success: true, data: "x" }),
      };
      const registry = {
        tryGet: jest.fn().mockReturnValue(tool),
      } as unknown as ToolRegistry;
      agent.setToolRegistry(registry);

      const step1: ReActPlanStep = {
        id: "s1",
        type: "tool",
        executor: "my-tool",
      };
      // step2 depends on "non-existent-step"
      const step2: ReActPlanStep = {
        id: "s2",
        type: "tool",
        executor: "my-tool",
        dependsOn: ["non-existent-step"],
      };

      agent.planImpl = async () => makePlan([step1, step2]);

      const collectedResults: StepResult[][] = [];
      agent.processResultsImpl = async (results) => {
        collectedResults.push(results);
        return { message: "ok" };
      };

      await agent.execute(makeInput(), makeContext());
      // step2 was skipped because dependency was unmet
      const stepIds = collectedResults[0].map((r) => r.stepId);
      expect(stepIds).toContain("s1");
      expect(stepIds).not.toContain("s2");
    });
  });

  // -------------------------------------------------------------------------
  // executeStream
  // -------------------------------------------------------------------------

  describe("executeStream", () => {
    it("yields started and completed events on success", async () => {
      const gen = agent.executeStream(makeInput(), makeContext());
      const types: string[] = [];

      for await (const event of gen) {
        types.push((event as { type: string }).type);
      }

      expect(types).toContain("started");
      expect(types).toContain("completed");
    });

    it("yields error event on failure", async () => {
      const controller = new AbortController();
      controller.abort();
      const ctx = makeContext({ signal: controller.signal });

      const gen = agent.executeStream(makeInput(), ctx);
      const types: string[] = [];

      for await (const event of gen) {
        types.push((event as { type: string }).type);
      }

      expect(types).toContain("error");
    });
  });

  // -------------------------------------------------------------------------
  // config defaults
  // -------------------------------------------------------------------------

  describe("config defaults", () => {
    it("uses allowReplan=true by default", () => {
      const cfg = (agent as unknown as { config: PlanAgentConfig }).config;
      expect(cfg.allowReplan).toBe(true);
    });

    it("uses maxReplans=3 by default", () => {
      const cfg = (agent as unknown as { config: PlanAgentConfig }).config;
      expect(cfg.maxReplans).toBe(3);
    });

    it("merges partial config with defaults", () => {
      const custom = new TestPlanAgent({ maxReplans: 5 });
      const cfg = (custom as unknown as { config: PlanAgentConfig }).config;
      expect(cfg.maxReplans).toBe(5);
      expect(cfg.allowReplan).toBe(true);
    });
  });
});
