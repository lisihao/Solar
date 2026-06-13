import { runReconcilerStage } from "../s5-reconciler-cross-dim-fact-check.stage";
import type { MissionContext } from "../../../context/mission-context";
import type { MissionDeps } from "../../../context/mission-deps";

const PLAN = {
  themeSummary: "AI",
  dimensions: [
    { id: "d1", name: "Market", rationale: "r" },
    { id: "d2", name: "Tech", rationale: "r2" },
  ],
  goals: {} as never,
  initialRisks: [] as string[],
};

const RESEARCHER_RESULTS = [
  {
    dimension: "Market",
    findings: [{ claim: "c", evidence: "e", source: "http://a.com" }],
    summary: "ok",
  },
];

const RECONCILE_OUTPUT = {
  factTable: [
    {
      id: "f1",
      entity: "E1",
      attribute: "a",
      value: "v",
      sources: ["http://a.com"],
    },
  ],
  conflicts: [],
  overlaps: [],
  gaps: [],
  figureCandidates: [],
  reconciliationReport: "All ok",
};

function makeCtx(overrides: Partial<MissionContext> = {}): MissionContext {
  return {
    missionId: "m5",
    userId: "u1",
    t0: Date.now(),
    budgetMultiplier: 1.0,
    input: {
      topic: "AI",
      depth: "deep",
      language: "zh-CN",
    } as MissionContext["input"],
    billing: {} as MissionContext["billing"],
    pool: {
      snapshot: jest
        .fn()
        .mockReturnValue({ poolCostUsd: 0, poolTokensUsed: 0 }),
    } as unknown as MissionContext["pool"],
    leader: {} as MissionContext["leader"],
    plan: PLAN,
    researcherResults: RESEARCHER_RESULTS,
    ...overrides,
  } as unknown as MissionContext;
}

function makeDeps(overrides: Partial<MissionDeps> = {}): MissionDeps {
  return {
    emit: jest.fn().mockResolvedValue(undefined),
    log: {
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    },
    lifecycle: jest.fn().mockResolvedValue(undefined),
    reconciler: {
      reconcile: jest.fn().mockResolvedValue({
        state: "completed",
        output: RECONCILE_OUTPUT,
        events: [],
        wallTimeMs: 500,
        iterations: 2,
      }),
    },
    invoker: {
      tickCost: jest.fn().mockResolvedValue(undefined),
      preDisableKnownFailingModels: jest.fn().mockResolvedValue(undefined),
    },
    // ★ 2026-05-07 R2 共识 P0 (architect): s5 加 markIntermediateState 持久化
    //   reconciliation_report 到主行（cascade rerun 删 reset-before-rerun 后必需）
    store: {
      markIntermediateState: jest.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  } as unknown as MissionDeps;
}

describe("runReconcilerStage (S5)", () => {
  it("throws if plan or researcherResults missing", async () => {
    const ctx = makeCtx({ plan: undefined });
    const deps = makeDeps();
    await expect(runReconcilerStage(ctx, deps)).rejects.toThrow(
      /requires plan/,
    );
  });

  it("happy path: writes ctx.reconciliationReport", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runReconcilerStage(ctx, deps);
    expect(ctx.reconciliationReport).toBeDefined();
    expect(
      (ctx.reconciliationReport as typeof RECONCILE_OUTPUT)?.factTable,
    ).toHaveLength(1);
  });

  // ★ 2026-05-06 单轨化: stage 不再 emit stage:started/metrics，状态由 orchestrator
  //   stage:lifecycle 推。spec 改为验证 lifecycle 调用即可。
  it("calls lifecycle started for reconciler", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runReconcilerStage(ctx, deps);
    expect(deps.lifecycle).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "reconciler",
      "reconciler",
      "started",
    );
  });

  it("emits reconciliation:completed with fact/conflict/gap counts", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runReconcilerStage(ctx, deps);
    const completedCall = (deps.emit as jest.Mock).mock.calls.find(
      (c) => c[0].type === "playground.reconciliation:completed",
    );
    expect(completedCall[0].payload.factCount).toBe(1);
    expect(completedCall[0].payload.conflictCount).toBe(0);
  });

  it("reconciler state != completed → ctx.reconciliationReport stays null", async () => {
    const ctx = makeCtx();
    (makeDeps().reconciler.reconcile as jest.Mock).mockResolvedValue({
      state: "failed",
      output: null,
      events: [],
      wallTimeMs: 500,
      iterations: 2,
    });
    const deps = makeDeps();
    (deps.reconciler.reconcile as jest.Mock).mockResolvedValue({
      state: "failed",
      output: null,
      events: [],
      wallTimeMs: 500,
      iterations: 2,
    });
    await runReconcilerStage(ctx, deps);
    expect(ctx.reconciliationReport).toBeNull();
  });

  it("reconciler.reconcile throws → logs warn + emits dimension:degraded (non-fatal)", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.reconciler.reconcile as jest.Mock).mockRejectedValue(
      new Error("reconciler error"),
    );
    await expect(runReconcilerStage(ctx, deps)).resolves.toBeUndefined();
    expect(deps.log.warn as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("reconciler stage failed"),
    );
    const degradedCall = (deps.emit as jest.Mock).mock.calls.find(
      (c) => c[0].type === "playground.dimension:degraded",
    );
    expect(degradedCall).toBeDefined();
  });

  it("ctx.reconciliationReport initialized to null before try", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.reconciler.reconcile as jest.Mock).mockRejectedValue(
      new Error("err"),
    );
    await runReconcilerStage(ctx, deps).catch((_err: unknown) => {
      // 测试场景：故意让 reconcile 抛出，验证 ctx.reconciliationReport 初始化为 null
    });
    expect(ctx.reconciliationReport).toBeNull();
  });

  it("lifecycle called started then completed on success", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runReconcilerStage(ctx, deps);
    const lifecycleCalls = (deps.lifecycle as jest.Mock).mock.calls;
    expect(lifecycleCalls[0][4]).toBe("started");
    expect(lifecycleCalls[1][4]).toBe("completed");
  });

  it("preDisableKnownFailingModels called for reconciler", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runReconcilerStage(ctx, deps);
    expect(deps.invoker.preDisableKnownFailingModels).toHaveBeenCalledWith(
      ctx.billing,
      "playground.reconciler",
      expect.stringContaining("::reconciler::"),
    );
  });

  // ★ 2026-05-06 单轨化: stage:completed 由 orchestrator 必发，spec 不再期待
  //   stage 文件内部 emit。该 stage 业务正确性由 reconciliationReport 验证（其他 spec）。
  it("sets reconciliationReport on success", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runReconcilerStage(ctx, deps);
    expect(ctx.reconciliationReport).toBeDefined();
  });

  it("tickCost called after reconcile", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runReconcilerStage(ctx, deps);
    expect(deps.invoker.tickCost).toHaveBeenCalled();
  });
});
