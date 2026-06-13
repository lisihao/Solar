/**
 * Unit tests for S3 — Content Transform Stage
 */

// Mock ConcurrencyLimiter so tests run serially without real concurrency control
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

import { runContentTransformStage } from "../s3-content-transform.stage";
import type {
  MissionInvariants,
  PlanPhaseCtx,
  TransformPhaseCtx,
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
    contentTransformer: {
      run: jest.fn().mockResolvedValue({
        state: "completed",
        output: {
          platform: "wechat",
          title: "Transformed title",
          digest: "Transformed digest",
          body: "<p>Transformed body</p>",
          lengthMetrics: { titleChars: 17, digestChars: 18, bodyChars: 22 },
        },
      }),
    } as unknown as CommonDeps["contentTransformer"],
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

type Ctx = MissionInvariants & PlanPhaseCtx & TransformPhaseCtx;

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    missionId: "mission-s3-test",
    userId: "user-s3",
    t0: Date.now(),
    input: {
      contentId: "content-3",
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
      title: "Raw title",
      body: "<p>Raw body content</p>",
      digest: "Raw digest",
      coverImageUrl: "https://example.com/cover.jpg",
    },
    stewardInputs: {
      remainingCreditsUsd: 8,
      estimatedCostUsd: 0.03,
      sessionExpiresAt: {},
      inProgressMissionCount: 0,
      keyCooldownCount1h: 0,
    },
    probeResults: {
      results: [
        {
          platform: "wechat",
          probeResult: "ok",
          requiredFields: ["title", "digest"],
          schemaVersion: "v1",
        },
      ],
    } as MissionInvariants["contentRaw"] extends never
      ? never
      : PlanPhaseCtx["probeResults"],
    ...overrides,
  } as Ctx;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runContentTransformStage (s3)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("happy path — single platform", () => {
    it("should call contentTransformer.run for each platform", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runContentTransformStage(ctx, deps);

      expect(deps.contentTransformer.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            platform: "wechat",
            rawContent: ctx.contentRaw,
            qualityBar: "standard",
          }),
        }),
      );
    });

    it("should write platformVersions to ctx", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runContentTransformStage(ctx, deps);

      expect(ctx.platformVersions).toBeDefined();
      expect(ctx.platformVersions!["wechat"]).toBeDefined();
      expect(ctx.platformVersions!["wechat"].title).toBe("Transformed title");
    });

    it("should emit thinking and success narrative tags", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runContentTransformStage(ctx, deps);

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
      expect(tags).toContain("thinking");
      expect(tags).toContain("success");
    });
  });

  describe("multi-platform parallel", () => {
    it("should call contentTransformer.run for each platform", async () => {
      const deps = makeDeps({
        contentTransformer: {
          run: jest
            .fn()
            .mockResolvedValueOnce({
              state: "completed",
              output: {
                platform: "wechat",
                title: "Wechat title",
                digest: "d1",
                body: "<p>b1</p>",
                lengthMetrics: { titleChars: 11, digestChars: 2, bodyChars: 9 },
              },
            })
            .mockResolvedValueOnce({
              state: "completed",
              output: {
                platform: "xiaohongshu",
                title: "XHS title",
                digest: "d2",
                body: "<p>b2</p>",
                lengthMetrics: { titleChars: 9, digestChars: 2, bodyChars: 9 },
              },
            }),
        } as unknown as CommonDeps["contentTransformer"],
      });
      const ctx = makeCtx({
        input: {
          contentId: "c3",
          platforms: ["wechat", "xiaohongshu"],
          connectionIds: { wechat: "c-w", xiaohongshu: "c-x" },
          depth: "standard",
          budgetProfile: "standard",
          language: "zh-CN",
        },
        probeResults: {
          results: [
            {
              platform: "wechat",
              probeResult: "ok",
              requiredFields: ["title"],
              schemaVersion: "v1",
            },
            {
              platform: "xiaohongshu",
              probeResult: "ok",
              requiredFields: ["title"],
              schemaVersion: "v1",
            },
          ],
        },
      });

      await runContentTransformStage(ctx, deps);

      expect(deps.contentTransformer.run).toHaveBeenCalledTimes(2);
      expect(ctx.platformVersions!["wechat"]).toBeDefined();
      expect(ctx.platformVersions!["xiaohongshu"]).toBeDefined();
    });
  });

  describe("missing probeResults", () => {
    it("should throw when ctx.probeResults is undefined", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({ probeResults: undefined });

      await expect(runContentTransformStage(ctx, deps)).rejects.toThrow(
        "[s3] missing probeResults for mission mission-s3-test",
      );
    });
  });

  describe("all platforms fail", () => {
    // 2026-05-19: 行为变更 — 全失败时不再 throw，改为 fallback 用 contentRaw
    //   合成最小 platformVersion，让下游 stage 能继续跑（s8 publish-execute
    //   已支持 fast-path 从 contentRaw 直发）。
    it("should fallback to contentRaw when all platforms fail transform (not throw)", async () => {
      const deps = makeDeps({
        contentTransformer: {
          run: jest.fn().mockResolvedValue({ state: "failed", output: null }),
        } as unknown as CommonDeps["contentTransformer"],
      });
      const ctx = makeCtx();

      await expect(
        runContentTransformStage(ctx, deps),
      ).resolves.toBeUndefined();
      // ctx.platformVersions 应该被 contentRaw fallback 填充
      expect(ctx.platformVersions).toBeDefined();
      expect(Object.keys(ctx.platformVersions).length).toBeGreaterThan(0);
      // markStageDegraded 应被调用宣告 fallback
      expect(deps.markStageDegraded).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        "s3-content-transform",
        expect.stringContaining("回退到 contentRaw"),
      );
    });
  });

  describe("partial platform success", () => {
    it("should succeed if at least one platform transforms successfully", async () => {
      const deps = makeDeps({
        contentTransformer: {
          run: jest
            .fn()
            .mockResolvedValueOnce({ state: "failed", output: null }) // wechat fails
            .mockResolvedValueOnce({
              state: "completed",
              output: {
                platform: "xiaohongshu",
                title: "XHS title only",
                digest: "d",
                body: "<p>b</p>",
                lengthMetrics: { titleChars: 13, digestChars: 1, bodyChars: 6 },
              },
            }),
        } as unknown as CommonDeps["contentTransformer"],
      });
      const ctx = makeCtx({
        input: {
          contentId: "c3",
          platforms: ["wechat", "xiaohongshu"],
          connectionIds: { wechat: "c-w", xiaohongshu: "c-x" },
          depth: "standard",
          budgetProfile: "standard",
          language: "zh-CN",
        },
        probeResults: {
          results: [
            {
              platform: "wechat",
              probeResult: "ok",
              requiredFields: ["title"],
              schemaVersion: "v1",
            },
            {
              platform: "xiaohongshu",
              probeResult: "ok",
              requiredFields: ["title"],
              schemaVersion: "v1",
            },
          ],
        },
      });

      await runContentTransformStage(ctx, deps);

      expect(ctx.platformVersions!["xiaohongshu"]).toBeDefined();
      expect(ctx.platformVersions!["wechat"]).toBeUndefined();
    });
  });

  describe("probe missing for platform", () => {
    it("should fallback to contentRaw when input platform has no matching probe", async () => {
      const deps = makeDeps();
      // input has only wechat, but probeResults has only xiaohongshu → wechat
      // skipped → empty versions → fallback to contentRaw（不再 throw）
      const ctx = makeCtx({
        probeResults: {
          results: [
            {
              platform: "xiaohongshu",
              probeResult: "ok",
              requiredFields: ["title"],
              schemaVersion: "v1",
            },
          ],
        },
      });

      await expect(
        runContentTransformStage(ctx, deps),
      ).resolves.toBeUndefined();
      expect(ctx.platformVersions).toBeDefined();
    });

    it("should only transform platforms that have probe results", async () => {
      const deps = makeDeps({
        contentTransformer: {
          run: jest.fn().mockResolvedValue({
            state: "completed",
            output: {
              platform: "xiaohongshu",
              title: "XHS only title",
              digest: "d",
              body: "<p>b</p>",
              lengthMetrics: { titleChars: 14, digestChars: 1, bodyChars: 6 },
            },
          }),
        } as unknown as CommonDeps["contentTransformer"],
      });
      const ctx = makeCtx({
        input: {
          contentId: "c3",
          platforms: ["wechat", "xiaohongshu"],
          connectionIds: { wechat: "c-w", xiaohongshu: "c-x" },
          depth: "standard",
          budgetProfile: "standard",
          language: "zh-CN",
        },
        probeResults: {
          results: [
            // only xiaohongshu has probe
            {
              platform: "xiaohongshu",
              probeResult: "ok",
              requiredFields: ["title"],
              schemaVersion: "v1",
            },
          ],
        },
      });

      await runContentTransformStage(ctx, deps);

      // wechat should be skipped (no probe), xiaohongshu should succeed
      expect(deps.contentTransformer.run).toHaveBeenCalledTimes(1);
      expect(deps.contentTransformer.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ platform: "xiaohongshu" }),
        }),
      );
    });
  });
});
