/**
 * Unit tests for S6 — Body Compose Stage
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

import { runBodyComposeStage } from "../s6-body-compose.stage";
import type {
  MissionInvariants,
  TransformPhaseCtx,
  AssessPhaseCtx,
  ComposePhaseCtx,
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
    composer: {
      run: jest.fn().mockResolvedValue({
        state: "completed",
        output: {
          platform: "wechat",
          bodyHtml: "<section><p>Composed body HTML</p></section>",
        },
      }),
    } as unknown as CommonDeps["composer"],
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
  ComposePhaseCtx;

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    missionId: "mission-s6-test",
    userId: "user-s6",
    t0: Date.now(),
    input: {
      contentId: "content-6",
      platforms: ["wechat"],
      connectionIds: { wechat: "conn-w" },
      depth: "standard",
      budgetProfile: "standard",
      language: "zh-CN",
    },
    billing: {} as MissionInvariants["billing"],
    pool: {} as MissionInvariants["pool"],
    budgetMultiplier: 1,
    contextIds: { wechat: "ctx-s6-w" },
    contentRaw: {
      title: "S6 title",
      body: "<p>S6 body</p>",
      digest: null,
      coverImageUrl: null,
    },
    stewardInputs: {
      remainingCreditsUsd: 5,
      estimatedCostUsd: 0.02,
      sessionExpiresAt: {},
      inProgressMissionCount: 0,
      keyCooldownCount1h: 0,
    },
    platformVersions: {
      wechat: {
        platform: "wechat",
        title: "Wechat body title",
        digest: "d1",
        body: "<p>b1</p>",
        lengthMetrics: { titleChars: 16, digestChars: 2, bodyChars: 9 },
      },
    } as TransformPhaseCtx["platformVersions"],
    leaderAssess: {
      phase: "assess-transform",
      perPlatform: [
        { platform: "wechat", verdict: "approve", reason: "OK", score: 88 },
      ],
    } as AssessPhaseCtx["leaderAssess"],
    ...overrides,
  } as Ctx;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runBodyComposeStage (s6)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("happy path", () => {
    it("should call composer.run for each accepted platform", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runBodyComposeStage(ctx, deps);

      expect(deps.composer.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            platform: "wechat",
            body: "<p>b1</p>",
          }),
        }),
      );
    });

    it("should write composed to ctx", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runBodyComposeStage(ctx, deps);

      expect(ctx.composed).toBeDefined();
      expect(ctx.composed!["wechat"]).toBeDefined();
      expect(ctx.composed!["wechat"].bodyHtml).toBe(
        "<section><p>Composed body HTML</p></section>",
      );
    });

    it("should use contextIds[platform] when available", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runBodyComposeStage(ctx, deps);

      expect(deps.composer.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ contextId: "ctx-s6-w" }),
        }),
      );
    });

    it("should fallback contextId to social-{platform}-{missionId} when missing", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({ contextIds: {} });

      await runBodyComposeStage(ctx, deps);

      expect(deps.composer.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            contextId: "social-wechat-mission-s6-test",
          }),
        }),
      );
    });

    it("should emit writing and success narrative tags", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runBodyComposeStage(ctx, deps);

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

      await expect(runBodyComposeStage(ctx, deps)).rejects.toThrow(
        "[s6] missing platformVersions",
      );
    });
  });

  describe("composer failure", () => {
    it("should call markStageDegraded when composer fails", async () => {
      const deps = makeDeps({
        composer: {
          run: jest.fn().mockResolvedValue({ state: "failed", output: null }),
        } as unknown as CommonDeps["composer"],
      });
      const ctx = makeCtx();

      await runBodyComposeStage(ctx, deps);

      expect(deps.markStageDegraded).toHaveBeenCalledWith(
        "mission-s6-test",
        "user-s6",
        "s6-body-compose",
        expect.stringContaining("正文 schema 注入失败"),
      );
    });

    it("should result in empty composed when all platforms fail", async () => {
      const deps = makeDeps({
        composer: {
          run: jest.fn().mockResolvedValue({ state: "failed", output: null }),
        } as unknown as CommonDeps["composer"],
      });
      const ctx = makeCtx();

      await runBodyComposeStage(ctx, deps);

      expect(ctx.composed).toBeDefined();
      expect(Object.keys(ctx.composed)).toHaveLength(0);
    });
  });

  describe("rejected platform filtering", () => {
    it("should skip rejected platforms", async () => {
      const deps = makeDeps({
        composer: {
          run: jest.fn().mockResolvedValue({
            state: "completed",
            output: { platform: "wechat", bodyHtml: "<section>W</section>" },
          }),
        } as unknown as CommonDeps["composer"],
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
        leaderAssess: {
          phase: "assess-transform",
          perPlatform: [
            { platform: "wechat", verdict: "approve", reason: "OK", score: 80 },
            {
              platform: "xiaohongshu",
              verdict: "reject",
              reason: "Low",
              score: 20,
            },
          ],
        } as AssessPhaseCtx["leaderAssess"],
        input: {
          contentId: "c6",
          platforms: ["wechat", "xiaohongshu"],
          connectionIds: { wechat: "c-w", xiaohongshu: "c-x" },
          depth: "standard",
          budgetProfile: "standard",
          language: "zh-CN",
        },
      });

      await runBodyComposeStage(ctx, deps);

      expect(deps.composer.run).toHaveBeenCalledTimes(1);
      expect(deps.composer.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ platform: "wechat" }),
        }),
      );
    });

    it("should process all platforms when leaderAssess is null/undefined", async () => {
      const deps = makeDeps({
        composer: {
          run: jest
            .fn()
            .mockResolvedValueOnce({
              state: "completed",
              output: { platform: "wechat", bodyHtml: "<section>W</section>" },
            })
            .mockResolvedValueOnce({
              state: "completed",
              output: {
                platform: "xiaohongshu",
                bodyHtml: "<section>X</section>",
              },
            }),
        } as unknown as CommonDeps["composer"],
      });
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
          contentId: "c6",
          platforms: ["wechat", "xiaohongshu"],
          connectionIds: { wechat: "c-w", xiaohongshu: "c-x" },
          depth: "standard",
          budgetProfile: "standard",
          language: "zh-CN",
        },
      });

      await runBodyComposeStage(ctx, deps);

      expect(deps.composer.run).toHaveBeenCalledTimes(2);
    });
  });
});
