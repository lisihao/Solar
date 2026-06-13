/**
 * Unit tests for S9 — Publish Verify Stage
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

import { runPublishVerifyStage } from "../s9-publish-verify.stage";
import type {
  MissionInvariants,
  TransformPhaseCtx,
  ComposePhaseCtx,
  PublishPhaseCtx,
  VerifyPhaseCtx,
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
    publishVerifier: {
      run: jest.fn().mockResolvedValue({
        state: "completed",
        output: {
          platform: "wechat",
          verified: true,
          diffPercent: 5,
          issues: [],
        },
      }),
    } as unknown as CommonDeps["publishVerifier"],
    failureLearner: {} as CommonDeps["failureLearner"],
    postmortemClassifier: {} as CommonDeps["postmortemClassifier"],
    store: {} as CommonDeps["store"],
    ...overrides,
  };
}

type Ctx = MissionInvariants &
  TransformPhaseCtx &
  ComposePhaseCtx &
  PublishPhaseCtx &
  VerifyPhaseCtx;

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    missionId: "mission-s9-test",
    userId: "user-s9",
    t0: Date.now(),
    input: {
      contentId: "content-9",
      platforms: ["wechat"],
      connectionIds: { wechat: "conn-w" },
      depth: "standard",
      budgetProfile: "standard",
      language: "zh-CN",
    },
    billing: {} as MissionInvariants["billing"],
    pool: {} as MissionInvariants["pool"],
    budgetMultiplier: 1,
    contextIds: { wechat: "ctx-s9-w" },
    contentRaw: {
      title: "S9 title",
      body: "<p>S9 body</p>",
      digest: null,
      coverImageUrl: null,
    },
    stewardInputs: {
      remainingCreditsUsd: 2,
      estimatedCostUsd: 0.02,
      sessionExpiresAt: {},
      inProgressMissionCount: 0,
      keyCooldownCount1h: 0,
    },
    platformVersions: {
      wechat: {
        platform: "wechat",
        title: "Verify title",
        digest: null,
        body: "<p>b</p>",
        lengthMetrics: { titleChars: 12, digestChars: 0, bodyChars: 6 },
      },
    } as TransformPhaseCtx["platformVersions"],
    composed: {
      wechat: {
        platform: "wechat",
        bodyHtml: "<section><p>Sent HTML</p></section>",
      },
    } as ComposePhaseCtx["composed"],
    published: {
      wechat: {
        platform: "wechat",
        status: "PUBLISHED",
        draftUrl: "https://mp.weixin.qq.com/article/verify-test",
        platformResponse: { ret: 0 },
      },
    } as PublishPhaseCtx["published"],
    ...overrides,
  } as Ctx;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runPublishVerifyStage (s9)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("happy path — verified", () => {
    it("should call publishVerifier.run with publishedUrl and sentTitle", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runPublishVerifyStage(ctx, deps);

      expect(deps.publishVerifier.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            platform: "wechat",
            publishedUrl: "https://mp.weixin.qq.com/article/verify-test",
            sentTitle: "Verify title",
          }),
        }),
      );
    });

    it("should write verified to ctx", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runPublishVerifyStage(ctx, deps);

      expect(ctx.verified).toBeDefined();
      expect(ctx.verified!["wechat"]).toBeDefined();
      expect(ctx.verified!["wechat"].verified).toBe(true);
      expect(ctx.verified!["wechat"].diffPercent).toBe(5);
    });

    it("should emit verifying and success narrative tags", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runPublishVerifyStage(ctx, deps);

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
      expect(tags).toContain("verifying");
      expect(tags).toContain("success");
    });

    it("should use contextIds[platform] for contextId", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runPublishVerifyStage(ctx, deps);

      expect(deps.publishVerifier.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ contextId: "ctx-s9-w" }),
        }),
      );
    });

    it("should fallback contextId when missing from contextIds", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({ contextIds: {} });

      await runPublishVerifyStage(ctx, deps);

      expect(deps.publishVerifier.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            contextId: "social-wechat-mission-s9-test",
          }),
        }),
      );
    });
  });

  describe("early return when published is undefined", () => {
    it("should return early when published is undefined", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({ published: undefined });

      await runPublishVerifyStage(ctx, deps);

      expect(deps.publishVerifier.run).not.toHaveBeenCalled();
    });
  });

  describe("no PUBLISHED platforms with draftUrl", () => {
    it("should emit warning and skip verify when no platforms are PUBLISHED", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        published: {
          wechat: {
            platform: "wechat",
            status: "FAILED",
            draftUrl: null,
            platformResponse: { ret: 2 },
          },
        } as PublishPhaseCtx["published"],
      });

      await runPublishVerifyStage(ctx, deps);

      expect(deps.publishVerifier.run).not.toHaveBeenCalled();
      const emitCalls = (deps.emit as jest.Mock).mock.calls;
      const warnNarrative = emitCalls.find(
        (args: unknown[]) =>
          (args[0] as { type?: string; payload?: { tag?: string } }).type ===
            "social.agent:narrative" &&
          (args[0] as { payload: { tag: string } }).payload.tag === "warning",
      );
      expect(warnNarrative).toBeDefined();
    });

    it("should skip PUBLISHED platforms with null draftUrl", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        published: {
          wechat: {
            platform: "wechat",
            status: "PUBLISHED",
            draftUrl: null,
            platformResponse: { ret: 0 },
          },
        } as PublishPhaseCtx["published"],
      });

      await runPublishVerifyStage(ctx, deps);

      // draftUrl is null → excluded from publishedPlatforms → no verifier call
      expect(deps.publishVerifier.run).not.toHaveBeenCalled();
    });
  });

  describe("publishVerifier failure", () => {
    it("should not write to verified when verifier fails", async () => {
      const deps = makeDeps({
        publishVerifier: {
          run: jest.fn().mockResolvedValue({ state: "failed", output: null }),
        } as unknown as CommonDeps["publishVerifier"],
      });
      const ctx = makeCtx();

      await runPublishVerifyStage(ctx, deps);

      expect(ctx.verified).toBeDefined();
      expect(ctx.verified!["wechat"]).toBeUndefined();
    });
  });

  describe("skips when version or composedOut missing", () => {
    it("should skip when platformVersions lacks the platform", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({ platformVersions: undefined });

      await runPublishVerifyStage(ctx, deps);

      expect(deps.publishVerifier.run).not.toHaveBeenCalled();
    });

    it("should skip when composed lacks the platform", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({ composed: undefined });

      await runPublishVerifyStage(ctx, deps);

      expect(deps.publishVerifier.run).not.toHaveBeenCalled();
    });
  });
});
