/**
 * PlaygroundBusinessOrchestrator —— Stage 1 / S1-1 拆分(2026-05-09)
 *
 * 从 PlaygroundPipelineDispatcher 抽出"业务编排"职责。本 service 持有:
 *
 *   - 业务字面量(STAGE_NUMBER / CHECKPOINT_AT / PRIMARY_HOOK_BY_PRIMITIVE 表)
 *   - 11 个 stage hook builders(buildSXxxHooks)
 *   - SessionEntry "view"(只读,通过 dispatcher 注入的 sessionLookup 拿)
 *   - buildStageInvariants / resolveTriggerType 等 stage script helper
 *
 * dispatcher(playground-pipeline-dispatcher.service.ts)留 runtime-glue 职责:
 * sessions Map / runMission 主入口 / withProgressTracking / hydrate inherited /
 * orphan cleanup / handleMissionFailure / fireSelfEvolutionPostlude 等。
 *
 * 关系:dispatcher inject business-orchestrator,在 onModuleInit 调
 * `bindSessionLookup` 把 sessions Map lookup 注入业务 service;hook closures 内通过
 * 此 lookup 访问 SessionEntry。**单向依赖**:dispatcher → business-orchestrator,
 * business-orchestrator 不引用 dispatcher 运行时类(只 type-import SessionEntry)。
 *
 * 详见:
 *   - docs/architecture/ai-app/playground/agent-team-boundary-audit-2026-05-08.md §7 S1-1
 *   - docs/architecture/ai-harness/facade/sediment-topology.md §4
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  runWithStageInstrumentation,
  BusinessTeamOrchestratorFramework,
  defineStageHooks,
  type BusinessTeamStageRunner,
  type ResolvedStageHooks,
  type StageRunArgs,
} from "@/modules/ai-harness/facade";
import { MissionStageBindingsService } from "./mission-stage-bindings.service";
import { narrate } from "../artifacts/narrative.util";
import { runBudgetEstimateStage } from "./stages/s1-mission-estimate-budget.stage";
import { runLeaderPlanStage } from "./stages/s2-leader-plan-mission.stage";
import { runResearcherDispatchStage } from "./stages/s3-researcher-collect-findings.stage";
import { runLeaderAssessResearchStage } from "./stages/s4-leader-assess-research.stage";
import { runReconcilerStage } from "./stages/s5-reconciler-cross-dim-fact-check.stage";
import { runAnalystStage } from "./stages/s6-analyst-synthesize-insights.stage";
import { runWriterOutlineStage } from "./stages/s7-writer-plan-outline.stage";
import { runWriterStage } from "./stages/s8-writer-draft-report.stage";
import { runSectionQualityEnhancementStage } from "./stages/s8b-section-quality-enhancement.stage";
import { runCriticStage } from "./stages/s9-reviewer-critic-l4.stage";
import { runReportObjectiveEvaluationStage } from "./stages/s9b-report-objective-evaluation.stage";
import { runLeaderForewordAndSignoffStage } from "./stages/s10-leader-foreword-and-signoff.stage";
import { runPersistStage } from "./stages/s11-mission-persist.stage";
import { MissionCheckpointService } from "@/modules/ai-harness/facade";
import { MissionStore } from "../lifecycle/mission-store.service";
import { PredictionCalibrationService } from "../calibration/prediction-calibration.service";
import type { MissionInvariants } from "../context/mission-context";
import type { SessionEntry } from "./playground.pipeline";

// stepId → DB stageNumber(与 legacy team.mission.ts 对齐)
// 用于 markStageComplete + missionCheckpoint.save 的进度索引
const STAGE_NUMBER: Record<string, number> = {
  "s1-budget": 1,
  "s2-leader-plan": 2,
  "s3-researcher-collect": 3,
  "s4-leader-assess": 4,
  "s5-reconciler": 5,
  "s6-analyst": 6,
  "s7-writer-outline": 7,
  "s8-writer": 8,
  "s8b-quality-enhancement": 8, // 同 s8(quality 增强)
  "s9-critic": 9,
  "s9b-objective-eval": 9,
  "s10-leader-foreword-signoff": 10,
  "s11-persist": 11,
  // s12 在 legacy 不入 stage 计数(fire-and-forget)
};

@Injectable()
export class PlaygroundBusinessOrchestrator extends BusinessTeamOrchestratorFramework<SessionEntry> {
  protected readonly log = new Logger(PlaygroundBusinessOrchestrator.name);

  // 暴露给 dispatcher 兼容旧 import（dispatcher 直接读 this.STAGE_NUMBER）
  readonly STAGE_NUMBER = STAGE_NUMBER;

  constructor(
    private readonly stageBindings: MissionStageBindingsService,
    private readonly missionCheckpoint: MissionCheckpointService,
    private readonly store: MissionStore,
    // ★ Foresight L3 (2026-05-29)：signed mission 的 foresight 留痕（校准闭环入口）
    private readonly predictionCalibration: PredictionCalibrationService,
  ) {
    super({ namespace: "playground", stageNumber: STAGE_NUMBER });
  }

  /** S3/S8 milestone 后 save checkpoint,让 pod 崩溃可 resume */
  readonly CHECKPOINT_AT: Record<string, string> = {
    "s2-leader-plan": "s2-leader-plan",
    "s3-researcher-collect": "s3-researcher-dispatch",
    "s8-writer": "s8-writer-draft",
  };

  /**
   * 每 primitive 的"主 hook"名 —— success-after-this 视为 stage 完成。
   * 助手 hook(extractPlanFields / parseDecision / scoreScaling 等同步)不包,
   * 否则会把同步函数变成 Promise,破坏 primitive 的同步消费链。
   */
  readonly PRIMARY_HOOK_BY_PRIMITIVE: Record<string, string> = {
    plan: "runRole",
    research: "perItemPipeline",
    assess: "runRole",
    synthesize: "synthesize",
    draft: "draftOnce",
    review: "review",
    signoff: "runRole",
    persist: "persist",
    learn: "postmortemClassifier",
  };

  /**
   * 主入口:为 stepId 构建 stage hooks(由 dispatcher.buildBaseHooksForStep 调用)。
   *
   * Override framework default —— playground 11 个 stage 各有定制 hook builder
   * （多 hook 模式:s2 同时 runRole+extractPlanFields, s3 同时 fanOut+perItemPipeline,
   *  s4 同时 runRole+parseDecision），不走 framework 的 single-runner adapter。
   */
  buildHooksForStep(stepId: string, _primitive: string): ResolvedStageHooks {
    if (stepId === "s1-budget") return this.buildS1BudgetHooks();
    if (stepId === "s2-leader-plan") return this.buildS2LeaderPlanHooks();
    if (stepId === "s3-researcher-collect")
      return this.buildS3ResearcherCollectHooks();
    if (stepId === "s4-leader-assess") return this.buildS4LeaderAssessHooks();
    if (stepId === "s5-reconciler") return this.buildS5ReconcilerHooks();
    if (stepId === "s6-analyst") return this.buildS6AnalystHooks();
    if (stepId === "s7-writer-outline") return this.buildS7WriterOutlineHooks();
    if (stepId === "s8-writer") return this.buildS8WriterHooks();
    if (
      stepId === "s8b-quality-enhancement" ||
      stepId === "s9-critic" ||
      stepId === "s9b-objective-eval"
    ) {
      return this.buildReviewHooks(stepId);
    }
    if (stepId === "s10-leader-foreword-signoff")
      return this.buildS10SignoffHooks();
    if (stepId === "s11-persist") return this.buildS11PersistHooks();
    throw new Error(
      `[playground-business-orch] no hook builder for step "${stepId}". ` +
        `All steps in PLAYGROUND_PIPELINE.steps must have an explicit branch above.`,
    );
  }

  /**
   * Framework 要求实现 resolveStageRunner（抽象方法）；playground 走自己的
   * buildHooksForStep 多 hook 模式，本方法在 playground 不会被 framework 默认
   * adapter 调用。返回 null 保持 framework "no runner" 语义自洽（万一 fallback
   * 到 default adapter 也能抛清晰错误）。
   */
  protected resolveStageRunner(
    _stepId: string,
  ): BusinessTeamStageRunner<SessionEntry> | null {
    return null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * 构造单 stage 用的 MissionContext invariants(每 stage 独立 ctx)。
   */
  private buildStageInvariants(entry: SessionEntry): MissionInvariants {
    return {
      missionId: entry.session.missionId,
      userId: entry.session.userId,
      input: entry.input,
      t0: entry.t0,
      billing: entry.session.billing,
      pool: entry.session.pool,
      leader: entry.leader,
      budgetMultiplier: entry.session.budgetMultiplier,
    };
  }

  /**
   * 从 entry.input 推导版本触发类型:
   *   inheritFromMissionId 存在 → 本次是 rerun;否则是 initial。
   *
   * public 让 dispatcher.handleMissionFailure 也能复用(saveReportVersion 失败路径)。
   */
  resolveTriggerType(entry: SessionEntry): string {
    return entry.input.inheritFromMissionId ? "rerun-fresh" : "initial";
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 11 个 stage hook builders(从 dispatcher 移过来,逻辑保持一致)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * s1-budget hook 实装(R2-A.3)
   *
   * persist primitive 期望 hooks.persist;s1 模式下"persist"行为是"预算闸门
   * + emit mission:started",调既有 runBudgetEstimateStage thin adapter。
   */
  private buildS1BudgetHooks(): ResolvedStageHooks {
    const hooks = {
      persist: async (args: {
        ctx: StageRunArgs["ctx"];
        previousOutputs: StageRunArgs["previousOutputs"];
        crossStageState: StageRunArgs["crossStageState"];
      }): Promise<void> => {
        const entry = this.getEntry(args.ctx.missionId);
        const invariants = this.buildStageInvariants(entry);
        const deps = this.stageBindings.buildDeps();
        await runBudgetEstimateStage(invariants, deps, entry.workspaceId);
      },
    };
    return defineStageHooks(hooks);
  }

  /**
   * s2-leader-plan hook 实装(R2-A.4)
   */
  private buildS2LeaderPlanHooks(): ResolvedStageHooks {
    const hooks = {
      runRole: async (args: { ctx: StageRunArgs["ctx"] }): Promise<unknown> => {
        const entry = this.getEntry(args.ctx.missionId);
        // ★ 2026-05-05 增量更新:runMission 已 hydrate entry.crossState.lastPlan from source mission;
        //   走 runWithStageInstrumentation 跳过 LLM 调用,保留所有 UI 关键事件
        if (entry.crossState.lastPlan && entry.input.inheritFromMissionId) {
          this.log.log(
            `[s2-leader-plan] inheriting from mission ${entry.input.inheritFromMissionId}, skip LLM`,
          );
          const inheritedPlan = entry.crossState.lastPlan;
          const sourceMissionId = entry.input.inheritFromMissionId;
          const deps = this.stageBindings.buildDeps();
          const result = await runWithStageInstrumentation(
            {
              missionId: entry.session.missionId,
              userId: entry.session.userId,
              pool: entry.session.pool,
            },
            deps,
            {
              eventPrefix: "playground",
              stageId: "s2-leader-plan",
              role: "leader",
              narrate,
              narrateThinking: `Leader 继承自 mission ${sourceMissionId.slice(0, 8)} 的研究方案(${inheritedPlan.dimensions.length} 个维度),跳过重新规划`,
              narrateSuccess: (out) =>
                `继承方案:${out.dimensions.length} 个维度(${out.dimensions
                  .map((d) => d.name)
                  .slice(0, 3)
                  .join(" / ")}${out.dimensions.length > 3 ? " 等" : ""})`,
              customMetrics: (out) => ({
                dimensions: out.dimensions,
                themeSummary: out.themeSummary,
                inherited: true,
                sourceMissionId,
              }),
              emitExtras: async (out) => {
                await deps
                  .emit({
                    type: "playground.leader:goals-set",
                    missionId: entry.session.missionId,
                    userId: entry.session.userId,
                    payload: {
                      goals: out.goals ?? [],
                      initialRisks: out.initialRisks ?? [],
                    },
                  })
                  .catch((err: unknown) => {
                    this.log.warn(
                      `[${entry.session.missionId}] emit leader:goals-set (rerun) failed: ${err instanceof Error ? err.message : String(err)}`,
                    );
                  });
              },
            },
            async () => ({
              themeSummary: inheritedPlan.themeSummary,
              dimensions: inheritedPlan.dimensions,
              goals: inheritedPlan.goals ?? [],
              initialRisks: inheritedPlan.initialRisks ?? [],
            }),
          );
          entry.crossState.lastPlan = inheritedPlan;
          return result;
        }
        const stageCtx = this.stageBindings.buildCtx({
          missionId: entry.session.missionId,
          userId: entry.session.userId,
          input: entry.input,
          t0: entry.t0,
          billing: entry.session.billing,
          pool: entry.session.pool,
          leader: entry.leader,
          budgetMultiplier: entry.session.budgetMultiplier,
        });
        await runLeaderPlanStage(stageCtx, this.stageBindings.buildDeps());
        if (!stageCtx.plan) {
          throw new Error(
            "[s2-leader-plan] stage returned without populating ctx.plan (unexpected)",
          );
        }
        entry.crossState.lastPlan = stageCtx.plan;
        return stageCtx.plan;
      },
      extractPlanFields: (raw: unknown) => {
        const plan = raw as
          | {
              dimensions?: ReadonlyArray<unknown>;
              goals?: unknown;
            }
          | undefined;
        return {
          dimensions: plan?.dimensions ?? [],
          goals: plan?.goals as ReadonlyArray<unknown> | undefined,
        };
      },
    };
    return defineStageHooks(hooks);
  }

  /**
   * s3-researcher-collect hook 实装(R2-A.5)
   */
  private buildS3ResearcherCollectHooks(): ResolvedStageHooks {
    const hooks = {
      fanOut: (_args: {
        ctx: StageRunArgs["ctx"];
        previousOutputs: StageRunArgs["previousOutputs"];
      }): ReadonlyArray<unknown> => {
        return [{ kind: "all-dimensions" }];
      },
      perItemPipeline: async (args: {
        item: unknown;
        role: StageRunArgs["role"];
        ctx: StageRunArgs["ctx"];
      }): Promise<unknown> => {
        const entry = this.getEntry(args.ctx.missionId);
        const cachedPlan = entry.crossState.lastPlan;
        if (!cachedPlan) {
          throw new Error(
            "[s3-researcher-collect] no plan from s2 (sessions[missionId].lastPlan undefined)",
          );
        }

        // ★ P0-D 完整版: rerun cache hit
        if (
          entry.crossState.inheritedResearchResults &&
          entry.crossState.inheritedResearchResults.length > 0
        ) {
          const inheritedByDim = new Map(
            entry.crossState.inheritedResearchResults.map((r) => [
              r.dimension,
              r,
            ]),
          );
          const reusedResults: typeof entry.crossState.inheritedResearchResults =
            [];
          const remainingDims: typeof cachedPlan.dimensions = [];
          for (const d of cachedPlan.dimensions) {
            const cached = inheritedByDim.get(d.name);
            if (cached) {
              reusedResults.push(cached);
            } else {
              remainingDims.push(d);
            }
          }
          this.log.log(
            `[s3-researcher-collect] cache hit: 复用 ${reusedResults.length}/${cachedPlan.dimensions.length} 个 dim 的 researcher 产物,剩余 ${remainingDims.length} 个走 fresh`,
          );
          const deps = this.stageBindings.buildDeps();
          const t0 = Date.now();
          for (const r of reusedResults) {
            await deps
              .emit({
                type: "playground.dimension:research:completed",
                missionId: entry.session.missionId,
                userId: entry.session.userId,
                payload: {
                  dimension: r.dimension,
                  state: "completed",
                  findingsCount: r.findings.length,
                  fromCache: true,
                },
              })
              .catch((err: unknown) => {
                this.log.warn(
                  `[${entry.session.missionId}] emit dimension:research:completed (cache) for "${r.dimension}" failed: ${err instanceof Error ? err.message : String(err)}`,
                );
              });
          }
          if (remainingDims.length > 0) {
            const stageCtx = this.stageBindings.buildCtx({
              missionId: entry.session.missionId,
              userId: entry.session.userId,
              input: entry.input,
              t0: entry.t0,
              billing: entry.session.billing,
              pool: entry.session.pool,
              leader: entry.leader,
              budgetMultiplier: entry.session.budgetMultiplier,
              plan: { ...cachedPlan, dimensions: remainingDims },
            });
            await runResearcherDispatchStage(stageCtx, deps);
            const freshResults = stageCtx.researcherResults ?? [];
            entry.crossState.lastResearcherResults = [
              ...reusedResults,
              ...freshResults,
            ];
            if (
              stageCtx.s4PatchFailures &&
              stageCtx.s4PatchFailures.length > 0
            ) {
              entry.crossState.s4PatchFailures = stageCtx.s4PatchFailures;
            }
          } else {
            entry.crossState.lastResearcherResults = reusedResults;
          }
          this.log.log(
            `[s3-researcher-collect] cache reuse 节省 ${Math.round((Date.now() - t0) / 1000)}s(cache 路径仅 emit synth events)`,
          );
          return entry.crossState.lastResearcherResults;
        }

        // ── 正常 fresh 路径 ──
        // ★ #37 (2026-05-23): check for s3PartialResults (dim-level crash-resume).
        //   If prior dims are already checkpointed, filter them out so only
        //   remaining dims are re-dispatched; merge partial results back afterwards.
        const partialResults = entry.crossState.s3PartialResults ?? {};
        const partialDimIds = new Set(Object.keys(partialResults));
        const pendingDims =
          partialDimIds.size > 0
            ? cachedPlan.dimensions.filter((d) => !partialDimIds.has(d.id))
            : cachedPlan.dimensions;

        if (partialDimIds.size > 0) {
          this.log.log(
            `[s3-researcher-collect] #37 dim-resume: skipping ${partialDimIds.size}/${cachedPlan.dimensions.length} already-done dims`,
          );
        }

        const effectivePlan =
          pendingDims.length < cachedPlan.dimensions.length
            ? { ...cachedPlan, dimensions: pendingDims }
            : cachedPlan;

        const stageCtx = this.stageBindings.buildCtx({
          missionId: entry.session.missionId,
          userId: entry.session.userId,
          input: entry.input,
          t0: entry.t0,
          billing: entry.session.billing,
          pool: entry.session.pool,
          leader: entry.leader,
          budgetMultiplier: entry.session.budgetMultiplier,
          plan: effectivePlan,
        });

        // ★ #37 (2026-05-23): build checkpointDimension — persists each dim result
        //   into crossState.s3PartialResults + saves a checkpoint for crash-resume.
        //   Fire-and-forget: save failure must never block the mission.
        const checkpointDimension = async (
          _cbMissionId: string,
          dimId: string,
          dimResult: unknown,
        ): Promise<void> => {
          const currentEntry = this.tryGetEntry(_cbMissionId);
          if (!currentEntry) return;
          const existing = currentEntry.crossState.s3PartialResults ?? {};
          currentEntry.crossState.s3PartialResults = {
            ...existing,
            [dimId]: dimResult,
          };
          await this.missionCheckpoint
            .save(
              _cbMissionId,
              {
                lastStage: "s3-researcher-collect",
                topic: currentEntry.input.topic,
                crossState: currentEntry.crossState.toJSON(),
              },
              Object.keys(this.STAGE_NUMBER).filter(
                (k) => (this.STAGE_NUMBER[k] ?? 0) < 3,
              ),
              "running",
            )
            .catch((err: unknown) => {
              // WS-DUR: per-dim checkpoint save 失败不再静默/不再冒泡阻塞研究 collect。
              // 结构化信号(checkpoint_write_failed)便于后续接 OTel/metric;丢一次 dim 级
              // checkpoint 只影响 crash-resume 粒度(回退到上一 milestone),不影响本次产出。
              this.log.warn(
                `checkpoint_write_failed op=save stage=s3-researcher-collect ` +
                  `missionId=${_cbMissionId} dim=${dimId} ` +
                  `error=${err instanceof Error ? err.message : String(err)}`,
              );
            });
        };

        const freshDeps = {
          ...this.stageBindings.buildDeps(),
          checkpointDimension,
        };
        await runResearcherDispatchStage(stageCtx, freshDeps as never);

        // ★ #37 (2026-05-23): merge cached partial results back in original dim order.
        //   freshResults are for pendingDims only; partialResults hold already-done dims.
        if (partialDimIds.size > 0) {
          const freshResults = stageCtx.researcherResults ?? [];
          const freshByDim = new Map(freshResults.map((r) => [r.dimension, r]));
          const merged = cachedPlan.dimensions.map((d) => {
            const cached = partialResults[d.id];
            if (cached) return cached as (typeof freshResults)[number];
            return freshByDim.get(d.name) ?? freshResults[0];
          });
          entry.crossState.lastResearcherResults = merged;
        } else {
          entry.crossState.lastResearcherResults = stageCtx.researcherResults;
        }
        if (stageCtx.s4PatchFailures && stageCtx.s4PatchFailures.length > 0) {
          entry.crossState.s4PatchFailures = stageCtx.s4PatchFailures;
        }
        // ★ P0-D 完整版: 持久化 baseline researcher 产物
        if (stageCtx.researcherResults) {
          for (const r of stageCtx.researcherResults) {
            await this.store
              .saveResearchResult({
                missionId: entry.session.missionId,
                dimension: r.dimension,
                findings: r.findings,
                summary: r.summary,
                state: r.findings.length === 0 ? "failed" : "completed",
              })
              .catch(async (err: unknown) => {
                const message =
                  err instanceof Error ? err.message : String(err);
                this.log.warn(
                  `[s3 saveResearchResult] dim=${r.dimension} failed: ${message}`,
                );
                await this.stageBindings
                  .buildDeps()
                  .markStageDegraded(
                    entry.session.missionId,
                    entry.session.userId,
                    "s3-researcher-collect",
                    `trajectory 持久化失败 (${r.dimension}):${message.slice(0, 200)}`,
                  )
                  .catch((err: unknown) => {
                    this.log.warn(
                      `[s3-hooks ${entry.session.missionId}] markStageDegraded (trajectory) failed: ${err instanceof Error ? err.message : String(err)}`,
                    );
                  });
              });
          }
        }
        // ★ P1-修1 (2026-05-06): S3 软失败上报 — evaluate against merged results
        //   (includes resumed dims) so the failure threshold reflects full mission.
        const allResults = entry.crossState.lastResearcherResults ?? [];
        const failedCount = allResults.filter(
          (r) => (r as { findings?: unknown[] }).findings?.length === 0,
        ).length;
        const totalCount = allResults.length;
        if (totalCount > 0 && failedCount === totalCount) {
          throw new Error(
            `S3-AllDimensionsFailed: ${totalCount}/${totalCount} dim 采集失败(无 findings 可用),mission 无法继续`,
          );
        }
        if (totalCount > 0 && failedCount * 2 > totalCount) {
          await this.stageBindings
            .buildDeps()
            .markStageDegraded(
              entry.session.missionId,
              entry.session.userId,
              "s3-researcher-collect",
              `S3 半数以上 dim 采集失败:${failedCount}/${totalCount}(mission 继续走退化路径)`,
            )
            .catch((err: unknown) => {
              this.log.warn(
                `[s3-hooks ${entry.session.missionId}] markStageDegraded (half-fail) failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            });
        }
        return entry.crossState.lastResearcherResults;
      },
    };
    return defineStageHooks(hooks);
  }

  /**
   * s4-leader-assess hook 实装(R2-A.6)
   */
  private buildS4LeaderAssessHooks(): ResolvedStageHooks {
    const hooks = {
      runRole: async (args: { ctx: StageRunArgs["ctx"] }): Promise<unknown> => {
        const entry = this.getEntry(args.ctx.missionId);
        if (!entry.crossState.lastPlan) {
          throw new Error("[s4-leader-assess] no plan from s2");
        }
        if (!entry.crossState.lastResearcherResults) {
          throw new Error("[s4-leader-assess] no researcherResults from s3");
        }
        const stageCtx = this.stageBindings.buildCtx({
          missionId: entry.session.missionId,
          userId: entry.session.userId,
          input: entry.input,
          t0: entry.t0,
          billing: entry.session.billing,
          pool: entry.session.pool,
          leader: entry.leader,
          budgetMultiplier: entry.session.budgetMultiplier,
          plan: entry.crossState.lastPlan,
          researcherResults: entry.crossState.lastResearcherResults,
          sharedState: { s4PatchFailures: entry.crossState.s4PatchFailures },
        });
        await runLeaderAssessResearchStage(
          stageCtx,
          this.stageBindings.buildDeps(),
        );
        entry.crossState.lastResearcherResults = stageCtx.researcherResults;
        entry.crossState.lastPlan = stageCtx.plan;
        if (stageCtx.s4PatchFailures && stageCtx.s4PatchFailures.length > 0) {
          entry.crossState.s4PatchFailures = stageCtx.s4PatchFailures;
        }
        return { ok: true };
      },
      parseDecision: (_raw: unknown): "continue" => {
        return "continue";
      },
    };
    return defineStageHooks(hooks);
  }

  /**
   * s5-reconciler hook 实装(R2-A.7)
   */
  private buildS5ReconcilerHooks(): ResolvedStageHooks {
    const hooks = {
      synthesize: async (args: {
        ctx: StageRunArgs["ctx"];
      }): Promise<unknown> => {
        const entry = this.getEntry(args.ctx.missionId);
        if (
          !entry.crossState.lastPlan ||
          !entry.crossState.lastResearcherResults
        ) {
          throw new Error(
            "[s5-reconciler] missing plan/researcherResults from prev stages",
          );
        }
        const stageCtx = this.stageBindings.buildCtx({
          missionId: entry.session.missionId,
          userId: entry.session.userId,
          input: entry.input,
          t0: entry.t0,
          billing: entry.session.billing,
          pool: entry.session.pool,
          leader: entry.leader,
          budgetMultiplier: entry.session.budgetMultiplier,
          plan: entry.crossState.lastPlan,
          researcherResults: entry.crossState.lastResearcherResults,
        });
        await runReconcilerStage(stageCtx, this.stageBindings.buildDeps());
        entry.crossState.lastReconciliationReport =
          stageCtx.reconciliationReport;
        return stageCtx.reconciliationReport;
      },
    };
    return defineStageHooks(hooks);
  }

  /**
   * s6-analyst hook 实装(R2-A.8)
   */
  private buildS6AnalystHooks(): ResolvedStageHooks {
    const hooks = {
      synthesize: async (args: {
        ctx: StageRunArgs["ctx"];
      }): Promise<unknown> => {
        const entry = this.getEntry(args.ctx.missionId);
        if (
          !entry.crossState.lastPlan ||
          !entry.crossState.lastResearcherResults
        ) {
          throw new Error(
            "[s6-analyst] missing plan/researcherResults from prev stages",
          );
        }
        const stageCtx = this.stageBindings.buildCtx({
          missionId: entry.session.missionId,
          userId: entry.session.userId,
          input: entry.input,
          t0: entry.t0,
          billing: entry.session.billing,
          pool: entry.session.pool,
          leader: entry.leader,
          budgetMultiplier: entry.session.budgetMultiplier,
          plan: entry.crossState.lastPlan,
          researcherResults: entry.crossState.lastResearcherResults,
          reconciliationReport: entry.crossState.lastReconciliationReport,
        });
        await runAnalystStage(stageCtx, this.stageBindings.buildDeps());
        entry.crossState.lastAnalystOutput = stageCtx.analystOutput;
        return stageCtx.analystOutput;
      },
    };
    return defineStageHooks(hooks);
  }

  /**
   * s7-writer-outline hook 实装(R2-A.9)
   */
  private buildS7WriterOutlineHooks(): ResolvedStageHooks {
    const hooks = {
      draftOnce: async (args: {
        ctx: StageRunArgs["ctx"];
      }): Promise<unknown> => {
        const entry = this.getEntry(args.ctx.missionId);
        const stageCtx = this.stageBindings.buildCtx({
          missionId: entry.session.missionId,
          userId: entry.session.userId,
          input: entry.input,
          t0: entry.t0,
          billing: entry.session.billing,
          pool: entry.session.pool,
          leader: entry.leader,
          budgetMultiplier: entry.session.budgetMultiplier,
          plan: entry.crossState.lastPlan,
          researcherResults: entry.crossState.lastResearcherResults,
          reconciliationReport: entry.crossState.lastReconciliationReport,
        });
        await runWriterOutlineStage(stageCtx, this.stageBindings.buildDeps());
        entry.crossState.lastOutlinePlan = stageCtx.outlinePlan;
        return stageCtx.outlinePlan ?? null;
      },
    };
    return defineStageHooks(hooks);
  }

  /**
   * s8-writer hook 实装(R2-A.10)—— 14 stage 中最大的(450+ 行业务逻辑)
   */
  private buildS8WriterHooks(): ResolvedStageHooks {
    const hooks = {
      draftOnce: async (args: {
        ctx: StageRunArgs["ctx"];
      }): Promise<unknown> => {
        const entry = this.getEntry(args.ctx.missionId);
        if (
          !entry.crossState.lastPlan ||
          !entry.crossState.lastResearcherResults
        ) {
          throw new Error("[s8-writer] missing plan/researcherResults");
        }
        const stageCtx = this.stageBindings.buildCtx({
          missionId: entry.session.missionId,
          userId: entry.session.userId,
          input: entry.input,
          t0: entry.t0,
          billing: entry.session.billing,
          pool: entry.session.pool,
          leader: entry.leader,
          budgetMultiplier: entry.session.budgetMultiplier,
          plan: entry.crossState.lastPlan,
          researcherResults: entry.crossState.lastResearcherResults,
          reconciliationReport: entry.crossState.lastReconciliationReport,
        });
        if (entry.crossState.lastOutlinePlan) {
          (stageCtx as { outlinePlan?: unknown }).outlinePlan =
            entry.crossState.lastOutlinePlan;
        }
        const analyst = (entry.crossState.lastAnalystOutput as
          | {
              insights?: unknown[];
              themeSummary?: string;
              contradictions?: unknown[];
              foresight?: unknown;
            }
          | undefined) ?? {
          insights: [],
          themeSummary: entry.crossState.lastPlan?.themeSummary ?? "",
        };
        await runWriterStage(
          stageCtx,
          this.stageBindings.buildDeps(),
          {
            insights: analyst.insights ?? [],
            themeSummary: analyst.themeSummary ?? "",
            contradictions: analyst.contradictions,
            // ★ Foresight L1：透传到 Outlook 章节 + 未来推演卡片
            foresight: (analyst as { foresight?: unknown }).foresight,
          },
          entry.workspaceId,
        );
        entry.crossState.lastReport = stageCtx.report;
        entry.crossState.lastReportArtifact = stageCtx.reportArtifact;
        entry.crossState.lastReviewScore = stageCtx.reviewScore;
        entry.crossState.lastVerifierVerdicts =
          stageCtx.verifierVerdicts as unknown[];
        return stageCtx.reportArtifact ?? stageCtx.report ?? null;
      },
    };
    return defineStageHooks(hooks);
  }

  /**
   * s8b/s9/s9b review hooks 实装(R2-A.11)—— 三个 review primitive stage
   */
  private buildReviewHooks(stepId: string): ResolvedStageHooks {
    const stageFn =
      stepId === "s8b-quality-enhancement"
        ? runSectionQualityEnhancementStage
        : stepId === "s9-critic"
          ? runCriticStage
          : runReportObjectiveEvaluationStage;
    const hooks = {
      review: async (args: { ctx: StageRunArgs["ctx"] }): Promise<unknown> => {
        const entry = this.getEntry(args.ctx.missionId);
        const stageCtx = this.stageBindings.buildCtx({
          missionId: entry.session.missionId,
          userId: entry.session.userId,
          input: entry.input,
          t0: entry.t0,
          billing: entry.session.billing,
          pool: entry.session.pool,
          leader: entry.leader,
          budgetMultiplier: entry.session.budgetMultiplier,
          plan: entry.crossState.lastPlan,
          researcherResults: entry.crossState.lastResearcherResults,
          reconciliationReport: entry.crossState.lastReconciliationReport,
          reportArtifact: entry.crossState.lastReportArtifact,
          report: entry.crossState.lastReport,
          reviewScore: entry.crossState.lastReviewScore,
          verifierVerdicts: entry.crossState.lastVerifierVerdicts,
        });
        await stageFn(stageCtx, this.stageBindings.buildDeps());
        entry.crossState.lastReportArtifact = stageCtx.reportArtifact;
        entry.crossState.lastReviewScore = stageCtx.reviewScore;
        return {
          score: stageCtx.reviewScore,
          verdict: stageCtx.reportArtifact?.quality,
        };
      },
    };
    return defineStageHooks(hooks);
  }

  /**
   * s10-leader-foreword-signoff hook 实装(R2-A.12)
   */
  private buildS10SignoffHooks(): ResolvedStageHooks {
    const hooks = {
      runRole: async (args: { ctx: StageRunArgs["ctx"] }): Promise<unknown> => {
        const entry = this.getEntry(args.ctx.missionId);
        const stageCtx = this.stageBindings.buildCtx({
          missionId: entry.session.missionId,
          userId: entry.session.userId,
          input: entry.input,
          t0: entry.t0,
          billing: entry.session.billing,
          pool: entry.session.pool,
          leader: entry.leader,
          budgetMultiplier: entry.session.budgetMultiplier,
          plan: entry.crossState.lastPlan,
          researcherResults: entry.crossState.lastResearcherResults,
          reconciliationReport: entry.crossState.lastReconciliationReport,
          reportArtifact: entry.crossState.lastReportArtifact,
          report: entry.crossState.lastReport,
          reviewScore: entry.crossState.lastReviewScore,
          verifierVerdicts: entry.crossState.lastVerifierVerdicts,
          sharedState: { s4PatchFailures: entry.crossState.s4PatchFailures },
        });
        await runLeaderForewordAndSignoffStage(
          stageCtx,
          this.stageBindings.buildDeps(),
        );
        entry.crossState.lastLeaderForeword = stageCtx.leaderForeword;
        entry.crossState.lastLeaderSignOff = stageCtx.leaderSignOff;
        return {
          foreword: stageCtx.leaderForeword,
          signoff: stageCtx.leaderSignOff,
        };
      },
    };
    return defineStageHooks(hooks);
  }

  /**
   * s11-persist hook 实装(R2-A.13)
   */
  private buildS11PersistHooks(): ResolvedStageHooks {
    const hooks = {
      persist: async (args: { ctx: StageRunArgs["ctx"] }): Promise<void> => {
        const entry = this.getEntry(args.ctx.missionId);
        const missionId = entry.session.missionId;
        await runPersistStage(
          {
            missionId,
            userId: entry.session.userId,
            t0: entry.t0,
            result: {
              report: entry.crossState.lastReport,
              reportArtifact: entry.crossState.lastReportArtifact as
                | {
                    metadata: { topic?: string; modelTrail?: string[] };
                    quickView?: {
                      executiveSummary?: { markdown?: string };
                    };
                    sections?: Array<{
                      title?: string;
                      startOffset: number;
                      endOffset: number;
                    }>;
                    content?: { fullMarkdown: string };
                  }
                | undefined,
              reviewScore: entry.crossState.lastReviewScore,
              themeSummary: entry.crossState.lastPlan?.themeSummary,
              dimensions: entry.crossState.lastPlan?.dimensions as
                | unknown[]
                | undefined,
              verdicts: entry.crossState.lastVerifierVerdicts,
              userProfile: entry.input,
              reconciliationReport: entry.crossState.lastReconciliationReport,
              leaderSignOff: entry.crossState.lastLeaderSignOff,
            },
            pool: entry.session.pool,
          },
          this.stageBindings.buildDeps(),
        );
        await this.missionCheckpoint.clear(missionId).catch((err: unknown) => {
          // WS-DUR: 结构化失败信号(checkpoint_write_failed)+ missionId,便于后续接 OTel/metric。
          // 保持 fire-and-forget:clear 失败不阻塞 s11 主流程(最坏遗留一条 stale checkpoint,
          // 由 resume 窗口/listResumable 兜底过滤)。
          this.log.warn(
            `checkpoint_write_failed op=clear stage=s11 ` +
              `missionId=${missionId} ` +
              `error=${err instanceof Error ? err.message : String(err)}`,
          );
        });
        const reportPayload =
          entry.crossState.lastReportArtifact ?? entry.crossState.lastReport;
        if (reportPayload) {
          await this.store
            .saveReportVersion({
              missionId,
              triggerType: this.resolveTriggerType(entry),
              report: reportPayload as {
                title?: string;
                summary?: string;
              },
              finalScore:
                entry.crossState.lastLeaderSignOff?.leaderOverallScore,
              leaderSigned: entry.crossState.lastLeaderSignOff?.signed,
            })
            .catch((err: unknown) => {
              this.log.warn(
                `[s11-persist] saveReportVersion for ${missionId} failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
              );
            });
        }
        // ★ Foresight L3 (2026-05-29)：signed mission 的 foresight.baseCase 留痕（校准闭环起点）。
        //   仅 signed 才记（未签字的判断质量不足以追踪）；非致命，失败不影响 persist。
        void this.recordForesightPredictions(entry, missionId);
      },
    };
    return defineStageHooks(hooks);
  }

  /**
   * 把 signed mission 的前瞻判断写入预测记录表（Foresight L3 校准闭环起点）。
   * fire-and-forget：失败只 log，不阻塞 persist 主流程。
   */
  private async recordForesightPredictions(
    entry: SessionEntry,
    missionId: string,
  ): Promise<void> {
    try {
      if (entry.crossState.lastLeaderSignOff?.signed !== true) return;
      const artifact = entry.crossState.lastReportArtifact as
        | {
            quickView?: {
              foresight?: {
                baseCase?: {
                  judgment: string;
                  probability: number;
                  confidence: "low" | "moderate" | "high";
                  horizon: "0-6m" | "6-18m" | "18m-3y" | "3y+";
                  resolutionCriteria: string;
                }[];
              };
            };
            metadata?: { topic?: string };
          }
        | undefined;
      const baseCase = artifact?.quickView?.foresight?.baseCase;
      if (!baseCase || baseCase.length === 0) return;
      await this.predictionCalibration.recordPredictions({
        missionId,
        userId: entry.session.userId,
        topic:
          artifact?.metadata?.topic ??
          entry.crossState.lastPlan?.themeSummary ??
          "",
        baseCase,
      });
    } catch (err) {
      this.log.warn(
        `[s11-persist ${missionId}] recordForesightPredictions failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
