/**
 * AgentRegistry (handoffs) structural tests
 *
 * Goals:
 *   1. Class instantiates without throwing.
 *   2. register() / get() / has() / size() / ids() lifecycle is correct.
 *   3. unregister() removes agents cleanly.
 *   4. Re-registering the same id emits a warn (does not throw) and overwrites.
 */

import { AgentRegistry } from "../agent-registry";
import type { IAgent } from "@/modules/ai-harness/agents/abstractions";

// Minimal stub of IAgent that only needs the id property
function makeAgent(id: string): IAgent {
  return {
    id,
    getEnvelope: jest.fn(),
    execute: jest.fn(),
  } as unknown as IAgent;
}

// Silence Logger in tests
jest.mock("@nestjs/common", () => {
  const actual = jest.requireActual("@nestjs/common");
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    Logger: jest.fn().mockImplementation(() => ({
      log: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    })),
  };
});

describe("AgentRegistry (handoffs)", () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  it("instantiates without throwing", () => {
    expect(registry).toBeInstanceOf(AgentRegistry);
  });

  it("starts empty — size() returns 0 and ids() is empty", () => {
    expect(registry.size()).toBe(0);
    expect(registry.ids()).toHaveLength(0);
  });

  it("register() adds an agent and size() increments", () => {
    registry.register(makeAgent("agent-1"));
    expect(registry.size()).toBe(1);
  });

  it("get() returns the registered agent by id", () => {
    const agent = makeAgent("agent-2");
    registry.register(agent);
    const retrieved = registry.get("agent-2");
    expect(retrieved).toBe(agent);
  });

  it("get() returns undefined for an unknown id", () => {
    expect(registry.get("ghost")).toBeUndefined();
  });

  it("has() returns true for a registered agent and false otherwise", () => {
    registry.register(makeAgent("agent-3"));
    expect(registry.has("agent-3")).toBe(true);
    expect(registry.has("not-there")).toBe(false);
  });

  it("ids() returns all registered agent ids", () => {
    registry.register(makeAgent("a1"));
    registry.register(makeAgent("a2"));
    registry.register(makeAgent("a3"));
    const ids = [...registry.ids()].sort();
    expect(ids).toEqual(["a1", "a2", "a3"]);
  });

  it("unregister() removes an agent and size() decrements", () => {
    registry.register(makeAgent("to-remove"));
    registry.unregister("to-remove");
    expect(registry.size()).toBe(0);
    expect(registry.has("to-remove")).toBe(false);
    expect(registry.get("to-remove")).toBeUndefined();
  });

  it("unregister() for unknown id is a no-op (does not throw)", () => {
    expect(() => registry.unregister("nonexistent")).not.toThrow();
    expect(registry.size()).toBe(0);
  });

  it("re-registering the same id overwrites the previous agent (does not throw)", () => {
    const agent1 = makeAgent("dup");
    const agent2 = makeAgent("dup");
    registry.register(agent1);
    // Should warn but not throw:
    expect(() => registry.register(agent2)).not.toThrow();
    // Size should still be 1 (overwrite, not duplicate)
    expect(registry.size()).toBe(1);
    expect(registry.get("dup")).toBe(agent2);
  });

  it("multiple agents can be registered and retrieved independently", () => {
    const agents = ["x", "y", "z"].map((id) => makeAgent(id));
    agents.forEach((a) => registry.register(a));
    expect(registry.size()).toBe(3);
    agents.forEach((a) => {
      expect(registry.get(a.id)).toBe(a);
    });
  });
});
