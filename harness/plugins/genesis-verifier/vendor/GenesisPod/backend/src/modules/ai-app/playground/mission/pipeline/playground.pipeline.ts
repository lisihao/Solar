/**
 * PlaygroundPipelineDispatcher —— v5.1 R2-A.1 / R2-A.3 新轨入口
 *
 * 职责：
 *   - 与 TeamMission 同签名（runMission(missionId, input, userId, workspaceId?)）
 *   - 复用 MissionRuntimeShellService.openSession（保持 billing / pool / abort
 *     / heartbeat / DB record / model+credit 校验完全一致）
 *   - 走 MissionPipelineOrchestrator 跑新轨 14 step（hooks 由本 service 通过
 *     buildPipelineWithHooks 注入闭包，闭包从 dispatcher session map 取 session
 *     上下文 + delegate 到 stage adapter）
 *   - cleanup session（成功 / 失败都释放 abort registry / heartbeat timer）
 *
 * 设计要点（与 writing-team service 一致 closure pattern）：
 *   - PLAYGROUND_PIPELINE 在 onModuleInit 注册一次 + hooks 闭包引用 this
 *   - per-mission session 存放在 sessions Map，hook 闭包通过 ctx.missionId 反查；
 *     mission 结束清掉 entry
 *   - 并发安全：每 mission 一个独立 session entry，hook 不共享状态
 *
 * R2-A 增量：
 *   - R2-A.1 (committed): scaffolding + module wiring + 14 step NotYetWired 占位
 *   - R2-A.3 (本 commit): s1-budget hook 实装 = thin adapter 调既有
 *                         runBudgetEstimateStage（其余 13 step 仍 NotYetWired）
 *   - R2-A.4 ~ R2-A.13: s2-s12 hook 逐 stage 实装
 */
import {
  Injectable,
  OnModuleInit,
  Optional,
  Inject,
  forwardRef,
} from "@nestjs/common";
import {
  BusinessTeamMissionDispatcherFramework,
  EventBus,
  MissionElectionTracker,
  MissionLifecycleManager,
  MissionPipelineOrchestrator,
  MissionPipelineRegistry,
  mapAgentFailureCode,
  type MissionPipelineConfig,
  type ResolvedStageHooks,
  type StageRunArgs,
} from "@/modules/ai-harness/facade";
import type { PlaygroundTerminalExtra } from "../lifecycle/mission-store.service";
import {
  MissionRuntimeShellService,
  type MissionRuntimeSession,
} from "./mission-runtime-shell.service";
import { MissionStageBindingsService } from "./mission-stage-bindings.service";
import { PLAYGROUND_PIPELINE } from "../../runtime/playground.config";
import { type RunMissionInput } from "../../api/dto/run-mission.dto";
// ★ Stage 1 / S1-1 (2026-05-09): 11 个 stage 函数 + narrate / runWithStageInstrumentation
//   + MissionInvariants 已随 stage hooks 移到 PlaygroundBusinessOrchestrator;dispatcher
//   只保留 runtime-glue 必要的 runSelfEvolutionStage (S12 fire-and-forget postlude)。
import { runSelfEvolutionStage } from "./stages/s12-self-evolution.stage";
import { MissionCheckpointService } from "@/modules/ai-harness/facade";
import { MissionFailedPreset } from "@/modules/platform/facade";
import { MissionEventBuffer } from "../lifecycle/mission-event-buffer.service";
import { MissionStore } from "../lifecycle/mission-store.service";
import { AgentInvoker, LeaderService, type SupervisedMission } from "../roles";
import { LeaderInvocationFactory } from "./leader-invocation.factory";
// ★ Stage 1 / S1-1 (2026-05-09): 业务编排已抽到独立 service —— dispatcher inject + delegate
import { PlaygroundBusinessOrchestrator } from "./playground-business-orchestrator.service";
// ★ R2-#38: OTel span emission (mission root + stage child spans via AgentTracer)
import { PlaygroundMissionSpanService } from "./playground-mission-span.service";
// ★ Stage 1 / S1-2 (2026-05-09,closes T3): cross-stage cache 改用 Z5 CrossStageState 容器
import { PlaygroundCrossStageState } from "./playground-cross-stage-state";
import { mapStepIdToFrontendStageId } from "../../api/contracts/step-id-mapping.contract";
// ★ P-DUR2 (2026-05-30): orphan boot 自动续跑 —— 认领赢家 + canResume 的 orphan 经
//   rerun orchestrator 以 incremental/inheritFromMissionId 续跑（复用 checkpoint）。
//   循环依赖（rerun orchestrator inject dispatcher）用 forwardRef 解。值导入只在
//   forwardRef 箭头闭包内引用，模块加载期不触发 require 循环求值。
import { MissionRerunOrchestratorService } from "../rerun/mission-rerun-orchestrator.service";

export interface PipelineMissionSummary {
  readonly missionId: string;
  readonly status: "completed" | "failed" | "aborted";
  readonly stageOutputs: Readonly<Record<string, unknown>>;
  readonly error?: unknown;
}

/**
 * Per-mission session 状态容器(runtime-glue).
 *
 * Stage 1 / S1-1(2026-05-09):interface 改为 export 让 PlaygroundBusinessOrchestrator
 * type-import,通过 dispatcher 注入的 sessionLookup 访问。详见 audit §7 S1-1。
 */
export interface SessionEntry {
  readonly session: MissionRuntimeSession;
  readonly t0: number;
  readonly input: RunMissionInput;
  readonly workspaceId?: string;
  /**
   * SupervisedMission —— Leader 容器（s2/s4/s10 全程在场）
   * 每 mission 一个，由 leaderService.create + buildLeaderInvocation 构造
   */
  readonly leader: SupervisedMission;
  /**
   * Stage 1 / S1-2 (2026-05-09,closes T3):跨 stage 缓存中间产物 + 共享状态 +
   * trajectory rerun cache 统一通过 PlaygroundCrossStageState 容器暴露
   * (内部 wrap Z5 CrossStageState)。
   *
   * 之前 14 个 ad-hoc fields(`lastPlan` / `lastResearcherResults` / ... /
   * `s4PatchFailures` / `inheritedResearchResults` / `inheritedChapters`)
   * 已迁移到此 typed container,保 in-memory 性能 + grep gate 转 green。
   */
  readonly crossState: PlaygroundCrossStageState;
}

