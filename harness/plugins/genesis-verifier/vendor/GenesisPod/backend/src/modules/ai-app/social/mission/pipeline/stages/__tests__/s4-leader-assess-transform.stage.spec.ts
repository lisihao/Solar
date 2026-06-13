/**
 * Unit tests for S4 — Leader Assess Transform Stage
 */

import { runLeaderAssessTransformStage } from "../s4-leader-assess-transform.stage";
import type {
  MissionInvariants,
  TransformPhaseCtx,
  AssessPhaseCtx,
} from "../../mission-context";
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
    leader: {
      run: jest.fn().mockResolvedValue({
        state: "completed",
        output: {
          phase: "assess-transform",
          perPlatform: [
            {
              platform: "wechat",
              verdict: "approve",
              reason: "Quality OK",
              score: 85,
            },
          ],
        },
      }),
    } as unknown as CommonDeps["leader"],
    steward: {} as CommonDeps["steward"],
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

type Ctx = MissionInvariants & TransformPhaseCtx & AssessPhaseCtx;

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    missionId: "mission-s4-test",
    userId: "user-s4",
    t0: Date.now(),
    input: {
      contentId: "content-4",
      platforms: ["wechat"],
      connectionIds: { wechat: "conn-w" },
      depth: "standard",
      budgetProfile: "standard",
      language: "zh-CN",
    },
    billing: {} as MissionInvariants["billing"],
    pool: {} as MissionInvariants["pool"],
    budgetMultiplier: 1,
    contextIds: { wechat: "ctx-w" },
    contentRaw: {
      title: "S4 title",
      body: "<p>Body</p>",
      digest: null,
      coverImageUrl: null,
    },
    stewardInputs: {
      remainingCreditsUsd: 7,
      estimatedCostUsd: 0.02,
      sessionExpiresAt: {},
      inProgressMissionCount: 0,
      keyCooldownCount1h: 0,
    },
    platformVersions: {
      wechat: {
        platform: "wechat",
        title: "Wechat title",
        digest: "Wechat digest",
        body: "<p>Wechat body</p>",
        lengthMetrics: { titleChars: 12, digestChars: 13, bodyChars: 17 },
      },
    } as TransformPhaseCtx["platformVersions"],
    ...overrides,
  } as Ctx;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runLeaderAssessTransformStage (s4)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("happy path — all approved", () => {
    it("should call leader.run with phase=assess-transform", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runLeaderAssessTransformStage(ctx, deps);

      expect(deps.leader.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            phase: "assess-transform",
            qualityBar: "standard",
          }),
        }),
      );
    });

    it("should write leaderAssess to ctx", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runLeaderAssessTransformStage(ctx, deps);

      expect(ctx.leaderAssess).toBeDefined();
      expect(ctx.leaderAssess!.phase).toBe("assess-transform");
      expect(ctx.leaderAssess!.perPlatform).toHaveLength(1);
    });

    it("should emit reviewing and success narrative tags", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runLeaderAssessTransformStage(ctx, deps);

      const emitCalls = (deps.emit as jest.Mock).mock.calls;
      const tags = emitCalls
        .filter(
          (args: unknown[]) =>
            (args[0] as { type: string }).type === "social.agent:narrative",
        )
        .map(
          (args: unknown[]) =>
            (args[0] as { payload: { tag: string } }).payload.tag,
        );
      expect(tags).toContain("reviewing");
      expect(tags).toContain("success");
    });

    it("should pass platformVersions as array to leader.run", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        platformVersions: {
          wechat: {
            platform: "wechat",
            title: "W title",
            digest: "W digest",
            body: "<p>W body</p>",
            lengthMetrics: { titleChars: 7, digestChars: 8, bodyChars: 10 },
          },
          xiaohongshu: {
            platform: "xiaohongshu",
            title: "XHS title",
            digest: null,
            body: "<p>XHS body</p>",
            lengthMetrics: { titleChars: 9, digestChars: 0, bodyChars: 12 },
          },
        } as TransformPhaseCtx["platformVersions"],
      });

      await runLeaderAssessTransformStage(ctx, deps);

      const leaderRunCall = (deps.leader.run as jest.Mock).mock.calls[0][0];
      expect(leaderRunCall.input.platformVersions).toHaveLength(2);
    });
  });

  describe("missing platformVersions", () => {
    it("should throw when platformVersions is undefined", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({ platformVersions: undefined });

      await expect(runLeaderAssessTransformStage(ctx, deps)).rejects.toThrow(
        "[s4] missing platformVersions for mission mission-s4-test",
      );
    });
  });

  describe("leader returns failed state", () => {
    it("should throw when leader.run returns state=failed", async () => {
      const deps = makeDeps({
        leader: {
          run: jest.fn().mockResolvedValue({ state: "failed", output: null }),
        } as unknown as CommonDeps["leader"],
      });
      const ctx = makeCtx();

      await expect(runLeaderAssessTransformStage(ctx, deps)).rejects.toThrow(
        "[s4] Leader assess-transform failed",
      );
    });

    it("should throw when output.phase does not match assess-transform", async () => {
      const deps = makeDeps({
        leader: {
          run: jest.fn().mockResolvedValue({
            state: "completed",
            output: { phase: "foreword", perPlatform: [] },
          }),
        } as unknown as CommonDeps["leader"],
      });
      const ctx = makeCtx();

      await expect(runLeaderAssessTransformStage(ctx, deps)).rejects.toThrow(
        "[s4] Leader assess-transform failed",
      );
    });
  });

  describe("all platforms rejected", () => {
    // 2026-05-19: 行为变更 — 全 reject 不再 throw（之前会让 mission 完全失败，
    //   用户看不到任何产出）。现在：markStageDegraded + 发 warning narrative，
    //   mission 继续往下跑，最终发布把关交 s9 foreword。
    it("should markStageDegraded + emit warning when all platforms rejected (not throw)", async () => {
      const deps = makeDeps({
        leader: {
          run: jest.fn().mockResolvedValue({
            state: "completed",
            output: {
              phase: "assess-transform",
              perPlatform: [
                {
                  platform: "wechat",
                  verdict: "reject",
                  reason: "Low quality",
                  score: 20,
                },
              ],
            },
          }),
        } as unknown as CommonDeps["leader"],
      });
      const ctx = makeCtx();

      await expect(
        runLeaderAssessTransformStage(ctx, deps),
      ).resolves.toBeUndefined();
      expect(deps.markStageDegraded).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        "s4-leader-assess-transform",
        expect.stringContaining("Low quality"),
      );
    });
  });

  describe("partial rejection", () => {
    it("should call markStageDegraded when some platforms are rejected", async () => {
      const deps = makeDeps({
        leader: {
          run: jest.fn().mockResolvedValue({
            state: "completed",
            output: {
              phase: "assess-transform",
              perPlatform: [
                {
                  platform: "wechat",
                  verdict: "approve",
                  reason: "OK",
                  score: 80,
                },
                {
                  platform: "xiaohongshu",
                  verdict: "reject",
                  reason: "Body too short",
                  score: 30,
                },
              ],
            },
          }),
        } as unknown as CommonDeps["leader"],
      });
      const ctx = makeCtx({
        platformVersions: {
          wechat: {
            platform: "wechat",
            title: "W title",
            digest: null,
            body: "<p>b</p>",
            lengthMetrics: { titleChars: 7, digestChars: 0, bodyChars: 6 },
          },
          xiaohongshu: {
            platform: "xiaohongshu",
            title: "X title",
            digest: null,
            body: "<p>b</p>",
            lengthMetrics: { titleChars: 7, digestChars: 0, bodyChars: 6 },
          },
        } as TransformPhaseCtx["platformVersions"],
      });

      await runLeaderAssessTransformStage(ctx, deps);

      expect(deps.markStageDegraded).toHaveBeenCalledWith(
        "mission-s4-test",
        "user-s4",
        "s4-leader-assess-transform",
        expect.stringContaining("xiaohongshu"),
      );
    });

    it("should not throw when at least one platform is approved", async () => {
      const deps = makeDeps({
        leader: {
          run: jest.fn().mockResolvedValue({
            state: "completed",
            output: {
              phase: "assess-transform",
              perPlatform: [
                {
                  platform: "wechat",
                  verdict: "approve",
                  reason: "OK",
                  score: 80,
                },
                {
                  platform: "xiaohongshu",
                  verdict: "reject",
                  reason: "Bad",
                  score: 20,
                },
              ],
            },
          }),
        } as unknown as CommonDeps["leader"],
      });
      const ctx = makeCtx({
        platformVersions: {
          wechat: {
            platform: "wechat",
            title: "W t",
            digest: null,
            body: "<p>b</p>",
            lengthMetrics: { titleChars: 3, digestChars: 0, bodyChars: 6 },
          },
          xiaohongshu: {
            platform: "xiaohongshu",
            title: "X t",
            digest: null,
            body: "<p>b</p>",
            lengthMetrics: { titleChars: 3, digestChars: 0, bodyChars: 6 },
          },
        } as TransformPhaseCtx["platformVersions"],
      });

      await expect(
        runLeaderAssessTransformStage(ctx, deps),
      ).resolves.toBeUndefined();
    });
  });
});
