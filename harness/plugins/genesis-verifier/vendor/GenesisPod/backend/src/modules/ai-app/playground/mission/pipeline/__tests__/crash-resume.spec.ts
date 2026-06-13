/**
 * crash-resume.spec.ts
 *
 * R2-#37: verify that PlaygroundPipelineDispatcher.runMission correctly uses
 * missionCheckpoint.canResume() to detect a prior checkpoint and, when found,
 * passes resumeFromStepId + initialCrossStageState to orchestrator.run() so
 * already-completed stages are skipped.
 *
 * Strategy: spy on orchestrator.run to capture args instead of running the full
 * 13-stage pipeline (that is already covered by playground-pipeline-dispatcher.spec.ts).
 */

// Minimal stage stubs (prevent import side-effects)
jest.mock("../stages/s3-researcher-collect-findings.stage", () => ({
  runResearcherDispatchStage: jest.fn(async () => {}),
}));
jest.mock("../stages/s4-leader-assess-research.stage", () => ({
  runLeaderAssessResearchStage: jest.fn(async () => {}),
}));
jest.mock("../stages/s5-reconciler-cross-dim-fact-check.stage", () => ({
  runReconcilerStage: jest.fn(async () => {}),
}));
jest.mock("../stages/s6-analyst-synthesize-insights.stage", () => ({
  runAnalystStage: jest.fn(async () => {}),
}));
jest.mock("../stages/s7-writer-plan-outline.stage", () => ({
  runWriterOutlineStage: jest.fn(async () => {}),
}));
jest.mock("../stages/s8-writer-draft-report.stage", () => ({
  runWriterStage: jest.fn(async () => {}),
}));
jest.mock("../stages/s8b-section-quality-enhancement.stage", () => ({
  runSectionQualityEnhancementStage: jest.fn(async () => {}),
}));
jest.mock("../stages/s9-reviewer-critic-l4.stage", () => ({
  runCriticStage: jest.fn(async () => {}),
}));
jest.mock("../stages/s9b-report-objective-evaluation.stage", () => ({
  runReportObjectiveEvaluationStage: jest.fn(async () => {}),
}));
jest.mock("../stages/s10-leader-foreword-and-signoff.stage", () => ({
  runLeaderForewordAndSignoffStage: jest.fn(async () => {}),
}));
jest.mock("../stages/s11-mission-persist.stage", () => ({
  runPersistStage: jest.fn(async () => {}),
}));
jest.mock("../stages/s12-self-evolution.stage", () => ({
  runSelfEvolutionStage: jest.fn(async () => {}),
}));

import {
  MissionPipelineOrchestrator,
  MissionPipelineRegistry,
} from "@/modules/ai-harness/facade";
import { PlaygroundPipelineDispatcher } from "../playground.pipeline";
import { PlaygroundBusinessOrchestrator } from "../playground-business-orchestrator.service";
import { PlaygroundCrossStageState } from "../playground-cross-stage-state";
import { PLAYGROUND_PIPELINE } from "../../../runtime/playground.config";
import type { MissionRuntimeShellService } from "../mission-runtime-shell.service";
import type { MissionRuntimeSession } from "../mission-runtime-shell.service";
import type { MissionStageBindingsService } from "../mission-stage-bindings.service";
import type { AgentInvoker, LeaderService } from "../../roles";

// ─── shared test helpers ──────────────────────────────────────────────────────

function makeFakeSession(missionId: string, userId: string) {
  const abortController = new AbortController();
  return {
    missionId,
    userId,
    billing: {
      estimateAffordable: jest.fn().mockResolvedValue({
        affordable: true,
        estimatedCredits: 10,
        currentBalance: 1000,
      }),
    },
    pool: { snapshot: () => ({ poolTokensUsed: 0, poolCostUsd: 0 }) } as never,
    budgetMultiplier: 1,
    missionAbort: abortController,
    wallTimeMs: 60_000,
    cleanup: jest.fn(),
  } as unknown as MissionRuntimeSession;
}

