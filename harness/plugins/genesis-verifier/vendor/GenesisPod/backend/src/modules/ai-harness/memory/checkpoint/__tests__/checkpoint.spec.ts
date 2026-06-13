/**
 * AgentStepCheckpointService + InMemoryStore 单元测试
 */

import { AgentStepCheckpointService } from "../agent-step-checkpoint.service";
import { InMemoryCheckpointStore } from "../in-memory-checkpoint-store";
import { ContextEnvelope } from "../../../agents/core/context-envelope";
import { AgentIdentity } from "../../../agents/core/agent-identity";

function makeEnvelope(): ContextEnvelope {
  return new ContextEnvelope({
    system: "sys",
    messages: [{ role: "user", content: "hello", timestamp: 0 }],
    reminders: [],
    tools: [],
    memory: { sessionId: "s1", userId: "u1" },
    budget: {
      tokensUsed: 100,
      tokensRemaining: 900,
      iterationsUsed: 2,
      iterationsRemaining: 18,
      wallTimeStartMs: Date.now() - 1000,
    },
  });
}

const identity = AgentIdentity.of({
  id: "test-role",
  name: "Test",
  description: "d",
});

describe("InMemoryCheckpointStore", () => {
  it("stores and retrieves by id", async () => {
    const store = new InMemoryCheckpointStore();
    const cp = {
      id: "cp-1",
      agentId: "a-1",
      takenAt: Date.now(),
      reason: "manual" as const,
      agentState: "running" as const,
      envelope: makeEnvelope(),
      identity,
      eventsEmitted: 5,
    };
    await store.save(cp);
    const loaded = await store.load("cp-1");
    expect(loaded).toEqual(cp);
  });

  it("lists by agent and deletes", async () => {
    const store = new InMemoryCheckpointStore();
    for (let i = 0; i < 3; i += 1) {
      await store.save({
        id: `cp-${i}`,
        agentId: "a-1",
        takenAt: Date.now() + i,
        reason: "auto-interval",
        agentState: "running",
        envelope: makeEnvelope(),
        identity,
        eventsEmitted: i,
      });
    }
    const list = await store.listByAgent("a-1");
    expect(list).toHaveLength(3);

    await store.delete("cp-0");
    const after = await store.listByAgent("a-1");
    expect(after).toHaveLength(2);
    expect(after.find((c) => c.id === "cp-0")).toBeUndefined();
  });

  it("clear removes all", async () => {
    const store = new InMemoryCheckpointStore();
    await store.save({
      id: "cp-1",
      agentId: "a-1",
      takenAt: Date.now(),
      reason: "manual",
      agentState: "running",
      envelope: makeEnvelope(),
      identity,
      eventsEmitted: 0,
    });
    await store.clear();
    expect(store.size()).toBe(0);
  });
});

describe("AgentStepCheckpointService", () => {
  it("snapshot stores and returns new checkpoint with id + timestamp", async () => {
    const svc = new AgentStepCheckpointService();
    const cp = await svc.snapshot({
      agentId: "a1",
      agentState: "running",
      envelope: makeEnvelope(),
      identity,
      eventsEmitted: 3,
      reason: "manual",
      taskSnapshot: { goal: "test goal" },
    });
    expect(cp.id).toBeDefined();
    expect(cp.agentId).toBe("a1");
    expect(cp.eventsEmitted).toBe(3);
    expect(cp.taskSnapshot?.goal).toBe("test goal");
    expect(cp.takenAt).toBeGreaterThan(0);
  });

  it("latestForAgent returns most recent", async () => {
    const svc = new AgentStepCheckpointService();
    const first = await svc.snapshot({
      agentId: "a1",
      agentState: "running",
      envelope: makeEnvelope(),
      identity,
      eventsEmitted: 1,
      reason: "auto-interval",
    });
    await new Promise((r) => setTimeout(r, 10)); // ensure distinct takenAt
    const second = await svc.snapshot({
      agentId: "a1",
      agentState: "running",
      envelope: makeEnvelope(),
      identity,
      eventsEmitted: 2,
      reason: "auto-interval",
    });
    const latest = await svc.latestForAgent("a1");
    expect(latest?.id).toBe(second.id);
    expect(latest?.id).not.toBe(first.id);
  });

  it("load by id", async () => {
    const svc = new AgentStepCheckpointService();
    const cp = await svc.snapshot({
      agentId: "a1",
      agentState: "running",
      envelope: makeEnvelope(),
      identity,
      eventsEmitted: 0,
      reason: "manual",
    });
    const loaded = await svc.load(cp.id);
    expect(loaded?.id).toBe(cp.id);
  });

  it("returns null when no checkpoint exists", async () => {
    const svc = new AgentStepCheckpointService();
    expect(await svc.latestForAgent("no-such-agent")).toBeNull();
    expect(await svc.load("no-such-id")).toBeNull();
  });
});
