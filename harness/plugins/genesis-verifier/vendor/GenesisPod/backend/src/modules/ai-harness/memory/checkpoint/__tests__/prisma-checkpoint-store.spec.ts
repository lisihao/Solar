/**
 * PrismaCheckpointStore — unit tests with mocked PrismaService
 */

import { PrismaCheckpointStore } from "../prisma-checkpoint-store";
import type { ICheckpoint } from "../checkpoint.types";
import type {
  IAgentIdentity,
  IContextEnvelope,
} from "../../../agents/abstractions";

function makeCheckpoint(overrides?: Partial<ICheckpoint>): ICheckpoint {
  const envelope: IContextEnvelope = {
    id: "env-1",
    system: "You are an agent",
    messages: [{ role: "user", content: "hello" }],
    reminders: [],
    tools: ["tool-a"],
    memory: { sessionId: "session-1" },
    budget: {
      tokensUsed: 100,
      tokensRemaining: 900,
      iterationsUsed: 1,
      iterationsRemaining: 9,
      wallTimeStartMs: Date.now(),
    },
    metadata: undefined,
  } as unknown as IContextEnvelope;

  const identity: IAgentIdentity = {
    role: { id: "agent-1", name: "Agent", description: "test agent" },
    persona: { voice: "analytical" },
    goal: { summary: "do something" },
    constraints: { maxTokens: 10000, maxIterations: 10 },
    skills: ["skill-a"],
    tools: ["tool-a"],
    forbiddenTools: ["forbidden"],
  } as unknown as IAgentIdentity;

  return {
    id: "ckpt-1",
    agentId: "agent-1",
    reason: "action",
    agentState: "running",
    envelope,
    identity,
    eventsEmitted: 5,
    taskSnapshot: { phase: "research" },
    takenAt: Date.now(),
    ...overrides,
  };
}

function makePrisma() {
  const createdRows = new Map<string, Record<string, unknown>>();
  return {
    harnessCheckpoint: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        createdRows.set(data.id as string, data);
        return data;
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = createdRows.get(where.id);
        if (!row) return null;
        return {
          ...row,
          takenAt: new Date((row.takenAt as number) ?? Date.now()),
        };
      }),
      findMany: jest.fn(async ({ where }: { where: { agentId: string } }) => {
        return [...createdRows.values()]
          .filter((r) => r.agentId === where.agentId)
          .map((r) => ({
            ...r,
            takenAt: new Date((r.takenAt as number) ?? Date.now()),
          }));
      }),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        if (!createdRows.has(where.id)) {
          const err = Object.assign(new Error("not found"), { code: "P2025" });
          throw err;
        }
        createdRows.delete(where.id);
        return {};
      }),
      deleteMany: jest.fn(async () => ({ count: createdRows.size })),
    },
  };
}