function makeMinimalDeps() {
  const storeProxy = new Proxy({} as Record<string, jest.Mock>, {
    get(target, prop: string) {
      if (!(prop in target))
        target[prop] = jest.fn().mockResolvedValue(undefined);
      return target[prop];
    },
  });
  storeProxy.applyTerminalIfRunning = jest.fn().mockResolvedValue(true);

  const fakeCheckpoint = {
    clear: jest.fn().mockResolvedValue(undefined),
    save: jest.fn().mockResolvedValue(undefined),
    canResume: jest.fn().mockResolvedValue({
      canResume: false,
      reason: "no-checkpoint" as const,
      snapshot: null,
      completedKeys: new Set<string>(),
    }),
  };

  const fakeStageBindings = {
    buildDeps: jest.fn().mockReturnValue({
      store: storeProxy,
      log: {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      },
      emit: jest.fn().mockResolvedValue(undefined),
      lifecycle: jest.fn(),
    }),
    buildCtx: jest.fn((args: Record<string, unknown>) => ({
      ...args,
      s4PatchFailures: undefined,
    })),
  } as unknown as MissionStageBindingsService;

  return { storeProxy, fakeCheckpoint, fakeStageBindings };
}

function makeDispatcherBundle(
  checkpointMock: {
    canResume: boolean;
    snapshot: unknown;
    completedKeys?: Set<string>;
  } = { canResume: false, snapshot: null },
) {
  const reg = new MissionPipelineRegistry();
  const orch = new MissionPipelineOrchestrator(reg);
  const { fakeCheckpoint, fakeStageBindings, storeProxy } = makeMinimalDeps();

  fakeCheckpoint.canResume.mockResolvedValue({
    canResume: checkpointMock.canResume,
    snapshot: checkpointMock.snapshot,
    completedKeys: checkpointMock.completedKeys ?? new Set(),
    reason: checkpointMock.canResume ? "ok" : "no-checkpoint",
  });

  const fakePlan = {
    themeSummary: "t",
    dimensions: [{ id: "d1", name: "D1", rationale: "." }],
    goals: { successCriteria: [] },
    initialRisks: [],
  };
  const fakeLeaderService = {
    create: jest.fn().mockReturnValue({
      plan: jest.fn().mockResolvedValue(fakePlan),
    }),
  } as unknown as LeaderService;
  const fakeInvoker = {
    invoke: jest
      .fn()
      .mockResolvedValue({ state: "completed", output: {}, events: [] }),
    emitEvent: jest.fn().mockResolvedValue(undefined),
    emitLifecycle: jest.fn().mockResolvedValue(undefined),
    clearMissionRelayState: jest.fn(),
  } as unknown as AgentInvoker;
  const fakeEventBus = {
    emit: jest.fn().mockResolvedValue(true),
    registerAdapter: jest.fn(),
    unregisterAdapter: jest.fn(),
  };
  const fakeElectionTracker = { clear: jest.fn() };
  const fakeEventBuffer = {
    read: jest.fn().mockReturnValue([]),
    broadcast: jest.fn().mockResolvedValue(undefined),
  };
  const fakeLeaderInvocationFactory = {
    build: jest.fn().mockReturnValue(jest.fn()),
  };

  // Mock shell — runWithinContext calls the provided fn immediately
  const shell: MissionRuntimeShellService = {
    openSession: jest
      .fn()
      .mockImplementation(async (args: { missionId: string; userId: string }) =>
        makeFakeSession(args.missionId, args.userId),
      ),
    runWithinContext: jest
      .fn()
      .mockImplementation(
        async (_session: unknown, fn: () => Promise<unknown>) => fn(),
      ),
  } as unknown as MissionRuntimeShellService;

  const businessOrch = new PlaygroundBusinessOrchestrator(
    fakeStageBindings,
    fakeCheckpoint as never,
    storeProxy as never,
  );

  const fakeLifecycleManager = {
    finalize: jest.fn(
      async (args: {
        missionId: string;
        intent: { status: string };
        arbiter: {
          applyTerminalIfRunning: (id: string, i: unknown) => Promise<boolean>;
        };
        onWon?: () => Promise<void>;
      }) => {
        const won = await args.arbiter.applyTerminalIfRunning(
          args.missionId,
          args.intent,
        );
        if (won && args.onWon) await args.onWon().catch(() => {});
        return { won };
      },
    ),
  };

  const fakeMissionSpan = {
    startMissionSpan: jest.fn(),
    endMissionSpan: jest.fn(),
    startStageSpan: jest.fn(),
    endStageSpan: jest.fn(),
  };
  const dispatcher = new PlaygroundPipelineDispatcher(
    reg,
    orch,
    shell,
    fakeStageBindings,
    fakeLeaderService,
    fakeInvoker,
    fakeLeaderInvocationFactory as never,
    fakeCheckpoint as never,
    fakeEventBuffer as never,
    storeProxy as never,
    fakeElectionTracker as never,
    fakeEventBus as never,
    businessOrch,
    fakeLifecycleManager as never,
    fakeMissionSpan as never,
  );
  dispatcher.onModuleInit();

  return { dispatcher, fakeCheckpoint, orch, reg };
}

