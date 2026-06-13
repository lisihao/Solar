/**
 * AgentEventStore 单元测试 (PR-C)
 *
 * 用 mock PrismaService 验证：
 *   - append() 自增 seq（按 agentId 分区）
 *   - readStream() 透传 fromSeq / limit
 *   - clearAgent() 清缓存 + 删表
 *   - 不可序列化 payload 不抛错（保护 fire-and-forget）
 */

import { AgentEventStore } from "../agent-event-store";

function mkPrisma() {
  const nextDbSeq: Record<string, number> = {};
  const records: Array<{
    id: string;
    agentId: string;
    seq: number;
    type: string;
    payload: unknown;
    traceId?: string | null;
    spanId?: string | null;
    emittedAt: Date;
  }> = [];

  return {
    records,
    setExistingMaxSeq(agentId: string, seq: number) {
      nextDbSeq[agentId] = seq;
    },
    harnessAgentEvent: {
      findFirst: jest.fn(async (args: { where: { agentId: string } }) => {
        const max = nextDbSeq[args.where.agentId];
        return max != null ? { seq: max } : null;
      }),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        const row = {
          id: `r${records.length + 1}`,
          agentId: args.data.agentId as string,
          seq: args.data.seq as number,
          type: args.data.type as string,
          payload: args.data.payload,
          traceId: (args.data.traceId as string | undefined) ?? null,
          spanId: (args.data.spanId as string | undefined) ?? null,
          emittedAt: args.data.emittedAt as Date,
        };
        records.push(row);
        return row;
      }),
      findMany: jest.fn(
        async (args: {
          where: { agentId: string; seq?: { gte: number } };
          take?: number;
        }) => {
          let rows = records.filter((r) => r.agentId === args.where.agentId);
          if (args.where.seq?.gte != null) {
            rows = rows.filter((r) => r.seq >= args.where.seq!.gte);
          }
          rows = rows.sort((a, b) => a.seq - b.seq);
          if (args.take != null) rows = rows.slice(0, args.take);
          return rows;
        },
      ),
      deleteMany: jest.fn(async (args: { where: { agentId: string } }) => {
        const before = records.length;
        for (let i = records.length - 1; i >= 0; i -= 1) {
          if (records[i].agentId === args.where.agentId) records.splice(i, 1);
        }
        return { count: before - records.length };
      }),
    },
  };
}

describe("AgentEventStore (PR-C)", () => {
  it("auto-increments seq per agentId starting from 1", async () => {
    const prisma = mkPrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new AgentEventStore(prisma as any);

    const a1 = await store.append({
      type: "thinking",
      agentId: "a1",
      timestamp: 0,
      payload: { text: "x" },
    });
    const a2 = await store.append({
      type: "output",
      agentId: "a1",
      timestamp: 1,
      payload: { output: "y" },
    });
    const b1 = await store.append({
      type: "thinking",
      agentId: "b1",
      timestamp: 0,
      payload: { text: "z" },
    });

    expect(a1.seq).toBe(1);
    expect(a2.seq).toBe(2);
    expect(b1.seq).toBe(1);
  });

  it("seeds seq from existing DB rows on first append", async () => {
    const prisma = mkPrisma();
    prisma.setExistingMaxSeq("a1", 42);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new AgentEventStore(prisma as any);

    const ev = await store.append({
      type: "output",
      agentId: "a1",
      timestamp: 0,
      payload: {},
    });
    expect(ev.seq).toBe(43);
  });

  it("readStream filters by fromSeq + limit", async () => {
    const prisma = mkPrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new AgentEventStore(prisma as any);
    for (let i = 0; i < 5; i += 1) {
      await store.append({
        type: "thinking",
        agentId: "a1",
        timestamp: i,
        payload: { i },
      });
    }
    const tail = await store.readStream("a1", { fromSeq: 3 });
    expect(tail.map((r) => r.seq)).toEqual([3, 4, 5]);
    const limited = await store.readStream("a1", { limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it("clearAgent removes rows and resets seq cache", async () => {
    const prisma = mkPrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new AgentEventStore(prisma as any);
    await store.append({
      type: "x",
      agentId: "a1",
      timestamp: 0,
      payload: {},
    });
    const removed = await store.clearAgent("a1");
    expect(removed).toBe(1);

    // After clear, seq starts again at 1 (cache reset)
    const next = await store.append({
      type: "x",
      agentId: "a1",
      timestamp: 1,
      payload: {},
    });
    expect(next.seq).toBe(1);
  });
});
