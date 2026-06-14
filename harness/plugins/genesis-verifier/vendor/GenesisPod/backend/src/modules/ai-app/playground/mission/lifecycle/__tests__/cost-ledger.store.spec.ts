/**
 * cost-ledger.store.spec.ts
 *
 * ★ Wire-Cost (2026-05-30) spec：
 *   1. 一次 mission 的多 stage 成本逐行 append 到台账（CostLedgerStore.appendCostEntry）。
 *   2. 终态 costUsd / tokensUsed = 台账 SUM（CostLedgerStore.sumByMission），
 *      而非 budget pool 标量。
 *   3. AgentInvoker.tickCost 从 agentEvents 抽取 per-model 真实用量并 append。
 *
 * 用内存 fake prisma（数组）真实模拟 create + aggregate，证明 ledger 真写入 + 求和一致。
 */

import { CostLedgerStore } from "../cost-ledger.store";
import { AgentInvoker } from "../../roles/agent-invoker.service";

// ─── in-memory fake prisma ─────────────────────────────────────────────────────

interface LedgerRow {
  id: string;
  missionId: string;
  userId: string;
  stepId: string | null;
  role: string | null;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  createdAt: Date;
}

function makeFakePrisma() {
  const rows: LedgerRow[] = [];
  let seq = 0;
  return {
    _rows: rows,
    agentPlaygroundMissionCostLedger: {
      create: jest.fn(async ({ data }: { data: Partial<LedgerRow> }) => {
        const row: LedgerRow = {
          id: `row-${seq++}`,
          missionId: data.missionId!,
          userId: data.userId!,
          stepId: data.stepId ?? null,
          role: data.role ?? null,
          model: data.model ?? null,
          promptTokens: data.promptTokens ?? 0,
          completionTokens: data.completionTokens ?? 0,
          costUsd: data.costUsd ?? 0,
          createdAt: new Date(Date.now() + seq),
        };
        rows.push(row);
        return row;
      }),
      aggregate: jest.fn(
        async ({ where }: { where: { missionId: string } }) => {
          const matched = rows.filter((r) => r.missionId === where.missionId);
          return {
            _sum: {
              promptTokens: matched.reduce((s, r) => s + r.promptTokens, 0),
              completionTokens: matched.reduce(
                (s, r) => s + r.completionTokens,
                0,
              ),
              costUsd: matched.reduce((s, r) => s + r.costUsd, 0),
            },
            _count: { _all: matched.length },
          };
        },
      ),
      findMany: jest.fn(async ({ where }: { where: { missionId: string } }) =>
        rows
          .filter((r) => r.missionId === where.missionId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      ),
    },
  };
}

// ─── CostLedgerStore ────────────────────────────────────────────────────────────

describe("CostLedgerStore", () => {
  it("appends one row per stage and sums them (terminal costUsd = ledger sum)", async () => {
    const prisma = makeFakePrisma();
    const store = new CostLedgerStore(prisma as never);

    // 3 stages of a single mission, each with distinct per-model usage
    await store.appendCostEntry({
      missionId: "m1",
      userId: "u1",
      stepId: "researchers",
      role: "researcher",
      model: "claude-sonnet",
      promptTokens: 1000,
      completionTokens: 500,
      costUsd: 0.012,
    });
    await store.appendCostEntry({
      missionId: "m1",
      userId: "u1",
      stepId: "analyst",
      role: "analyst",
      model: "gpt-4o",
      promptTokens: 2000,
      completionTokens: 800,
      costUsd: 0.03,
    });
    await store.appendCostEntry({
      missionId: "m1",
      userId: "u1",
      stepId: "writer",
      role: "writer",
      model: "claude-sonnet",
      promptTokens: 4000,
      completionTokens: 3000,
      costUsd: 0.084,
    });

    expect(prisma._rows).toHaveLength(3);

    const summary = await store.sumByMission("m1");
    expect(summary.entryCount).toBe(3);
    expect(summary.promptTokens).toBe(7000);
    expect(summary.completionTokens).toBe(4300);
    expect(summary.totalTokens).toBe(11300);
    expect(summary.costUsd).toBeCloseTo(0.126, 6);
  });

  it("skips empty entries (no tokens, no cost) — no ledger noise", async () => {
    const prisma = makeFakePrisma();
    const store = new CostLedgerStore(prisma as never);
    const wrote = await store.appendCostEntry({
      missionId: "m1",
      userId: "u1",
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
    });
    expect(wrote).toBe(false);
    expect(prisma._rows).toHaveLength(0);
  });

  it("isolates sums per mission", async () => {
    const prisma = makeFakePrisma();
    const store = new CostLedgerStore(prisma as never);
    await store.appendCostEntry({
      missionId: "m1",
      userId: "u1",
      costUsd: 0.01,
      promptTokens: 100,
    });
    await store.appendCostEntry({
      missionId: "m2",
      userId: "u1",
      costUsd: 0.99,
      promptTokens: 999,
    });
    const s1 = await store.sumByMission("m1");
    const s2 = await store.sumByMission("m2");
    expect(s1.costUsd).toBeCloseTo(0.01, 6);
    expect(s2.costUsd).toBeCloseTo(0.99, 6);
  });

  it("clamps out-of-range values and rejects negatives", async () => {
    const prisma = makeFakePrisma();
    const store = new CostLedgerStore(prisma as never);
    await store.appendCostEntry({
      missionId: "m1",
      userId: "u1",
      promptTokens: -50, // → 0
      completionTokens: 9_999_999_999, // → clamped to 5_000_000
      costUsd: 5000, // → clamped to 1000
    });
    const summary = await store.sumByMission("m1");
    expect(summary.promptTokens).toBe(0);
    expect(summary.completionTokens).toBe(5_000_000);
    expect(summary.costUsd).toBe(1000);
  });

  it("returns zero summary (entryCount 0) when no rows — caller falls back to scalar", async () => {
    const prisma = makeFakePrisma();
    const store = new CostLedgerStore(prisma as never);
    const summary = await store.sumByMission("never-run");
    expect(summary.entryCount).toBe(0);
    expect(summary.costUsd).toBe(0);
  });

  it("write failure is swallowed (fire-and-forget) — returns false, does not throw", async () => {
    const prisma = makeFakePrisma();
    prisma.agentPlaygroundMissionCostLedger.create.mockRejectedValueOnce(
      new Error("db down"),
    );
    const store = new CostLedgerStore(prisma as never);
    const wrote = await store.appendCostEntry({
      missionId: "m1",
      userId: "u1",
      costUsd: 0.01,
    });
    expect(wrote).toBe(false);
  });

  it("L6: listByMission 在 DB 故障时优雅降级返回 [] (不抛 → 端点不 500)", async () => {
    const prisma = makeFakePrisma();
    prisma.agentPlaygroundMissionCostLedger.findMany.mockRejectedValueOnce(
      new Error("db down"),
    );
    const store = new CostLedgerStore(prisma as never);
    await expect(store.listByMission("m1")).resolves.toEqual([]);
  });
});

// ─── AgentInvoker.tickCost → ledger write ────────────────────────────────────

function makeEventBus() {
  return { emit: jest.fn().mockResolvedValue(undefined) };
}
function makeAbortRegistry() {
  return { getSignal: jest.fn().mockReturnValue(undefined) };
}
function makeFailureLearner() {
  return {
    lookup: jest.fn().mockResolvedValue([]),
    shouldAutoDisable: jest.fn().mockReturnValue(false),
  };
}
function makeRunner() {
  return { run: jest.fn() };
}
function makePool() {
  return {
    recordSpend: jest.fn(),
    snapshot: jest
      .fn()
      .mockReturnValue({ poolTokensUsed: 1500, poolCostUsd: 0.012 }),
    isExhausted: jest.fn().mockReturnValue(false),
  };
}

describe("AgentInvoker.tickCost → cost ledger", () => {
  it("extracts per-model usage from thinking events and appends a ledger row", async () => {
    const appendCostEntry = jest.fn().mockResolvedValue(true);
    const svc = new AgentInvoker(
      makeRunner() as never,
      makeEventBus() as never,
      makeAbortRegistry() as never,
      makeFailureLearner() as never,
      undefined,
      { appendCostEntry } as never,
    );

    const pool = makePool();
    const agentEvents = [
      {
        type: "thinking",
        payload: {
          text: "...",
          promptTokens: 1000,
          completionTokens: 400,
          costUsd: 0.009,
          modelId: "claude-sonnet",
        },
        timestamp: 1,
      },
      {
        type: "thinking",
        payload: {
          text: "...",
          promptTokens: 200,
          completionTokens: 100,
          costUsd: 0.003,
          modelId: "claude-sonnet",
        },
        timestamp: 2,
      },
    ];

    await svc.tickCost(
      "m1",
      "u1",
      "researchers",
      pool as never,
      1500,
      agentEvents as never,
    );

    // give the fire-and-forget microtask a tick to settle
    await Promise.resolve();

    expect(appendCostEntry).toHaveBeenCalledTimes(1);
    const entry = appendCostEntry.mock.calls[0][0];
    expect(entry.missionId).toBe("m1");
    expect(entry.userId).toBe("u1");
    expect(entry.stepId).toBe("researchers");
    expect(entry.role).toBe("researchers");
    expect(entry.model).toBe("claude-sonnet");
    expect(entry.promptTokens).toBe(1200);
    expect(entry.completionTokens).toBe(500);
    expect(entry.costUsd).toBeCloseTo(0.012, 6);
  });

  it("falls back to token estimate when thinking events carry no costUsd", async () => {
    const appendCostEntry = jest.fn().mockResolvedValue(true);
    const svc = new AgentInvoker(
      makeRunner() as never,
      makeEventBus() as never,
      makeAbortRegistry() as never,
      makeFailureLearner() as never,
      undefined,
      { appendCostEntry } as never,
    );
    const pool = makePool();
    // No agentEvents → usage.costUsd = 0 → fallback deltaTokens * $3/1M
    await svc.tickCost("m1", "u1", "writer", pool as never, 1_000_000);
    await Promise.resolve();
    expect(appendCostEntry).toHaveBeenCalledTimes(1);
    const entry = appendCostEntry.mock.calls[0][0];
    expect(entry.costUsd).toBeCloseTo(3.0, 6);
  });

  it("does not write ledger when no MissionStore is injected (graceful degrade)", async () => {
    const svc = new AgentInvoker(
      makeRunner() as never,
      makeEventBus() as never,
      makeAbortRegistry() as never,
      makeFailureLearner() as never,
    );
    const pool = makePool();
    // Should not throw even without a store
    await expect(
      svc.tickCost("m1", "u1", "researchers", pool as never, 1000),
    ).resolves.toBeUndefined();
  });
});