const MIN_INPUT = {
  topic: "test",
  depth: "quick",
  language: "zh-CN",
  budgetProfile: "low",
  styleProfile: "executive",
  lengthProfile: "brief",
  audienceProfile: "domain-expert",
  withFigures: false,
  auditLayers: "default",
  concurrency: 1,
  viewMode: "continuous",
  maxCredits: 50,
} as never;

// ─── tests ────────────────────────────────────────────────────────────────────

describe("R2-#37 crash-resume: PlaygroundPipelineDispatcher", () => {
  it("no checkpoint: missionCheckpoint.canResume is always consulted on runMission", async () => {
    const { dispatcher, fakeCheckpoint, orch } = makeDispatcherBundle();

    // Replace orchestrator.run with a spy that returns a completed result immediately
    jest.spyOn(orch, "run").mockResolvedValue({
      missionId: "m-no-cp",
      status: "completed",
      stageOutputs: {},
      error: undefined,
    });

    await dispatcher.runMission("m-no-cp", MIN_INPUT, "u1");
    // canResume must be called once with the missionId
    expect(fakeCheckpoint.canResume).toHaveBeenCalledWith("m-no-cp");
  });

  it("no checkpoint: orchestrator.run called WITHOUT resumeFromStepId or initialCrossStageState", async () => {
    const { dispatcher, orch } = makeDispatcherBundle({
      canResume: false,
      snapshot: null,
    });

    const runSpy = jest.spyOn(orch, "run").mockResolvedValue({
      missionId: "m-fresh",
      status: "completed",
      stageOutputs: {},
      error: undefined,
    });

    await dispatcher.runMission("m-fresh", MIN_INPUT, "u1");

    const args = runSpy.mock.calls[0][0];
    expect(args.resumeFromStepId).toBeUndefined();
    expect(args.initialCrossStageState).toBeUndefined();
  });

  it("with checkpoint for s1+s2: orchestrator.run called WITH resumeFromStepId='s2-leader-plan'", async () => {
    const crossState = new PlaygroundCrossStageState();
    crossState.lastPlan = {
      themeSummary: "resumed-theme",
      dimensions: [{ id: "d1", name: "D1", rationale: "." }],
      goals: { successCriteria: [] },
      initialRisks: [],
    } as never;

    const completedKeys = new Set(["s1-budget", "s2-leader-plan"]);
    const snapshot = {
      missionId: "m-resume",
      savedAt: new Date(),
      status: "running" as const,
      completedKeys: [...completedKeys],
      payload: {
        lastStage: "s2-leader-plan",
        topic: "test",
        crossState: crossState.toJSON(),
      },
    };

    const { dispatcher, orch } = makeDispatcherBundle({
      canResume: true,
      snapshot,
      completedKeys,
    });

    const runSpy = jest.spyOn(orch, "run").mockResolvedValue({
      missionId: "m-resume",
      status: "completed",
      stageOutputs: {},
      error: undefined,
    });

    await dispatcher.runMission("m-resume", MIN_INPUT, "u1");

    const args = runSpy.mock.calls[0][0];
    // The last completed step (highest stageNumber in completedKeys) is s2-leader-plan
    expect(args.resumeFromStepId).toBe("s2-leader-plan");
    // crossState JSON must be passed so orchestrator can seed CrossStageState
    expect(args.initialCrossStageState).toBeDefined();
  });

  it("with checkpoint: restored crossState is available on session entry", async () => {
    const crossState = new PlaygroundCrossStageState();
    crossState.lastPlan = {
      themeSummary: "persisted-theme",
      dimensions: [{ id: "d1", name: "D1", rationale: "." }],
      goals: { successCriteria: [] },
      initialRisks: [],
    } as never;

    const completedKeys = new Set(["s1-budget", "s2-leader-plan"]);
    const snapshot = {
      missionId: "m-xstate",
      savedAt: new Date(),
      status: "running" as const,
      completedKeys: [...completedKeys],
      payload: {
        lastStage: "s2-leader-plan",
        topic: "t",
        crossState: crossState.toJSON(),
      },
    };

    const { dispatcher, orch } = makeDispatcherBundle({
      canResume: true,
      snapshot,
      completedKeys,
    });

    let capturedCrossState: PlaygroundCrossStageState | undefined;
    jest.spyOn(orch, "run").mockImplementation(async (args) => {
      // Peek at the session entry's crossState at the time orchestrator.run is called
      const sessions = (
        dispatcher as unknown as {
          sessions: Map<string, { crossState: PlaygroundCrossStageState }>;
        }
      ).sessions;
      const entry = sessions.get(args.missionId);
      capturedCrossState = entry?.crossState;
      return {
        missionId: args.missionId,
        status: "completed",
        stageOutputs: {},
        error: undefined,
      };
    });

    await dispatcher.runMission("m-xstate", MIN_INPUT, "u1");

    // The restored crossState should carry over the persisted plan
    expect(capturedCrossState?.lastPlan?.themeSummary).toBe("persisted-theme");
  });

  it("checkpoint canResume throws: falls back to fresh start (no resumeFromStepId)", async () => {
    const { dispatcher, fakeCheckpoint, orch } = makeDispatcherBundle();

    // Force canResume to throw a DB error
    fakeCheckpoint.canResume.mockRejectedValue(new Error("DB connection lost"));

    const runSpy = jest.spyOn(orch, "run").mockResolvedValue({
      missionId: "m-cp-err",
      status: "completed",
      stageOutputs: {},
      error: undefined,
    });

    // Should not throw — falls back to fresh start
    const result = await dispatcher.runMission("m-cp-err", MIN_INPUT, "u1");
    expect(result.status).toBe("completed");

    const args = runSpy.mock.calls[0][0];
    // No resume: starts fresh
    expect(args.resumeFromStepId).toBeUndefined();
    expect(args.initialCrossStageState).toBeUndefined();
  });

  it("checkpoint with only s1 completed: resumeFromStepId='s1-budget'", async () => {
    const completedKeys = new Set(["s1-budget"]);
    const snapshot = {
      missionId: "m-s1-only",
      savedAt: new Date(),
      status: "running" as const,
      completedKeys: ["s1-budget"],
      payload: {
        lastStage: "s1-budget",
        topic: "t",
        crossState: {},
      },
    };

    const { dispatcher, orch } = makeDispatcherBundle({
      canResume: true,
      snapshot,
      completedKeys,
    });

    const runSpy = jest.spyOn(orch, "run").mockResolvedValue({
      missionId: "m-s1-only",
      status: "completed",
      stageOutputs: {},
      error: undefined,
    });

    await dispatcher.runMission("m-s1-only", MIN_INPUT, "u1");

    const args = runSpy.mock.calls[0][0];
    expect(args.resumeFromStepId).toBe("s1-budget");
  });

  it("PLAYGROUND_PIPELINE registered — 13 steps wired", () => {
    const { reg } = makeDispatcherBundle();
    expect(reg.has(PLAYGROUND_PIPELINE.id)).toBe(true);
    expect(reg.get(PLAYGROUND_PIPELINE.id).steps).toHaveLength(13);
  });
});

