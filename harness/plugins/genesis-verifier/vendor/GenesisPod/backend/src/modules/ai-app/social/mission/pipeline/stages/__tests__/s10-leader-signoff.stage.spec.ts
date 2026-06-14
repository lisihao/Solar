/**
 * Unit tests for S10 — Leader Signoff Stage
 */

import { runLeaderSignoffStage } from "../s10-leader-signoff.stage";
import type {
  MissionInvariants,
  TransformPhaseCtx,
  PublishPhaseCtx,
  VerifyPhaseCtx,
  SignoffPhaseCtx,
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
      run: jest
        .fn()
        .mockResolvedValueOnce({
          // foreword call
          state: "completed",
          output: { phase: "foreword", summary: "Great content", risks: [] },
        })
        .mockResolvedValueOnce({
          // signoff call
          state: "completed",
          output: {
            phase: "signoff",
            signoff: "signed",
            overallScore: 92,
            rationale: "All platforms published successfully",
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

type Ctx = MissionInvariants &
  TransformPhaseCtx &
  PublishPhaseCtx &
  VerifyPhaseCtx &
  SignoffPhaseCtx;

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    missionId: "mission-s10-test",
    userId: "user-s10",
    t0: Date.now(),
    input: {
      contentId: "content-10",
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
      title: "S10 title",
      body: "<p>S10 body</p>",
      digest: null,
      coverImageUrl: null,
    },
    stewardInputs: {
      remainingCreditsUsd: 1,
      estimatedCostUsd: 0.1,
      sessionExpiresAt: {},
      inProgressMissionCount: 0,
      keyCooldownCount1h: 0,
    },
    platformVersions: {
      wechat: {
        platform: "wechat",
        title: "Signoff title",
        digest: "d10",
        body: "<p>b10</p>",
        lengthMetrics: { titleChars: 13, digestChars: 3, bodyChars: 9 },
      },
    } as TransformPhaseCtx["platformVersions"],
    published: {
      wechat: {
        platform: "wechat",
        status: "PUBLISHED",
        draftUrl: "https://mp/1",
        platformResponse: { ret: 0 },
      },
    } as PublishPhaseCtx["published"],
    verified: {
      wechat: {
        platform: "wechat",
        verified: true,
        diffPercent: 3,
        issues: [],
      },
    } as VerifyPhaseCtx["verified"],
    ...overrides,
  } as Ctx;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runLeaderSignoffStage (s10)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("happy path — signed", () => {
    it("should call leader.run twice (foreword then signoff)", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runLeaderSignoffStage(ctx, deps);

      expect(deps.leader.run).toHaveBeenCalledTimes(2);
    });

    it("should call foreword with phase=foreword first", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runLeaderSignoffStage(ctx, deps);

      const firstCall = (deps.leader.run as jest.Mock).mock.calls[0][0];
      expect(firstCall.input.phase).toBe("foreword");
    });

    it("should call signoff with phase=signoff second", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runLeaderSignoffStage(ctx, deps);

      const secondCall = (deps.leader.run as jest.Mock).mock.calls[1][0];
      expect(secondCall.input.phase).toBe("signoff");
    });

    it("should write leaderForeword to ctx when foreword succeeds", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runLeaderSignoffStage(ctx, deps);

      expect(ctx.leaderForeword).toBeDefined();
      expect(ctx.leaderForeword!.phase).toBe("foreword");
      expect(ctx.leaderForeword!.generatedAt).toBeDefined();
    });

    it("should write leaderSignOff to ctx when signoff succeeds", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runLeaderSignoffStage(ctx, deps);

      expect(ctx.leaderSignOff).toBeDefined();
      expect(ctx.leaderSignOff!.signoff).toBe("signed");
      expect(ctx.leaderSignOff!.overallScore).toBe(92);
    });

    it("should emit success narrative when signoff=signed", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runLeaderSignoffStage(ctx, deps);

      const emitCalls = (deps.emit as jest.Mock).mock.calls;
      const signNarratives = emitCalls.filter(
        (args: unknown[]) =>
          (args[0] as { type: string }).type === "social.agent:narrative" &&
          (args[0] as { payload: { tag: string } }).payload.tag === "success",
      );
      expect(signNarratives.length).toBeGreaterThan(0);
    });

    it("should build platformResults from published and verified data", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runLeaderSignoffStage(ctx, deps);

      const signoffCall = (deps.leader.run as jest.Mock).mock.calls[1][0];
      expect(signoffCall.input.platformResults).toHaveLength(1);
      expect(signoffCall.input.platformResults[0]).toEqual(
        expect.objectContaining({
          platform: "wechat",
          status: "PUBLISHED",
          url: "https://mp/1",
        }),
      );
    });

    it("should compute verifierDiff as diffPercent/100", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runLeaderSignoffStage(ctx, deps);

      const signoffCall = (deps.leader.run as jest.Mock).mock.calls[1][0];
      const wechatResult = signoffCall.input.platformResults[0];
      expect(wechatResult.verifierDiff).toBeCloseTo(0.03);
    });
  });

  describe("missing platformVersions", () => {
    it("should throw when platformVersions is undefined", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({ platformVersions: undefined });

      await expect(runLeaderSignoffStage(ctx, deps)).rejects.toThrow(
        "[s10] missing platformVersions",
      );
    });
  });

  describe("foreword fails gracefully", () => {
    it("should continue to signoff when foreword returns failed state", async () => {
      const deps = makeDeps({
        leader: {
          run: jest
            .fn()
            .mockResolvedValueOnce({ state: "failed", output: null }) // foreword fails
            .mockResolvedValueOnce({
              state: "completed",
              output: {
                phase: "signoff",
                signoff: "signed",
                overallScore: 75,
                rationale: "OK",
              },
            }),
        } as unknown as CommonDeps["leader"],
      });
      const ctx = makeCtx();

      await runLeaderSignoffStage(ctx, deps);

      expect(ctx.leaderForeword).toBeUndefined();
      expect(ctx.leaderSignOff).toBeDefined();
    });

    it("should not write leaderForeword when foreword output phase mismatches", async () => {
      const deps = makeDeps({
        leader: {
          run: jest
            .fn()
            .mockResolvedValueOnce({
              state: "completed",
              output: { phase: "assess-transform", perPlatform: [] }, // wrong phase
            })
            .mockResolvedValueOnce({
              state: "completed",
              output: {
                phase: "signoff",
                signoff: "reviewed",
                overallScore: 60,
                rationale: "OK",
              },
            }),
        } as unknown as CommonDeps["leader"],
      });
      const ctx = makeCtx();

      await runLeaderSignoffStage(ctx, deps);

      expect(ctx.leaderForeword).toBeUndefined();
    });
  });

  describe("signoff=reviewed emits warning", () => {
    it("should emit warning narrative when signoff=reviewed", async () => {
      const deps = makeDeps({
        leader: {
          run: jest
            .fn()
            .mockResolvedValueOnce({
              state: "completed",
              output: { phase: "foreword", summary: "OK", risks: [] },
            })
            .mockResolvedValueOnce({
              state: "completed",
              output: {
                phase: "signoff",
                signoff: "reviewed",
                overallScore: 55,
                rationale: "Some issues",
              },
            }),
        } as unknown as CommonDeps["leader"],
      });
      const ctx = makeCtx();

      await runLeaderSignoffStage(ctx, deps);

      const emitCalls = (deps.emit as jest.Mock).mock.calls;
      const warnNarrative = emitCalls.find(
        (args: unknown[]) =>
          (args[0] as { type: string }).type === "social.agent:narrative" &&
          (args[0] as { payload: { tag: string } }).payload.tag === "warning",
      );
      expect(warnNarrative).toBeDefined();
    });
  });

  describe("platform status defaults", () => {
    it("should default platform status to FAILED when published is undefined", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({ published: undefined });

      await runLeaderSignoffStage(ctx, deps);

      const signoffCall = (deps.leader.run as jest.Mock).mock.calls[1][0];
      expect(signoffCall.input.platformResults[0].status).toBe("FAILED");
    });

    it("should set verifierDiff=null when verified is undefined", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({ verified: undefined });

      await runLeaderSignoffStage(ctx, deps);

      const signoffCall = (deps.leader.run as jest.Mock).mock.calls[1][0];
      expect(signoffCall.input.platformResults[0].verifierDiff).toBeNull();
    });
  });
});
