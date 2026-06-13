/**
 * AgentEventStore — extra branch coverage for appendBatch + payload edge cases
 */

import { AgentEventStore } from "../agent-event-store";

function mkPrisma() {
  const store: Array<{
    id: string;
    agentId: string;
    seq: number;
    type: string;
    payload: unknown;
    traceId?: string | null;
    spanId?: string | null;
    emittedAt: Date;
  }> = [];

  let idCounter = 0;

  return {
    store,
    harnessAgentEvent: {
      findFirst: jest.fn(async (args: { where: { agentId: string } }) => {
        const agentRows = store
          .filter((r) => r.agentId === args.where.agentId)
          .sort((a, b) => b.seq - a.seq);
        return agentRows.length > 0 ? { seq: agentRows[0].seq } : null;
      }),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        const row = {
          id: `id-${++idCounter}`,
          agentId: args.data.agentId as string,
          seq: args.data.seq as number,
          type: args.data.type as string,
          payload: args.data.payload,
          traceId: (args.data.traceId as string | null) ?? null,
          spanId: (args.data.spanId as string | null) ?? null,
          emittedAt: args.data.emittedAt as Date,
        };
        store.push(row);
        return row;
      }),
      createMany: jest.fn(async (args: { data: Record<string, unknown>[] }) => {
        for (const d of args.data) {
          store.push({
            id: `id-${++idCounter}`,
            agentId: d.agentId as string,
            seq: d.seq as number,
            type: d.type as string,
            payload: d.payload,
            traceId: (d.traceId as string | null) ?? null,
            spanId: (d.spanId as string | null) ?? null,
            emittedAt: d.emittedAt as Date,
          });
        }
        return { count: args.data.length };
      }),
      findMany: jest.fn(
        async (args: {
          where: { agentId?: string; seq?: { in?: number[]; gte?: number } };
          select?: unknown;
          orderBy?: unknown;
          take?: number;
        }) => {
          let rows = store;
          if (args.where.agentId) {
            rows = rows.filter((r) => r.agentId === args.where.agentId);
          }
          if (args.where.seq?.in) {
            rows = rows.filter((r) => args.where.seq!.in!.includes(r.seq));
          }
          if (args.where.seq?.gte != null) {
            rows = rows.filter((r) => r.seq >= args.where.seq!.gte!);
          }
          rows = [...rows].sort((a, b) => a.seq - b.seq);
          if (args.take != null) rows = rows.slice(0, args.take);
          return rows;
        },
      ),
      deleteMany: jest.fn(async (args: { where: { agentId: string } }) => {
        let count = 0;
        for (let i = store.length - 1; i >= 0; i--) {
          if (store[i].agentId === args.where.agentId) {
            store.splice(i, 1);
            count++;
          }
        }
        return { count };
      }),
    },
  };
}