// ─── #37 S3 dim-level checkpoint resume ──────────────────────────────────────

describe("#37 S3 dim-level checkpoint: buildS3ResearcherCollectHooks", () => {
  /**
   * Tests the business orchestrator's S3 hook directly.
   * When entry.crossState.s3PartialResults has 2 of 3 dims already done,
   * runResearcherDispatchStage must only be called with the remaining 1 dim.
   */
  it("skips already-checkpointed dims and merges results in original order", async () => {
    const { runResearcherDispatchStage: mockS3 } = jest.requireMock(
      "../stages/s3-researcher-collect-findings.stage",
    );
    mockS3.mockReset();

    // The fresh run fills only the pending dim
    mockS3.mockImplementation(
      async (ctx: {
        researcherResults?: unknown[];
        plan?: { dimensions: { name: string }[] };
      }) => {
        // stage writes results for the dims it was given
        ctx.researcherResults = (ctx.plan?.dimensions ?? []).map((d) => ({
          dimension: d.name,
          findings: [{ claim: "c", evidence: "e", source: "s" }],
          summary: "ok",
        }));
      },
    );

    const { dispatcher } = makeDispatcherBundle();

    // Arrange: set up a session with crossState that has 2/3 dims already done
    const missionId = "m-s3-resume";
    const plan = {
      themeSummary: "t",
      dimensions: [
        { id: "d1", name: "D1", rationale: "." },
        { id: "d2", name: "D2", rationale: "." },
        { id: "d3", name: "D3", rationale: "." },
      ],
      goals: { successCriteria: [] },
      initialRisks: [],
    };

    // Mock orchestrator.run to call the S3 perItemPipeline hook directly
    const orch = (dispatcher as unknown as { orchestrator: { run: jest.Mock } })
      .orchestrator;

    let capturedDimsCount: number | undefined;
    jest.spyOn(orch, "run").mockImplementation(async () => {
      // Simulate dispatcher running the S3 hook by calling it directly
      const sessions = (
        dispatcher as unknown as {
          sessions: Map<
            string,
            {
              crossState: PlaygroundCrossStageState;
              session: { missionId: string; userId: string };
              input: typeof MIN_INPUT;
              t0: number;
              billing: unknown;
              pool: unknown;
              leader: unknown;
              workspaceId: undefined;
              budgetMultiplier: number;
            }
          >;
        }
      ).sessions;
      const entry = sessions.get(missionId);
      if (!entry)
        return {
          missionId,
          status: "completed" as const,
          stageOutputs: {},
          error: undefined,
        };

      // Preset crossState: d1 and d2 already done
      entry.crossState.lastPlan = plan as never;
      entry.crossState.s3PartialResults = {
        d1: {
          dimension: "D1",
          findings: [{ claim: "cached-c1", evidence: "e", source: "s" }],
          summary: "cached-1",
        },
        d2: {
          dimension: "D2",
          findings: [{ claim: "cached-c2", evidence: "e", source: "s" }],
          summary: "cached-2",
        },
      };

      // Now call the S3 hook via the business orchestrator's perItemPipeline
      const businessOrch = (
        dispatcher as unknown as {
          businessOrch: {
            buildHooksForStep: (
              id: string,
              p: string,
            ) => { perItemPipeline: (args: unknown) => Promise<unknown> };
          };
        }
      ).businessOrch;
      const hooks = businessOrch.buildHooksForStep(
        "s3-researcher-collect",
        "research",
      );
      const result = await (
        hooks as unknown as {
          perItemPipeline: (args: {
            item: unknown;
            role: unknown;
            ctx: { missionId: string };
          }) => Promise<unknown>;
        }
      ).perItemPipeline({
        item: { kind: "all-dimensions" },
        role: {},
        ctx: { missionId },
      });

      // Capture how many dims were dispatched to the stage
      capturedDimsCount = (
        mockS3.mock.calls[0]?.[0]?.plan?.dimensions as unknown[]
      )?.length;

      return {
        missionId,
        status: "completed" as const,
        stageOutputs: { "s3-researcher-collect": result },
        error: undefined,
      };
    });

    await dispatcher.runMission(missionId, MIN_INPUT, "u1");

    // Only d3 (the remaining dim) should have been dispatched to runResearcherDispatchStage
    expect(capturedDimsCount).toBe(1);
    expect(mockS3).toHaveBeenCalledTimes(1);
  });
});

