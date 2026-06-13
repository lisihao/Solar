import { runLeaderPlanStage } from "../s2-leader-plan-mission.stage";
import type { MissionContext } from "../../../context/mission-context";
import type { MissionDeps } from "../../../context/mission-deps";

const basePlanResult = {
  themeSummary: "AI is transforming industry",
  dimensions: [
    { id: "d1", name: "Market", rationale: "Market size" },
    { id: "d2", name: "Tech", rationale: "Technology" },
    { id: "d3", name: "Policy", rationale: "Regulation" },
  ],
  goals: { qualityBar: { minCoverage: 80 }, successCriteria: [] },
  initialRisks: ["data availability"],
};

function makeCtx(overrides: Partial<MissionContext> = {}): MissionContext {
  return {
    missionId: "m2",
    userId: "u1",
    t0: Date.now(),
    budgetMultiplier: 1.0,
    input: {
      topic: "AI",
      depth: "deep",
      language: "zh-CN",
    } as MissionContext["input"],
    billing: {} as MissionContext["billing"],
    pool: {} as MissionContext["pool"],
    leader: {
      plan: jest.fn().mockResolvedValue(basePlanResult),
    } as unknown as MissionContext["leader"],
    ...overrides,
  } as unknown as MissionContext;
}

function makeDeps(
  storeOverrides: Partial<MissionDeps["store"]> = {},
): MissionDeps {
  return {
    emit: jest.fn().mockResolvedValue(undefined),
    log: {
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    },
    lifecycle: jest.fn().mockResolvedValue(undefined),
    store: {
      listRecentPostmortems: jest.fn().mockResolvedValue([]),
      // ★ 2026-05-07 R2 共识 P0 (architect): s2 加 markIntermediateState 主动持久化
      //   dimensions + themeSummary 到主行（cascade rerun 删 reset-before-rerun 后必需）
      markIntermediateState: jest.fn().mockResolvedValue(undefined),
      ...storeOverrides,
    },
  } as unknown as MissionDeps;
}

describe("runLeaderPlanStage (S2)", () => {
  it("happy path: writes ctx.plan with dimensions/goals/initialRisks", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runLeaderPlanStage(ctx, deps);
    expect(ctx.plan).toBeDefined();
    expect(ctx.plan?.dimensions).toHaveLength(3);
    expect(ctx.plan?.themeSummary).toBe("AI is transforming industry");
  });

  it("happy path: emits stage:started and stage:completed", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runLeaderPlanStage(ctx, deps);
    const types = (deps.emit as jest.Mock).mock.calls.map((c) => c[0].type);
    expect(types).toContain("playground.stage:metrics");
    expect(types).toContain("playground.stage:metrics");
  });

  it("priorPostmortems injected into leader.plan call", async () => {
    const ctx = makeCtx();
    const postmortem = {
      missionId: "pm1",
      topic: "Old topic",
      summary: "Bad run",
      recommendations: ["use more dims"],
      leaderSigned: false,
      qualityScore: 40,
      createdAt: new Date(),
    };
    const deps = makeDeps({
      listRecentPostmortems: jest.fn().mockResolvedValue([postmortem]),
    });
    await runLeaderPlanStage(ctx, deps);
    const planCall = (ctx.leader.plan as jest.Mock).mock.calls[0][0];
    expect(planCall.priorPostmortems).toHaveLength(1);
    expect(planCall.priorPostmortems[0].missionId).toBe("pm1");
  });

  it("listRecentPostmortems failure → fallback to empty array (non-fatal)", async () => {
    const ctx = makeCtx();
    const deps = makeDeps({
      listRecentPostmortems: jest.fn().mockRejectedValue(new Error("DB error")),
    });
    await runLeaderPlanStage(ctx, deps);
    const planCall = (ctx.leader.plan as jest.Mock).mock.calls[0][0];
    expect(planCall.priorPostmortems).toEqual([]);
    expect(deps.log.warn as jest.Mock).toHaveBeenCalled();
  });

  it("leader.plan() throws → emits lifecycle:failed and rethrows", async () => {
    const ctx = makeCtx();
    (ctx.leader.plan as jest.Mock).mockRejectedValue(new Error("LLM failed"));
    const deps = makeDeps();
    await expect(runLeaderPlanStage(ctx, deps)).rejects.toThrow("LLM failed");
    expect(deps.lifecycle).toHaveBeenCalledWith(
      ctx.missionId,
      ctx.userId,
      "leader",
      "leader",
      "failed",
      expect.objectContaining({ error: "LLM failed" }),
    );
  });

  it("emits leader:goals-set event with goals payload", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runLeaderPlanStage(ctx, deps);
    const goalsSetCall = (deps.emit as jest.Mock).mock.calls.find(
      (c) => c[0].type === "playground.leader:goals-set",
    );
    expect(goalsSetCall).toBeDefined();
    expect(goalsSetCall[0].payload.goals).toBeDefined();
  });

  it("initialRisks defaults to [] when leader.plan returns null", async () => {
    const ctx = makeCtx();
    (ctx.leader.plan as jest.Mock).mockResolvedValue({
      ...basePlanResult,
      initialRisks: null,
    });
    const deps = makeDeps();
    await runLeaderPlanStage(ctx, deps);
    expect(ctx.plan?.initialRisks).toEqual([]);
  });

  it("calls lifecycle started then completed in happy path", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runLeaderPlanStage(ctx, deps);
    const lifecycleCalls = (deps.lifecycle as jest.Mock).mock.calls;
    expect(lifecycleCalls[0][4]).toBe("started");
    expect(lifecycleCalls[1][4]).toBe("completed");
  });

  it("stage:completed payload includes dimensions and themeSummary", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runLeaderPlanStage(ctx, deps);
    // ★ A-2 完整版后 wrapper emit 两次 stage:metrics（started + completed）；找 completed 那次（含 dimensions）
    const completedCall = (deps.emit as jest.Mock).mock.calls.find(
      (c) =>
        c[0].type === "playground.stage:metrics" &&
        c[0].payload?.stage === "leader" &&
        c[0].payload?.dimensions !== undefined,
    );
    expect(completedCall[0].payload.dimensions).toHaveLength(3);
    expect(completedCall[0].payload.themeSummary).toBeDefined();
  });

  it("logs postmortem count when injected", async () => {
    const ctx = makeCtx();
    const deps = makeDeps({
      listRecentPostmortems: jest.fn().mockResolvedValue([
        {
          missionId: "x",
          topic: "t",
          summary: "s",
          recommendations: [],
          leaderSigned: true,
          qualityScore: 80,
          createdAt: new Date(),
        },
      ]),
    });
    await runLeaderPlanStage(ctx, deps);
    expect(deps.log.log as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("injected 1 prior postmortems"),
    );
  });

  it("leader:goals-set emit failure is swallowed", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    let _callCount = 0;
    (deps.emit as jest.Mock).mockImplementation((args) => {
      _callCount++;
      if (args.type === "playground.leader:goals-set") {
        return Promise.reject(new Error("emit failed"));
      }
      return Promise.resolve();
    });
    await expect(runLeaderPlanStage(ctx, deps)).resolves.toBeUndefined();
  });
});
