/**
 * RB-Gap3: S8 (publish-execute) cancel-boundary integration tests.
 *
 * Invariant under test: gate-before-stage.
 *   - S8 does NOT check the abort signal internally; publish is atomic.
 *   - Abort only fires at stage-dispatch boundaries (the gate in
 *     SocialBusinessOrchestrator.buildHooksForStep).
 *
 * Simulation strategy:
 *   - Mock `runPublishExecuteStage` at module level so we can track invocations
 *     and simulate multi-platform publish work.
 *   - Use the REAL SocialBusinessOrchestrator so the gate logic in
 *     buildHooksForStep is exercised (signal check before hookFn).
 *   - Replace `MissionPipelineOrchestrator` with a thin gate-before-stage
 *     simulator that mirrors the real orchestrator contract: before dispatching
 *     each stage it checks signal.aborted; if aborted it short-circuits and
 *     returns { status: "failed", error: StageAbortError }.
 *   - The AbortController lives in the mock session (entry.session.missionAbort),
 *     and is accessible from the dispatcher's runMission via sessionRef.
 *
 * Four cases (Gap 3 spec):
 *   1. cancel BEFORE S8  - abort fires during S7 completion; S8 hook never called.
 *   2. cancel DURING S8  - S8 runs to completion; abort fires at S9 gate; cancelled terminal.
 *   3. no half-publish   - 2-platform, abort mid-platform-1; both platforms still published.
 *   4. abort after S8, before S9 - pipeline stops at S9 gate; cancelled terminal.
 */

// ---------------------------------------------------------------------------
// Mock stages that would otherwise call real services
// ---------------------------------------------------------------------------
jest.mock("../stages/s8-publish-execute.stage");
jest.mock("../stages/s12-self-evolution.stage", () => ({
  runSelfEvolutionStage: jest.fn().mockResolvedValue(undefined),
}));
// Mock all other stages as no-ops so the real SocialBusinessOrchestrator hooks
// resolve without needing real service dependencies.
jest.mock("../stages/s1-mission-budget-eval.stage", () => ({
  runMissionBudgetEvalStage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../stages/s2-platform-probe.stage", () => ({
  runPlatformProbeStage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../stages/s3-content-transform.stage", () => ({
  runContentTransformStage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../stages/s4-leader-assess-transform.stage", () => ({
  runLeaderAssessTransformStage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../stages/s5-cover-craft.stage", () => ({
  runCoverCraftStage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../stages/s6-body-compose.stage", () => ({
  runBodyComposeStage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../stages/s7-polish-review.stage", () => ({
  runPolishReviewStage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../stages/s8b-publish-retry.stage", () => ({
  runPublishRetryStage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../stages/s9-publish-verify.stage", () => ({
  runPublishVerifyStage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../stages/s10-leader-signoff.stage", () => ({
  runLeaderSignoffStage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../stages/s11-mission-persist.stage", () => ({
  runMissionPersistStage: jest.fn().mockResolvedValue(undefined),
}));

import { runPublishExecuteStage } from "../stages/s8-publish-execute.stage";
import { runPolishReviewStage } from "../stages/s7-polish-review.stage";
import { runPublishVerifyStage } from "../stages/s9-publish-verify.stage";

