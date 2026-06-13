/**
 * Tests for PlanBasedAgent
 * Verifies the plan-execute interface, template management,
 * runtime override helpers, and getConfig fallback logic.
 */

import {
  PlanBasedAgent,
  AgentInput,
  AgentPlan,
  AgentEvent,
  AgentTemplate,
} from "../plan-based-agent";
import {
  AgentId,
  ToolId,
} from "@/modules/ai-harness/agents/abstractions/agent.types";

// ---------------------------------------------------------------------------
// Concrete test doubles
// ---------------------------------------------------------------------------

/** Minimal concrete implementation using a built-in agent ID */
class BuiltinTestAgent extends PlanBasedAgent {
  readonly id: AgentId = "slides";
  readonly name = "Test Slides Agent";
  readonly description = "Test slides agent";
  readonly capabilities = ["generate slides"];
  readonly requiredTools: ToolId[] = ["text-generation"];

  async plan(_input: AgentInput): Promise<AgentPlan> {
    return {
      taskId: "task-1",
      agentId: this.id,
      steps: [],
      estimatedTime: 0,
      toolsRequired: [],
      modelsRequired: [],
    };
  }

  async *execute(_plan: AgentPlan): AsyncGenerator<AgentEvent> {
    yield {
      type: "complete",
      result: { success: true, artifacts: [], tokensUsed: 0, duration: 0 },
    };
  }
}

/** Agent with a custom (non-builtin) ID */
class CustomTestAgent extends PlanBasedAgent {
  readonly id: AgentId = "custom-agent-xyz";
  readonly name = "Custom Agent";
  readonly description = "A custom agent";
  readonly capabilities = ["custom-cap"];
  readonly requiredTools: ToolId[] = [];

  constructor() {
    super();
    this.templates = [
      {
        id: "tpl-1",
        name: "Template 1",
        description: "First template",
        category: "general",
      },
    ];
    this.selectionKeywords = ["slide", "presentation"];
  }

  async plan(_input: AgentInput): Promise<AgentPlan> {
    return {
      taskId: "task-2",
      agentId: this.id,
      steps: [],
      estimatedTime: 0,
      toolsRequired: [],
      modelsRequired: [],
    };
  }

