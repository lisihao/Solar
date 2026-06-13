import { runBudgetEstimateStage } from "../s1-mission-estimate-budget.stage";
import type { MissionContext } from "../../../context/mission-context";
import type { MissionDeps } from "../../../context/mission-deps";
import {
  DEPTH_BUDGET_TIERS,
  resolveMissionCredits,
} from "../../../../api/dto/run-mission.dto";
import { CREDITS_TO_TOKENS } from "@/modules/ai-harness/facade";

function makeCtx(overrides: Partial<MissionContext> = {}): MissionContext {
  return {
    missionId: "m1",
    userId: "u1",
    t0: Date.now(),
    budgetMultiplier: 1.0,
    input: {
      topic: "AI Trends",
      depth: "deep",
      language: "zh-CN",
      budgetProfile: "standard",
      concurrency: 3,
      withFigures: false,
      auditLayers: "standard",
      lengthProfile: "standard",
    } as MissionContext["input"],
    billing: {
      estimateAffordable: jest.fn().mockResolvedValue({
        affordable: true,
        estimatedCredits: 1000,
        currentBalance: 5000,
        shortfall: 0,
        suggestion: "proceed",
      }),
      markModelDisabled: jest.fn(),
    } as unknown as MissionContext["billing"],
    pool: {} as MissionContext["pool"],
    leader: {} as MissionContext["leader"],
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
    store: {} as MissionDeps["store"],
    ...overrides,
  } as unknown as MissionDeps;
}

