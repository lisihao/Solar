/**
 * Tests for PlanBasedAgentRegistry
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { PlanBasedAgentRegistry } from "../plan-based-agent-registry";
import { IPlanBasedAgent } from "../../base/plan-based-agent";
import {
  AgentConfig,
  AgentId,
  AgentPlan,
} from "@/modules/ai-harness/agents/abstractions/agent.types";

// ---------------------------------------------------------------------------
// Helper: create a mock IPlanBasedAgent
// ---------------------------------------------------------------------------

function makeAgent(id: AgentId, name = `Agent ${id}`): IPlanBasedAgent {
  const config: AgentConfig = {
    id,
    name,
    description: `Description of ${name}`,
    icon: "icon",
    color: "#000",
    capabilities: ["cap-1"],
    templates: [],
    selectionKeywords: [name.toLowerCase()],
  };

  return {
    id,
    name,
    description: config.description,
    capabilities: config.capabilities,
    requiredTools: [],
    plan: jest.fn().mockResolvedValue({} as AgentPlan),
    execute: jest.fn().mockReturnValue(
      (async function* () {
        return;
      })(),
    ),
    getTemplates: jest.fn().mockReturnValue([]),
    getConfig: jest.fn().mockReturnValue(config),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PlanBasedAgentRegistry", () => {
  let registry: PlanBasedAgentRegistry;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, "log").mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, "warn").mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [PlanBasedAgentRegistry],
    }).compile();

    registry = module.get<PlanBasedAgentRegistry>(PlanBasedAgentRegistry);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // register
  // -------------------------------------------------------------------------

  describe("register", () => {
    it("registers an agent successfully", () => {
      const agent = makeAgent("agent-1");
      registry.register(agent);

      expect(registry.has("agent-1")).toBe(true);
      expect(registry.size()).toBe(1);
    });

    it("skips re-registration when agent is already registered", () => {
      const agent = makeAgent("agent-dup");
      registry.register(agent);
      registry.register(agent); // second call should be ignored

      expect(registry.size()).toBe(1);
    });

    it("updates stats.total after registration", () => {
      registry.register(makeAgent("a1"));
      registry.register(makeAgent("a2"));

      expect(registry.getStats().total).toBe(2);
    });

    it("creates byId entry with zero counters", () => {
      registry.register(makeAgent("new-agent"));

      const stats = registry.getStats();
      expect(stats.byId["new-agent"]).toEqual({ executions: 0, errors: 0 });
    });
  });

  // -------------------------------------------------------------------------
  // has
  // -------------------------------------------------------------------------

  describe("has", () => {
    it("returns false for an unknown agent", () => {
      expect(registry.has("ghost")).toBe(false);
    });

    it("returns true after the agent is registered", () => {
      registry.register(makeAgent("known"));
      expect(registry.has("known")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------

  describe("get", () => {
    it("returns the agent when found", () => {
      const agent = makeAgent("found");
      registry.register(agent);

      expect(registry.get("found")).toBe(agent);
    });

    it("throws when agent is not found", () => {
      expect(() => registry.get("missing")).toThrow(/not found/i);
    });
  });

  // -------------------------------------------------------------------------
  // tryGet
  // -------------------------------------------------------------------------

  describe("tryGet", () => {
    it("returns the agent when found", () => {
      const agent = makeAgent("try-agent");
      registry.register(agent);

      expect(registry.tryGet("try-agent")).toBe(agent);
    });

    it("returns undefined when not found", () => {
      expect(registry.tryGet("nope")).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // size
  // -------------------------------------------------------------------------

  describe("size", () => {
    it("returns 0 initially", () => {
      expect(registry.size()).toBe(0);
    });

    it("reflects registered count accurately", () => {
      registry.register(makeAgent("x1"));
      registry.register(makeAgent("x2"));
      registry.register(makeAgent("x3"));
      expect(registry.size()).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // getAll
  // -------------------------------------------------------------------------

  describe("getAll", () => {
    it("returns an empty array initially", () => {
      expect(registry.getAll()).toEqual([]);
    });

    it("returns all registered agents", () => {
      const a1 = makeAgent("a1");
      const a2 = makeAgent("a2");
      registry.register(a1);
      registry.register(a2);

      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all).toContain(a1);
      expect(all).toContain(a2);
    });
  });

  // -------------------------------------------------------------------------
  // getAllIds
  // -------------------------------------------------------------------------

  describe("getAllIds", () => {
    it("returns an empty array initially", () => {
      expect(registry.getAllIds()).toEqual([]);
    });

    it("returns all registered agent IDs", () => {
      registry.register(makeAgent("id-1"));
      registry.register(makeAgent("id-2"));

      expect(registry.getAllIds()).toContain("id-1");
      expect(registry.getAllIds()).toContain("id-2");
    });
  });

  // -------------------------------------------------------------------------
  // getAllConfigs
  // -------------------------------------------------------------------------

  describe("getAllConfigs", () => {
    it("returns configs by calling getConfig on each agent", () => {
      const a1 = makeAgent("cfg-agent-1");
      const a2 = makeAgent("cfg-agent-2");
      registry.register(a1);
      registry.register(a2);

      const configs = registry.getAllConfigs();
      expect(configs).toHaveLength(2);
      expect(configs[0].id).toBe("cfg-agent-1");
    });
  });

  // -------------------------------------------------------------------------
  // getConfig
  // -------------------------------------------------------------------------

  describe("getConfig", () => {
    it("returns the agent's config when found", () => {
      const agent = makeAgent("with-config");
      registry.register(agent);

      const config = registry.getConfig("with-config");
      expect(config).toBeDefined();
      expect(config?.id).toBe("with-config");
    });

    it("returns undefined when agent is not found", () => {
      expect(registry.getConfig("no-such-agent")).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getStats
  // -------------------------------------------------------------------------

  describe("getStats", () => {
    it("returns a copy of stats (not the internal reference)", () => {
      registry.register(makeAgent("s1"));
      const stats = registry.getStats();
      stats.total = 999;

      expect(registry.getStats().total).toBe(1);
    });

    it("byId entries are deep copies", () => {
      registry.register(makeAgent("s2"));
      const stats = registry.getStats();
      stats.byId["s2"].executions = 999;

      expect(registry.getStats().byId["s2"].executions).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // recordExecution
  // -------------------------------------------------------------------------

  describe("recordExecution", () => {
    it("increments executions counter on success", () => {
      registry.register(makeAgent("exec-agent"));
      registry.recordExecution("exec-agent", true);

      expect(registry.getStats().byId["exec-agent"].executions).toBe(1);
      expect(registry.getStats().byId["exec-agent"].errors).toBe(0);
    });

    it("increments both executions and errors counter on failure", () => {
      registry.register(makeAgent("fail-agent"));
      registry.recordExecution("fail-agent", false);
      registry.recordExecution("fail-agent", false);

      const stats = registry.getStats();
      expect(stats.byId["fail-agent"].executions).toBe(2);
      expect(stats.byId["fail-agent"].errors).toBe(2);
    });

    it("does nothing when agentId is not in stats", () => {
      expect(() => registry.recordExecution("phantom", true)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // clear
  // -------------------------------------------------------------------------

  describe("clear", () => {
    it("removes all agents and resets stats", () => {
      registry.register(makeAgent("c1"));
      registry.register(makeAgent("c2"));

      registry.clear();

      expect(registry.size()).toBe(0);
      expect(registry.getAll()).toEqual([]);
      expect(registry.getStats().total).toBe(0);
      expect(registry.getStats().byId).toEqual({});
    });

    it("allows re-registration after clear", () => {
      registry.register(makeAgent("clearable"));
      registry.clear();
      registry.register(makeAgent("clearable"));

      expect(registry.has("clearable")).toBe(true);
    });
  });
});
