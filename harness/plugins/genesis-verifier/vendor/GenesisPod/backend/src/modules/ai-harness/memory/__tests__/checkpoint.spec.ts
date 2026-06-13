/**
 * InMemoryCheckpointStore / AgentStepCheckpointService structural tests
 *
 * Goals:
 *   1. InMemoryCheckpointStore instantiates and all ICheckpointStore methods are present.
 *   2. save → load → listByAgent → delete lifecycle works correctly.
 *   3. AgentStepCheckpointService instantiates with default (in-memory) store.
 *   4. snapshot() produces a valid ICheckpoint with all required fields.
 *   5. latestForAgent() returns the most recently taken checkpoint.
 *   6. listForAgent() returns all checkpoints in insertion order.
 *   7. load() returns null for an unknown id.
 */

import { InMemoryCheckpointStore } from "../checkpoint/in-memory-checkpoint-store";
import { AgentStepCheckpointService } from "../checkpoint/agent-step-checkpoint.service";
import type {
  ICheckpointStore,
  ICheckpoint,
} from "../checkpoint/checkpoint.types";
import type {
  IAgentIdentity,
  IContextEnvelope,
} from "../../agents/abstractions";

// ---------------------------------------------------------------------------
// Minimal stubs for the types that checkpoint relies on
// ---------------------------------------------------------------------------

function makeIdentity(id: string): IAgentIdentity {
  return {
    id,
    name: `Agent-${id}`,
    role: "worker",
    capabilities: [],
  } as unknown as IAgentIdentity;
}

function makeEnvelope(): IContextEnvelope {
  return {
    messages: [],
    systemPrompt: "test-system",
  } as unknown as IContextEnvelope;
}

// ---------------------------------------------------------------------------
// InMemoryCheckpointStore
// ---------------------------------------------------------------------------

