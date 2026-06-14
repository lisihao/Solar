/**
 * Unit tests for S1 — Mission Budget Eval Stage
 */

import { runMissionBudgetEvalStage } from "../s1-mission-budget-eval.stage";
import type { MissionInvariants } from "../../mission-context";
import type { CommonDeps } from "../../mission-deps";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<CommonDeps> = {}): CommonDeps {
  return {
    invoker: {} as CommonDeps["invoker"],
    abortRegistry: {} as CommonDeps["abortRegistry"],
    runner: {} as CommonDeps["runner"],
    eventBus: {} as CommonDeps["eventBus"],
    log: {
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    } as unknown as CommonDeps["log"],
    emit: jest.fn().mockResolvedValue(undefined),
    lifecycle: jest.fn().mockResolvedValue(undefined),
    markStageDegraded: jest.fn().mockResolvedValue(undefined),
    leader: {} as CommonDeps["leader"],
    steward: {
      run: jest.fn().mockResolvedValue({
        state: "completed",
        output: {
          verdict: "approved",
          estimatedCostUsd: 0.05,
          remainingCreditsUsd: 9.95,
        },
      }),
    } as unknown as CommonDeps["steward"],
    platformProbe: {} as CommonDeps["platformProbe"],
    contentTransformer: {} as CommonDeps["contentTransformer"],
    coverArtist: {} as CommonDeps["coverArtist"],
    composer: {} as CommonDeps["composer"],
    polishReviewer: {} as CommonDeps["polishReviewer"],
    publishExecutor: {} as CommonDeps["publishExecutor"],
    publishVerifier: {} as CommonDeps["publishVerifier"],
    failureLearner: {} as CommonDeps["failureLearner"],
    postmortemClassifier: {} as CommonDeps["postmortemClassifier"],
    store: {} as CommonDeps["store"],
    ...overrides,
  };
}