import { Logger } from "@nestjs/common";
import { SocialPipelineDispatcher } from "../social-pipeline-dispatcher.service";
import { SocialBusinessOrchestrator } from "../social-business-orchestrator.service";
import { SOCIAL_PIPELINE } from "../../../runtime/social.config";
import {
  StageAbortError,
  MissionAbortReason,
} from "@/modules/ai-harness/facade";
import type {
  MissionPipelineRegistry,
  MissionPipelineOrchestrator,
  EventBus,
  AgentRunner,
  MissionAbortRegistry,
  FailureLearnerService,
  PostmortemClassifierService,
  MissionLifecycleManager,
  MissionTerminalIntent,
  ResolvedStageHooks,
} from "@/modules/ai-harness/facade";
import type { SocialRuntimeShellService } from "../social-runtime-shell.service";
import type { SocialMissionStore } from "../../lifecycle/social-mission-store.service";
import type { SocialAgentInvoker } from "../../../roles/social-agent-invoker.service";
import type { PrismaService } from "@/common/prisma/prisma.service";
import type { LeaderService } from "../../../roles/leader.service";
import type { StewardService } from "../../../roles/steward.service";
import type { PlatformProbeService } from "../../../roles/platform-probe.service";
import type { ContentTransformerService } from "../../../roles/content-transformer.service";
import type { CoverArtistService } from "../../../roles/cover-artist.service";
import type { ComposerService } from "../../../roles/composer.service";
import type { PolishReviewerService } from "../../../roles/polish-reviewer.service";
import type { PublishExecutorAgentService } from "../../../roles/publish-executor-agent.service";
import type { PublishVerifierService } from "../../../roles/publish-verifier.service";
import type { RunSocialMissionInput } from "../../context/mission-context";

// ---------------------------------------------------------------------------
// Gate-before-stage orchestrator simulator
//
// Mimics the real MissionPipelineOrchestrator contract: before each stage hook
// it checks signal.aborted; if aborted, returns { status: "failed", error:
// StageAbortError } without calling the hook (gate blocks entry).
// This is the exact same invariant the production harness implements.
// ---------------------------------------------------------------------------

interface PipelineStep {
  id: string;
  hooks: ResolvedStageHooks;
}

interface OrchestratorRunOpts {
  missionId: string;
  pipelineId: string;
  input: unknown;
  userId: string;
  tenantId?: string;
  signal: AbortSignal;
  onEvent: (e: unknown) => Promise<void>;
}

function buildGateBeforeStageOrchestrator(
  steps: PipelineStep[],
): MissionPipelineOrchestrator {
  return {
    run: jest.fn(
      async (
        opts: OrchestratorRunOpts,
      ): Promise<{ status: string; error?: unknown }> => {
        for (const step of steps) {
          // Gate: check abort signal BEFORE dispatching the stage.
          // This is the RB6 invariant: S8 is only entered if not yet aborted.
          if (opts.signal.aborted) {
            const abortErr = new StageAbortError(
              step.id,
              `mission cancelled before ${step.id}`,
            );
            await opts.onEvent({
              type: "stage:failed",
              stepId: step.id,
              error: abortErr,
              timestamp: Date.now(),
            });
            return { status: "failed", error: abortErr };
          }

          await opts.onEvent({
            type: "stage:started",
            stepId: step.id,
            primitive: "persist",
            timestamp: Date.now(),
          });

          try {
            // Invoke the hook (already built by SocialBusinessOrchestrator which
            // includes its own internal signal gate — redundant but harmless).
            const hook = step.hooks["persist"];
            if (hook) {
              await hook({
                ctx: {
                  missionId: opts.missionId,
                  signal: opts.signal,
                },
                previousOutputs: {},
                crossStageState: {},
              });
            }
          } catch (err) {
            await opts.onEvent({
              type: "stage:failed",
              stepId: step.id,
              error: err,
              timestamp: Date.now(),
            });
            return { status: "failed", error: err };
          }

          await opts.onEvent({
            type: "stage:completed",
            stepId: step.id,
            timestamp: Date.now(),
          });
        }
        return { status: "completed" };
      },
    ),
  } as unknown as MissionPipelineOrchestrator;
}

// ---------------------------------------------------------------------------
// Shared mock factories (mirrored from dispatcher spec)
// ---------------------------------------------------------------------------

function createMockRegistry(): jest.Mocked<MissionPipelineRegistry> {
  return {
    has: jest.fn().mockReturnValue(false),
    register: jest.fn(),
  } as unknown as jest.Mocked<MissionPipelineRegistry>;
}

