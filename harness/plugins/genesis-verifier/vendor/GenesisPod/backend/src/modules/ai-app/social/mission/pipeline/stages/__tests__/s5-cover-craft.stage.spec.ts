/**
 * Unit tests for S5 — Cover Craft Stage
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

import { runCoverCraftStage } from "../s5-cover-craft.stage";
import type {
  MissionInvariants,
  TransformPhaseCtx,
  AssessPhaseCtx,
  CraftPhaseCtx,
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
    coverArtist: {
      run: jest.fn().mockResolvedValue({
        state: "completed",
        output: {
          coverUrl: "https://example.com/cover.png",
          thumbMediaId: "thumb-123",
          cropMultiList: [],
        },
      }),
    } as unknown as CommonDeps["coverArtist"],
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
  AssessPhaseCtx &
  CraftPhaseCtx;

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    missionId: "mission-s5-test",
    userId: "user-s5",
    t0: Date.now(),
    input: {
      contentId: "content-5",
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
      title: "S5 title",
      body: '<p>Body with <img src="https://img.example.com/img1.jpg" /></p>',
      digest: null,
      coverImageUrl: "https://example.com/user-cover.jpg",
    },
    stewardInputs: {
      remainingCreditsUsd: 6,
      estimatedCostUsd: 0.04,
      sessionExpiresAt: {},
      inProgressMissionCount: 0,
      keyCooldownCount1h: 0,
    },
    platformVersions: {
      wechat: {
        platform: "wechat",
        title: "Wechat cover title",
        digest: "d1",
        body: "<p>b1</p>",
        lengthMetrics: { titleChars: 18, digestChars: 2, bodyChars: 9 },
      },
    } as TransformPhaseCtx["platformVersions"],
    leaderAssess: {
      phase: "assess-transform",
      perPlatform: [
        { platform: "wechat", verdict: "approve", reason: "OK", score: 90 },
      ],
    } as AssessPhaseCtx["leaderAssess"],
    ...overrides,
  } as Ctx;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runCoverCraftStage (s5)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("happy path", () => {
    it("should call coverArtist.run for each accepted platform", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runCoverCraftStage(ctx, deps);

      expect(deps.coverArtist.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            platform: "wechat",
            contentId: "content-5",
          }),
        }),
      );
    });

    it("should write covers to ctx", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runCoverCraftStage(ctx, deps);

      expect(ctx.covers).toBeDefined();
      expect(ctx.covers!["wechat"]).toBeDefined();
      expect(ctx.covers!["wechat"].coverUrl).toBe(
        "https://example.com/cover.png",
      );
    });

    it("should pass userProvidedCoverUrl from contentRaw", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runCoverCraftStage(ctx, deps);

      expect(deps.coverArtist.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            userProvidedCoverUrl: "https://example.com/user-cover.jpg",
          }),
        }),
      );
    });

    it("should extract first img from body as bodyFirstImgUrl", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runCoverCraftStage(ctx, deps);

      expect(deps.coverArtist.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            bodyFirstImgUrl: "https://img.example.com/img1.jpg",
          }),
        }),
      );
    });

    it("should set imageGenerationAllowed=true when budgetProfile=rich", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        input: {
          contentId: "c5",
          platforms: ["wechat"],
          connectionIds: { wechat: "conn-w" },
          depth: "standard",
          budgetProfile: "rich",
          language: "zh-CN",
        },
      });

      await runCoverCraftStage(ctx, deps);

      expect(deps.coverArtist.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ imageGenerationAllowed: true }),
        }),
      );
    });

    it("should emit writing and success narrative tags", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runCoverCraftStage(ctx, deps);

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
      expect(tags).toContain("writing");
      expect(tags).toContain("success");
    });
  });

  describe("missing platformVersions", () => {
    it("should throw when platformVersions is undefined", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({ platformVersions: undefined });

      await expect(runCoverCraftStage(ctx, deps)).rejects.toThrow(
        "[s5] missing platformVersions",
      );
    });
  });

  describe("rejected platform skipped", () => {
    it("should skip platforms that leader rejected", async () => {
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
        leaderAssess: {
          phase: "assess-transform",
          perPlatform: [
            { platform: "wechat", verdict: "approve", reason: "OK", score: 80 },
            {
              platform: "xiaohongshu",
              verdict: "reject",
              reason: "Bad",
              score: 20,
            },
          ],
        } as AssessPhaseCtx["leaderAssess"],
        input: {
          contentId: "c5",
          platforms: ["wechat", "xiaohongshu"],
          connectionIds: { wechat: "c-w", xiaohongshu: "c-x" },
          depth: "standard",
          budgetProfile: "standard",
          language: "zh-CN",
        },
      });

      await runCoverCraftStage(ctx, deps);

      // Only wechat should be processed
      expect(deps.coverArtist.run).toHaveBeenCalledTimes(1);
      expect(deps.coverArtist.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ platform: "wechat" }),
        }),
      );
    });

    // 2026-05-19: 行为变更 — Leader 全 reject 时不再 silently return（之前会让
    //   covers 为空 → 下游 s8 撞 missing covers throw）。fallback 处理所有
    //   platformVersions 让 mission 跑到底。
    it("should fallback to all platforms when leaderAssess全 rejects", async () => {
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
        } as TransformPhaseCtx["platformVersions"],
        leaderAssess: {
          phase: "assess-transform",
          perPlatform: [
            {
              platform: "wechat",
              verdict: "reject",
              reason: "Too bad",
              score: 10,
            },
          ],
        } as AssessPhaseCtx["leaderAssess"],
      });

      await runCoverCraftStage(ctx, deps);

      // 全 reject fallback → 应该仍然处理 wechat
      expect(deps.coverArtist.run).toHaveBeenCalledTimes(1);
      expect(deps.coverArtist.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ platform: "wechat" }),
        }),
      );
    });
  });

  describe("cover craft failure", () => {
    it("should call markStageDegraded when coverArtist fails", async () => {
      const deps = makeDeps({
        coverArtist: {
          run: jest.fn().mockResolvedValue({ state: "failed", output: null }),
        } as unknown as CommonDeps["coverArtist"],
      });
      const ctx = makeCtx();

      await runCoverCraftStage(ctx, deps);

      expect(deps.markStageDegraded).toHaveBeenCalledWith(
        "mission-s5-test",
        "user-s5",
        "s5-cover-craft",
        expect.stringContaining("封面生成失败"),
      );
    });

    it("should set empty covers when all fail", async () => {
      const deps = makeDeps({
        coverArtist: {
          run: jest.fn().mockResolvedValue({ state: "failed", output: null }),
        } as unknown as CommonDeps["coverArtist"],
      });
      const ctx = makeCtx();

      await runCoverCraftStage(ctx, deps);

      expect(ctx.covers).toBeDefined();
      expect(Object.keys(ctx.covers)).toHaveLength(0);
    });
  });

  describe("no leaderAssess — process all platforms", () => {
    it("should process all platformVersions when leaderAssess is undefined", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        leaderAssess: undefined,
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
        input: {
          contentId: "c5",
          platforms: ["wechat", "xiaohongshu"],
          connectionIds: { wechat: "c-w", xiaohongshu: "c-x" },
          depth: "standard",
          budgetProfile: "standard",
          language: "zh-CN",
        },
      });

      await runCoverCraftStage(ctx, deps);

      expect(deps.coverArtist.run).toHaveBeenCalledTimes(2);
    });
  });
});
