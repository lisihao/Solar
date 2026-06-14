/**
 * Unit tests for S8b — Publish Retry Stage
 */

jest.mock("@/modules/ai-harness/facade", () => ({
  ConcurrencyLimiter: jest.fn().mockImplementation(() => ({
    run: jest.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
  })),
  // P4 (2026-05-24): social narrative.util now delegates to harness narrate.
  // Real-shape passthrough so existing tests that inspect deps.emit() payload.tag
  // keep working.
  narrate: jest.fn(
    async (
      emit: (e: unknown) => Promise<void>,
      missionId: string,
      userId: string,
      eventType: string,
      ev: {
        stage: string;
        role: string;
        tag: string;
        text: string;
        agentId?: string;
      },
    ) => {
      await emit({
        type: eventType,
        missionId,
        userId,
        agentId: ev.agentId,
        payload: {
          stage: ev.stage,
          role: ev.role,
          tag: ev.tag,
          text: ev.text,
          agentId: ev.agentId,
        },
      }).catch(() => undefined);
    },
  ),
}));

import { runPublishRetryStage } from "../s8b-publish-retry.stage";
import type {
  MissionInvariants,
  TransformPhaseCtx,
  ComposePhaseCtx,
  CraftPhaseCtx,
  PublishPhaseCtx,
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
    publishExecutor: {
      run: jest.fn().mockResolvedValue({
        state: "completed",
        output: {
          platform: "wechat",
          status: "PUBLISHED",
          draftUrl: "https://mp.weixin.qq.com/draft/retry-1",
          platformResponse: { ret: 0 },
        },
      }),
    } as unknown as CommonDeps["publishExecutor"],
    publishVerifier: {} as CommonDeps["publishVerifier"],
    failureLearner: {} as CommonDeps["failureLearner"],
    postmortemClassifier: {} as CommonDeps["postmortemClassifier"],
    store: {} as CommonDeps["store"],
    ...overrides,
  };
}