describe("InMemoryCheckpointStore", () => {
  let store: InMemoryCheckpointStore;

  beforeEach(() => {
    store = new InMemoryCheckpointStore();
  });

  it("instantiates without throwing", () => {
    expect(store).toBeInstanceOf(InMemoryCheckpointStore);
  });

  it("satisfies ICheckpointStore structural contract", () => {
    const typed: ICheckpointStore = store;
    expect(typeof typed.save).toBe("function");
    expect(typeof typed.load).toBe("function");
    expect(typeof typed.listByAgent).toBe("function");
    expect(typeof typed.delete).toBe("function");
    expect(typeof typed.clear).toBe("function");
  });

  it("starts empty — size() returns 0", () => {
    expect(store.size()).toBe(0);
  });

  it("save() persists a checkpoint retrievable by load()", async () => {
    const cp: ICheckpoint = {
      id: "cp-1",
      agentId: "agent-a",
      takenAt: Date.now(),
      reason: "manual",
      agentState: "idle" as never,
      envelope: makeEnvelope(),
      identity: makeIdentity("agent-a"),
      eventsEmitted: 0,
    };
    await store.save(cp);
    const loaded = await store.load("cp-1");
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe("cp-1");
    expect(loaded?.agentId).toBe("agent-a");
  });

  it("load() returns null for an unknown id", async () => {
    expect(await store.load("nonexistent")).toBeNull();
  });

  it("listByAgent() returns checkpoints for a given agent in insertion order", async () => {
    const cpA1: ICheckpoint = {
      id: "cp-a1",
      agentId: "agent-a",
      takenAt: 1000,
      reason: "auto-interval",
      agentState: "idle" as never,
      envelope: makeEnvelope(),
      identity: makeIdentity("agent-a"),
      eventsEmitted: 1,
    };
    const cpA2: ICheckpoint = {
      id: "cp-a2",
      agentId: "agent-a",
      takenAt: 2000,
      reason: "key-event",
      agentState: "idle" as never,
      envelope: makeEnvelope(),
      identity: makeIdentity("agent-a"),
      eventsEmitted: 2,
    };
    const cpB: ICheckpoint = {
      id: "cp-b1",
      agentId: "agent-b",
      takenAt: 1500,
      reason: "manual",
      agentState: "idle" as never,
      envelope: makeEnvelope(),
      identity: makeIdentity("agent-b"),
      eventsEmitted: 0,
    };
    await store.save(cpA1);
    await store.save(cpA2);
    await store.save(cpB);

    const listA = await store.listByAgent("agent-a");
    expect(listA).toHaveLength(2);
    expect(listA.map((c) => c.id)).toEqual(["cp-a1", "cp-a2"]);

    const listB = await store.listByAgent("agent-b");
    expect(listB).toHaveLength(1);
    expect(listB[0].id).toBe("cp-b1");
  });

  it("listByAgent() returns empty array for unknown agent", async () => {
    const list = await store.listByAgent("ghost");
    expect(list).toHaveLength(0);
  });

  it("delete() removes the checkpoint from both indexes", async () => {
    const cp: ICheckpoint = {
      id: "del-1",
      agentId: "agent-c",
      takenAt: Date.now(),
      reason: "pre-terminate",
      agentState: "idle" as never,
      envelope: makeEnvelope(),
      identity: makeIdentity("agent-c"),
      eventsEmitted: 0,
    };
    await store.save(cp);
    expect(store.size()).toBe(1);

    await store.delete("del-1");
    expect(store.size()).toBe(0);
    expect(await store.load("del-1")).toBeNull();
    expect(await store.listByAgent("agent-c")).toHaveLength(0);
  });

  it("delete() is a no-op for unknown id (does not throw)", async () => {
    await expect(store.delete("never-existed")).resolves.toBeUndefined();
  });

  it("clear() removes all checkpoints", async () => {
    await store.save({
      id: "x",
      agentId: "a",
      takenAt: 1,
      reason: "manual",
      agentState: "idle" as never,
      envelope: makeEnvelope(),
      identity: makeIdentity("a"),
      eventsEmitted: 0,
    });
    await store.clear();
    expect(store.size()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AgentStepCheckpointService
// ---------------------------------------------------------------------------

describe("AgentStepCheckpointService", () => {
  let svc: AgentStepCheckpointService;

  beforeEach(() => {
    // Inject in-memory store directly so tests are isolated from Prisma
    svc = new AgentStepCheckpointService(new InMemoryCheckpointStore());
  });

  it("instantiates without throwing (default in-memory store)", () => {
    const defaultSvc = new AgentStepCheckpointService();
    expect(defaultSvc).toBeInstanceOf(AgentStepCheckpointService);
  });

  it("snapshot() produces a valid ICheckpoint with all required fields", async () => {
    const cp = await svc.snapshot({
      agentId: "agent-x",
      agentState: "idle" as never,
      envelope: makeEnvelope(),
      identity: makeIdentity("agent-x"),
      eventsEmitted: 5,
      reason: "manual",
      taskSnapshot: { goal: "do something" },
    });

    expect(typeof cp.id).toBe("string");
    expect(cp.id.length).toBeGreaterThan(0);
    expect(cp.agentId).toBe("agent-x");
    expect(typeof cp.takenAt).toBe("number");
    expect(cp.reason).toBe("manual");
    expect(cp.eventsEmitted).toBe(5);
    expect(cp.taskSnapshot?.goal).toBe("do something");
  });

  it("load() returns null for unknown id", async () => {
    expect(await svc.load("nonexistent")).toBeNull();
  });

  it("load() returns the checkpoint by id after snapshot()", async () => {
    const cp = await svc.snapshot({
      agentId: "agent-y",
      agentState: "idle" as never,
      envelope: makeEnvelope(),
      identity: makeIdentity("agent-y"),
      eventsEmitted: 0,
      reason: "auto-interval",
    });
    const loaded = await svc.load(cp.id);
    expect(loaded?.id).toBe(cp.id);
  });

  it("latestForAgent() returns null when no checkpoints exist", async () => {
    expect(await svc.latestForAgent("unknown-agent")).toBeNull();
  });

  it("latestForAgent() returns the checkpoint with the highest takenAt", async () => {
    // We control time ordering via the checkpoint store directly
    const store = new InMemoryCheckpointStore();
    const service = new AgentStepCheckpointService(store);

    const cp1 = await service.snapshot({
      agentId: "agent-z",
      agentState: "idle" as never,
      envelope: makeEnvelope(),
      identity: makeIdentity("agent-z"),
      eventsEmitted: 1,
      reason: "auto-interval",
    });

    // Small delay so takenAt is strictly greater
    await new Promise((resolve) => setTimeout(resolve, 5));

    const cp2 = await service.snapshot({
      agentId: "agent-z",
      agentState: "idle" as never,
      envelope: makeEnvelope(),
      identity: makeIdentity("agent-z"),
      eventsEmitted: 2,
      reason: "key-event",
    });

    const latest = await service.latestForAgent("agent-z");
    expect(latest?.id).toBe(cp2.id);
    expect(latest?.takenAt).toBeGreaterThanOrEqual(cp1.takenAt);
  });

  it("listForAgent() returns all checkpoints for the agent", async () => {
    await svc.snapshot({
      agentId: "agent-w",
      agentState: "idle" as never,
      envelope: makeEnvelope(),
      identity: makeIdentity("agent-w"),
      eventsEmitted: 0,
      reason: "manual",
    });
    await svc.snapshot({
      agentId: "agent-w",
      agentState: "idle" as never,
      envelope: makeEnvelope(),
      identity: makeIdentity("agent-w"),
      eventsEmitted: 1,
      reason: "pre-cancel",
    });

    const list = await svc.listForAgent("agent-w");
    expect(list).toHaveLength(2);
  });

  it("listForAgent() returns empty array for unknown agent", async () => {
    const list = await svc.listForAgent("nobody");
    expect(list).toHaveLength(0);
  });

  it("all CheckpointReason values are accepted by snapshot()", async () => {
    const reasons: Array<
      "auto-interval" | "key-event" | "manual" | "pre-cancel" | "pre-terminate"
    > = ["auto-interval", "key-event", "manual", "pre-cancel", "pre-terminate"];
    for (const reason of reasons) {
      await expect(
        svc.snapshot({
          agentId: "agent-reasons",
          agentState: "idle" as never,
          envelope: makeEnvelope(),
          identity: makeIdentity("agent-reasons"),
          eventsEmitted: 0,
          reason,
        }),
      ).resolves.not.toThrow();
    }
  });
});