@Injectable()
export class PlaygroundPipelineDispatcher
  extends BusinessTeamMissionDispatcherFramework
  implements OnModuleInit
{
  private readonly sessions = new Map<string, SessionEntry>();

  constructor(
    private readonly registry: MissionPipelineRegistry,
    private readonly orchestrator: MissionPipelineOrchestrator,
    private readonly runtimeShell: MissionRuntimeShellService,
    private readonly stageBindings: MissionStageBindingsService,
    private readonly leaderService: LeaderService,
    private readonly invoker: AgentInvoker,
    private readonly leaderInvocationFactory: LeaderInvocationFactory,
    // R2-A.13: s11/s12 hook 需要 missionCheckpoint.clear + eventBuffer.read
    private readonly missionCheckpoint: MissionCheckpointService,
    private readonly missionEventBuffer: MissionEventBuffer,
    // R2-A.13.1: 失败兜底需要 store.markFailed
    private readonly store: MissionStore,
    private readonly electionTracker: MissionElectionTracker,
    // ★ 2026-05-06 真治：dispatcher 之前 7 处直调 missionEventBuffer.broadcast() bypass
    //   eventBus → SocketBroadcastAdapter 拿不到事件 → 前端 stage:lifecycle / stage:stalled
    //   / stage:degraded / mission:execution-aborted / mission:postlude:* 全部不实时。
    //   现在统一走 eventBus.emit() —— buffer 仍作为 adapter 接收（playground.module.ts:165
    //   注册），同时 socket adapter 也分发 → 前端实时刷新。
    eventBus: EventBus,
    // ★ Stage 1 / S1-1 (2026-05-09): 业务编排(STAGE_NUMBER / CHECKPOINT_AT 字面量 +
    //   11 个 build*Hooks)已抽到独立 service。dispatcher 在 onModuleInit bind sessionLookup
    //   后,buildBaseHooksForStep 改为 delegate 到此 service。
    private readonly businessOrch: PlaygroundBusinessOrchestrator,
    // ★ C0/G1：唯一终态写入口。dispatcher 不再直写 store.markX，统一经 finalize 仲裁。
    private readonly lifecycleManager: MissionLifecycleManager,
    // ★ R2-#38: OTel span service (optional — gracefully absent if tracer not configured)
    private readonly missionSpan: PlaygroundMissionSpanService,
    // ★ e2e P0-#5: mission 失败通知（email + site）。@Optional — NotificationDispatcherModule
    //   未装配时优雅缺省（不发通知，不影响 mission 失败处理）。
    @Optional() private readonly missionFailedPreset?: MissionFailedPreset,
    // ★ P-DUR2 (2026-05-30): orphan boot 续跑编排器。forwardRef 解循环依赖
    //   （rerun orchestrator 构造期 inject 本 dispatcher）。@Optional 让缺省装配
    //   时（如裁剪测试床）优雅降级为"只 mark failed 不续跑"。
    @Optional()
    @Inject(forwardRef(() => MissionRerunOrchestratorService))
    private readonly rerunOrchestrator?: MissionRerunOrchestratorService,
  ) {
    // 2026-05-24 P4: framework 提供 emitToBus + bridgeOrchestratorStageEvent
    //   通用 mechanism；本 dispatcher 仅注入 playground 专属事件 type 字符串。
    super(eventBus, {
      namespace: "playground",
      stageLifecycleEvent: "playground.stage:lifecycle",
      stageStalledEvent: "playground.stage:stalled",
      stageDegradedEvent: "playground.stage:degraded",
      mapStepId: mapStepIdToFrontendStageId,
    });
  }

  // 2026-05-24 P4: emitToBus 已上提到 BusinessTeamMissionDispatcherFramework，
  //   本 dispatcher 通过继承直接复用（this.emitToBus(...)），不再本地定义。

  // ── Stage 1 / S1-1 (2026-05-09): STAGE_NUMBER / CHECKPOINT_AT / PRIMARY_HOOK_BY_PRIMITIVE
  //   已移到 PlaygroundBusinessOrchestrator(business 字面量)。withProgressTracking 通过
  //   this.businessOrch.STAGE_NUMBER 访问。

  /**
   * 把"主 hook"包一层进度跟踪：成功后 markStageComplete + 选择性 save
   * checkpoint。对齐 legacy team.mission.ts 的 markStageComplete 调用点。
   *
   * 助手 hook（如 extractPlanFields, parseDecision, scoreScaling）保持原样，
   * 因为 primitive 把它们当同步 / 类型严格的特定签名消费。
   */
  private withProgressTracking(
    stepId: string,
    stageHooks: ResolvedStageHooks,
  ): ResolvedStageHooks {
    // ★ Stage 1 / S1-1 (2026-05-09): STAGE_NUMBER / CHECKPOINT_AT / PRIMARY_HOOK_BY_PRIMITIVE
    //   是 business 字面量,在 PlaygroundBusinessOrchestrator 持有;mechanism(包 hook 加
    //   markStageComplete + checkpoint 保存)留 dispatcher 作 runtime-glue。
    const stageNumber = this.businessOrch.STAGE_NUMBER[stepId];
    const checkpointTag = this.businessOrch.CHECKPOINT_AT[stepId];

    // 找该 step 对应的 primitive，取主 hook 名
    const step = PLAYGROUND_PIPELINE.steps.find((s) => s.id === stepId);
    if (!step) return stageHooks;
    const primaryHookName =
      this.businessOrch.PRIMARY_HOOK_BY_PRIMITIVE[step.primitive];
    if (!primaryHookName) return stageHooks;
    const original = (stageHooks as Record<string, unknown>)[primaryHookName];
    if (typeof original !== "function") return stageHooks;

    const wrappedPrimary = async (args: unknown) => {
      const result = await (original as (a: unknown) => unknown)(args);
      // success path: write progress + checkpoint
      const ctx = (args as { ctx?: { missionId?: string } }).ctx;
      const missionId = ctx?.missionId;
      if (missionId && stageNumber != null) {
        await this.store
          .markStageComplete(missionId, stageNumber)
          .catch((err: unknown) => {
            this.log.warn(
              `[progress-tracking ${missionId}] markStageComplete(${stageNumber}) failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      }
      if (missionId && checkpointTag) {
        const entry = this.sessions.get(missionId);
        if (entry) {
          const completedKeys = Object.keys(
            this.businessOrch.STAGE_NUMBER,
          ).filter(
            (k) => this.businessOrch.STAGE_NUMBER[k] <= (stageNumber ?? 0),
          );
          // ★ R2-#37 (2026-05-23): include crossState snapshot so crash-resume
          //   can restore inter-stage data without re-running earlier stages.
          await this.missionCheckpoint
            .save(
              missionId,
              {
                lastStage: checkpointTag,
                topic: entry.input.topic,
                crossState: entry.crossState.toJSON(),
              },
              completedKeys,
              "running",
            )
            .catch((err: unknown) => {
              this.log.warn(
                `[progress-tracking ${missionId}] checkpoint.save(${checkpointTag}) failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
              );
            });
        }
      }
      return result;
    };

    return {
      ...stageHooks,
      [primaryHookName]: wrappedPrimary,
    } as unknown as ResolvedStageHooks;
  }

  onModuleInit(): void {
    // ★ Stage 1 / S1-1 (2026-05-09): bind sessionLookup 让 PlaygroundBusinessOrchestrator
    //   能通过 missionId 访问 SessionEntry。必须在 register pipeline 之前 bind,因为
    //   buildPipelineWithHooks → buildBaseHooksForStep → businessOrch.buildHooksForStep
    //   会创建 hook closures,closures 内部调 businessOrch.getEntry(missionId)。
    this.businessOrch.bindSessionLookup((missionId) =>
      this.getEntry(missionId),
    );
    if (this.registry.has(PLAYGROUND_PIPELINE.id)) return;
    this.registry.register(this.buildPipelineWithHooks());
    this.log.log(
      `[playground-pipeline] registered "${PLAYGROUND_PIPELINE.id}" (14 step / ALL WIRED ★ 试用就绪)`,
    );
    // ★ 2026-05-06 #88: pod restart 后扫 orphan running missions（hb_age > 5min
    //   = pod 失联标志），立即 mark failed 不让用户等 15min Liveness Guard。
    //   Liveness Guard 仍在跑作为兜底（处理 boot 后才死的 mission）。
    void this.cleanupOrphanRunningMissions();
  }

  /**
   * #88 (2026-05-06): pod restart 时 dispatcher 内存丢失所有 active session，
   * 但 DB 上 status='running' 不会自动改。本方法在 onModuleInit 扫描所有
   * heartbeat 已停 5+ min 的 'running' mission，立即 mark failed 并 emit
   * mission:failed event，用户体验从"等 15 min" → "boot 后 1s 即失败提示"。
   */
  private async cleanupOrphanRunningMissions(): Promise<void> {
    try {
      const orphanThresholdMs = 5 * 60 * 1000; // 5 min
      // ★ P-DUR2 (2026-05-30): 原子认领版 cleanup。多 pod 并发启动时，每个 orphan
      //   只被一个 pod 原子认领（claimOrphanFailed 条件写 count===1）。本 pod 只对
      //   **认领赢家**触发续跑，其它 pod count===0 跳过 → 消除重复 rerun（重复烧 credit）。
      const result =
        await this.store.cleanupOrphanRunningMissionsAtomic?.(
          orphanThresholdMs,
        );
      const orphans = result?.orphans ?? [];
      const claimedWinners = result?.claimedWinners ?? [];
      if (orphans.length === 0) {
        this.log.log("[#88 orphan-cleanup] no orphan running missions found");
        return;
      }
      this.log.warn(
        `[#88 orphan-cleanup] cleaned ${orphans.length} orphan running missions ` +
          `(heartbeat > ${Math.round(orphanThresholdMs / 60000)}min stale), ` +
          `claimed=${claimedWinners.length} (this pod)`,
      );
      // ★ 2026-06-11 (78 诉求"应该是继续任务")：后端重启后，**可恢复**的孤儿原地
      //   续跑（同 missionId + bump 版本，markReopened 发 mission:reopened），**不再
      //   先弹"失败"红条**。仅真正不可恢复（无 checkpoint）时才 emit mission:failed
      //   让用户手动重跑。
      for (const o of claimedWinners) {
        const resumed = await this.maybeResumeOrphan(o.id, o.userId);
        if (resumed) continue;
        await this.emitToBus({
          type: "playground.mission:failed",
          missionId: o.id,
          userId: o.userId,
          payload: {
            message:
              "Mission 在执行中遇到后端重启或异常退出，且无可恢复的进度快照。" +
              "建议在左侧操作区点「开始」重跑相同主题。",
            failureCode: "DISPATCHER_BOOT_ORPHAN_CLEANUP",
            source: "dispatcher-boot-orphan-cleanup",
          },
        });
      }
    } catch (err) {
      this.log.error(
        `[#88 orphan-cleanup] failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * ★ P-DUR2 (2026-05-30): 对本 pod 认领赢家的 orphan，若可恢复则触发 incremental
   * rerun（复用 checkpoint），否则仅记录"已 mark failed、不续跑"。
   *
   * - canResume()=false（无 checkpoint / 超出恢复窗口）→ 不续跑，只 log（用户手动重跑）。
   * - rerunOrchestrator 未装配（@Optional 缺省）→ 不续跑，只 log。
   * - 续跑失败不抛（fire-and-forget 语义在 orchestrator 内部），本层只 log。
   */
  private async maybeResumeOrphan(
    missionId: string,
    userId: string,
  ): Promise<boolean> {
    const resumable = await this.missionCheckpoint
      .canResume(missionId)
      .then((d) => d.canResume)
      .catch(() => false);
    if (!resumable || !this.rerunOrchestrator) {
      this.log.warn(
        `orphan_resume_skipped missionId=${missionId} ` +
          `resumable=${resumable} orchestrator=${this.rerunOrchestrator ? "present" : "absent"} ` +
          `action=user-manual-rerun`,
      );
      return false;
    }
    try {
      // ★ 2026-06-11 同-id：rerunFullMission 现在原地续跑（返回的 missionId === 源 id），
      //   不再分配新 id（createMissionRow 见已存在行走 markReopened 续命 + bump 版本）。
      await this.rerunOrchestrator.rerunFullMission(
        missionId,
        userId,
        "incremental",
      );
      this.log.warn(
        `orphan_resumed_in_place missionId=${missionId} ` +
          `mode=incremental reason=boot-orphan-claimed-winner`,
      );
      return true;
    } catch (err) {
      // legacy snapshot / guard 拒绝 / 配置缺失等 → 返回 false，调用方 emit failed 让用户手动重跑。
      this.log.warn(
        `orphan_resume_failed missionId=${missionId} ` +
          `reason="${err instanceof Error ? err.message : String(err)}" action=user-manual-rerun`,
      );
      return false;
    }
  }

  /** spec / hook 闭包用：取出指定 missionId 的活动 session（不存在抛错）*/
  getSession(missionId: string): MissionRuntimeSession {
    const entry = this.sessions.get(missionId);
    if (!entry) {
      throw new Error(
        `[playground-pipeline] no active session for mission ${missionId}`,
      );
    }
    return entry.session;
  }

  /**
   * 跑一次 mission（与 TeamMission.runMission 同签名）。
   *
   * 1. shell.openSession 起 billing / pool / abort / heartbeat
   * 2. orchestrator.run 跑 14 step（每 step 走 hook 闭包）
   * 3. cleanup session
   * 4. 返回最小快照
   */
  async runMission(
    missionId: string,
    input: RunMissionInput,
    userId: string,
    workspaceId?: string,
    /**
     * ★ R-CA (2026-05-05) 时序回调：mission row 已经 INSERT + session/ownership 装配完成、
     * orchestrator 长耗时 stages 启动之前，回调一次。
     * 用法：custom-agents.launch 在此回调里 await 写 launches 行，保证主调方 endpoint
     * 返回时 launches 行已就位（消除 mission row vs launches 写入时序窗口）。
     * 异常：本回调抛错只 log warn，不阻断 orchestrator（launches 写失败属可容忍 degrade）。
     */
    afterRowCreated?: () => Promise<void>,
  ): Promise<PipelineMissionSummary> {
    const t0 = Date.now();
    const session = await this.runtimeShell.openSession({
      missionId,
      input,
      userId,
      workspaceId,
    });
    // 创建 SupervisedMission（Leader 容器）—— 整 mission 复用，s2/s4/s10 都用它
    const leader = this.leaderService.create(
      missionId,
      userId,
      {
        topic: input.topic,
        description: input.description,
        depth: input.depth,
        language: input.language,
        userProfile: input,
      },
      this.leaderInvocationFactory.build(missionId, userId, session.billing),
    );
    // ★ R2-#38: start root OTel span for this mission
    this.missionSpan.startMissionSpan(missionId, input.topic);
    // ★ Stage 1 / S1-2 (2026-05-09): 初始化 PlaygroundCrossStageState 容器
    //   (替代 14 个 ad-hoc lastXxx / s4PatchFailures / inheritedX fields)
    this.sessions.set(missionId, {
      session,
      t0,
      input,
      workspaceId,
      leader,
      crossState: new PlaygroundCrossStageState(),
    });
    // ★ R-CA: row 已落 + session 已 register，但 stages 尚未跑 —— 给上层回调
    //   一个时机做"挂接关联"（launches.record 等）。回调失败仅 log，不影响 mission。
    if (afterRowCreated) {
      try {
        await afterRowCreated();
      } catch (err) {
        this.log.warn(
          `[runMission ${missionId}] afterRowCreated callback threw (non-fatal): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    // ★ R2-#37 (2026-05-23): crash-resume — if a checkpoint exists for this
    //   missionId (e.g. prior pod restart mid-run), restore crossState and
    //   resume from the last completed step instead of restarting from scratch.
    let resumeFromStepId: string | undefined;
    let initialCrossStageState: Readonly<Record<string, unknown>> | undefined;
    try {
      const resumeDecision = await this.missionCheckpoint.canResume(missionId);
      if (resumeDecision.canResume && resumeDecision.snapshot) {
        const snap = resumeDecision.snapshot;
        // completedKeys is an array of step IDs already finished; restore
        // crossState payload so downstream stages get their inputs back.
        const payload = snap.payload as {
          lastStage?: string;
          crossState?: Record<string, unknown>;
        };
        if (payload.crossState) {
          const entry = this.sessions.get(missionId);
          if (entry) {
            const restored = PlaygroundCrossStageState.fromJSON(
              payload.crossState,
            );
            // Replace the in-memory crossState on the session entry (immutable update)
            this.sessions.set(missionId, { ...entry, crossState: restored });
            initialCrossStageState = payload.crossState;
          }
        }
        // The last completed step is the highest-stageNumber key in completedKeys
        if (snap.completedKeys.length > 0) {
          const stageNumber = this.businessOrch.STAGE_NUMBER;
          const sorted = [...snap.completedKeys].sort(
            (a, b) => (stageNumber[a] ?? 0) - (stageNumber[b] ?? 0),
          );
          resumeFromStepId = sorted[sorted.length - 1];
        }
        this.log.log(
          `[R2-#37 crash-resume] mission ${missionId} resuming from stepId="${resumeFromStepId}" (${snap.completedKeys.length} completed steps)`,
        );
      }
    } catch (resumeErr) {
      // Non-fatal: if resume load fails just start fresh
      this.log.warn(
        `[R2-#37 crash-resume] mission ${missionId} checkpoint load failed (will start fresh): ${resumeErr instanceof Error ? resumeErr.message : String(resumeErr)}`,
      );
    }

    // ★ 2026-05-05 增量更新："更新"按钮 → input.inheritFromMissionId 携带源 mission；
    //   从源 mission DB row hydrate plan（dimensions+themeSummary）到 entry.crossState.lastPlan，
    //   下游 S2 hook 检测到 lastPlan 已就绪即跳过 LLM 调用并 emit synthetic plan event。
    if (input.inheritFromMissionId) {
      await this.hydrateInheritedPlan(
        missionId,
        userId,
        input.inheritFromMissionId,
      );
      // ★ P0-D 完整版 (2026-05-06): trajectory 持久化让 rerun 真正复用 S3 + 章节产物，
      //   "更新"按钮跳过 S3 35min 重做 + S5+ 章节重写，直达 S10 signoff。
      await this.hydrateInheritedResearchResults(
        missionId,
        input.inheritFromMissionId,
      );
      await this.hydrateInheritedChapterDrafts(
        missionId,
        input.inheritFromMissionId,
      );
    }
    // ★ 2026-05-06 (A-8): 终态守门 — 任何 unexpected throw / pod kill / OOM 后
    //   finally 检查 mission 是否走完正常 markCompleted/markFailed 路径，否则
    //   emit mission:execution-aborted + markFailed 兜底。覆盖：
    //     · runtimeShell.runWithinContext throw（withUserContext / BillingContext 异常）
    //     · orchestrator.run throw 但 handleMissionFailure 自己又 throw
    //     · process.exit() / SIGTERM 导致 finally 也跑不全（这种由 liveness-guard 兜底）
    let reachedTerminal = false;
    try {
      return await this.runtimeShell.runWithinContext(session, async () => {
        const result = await this.orchestrator.run({
          missionId,
          pipelineId: PLAYGROUND_PIPELINE.id,
          input,
          userId,
          tenantId: workspaceId,
          signal: session.missionAbort.signal,
          // ★ R2-#37 (2026-05-23): crash-resume — pass resume context when
          //   a prior checkpoint was found and restored above.
          resumeFromStepId,
          initialCrossStageState,
          // ★ 2026-05-06 (A 架构优化): orchestrator 已内置 stage:started/completed/failed
          //   事件机制，但之前 dispatcher 没传 onEvent → 全部丢弃，导致 stage 文件
          //   被迫各自手写 emit stage:started/completed（5 个文件还漏发）。
          //   现在桥接：orchestrator 主导 lifecycle 信号 (playground.stage:lifecycle)，
          //   stage 文件保留的 stage:completed 仅作 metrics 携带 custom payload (artifacts)。
          //   workflow 控制权回归 harness/orchestrator，漏 emit 物理上不可能。
          onEvent: async (event) => {
            if (!event.stepId) return;
            // ── R2-#38: emit OTel stage spans (playground 业务专属，必须在桥接前) ──
            // ★ 2026-05-06 单轨化彻底版: orchestrator stage:completed 携带 hook 返回的
            //   output（业务产物），dispatcher 把 output 拍平到 lifecycle payload；
            //   stage 文件不再 emit stage:metrics（双轨彻底删除）。前端只看 lifecycle。
            if (event.type === "stage:started") {
              this.missionSpan.startStageSpan(
                missionId,
                event.stepId,
                event.primitive ?? "unknown",
              );
            } else if (
              event.type === "stage:completed" ||
              event.type === "stage:failed"
            ) {
              this.missionSpan.endStageSpan(
                missionId,
                event.stepId,
                event.type === "stage:completed" ? "completed" : "failed",
                event.error instanceof Error ? event.error : undefined,
              );
            }
            // 2026-05-24 P4: stage:lifecycle / stage:stalled / stage:degraded 桥接
            //   走 framework 通用 mechanism；framework return true 表示已接管。
            await this.bridgeOrchestratorStageEvent(event, {
              missionId,
              userId,
            });
          },
        });
        // ★ R2-A.13.1 失败兜底：orchestrator 返 status=failed/aborted 时，
        //   补齐 legacy team.mission.ts 的 mission:failed event + markFailed 行为
        //   （pipeline-v1 hook 内部抛错经 orchestrator 包成 stage:failed event +
        //    result.status="failed"，但 mission DB row + 前端事件流缺收尾兜底）
        if (result.status !== "completed") {
          // ★ R2-#38: end root OTel span with failure status
          this.missionSpan.endMissionSpan(
            missionId,
            result.status as "failed" | "aborted",
            result.error instanceof Error ? result.error : undefined,
          );
          await this.handleMissionFailure(
            missionId,
            userId,
            t0,
            result,
            session,
          );
        } else {
          // ★ R2-#38: end root OTel span with success
          this.missionSpan.endMissionSpan(missionId, "completed");
          // ★ R2-A.13.1 成功路径：清 checkpoint（mission 已完整落库）
          await this.missionCheckpoint
            .clear(missionId)
            .catch((err: unknown) => {
              this.log.warn(
                `[dispatcher ${missionId}] checkpoint.clear (success path) failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
              );
            });
        }
        // ★ A-7: S12 self-evolution fire-and-forget（成功 / 失败路径都跑）
        //   不阻塞 dispatcher 返回；emit mission:postlude:* 让前端单独推 s12 todo 状态
        this.fireSelfEvolutionPostlude(missionId, userId);
        reachedTerminal = true;
        return {
          missionId: result.missionId,
          status: result.status,
          stageOutputs: result.stageOutputs,
          error: result.error,
        };
      });
    } catch (err) {
      // ★ A-8: orchestrator/runtimeShell 抛出未被 handleMissionFailure 接住的异常
      // ★ R2-#38: end root OTel span on unexpected throw
      this.missionSpan.endMissionSpan(
        missionId,
        "failed",
        err instanceof Error ? err : undefined,
      );
      reachedTerminal = await this.tryHandleAbort(
        missionId,
        userId,
        t0,
        err,
        session,
        "execution_threw",
      );
      throw err;
    } finally {
      // ★ A-8: 最后一道闸 — finally 仍未达终态（极端：catch 里 markFailed 也 throw）
      //   尝试兜底 emit mission:execution-aborted（不写 DB 避免再 throw）
      if (!reachedTerminal) {
        await this.emitToBus({
          type: "playground.mission:execution-aborted",
          missionId,
          userId,
          payload: {
            reason: "runtime_unknown_state",
            podId:
              process.env.RAILWAY_REPLICA_ID ?? process.env.HOSTNAME ?? "local",
            wallTimeMs: Date.now() - t0,
          },
        });
      }
      // ★ 全覆盖审计修 (2026-05-06): 先 cleanup 再 delete — cleanup throw 时 entry 不会已删
      try {
        session.cleanup();
      } catch (cleanupErr) {
        this.log.error(
          `[runMission ${missionId}] session.cleanup() threw: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
        );
      }
      // ★ P0-1 (2026-05-06): relay exhaustedMissions cleanup —— short mission 不 leak Map 条目
      this.invoker.clearMissionRelayState(missionId);
      this.sessions.delete(missionId);
      this.electionTracker.clear(missionId);
    }
  }

  /**
   * A-7: S12 self-evolution fire-and-forget。
   *
   * mission terminal（成功/失败）后立即返回 dispatcher，本方法在后台跑 postmortem
   * + memory 索引。生命周期事件不走 stage:lifecycle（避免与 mission stages 混淆），
   * 而是 mission:postlude:started / mission:postlude:completed / mission:postlude:failed。
   */
  private fireSelfEvolutionPostlude(missionId: string, userId: string): void {
    const entry = this.sessions.get(missionId);
    if (!entry) {
      this.log.warn(
        `[A-7] fireSelfEvolutionPostlude: no session for ${missionId}`,
      );
      return;
    }
    const startedAt = Date.now();
    void this.emitToBus({
      type: "playground.mission:postlude:started",
      missionId,
      userId,
      payload: { stage: "s12-self-evolution", startedAt },
      timestamp: startedAt,
    });

    const bufferedEvents = this.missionEventBuffer
      .read(missionId)
      .map((e) => ({ type: e.type, ts: e.timestamp, payload: e.payload }));

    void runSelfEvolutionStage(
      {
        missionId,
        userId,
        t0: entry.t0,
        pool: entry.session.pool,
        topic: entry.input.topic,
        plan: entry.crossState.lastPlan
          ? {
              dimensions: (entry.crossState.lastPlan.dimensions ??
                []) as unknown[],
              goals: entry.crossState.lastPlan.goals,
            }
          : undefined,
        researcherResults: entry.crossState.lastResearcherResults as
          | unknown[]
          | undefined,
        reportArtifact: entry.crossState.lastReportArtifact as
          | { quality?: { overall?: number }; sections?: unknown[] }
          | undefined,
        leaderSignOff: entry.crossState.lastLeaderSignOff,
        abortSignal: entry.session.missionAbort.signal,
        bufferedEvents,
      },
      this.stageBindings.buildDeps(),
    )
      .then(() =>
        this.emitToBus({
          type: "playground.mission:postlude:completed",
          missionId,
          userId,
          payload: {
            stage: "s12-self-evolution",
            wallTimeMs: Date.now() - startedAt,
          },
        }),
      )
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        return this.emitToBus({
          type: "playground.mission:postlude:failed",
          missionId,
          userId,
          payload: {
            stage: "s12-self-evolution",
            error: message.slice(0, 500),
            wallTimeMs: Date.now() - startedAt,
          },
        });
      });
  }

  /** A-8: 兜底 abort 处理 — emit mission:execution-aborted + markFailed */
  private async tryHandleAbort(
    missionId: string,
    userId: string,
    t0: number,
    err: unknown,
    session: MissionRuntimeSession,
    reason: string,
  ): Promise<boolean> {
    try {
      const message = err instanceof Error ? err.message : String(err);
      const snap = session.pool.snapshot();
      await this.emitToBus({
        type: "playground.mission:execution-aborted",
        missionId,
        userId,
        payload: {
          reason,
          error: message,
          wallTimeMs: Date.now() - t0,
          podId:
            process.env.RAILWAY_REPLICA_ID ?? process.env.HOSTNAME ?? "local",
        },
      });
      await this.lifecycleManager
        .finalize<PlaygroundTerminalExtra>({
          missionId,
          intent: {
            status: "failed",
            extra: {
              kind: "failed",
              detail: {
                errorMessage: `execution_aborted: ${message.slice(0, 500)}`,
                tokensUsed: snap.poolTokensUsed,
                costUsd: snap.poolCostUsd,
                elapsedWallTimeMs: Date.now() - t0,
              },
            },
          },
          arbiter: this.store,
        })
        .catch((dbErr: unknown) => {
          this.log.warn(
            `[A-8 ${missionId}] finalize after execution-aborted failed: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
          );
        });
      return true;
    } catch (innerErr) {
      this.log.warn(
        `[A-8] tryHandleAbort failed for ${missionId}: ${innerErr instanceof Error ? innerErr.message : String(innerErr)}`,
      );
      return false;
    }
  }

  /**
   * R2-A.13.1 失败兜底（与 legacy team.mission.ts:265-340 等价）：
   *   1. 检测 cancel（abort signal / cancelled message）→ 不发 mission:failed，
   *      让 controller.cancelMission 已 emit 的 mission:cancelled 接管
   *   2. 分类 failureCode（ORCH_CREDIT_INSUFFICIENT / PROVIDER_BYOK_MODEL_NOT_FOUND
   *      / RUNNER_INPUT_SCHEMA_MISMATCH / RUNNER_WALL_TIME_EXCEEDED /
   *      PROVIDER_RATE_LIMIT / PROVIDER_API_ERROR）
   *   3. emit mission:failed event 含完整 payload（tokensUsed/costUsd/wallTimeMs/
   *      diagnostic.errorStack）
   *   4. store.markFailed 写 partial 产物（reportArtifact / leaderSignOff /
   *      themeSummary 等）让用户能看到部分结果
   */
  private async handleMissionFailure(
    missionId: string,
    userId: string,
    t0: number,
    result: { error?: unknown; status: string },
    session: MissionRuntimeSession,
  ): Promise<void> {
    const err = result.error;
    // ★ P0-7 (audit 2026-05-06): err 是非 Error 对象时 String(err) 返回 "[object Object]"
    //   让 UI 显示无意义文案。改用 JSON.stringify 兜底，让用户能定位真因。
    const message = (() => {
      if (err instanceof Error) return err.message;
      if (err && typeof err === "object") {
        try {
          return JSON.stringify(err, null, 2).slice(0, 2000);
        } catch {
          return String(err);
        }
      }
      return String(err);
    })();
    const errName = err instanceof Error ? err.name : "Unknown";
    const snap = session.pool.snapshot();

    // ★ 2026-05-22 真治：abort 必须按 signal.reason 区分"用户主动取消"与"系统级中止"。
    //   abort-registry.abort(missionId, reason) 已把 reason 透传进 signal.reason：
    //     · "user_cancelled"             → controller.cancelMission 已 emit mission:cancelled，跳过 mission:failed
    //     · "budget_exhausted"           → 预算耗尽，必须 emit mission:failed(failureCode=BUDGET_EXHAUSTED)
    //     · "mission_wall_time_exceeded" → 墙钟超时，emit mission:failed(failureCode=RUNNER_WALL_TIME_EXCEEDED)
    //   旧逻辑只看 signal.aborted（任何 abort 都为 true）→ 把 budget/超时也当成用户取消 →
    //   skip mission:failed + 不 markFailed → DB 卡 running → liveness guard 15min 后才用
    //   "pod 重启/失联" 误导文案兜底（撒谎错误 + 延迟 15min）。
    const abortReason =
      session.missionAbort.signal.aborted &&
      typeof session.missionAbort.signal.reason === "string"
        ? session.missionAbort.signal.reason
        : "";
    // controller.cancelMission 一定调 abortRegistry.abort(missionId, "user_cancelled")，
    //   故 signal.reason 是用户取消的权威判据；不再用脆弱的 message 正则（误报会静默吞失败）。
    const wasUserCancelled = abortReason === "user_cancelled";
    if (wasUserCancelled) {
      // mission:cancelled 已由 controller.cancelMission emit；这里不补 mission:failed
      this.log.log(
        `[pipeline-v1] mission ${missionId} user-cancelled — skipping mission:failed (mission:cancelled 已 emit)`,
      );
      return;
    }

    let missionFailureCode = "UNKNOWN";
    if (
      abortReason === "budget_exhausted" ||
      /budget.?exhausted/i.test(message)
    ) {
      missionFailureCode = "BUDGET_EXHAUSTED";
    } else if (
      abortReason === "mission_wall_time_exceeded" ||
      /timeout|timed out|wall.?time/i.test(message)
    ) {
      missionFailureCode = "RUNNER_WALL_TIME_EXCEEDED";
    } else if (
      errName === "InsufficientCreditsException" ||
      /credit|余额不足|insufficient/i.test(message)
    ) {
      missionFailureCode = "ORCH_CREDIT_INSUFFICIENT";
    } else if (
      // ★ 2026-05-30：BYOK 密钥额度/配额耗尽（"Payment required - quota exceeded" /
      //   QUOTA_EXCEEDED / PROVIDER_QUOTA_EXCEEDED）此前掉进兜底 PROVIDER_API_ERROR，
      //   只显示裸英文，用户看不懂"为什么停了"。单列出来给可操作中文文案。
      /quota.?exceeded|payment required|QUOTA_EXCEEDED|配额|额度耗尽/i.test(
        message,
      )
    ) {
      missionFailureCode = "PROVIDER_QUOTA_EXCEEDED";
    } else if (errName === "ByokRequiredError") {
      missionFailureCode = "PROVIDER_BYOK_MODEL_NOT_FOUND";
    } else if (
      errName === "InputValidationError" ||
      errName === "DefineAgentMissingError"
    ) {
      missionFailureCode = "RUNNER_INPUT_SCHEMA_MISMATCH";
    } else if (/rate.?limit|429/i.test(message)) {
      missionFailureCode = "PROVIDER_RATE_LIMIT";
    } else {
      missionFailureCode = "PROVIDER_API_ERROR";
    }

    // ★ 预算/超时/额度类失败给用户可操作的中文文案（替代裸 abort message）
    const displayMessage =
      missionFailureCode === "BUDGET_EXHAUSTED"
        ? `预算已耗尽（已用约 ${Math.round(snap.poolTokensUsed / 1000)}k tokens / $${snap.poolCostUsd.toFixed(2)}）。请在「Mission 设置」提高 Credits 上限后重跑。`
        : missionFailureCode === "RUNNER_WALL_TIME_EXCEEDED"
          ? "运行超过墙钟时限被中止。请在「Mission 设置」提高时间上限后重跑。"
          : missionFailureCode === "PROVIDER_QUOTA_EXCEEDED" ||
              missionFailureCode === "ORCH_CREDIT_INSUFFICIENT"
            ? `调用模型时密钥额度/配额已耗尽（${message.slice(0, 160)}）。请为对应 Provider 充值，或在「Mission 设置」切换到有额度的模型 / 启用平台额度后重跑。`
            : missionFailureCode === "PROVIDER_RATE_LIMIT"
              ? `模型调用触发限流（${message.slice(0, 160)}）。请稍后重跑，或在「Mission 设置」切换到更高额度档的模型。`
              : message;

    await this.invoker
      .emitEvent({
        type: "playground.mission:failed",
        missionId,
        userId,
        payload: {
          message: displayMessage,
          failureCode: missionFailureCode,
          errorName: errName,
          wallTimeMs: Date.now() - t0,
          tokensUsed: snap.poolTokensUsed,
          costUsd: snap.poolCostUsd,
          diagnostic: {
            errorStack: err instanceof Error ? err.stack : undefined,
          },
        },
      })
      .catch((emitErr: unknown) => {
        this.log.warn(
          `[handleMissionFailure ${missionId}] emit mission:failed failed: ${emitErr instanceof Error ? emitErr.message : String(emitErr)}`,
        );
      });

    // 写 partial 产物到 DB —— 与 legacy team.mission.ts:317-339 一致
    // ★ C0/G1：终态写经 finalize 单入口仲裁（条件写 WHERE status='running' 首写赢）
    const entry = this.sessions.get(missionId);
    const reportPayload =
      entry?.crossState.lastReportArtifact ?? entry?.crossState.lastReport;
    await this.lifecycleManager
      .finalize<PlaygroundTerminalExtra>({
        missionId,
        intent: {
          status: "failed",
          failureCode: mapAgentFailureCode(missionFailureCode),
          errorMessage: displayMessage,
          extra: {
            kind: "failed",
            detail: {
              errorMessage: displayMessage,
              // ★ C2/MAJOR-6:把 inline 大写 code 映射成 canonical MissionFailureCode 落 DB
              failureCode: mapAgentFailureCode(missionFailureCode),
              tokensUsed: snap.poolTokensUsed,
              costUsd: snap.poolCostUsd,
              elapsedWallTimeMs: Date.now() - t0,
              themeSummary: entry?.crossState.lastPlan?.themeSummary,
              dimensions: entry?.crossState.lastPlan?.dimensions as
                | unknown[]
                | undefined,
              report: reportPayload as
                | { title?: string; summary?: string }
                | undefined,
              reportArtifactVersion: entry?.crossState.lastReportArtifact
                ? 2
                : entry?.crossState.lastReport
                  ? 1
                  : undefined,
              // ★ S4b/B-部分：userProfile 停写，不再传 entry.input
              reconciliationReport: entry?.crossState.lastReconciliationReport,
              verdicts: entry?.crossState.lastVerifierVerdicts,
              leaderOverallScore:
                entry?.crossState.lastLeaderSignOff?.leaderOverallScore,
              leaderSigned: entry?.crossState.lastLeaderSignOff?.signed,
              leaderVerdict: entry?.crossState.lastLeaderSignOff?.leaderVerdict,
            },
          },
        },
        arbiter: this.store,
        // ★ e2e P0-#5: 仅在本 finalize 真正赢得终态写(running→failed)时发失败通知,
        //   保证恰好一次(已被 liveness/cancel 抢先终态则不重发)。user_cancelled 在
        //   上方 wasUserCancelled 已 return,不会走到这里。fire-and-forget。
        onWon: async () => {
          await this.missionFailedPreset
            ?.notify({
              userId,
              missionId,
              missionTitle: entry?.input.topic ?? "Mission",
              missionUrl: `/agent-playground/team/${missionId}`,
              reason: displayMessage,
              failureCode: missionFailureCode,
            })
            .catch((notifyErr: unknown) => {
              this.log.warn(
                `[handleMissionFailure ${missionId}] mission-failed notify failed (non-fatal): ${notifyErr instanceof Error ? notifyErr.message : String(notifyErr)}`,
              );
            });
        },
      })
      .catch((dbErr) => {
        this.log.error(
          `[pipeline-v1] finalize(failed) for mission ${missionId} failed: ${
            dbErr instanceof Error ? dbErr.message : String(dbErr)
          }`,
        );
      });
    // ★ 报告版本化 (2026-05-06): 失败路径有 partial report 时也写版本，
    //   让用户能查看失败前生成的报告内容
    if (reportPayload && entry) {
      await this.store
        .saveReportVersion({
          missionId,
          triggerType: this.businessOrch.resolveTriggerType(entry),
          report: reportPayload as { title?: string; summary?: string },
          finalScore: entry.crossState.lastLeaderSignOff?.leaderOverallScore,
          leaderSigned: entry.crossState.lastLeaderSignOff?.signed ?? undefined,
        })
        .catch((err: unknown) => {
          this.log.warn(
            `[handleMissionFailure] saveReportVersion for ${missionId} failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }
  }

  // ── pipeline 构造 ──────────────────────────────────────────────────────

  private buildPipelineWithHooks(): MissionPipelineConfig {
    const stepHooks: Record<string, ResolvedStageHooks> = {};
    for (const step of PLAYGROUND_PIPELINE.steps) {
      stepHooks[step.id] = this.buildHooksForStep(step.id, step.primitive);
    }
    return {
      ...PLAYGROUND_PIPELINE,
      steps: PLAYGROUND_PIPELINE.steps.map((s) => ({
        ...s,
        hooks: stepHooks[s.id] ?? {},
      })),
    };
  }

  /**
   * 为每个 step 构造 hook 闭包。所有 13 个 step 都已实装；s12-self-evolution
   * 不在 PLAYGROUND_PIPELINE.steps，由 fireSelfEvolutionPostlude fire-and-forget
   * 直接调用 runSelfEvolutionStage（见 dispatcher.runMission 末尾 + line 597+）。
   */
  private buildHooksForStep(
    stepId: string,
    primitive: string,
  ): ResolvedStageHooks {
    const baseHooks = this.buildBaseHooksForStep(stepId, primitive);
    // 包一层 progress tracking（markStageComplete + 选择性 checkpoint.save）
    return this.withProgressTracking(stepId, baseHooks);
  }

  private buildBaseHooksForStep(
    stepId: string,
    primitive: string,
  ): ResolvedStageHooks {
    // ★ Stage 1 / S1-1 (2026-05-09): 业务编排已抽到 PlaygroundBusinessOrchestrator
    //   delegate 到 businessOrch.buildHooksForStep,内部调对应 build*Hooks 并通过
    //   注入的 sessionLookup 访问 SessionEntry(在 onModuleInit 阶段已 bind)。
    //   stage degraded narrative contract still lives there: hooks must keep
    //   calling markStageDegraded instead of swallowing S3/S4/S9 failures.
    return this.businessOrch.buildHooksForStep(stepId, primitive);
  }

  /**
   * 公共 helper：从 sessions Map 取 entry，缺失抛错 + 类型收窄
   */
  private getEntry(missionId: string): SessionEntry {
    const entry = this.sessions.get(missionId);
    if (!entry) {
      throw new Error(
        `[playground-pipeline] no active session for mission ${missionId}`,
      );
    }
    return entry;
  }

  /**
   * ★ 2026-05-05 增量更新（"更新"按钮）helper：
   * 从 source mission DB row 重建 plan（dimensions+themeSummary+goals）写入
   * entry.crossState.lastPlan，让 S2 hook 检测到后跳过 Leader LLM 调用直接用继承的 plan。
   *
   * 失败兜底：source 不存在 / dimensions 缺失 → log warn，不写 entry.crossState.lastPlan，
   * S2 走原有 runLeaderPlanStage 路径（fallback to fresh plan）。
   */
  /**
   * ★ P0-D 完整版 (2026-05-06): 从源 mission DB hydrate baseline researcher 产物。
   * S3 hook 检测到 entry.crossState.inheritedResearchResults 不空 → skip invoker + 复用 findings。
   */
  private async hydrateInheritedResearchResults(
    missionId: string,
    sourceMissionId: string,
  ): Promise<void> {
    try {
      const results =
        await this.store.loadBaselineResearchResults(sourceMissionId);
      if (results.length === 0) {
        this.log.log(
          `[hydrateInheritedResearchResults] source ${sourceMissionId} 无持久化 researcher 产物，S3 走 fresh`,
        );
        return;
      }
      const entry = this.sessions.get(missionId);
      if (!entry) return;
      entry.crossState.inheritedResearchResults = results;
      // ★ P0-D 完整版: 复制到新 mission 的 research_results 表，让 stage 通过
      //   missionId 自然查到 cache（避免传 entry 跨多层 stage 调用）
      for (const r of results) {
        await this.store.saveResearchResult({
          missionId,
          dimension: r.dimension,
          findings: r.findings,
          summary: r.summary,
          state: "completed",
        });
      }
      this.log.log(
        `[hydrateInheritedResearchResults] mission ${missionId} 复用 ${results.length} 个 dim 的 researcher 产物（来自 ${sourceMissionId}），已复制到新 mission DB`,
      );
    } catch (err) {
      this.log.warn(
        `[hydrateInheritedResearchResults] failed for ${sourceMissionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * ★ P0-D 完整版: 从源 mission DB hydrate 合格 chapter drafts。
   * 下游 chapter pipeline 检测到已存的章节直接复用，跳过 LLM 重写。
   */
  private async hydrateInheritedChapterDrafts(
    missionId: string,
    sourceMissionId: string,
  ): Promise<void> {
    try {
      const drafts =
        await this.store.loadQualifiedChapterDrafts(sourceMissionId);
      if (drafts.length === 0) {
        this.log.log(
          `[hydrateInheritedChapterDrafts] source ${sourceMissionId} 无持久化 chapter drafts，S5+ 走 fresh`,
        );
        return;
      }
      const entry = this.sessions.get(missionId);
      if (!entry) return;
      entry.crossState.inheritedChapters = drafts;
      // ★ P0-D 完整版: 复制到新 mission 的 chapter_drafts 表，让 chapter pipeline
      //   通过 deps.store.loadQualifiedChapterDrafts(missionId) 自然查到 cache
      for (const d of drafts) {
        await this.store.saveChapterDraft({
          missionId,
          dimension: d.dimension,
          chapterIndex: d.chapterIndex,
          heading: d.heading,
          thesis: d.thesis,
          content: d.content,
          status: "passed",
          score: d.score,
          attempts: d.attempts,
          wordCount: d.wordCount,
        });
      }
      this.log.log(
        `[hydrateInheritedChapterDrafts] mission ${missionId} 复用 ${drafts.length} 个章节 drafts（来自 ${sourceMissionId}），已复制到新 mission DB`,
      );
    } catch (err) {
      this.log.warn(
        `[hydrateInheritedChapterDrafts] failed for ${sourceMissionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async hydrateInheritedPlan(
    missionId: string,
    userId: string,
    sourceMissionId: string,
  ): Promise<void> {
    try {
      const source = await this.store.getById(sourceMissionId, userId);
      if (!source) {
        this.log.warn(
          `[hydrateInheritedPlan] source mission ${sourceMissionId} not found, S2 will run fresh`,
        );
        return;
      }
      const rawDimensions = source.dimensions;
      const themeSummary = (source as { themeSummary?: string | null })
        .themeSummary;
      // ★ 防御 source DB JSON 损坏：每个 dim 必须有 string id + name + rationale
      if (!Array.isArray(rawDimensions) || rawDimensions.length === 0) {
        this.log.warn(
          `[hydrateInheritedPlan] source mission ${sourceMissionId} has no/invalid dimensions, S2 will run fresh`,
        );
        return;
      }
      const dimensions = rawDimensions.filter(
        (
          d,
        ): d is {
          id: string;
          name: string;
          rationale: string;
          toolHint?: { categories: string[]; preferIds?: string[] };
          dependsOn?: string[];
        } =>
          typeof d === "object" &&
          d !== null &&
          typeof (d as { id?: unknown }).id === "string" &&
          typeof (d as { name?: unknown }).name === "string" &&
          typeof (d as { rationale?: unknown }).rationale === "string",
      );
      if (dimensions.length === 0) {
        this.log.warn(
          `[hydrateInheritedPlan] source mission ${sourceMissionId} dimensions all malformed, S2 will run fresh`,
        );
        return;
      }
      if (dimensions.length < rawDimensions.length) {
        this.log.warn(
          `[hydrateInheritedPlan] source mission ${sourceMissionId} dimensions partially malformed: kept ${dimensions.length}/${rawDimensions.length}`,
        );
      }
      const entry = this.sessions.get(missionId);
      if (!entry) return;
      entry.crossState.lastPlan = {
        themeSummary: themeSummary ?? "",
        dimensions: dimensions as NonNullable<
          import("../context/mission-context").MissionContext["plan"]
        >["dimensions"],
        // goals/initialRisks 不从 source DB 反序列化（不在 mission row 持久化里），
        // 留空数组让下游 stage 走兜底逻辑（S4 leader assess 仅消费 dimensions）
        goals: [] as unknown as NonNullable<
          import("../context/mission-context").MissionContext["plan"]
        >["goals"],
        initialRisks: [] as unknown as NonNullable<
          import("../context/mission-context").MissionContext["plan"]
        >["initialRisks"],
      };
      this.log.log(
        `[hydrateInheritedPlan] mission ${missionId} inherited plan from ${sourceMissionId} (${dimensions.length} dims)`,
      );
    } catch (err) {
      this.log.warn(
        `[hydrateInheritedPlan] failed for ${sourceMissionId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

export type PipelineHookCtx = StageRunArgs["ctx"];