type Ctx = MissionInvariants &
  TransformPhaseCtx &
  ComposePhaseCtx &
  CraftPhaseCtx &
  PublishPhaseCtx;

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    missionId: "mission-s8b-test",
    userId: "user-s8b",
    t0: Date.now(),
    input: {
      contentId: "content-8b",
      platforms: ["wechat"],
      connectionIds: { wechat: "conn-wechat-8b" },
      depth: "standard",
      budgetProfile: "standard",
      language: "zh-CN",
    },
    billing: {} as MissionInvariants["billing"],
    pool: {} as MissionInvariants["pool"],
    budgetMultiplier: 1,
    contextIds: { wechat: "ctx-s8b-w" },
    contentRaw: {
      title: "S8b title",
      body: "<p>S8b body</p>",
      digest: null,
      coverImageUrl: null,
    },
    stewardInputs: {
      remainingCreditsUsd: 2,
      estimatedCostUsd: 0.05,
      sessionExpiresAt: {},
      inProgressMissionCount: 0,
      keyCooldownCount1h: 0,
    },
    platformVersions: {
      wechat: {
        platform: "wechat",
        title: "Retry title",
        digest: "Retry digest",
        body: "<p>Retry body</p>",
        lengthMetrics: { titleChars: 12, digestChars: 12, bodyChars: 14 },
      },
    } as TransformPhaseCtx["platformVersions"],
    composed: {
      wechat: {
        platform: "wechat",
        bodyHtml: "<section><p>Retry HTML</p></section>",
      },
    } as ComposePhaseCtx["composed"],
    covers: {
      wechat: {
        coverUrl: "https://cdn.example.com/retry.jpg",
        thumbMediaId: "thumb-r",
        cropMultiList: [],
      },
    } as CraftPhaseCtx["covers"],
    published: {
      wechat: {
        platform: "wechat",
        status: "FAILED",
        draftUrl: null,
        platformResponse: { ret: 444002 },
      },
    } as PublishPhaseCtx["published"],
    retryRound: {},
    ...overrides,
  } as Ctx;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runPublishRetryStage (s8b)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("retry succeeds", () => {
    it("should call publishExecutor.run for failed platforms", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runPublishRetryStage(ctx, deps);

      expect(deps.publishExecutor.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            platform: "wechat",
            connectionId: "conn-wechat-8b",
          }),
          ctx: expect.objectContaining({
            agentId: expect.stringContaining("retry"),
          }),
        }),
      );
    });

    it("should update published with new result on retry success", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runPublishRetryStage(ctx, deps);

      expect(ctx.published!["wechat"].status).toBe("PUBLISHED");
      expect(ctx.published!["wechat"].draftUrl).toBe(
        "https://mp.weixin.qq.com/draft/retry-1",
      );
    });

    it("should increment retryRound for the platform", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runPublishRetryStage(ctx, deps);

      expect(ctx.retryRound!["wechat"]).toBe(1);
    });
  });

  describe("early return when published is undefined", () => {
    it("should return early when ctx.published is undefined", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({ published: undefined });

      await runPublishRetryStage(ctx, deps);

      expect(deps.publishExecutor.run).not.toHaveBeenCalled();
    });
  });

  describe("no failed platforms", () => {
    it("should not retry when all platforms are PUBLISHED", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        published: {
          wechat: {
            platform: "wechat",
            status: "PUBLISHED",
            draftUrl: "https://mp/1",
            platformResponse: { ret: 0 },
          },
        } as PublishPhaseCtx["published"],
      });

      await runPublishRetryStage(ctx, deps);

      expect(deps.publishExecutor.run).not.toHaveBeenCalled();
    });
  });

  describe("retry round limit", () => {
    it("should not retry when platform has reached MAX_RETRY_ROUNDS (2)", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        retryRound: { wechat: 2 }, // already at max
      });

      await runPublishRetryStage(ctx, deps);

      expect(deps.publishExecutor.run).not.toHaveBeenCalled();
    });

    it("should emit warning narrative when retry rounds exhausted", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        retryRound: { wechat: 2 },
      });

      await runPublishRetryStage(ctx, deps);

      const emitCalls = (deps.emit as jest.Mock).mock.calls;
      const narrativeCalls = emitCalls.filter(
        (args: unknown[]) =>
          (args[0] as { type: string }).type === "social.agent:narrative",
      );
      const warningCall = narrativeCalls.find(
        (args: unknown[]) =>
          (args[0] as { payload: { tag: string } }).payload.tag === "warning",
      );
      expect(warningCall).toBeDefined();
      expect(
        (warningCall![0] as { payload: { text: string } }).payload.text,
      ).toContain("耗尽重试次数");
    });

    it("should allow retry when retryRound is 1 (< MAX of 2)", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        retryRound: { wechat: 1 }, // 1 < 2, still allowed
      });

      await runPublishRetryStage(ctx, deps);

      expect(deps.publishExecutor.run).toHaveBeenCalledTimes(1);
      expect(ctx.retryRound!["wechat"]).toBe(2);
    });
  });

  describe("retry executor fails", () => {
    it("should not update published when retry executor returns state=failed", async () => {
      const deps = makeDeps({
        publishExecutor: {
          run: jest.fn().mockResolvedValue({ state: "failed", output: null }),
        } as unknown as CommonDeps["publishExecutor"],
      });
      const ctx = makeCtx();

      await runPublishRetryStage(ctx, deps);

      // original failed status should remain
      expect(ctx.published!["wechat"].status).toBe("FAILED");
    });

    it("should still increment retryRound even on failure", async () => {
      const deps = makeDeps({
        publishExecutor: {
          run: jest.fn().mockResolvedValue({ state: "failed", output: null }),
        } as unknown as CommonDeps["publishExecutor"],
      });
      const ctx = makeCtx();

      await runPublishRetryStage(ctx, deps);

      expect(ctx.retryRound!["wechat"]).toBe(1);
    });
  });

  describe("missing sub-phase data skips platform", () => {
    it("should skip platform when platformVersions is missing for it", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        platformVersions: {} as TransformPhaseCtx["platformVersions"],
      });

      await runPublishRetryStage(ctx, deps);

      expect(deps.publishExecutor.run).not.toHaveBeenCalled();
    });

    it("should skip platform when cover is missing", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        covers: {} as CraftPhaseCtx["covers"],
      });

      await runPublishRetryStage(ctx, deps);

      expect(deps.publishExecutor.run).not.toHaveBeenCalled();
    });
  });

  describe("retryRound defaults to empty object", () => {
    it("should treat undefined retryRound as {} and allow retry", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({ retryRound: undefined });

      await runPublishRetryStage(ctx, deps);

      expect(deps.publishExecutor.run).toHaveBeenCalledTimes(1);
    });
  });
});