function makeCtx(
  overrides: Partial<MissionInvariants> = {},
): MissionInvariants {
  return {
    missionId: "mission-s1-test",
    userId: "user-abc",
    t0: Date.now(),
    input: {
      contentId: "content-1",
      platforms: ["wechat", "xiaohongshu"],
      connectionIds: { wechat: "conn-w", xiaohongshu: "conn-x" },
      depth: "standard",
      budgetProfile: "standard",
      language: "zh-CN",
    },
    billing: {} as MissionInvariants["billing"],
    pool: {} as MissionInvariants["pool"],
    budgetMultiplier: 1,
    contextIds: { wechat: "ctx-w", xiaohongshu: "ctx-x" },
    contentRaw: {
      title: "Test title",
      body: "Test body",
      digest: null,
      coverImageUrl: null,
    },
    stewardInputs: {
      remainingCreditsUsd: 10,
      estimatedCostUsd: 0.05,
      sessionExpiresAt: { wechat: "2099-01-01T00:00:00Z" },
      inProgressMissionCount: 0,
      keyCooldownCount1h: 0,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runMissionBudgetEvalStage (s1)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("happy path — steward approves", () => {
    it("should emit social.mission:started event", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runMissionBudgetEvalStage(ctx, deps);

      const emitCalls = (deps.emit as jest.Mock).mock.calls;
      const startedCall = emitCalls.find(
        (args: unknown[]) =>
          (args[0] as { type: string }).type === "social.mission:started",
      );
      expect(startedCall).toBeDefined();
      expect((startedCall![0] as { missionId: string }).missionId).toBe(
        "mission-s1-test",
      );
    });

    it("should call steward.run with correct inputs", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runMissionBudgetEvalStage(ctx, deps);

      expect(deps.steward.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            userId: "user-abc",
            platforms: ["wechat", "xiaohongshu"],
            remainingCreditsUsd: 10,
            estimatedCostUsd: 0.05,
          }),
          ctx: expect.objectContaining({
            missionId: "mission-s1-test",
            role: "steward",
          }),
        }),
      );
    });

    it("should emit narrative success message after approval", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runMissionBudgetEvalStage(ctx, deps);

      const emitCalls = (deps.emit as jest.Mock).mock.calls;
      const narrativeCalls = emitCalls.filter(
        (args: unknown[]) =>
          (args[0] as { type: string }).type === "social.agent:narrative",
      );
      const successNarrative = narrativeCalls.find(
        (args: unknown[]) =>
          (args[0] as { payload: { tag: string } }).payload.tag === "success",
      );
      expect(successNarrative).toBeDefined();
    });

    it("should include workspaceId in mission:started payload when provided", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runMissionBudgetEvalStage(ctx, deps, "workspace-xyz");

      const emitCalls = (deps.emit as jest.Mock).mock.calls;
      const startedCall = emitCalls.find(
        (args: unknown[]) =>
          (args[0] as { type: string }).type === "social.mission:started",
      );
      expect(
        (startedCall![0] as { payload: { workspaceId: string } }).payload
          .workspaceId,
      ).toBe("workspace-xyz");
    });
  });

  describe("steward returns failed state", () => {
    it("should throw an error when steward.run returns state=failed", async () => {
      const deps = makeDeps({
        steward: {
          run: jest.fn().mockResolvedValue({ state: "failed", output: null }),
        } as unknown as CommonDeps["steward"],
      });
      const ctx = makeCtx();

      await expect(runMissionBudgetEvalStage(ctx, deps)).rejects.toThrow(
        "[s1] Steward agent failed for mission mission-s1-test",
      );
    });
  });

  describe("steward verdict=gated", () => {
    it("should emit social.mission:gated and throw when verdict is gated", async () => {
      const deps = makeDeps({
        steward: {
          run: jest.fn().mockResolvedValue({
            state: "completed",
            output: {
              verdict: "gated",
              gateFailed: "budget",
              evidence: "Insufficient credits",
              estimatedCostUsd: 0.5,
              remainingCreditsUsd: 0.1,
            },
          }),
        } as unknown as CommonDeps["steward"],
      });
      const ctx = makeCtx();

      await expect(runMissionBudgetEvalStage(ctx, deps)).rejects.toThrow(
        "4 闸 budget 不通过",
      );

      const emitCalls = (deps.emit as jest.Mock).mock.calls;
      const gatedCall = emitCalls.find(
        (args: unknown[]) =>
          (args[0] as { type: string }).type === "social.mission:gated",
      );
      expect(gatedCall).toBeDefined();
      expect(
        (gatedCall![0] as { payload: { gateFailed: string } }).payload
          .gateFailed,
      ).toBe("budget");
    });

    it("should include evidence in the thrown error message", async () => {
      const deps = makeDeps({
        steward: {
          run: jest.fn().mockResolvedValue({
            state: "completed",
            output: {
              verdict: "gated",
              gateFailed: "concurrent-limit",
              evidence: "Too many missions running",
              estimatedCostUsd: 0.1,
              remainingCreditsUsd: 5,
            },
          }),
        } as unknown as CommonDeps["steward"],
      });
      const ctx = makeCtx();

      await expect(runMissionBudgetEvalStage(ctx, deps)).rejects.toThrow(
        "Too many missions running",
      );
    });

    it("should emit warning narrative before throwing", async () => {
      const deps = makeDeps({
        steward: {
          run: jest.fn().mockResolvedValue({
            state: "completed",
            output: {
              verdict: "gated",
              gateFailed: "session-expired",
              evidence: "Session has expired",
              estimatedCostUsd: 0.1,
              remainingCreditsUsd: 5,
            },
          }),
        } as unknown as CommonDeps["steward"],
      });
      const ctx = makeCtx();

      await expect(runMissionBudgetEvalStage(ctx, deps)).rejects.toThrow();

      const emitCalls = (deps.emit as jest.Mock).mock.calls;
      const narrativeCalls = emitCalls.filter(
        (args: unknown[]) =>
          (args[0] as { type: string }).type === "social.agent:narrative",
      );
      const warningNarrative = narrativeCalls.find(
        (args: unknown[]) =>
          (args[0] as { payload: { tag: string } }).payload.tag === "warning",
      );
      expect(warningNarrative).toBeDefined();
    });
  });

  describe("emit failure resilience", () => {
    it("should not throw when social.mission:started emit fails", async () => {
      const emitMock = jest
        .fn()
        .mockImplementation((event: { type: string }) => {
          if (event.type === "social.mission:started") {
            return Promise.reject(new Error("emit error"));
          }
          return Promise.resolve();
        });
      const deps = makeDeps({ emit: emitMock });
      const ctx = makeCtx();

      // Should not throw even though emit failed
      await expect(
        runMissionBudgetEvalStage(ctx, deps),
      ).resolves.toBeUndefined();
    });
  });

  describe("steward run with pool and billing passed", () => {
    it("should pass billing and pool from ctx to steward.run", async () => {
      const mockBilling = {
        type: "billing-adapter",
      } as unknown as MissionInvariants["billing"];
      const mockPool = {
        type: "budget-pool",
      } as unknown as MissionInvariants["pool"];
      const deps = makeDeps();
      const ctx = makeCtx({ billing: mockBilling, pool: mockPool });

      await runMissionBudgetEvalStage(ctx, deps);

      expect(deps.steward.run).toHaveBeenCalledWith(
        expect.objectContaining({
          ctx: expect.objectContaining({ envAdapter: mockBilling }),
          pool: mockPool,
        }),
      );
    });
  });
});