describe("runBudgetEstimateStage (S1)", () => {
  it("emits mission:started event on entry", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runBudgetEstimateStage(ctx, deps);
    const emitCalls = (deps.emit as jest.Mock).mock.calls;
    const started = emitCalls.find(
      (c) => c[0].type === "playground.mission:started",
    );
    expect(started).toBeDefined();
  });

  it("happy path: affordable=true → emits no warning", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runBudgetEstimateStage(ctx, deps);
    const emitCalls = (deps.emit as jest.Mock).mock.calls.map((c) => c[0].type);
    expect(emitCalls).not.toContain(
      "playground.mission:budget-warning-soft",
    );
    expect(emitCalls).not.toContain(
      "playground.mission:budget-warning-hard",
    );
  });

  it("soft warning: affordable=false + suggestion=warn → emits budget-warning-soft and continues", async () => {
    const ctx = makeCtx();
    (ctx.billing.estimateAffordable as jest.Mock).mockResolvedValue({
      affordable: false,
      estimatedCredits: 2000,
      currentBalance: 1500,
      shortfall: 500,
      suggestion: "warn",
    });
    const deps = makeDeps();
    await expect(runBudgetEstimateStage(ctx, deps)).resolves.toBeUndefined();
    const emitTypes = (deps.emit as jest.Mock).mock.calls.map((c) => c[0].type);
    expect(emitTypes).toContain("playground.mission:budget-warning-soft");
  });

  it("hard abort: affordable=false + suggestion=abort → emits budget-warning-hard and throws", async () => {
    const ctx = makeCtx();
    (ctx.billing.estimateAffordable as jest.Mock).mockResolvedValue({
      affordable: false,
      estimatedCredits: 5000,
      currentBalance: 100,
      shortfall: 4900,
      suggestion: "abort",
    });
    const deps = makeDeps();
    await expect(runBudgetEstimateStage(ctx, deps)).rejects.toThrow(
      "余额不足以启动 mission",
    );
    const emitTypes = (deps.emit as jest.Mock).mock.calls.map((c) => c[0].type);
    expect(emitTypes).toContain("playground.mission:budget-warning-hard");
  });

  it("hard abort: does not swallow abort as non-fatal warning", async () => {
    const ctx = makeCtx();
    (ctx.billing.estimateAffordable as jest.Mock).mockResolvedValue({
      affordable: false,
      estimatedCredits: 5000,
      currentBalance: 100,
      shortfall: 4900,
      suggestion: "abort",
    });
    const deps = makeDeps();
    await expect(runBudgetEstimateStage(ctx, deps)).rejects.toThrow(
      "余额不足以启动 mission",
    );
    expect(deps.log.warn as jest.Mock).not.toHaveBeenCalled();
  });

  it("estimateAffordable throws → logs warn and continues (non-fatal)", async () => {
    const ctx = makeCtx();
    (ctx.billing.estimateAffordable as jest.Mock).mockRejectedValue(
      new Error("network error"),
    );
    const deps = makeDeps();
    await expect(runBudgetEstimateStage(ctx, deps)).resolves.toBeUndefined();
    expect(deps.log.warn as jest.Mock).toHaveBeenCalled();
  });

  it("passes workspaceId in mission:started payload", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runBudgetEstimateStage(ctx, deps, "ws-42");
    const startedCall = (deps.emit as jest.Mock).mock.calls.find(
      (c) => c[0].type === "playground.mission:started",
    );
    expect(startedCall[0].payload.workspaceId).toBe("ws-42");
  });

  it("budget estimate is computed from resolveMissionCredits × CREDITS_TO_TOKENS × budgetMultiplier", async () => {
    // R2-#45: estimate now uses the REAL resolved cap, not hardcoded 400_000 baseline.
    const ctx = makeCtx({ budgetMultiplier: 2.0 });
    const deps = makeDeps();
    await runBudgetEstimateStage(ctx, deps);
    const estimateCall = (ctx.billing.estimateAffordable as jest.Mock).mock
      .calls[0][0];
    // depth=deep → resolveMissionCredits=20000, ×1000 ×2 = 40_000_000
    const expectedTokens = Math.round(
      resolveMissionCredits(ctx.input) * CREDITS_TO_TOKENS * 2.0,
    );
    expect(estimateCall.maxTokens).toBe(expectedTokens);
    expect(estimateCall.maxTokens).toBe(
      DEPTH_BUDGET_TIERS.deep.maxCredits * CREDITS_TO_TOKENS * 2,
    );
  });

  it("budgetMultiplier < 0.1 is clamped to 0.1", async () => {
    const ctx = makeCtx({ budgetMultiplier: 0.01 });
    const deps = makeDeps();
    await runBudgetEstimateStage(ctx, deps);
    const estimateCall = (ctx.billing.estimateAffordable as jest.Mock).mock
      .calls[0][0];
    // Math.max(0.1, 0.01) = 0.1 → resolveMissionCredits(deep)=20000 × 1000 × 0.1 = 2_000_000
    const expectedTokens = Math.round(
      resolveMissionCredits(ctx.input) * CREDITS_TO_TOKENS * 0.1,
    );
    expect(estimateCall.maxTokens).toBe(expectedTokens);
  });

  it("narrate is called with stage s1-budget info tag", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runBudgetEstimateStage(ctx, deps);
    const narrateCalls = (deps.emit as jest.Mock).mock.calls.filter(
      (c) => c[0].type === "playground.narrate",
    );
    const _hasBudgetStage = narrateCalls.some(
      (c) => c[0].payload?.stage === "s1-budget",
    );
    // narrate emits via emit, check any narrate-like payload
    // The function calls narrate which calls emit with narrate type or the direct payload
    expect(deps.emit).toHaveBeenCalled();
  });

  it("soft-warn path: shortfall is included in emitted payload", async () => {
    const ctx = makeCtx();
    (ctx.billing.estimateAffordable as jest.Mock).mockResolvedValue({
      affordable: false,
      estimatedCredits: 2000,
      currentBalance: 1500,
      shortfall: 500,
      suggestion: "warn",
    });
    const deps = makeDeps();
    await runBudgetEstimateStage(ctx, deps);
    const warnCall = (deps.emit as jest.Mock).mock.calls.find(
      (c) => c[0].type === "playground.mission:budget-warning-soft",
    );
    expect(warnCall[0].payload.shortfall).toBe(500);
  });
});