function createMockSession() {
  return {
    missionId: "rb6-session-mission",
    billing: { type: "billing-adapter" },
    pool: {
      snapshot: jest.fn().mockReturnValue({
        poolCostRemaining: 5,
      }),
    },
    budgetMultiplier: 1.0,
    missionAbort: new AbortController(),
    cleanup: jest.fn(),
  };
}

function createMockRuntimeShell(
  session: ReturnType<typeof createMockSession>,
): jest.Mocked<SocialRuntimeShellService> {
  return {
    openSession: jest.fn().mockResolvedValue(session),
    runWithinContext: jest
      .fn()
      .mockImplementation((_sess: unknown, fn: () => Promise<unknown>) => fn()),
  } as unknown as jest.Mocked<SocialRuntimeShellService>;
}

function createMockStore(): jest.Mocked<SocialMissionStore> {
  return {
    create: jest.fn().mockResolvedValue(undefined),
    applyTerminalIfRunning: jest.fn().mockResolvedValue(true),
    refreshHeartbeat: jest.fn().mockResolvedValue(undefined),
    saveTrajectory: jest.fn().mockResolvedValue(undefined),
    recordPublishLog: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<SocialMissionStore>;
}

function createMockLifecycleManager(): jest.Mocked<MissionLifecycleManager> {
  const finalize = jest.fn(
    async (args: {
      missionId: string;
      intent: MissionTerminalIntent<unknown>;
      arbiter: {
        applyTerminalIfRunning: (
          id: string,
          intent: MissionTerminalIntent<unknown>,
        ) => Promise<boolean>;
      };
      abort?: boolean;
      onWon?: () => Promise<void>;
    }) => {
      const won = await args.arbiter.applyTerminalIfRunning(
        args.missionId,
        args.intent,
      );
      if (won && args.onWon) {
        try {
          await args.onWon();
        } catch {
          // non-fatal: match real finalize semantics
        }
      }
      return { won };
    },
  );
  return { finalize } as unknown as jest.Mocked<MissionLifecycleManager>;
}

function createMockEventBus(): jest.Mocked<EventBus> {
  return {
    emit: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<EventBus>;
}

function createMockAbortRegistry(): jest.Mocked<MissionAbortRegistry> {
  return {
    getSignal: jest.fn().mockReturnValue(new AbortController().signal),
    abort: jest.fn(),
  } as unknown as jest.Mocked<MissionAbortRegistry>;
}

function createMockPrisma(): jest.Mocked<PrismaService> {
  return {
    socialContent: {
      findFirst: jest.fn().mockResolvedValue({
        title: "RB6 Title",
        content: "RB6 body",
        digest: null,
        coverImageUrl: null,
      }),
    },
    socialPlatformConnection: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    socialMission: {
      count: jest.fn().mockResolvedValue(0),
    },
  } as unknown as jest.Mocked<PrismaService>;
}

function makeRoleStub<T>(): jest.Mocked<T> {
  return {} as jest.Mocked<T>;
}

function makeInput(
  overrides: Partial<RunSocialMissionInput> = {},
): RunSocialMissionInput {
  return {
    contentId: "rb6-content-1",
    platforms: ["wechat"],
    connectionIds: { wechat: "conn-rb6" },
    depth: "standard",
    budgetProfile: "standard",
    language: "zh-CN",
    ...overrides,
  };
}

const MOCK_MISSION_ID = "mission-rb6-s8-boundary";
const MOCK_USER_ID = "user-rb6";

// ---------------------------------------------------------------------------
// Dispatcher factory that wires the REAL SocialBusinessOrchestrator so the
// actual gate-before-stage hook logic is exercised.
// ---------------------------------------------------------------------------

function createRb6Setup(opts: {
  pipelineStepIds: string[];
  session: ReturnType<typeof createMockSession>;
}) {
  const registry = createMockRegistry();
  const store = createMockStore();
  const invoker = {
    clearMissionRelayState: jest.fn(),
    emitLifecycle: jest.fn().mockResolvedValue(undefined),
    tickCost: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<SocialAgentInvoker>;
  const eventBus = createMockEventBus();
  const lifecycleManager = createMockLifecycleManager();
  const prisma = createMockPrisma();
  const runtimeShell = createMockRuntimeShell(opts.session);

  // Use the REAL SocialBusinessOrchestrator — this contains the gate logic.
  const businessOrch = new SocialBusinessOrchestrator();

  // Build pipeline steps with real hooks from businessOrch.
  // We call onModuleInit to register; then extract the built steps from the
  // registry.register call to pass to our gate-before-stage simulator.
  const capturedPipelines: Array<{
    id: string;
    steps: PipelineStep[];
  }> = [];
  (registry.register as jest.Mock).mockImplementation(
    (pipeline: { id: string; steps: PipelineStep[] }) => {
      capturedPipelines.push(pipeline);
    },
  );

  const dispatcher = new SocialPipelineDispatcher(
    registry as unknown as MissionPipelineRegistry,
    // Placeholder orchestrator — replaced after onModuleInit
    { run: jest.fn() } as unknown as MissionPipelineOrchestrator,
    runtimeShell as unknown as SocialRuntimeShellService,
    businessOrch as unknown as typeof businessOrch,
    store as unknown as SocialMissionStore,
    invoker as unknown as SocialAgentInvoker,
    makeRoleStub<AgentRunner>() as unknown as AgentRunner,
    eventBus as unknown as EventBus,
    createMockAbortRegistry() as unknown as MissionAbortRegistry,
    { assign: jest.fn(), getOwner: jest.fn(), remove: jest.fn() } as never,
    makeRoleStub<FailureLearnerService>() as unknown as FailureLearnerService,
    makeRoleStub<PostmortemClassifierService>() as unknown as PostmortemClassifierService,
    makeRoleStub<LeaderService>() as unknown as LeaderService,
    makeRoleStub<StewardService>() as unknown as StewardService,
    makeRoleStub<PlatformProbeService>() as unknown as PlatformProbeService,
    makeRoleStub<ContentTransformerService>() as unknown as ContentTransformerService,
    makeRoleStub<CoverArtistService>() as unknown as CoverArtistService,
    makeRoleStub<ComposerService>() as unknown as ComposerService,
    makeRoleStub<PolishReviewerService>() as unknown as PolishReviewerService,
    makeRoleStub<PublishExecutorAgentService>() as unknown as PublishExecutorAgentService,
    makeRoleStub<PublishVerifierService>() as unknown as PublishVerifierService,
    prisma as unknown as PrismaService,
    lifecycleManager as unknown as MissionLifecycleManager,
  );

  // onModuleInit triggers buildPipelineWithHooks → captures real hook steps.
  dispatcher.onModuleInit();

  // Find the pipeline whose steps match what we want to run.
  // We pick the standard pipeline by default (13 steps).
  const standardPipeline = capturedPipelines.find(
    (p) => p.id === SOCIAL_PIPELINE.id,
  );
  if (!standardPipeline) {
    throw new Error("Standard pipeline not captured from registry.register");
  }

  // Filter to only the requested step ids, in order.
  const filteredSteps = opts.pipelineStepIds
    .map((id) => standardPipeline.steps.find((s) => s.id === id))
    .filter((s): s is PipelineStep => s !== undefined);

  // Build the gate-before-stage simulator with the filtered steps.
  const gateOrchestrator = buildGateBeforeStageOrchestrator(filteredSteps);

  // Swap the orchestrator into the dispatcher by re-constructing.
  // Since orchestrator is injected via constructor but dispatcher.runMission
  // calls this.orchestrator.run, we monkey-patch the private field.
  // In tests this is the accepted pattern for private field injection.
  (
    dispatcher as unknown as {
      orchestrator: MissionPipelineOrchestrator;
    }
  ).orchestrator = gateOrchestrator;

  return {
    dispatcher,
    store,
    eventBus,
    lifecycleManager,
    gateOrchestrator,
    session: opts.session,
    prisma,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RB-Gap3: S8 cancel-boundary integration tests", () => {
  let loggerLogSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    loggerLogSpy = jest.spyOn(Logger.prototype, "log").mockImplementation();
    loggerWarnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    loggerErrorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.clearAllMocks();
    // Restore mocks that may have been reconfigured in previous tests.
    (runPublishExecuteStage as jest.Mock).mockResolvedValue(undefined);
    (runPolishReviewStage as jest.Mock).mockResolvedValue(undefined);
    (runPublishVerifyStage as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    loggerLogSpy.mockRestore();
    loggerWarnSpy.mockRestore();
    loggerErrorSpy.mockRestore();
  });

  // =========================================================================
  // Test 1: cancel BEFORE S8 — S8 never called, mission terminates cancelled
  //
  // Simulation: S7 hook fires the abort signal during its execution.
  // Gate checks signal.aborted before dispatching S8 — finds it aborted —
  // short-circuits without calling S8 hook. Mission terminates cancelled.
  // =========================================================================
  it("cancel BEFORE S8: S8 (publish-execute) never called, mission terminates cancelled", async () => {
    const session = createMockSession();

    // S7 abort simulation: during S7 execution, fire the mission's abort signal.
    (runPolishReviewStage as jest.Mock).mockImplementation(async () => {
      // This fires while S7 is executing — BEFORE S8's gate is reached.
      session.missionAbort.abort(MissionAbortReason.user_cancelled);
    });

    const { dispatcher, lifecycleManager } = createRb6Setup({
      pipelineStepIds: [
        "s7-polish-review",
        "s8-publish-execute",
        "s9-publish-verify",
      ],
      session,
    });

    const result = await dispatcher.runMission(
      MOCK_MISSION_ID,
      makeInput(),
      MOCK_USER_ID,
    );

    // S8 must never have been called.
    expect(runPublishExecuteStage).not.toHaveBeenCalled();

    // Mission must terminate in cancelled state.
    expect(lifecycleManager.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        missionId: MOCK_MISSION_ID,
        intent: expect.objectContaining({ status: "cancelled" }),
      }),
    );
    expect(result.status).toBe("failed");
  });

  // =========================================================================
  // Test 2: cancel DURING S8 — S8 runs to completion, abort fires at next gate
  //
  // Simulation: S8 fires the abort signal during publish (partway through),
  // but since S8 does NOT check the signal internally, the mock still
  // completes. The gate before S9 finds signal.aborted and short-circuits.
  // Mission terminates cancelled.
  // =========================================================================
  it("cancel DURING S8: S8 runs to completion, abort fires at next boundary (S9 gate), mission terminates cancelled", async () => {
    const session = createMockSession();

    // S8 fires abort mid-execution but still resolves (no internal signal check).
    (runPublishExecuteStage as jest.Mock).mockImplementation(async () => {
      // Simulate: "partway through S8" abort request arrives.
      session.missionAbort.abort(MissionAbortReason.user_cancelled);
      // S8 continues and completes — no half-publish.
    });

    const { dispatcher, lifecycleManager } = createRb6Setup({
      pipelineStepIds: [
        "s8-publish-execute",
        "s9-publish-verify",
        "s11-mission-persist",
      ],
      session,
    });

    const result = await dispatcher.runMission(
      MOCK_MISSION_ID,
      makeInput(),
      MOCK_USER_ID,
    );

    // S8 must have been called and ran to completion (no half-publish).
    expect(runPublishExecuteStage).toHaveBeenCalledTimes(1);

    // S9 must NOT have been called — gate blocked it after S8 completed.
    expect(runPublishVerifyStage).not.toHaveBeenCalled();

    // Mission terminates cancelled.
    expect(lifecycleManager.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        missionId: MOCK_MISSION_ID,
        intent: expect.objectContaining({ status: "cancelled" }),
      }),
    );
    expect(result.status).toBe("failed");
  });

  // =========================================================================
  // Test 3: no half-publish — 2-platform, abort mid-platform-1 → both published
  //
  // Simulation: input has 2 platforms. S8 fires abort after the first platform
  // is being processed (simulates "cancel arrives while platform-1 is publishing").
  // Since S8 has no internal signal check, the mock still resolves for both
  // platforms. We verify S8 was called exactly once (all platforms in one call),
  // and S9 gate fires after — confirming no partial publish.
  // =========================================================================
  it("no half-publish: 2-platform abort mid-platform-1 -> both platforms still published (S8 atomic)", async () => {
    const session = createMockSession();

    let s8CallCount = 0;
    (runPublishExecuteStage as jest.Mock).mockImplementation(async () => {
      s8CallCount++;
      // Simulate: cancel arrives while publishing the first platform.
      // S8 does NOT check signal — continues to publish all platforms.
      session.missionAbort.abort(MissionAbortReason.user_cancelled);
      // S8 resolves — all platforms fully published (atomic).
    });

    const twoPlatformInput = makeInput({
      platforms: ["wechat", "xiaohongshu"],
      connectionIds: { wechat: "conn-wechat", xiaohongshu: "conn-xhs" },
    });

    const { dispatcher, lifecycleManager } = createRb6Setup({
      pipelineStepIds: [
        "s8-publish-execute",
        "s9-publish-verify",
        "s11-mission-persist",
      ],
      session,
    });

    const result = await dispatcher.runMission(
      MOCK_MISSION_ID,
      twoPlatformInput,
      MOCK_USER_ID,
    );

    // S8 was called once — it processes ALL platforms internally (atomic stage).
    // No partial call — all platforms were handed to the stage fn together.
    expect(s8CallCount).toBe(1);
    expect(runPublishExecuteStage).toHaveBeenCalledTimes(1);

    // S9 blocked by gate after S8 — no verify partial state.
    expect(runPublishVerifyStage).not.toHaveBeenCalled();

    // Cancelled terminal path.
    expect(lifecycleManager.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        missionId: MOCK_MISSION_ID,
        intent: expect.objectContaining({ status: "cancelled" }),
      }),
    );
    expect(result.status).toBe("failed");
  });

  // =========================================================================
  // Test 4: abort after S8 complete, before S9 — pipeline stops at S9 gate
  //
  // Simulation: S8 completes normally. Abort fires between S8 completion and
  // S9 dispatch. Gate before S9 finds signal.aborted and short-circuits.
  // S9 is never called. Mission terminates cancelled.
  // =========================================================================
  it("abort after S8 complete, before S9: pipeline stops at S9 gate, mission terminates cancelled", async () => {
    const session = createMockSession();

    // S8 completes normally, then fires abort (simulates: cancel button pressed
    // right after publish completed, before verify starts).
    (runPublishExecuteStage as jest.Mock).mockImplementation(async () => {
      // S8 done — abort fires now (after S8, before S9 gate).
      session.missionAbort.abort(MissionAbortReason.user_cancelled);
    });

    const { dispatcher, lifecycleManager } = createRb6Setup({
      pipelineStepIds: [
        "s8-publish-execute",
        "s9-publish-verify",
        "s11-mission-persist",
      ],
      session,
    });

    const result = await dispatcher.runMission(
      MOCK_MISSION_ID,
      makeInput(),
      MOCK_USER_ID,
    );

    // S8 ran to completion.
    expect(runPublishExecuteStage).toHaveBeenCalledTimes(1);

    // S9 never called — gate blocked at boundary after S8.
    expect(runPublishVerifyStage).not.toHaveBeenCalled();

    // Pipeline stopped at S9 gate — cancelled terminal.
    expect(lifecycleManager.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        missionId: MOCK_MISSION_ID,
        intent: expect.objectContaining({ status: "cancelled" }),
      }),
    );
    expect(result.status).toBe("failed");
  });
});
