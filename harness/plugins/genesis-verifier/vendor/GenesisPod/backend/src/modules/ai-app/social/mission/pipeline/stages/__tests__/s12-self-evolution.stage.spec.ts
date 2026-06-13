/**
 * Unit tests for S12 — Self Evolution Stage (fire-and-forget postlude)
 */

import { runSelfEvolutionStage } from "../s12-self-evolution.stage";
import type {
  MissionInvariants,
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
    leader: {} as CommonDeps["leader"],
    steward: {} as CommonDeps["steward"],
    platformProbe: {} as CommonDeps["platformProbe"],
    contentTransformer: {} as CommonDeps["contentTransformer"],
    coverArtist: {} as CommonDeps["coverArtist"],
    composer: {} as CommonDeps["composer"],
    polishReviewer: {} as CommonDeps["polishReviewer"],
    publishExecutor: {} as CommonDeps["publishExecutor"],
    publishVerifier: {} as CommonDeps["publishVerifier"],
    failureLearner: {
      recordFailure: jest.fn().mockResolvedValue(undefined),
    } as unknown as CommonDeps["failureLearner"],
    postmortemClassifier: {} as CommonDeps["postmortemClassifier"],
    store: {} as CommonDeps["store"],
    ...overrides,
  };
}

type Ctx = MissionInvariants &
  PublishPhaseCtx &
  VerifyPhaseCtx &
  SignoffPhaseCtx;

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    missionId: "mission-s12-test",
    userId: "user-s12",
    t0: Date.now(),
    input: {
      contentId: "content-12",
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
      title: "S12 title",
      body: "<p>S12 body</p>",
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
    published: {
      wechat: {
        platform: "wechat",
        status: "PUBLISHED",
        draftUrl: "https://mp/12",
        platformResponse: { ret: 0 },
      },
    } as PublishPhaseCtx["published"],
    verified: {
      wechat: {
        platform: "wechat",
        verified: true,
        diffPercent: 2,
        issues: [],
      },
    } as VerifyPhaseCtx["verified"],
    leaderSignOff: {
      phase: "signoff",
      signoff: "signed",
      overallScore: 90,
      rationale: "All good",
      generatedAt: new Date().toISOString(),
    } as SignoffPhaseCtx["leaderSignOff"],
    ...overrides,
  } as Ctx;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runSelfEvolutionStage (s12)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("happy path — no failures", () => {
    it("should emit social.mission:postlude:started event", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runSelfEvolutionStage(ctx, deps);

      expect(deps.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "social.mission:postlude:started",
          missionId: "mission-s12-test",
          userId: "user-s12",
        }),
      );
    });

    it("should report failureCount=0 when all platforms published", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runSelfEvolutionStage(ctx, deps);

      expect(deps.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ failureCount: 0 }),
        }),
      );
    });

    it("should report signed=true when leaderSignOff.signoff=signed", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runSelfEvolutionStage(ctx, deps);

      expect(deps.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ signed: true }),
        }),
      );
    });

    it("should report verifierGapsCount=0 when all platforms verified", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runSelfEvolutionStage(ctx, deps);

      expect(deps.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ verifierGapsCount: 0 }),
        }),
      );
    });

    it("should not call failureLearner.recordFailure when no failures", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runSelfEvolutionStage(ctx, deps);

      expect(deps.failureLearner.recordFailure).not.toHaveBeenCalled();
    });
  });

  describe("with publish failures", () => {
    it("should call failureLearner.recordFailure for each failed platform", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        published: {
          wechat: {
            platform: "wechat",
            status: "FAILED",
            draftUrl: null,
            platformResponse: { ret: 444002 },
          },
        } as PublishPhaseCtx["published"],
      });

      await runSelfEvolutionStage(ctx, deps);

      // recordFailure is fire-and-forget; give microtasks a chance to run
      await Promise.resolve();

      expect(deps.failureLearner.recordFailure).toHaveBeenCalledTimes(1);
    });

    it("should pass correct agentSpecId and failureCode derived from ret", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        published: {
          wechat: {
            platform: "wechat",
            status: "FAILED",
            draftUrl: null,
            platformResponse: { ret: 123 },
          },
        } as PublishPhaseCtx["published"],
      });

      await runSelfEvolutionStage(ctx, deps);
      await Promise.resolve();

      expect(deps.failureLearner.recordFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.objectContaining({
            agentSpecId: "social.publish-executor",
            failureCode: "ret-123",
            systemPrompt: "publish-to-wechat",
          }),
        }),
      );
    });

    it("should use failureCode=unknown when ret is absent from platformResponse", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        published: {
          wechat: {
            platform: "wechat",
            status: "FAILED",
            draftUrl: null,
            platformResponse: {},
          },
        } as PublishPhaseCtx["published"],
      });

      await runSelfEvolutionStage(ctx, deps);
      await Promise.resolve();

      expect(deps.failureLearner.recordFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.objectContaining({ failureCode: "unknown" }),
        }),
      );
    });

    it("should report failureCount matching number of failed platforms", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        input: {
          contentId: "c12",
          platforms: ["wechat", "xiaohongshu"],
          connectionIds: { wechat: "conn-w", xiaohongshu: "conn-x" },
          depth: "standard",
          budgetProfile: "standard",
          language: "zh-CN",
        },
        published: {
          wechat: {
            platform: "wechat",
            status: "FAILED",
            draftUrl: null,
            platformResponse: { ret: 1 },
          },
          xiaohongshu: {
            platform: "xiaohongshu",
            status: "FAILED",
            draftUrl: null,
            platformResponse: { ret: 2 },
          },
        } as PublishPhaseCtx["published"],
      });

      await runSelfEvolutionStage(ctx, deps);

      expect(deps.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ failureCount: 2 }),
        }),
      );
    });

    it("should pass missionId and userId to recordFailure", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        published: {
          wechat: {
            platform: "wechat",
            status: "FAILED",
            draftUrl: null,
            platformResponse: { ret: 500 },
          },
        } as PublishPhaseCtx["published"],
      });

      await runSelfEvolutionStage(ctx, deps);
      await Promise.resolve();

      expect(deps.failureLearner.recordFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          missionId: "mission-s12-test",
          userId: "user-s12",
        }),
      );
    });
  });

  describe("leaderSignOff state variations", () => {
    it("should report signed=false when leaderSignOff is undefined", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({ leaderSignOff: undefined });

      await runSelfEvolutionStage(ctx, deps);

      expect(deps.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ signed: false }),
        }),
      );
    });

    it("should report signed=false when signoff=reviewed", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        leaderSignOff: {
          phase: "signoff",
          signoff: "reviewed",
          overallScore: 55,
          rationale: "Some concerns",
          generatedAt: new Date().toISOString(),
        } as SignoffPhaseCtx["leaderSignOff"],
      });

      await runSelfEvolutionStage(ctx, deps);

      expect(deps.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ signed: false }),
        }),
      );
    });
  });

  describe("verifier gap counting", () => {
    it("should count platforms with verified=false as gaps", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        input: {
          contentId: "c12",
          platforms: ["wechat", "xiaohongshu"],
          connectionIds: { wechat: "conn-w", xiaohongshu: "conn-x" },
          depth: "standard",
          budgetProfile: "standard",
          language: "zh-CN",
        },
        verified: {
          wechat: {
            platform: "wechat",
            verified: false,
            diffPercent: 40,
            issues: ["diff too high"],
          },
          xiaohongshu: {
            platform: "xiaohongshu",
            verified: true,
            diffPercent: 1,
            issues: [],
          },
        } as VerifyPhaseCtx["verified"],
      });

      await runSelfEvolutionStage(ctx, deps);

      expect(deps.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ verifierGapsCount: 1 }),
        }),
      );
    });

    it("should report verifierGapsCount=0 when verified is undefined", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({ verified: undefined });

      await runSelfEvolutionStage(ctx, deps);

      expect(deps.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ verifierGapsCount: 0 }),
        }),
      );
    });
  });

  describe("published is undefined", () => {
    it("should emit postlude event even when published is undefined", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({ published: undefined });

      await runSelfEvolutionStage(ctx, deps);

      expect(deps.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "social.mission:postlude:started" }),
      );
    });

    it("should not call failureLearner when published is undefined", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({ published: undefined });

      await runSelfEvolutionStage(ctx, deps);
      await Promise.resolve();

      expect(deps.failureLearner.recordFailure).not.toHaveBeenCalled();
    });
  });

  describe("emit failure is swallowed", () => {
    it("should not throw when emit rejects", async () => {
      const deps = makeDeps({
        emit: jest.fn().mockRejectedValue(new Error("WebSocket disconnected")),
      });
      const ctx = makeCtx();

      await expect(runSelfEvolutionStage(ctx, deps)).resolves.toBeUndefined();
    });
  });

  describe("failureLearner.recordFailure error is swallowed", () => {
    it("should not throw when recordFailure rejects", async () => {
      const deps = makeDeps({
        failureLearner: {
          recordFailure: jest
            .fn()
            .mockRejectedValue(new Error("DB unavailable")),
        } as unknown as CommonDeps["failureLearner"],
      });
      const ctx = makeCtx({
        published: {
          wechat: {
            platform: "wechat",
            status: "FAILED",
            draftUrl: null,
            platformResponse: { ret: 1 },
          },
        } as PublishPhaseCtx["published"],
      });

      await expect(runSelfEvolutionStage(ctx, deps)).resolves.toBeUndefined();

      // allow the fire-and-forget to settle
      await new Promise((r) => setTimeout(r, 10));
    });

    it("should call log.warn when recordFailure throws", async () => {
      const deps = makeDeps({
        failureLearner: {
          recordFailure: jest.fn().mockRejectedValue(new Error("timeout")),
        } as unknown as CommonDeps["failureLearner"],
      });
      const ctx = makeCtx({
        published: {
          wechat: {
            platform: "wechat",
            status: "FAILED",
            draftUrl: null,
            platformResponse: { ret: 9 },
          },
        } as PublishPhaseCtx["published"],
      });

      await runSelfEvolutionStage(ctx, deps);
      // allow fire-and-forget to settle
      await new Promise((r) => setTimeout(r, 10));

      expect(deps.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("postlude failureLearner.recordFailure threw"),
      );
    });
  });

  describe("skips PUBLISHED platforms when collecting failures", () => {
    it("should not call recordFailure for PUBLISHED platforms", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        input: {
          contentId: "c12",
          platforms: ["wechat", "xiaohongshu"],
          connectionIds: { wechat: "conn-w", xiaohongshu: "conn-x" },
          depth: "standard",
          budgetProfile: "standard",
          language: "zh-CN",
        },
        published: {
          wechat: {
            platform: "wechat",
            status: "PUBLISHED",
            draftUrl: "https://mp/ok",
            platformResponse: { ret: 0 },
          },
          xiaohongshu: {
            platform: "xiaohongshu",
            status: "FAILED",
            draftUrl: null,
            platformResponse: { ret: 77 },
          },
        } as PublishPhaseCtx["published"],
      });

      await runSelfEvolutionStage(ctx, deps);
      await Promise.resolve();

      // Only xiaohongshu failed, so only 1 recordFailure call
      expect(deps.failureLearner.recordFailure).toHaveBeenCalledTimes(1);
      expect(deps.failureLearner.recordFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.objectContaining({
            systemPrompt: "publish-to-xiaohongshu",
          }),
        }),
      );
    });
  });
});