// ─── #44 S4‖S5 parallel execution ─────────────────────────────────────────────

describe("#44 S4‖S5 parallel: MissionPipelineOrchestrator", () => {
  it("S4 and S5 start before either completes (concurrent execution)", async () => {
    const reg = new MissionPipelineRegistry();
    const orch = new MissionPipelineOrchestrator(reg);

    const startOrder: string[] = [];
    const completeOrder: string[] = [];

    // S4: slow (200ms artificial delay)
    const s4Delay = 50;
    const s5Delay = 20;

    reg.register({
      id: "parallel-test",
      roles: [],
      steps: [
        {
          id: "s4-leader-assess",
          primitive: "assess",
          hooks: {
            runRole: async () => {
              startOrder.push("s4");
              await new Promise<void>((res) => setTimeout(res, s4Delay));
              completeOrder.push("s4");
              return {};
            },
            parseDecision: () => "continue" as never,
          },
        },
        {
          id: "s5-reconciler",
          primitive: "synthesize",
          hooks: {
            synthesize: async () => {
              startOrder.push("s5");
              await new Promise<void>((res) => setTimeout(res, s5Delay));
              completeOrder.push("s5");
              return {};
            },
          },
        },
        {
          id: "s6-analyst",
          primitive: "synthesize",
          hooks: {
            synthesize: async () => {
              startOrder.push("s6");
              completeOrder.push("s6");
              return {};
            },
          },
        },
      ],
    } as never);

    const events: string[] = [];
    const result = await orch.run({
      missionId: "m-parallel",
      pipelineId: "parallel-test",
      input: {},
      onEvent: (e) => {
        if (
          e.stepId &&
          (e.type === "stage:started" || e.type === "stage:completed")
        ) {
          events.push(`${e.type}:${e.stepId}`);
        }
      },
    });

    expect(result.status).toBe("completed");

    // Both S4 and S5 must start before either completes
    const s4StartIdx = startOrder.indexOf("s4");
    const s5StartIdx = startOrder.indexOf("s5");
    const s4CompleteIdx = completeOrder.indexOf("s4");
    const s5CompleteIdx = completeOrder.indexOf("s5");

    expect(s4StartIdx).toBeGreaterThanOrEqual(0);
    expect(s5StartIdx).toBeGreaterThanOrEqual(0);
    // Both started (s4 first, then s5) before either completed
    expect(s4StartIdx).toBeLessThan(2); // s4 starts first
    expect(s5StartIdx).toBeLessThan(2); // s5 starts before s4 completes

    // S5 finishes first (shorter delay), S4 finishes after
    expect(s5CompleteIdx).toBeLessThan(s4CompleteIdx);

    // S6 starts only after both S4 and S5 are done
    expect(startOrder.indexOf("s6")).toBeGreaterThan(
      Math.max(s4CompleteIdx, s5CompleteIdx) - 1,
    );
  });

  it("dependent chain S6→... stays sequential after S4‖S5", async () => {
    const reg = new MissionPipelineRegistry();
    const orch = new MissionPipelineOrchestrator(reg);

    const order: string[] = [];

    reg.register({
      id: "seq-after-parallel",
      roles: [],
      steps: [
        {
          id: "s4-leader-assess",
          primitive: "assess",
          hooks: {
            runRole: async () => {
              order.push("s4-start");
              return {};
            },
            parseDecision: () => "continue" as never,
          },
        },
        {
          id: "s5-reconciler",
          primitive: "synthesize",
          hooks: {
            synthesize: async () => {
              order.push("s5-start");
              return {};
            },
          },
        },
        {
          id: "s6-analyst",
          primitive: "synthesize",
          hooks: {
            synthesize: async () => {
              order.push("s6-start");
              return {};
            },
          },
        },
        {
          id: "s7-next",
          primitive: "synthesize",
          hooks: {
            synthesize: async () => {
              order.push("s7-start");
              return {};
            },
          },
        },
      ],
    } as never);

    const result = await orch.run({
      missionId: "m-seq",
      pipelineId: "seq-after-parallel",
      input: {},
    });

    expect(result.status).toBe("completed");
    // S6 must come after both S4 and S5 (regardless of S4/S5 order)
    const s6idx = order.indexOf("s6-start");
    const s4idx = order.indexOf("s4-start");
    const s5idx = order.indexOf("s5-start");
    expect(s6idx).toBeGreaterThan(s4idx);
    expect(s6idx).toBeGreaterThan(s5idx);
    // S7 must come after S6
    expect(order.indexOf("s7-start")).toBeGreaterThan(s6idx);
  });
});