describe("PrismaCheckpointStore", () => {
  it("save calls prisma.create with serialized data", async () => {
    const prisma = makePrisma();
    const store = new PrismaCheckpointStore(prisma as never);
    const ckpt = makeCheckpoint();
    await store.save(ckpt);
    expect(prisma.harnessCheckpoint.create).toHaveBeenCalledTimes(1);
    const call = prisma.harnessCheckpoint.create.mock.calls[0][0];
    expect(call.data.id).toBe("ckpt-1");
    expect(call.data.agentId).toBe("agent-1");
    expect(call.data.eventsEmitted).toBe(5);
  });

  it("load returns null when not found", async () => {
    const prisma = makePrisma();
    const store = new PrismaCheckpointStore(prisma as never);
    const result = await store.load("nonexistent");
    expect(result).toBeNull();
  });

  it("load returns checkpoint when found", async () => {
    const prisma = makePrisma();
    const store = new PrismaCheckpointStore(prisma as never);
    const ckpt = makeCheckpoint();
    await store.save(ckpt);

    const loaded = await store.load("ckpt-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe("ckpt-1");
    expect(loaded!.agentId).toBe("agent-1");
    expect(loaded!.reason).toBe("action");
    expect(loaded!.eventsEmitted).toBe(5);
  });

  it("listByAgent returns checkpoints for given agent", async () => {
    const prisma = makePrisma();
    const store = new PrismaCheckpointStore(prisma as never);
    await store.save(makeCheckpoint({ id: "c1", agentId: "agent-a" }));
    await store.save(makeCheckpoint({ id: "c2", agentId: "agent-a" }));
    await store.save(makeCheckpoint({ id: "c3", agentId: "agent-b" }));

    const results = await store.listByAgent("agent-a");
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.agentId === "agent-a")).toBe(true);
  });

  it("delete removes a checkpoint (idempotent on P2025)", async () => {
    const prisma = makePrisma();
    const store = new PrismaCheckpointStore(prisma as never);
    await store.save(makeCheckpoint());
    await store.delete("ckpt-1");
    expect(await store.load("ckpt-1")).toBeNull();
  });

  it("delete is idempotent — P2025 is swallowed", async () => {
    const prisma = makePrisma();
    const store = new PrismaCheckpointStore(prisma as never);
    // delete without prior save → P2025 should be swallowed
    await expect(store.delete("not-exist")).resolves.toBeUndefined();
  });

  it("delete re-throws non-P2025 errors", async () => {
    const prisma = makePrisma();
    prisma.harnessCheckpoint.delete = jest.fn(async () => {
      throw Object.assign(new Error("db crash"), { code: "P9999" });
    });
    const store = new PrismaCheckpointStore(prisma as never);
    await expect(store.delete("any")).rejects.toThrow("db crash");
  });

  it("clear calls deleteMany in non-production", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    try {
      const prisma = makePrisma();
      const store = new PrismaCheckpointStore(prisma as never);
      await store.clear();
      expect(prisma.harnessCheckpoint.deleteMany).toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("clear refuses to run in production", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const prisma = makePrisma();
      const store = new PrismaCheckpointStore(prisma as never);
      await store.clear();
      expect(prisma.harnessCheckpoint.deleteMany).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("serializes envelope with minimal fields", async () => {
    const prisma = makePrisma();
    const store = new PrismaCheckpointStore(prisma as never);
    const ckpt = makeCheckpoint();
    await store.save(ckpt);
    const call = prisma.harnessCheckpoint.create.mock.calls[0][0];
    const envelope = call.data.envelope as Record<string, unknown>;
    expect(envelope.system).toBe("You are an agent");
    expect(envelope.tools).toEqual(["tool-a"]);
  });

  it("serializes identity correctly", async () => {
    const prisma = makePrisma();
    const store = new PrismaCheckpointStore(prisma as never);
    const ckpt = makeCheckpoint();
    await store.save(ckpt);
    const call = prisma.harnessCheckpoint.create.mock.calls[0][0];
    const identity = call.data.identity as Record<string, unknown>;
    expect((identity.role as Record<string, unknown>).id).toBe("agent-1");
    expect(identity.skills).toEqual(["skill-a"]);
    expect(identity.tools).toEqual(["tool-a"]);
    expect(identity.forbiddenTools).toEqual(["forbidden"]);
  });

  it("handles null/undefined optional fields on identity gracefully", async () => {
    const prisma = makePrisma();
    const store = new PrismaCheckpointStore(prisma as never);
    const ckpt = makeCheckpoint();
    // Remove optional identity fields
    const stripped = {
      ...ckpt,
      identity: {
        role: { id: "x", name: "X", description: "" },
        skills: undefined,
        tools: undefined,
        forbiddenTools: undefined,
        persona: undefined,
        goal: undefined,
        constraints: undefined,
      },
    };
    await store.save(stripped as unknown as ICheckpoint);
    const call = prisma.harnessCheckpoint.create.mock.calls[0][0];
    const identity = call.data.identity as Record<string, unknown>;
    expect(identity.skills).toEqual([]);
    expect(identity.tools).toEqual([]);
    expect(identity.forbiddenTools).toBeUndefined();
  });

  it("handles null taskSnapshot (stored as Prisma.JsonNull)", async () => {
    const prisma = makePrisma();
    const store = new PrismaCheckpointStore(prisma as never);
    const ckpt = makeCheckpoint({ taskSnapshot: undefined });
    await expect(store.save(ckpt)).resolves.toBeUndefined();
  });
});
