/**
 * WritingPipelineDispatcher — WritingMission 编排入口（B4 dispatcher）
 *
 * 职责（mirror social-pipeline-dispatcher）：
 *   1. runMission(missionId, input, userId, projectId) 异步入口；与 execution.service
 *      fire-and-forget 对接（B5 切换后 WritingMissionExecutionService 改调此处）
 *   2. 复用 MissionRuntimeShellFramework.openSession（拿真实 BillingRuntimeEnvAdapter
 *      + MissionBudgetPool + AbortController + heartbeat + wallTimer）
 *   3. 走 MissionPipelineOrchestrator.run 执行 N-step pipeline（hooks 由
 *      WritingBusinessOrchestrator.buildHooksForStep 注入；hook 内通过 sessions Map
 *      取 WritingSessionEntry，delegate 到既有 stage free 函数）
 *   4. onEvent 桥接 orchestrator 生命周期事件到 EventBus（writing.stage:lifecycle
 *      / writing.stage:stalled / writing.stage:degraded）
 *   5. cleanup session（成功 / 失败都释放 heartbeat timer）
 *
 * 剥掉的 social 专属包袱：
 *   - inFlight dedup（writing 由 execution.service 上层去重）
 *   - SOCIAL_FAST_PIPELINE 双轨（writing 是 5 条 type pipeline）
 *   - fireSelfEvolutionPostlude（s12）
 *   - hydrateContentRaw / hydrateStewardInputs（social 专属装配）
 *
 * 迁移规格 §4（dispatcher 形态）：
 *   - extends BusinessTeamMissionDispatcherFramework implements OnModuleInit
 *   - SessionEntry = { session, t0, input, projectId, ctx, deps }（fat entry）
 *   - onModuleInit：bindSessionLookup + 5 条 pipeline 各 registry.register
 *   - runMission：openSession → 装 ctx+deps → orchestrator.run → finalize
 *   - onEvent 走 framework bridgeOrchestratorStageEvent（不自写 handler）
 */

import { Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  BusinessTeamMissionDispatcherFramework,
  EventBus,
  MissionPipelineOrchestrator,
  MissionPipelineRegistry,
  AgentRunner,
  MissionOwnershipRegistry,
  MissionLifecycleManager,
  MissionRuntimeShellFramework,
  type IMissionRuntimeAdapter,
  type MissionRuntimeSession,
  type MissionTerminalArbiter,
  MissionFailureCode,
  MissionAbortReason,
  mapAbortReasonToFailureCode,
} from "@/modules/ai-harness/facade";

// Role services
import { AgentInvoker } from "../roles/agent-invoker.service";
import { WriterService } from "../roles/writer.service";
import { BibleKeeperService } from "../roles/bible-keeper.service";
import { StoryArchitectService } from "../roles/story-architect.service";
import { ConsistencyService } from "../roles/consistency.service";
import { EditorService } from "../roles/editor.service";

// Pipeline config + business orchestrator
import { WritingBusinessOrchestrator } from "./writing-business-orchestrator.service";
import { WritingSessionEntry } from "./writing-business-orchestrator.service";

// Pipeline registry + config
import {
  selectWritingPipeline,
  WRITING_FULL_STORY_PIPELINE,
  WRITING_CHAPTER_PIPELINE,
  WRITING_OUTLINE_PIPELINE,
  WRITING_CONSISTENCY_PIPELINE,
  WRITING_EDIT_PIPELINE,
} from "../runtime/writing.config";
import type { MissionPipelineConfig } from "@/modules/ai-harness/facade";

// Store + projector
import { WritingMissionStoreService } from "../lifecycle/writing-mission-store.service";
import { WritingArtifactProjector } from "../projectors/writing-artifact.projector";

// Context + deps
import type { WritingMissionContext } from "../context/mission-context";
import type { WritingMissionDeps } from "../context/mission-deps";
import type { WritingMissionInput } from "../../services/mission/writing-mission.types";