  async *execute(_plan: AgentPlan): AsyncGenerator<AgentEvent> {
    yield {
      type: "complete",
      result: { success: true, artifacts: [], tokensUsed: 0, duration: 0 },
    };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PlanBasedAgent", () => {
  describe('BuiltinTestAgent (using "slides")', () => {
    let agent: BuiltinTestAgent;

    beforeEach(() => {
      agent = new BuiltinTestAgent();
    });

    // -----------------------------------------------------------------------
    // getTemplates
    // -----------------------------------------------------------------------

    describe("getTemplates", () => {
      it("returns an empty array when no templates are set", () => {
        expect(agent.getTemplates()).toEqual([]);
      });
    });

    // -----------------------------------------------------------------------
    // getConfig – predefined path
    // -----------------------------------------------------------------------

    describe("getConfig", () => {
      it("returns the predefined config for SLIDES agent", () => {
        const config = agent.getConfig();
        expect(config.id).toBe("slides");
        expect(config.name).toBeTruthy();
        expect(Array.isArray(config.capabilities)).toBe(true);
      });

      it("merges templates into the predefined config", () => {
        const tpl: AgentTemplate = {
          id: "tpl-builtin",
          name: "Builtin Template",
          description: "desc",
          category: "slides",
        };
        // inject templates via protected field access
        (agent as unknown as { templates: AgentTemplate[] }).templates = [tpl];
        const config = agent.getConfig();
        expect(config.templates).toContain(tpl);
      });

      it("merges selectionKeywords into the predefined config", () => {
        (
          agent as unknown as { selectionKeywords: string[] }
        ).selectionKeywords = ["ppt", "deck"];
        const config = agent.getConfig();
        expect(config.selectionKeywords).toContain("ppt");
      });
    });

    // -----------------------------------------------------------------------
    // plan / execute
    // -----------------------------------------------------------------------

    describe("plan", () => {
      it("resolves to an AgentPlan", async () => {
        const plan = await agent.plan({ prompt: "create slides" });
        expect(plan.agentId).toBe("slides");
        expect(Array.isArray(plan.steps)).toBe(true);
      });
    });

    describe("execute", () => {
      it("yields a complete event", async () => {
        const plan = await agent.plan({ prompt: "create slides" });
        const events: AgentEvent[] = [];
        for await (const event of agent.execute(plan)) {
          events.push(event);
        }
        expect(events.some((e) => e.type === "complete")).toBe(true);
      });
    });
  });

  // -------------------------------------------------------------------------
  // CustomTestAgent (non-builtin ID)
  // -------------------------------------------------------------------------

  describe("CustomTestAgent (non-builtin ID)", () => {
    let agent: CustomTestAgent;

    beforeEach(() => {
      agent = new CustomTestAgent();
    });

    describe("getConfig – fallback path", () => {
      it("returns a config built from agent properties when no predefined config exists", () => {
        const config = agent.getConfig();
        expect(config.id).toBe("custom-agent-xyz");
        expect(config.name).toBe("Custom Agent");
        expect(config.description).toBe("A custom agent");
        expect(config.capabilities).toContain("custom-cap");
        // fallback uses hardcoded icon/color
        expect(config.icon).toBeTruthy();
        expect(config.color).toBeTruthy();
      });

      it("includes templates and selectionKeywords in config", () => {
        const config = agent.getConfig();
        expect(config.templates).toHaveLength(1);
        expect(config.templates[0].id).toBe("tpl-1");
        expect(config.selectionKeywords).toContain("slide");
      });
    });

    describe("getTemplates", () => {
      it("returns the templates array", () => {
        const templates = agent.getTemplates();
        expect(templates).toHaveLength(1);
        expect(templates[0].name).toBe("Template 1");
      });
    });
  });

  // -------------------------------------------------------------------------
  // Runtime overrides
  // -------------------------------------------------------------------------

  describe("runtime overrides", () => {
    let agent: CustomTestAgent;

    beforeEach(() => {
      agent = new CustomTestAgent();
    });

    it("setSystemPromptOverride stores the prompt", () => {
      agent.setSystemPromptOverride("You are an expert.");
      expect(
        (agent as unknown as { _systemPromptOverride: string })
          ._systemPromptOverride,
      ).toBe("You are an expert.");
    });

    it("setModelTypeOverride stores the model type", () => {
      agent.setModelTypeOverride("chat-fast");
      expect(
        (agent as unknown as { _modelTypeOverride: string })._modelTypeOverride,
      ).toBe("chat-fast");
    });

    it("setTaskProfileOverride stores the profile", () => {
      const profile = { creativity: "high", outputLength: "long" };
      agent.setTaskProfileOverride(profile);
      expect(
        (agent as unknown as { _taskProfileOverride: Record<string, unknown> })
          ._taskProfileOverride,
      ).toEqual(profile);
    });

    it("clearRuntimeOverrides clears all overrides", () => {
      agent.setSystemPromptOverride("prompt");
      agent.setModelTypeOverride("model");
      agent.setTaskProfileOverride({ x: 1 });

      agent.clearRuntimeOverrides();

      const a = agent as unknown as {
        _systemPromptOverride: unknown;
        _modelTypeOverride: unknown;
        _taskProfileOverride: unknown;
      };
      expect(a._systemPromptOverride).toBeUndefined();
      expect(a._modelTypeOverride).toBeUndefined();
      expect(a._taskProfileOverride).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // generateStepId / generateTaskId (protected helpers)
  // -------------------------------------------------------------------------

  describe("protected ID generators", () => {
    class ExposedAgent extends PlanBasedAgent {
      readonly id: AgentId = "exposed";
      readonly name = "Exposed";
      readonly description = "desc";
      readonly capabilities: string[] = [];
      readonly requiredTools: ToolId[] = [];

      async plan(_input: AgentInput): Promise<AgentPlan> {
        return {
          taskId: "t",
          agentId: this.id,
          steps: [],
          estimatedTime: 0,
          toolsRequired: [],
          modelsRequired: [],
        };
      }
      async *execute(_plan: AgentPlan): AsyncGenerator<AgentEvent> {
        return;
      }

      public getStepId() {
        return this.generateStepId();
      }
      public getTaskId() {
        return this.generateTaskId();
      }
    }

    let exposed: ExposedAgent;
    beforeEach(() => {
      exposed = new ExposedAgent();
    });

    it("generateStepId returns a non-empty string starting with step_", () => {
      const id = exposed.getStepId();
      expect(id).toMatch(/^step_/);
    });

    it("generateTaskId returns a non-empty string starting with task_", () => {
      const id = exposed.getTaskId();
      expect(id).toMatch(/^task_/);
    });

    it("generateStepId produces unique values on successive calls", () => {
      const ids = new Set([
        exposed.getStepId(),
        exposed.getStepId(),
        exposed.getStepId(),
      ]);
      expect(ids.size).toBeGreaterThanOrEqual(1);
    });
  });
});
