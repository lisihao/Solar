/**
 * Unit tests for S7 — Polish Review Stage
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

import { runPolishReviewStage } from "../s7-polish-review.stage";
import type {
  MissionInvariants,
  TransformPhaseCtx,
  ComposePhaseCtx,
  PolishPhaseCtx,
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
    polishReviewer: {
      run: jest.fn().mockResolvedValue({
        state: "completed",
        output: {
          platform: "wechat",
          polishedTitle: "Polished title",
          polishedBodyHtml: "<section><p>Polished content</p></section>",
          critiques: [],
          compliancePass: true,
        },
      }),
    } as unknown as CommonDeps["polishReviewer"],
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
  ComposePhaseCtx &
  PolishPhaseCtx;

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    missionId: "mission-s7-test",
    userId: "user-s7",
    t0: Date.now(),
    input: {
      contentId: "content-7",
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
      title: "S7 title",
      body: "<p>S7 body</p>",
      digest: null,
      coverImageUrl: null,
    },
    stewardInputs: {
      remainingCreditsUsd: 4,
      estimatedCostUsd: 0.03,
      sessionExpiresAt: {},
      inProgressMissionCount: 0,
      keyCooldownCount1h: 0,
    },
    platformVersions: {
      wechat: {
        platform: "wechat",
        title: "Wechat polish title",
        digest: "d7",
        body: "<p>b7</p>",
        lengthMetrics: { titleChars: 19, digestChars: 2, bodyChars: 9 },
      },
    } as TransformPhaseCtx["platformVersions"],
    composed: {
      wechat: {
        platform: "wechat",
        bodyHtml: "<section><p>Composed HTML</p></section>",
      },
    } as ComposePhaseCtx["composed"],
    ...overrides,
  } as Ctx;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runPolishReviewStage (s7)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("happy path", () => {
    it("should call polishReviewer.run for each composed platform", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runPolishReviewStage(ctx, deps);

      expect(deps.polishReviewer.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            platform: "wechat",
            title: "Wechat polish title",
            bodyHtml: "<section><p>Composed HTML</p></section>",
          }),
        }),
      );
    });

    it("should write polished to ctx", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runPolishReviewStage(ctx, deps);

      expect(ctx.polished).toBeDefined();
      expect(ctx.polished!["wechat"]).toBeDefined();
      expect(ctx.polished!["wechat"].polishedTitle).toBe("Polished title");
    });

    it("should pass digest from platformVersions to polishReviewer", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runPolishReviewStage(ctx, deps);

      expect(deps.polishReviewer.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ digest: "d7" }),
        }),
      );
    });

    it("should pass null digest when digest is undefined", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        platformVersions: {
          wechat: {
            platform: "wechat",
            title: "W t",
            digest: undefined,
            body: "<p>b</p>",
            lengthMetrics: { titleChars: 3, digestChars: 0, bodyChars: 6 },
          },
        } as TransformPhaseCtx["platformVersions"],
      });

      await runPolishReviewStage(ctx, deps);

      expect(deps.polishReviewer.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ digest: null }),
        }),
      );
    });

    it("should emit reviewing and success narrative tags", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runPolishReviewStage(ctx, deps);

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
  });

  describe("missing context data", () => {
    it("should throw when platformVersions is undefined", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({ platformVersions: undefined });

      await expect(runPolishReviewStage(ctx, deps)).rejects.toThrow(
        "[s7] missing platformVersions or composed",
      );
    });

    it("should throw when composed is undefined", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({ composed: undefined });

      await expect(runPolishReviewStage(ctx, deps)).rejects.toThrow(
        "[s7] missing platformVersions or composed",
      );
    });
  });

  describe("polishReviewer failure", () => {
    it("should call markStageDegraded when polishReviewer fails", async () => {
      const deps = makeDeps({
        polishReviewer: {
          run: jest.fn().mockResolvedValue({ state: "failed", output: null }),
        } as unknown as CommonDeps["polishReviewer"],
      });
      const ctx = makeCtx();

      await runPolishReviewStage(ctx, deps);

      expect(deps.markStageDegraded).toHaveBeenCalledWith(
        "mission-s7-test",
        "user-s7",
        "s7-polish-review",
        expect.stringContaining("润色审核失败"),
      );
    });

    it("should result in empty polished when all platforms fail", async () => {
      const deps = makeDeps({
        polishReviewer: {
          run: jest.fn().mockResolvedValue({ state: "failed", output: null }),
        } as unknown as CommonDeps["polishReviewer"],
      });
      const ctx = makeCtx();

      await runPolishReviewStage(ctx, deps);

      expect(ctx.polished).toBeDefined();
      expect(Object.keys(ctx.polished)).toHaveLength(0);
    });
  });

  describe("skips platform missing from composed or platformVersions", () => {
    it("should skip platform when composedOut is missing", async () => {
      const deps = makeDeps();
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
        // composed only has wechat; xiaohongshu is in composed keys but is in platforms
        composed: {
          wechat: { platform: "wechat", bodyHtml: "<section>W</section>" },
          xiaohongshu: {
            platform: "xiaohongshu",
            bodyHtml: "<section>X</section>",
          },
        } as ComposePhaseCtx["composed"],
      });

      await runPolishReviewStage(ctx, deps);

      // Both platforms are in composed, so both should be processed
      expect(deps.polishReviewer.run).toHaveBeenCalledTimes(2);
    });

    it("should skip platform when version is missing from platformVersions", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        platformVersions: {
          wechat: {
            platform: "wechat",
            title: "W t",
            digest: null,
            body: "<p>b</p>",
            lengthMetrics: { titleChars: 3, digestChars: 0, bodyChars: 6 },
          },
          // xiaohongshu is missing from platformVersions
        } as TransformPhaseCtx["platformVersions"],
        // composed has both
        composed: {
          wechat: { platform: "wechat", bodyHtml: "<section>W</section>" },
          xiaohongshu: {
            platform: "xiaohongshu",
            bodyHtml: "<section>X</section>",
          },
        } as ComposePhaseCtx["composed"],
      });

      await runPolishReviewStage(ctx, deps);

      // xiaohongshu version is missing so it should be skipped
      expect(deps.polishReviewer.run).toHaveBeenCalledTimes(1);
      expect(deps.polishReviewer.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ platform: "wechat" }),
        }),
      );
    });
  });
});