describe("AgentEventStore — appendBatch", () => {
  it("returns empty array for empty batch", async () => {
    const prisma = mkPrisma();
    const store = new AgentEventStore(prisma as never);
    const result = await store.appendBatch([]);
    expect(result).toEqual([]);
  });

  it("appendBatch writes single agent events with correct seqs", async () => {
    const prisma = mkPrisma();
    const eventStore = new AgentEventStore(prisma as never);

    const events = [
      { type: "thinking", agentId: "a1", timestamp: 0, payload: { step: 1 } },
      {
        type: "output",
        agentId: "a1",
        timestamp: 1,
        payload: { output: "ok" },
      },
      {
        type: "terminated",
        agentId: "a1",
        timestamp: 2,
        payload: { reason: "done" },
      },
    ];

    const results = await eventStore.appendBatch(events);
    expect(results).toHaveLength(3);
    expect(results[0].seq).toBe(1);
    expect(results[1].seq).toBe(2);
    expect(results[2].seq).toBe(3);
    expect(results.map((r) => r.type)).toEqual([
      "thinking",
      "output",
      "terminated",
    ]);
  });

  it("appendBatch handles multiple agents in one batch", async () => {
    const prisma = mkPrisma();
    const eventStore = new AgentEventStore(prisma as never);

    const events = [
      { type: "thinking", agentId: "a1", timestamp: 0, payload: {} },
      { type: "thinking", agentId: "b1", timestamp: 0, payload: {} },
      { type: "output", agentId: "a1", timestamp: 1, payload: {} },
    ];

    const results = await eventStore.appendBatch(events);
    expect(results).toHaveLength(3);
    // a1 should have seqs 1 and 2
    const a1Results = results.filter((r) => r.agentId === "a1");
    const b1Results = results.filter((r) => r.agentId === "b1");
    expect(a1Results).toHaveLength(2);
    expect(b1Results).toHaveLength(1);
    expect(b1Results[0].seq).toBe(1);
  });

  it("appendBatch forwards traceId/spanId options", async () => {
    const prisma = mkPrisma();
    const eventStore = new AgentEventStore(prisma as never);

    const events = [
      { type: "thinking", agentId: "a1", timestamp: 0, payload: {} },
    ];

    const results = await eventStore.appendBatch(events, {
      traceId: "trace-123",
      spanId: "span-456",
    });
    expect(results[0].traceId).toBe("trace-123");
    expect(results[0].spanId).toBe("span-456");
  });

  it("appendBatch increments seq correctly when agent already has events", async () => {
    const prisma = mkPrisma();
    const eventStore = new AgentEventStore(prisma as never);

    // First append a single event to set the seq cache
    await eventStore.append({
      type: "init",
      agentId: "a1",
      timestamp: 0,
      payload: {},
    });

    // Now batch-append more events
    const events = [
      { type: "thinking", agentId: "a1", timestamp: 1, payload: {} },
      { type: "output", agentId: "a1", timestamp: 2, payload: {} },
    ];
    const results = await eventStore.appendBatch(events);
    expect(results[0].seq).toBe(2);
    expect(results[1].seq).toBe(3);
  });
});

describe("AgentEventStore — payload serialization", () => {
  it("handles string payload", async () => {
    const prisma = mkPrisma();
    const eventStore = new AgentEventStore(prisma as never);
    const result = await eventStore.append({
      type: "thinking",
      agentId: "a1",
      timestamp: 0,
      payload: "plain string payload",
    });
    expect(result.type).toBe("thinking");
  });

  it("handles number payload", async () => {
    const prisma = mkPrisma();
    const eventStore = new AgentEventStore(prisma as never);
    const result = await eventStore.append({
      type: "x",
      agentId: "a1",
      timestamp: 0,
      payload: 42,
    });
    expect(result.seq).toBe(1);
  });

  it("handles boolean payload", async () => {
    const prisma = mkPrisma();
    const eventStore = new AgentEventStore(prisma as never);
    const result = await eventStore.append({
      type: "x",
      agentId: "a1",
      timestamp: 0,
      payload: true,
    });
    expect(result.seq).toBe(1);
  });

  it("handles null payload gracefully", async () => {
    const prisma = mkPrisma();
    const eventStore = new AgentEventStore(prisma as never);
    const result = await eventStore.append({
      type: "x",
      agentId: "a1",
      timestamp: 0,
      payload: null,
    });
    expect(result.seq).toBe(1);
  });

  it("drops non-serializable payload (circular reference) without throwing", async () => {
    const prisma = mkPrisma();
    const eventStore = new AgentEventStore(prisma as never);
    const circular: Record<string, unknown> = {};
    circular.self = circular; // circular reference

    // Should not throw — toPlain catches it and returns { _dropped: true }
    const result = await eventStore.append({
      type: "x",
      agentId: "a1",
      timestamp: 0,
      payload: circular,
    });
    expect(result.seq).toBe(1);
  });
});

describe("AgentEventStore — readStream", () => {
  it("returns all events when no options given", async () => {
    const prisma = mkPrisma();
    const eventStore = new AgentEventStore(prisma as never);
    for (let i = 0; i < 3; i++) {
      await eventStore.append({
        type: "x",
        agentId: "a1",
        timestamp: i,
        payload: {},
      });
    }
    const results = await eventStore.readStream("a1");
    expect(results).toHaveLength(3);
  });
});
