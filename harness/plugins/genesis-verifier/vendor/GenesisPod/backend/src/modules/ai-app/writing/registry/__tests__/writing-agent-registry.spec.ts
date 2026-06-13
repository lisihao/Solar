/**
 * Unit tests for WritingAgentRegistry and WritingAgentAdapter
 *
 * Covers:
 * - onModuleInit: logs initialization
 * - register: success, duplicate throws
 * - registerMultiple: registers all agents in bulk
 * - unregister: success, not found returns false
 * - replace: unregisters old and registers new
 * - get: found / undefined
 * - getOrThrow: found / throws when missing
 * - getAll: returns all agents
 * - getAllIds: returns all IDs
 * - has: true / false
 * - count: increments correctly
 * - getByCapability: matching / no match
 * - getByAnyCapability: union of agents
 * - getByAllCapabilities: intersection of agents
 * - getAllCapabilities: lists all capability IDs
 * - getStatus: summary shape
 * - printStatus: logs without throwing
 * - clear: empties agents and capabilities
 * - WritingAgentAdapter: id/name/description/supportedModes/capabilities proxies
 * - WritingAgentAdapter.execute: delegates to writing agent
 * - WritingAgentAdapter.executeStream: fallback without executeStream + with it
 * - WritingAgentAdapter.plan: fallback without plan + with it
 * - WritingAgentAdapter.validateInput: fallback without validateInput + with it
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  WritingAgentRegistry,
  WritingAgentAdapter,
  IWritingAgent,
} from "../writing-agent-registry";
import type {
  AgentContext,
  AgentCapability,
} from "@/modules/ai-harness/facade";

// ==================== Helpers ====================

function makeCapability(id: string): AgentCapability {
  return {
    id,
    name: id,
    description: `${id} capability`,
    category: "analysis",
  };
}

function makeAgent(
  id: string,
  capabilities: AgentCapability[] = [],
): IWritingAgent {
  return {
    id,
    name: `Agent ${id}`,
    description: `Description of ${id}`,
    capabilities,
    supportedModes: ["reactive"],
    requiredTools: [],
    requiredSkills: [],
    version: "1.0.0",
    execute: jest.fn().mockResolvedValue({
      success: true,
      data: { result: "executed" },
      metadata: {},
    }),
  };
}

function makeAgentContext(): AgentContext {
  return {
    agentId: "test-agent",
    executionId: "exec-1",
    mode: "reactive",
    metadata: {},
  } as AgentContext;
}

// ==================== Tests ====================

describe("WritingAgentRegistry", () => {
  let registry: WritingAgentRegistry;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WritingAgentRegistry],
    }).compile();

    registry = module.get<WritingAgentRegistry>(WritingAgentRegistry);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== onModuleInit ====================

  describe("onModuleInit", () => {
    it("should not throw during initialization", () => {
      expect(() => registry.onModuleInit()).not.toThrow();
    });

    it("should start with zero agents after init", () => {
      expect(registry.count()).toBe(0);
    });
  });

  // ==================== register ====================

  describe("register", () => {
    it("should register an agent successfully", () => {
      const agent = makeAgent("writer-1");
      registry.register(agent);

      expect(registry.has("writer-1")).toBe(true);
      expect(registry.count()).toBe(1);
    });

    it("should index capabilities on registration", () => {
      const agent = makeAgent("writer-1", [
        makeCapability("creative-writing"),
        makeCapability("dialogue"),
      ]);
      registry.register(agent);

      expect(registry.getByCapability("creative-writing")).toHaveLength(1);
      expect(registry.getByCapability("dialogue")).toHaveLength(1);
    });

    it("should throw when registering an agent with duplicate ID", () => {
      const agent = makeAgent("writer-1");
      registry.register(agent);

      expect(() => registry.register(agent)).toThrow(
        "Agent with ID 'writer-1' is already registered",
      );
    });

    it("should allow multiple agents with different IDs", () => {
      registry.register(makeAgent("writer-1"));
      registry.register(makeAgent("checker-1"));
      registry.register(makeAgent("editor-1"));

      expect(registry.count()).toBe(3);
    });
  });

  // ==================== registerMultiple ====================

  describe("registerMultiple", () => {
    it("should register all agents in the array", () => {
      const agents = [
        makeAgent("writer-1"),
        makeAgent("checker-1"),
        makeAgent("editor-1"),
      ];
      registry.registerMultiple(agents);

      expect(registry.count()).toBe(3);
    });

    it("should handle empty array without error", () => {
      registry.registerMultiple([]);
      expect(registry.count()).toBe(0);
    });

    it("should throw if any agent has duplicate ID", () => {
      registry.register(makeAgent("writer-1"));

      expect(() =>
        registry.registerMultiple([
          makeAgent("writer-1"),
          makeAgent("checker-1"),
        ]),
      ).toThrow();
    });
  });

  // ==================== unregister ====================

  describe("unregister", () => {
    it("should unregister an existing agent and return true", () => {
      const agent = makeAgent("writer-1", [makeCapability("creative-writing")]);
      registry.register(agent);

      const result = registry.unregister("writer-1");

      expect(result).toBe(true);
      expect(registry.has("writer-1")).toBe(false);
      expect(registry.count()).toBe(0);
    });

    it("should remove capability index when last agent with that capability is unregistered", () => {
      const agent = makeAgent("writer-1", [makeCapability("creative-writing")]);
      registry.register(agent);
      registry.unregister("writer-1");

      expect(registry.getByCapability("creative-writing")).toHaveLength(0);
      expect(registry.getAllCapabilities()).not.toContain("creative-writing");
    });

    it("should keep capability in index if another agent still has it", () => {
      const agent1 = makeAgent("writer-1", [
        makeCapability("creative-writing"),
      ]);
      const agent2 = makeAgent("writer-2", [
        makeCapability("creative-writing"),
      ]);
      registry.register(agent1);
      registry.register(agent2);

      registry.unregister("writer-1");

      expect(registry.getByCapability("creative-writing")).toHaveLength(1);
    });

    it("should return false when trying to unregister a nonexistent agent", () => {
      const result = registry.unregister("nonexistent");
      expect(result).toBe(false);
    });
  });

  // ==================== replace ====================

  describe("replace", () => {
    it("should replace an existing agent", () => {
      const oldAgent = makeAgent("writer-1", [
        makeCapability("creative-writing"),
      ]);
      const newAgent = makeAgent("writer-1", [makeCapability("editing")]);

      registry.register(oldAgent);
      registry.replace(newAgent);

      expect(registry.count()).toBe(1);
      expect(registry.get("writer-1")).toBe(newAgent);
      expect(registry.getByCapability("editing")).toHaveLength(1);
      expect(registry.getByCapability("creative-writing")).toHaveLength(0);
    });

    it("should register a new agent when none with that ID exists", () => {
      const agent = makeAgent("writer-1");
      registry.replace(agent);

      expect(registry.has("writer-1")).toBe(true);
    });
  });

  // ==================== get / getOrThrow ====================

  describe("get", () => {
    it("should return the agent when found", () => {
      const agent = makeAgent("writer-1");
      registry.register(agent);

      expect(registry.get("writer-1")).toBe(agent);
    });

    it("should return undefined when not found", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });
  });

  describe("getOrThrow", () => {
    it("should return the agent when found", () => {
      const agent = makeAgent("writer-1");
      registry.register(agent);

      expect(registry.getOrThrow("writer-1")).toBe(agent);
    });

    it("should throw when agent not found", () => {
      expect(() => registry.getOrThrow("nonexistent")).toThrow(
        "Agent with ID 'nonexistent' not found in registry",
      );
    });
  });

  // ==================== getAll / getAllIds ====================

  describe("getAll", () => {
    it("should return all registered agents", () => {
      registry.register(makeAgent("writer-1"));
      registry.register(makeAgent("checker-1"));

      const all = registry.getAll();

      expect(all).toHaveLength(2);
    });

    it("should return empty array when no agents", () => {
      expect(registry.getAll()).toHaveLength(0);
    });
  });

  describe("getAllIds", () => {
    it("should return all agent IDs", () => {
      registry.register(makeAgent("writer-1"));
      registry.register(makeAgent("checker-1"));

      const ids = registry.getAllIds();

      expect(ids).toContain("writer-1");
      expect(ids).toContain("checker-1");
    });
  });

  // ==================== has / count ====================

  describe("has", () => {
    it("should return true for registered agent", () => {
      registry.register(makeAgent("writer-1"));
      expect(registry.has("writer-1")).toBe(true);
    });

    it("should return false for unregistered agent", () => {
      expect(registry.has("writer-1")).toBe(false);
    });
  });

  describe("count", () => {
    it("should return 0 initially", () => {
      expect(registry.count()).toBe(0);
    });

    it("should increment on registration", () => {
      registry.register(makeAgent("a"));
      registry.register(makeAgent("b"));
      expect(registry.count()).toBe(2);
    });

    it("should decrement on unregister", () => {
      registry.register(makeAgent("a"));
      registry.unregister("a");
      expect(registry.count()).toBe(0);
    });
  });

  // ==================== capability queries ====================

  describe("getByCapability", () => {
    it("should return agents with that capability", () => {
      registry.register(
        makeAgent("writer-1", [makeCapability("creative-writing")]),
      );
      registry.register(makeAgent("checker-1", [makeCapability("fact-check")]));

      const writers = registry.getByCapability("creative-writing");

      expect(writers).toHaveLength(1);
      expect(writers[0].id).toBe("writer-1");
    });

    it("should return empty array for unknown capability", () => {
      registry.register(
        makeAgent("writer-1", [makeCapability("creative-writing")]),
      );

      expect(registry.getByCapability("unknown-cap")).toHaveLength(0);
    });

    it("should return multiple agents with same capability", () => {
      registry.register(
        makeAgent("writer-1", [makeCapability("creative-writing")]),
      );
      registry.register(
        makeAgent("writer-2", [makeCapability("creative-writing")]),
      );

      const writers = registry.getByCapability("creative-writing");

      expect(writers).toHaveLength(2);
    });
  });

  describe("getByAnyCapability", () => {
    it("should return agents with any of the given capabilities", () => {
      registry.register(
        makeAgent("writer-1", [makeCapability("creative-writing")]),
      );
      registry.register(makeAgent("checker-1", [makeCapability("fact-check")]));
      registry.register(makeAgent("editor-1", [makeCapability("editing")]));

      const result = registry.getByAnyCapability([
        "creative-writing",
        "fact-check",
      ]);

      expect(result).toHaveLength(2);
    });

    it("should deduplicate when agent has multiple matching capabilities", () => {
      registry.register(
        makeAgent("multi-1", [
          makeCapability("creative-writing"),
          makeCapability("editing"),
        ]),
      );

      const result = registry.getByAnyCapability([
        "creative-writing",
        "editing",
      ]);

      expect(result).toHaveLength(1);
    });

    it("should return empty array when no capabilities match", () => {
      registry.register(
        makeAgent("writer-1", [makeCapability("creative-writing")]),
      );

      const result = registry.getByAnyCapability(["unknown-1", "unknown-2"]);

      expect(result).toHaveLength(0);
    });
  });

  describe("getByAllCapabilities", () => {
    it("should return only agents that have ALL given capabilities", () => {
      registry.register(
        makeAgent("writer-1", [
          makeCapability("creative-writing"),
          makeCapability("dialogue"),
        ]),
      );
      registry.register(
        makeAgent("writer-2", [makeCapability("creative-writing")]),
      );

      const result = registry.getByAllCapabilities([
        "creative-writing",
        "dialogue",
      ]);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("writer-1");
    });

    it("should return empty array when no agent has all capabilities", () => {
      registry.register(
        makeAgent("writer-1", [makeCapability("creative-writing")]),
      );

      const result = registry.getByAllCapabilities([
        "creative-writing",
        "nonexistent",
      ]);

      expect(result).toHaveLength(0);
    });

    it("should return empty array for empty capability list", () => {
      registry.register(
        makeAgent("writer-1", [makeCapability("creative-writing")]),
      );

      const result = registry.getByAllCapabilities([]);

      expect(result).toHaveLength(0);
    });

    it("should return empty array when first capability has no agents", () => {
      registry.register(
        makeAgent("writer-1", [makeCapability("creative-writing")]),
      );

      const result = registry.getByAllCapabilities([
        "nonexistent",
        "creative-writing",
      ]);

      expect(result).toHaveLength(0);
    });
  });

  describe("getAllCapabilities", () => {
    it("should list all distinct capability IDs", () => {
      registry.register(
        makeAgent("writer-1", [
          makeCapability("creative-writing"),
          makeCapability("dialogue"),
        ]),
      );
      registry.register(makeAgent("checker-1", [makeCapability("fact-check")]));

      const caps = registry.getAllCapabilities();

      expect(caps).toContain("creative-writing");
      expect(caps).toContain("dialogue");
      expect(caps).toContain("fact-check");
      expect(caps).toHaveLength(3);
    });

    it("should deduplicate shared capabilities", () => {
      registry.register(makeAgent("a", [makeCapability("writing")]));
      registry.register(makeAgent("b", [makeCapability("writing")]));

      const caps = registry.getAllCapabilities();

      expect(caps.filter((c) => c === "writing")).toHaveLength(1);
    });
  });

  // ==================== getStatus / printStatus ====================

  describe("getStatus", () => {
    it("should return correct summary shape", () => {
      registry.register(
        makeAgent("writer-1", [makeCapability("creative-writing")]),
      );

      const status = registry.getStatus();

      expect(status.agentCount).toBe(1);
      expect(status.capabilityCount).toBe(1);
      expect(status.agents).toHaveLength(1);
      expect(status.agents[0].id).toBe("writer-1");
      expect(status.agents[0].capabilities).toContain("creative-writing");
    });

    it("should return empty summary when no agents registered", () => {
      const status = registry.getStatus();

      expect(status.agentCount).toBe(0);
      expect(status.capabilityCount).toBe(0);
      expect(status.agents).toHaveLength(0);
    });
  });

  describe("printStatus", () => {
    it("should not throw when called with agents registered", () => {
      registry.register(
        makeAgent("writer-1", [makeCapability("creative-writing")]),
      );

      expect(() => registry.printStatus()).not.toThrow();
    });

    it("should not throw when no agents", () => {
      expect(() => registry.printStatus()).not.toThrow();
    });
  });

  // ==================== clear ====================

  describe("clear", () => {
    it("should remove all agents and capabilities", () => {
      registry.register(
        makeAgent("writer-1", [makeCapability("creative-writing")]),
      );
      registry.register(makeAgent("checker-1", [makeCapability("fact-check")]));

      registry.clear();

      expect(registry.count()).toBe(0);
      expect(registry.getAllCapabilities()).toHaveLength(0);
    });

    it("should allow re-registration after clear", () => {
      const agent = makeAgent("writer-1");
      registry.register(agent);
      registry.clear();
      registry.register(agent);

      expect(registry.count()).toBe(1);
    });
  });
});

// ==================== WritingAgentAdapter ====================

describe("WritingAgentAdapter", () => {
  function makeFullAgent(
    overrides: Partial<IWritingAgent> = {},
  ): IWritingAgent {
    return {
      id: "test-agent",
      name: "Test Agent",
      description: "A test writing agent",
      capabilities: [makeCapability("creative-writing")],
      supportedModes: ["reactive", "hybrid"],
      requiredTools: ["text-generation"],
      requiredSkills: ["writing-v1"],
      version: "2.0.0",
      execute: jest.fn().mockResolvedValue({
        success: true,
        data: { content: "generated text" },
        metadata: {},
      }),
      ...overrides,
    };
  }

  // ==================== property proxies ====================

  describe("property delegation", () => {
    it("should proxy id from underlying agent", () => {
      const agent = makeFullAgent();
      const adapter = new WritingAgentAdapter(agent);
      expect(adapter.id).toBe("test-agent");
    });

    it("should proxy name", () => {
      const agent = makeFullAgent();
      const adapter = new WritingAgentAdapter(agent);
      expect(adapter.name).toBe("Test Agent");
    });

    it("should proxy description", () => {
      const agent = makeFullAgent();
      const adapter = new WritingAgentAdapter(agent);
      expect(adapter.description).toBe("A test writing agent");
    });

    it("should proxy supportedModes", () => {
      const agent = makeFullAgent();
      const adapter = new WritingAgentAdapter(agent);
      expect(adapter.supportedModes).toEqual(["reactive", "hybrid"]);
    });

    it("should proxy capabilities", () => {
      const agent = makeFullAgent();
      const adapter = new WritingAgentAdapter(agent);
      expect(adapter.capabilities).toHaveLength(1);
      expect(adapter.capabilities[0].id).toBe("creative-writing");
    });

    it("should proxy requiredTools", () => {
      const agent = makeFullAgent();
      const adapter = new WritingAgentAdapter(agent);
      expect(adapter.requiredTools).toEqual(["text-generation"]);
    });

    it("should proxy requiredSkills", () => {
      const agent = makeFullAgent();
      const adapter = new WritingAgentAdapter(agent);
      expect(adapter.requiredSkills).toEqual(["writing-v1"]);
    });

    it("should proxy version", () => {
      const agent = makeFullAgent();
      const adapter = new WritingAgentAdapter(agent);
      expect(adapter.version).toBe("2.0.0");
    });
  });

  // ==================== execute ====================

  describe("execute", () => {
    it("should delegate to writingAgent.execute", async () => {
      const agent = makeFullAgent();
      const adapter = new WritingAgentAdapter(agent);
      const context = makeAgentContext();

      const result = await adapter.execute(
        { prompt: "write something" },
        context,
      );

      expect(agent.execute).toHaveBeenCalledWith(
        { prompt: "write something" },
        context,
      );
      expect(result.success).toBe(true);
    });
  });

  // ==================== executeStream ====================

  describe("executeStream", () => {
    it("should fall back to execute when writeAgent does not have executeStream", async () => {
      const agent = makeFullAgent(); // no executeStream
      const adapter = new WritingAgentAdapter(agent);
      const context = makeAgentContext();

      const generator = adapter.executeStream(
        { prompt: "stream test" },
        context,
      );

      // Consuming the generator should return the final result
      const result = await generator.next();
      // First next() on fallback returns the 'return' value (done = true)
      expect(result.done).toBe(true);
    });

    it("should forward stream events when agent has executeStream", async () => {
      async function* mockStream() {
        yield { type: "progress", data: "writing..." };
      }

      const agent = makeFullAgent({
        executeStream: jest.fn().mockReturnValue(mockStream()),
      });
      const adapter = new WritingAgentAdapter(agent);
      const context = makeAgentContext();

      const events: unknown[] = [];
      const gen = adapter.executeStream({ prompt: "stream" }, context);

      for await (const event of gen) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect((events[0] as { type: string }).type).toBe("progress");
    });
  });

  // ==================== plan ====================

  describe("plan", () => {
    it("should return empty plan when agent does not support plan()", async () => {
      const agent = makeFullAgent(); // no plan method
      const adapter = new WritingAgentAdapter(agent);
      const context = makeAgentContext();

      const plan = await adapter.plan({ task: "write chapter" }, context);

      expect(plan.id).toBe("exec-1");
      expect(plan.agentId).toBe("test-agent");
      expect(plan.steps).toHaveLength(0);
    });

    it("should delegate to agent.plan when available", async () => {
      const customPlan = {
        id: "plan-1",
        agentId: "test-agent",
        steps: [{ id: "s1", name: "Write", type: "task" as const }],
      };
      const agent = makeFullAgent({
        plan: jest.fn().mockResolvedValue(customPlan),
      });
      const adapter = new WritingAgentAdapter(agent);
      const context = makeAgentContext();

      const plan = await adapter.plan({ task: "write" }, context);

      expect(plan.steps).toHaveLength(1);
      expect(agent.plan).toHaveBeenCalled();
    });
  });

  // ==================== validateInput ====================

  describe("validateInput", () => {
    it("should return valid=true when agent does not support validateInput", () => {
      const agent = makeFullAgent(); // no validateInput
      const adapter = new WritingAgentAdapter(agent);

      const result = adapter.validateInput({ prompt: "test" });

      expect(result.valid).toBe(true);
    });

    it("should delegate to agent.validateInput when available", () => {
      const agent = makeFullAgent({
        validateInput: jest.fn().mockReturnValue({
          valid: false,
          errors: ["Missing required field"],
        }),
      });
      const adapter = new WritingAgentAdapter(agent);

      const result = adapter.validateInput({});

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required field");
      expect(agent.validateInput).toHaveBeenCalled();
    });
  });
});
