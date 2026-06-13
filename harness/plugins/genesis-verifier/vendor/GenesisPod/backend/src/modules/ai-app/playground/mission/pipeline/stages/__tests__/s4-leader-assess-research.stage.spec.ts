import { runLeaderAssessResearchStage } from "../s4-leader-assess-research.stage";
import type { MissionContext } from "../../../context/mission-context";
import type { MissionDeps } from "../../../context/mission-deps";

const DIMS = [
  { id: "d1", name: "Market", rationale: "market" },
  { id: "d2", name: "Tech", rationale: "tech" },
];

const RESULTS = [
  {
    dimension: "Market",
    findings: [{ claim: "c", evidence: "e", source: "http://a.com" }],
    summary: "ok",
  },
  {
    dimension: "Tech",
    findings: [{ claim: "c2", evidence: "e2", source: "http://b.com" }],
    summary: "ok",
  },
];

function baseAssessResult(decision: string) {
  return {
    decision,
    rationale: "Looks fine",
    perDimension: [
      { dimensionId: "d1", action: "accept" },
      { dimensionId: "d2", action: "accept" },
    ],
    newDimensions: [],
  };
}

function makeCtx(overrides: Partial<MissionContext> = {}): MissionContext {
  return {
    missionId: "m4",
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
    leader: {
      assessResearchers: jest
        .fn()
        .mockResolvedValue(baseAssessResult("accept-all")),
    } as unknown as MissionContext["leader"],
    plan: {
      themeSummary: "t",
      dimensions: DIMS,
      goals: {} as never,
      initialRisks: [],
    },
    researcherResults: [...RESULTS],
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
    markStageDegraded: jest.fn().mockResolvedValue(undefined),
    invoker: {
      invoke: jest.fn().mockResolvedValue({
        state: "completed",
        output: {
          dimension: "Market",
          findings: [{ claim: "c", evidence: "e", source: "http://a.com" }],
          summary: "ok",
        },
        events: [],
        wallTimeMs: 1000,
        iterations: 3,
      }),
      tickCost: jest.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  } as unknown as MissionDeps;
}

describe("runLeaderAssessResearchStage (S4)", () => {
  it("throws if plan or researcherResults missing", async () => {
    const ctx = makeCtx({ plan: undefined });
    const deps = makeDeps();
    await expect(runLeaderAssessResearchStage(ctx, deps)).rejects.toThrow(
      /requires plan/,
    );
  });

  it("accept-all: no retries dispatched, mission continues", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runLeaderAssessResearchStage(ctx, deps);
    expect(deps.invoker.invoke).not.toHaveBeenCalled();
  });

  it("abort decision → throws with message", async () => {
    const ctx = makeCtx();
    (ctx.leader.assessResearchers as jest.Mock).mockResolvedValue(
      baseAssessResult("abort"),
    );
    const deps = makeDeps();
    await expect(runLeaderAssessResearchStage(ctx, deps)).rejects.toThrow(
      // 文案已本地化（zh-CN）：用 instanceof LeaderAbortError 识别 abort，不靠 message 前缀。
      /中止任务/,
    );
  });

  it("patch decision: retry-with-critique → dispatches researcher retry", async () => {
    const ctx = makeCtx();
    (ctx.leader.assessResearchers as jest.Mock).mockResolvedValue({
      decision: "patch",
      rationale: "redo dim1",
      perDimension: [
        {
          dimensionId: "d1",
          action: "retry-with-critique",
          critique: "Not enough data",
        },
        { dimensionId: "d2", action: "accept" },
      ],
      newDimensions: [],
    });
    const deps = makeDeps();
    await runLeaderAssessResearchStage(ctx, deps);
    expect(deps.invoker.invoke).toHaveBeenCalled();
  });

  it("abort action per dim → sets findings=[] and summary='aborted by Leader'", async () => {
    const ctx = makeCtx();
    (ctx.leader.assessResearchers as jest.Mock).mockResolvedValue({
      decision: "patch",
      rationale: "kill d1",
      perDimension: [
        { dimensionId: "d1", action: "abort", critique: "useless" },
        { dimensionId: "d2", action: "accept" },
      ],
      newDimensions: [],
    });
    const deps = makeDeps();
    await runLeaderAssessResearchStage(ctx, deps);
    expect(ctx.researcherResults![0].findings).toEqual([]);
    expect(ctx.researcherResults![0].summary).toContain("aborted by Leader");
  });

  it("redirect: adds new dimension and dispatches researcher", async () => {
    const ctx = makeCtx();
    (ctx.leader.assessResearchers as jest.Mock).mockResolvedValue({
      decision: "redirect",
      rationale: "extend",
      perDimension: [
        { dimensionId: "d1", action: "accept" },
        { dimensionId: "d2", action: "accept" },
      ],
      newDimensions: [{ id: "d3", name: "Policy", rationale: "regulation" }],
    });
    const deps = makeDeps();
    await runLeaderAssessResearchStage(ctx, deps);
    expect(ctx.plan!.dimensions).toHaveLength(3);
  });

  it("assessResearchers throws (non-fatal) → logs warn and continues", async () => {
    const ctx = makeCtx();
    (ctx.leader.assessResearchers as jest.Mock).mockRejectedValue(
      new Error("LLM error"),
    );
    const deps = makeDeps();
    await expect(
      runLeaderAssessResearchStage(ctx, deps),
    ).resolves.toBeUndefined();
    expect(deps.log.warn as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("M1 assess-research failed"),
    );
  });

  it("patch cap: >2 retry-with-critique → capped to 2, rest become accept-degraded", async () => {
    const ctxDims = [
      { id: "d1", name: "M1", rationale: "r" },
      { id: "d2", name: "M2", rationale: "r" },
      { id: "d3", name: "M3", rationale: "r" },
      { id: "d4", name: "M4", rationale: "r" },
    ];
    const ctxResults = ctxDims.map((d) => ({
      dimension: d.name,
      findings: [],
      summary: "fail",
    }));
    const ctx = makeCtx({
      plan: {
        themeSummary: "t",
        dimensions: ctxDims,
        goals: {} as never,
        initialRisks: [],
      },
      researcherResults: ctxResults,
    });
    (ctx.leader.assessResearchers as jest.Mock).mockResolvedValue({
      decision: "patch",
      rationale: "redo all",
      perDimension: ctxDims.map((d) => ({
        dimensionId: d.id,
        action: "retry-with-critique",
        critique: "bad",
      })),
      newDimensions: [],
    });
    const deps = makeDeps();
    await runLeaderAssessResearchStage(ctx, deps);
    // Only 2 retries should be dispatched
    expect(deps.log.warn as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("patch 上限"),
    );
  });

  it("emits leader:decision event", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runLeaderAssessResearchStage(ctx, deps);
    const decisionCall = (deps.emit as jest.Mock).mock.calls.find(
      (c) => c[0].type === "playground.leader:decision",
    );
    expect(decisionCall).toBeDefined();
  });

  it("unknown dimensionId in perDimension → skipped count increases", async () => {
    const ctx = makeCtx();
    (ctx.leader.assessResearchers as jest.Mock).mockResolvedValue({
      decision: "patch",
      rationale: "patch unknown",
      perDimension: [
        {
          dimensionId: "non-existent",
          action: "retry-with-critique",
          critique: "bad",
        },
        { dimensionId: "d1", action: "accept" },
        { dimensionId: "d2", action: "accept" },
      ],
      newDimensions: [],
    });
    const deps = makeDeps();
    await runLeaderAssessResearchStage(ctx, deps);
    expect(deps.log.warn as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("not in plan"),
    );
  });

  it("duplicate newDimension id → logged warn and skipped", async () => {
    const ctx = makeCtx();
    (ctx.leader.assessResearchers as jest.Mock).mockResolvedValue({
      decision: "redirect",
      rationale: "extend",
      perDimension: [
        { dimensionId: "d1", action: "accept" },
        { dimensionId: "d2", action: "accept" },
      ],
      newDimensions: [{ id: "d1", name: "Market-dup", rationale: "dup" }],
    });
    const deps = makeDeps();
    await runLeaderAssessResearchStage(ctx, deps);
    // d1 already exists, so warn should be logged
    expect(deps.log.warn as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("conflicts with existing"),
    );
  });

  it("s4PatchRound > MAX_S4_ROUNDS → retry actions force-downgraded to accept-degraded", async () => {
    const ctx = makeCtx();
    // Simulate second round (already ran once)
    (ctx as unknown as Record<string, unknown>).s4PatchRound = 1;
    (ctx.leader.assessResearchers as jest.Mock).mockResolvedValue({
      decision: "patch",
      rationale: "retry again",
      perDimension: [
        {
          dimensionId: "d1",
          action: "retry-with-critique",
          critique: "Still bad",
        },
        { dimensionId: "d2", action: "accept" },
      ],
      newDimensions: [],
    });
    const deps = makeDeps();
    await runLeaderAssessResearchStage(ctx, deps);
    // Round 2 exceeds MAX_S4_ROUNDS=1, so retry actions should be downgraded
    // No invoke should be called since retry is downgraded to accept-degraded
    expect(deps.log.warn as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("forced"),
    );
  });

  it("assessResearchers throws non-fatal → warn includes M1 assess-research failed", async () => {
    const ctx = makeCtx();
    (ctx.leader.assessResearchers as jest.Mock).mockRejectedValue(
      new Error("LLM timeout"),
    );
    const deps = makeDeps();
    await runLeaderAssessResearchStage(ctx, deps);
    expect(deps.log.warn as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("M1 assess-research failed"),
    );
  });
});
