/**
 * Unit tests for S8 — Publish Execute Stage
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

import { runPublishExecuteStage } from "../s8-publish-execute.stage";
import type {
  MissionInvariants,
  TransformPhaseCtx,
  ComposePhaseCtx,
  CraftPhaseCtx,
  PolishPhaseCtx,
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
          draftUrl: "https://mp.weixin.qq.com/draft/1",
          platformResponse: { ret: 0 },
        },
      }),
    } as unknown as CommonDeps["publishExecutor"],
    publishVerifier: {} as CommonDeps["publishVerifier"],
    failureLearner: {} as CommonDeps["failureLearner"],
    postmortemClassifier: {} as CommonDeps["postmortemClassifier"],
    store: {
      recordPublishLog: jest.fn().mockResolvedValue(undefined),
    } as unknown as CommonDeps["store"],
    ...overrides,
  };
}

type Ctx = MissionInvariants &
  TransformPhaseCtx &
  ComposePhaseCtx &
  CraftPhaseCtx &
  PolishPhaseCtx &
  PublishPhaseCtx;

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    missionId: "mission-s8-test",
    userId: "user-s8",
    t0: Date.now(),
    input: {
      contentId: "content-8",
      platforms: ["wechat"],
      connectionIds: { wechat: "conn-wechat-8" },
      depth: "standard",
      budgetProfile: "standard",
      language: "zh-CN",
    },
    billing: {} as MissionInvariants["billing"],
    pool: {} as MissionInvariants["pool"],
    budgetMultiplier: 1,
    contextIds: { wechat: "ctx-s8-w" },
    contentRaw: {
      title: "S8 title",
      body: "<p>S8 body</p>",
      digest: null,
      coverImageUrl: null,
    },
    stewardInputs: {
      remainingCreditsUsd: 3,
      estimatedCostUsd: 0.08,
      sessionExpiresAt: {},
      inProgressMissionCount: 0,
      keyCooldownCount1h: 0,
    },
    platformVersions: {
      wechat: {
        platform: "wechat",
        title: "Publish title",
        digest: "Publish digest",
        body: "<p>Publish body</p>",
        lengthMetrics: { titleChars: 13, digestChars: 14, bodyChars: 16 },
      },
    } as TransformPhaseCtx["platformVersions"],
    composed: {
      wechat: {
        platform: "wechat",
        bodyHtml: "<section><p>Final HTML</p></section>",
      },
    } as ComposePhaseCtx["composed"],
    covers: {
      wechat: {
        coverUrl: "https://cdn.example.com/thumb.jpg",
        thumbMediaId: "thumb-abc",
        cropMultiList: [],
      },
    } as CraftPhaseCtx["covers"],
    ...overrides,
  } as Ctx;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runPublishExecuteStage (s8)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("happy path — published", () => {
    it("should call publishExecutor.run for each composed platform", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runPublishExecuteStage(ctx, deps);

      expect(deps.publishExecutor.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            platform: "wechat",
            connectionId: "conn-wechat-8",
          }),
        }),
      );
    });

    it("should write published to ctx", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runPublishExecuteStage(ctx, deps);

      expect(ctx.published).toBeDefined();
      expect(ctx.published!["wechat"]).toBeDefined();
      expect(ctx.published!["wechat"].status).toBe("PUBLISHED");
    });

    it("should emit publishing and success narrative tags", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runPublishExecuteStage(ctx, deps);

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
      expect(tags).toContain("publishing");
      expect(tags).toContain("success");
    });

    it("should pass platformVersion with title, digest, bodyHtml, coverUrl to publishExecutor", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runPublishExecuteStage(ctx, deps);

      expect(deps.publishExecutor.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            platformVersion: expect.objectContaining({
              title: "Publish title",
              digest: "Publish digest",
              bodyHtml: "<section><p>Final HTML</p></section>",
              coverUrl: "https://cdn.example.com/thumb.jpg",
            }),
          }),
        }),
      );
    });

    it("should use contextIds[platform] for contextId", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runPublishExecuteStage(ctx, deps);

      expect(deps.publishExecutor.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ contextId: "ctx-s8-w" }),
        }),
      );
    });

    it("should fallback contextId to social-{platform}-{missionId} when missing", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({ contextIds: {} });

      await runPublishExecuteStage(ctx, deps);

      expect(deps.publishExecutor.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            contextId: "social-wechat-mission-s8-test",
          }),
        }),
      );
    });
  });

  describe("missing prior phase outputs (partial)", () => {
    it("should throw when only platformVersions is missing", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({ platformVersions: undefined });

      await expect(runPublishExecuteStage(ctx, deps)).rejects.toThrow(
        "[s8] missing prior phase outputs",
      );
    });

    it("should throw when only composed is missing", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({ composed: undefined });

      await expect(runPublishExecuteStage(ctx, deps)).rejects.toThrow(
        "[s8] missing prior phase outputs",
      );
    });

    it("should throw when only covers is missing", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({ covers: undefined });

      await expect(runPublishExecuteStage(ctx, deps)).rejects.toThrow(
        "[s8] missing prior phase outputs",
      );
    });
  });

  // PR-7 R1 P0: fast-pipeline (depth=quick) all-undefined → 用 contentRaw 兜底
  describe("fast-pipeline path (depth=quick all-undefined)", () => {
    it("should not throw when all three are undefined (fast-path)", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        platformVersions: undefined,
        composed: undefined,
        covers: undefined,
      });

      await expect(runPublishExecuteStage(ctx, deps)).resolves.not.toThrow();
    });

    it("should publish using contentRaw fields when in fast-path", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        platformVersions: undefined,
        composed: undefined,
        covers: undefined,
        contentRaw: {
          title: "Raw Title",
          body: "<p>Raw body HTML</p>",
          digest: "Raw digest",
          coverImageUrl: "https://raw-cover.jpg",
        },
      });

      await runPublishExecuteStage(ctx, deps);

      expect(deps.publishExecutor.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            platformVersion: expect.objectContaining({
              title: "Raw Title",
              bodyHtml: "<p>Raw body HTML</p>",
              digest: "Raw digest",
              coverUrl: "https://raw-cover.jpg",
            }),
          }),
        }),
      );
    });

    it("should use input.platforms (not composed keys) as iteration set in fast-path", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        platformVersions: undefined,
        composed: undefined,
        covers: undefined,
        input: {
          contentId: "fast-c",
          platforms: ["wechat", "xiaohongshu"],
          connectionIds: { wechat: "fw", xiaohongshu: "fx" },
          depth: "quick",
          budgetProfile: "lean",
          language: "zh-CN",
        },
      });

      await runPublishExecuteStage(ctx, deps);

      expect(deps.publishExecutor.run).toHaveBeenCalledTimes(2);
    });

    it("should emit fast-tagged narrative in fast-path", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        platformVersions: undefined,
        composed: undefined,
        covers: undefined,
      });

      await runPublishExecuteStage(ctx, deps);

      const emitCalls = (deps.emit as jest.Mock).mock.calls;
      const publishingText = emitCalls
        .map((args: unknown[]) => args[0] as { payload?: { text?: string } })
        .find((evt) => evt.payload?.text?.includes("开始真发"));
      expect(publishingText?.payload?.text).toContain("fast");
    });
  });

  describe("platform skipped when sub-phase data missing", () => {
    it("should skip platform when version is missing from platformVersions", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        // wechat is in composed and covers but NOT in platformVersions
        platformVersions: {} as TransformPhaseCtx["platformVersions"],
      });

      await runPublishExecuteStage(ctx, deps);

      // wechat should be skipped since version is missing
      expect(deps.publishExecutor.run).not.toHaveBeenCalled();
      expect(ctx.published!["wechat"]).toBeUndefined();
    });

    it("should skip platform when cover is missing", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        covers: {} as CraftPhaseCtx["covers"],
      });

      await runPublishExecuteStage(ctx, deps);

      expect(deps.publishExecutor.run).not.toHaveBeenCalled();
    });
  });

  describe("publish failure handling", () => {
    it("should not write to published when publishExecutor state is failed", async () => {
      const deps = makeDeps({
        publishExecutor: {
          run: jest.fn().mockResolvedValue({ state: "failed", output: null }),
        } as unknown as CommonDeps["publishExecutor"],
      });
      const ctx = makeCtx();

      await runPublishExecuteStage(ctx, deps);

      expect(ctx.published!["wechat"]).toBeUndefined();
    });
  });

  // PR-6 admin 历史日志兼容回归（W4 接管后，s8 必须补写 SocialPublishLog）
  describe("PR-6 SocialPublishLog write", () => {
    it("should record SUCCESS log when platform PUBLISHED", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runPublishExecuteStage(ctx, deps);

      expect(deps.store.recordPublishLog).toHaveBeenCalledWith(
        expect.objectContaining({
          contentId: "content-8",
          action: "PUBLISH",
          status: "SUCCESS",
          details: expect.objectContaining({
            missionId: "mission-s8-test",
            platform: "wechat",
            runnerState: "completed",
            platformStatus: "PUBLISHED",
            draftUrl: "https://mp.weixin.qq.com/draft/1",
          }),
        }),
      );
    });

    it("should record FAILED log when publishExecutor state is failed", async () => {
      const deps = makeDeps({
        publishExecutor: {
          run: jest.fn().mockResolvedValue({ state: "failed", output: null }),
        } as unknown as CommonDeps["publishExecutor"],
      });
      const ctx = makeCtx();

      await runPublishExecuteStage(ctx, deps);

      expect(deps.store.recordPublishLog).toHaveBeenCalledWith(
        expect.objectContaining({
          contentId: "content-8",
          action: "PUBLISH",
          status: "FAILED",
          errorMessage: expect.stringContaining("runner=failed"),
        }),
      );
    });

    it("should record FAILED log when platform status is DRAFT (not PUBLISHED)", async () => {
      const deps = makeDeps({
        publishExecutor: {
          run: jest.fn().mockResolvedValue({
            state: "completed",
            output: {
              platform: "wechat",
              status: "DRAFT",
              draftUrl: "https://mp.weixin/draft",
              platformResponse: {},
              retriedTimes: 0,
            },
          }),
        } as unknown as CommonDeps["publishExecutor"],
      });
      const ctx = makeCtx();

      await runPublishExecuteStage(ctx, deps);

      expect(deps.store.recordPublishLog).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "FAILED",
          errorMessage: expect.stringContaining("platform=DRAFT"),
        }),
      );
    });

    it("should record one log per platform on multi-platform mission", async () => {
      const deps = makeDeps({
        publishExecutor: {
          run: jest
            .fn()
            .mockResolvedValueOnce({
              state: "completed",
              output: {
                platform: "wechat",
                status: "PUBLISHED",
                draftUrl: "https://w/1",
                platformResponse: {},
                retriedTimes: 0,
              },
            })
            .mockResolvedValueOnce({
              state: "failed",
              output: null,
            }),
        } as unknown as CommonDeps["publishExecutor"],
      });
      const ctx = makeCtx({
        input: {
          contentId: "c8m",
          platforms: ["wechat", "xiaohongshu"],
          connectionIds: { wechat: "cw", xiaohongshu: "cx" },
          depth: "standard",
          budgetProfile: "standard",
          language: "zh-CN",
        },
        platformVersions: {
          wechat: {
            platform: "wechat",
            title: "wt",
            digest: null,
            body: "<p>b</p>",
            lengthMetrics: { titleChars: 2, digestChars: 0, bodyChars: 6 },
          },
          xiaohongshu: {
            platform: "xiaohongshu",
            title: "xt",
            digest: null,
            body: "<p>b</p>",
            lengthMetrics: { titleChars: 2, digestChars: 0, bodyChars: 6 },
          },
        } as TransformPhaseCtx["platformVersions"],
        composed: {
          wechat: { platform: "wechat", bodyHtml: "<p>w</p>" },
          xiaohongshu: { platform: "xiaohongshu", bodyHtml: "<p>x</p>" },
        } as ComposePhaseCtx["composed"],
        covers: {
          wechat: {
            coverUrl: "https://w.jpg",
            thumbMediaId: null,
            cropMultiList: [],
          },
          xiaohongshu: {
            coverUrl: "https://x.jpg",
            thumbMediaId: null,
            cropMultiList: [],
          },
        } as CraftPhaseCtx["covers"],
      });

      await runPublishExecuteStage(ctx, deps);

      expect(deps.store.recordPublishLog).toHaveBeenCalledTimes(2);
      const statuses = (deps.store.recordPublishLog as jest.Mock).mock.calls
        .map((c: unknown[]) => (c[0] as { status: string }).status)
        .sort();
      expect(statuses).toEqual(["FAILED", "SUCCESS"]);
    });
  });

  describe("multiple platforms", () => {
    it("should publish each platform independently", async () => {
      const deps = makeDeps({
        publishExecutor: {
          run: jest
            .fn()
            .mockResolvedValueOnce({
              state: "completed",
              output: {
                platform: "wechat",
                status: "PUBLISHED",
                draftUrl: "https://mp.weixin/1",
                platformResponse: { ret: 0 },
              },
            })
            .mockResolvedValueOnce({
              state: "completed",
              output: {
                platform: "xiaohongshu",
                status: "PUBLISHED",
                draftUrl: "https://xhs/1",
                platformResponse: { ret: 0 },
              },
            }),
        } as unknown as CommonDeps["publishExecutor"],
      });
      const ctx = makeCtx({
        input: {
          contentId: "c8",
          platforms: ["wechat", "xiaohongshu"],
          connectionIds: { wechat: "conn-w", xiaohongshu: "conn-x" },
          depth: "standard",
          budgetProfile: "standard",
          language: "zh-CN",
        },
        platformVersions: {
          wechat: {
            platform: "wechat",
            title: "W t",
            digest: "d",
            body: "<p>b</p>",
            lengthMetrics: { titleChars: 3, digestChars: 1, bodyChars: 6 },
          },
          xiaohongshu: {
            platform: "xiaohongshu",
            title: "X t",
            digest: null,
            body: "<p>b</p>",
            lengthMetrics: { titleChars: 3, digestChars: 0, bodyChars: 6 },
          },
        } as TransformPhaseCtx["platformVersions"],
        composed: {
          wechat: { platform: "wechat", bodyHtml: "<section>W</section>" },
          xiaohongshu: {
            platform: "xiaohongshu",
            bodyHtml: "<section>X</section>",
          },
        } as ComposePhaseCtx["composed"],
        covers: {
          wechat: {
            coverUrl: "https://w.jpg",
            thumbMediaId: "t1",
            cropMultiList: [],
          },
          xiaohongshu: {
            coverUrl: "https://x.jpg",
            thumbMediaId: null,
            cropMultiList: [],
          },
        } as CraftPhaseCtx["covers"],
      });

      await runPublishExecuteStage(ctx, deps);

      expect(deps.publishExecutor.run).toHaveBeenCalledTimes(2);
      expect(ctx.published!["wechat"]).toBeDefined();
      expect(ctx.published!["xiaohongshu"]).toBeDefined();
    });
  });
});