// Domain services (needed to assemble WritingMissionDeps)
import { WorldBuildingEnhancerService } from "../../services/bible/world-building-enhancer.service";
import { StoryBibleService } from "../../services/bible/story-bible.service";
import { CharacterService } from "../../services/bible/character.service";
import { WorldSettingService } from "../../services/bible/world-setting.service";
import { WritingJsonParserService } from "../../services/mission/writing-json-parser.service";
import { WritingTextProcessorService } from "../../services/mission/writing-text-processor.service";
import { WritingContextService } from "../../services/mission/writing-context.service";
import { WritingPersistence } from "../../services/mission/writing-persistence.service";
import { ChapterDependencyService } from "../../services/parallel/chapter-dependency.service";
import { ParallelOrchestratorService } from "../../services/parallel/parallel-orchestrator.service";
import { WriterPoolService } from "../../services/parallel/writer-pool.service";
import { ExpressionMemoryService } from "../../services/quality/expression-memory.service";
import { OpeningHookService } from "../../services/quality/opening-hook.service";
import { NarrativeCraftService } from "../../services/quality/narrative-craft.service";
import { WritingQualityGateService } from "../../services/quality/quality-gate.service";
import { ChapterQualityEvaluatorService } from "../../services/quality/chapter-quality-evaluator.service";
import { StoryCompletionDetectorService } from "../../services/quality/story-completion-detector.service";
import { SemanticConsistencyService } from "../../services/quality/semantic-consistency.service";
import { FactExtractorService } from "../../services/consistency/fact-extractor.service";
import { ConsistencyEngineService } from "../../services/consistency/consistency-engine.service";

export interface WritingMissionSummary {
  readonly missionId: string;
  readonly status: "completed" | "failed" | "aborted";
  readonly error?: unknown;
}

/**
 * Internal map entry — stores the typed session separately so abort/cleanup
 * can access MissionRuntimeSession fields without a type cast.
 */
interface ActiveMissionEntry {
  readonly entry: WritingSessionEntry;
  readonly session: MissionRuntimeSession;
}

// Wall-time cap per missionType (ms)
const WALL_TIME_BY_TYPE: Record<string, number> = {
  full_story: 90 * 60_000, // 90 min
  chapter: 30 * 60_000, // 30 min
  outline: 20 * 60_000, // 20 min
  consistency_check: 20 * 60_000, // 20 min
  revision: 20 * 60_000,
  edit: 20 * 60_000,
};

// Max credits (writing budgets): generous defaults, stage s1 is the real gate
const MAX_CREDITS_BY_TYPE: Record<string, number> = {
  full_story: 1000,
  chapter: 300,
  outline: 200,
  consistency_check: 200,
  revision: 200,
  edit: 200,
};

