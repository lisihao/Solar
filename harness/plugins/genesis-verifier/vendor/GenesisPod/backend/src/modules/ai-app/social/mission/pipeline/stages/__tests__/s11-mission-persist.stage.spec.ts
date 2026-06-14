/**
 * Unit tests for S11 — Mission Persist Stage
 */

import { runMissionPersistStage } from "../s11-mission-persist.stage";
import type {
  MissionInvariants,
  PlanPhaseCtx,
  TransformPhaseCtx,
  AssessPhaseCtx,
  CraftPhaseCtx,
  ComposePhaseCtx,
  PolishPhaseCtx,
  PublishPhaseCtx,
  VerifyPhaseCtx,
  SignoffPhaseCtx,
  PersistPhaseCtx,
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
    failureLearner: {} as CommonDeps["failureLearner"],
    postmortemClassifier: {} as CommonDeps["postmortemClassifier"],
    store: {
      saveTrajectory: jest.fn().mockResolvedValue(undefined),
    } as unknown as CommonDeps["store"],
    ...overrides,
  };
}

type Ctx = MissionInvariants &
  PlanPhaseCtx &
  TransformPhaseCtx &
  AssessPhaseCtx &
  CraftPhaseCtx &
  ComposePhaseCtx &
  PolishPhaseCtx &
  PublishPhaseCtx &
  VerifyPhaseCtx &
  SignoffPhaseCtx &
  PersistPhaseCtx;

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    missionId: "mission-s11-test",
    userId: "user-s11",
    t0: Date.now() - 5000, // 5 seconds ago
    input: {
      contentId: "content-11",
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
      title: "S11 title",
      body: "<p>S11 body</p>",
      digest: null,
      coverImageUrl: null,
    },
    stewardInputs: {
      remainingCreditsUsd: 0.5,
      estimatedCostUsd: 0.1,
      sessionExpiresAt: {},
      inProgressMissionCount: 0,
      keyCooldownCount1h: 0,
    },
    platformVersions: {
      wechat: {
        platform: "wechat",
        title: "Persist title",
        digest: null,
        body: "<p>b</p>",
        lengthMetrics: { titleChars: 13, digestChars: 0, bodyChars: 6 },
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
        diffPercent: 2,
        issues: [],
      },
    } as VerifyPhaseCtx["verified"],
    leaderSignOff: {
      phase: "signoff",
      signoff: "signed",
      overallScore: 90,
      rationale: "All good",
    } as SignoffPhaseCtx["leaderSignOff"],
    ...overrides,
  } as Ctx;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runMissionPersistStage (s11)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("happy path — signed and saved", () => {
    it("should call store.saveTrajectory with missionId", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runMissionPersistStage(ctx, deps);

      expect(deps.store.saveTrajectory).toHaveBeenCalledWith(
        "mission-s11-test",
        expect.anything(),
      );
    });

    it("should set trajectoryStored=1 on success", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runMissionPersistStage(ctx, deps);

      expect(ctx.trajectoryStored).toBe(1);
    });

    it("should pass trajectory with schemaVersion=1", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runMissionPersistStage(ctx, deps);

      const savedTrajectory = (deps.store.saveTrajectory as jest.Mock).mock
        .calls[0][1];
      expect(savedTrajectory.schemaVersion).toBe(1);
    });

    it("should set finalState=signed when leaderSignOff.signoff=signed", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runMissionPersistStage(ctx, deps);

      const savedTrajectory = (deps.store.saveTrajectory as jest.Mock).mock
        .calls[0][1];
      expect(savedTrajectory.finalState).toBe("signed");
    });

    it("should include publishedCount in trajectory", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runMissionPersistStage(ctx, deps);

      const savedTrajectory = (deps.store.saveTrajectory as jest.Mock).mock
        .calls[0][1];
      expect(savedTrajectory.publishedCount).toBe(1);
    });

    it("should include verifiedCount in trajectory", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runMissionPersistStage(ctx, deps);

      const savedTrajectory = (deps.store.saveTrajectory as jest.Mock).mock
        .calls[0][1];
      expect(savedTrajectory.verifiedCount).toBe(1);
    });

    it("should include wallTimeMs in trajectory", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runMissionPersistStage(ctx, deps);

      const savedTrajectory = (deps.store.saveTrajectory as jest.Mock).mock
        .calls[0][1];
      expect(savedTrajectory.wallTimeMs).toBeGreaterThan(0);
    });

    it("should include platformVersions in trajectory snapshot", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runMissionPersistStage(ctx, deps);

      const savedTrajectory = (deps.store.saveTrajectory as jest.Mock).mock
        .calls[0][1];
      expect(savedTrajectory.platformVersions).toBeDefined();
      expect(savedTrajectory.platformVersions.wechat).toBeDefined();
    });

    it("should emit success narrative with signed state", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runMissionPersistStage(ctx, deps);

      const emitCalls = (deps.emit as jest.Mock).mock.calls;
      const successNarrative = emitCalls.find(
        (args: unknown[]) =>
          (args[0] as { type: string }).type === "social.agent:narrative" &&
          (args[0] as { payload: { tag: string } }).payload.tag === "success",
      );
      expect(successNarrative).toBeDefined();
      const text = (successNarrative![0] as { payload: { text: string } })
        .payload.text;
      expect(text).toContain("signed");
    });
  });

  describe("finalState variants", () => {
    it("should set finalState=concluded when leaderSignOff is not signed but published has content", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({
        leaderSignOff: {
          phase: "signoff",
          signoff: "reviewed",
          overallScore: 65,
          rationale: "Issues found",
        } as SignoffPhaseCtx["leaderSignOff"],
      });

      await runMissionPersistStage(ctx, deps);

      const savedTrajectory = (deps.store.saveTrajectory as jest.Mock).mock
        .calls[0][1];
      expect(savedTrajectory.finalState).toBe("concluded");
    });

    it("should set finalState=incomplete when leaderSignOff is undefined and published is undefined", async () => {
      const deps = makeDeps();
      const ctx = makeCtx({ leaderSignOff: undefined, published: undefined });

      await runMissionPersistStage(ctx, deps);

      const savedTrajectory = (deps.store.saveTrajectory as jest.Mock).mock
        .calls[0][1];
      expect(savedTrajectory.finalState).toBe("incomplete");
    });

    it("should count 0 published platforms when none have PUBLISHED status", async () => {
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

      await runMissionPersistStage(ctx, deps);

      const savedTrajectory = (deps.store.saveTrajectory as jest.Mock).mock
        .calls[0][1];
      expect(savedTrajectory.publishedCount).toBe(0);
    });
  });

  describe("saveTrajectory failure — degraded but not thrown", () => {
    it("should set trajectoryStored=0 when saveTrajectory throws", async () => {
      const deps = makeDeps({
        store: {
          saveTrajectory: jest
            .fn()
            .mockRejectedValue(new Error("DB connection failed")),
        } as unknown as CommonDeps["store"],
      });
      const ctx = makeCtx();

      await runMissionPersistStage(ctx, deps);

      expect(ctx.trajectoryStored).toBe(0);
    });

    it("should not throw when saveTrajectory fails", async () => {
      const deps = makeDeps({
        store: {
          saveTrajectory: jest.fn().mockRejectedValue(new Error("DB timeout")),
        } as unknown as CommonDeps["store"],
      });
      const ctx = makeCtx();

      await expect(runMissionPersistStage(ctx, deps)).resolves.toBeUndefined();
    });

    it("should call markStageDegraded when saveTrajectory fails", async () => {
      const deps = makeDeps({
        store: {
          saveTrajectory: jest.fn().mockRejectedValue(new Error("Disk full")),
        } as unknown as CommonDeps["store"],
      });
      const ctx = makeCtx();

      await runMissionPersistStage(ctx, deps);

      expect(deps.markStageDegraded).toHaveBeenCalledWith(
        "mission-s11-test",
        "user-s11",
        "s11-mission-persist",
        expect.stringContaining("trajectory 持久化失败"),
      );
    });

    it("should still emit narrative when saveTrajectory fails", async () => {
      const deps = makeDeps({
        store: {
          saveTrajectory: jest.fn().mockRejectedValue(new Error("Error")),
        } as unknown as CommonDeps["store"],
      });
      const ctx = makeCtx();

      await runMissionPersistStage(ctx, deps);

      const emitCalls = (deps.emit as jest.Mock).mock.calls;
      const narrativeCalls = emitCalls.filter(
        (args: unknown[]) =>
          (args[0] as { type: string }).type === "social.agent:narrative",
      );
      expect(narrativeCalls.length).toBeGreaterThan(0);
    });

    it("should log.warn with error message when saveTrajectory fails", async () => {
      const deps = makeDeps({
        store: {
          saveTrajectory: jest
            .fn()
            .mockRejectedValue(new Error("Unique save error")),
        } as unknown as CommonDeps["store"],
      });
      const ctx = makeCtx();

      await runMissionPersistStage(ctx, deps);

      expect(deps.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("Unique save error"),
      );
    });
  });

  describe("narrative text includes trajectory status", () => {
    it("should say trajectory=saved in narrative when successful", async () => {
      const deps = makeDeps();
      const ctx = makeCtx();

      await runMissionPersistStage(ctx, deps);

      const emitCalls = (deps.emit as jest.Mock).mock.calls;
      const narrativeCall = emitCalls.find(
        (args: unknown[]) =>
          (args[0] as { type: string }).type === "social.agent:narrative",
      );
      const text = (narrativeCall![0] as { payload: { text: string } }).payload
        .text;
      expect(text).toContain("saved");
    });

    it("should say trajectory=skipped in narrative when save fails", async () => {
      const deps = makeDeps({
        store: {
          saveTrajectory: jest.fn().mockRejectedValue(new Error("fail")),
        } as unknown as CommonDeps["store"],
      });
      const ctx = makeCtx();

      await runMissionPersistStage(ctx, deps);

      const emitCalls = (deps.emit as jest.Mock).mock.calls;
      const narrativeCall = emitCalls.find(
        (args: unknown[]) =>
          (args[0] as { type: string }).type === "social.agent:narrative",
      );
      const text = (narrativeCall![0] as { payload: { text: string } }).payload
        .text;
      expect(text).toContain("skipped");
    });
  });
});
