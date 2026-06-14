/**
 * AgentRegistry + HandoffService 单测 (PR-R)
 */

import { AgentRegistry } from "../agent-registry";
import { HandoffService } from "../handoff.service";
import { ContextEnvelope } from "@/modules/ai-harness/agents/core/context-envelope";
import type {
  IAgent,
  IContextEnvelope,
} from "@/modules/ai-harness/agents/abstractions";

function mkAgent(id: string): IAgent {
  const env = new ContextEnvelope({
    system: "x",
    messages: [],
    reminders: [],
    tools: [],
    memory: { sessionId: id },
    budget: {
      tokensUsed: 0,
      tokensRemaining: 0,
      iterationsUsed: 0,
      iterationsRemaining: 0,
      wallTimeStartMs: 0,
    },
  });
  return {
    id,
    identity: { role: { id: "r", name: "R", description: "" } } as never,
    state: "idle" as const,
    execute: async function* () {
      yield {
        type: "terminated" as const,
        agentId: id,
        timestamp: 0,
        payload: { reason: "completed" as const },
      };
    },
    spawnSubagent: jest.fn(),
    getEnvelope: () => env as IContextEnvelope,
    cancel: jest.fn(),
  };
}

describe("AgentRegistry (PR-R)", () => {
  it("register / get / unregister", () => {
    const reg = new AgentRegistry();
    const a = mkAgent("a1");
    reg.register(a);
    expect(reg.has("a1")).toBe(true);
    expect(reg.get("a1")).toBe(a);
    reg.unregister("a1");
    expect(reg.has("a1")).toBe(false);
  });

  it("size / ids", () => {
    const reg = new AgentRegistry();
    reg.register(mkAgent("a"));
    reg.register(mkAgent("b"));
    expect(reg.size()).toBe(2);
    expect(reg.ids().sort()).toEqual(["a", "b"]);
  });
});

describe("HandoffService (PR-R)", () => {
  it("rejects when target not in registry", async () => {
    const reg = new AgentRegistry();
    const svc = new HandoffService(reg);
    const from = mkAgent("from");
    const r = await svc.handoff(from, {
      fromAgentId: "from",
      toAgentId: "ghost",
      reason: "test",
    });
    expect(r.accepted).toBe(false);
    expect(r.rejectedReason).toMatch(/ghost/);
  });

  it("rejects self-handoff", async () => {
    const reg = new AgentRegistry();
    const svc = new HandoffService(reg);
    const a = mkAgent("a");
    reg.register(a);
    const r = await svc.handoff(a, {
      fromAgentId: "a",
      toAgentId: "a",
      reason: "loop",
    });
    expect(r.accepted).toBe(false);
    expect(r.rejectedReason).toMatch(/self/);
  });

  it("accepts and returns envelope with handoff reminder", async () => {
    const reg = new AgentRegistry();
    const svc = new HandoffService(reg);
    const from = mkAgent("from");
    const to = mkAgent("to");
    reg.register(to);
    const r = await svc.handoff(from, {
      fromAgentId: "from",
      toAgentId: "to",
      reason: "escalation",
      handoverMessage: "user is angry",
    });
    expect(r.accepted).toBe(true);
    expect(r.handoverEnvelope).toBeDefined();
    const reminders = r
      .handoverEnvelope!.reminders.map((x) => x.content)
      .join("\n");
    expect(reminders).toMatch(/handoff from from/);
    expect(reminders).toMatch(/escalation/);
    expect(reminders).toMatch(/user is angry/);
  });
});