@Injectable()
export class WritingPipelineDispatcher
  extends BusinessTeamMissionDispatcherFramework
  implements OnModuleInit
{
  private readonly sessions = new Map<string, ActiveMissionEntry>();

  constructor(
    // Framework orchestration
    private readonly registry: MissionPipelineRegistry,
    private readonly orchestrator: MissionPipelineOrchestrator,
    private readonly runtimeShell: MissionRuntimeShellFramework,
    private readonly businessOrch: WritingBusinessOrchestrator,
    // Store + projector
    private readonly store: WritingMissionStoreService,
    private readonly projector: WritingArtifactProjector,
    // Role services (5 writing roles)
    private readonly invoker: AgentInvoker,
    private readonly runner: AgentRunner,
    private readonly writer: WriterService,
    private readonly bibleKeeper: BibleKeeperService,
    private readonly storyArchitect: StoryArchitectService,
    private readonly consistencyChecker: ConsistencyService,
    private readonly editor: EditorService,
    // Lifecycle management
    private readonly lifecycleManager: MissionLifecycleManager,
    private readonly ownershipRegistry: MissionOwnershipRegistry,
    // Domain services
    private readonly worldBuildingEnhancer: WorldBuildingEnhancerService,
    private readonly storyBible: StoryBibleService,
    private readonly character: CharacterService,
    private readonly worldSetting: WorldSettingService,
    private readonly jsonParser: WritingJsonParserService,
    private readonly textProcessor: WritingTextProcessorService,
    private readonly context: WritingContextService,
    private readonly writingPersistence: WritingPersistence,
    private readonly chapterDependency: ChapterDependencyService,
    private readonly parallelOrchestrator: ParallelOrchestratorService,
    private readonly writerPool: WriterPoolService,
    private readonly expressionMemory: ExpressionMemoryService,
    private readonly openingHook: OpeningHookService,
    private readonly narrativeCraft: NarrativeCraftService,
    private readonly qualityGate: WritingQualityGateService,
    private readonly chapterQualityEvaluator: ChapterQualityEvaluatorService,
    private readonly storyCompletionDetector: StoryCompletionDetectorService,
    private readonly semanticConsistency: SemanticConsistencyService,
    private readonly factExtractor: FactExtractorService,
    private readonly consistencyEngine: ConsistencyEngineService,
    // DB
    private readonly prisma: PrismaService,
    // eventBus passed to framework super()
    eventBus: EventBus,
  ) {
    super(eventBus, {
      namespace: "writing",
      stageLifecycleEvent: "writing.stage:lifecycle",
      stageStalledEvent: "writing.stage:stalled",
      stageDegradedEvent: "writing.stage:degraded",
    });
  }

  onModuleInit(): void {
    // Bind session lookup so BusinessTeamOrchestratorFramework hooks can access ctx+deps
    this.businessOrch.bindSessionLookup((missionId) =>
      this.getEntry(missionId),
    );

    // Register all 5 writing pipelines
    const pipelines: MissionPipelineConfig[] = [
      WRITING_FULL_STORY_PIPELINE,
      WRITING_CHAPTER_PIPELINE,
      WRITING_OUTLINE_PIPELINE,
      WRITING_CONSISTENCY_PIPELINE,
      WRITING_EDIT_PIPELINE,
    ];
    for (const pipeline of pipelines) {
      if (!this.registry.has(pipeline.id)) {
        this.registry.register(this.buildPipelineWithHooks(pipeline));
        this.log.log(
          `[writing-pipeline] registered "${pipeline.id}" (${pipeline.steps.length} step)`,
        );
      }
    }
  }

  async runMission(
    missionId: string,
    input: WritingMissionInput,
    userId: string,
    projectId: string,
  ): Promise<WritingMissionSummary> {
    const t0 = Date.now();
    this.log.log(
      `[${missionId}] mission start; missionType=${input.missionType} projectId=${projectId}`,
    );

    // Register ownership so status/SSE endpoints can assert ownership
    this.ownershipRegistry.assign(missionId, userId);

    let session: MissionRuntimeSession | undefined;
    try {
      session = await this.runtimeShell.openSession({
        missionId,
        input,
        userId,
        workspaceId: projectId,
        adapter: this.buildAdapter(input),
      });

      // Assemble WritingMissionContext (invariants; phase fields all optional = not yet)
      const ctx: WritingMissionContext = {
        missionId,
        userId,
        input,
        t0,
        pool: session.pool,
        billing: session.billing,
        budgetMultiplier: session.budgetMultiplier,
        signal: session.missionAbort.signal,
      };

      // Assemble WritingMissionDeps (all real domain services)
      const deps = this.buildDeps();

      // Store entry so orchestrator hooks can access ctx+deps via bindSessionLookup
      const writingEntry: WritingSessionEntry = {
        session,
        t0,
        input,
        projectId,
        ctx,
        deps,
      };
      this.sessions.set(missionId, { entry: writingEntry, session });

      const sessionRef = session;
      const pipeline = selectWritingPipeline(input.missionType);
      this.log.log(
        `[${missionId}] pipeline=${pipeline.id} (${pipeline.steps.length} step)`,
      );

      return await this.runtimeShell.runWithinContext(
        session,
        "ai-writing",
        "team",
        async () => {
          const result = await this.orchestrator.run({
            missionId,
            pipelineId: pipeline.id,
            input,
            userId,
            tenantId: projectId,
            signal: sessionRef.missionAbort.signal,
            onEvent: async (event) => {
              await this.bridgeOrchestratorEvent(missionId, userId, event);
            },
          });

          if (result.status === "completed") {
            await this.lifecycleManager.finalize({
              missionId,
              intent: {
                status: "completed",
                extra: {
                  kind: "completed",
                  detail: { elapsedWallTimeMs: Date.now() - t0 },
                },
              },
              arbiter: this.buildArbiter(),
              onWon: async () => {
                await this.eventBus
                  .emit({
                    type: "writing.mission:completed",
                    scope: { missionId, userId },
                    payload: { wallTimeMs: Date.now() - t0 },
                    timestamp: Date.now(),
                  })
                  .catch(() => undefined);
              },
            });
          } else {
            const abortReason = sessionRef.missionAbort.signal.aborted
              ? (sessionRef.missionAbort.signal.reason as MissionAbortReason)
              : undefined;

            const isGenuineCancel =
              abortReason === MissionAbortReason.user_cancelled ||
              abortReason === MissionAbortReason.rerun_replacing_stale ||
              abortReason === MissionAbortReason.superseded;

            if (isGenuineCancel) {
              await this.lifecycleManager.finalize({
                missionId,
                intent: {
                  status: "cancelled",
                  reason: abortReason,
                  failureCode: MissionFailureCode.user_cancelled,
                  extra: {
                    kind: "cancelled",
                    reason: `aborted: ${abortReason}`,
                  },
                },
                arbiter: this.buildArbiter(),
                onWon: async () => {
                  await this.eventBus
                    .emit({
                      type: "writing.mission:cancelled",
                      scope: { missionId, userId },
                      payload: { reason: abortReason },
                      timestamp: Date.now(),
                    })
                    .catch(() => undefined);
                },
              });
            } else {
              await this.handleMissionFailure(
                missionId,
                userId,
                t0,
                result,
                abortReason,
              );
            }
          }

          return {
            missionId,
            status: result.status,
            error: result.error,
          };
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(`[${missionId}] mission threw: ${message}`);
      await this.lifecycleManager.finalize({
        missionId,
        intent: {
          status: "failed",
          failureCode: MissionFailureCode.runtime_crashed,
          errorMessage: message,
          extra: {
            kind: "failed",
            detail: {
              errorMessage: message,
              elapsedWallTimeMs: Date.now() - t0,
              failureCode: MissionFailureCode.runtime_crashed,
            },
          },
        },
        arbiter: this.buildArbiter(),
        onWon: async () => {
          await this.eventBus
            .emit({
              type: "writing.mission:failed",
              scope: { missionId, userId },
              payload: {
                message,
                failureCode: MissionFailureCode.runtime_crashed,
                wallTimeMs: Date.now() - t0,
              },
              timestamp: Date.now(),
            })
            .catch(() => undefined);
        },
      });
      return { missionId, status: "failed", error: err };
    } finally {
      if (session) {
        try {
          session.cleanup();
        } catch (cleanupErr) {
          this.log.error(
            `[${missionId}] session.cleanup threw: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
          );
        }
      }
      this.invoker.clearMissionRelayState(missionId);
      this.sessions.delete(missionId);
    }
  }

  getEntry(missionId: string): WritingSessionEntry {
    const active = this.sessions.get(missionId);
    if (!active) {
      throw new Error(
        `[writing-pipeline] no active session for mission ${missionId}`,
      );
    }
    return active.entry;
  }

  /**
   * Abort an in-flight mission (trigger abort signal).
   * Returns true if session found and abort triggered; false if not in-flight.
   */
  abortMission(missionId: string, reason = "user_cancelled"): boolean {
    const active = this.sessions.get(missionId);
    if (!active) return false;
    active.session.missionAbort.abort(reason);
    this.log.log(`[${missionId}] abort requested (reason=${reason})`);
    return true;
  }

  // ─── private ────────────────────────────────────────────────────────────

  private buildPipelineWithHooks(
    pipeline: MissionPipelineConfig,
  ): MissionPipelineConfig {
    const stepsWithHooks = pipeline.steps.map((s) => ({
      ...s,
      hooks: this.businessOrch.buildHooksForStep(s.id, s.primitive),
    }));
    return { ...pipeline, steps: stepsWithHooks };
  }

  private buildDeps(): WritingMissionDeps {
    const log = this.log;
    const invoker = this.invoker;
    const eventBus = this.eventBus;
    const store = this.store;

    return {
      // CommonDeps
      invoker,
      store,
      runner: this.runner,
      lifecycleManager: this.lifecycleManager,
      eventBus,
      log,
      emit: async (args) => {
        await eventBus
          .emit({
            type: args.type,
            scope: { missionId: args.missionId, userId: args.userId },
            payload: args.payload,
            agentId: args.agentId,
            traceId: args.traceId,
            timestamp: Date.now(),
          })
          .catch(() => undefined);
      },
      lifecycle: async (mid, uid, agentId, role, phase, detail) =>
        invoker.emitLifecycle(mid, uid, agentId, role, phase, detail),
      // WorldDeps
      bibleKeeper: this.bibleKeeper,
      worldBuildingEnhancer: this.worldBuildingEnhancer,
      jsonParser: this.jsonParser,
      storyBible: this.storyBible,
      character: this.character,
      worldSetting: this.worldSetting,
      // OutlineDeps
      storyArchitect: this.storyArchitect,
      textProcessor: this.textProcessor,
      writingPersistence: this.writingPersistence,
      // DraftDeps
      writer: this.writer,
      chapterDependency: this.chapterDependency,
      parallelOrchestrator: this.parallelOrchestrator,
      writerPool: this.writerPool,
      context: this.context,
      expressionMemory: this.expressionMemory,
      openingHook: this.openingHook,
      narrativeCraft: this.narrativeCraft,
      // ConsistencyDeps
      consistencyChecker: this.consistencyChecker,
      semanticConsistency: this.semanticConsistency,
      factExtractor: this.factExtractor,
      consistencyEngine: this.consistencyEngine,
      // EditDeps
      editor: this.editor,
      qualityGate: this.qualityGate,
      chapterQualityEvaluator: this.chapterQualityEvaluator,
      // QualityDeps (narrativeCraft + chapterQualityEvaluator + qualityGate shared with DraftDeps/EditDeps above)
      storyCompletionDetector: this.storyCompletionDetector,
      // PersistDeps
      projector: this.projector,
    };
  }

  private buildAdapter(
    _input: WritingMissionInput,
  ): IMissionRuntimeAdapter<WritingMissionInput> {
    const eventBus = this.eventBus;
    const prisma = this.prisma;
    return {
      eventNamespace: "writing",
      billingModuleType: "ai-writing",
      resolveWallTimeCapMs: (inp) =>
        WALL_TIME_BY_TYPE[inp.missionType] ?? 30 * 60_000,
      resolveMaxCredits: (inp) => MAX_CREDITS_BY_TYPE[inp.missionType] ?? 300,
      resolveBudgetMultiplier: (_inp) => 1.0,
      createMissionRow: async ({ missionId }) => {
        // Writing missions are already created before dispatcher is called (by coordinator).
        // Best-effort: mark status → IN_PROGRESS when dispatcher starts execution.
        await prisma.writingMission
          .updateMany({
            where: { id: missionId },
            data: { status: "IN_PROGRESS", startedAt: new Date() },
          })
          .catch(() => {
            // Best-effort: if the row doesn't exist, ignore
          });
      },
      refreshHeartbeat: async (missionId, _podId) => {
        await prisma.writingMission
          .updateMany({
            where: { id: missionId },
            data: { updatedAt: new Date() },
          })
          .catch(() => undefined);
      },
      emitMissionEvent: async ({ type, missionId, userId, payload }) => {
        await eventBus
          .emit({
            type,
            scope: { missionId, userId },
            payload,
            timestamp: Date.now(),
          })
          .catch(() => undefined);
      },
    };
  }

  /**
   * Bridge orchestrator stage-level events to EventBus.
   * Stage events (with stepId) → framework bridgeOrchestratorStageEvent.
   * mission:aborted → writing.mission:aborted (writing-specific payload).
   */
  private async bridgeOrchestratorEvent(
    missionId: string,
    userId: string,
    event: {
      type: string;
      stepId?: string;
      primitive?: string;
      output?: unknown;
      error?: unknown;
      elapsedMs?: number;
      reason?: string;
      timestamp: number;
    },
  ): Promise<void> {
    if (event.stepId) {
      await this.bridgeOrchestratorStageEvent(event, { missionId, userId });
      return;
    }
    if (event.type === "mission:aborted") {
      await this.emitToBus({
        type: "writing.mission:aborted",
        missionId,
        userId,
        payload: {
          reason: event.reason,
          wallTimeMs:
            Date.now() - (this.sessions.get(missionId)?.entry.t0 ?? Date.now()),
        },
        timestamp: event.timestamp,
      });
    }
  }

  /**
   * Build a MissionTerminalArbiter backed by WritingMission prisma table.
   * Uses conditional UPDATE WHERE status='running' so the first writer wins.
   */
  private buildArbiter(): MissionTerminalArbiter {
    const prisma = this.prisma;
    return {
      applyTerminalIfRunning: async (missionId, intent) => {
        // WritingMission.status enum: IN_PROGRESS | COMPLETED | FAILED | CANCELLED
        // Mission is "running" when status = IN_PROGRESS.
        const statusMap: Record<string, "COMPLETED" | "FAILED" | "CANCELLED"> =
          {
            completed: "COMPLETED",
            failed: "FAILED",
            cancelled: "CANCELLED",
          };
        const newStatus = statusMap[intent.status] ?? "FAILED";
        const result = await prisma.writingMission.updateMany({
          where: { id: missionId, status: "IN_PROGRESS" },
          data: { status: newStatus, updatedAt: new Date() },
        });
        return result.count > 0;
      },
    };
  }

  private async handleMissionFailure(
    missionId: string,
    userId: string,
    t0: number,
    result: { status: string; error?: unknown },
    abortReason?: MissionAbortReason,
  ): Promise<void> {
    const err = result.error;
    const message =
      err instanceof Error ? err.message : String(err ?? "unknown");
    const errName = err instanceof Error ? err.name : "Unknown";

    let failureCode: MissionFailureCode;
    if (abortReason != null) {
      failureCode = mapAbortReasonToFailureCode(abortReason);
    } else if (/timeout|timed out/i.test(message)) {
      failureCode = MissionFailureCode.wall_time_exceeded;
    } else if (/budget|exhaust/i.test(message)) {
      failureCode = MissionFailureCode.budget_exhausted;
    } else if (
      errName === "StageAbortError" ||
      /aborted|cancelled/i.test(message)
    ) {
      failureCode = MissionFailureCode.user_cancelled;
    } else {
      failureCode = MissionFailureCode.provider_error;
    }

    await this.lifecycleManager.finalize({
      missionId,
      intent: {
        status: "failed",
        reason: abortReason,
        failureCode,
        errorMessage: message,
        extra: {
          kind: "failed",
          detail: {
            errorMessage: message,
            elapsedWallTimeMs: Date.now() - t0,
            failureCode,
          },
        },
      },
      arbiter: this.buildArbiter(),
      onWon: async () => {
        await this.eventBus
          .emit({
            type: "writing.mission:failed",
            scope: { missionId, userId },
            payload: {
              message,
              failureCode,
              errorName: errName,
              wallTimeMs: Date.now() - t0,
            },
            timestamp: Date.now(),
          })
          .catch(() => undefined);
      },
    });
  }
}
