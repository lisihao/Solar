/**
 * Unit tests for S2 — Platform Probe Stage
 */

import { runPlatformProbeStage } from "../s2-platform-probe.stage";
import type { MissionInvariants, PlanPhaseCtx } from "../../mission-context";
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
    steward: {} as CommonDeps["steward"],
    platformProbe: {
      run: jest.fn().mockResolvedValue({
        state: "completed",
        output: {
          results: [
            {
              platform: "wechat",
              probeResult: "ok",
              requiredFields: ["title", "digest", "body"],
              schemaVersion: "2024-v1",
            },
            {
              platform: "xiaohongshu",
              probeResult: "ok",
              requiredFields: ["title", "body", "images"],
              schemaVersion: "2024-v1",
            },
          ],
        },
      }),
    } as unknown as CommonDeps["platformProbe"],
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

type Ctx = MissionInvariants & PlanPhaseCtx;

function makeCtx(overrides: Partial<MissionInvariants> = {}): Ctx {
  return {
    missionId: "mission-s2-test",
    userId: "user-xyz",
    t0: Date.now(),
    input: {
      contentId: "content-2",
      platforms: ["wechat", "xiaohongshu"],
      connectionIds: { wechat: "conn-w", xiaohongshu: "conn-x" },
      depth: "quick",
      budgetProfile: "lean",
      language: "zh-CN",
    },
    billing: {} as MissionInvariants["billing"],
    pool: {} as MissionInvariants["pool"],
    budgetMultiplier: 1,
    contextIds: { wechat: "ctx-s2-w", xiaohongshu: "ctx-s2-x" },
    contentRaw: {
      title: "S2 title",
      body: "S2 body",
      digest: "summary",
      coverImageUrl: null,
    },
    stewardInputs: {
      remainingCreditsUsd: 5,
      estimatedCostUsd: 0.02,
      sessionExpiresAt: {},
      inProgressMissionCount: 1,
      keyCooldownCount1h: 0,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runPlatformProbeStage (s2)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("happy path", () => {
    it("should call platformProbe.run with platforms from ctx.input", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runPlatformProbeStage(ctx, deps);

      expect(deps.platformProbe.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            platforms: ["wechat", "xiaohongshu"],
          }),
          ctx: expect.objectContaining({
            missionId: "mission-s2-test",
            role: "platform-probe",
          }),
        }),
      );
    });

    it("should write probe results to ctx.probeResults", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runPlatformProbeStage(ctx, deps);

      expect(ctx.probeResults).toBeDefined();
      expect(ctx.probeResults!.results).toHaveLength(2);
      expect(ctx.probeResults!.results[0].platform).toBe("wechat");
    });

    it("should emit narrative searching at start and success at end", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runPlatformProbeStage(ctx, deps);

      const emitCalls = (deps.emit as jest.Mock).mock.calls;
      const narrativeCalls = emitCalls.filter(
        (args: unknown[]) =>
          (args[0] as { type: string }).type === "social.agent:narrative",
      );
      const tags = narrativeCalls.map(
        (args: unknown[]) =>
          (args[0] as { payload: { tag: string } }).payload.tag,
      );
      expect(tags).toContain("searching");
      expect(tags).toContain("success");
    });

    it("should include contextIds in probe run call", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runPlatformProbeStage(ctx, deps);

      expect(deps.platformProbe.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            contextIds: { wechat: "ctx-s2-w", xiaohongshu: "ctx-s2-x" },
          }),
        }),
      );
    });
  });

  describe("platformProbe failure", () => {
    it("should throw when probeResult.state === 'failed'", async () => {
      const deps = makeDeps({
        platformProbe: {
          run: jest.fn().mockResolvedValue({ state: "failed", output: null }),
        } as unknown as CommonDeps["platformProbe"],
      });
      const ctx = makeCtx();

      await expect(runPlatformProbeStage(ctx, deps)).rejects.toThrow(
        "[s2] PlatformProbe failed for mission mission-s2-test",
      );
    });

    it("should throw when output is null even if state is not 'failed'", async () => {
      const deps = makeDeps({
        platformProbe: {
          run: jest
            .fn()
            .mockResolvedValue({ state: "completed", output: null }),
        } as unknown as CommonDeps["platformProbe"],
      });
      const ctx = makeCtx();

      await expect(runPlatformProbeStage(ctx, deps)).rejects.toThrow(
        "[s2] PlatformProbe failed",
      );
    });
  });

  describe("narrate success text includes platform states", () => {
    it("should include platform probe states in success narrative", async () => {
      const deps = makeDeps({
        platformProbe: {
          run: jest.fn().mockResolvedValue({
            state: "completed",
            output: {
              results: [
                {
                  platform: "wechat",
                  probeResult: "ok",
                  requiredFields: ["title"],
                  schemaVersion: "v1",
                },
              ],
            },
          }),
        } as unknown as CommonDeps["platformProbe"],
      });
      const ctx = makeCtx({
        input: {
          contentId: "c2",
          platforms: ["wechat"],
          connectionIds: { wechat: "conn-w" },
          depth: "standard",
          budgetProfile: "standard",
          language: "zh-CN",
        },
      });

      await runPlatformProbeStage(ctx, deps);

      const emitCalls = (deps.emit as jest.Mock).mock.calls;
      const successNarrative = emitCalls.find(
        (args: unknown[]) =>
          (args[0] as { payload: { tag: string } })?.payload?.tag === "success",
      );
      const text = (successNarrative![0] as { payload: { text: string } })
        .payload.text;
      expect(text).toContain("wechat=ok");
    });
  });
});
