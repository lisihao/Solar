/**
 * SocialPipelineDispatcher — SocialPublishMission 唯一入口（W4 PR-4b/round-2）
 *
 * 职责（mirror playground/playground-pipeline-dispatcher）：
 *   1. runMission(missionId, input, userId) 异步入口；与 controller fire-and-forget 对接
 *   2. 复用 SocialRuntimeShellService.openSession（拿真实 BillingRuntimeEnvAdapter
 *      + MissionBudgetPool + AbortController + heartbeat + wallTimer）
 *   3. 走 MissionPipelineOrchestrator.run 执行 12-step pipeline（hooks 由
 *      SocialBusinessOrchestrator.buildHooksForStep 注入；hook 内通过 sessions Map
 *      取 SessionEntry，delegate 到既有 stage adapter）
 *   4. onEvent 桥接 orchestrator 生命周期事件到 EventBus（social.stage:lifecycle
 *      / social.stage:stalled / social.stage:degraded）
 *   5. cleanup session（成功 / 失败都释放 abort registry / heartbeat timer）
 *   6. fire-and-forget S12 self-evolution postlude（mission terminal 后）
 *   7. dedup window：同一 userId × contentId × platforms 5s 内重复请求返回 in-flight missionId
 *
 * 此实现解决 round-1 reviewer A/C P0：
 *   - P0-1 真用 MissionPipelineOrchestrator（不再 sequential await）
 *   - P0-2 billing/pool 走 SocialRuntimeShellService（不再 `{} as Type`）
 *   - P0-3 pipeline 在 onModuleInit 注册到 MissionPipelineRegistry
 *   - P0-4 AbortSignal 通过 orchestrator.run({ signal }) + ctx.signal 透传，hook
 *     在 stage 入口 throw StageAbortError → mission:aborted
 *   - P0-8 mission:completed 由 orchestrator 在终态自动 emit（不再被吞）
 *   - P0-9 in-flight dedup window
 */

import { Injectable, OnModuleInit } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  BusinessTeamMissionDispatcherFramework,
  EventBus,
  MissionPipelineOrchestrator,
  MissionPipelineRegistry,
} from "@/modules/ai-harness/facade";
import {
  SocialAgentInvoker,
  LeaderService,
  StewardService,
  PlatformProbeService,
  ContentTransformerAgentService,
  CoverArtistService,
  ComposerService,
  PolishReviewerService,
  PublishExecutorAgentService,
  PublishVerifierService,
} from "../roles";
import { redactSocialEvent } from "../roles/social-event-relay";
import { SocialRuntimeShellService } from "./social-runtime-shell.service";
import { SocialBusinessOrchestrator } from "./social-business-orchestrator.service";
import { SocialMissionStore } from "../lifecycle/social-mission-store.service";
import {
  SOCIAL_PIPELINE,
  SOCIAL_FAST_PIPELINE,
  selectSocialPipeline,
} from "../../runtime/social.config";
import {
  AgentRunner,
  MissionAbortRegistry,
  MissionOwnershipRegistry,
  FailureLearnerService,
  PostmortemClassifierService,
  MissionFailureCode,
  MissionAbortReason,
  MissionLifecycleManager,
  mapAbortReasonToFailureCode,
} from "@/modules/ai-harness/facade";
import { runSelfEvolutionStage } from "./stages/s12-self-evolution.stage";
import type {
  MissionContext,
  RawContentBag,
  RunSocialMissionInput,
  StewardInputs,
} from "../context/mission-context";
import type { CommonDeps } from "../context/mission-deps";
import type { MissionRuntimeSession } from "./social-runtime-shell.service";

export interface SocialMissionSummary {
  readonly missionId: string;
  readonly status: "completed" | "failed" | "aborted";
  readonly error?: unknown;
}

/**
 * Per-mission session entry —— hook 闭包通过 dispatcher.getEntry 拿到，
 * 内含 stage adapter 需要的 ctx + deps（mutable，stage 内部会写入 phase 字段）。
 */
export interface SessionEntry {
  readonly session: MissionRuntimeSession;
  readonly t0: number;
  readonly input: RunSocialMissionInput;
  readonly workspaceId?: string;
  readonly ctx: MissionContext;
  readonly deps: CommonDeps;
}

/** dedup window: 5s 内同一签名重复请求返回已有 missionId */
const DEDUP_WINDOW_MS = 5_000;

@Injectable()
export class SocialPipelineDispatcher
  extends BusinessTeamMissionDispatcherFramework
  implements OnModuleInit
{
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly inFlight = new Map<
    string,
    { missionId: string; startedAt: number }
  >();

  constructor(
    private readonly registry: MissionPipelineRegistry,
    private readonly orchestrator: MissionPipelineOrchestrator,
    private readonly runtimeShell: SocialRuntimeShellService,
    private readonly businessOrch: SocialBusinessOrchestrator,
    private readonly store: SocialMissionStore,
    private readonly invoker: SocialAgentInvoker,
    private readonly runner: AgentRunner,
    eventBus: EventBus,
    private readonly abortRegistry: MissionAbortRegistry,
    private readonly ownershipRegistry: MissionOwnershipRegistry,
    private readonly failureLearner: FailureLearnerService,
    private readonly postmortemClassifier: PostmortemClassifierService,
    private readonly leader: LeaderService,
    private readonly steward: StewardService,
    private readonly platformProbe: PlatformProbeService,
    private readonly contentTransformer: ContentTransformerAgentService,
    private readonly coverArtist: CoverArtistService,
    private readonly composer: ComposerService,
    private readonly polishReviewer: PolishReviewerService,
    private readonly publishExecutor: PublishExecutorAgentService,
    private readonly publishVerifier: PublishVerifierService,
    // ★ round-2-followup: 在 mission 启动时查 SocialContent + Connections 装配 ctx
    private readonly prisma: PrismaService,
    // ★ C0/G1：唯一终态写入口。dispatcher 不再直写 store.markX，统一经 finalize 仲裁。
    private readonly lifecycleManager: MissionLifecycleManager,
  ) {
    // 2026-05-24 P4: framework 提供 emitToBus + bridgeOrchestratorStageEvent
    //   通用 mechanism；本 dispatcher 仅注入 social 专属事件 type 字符串。
    super(eventBus, {
      namespace: "social",
      stageLifecycleEvent: "social.stage:lifecycle",
      stageStalledEvent: "social.stage:stalled",
      stageDegradedEvent: "social.stage:degraded",
      // social 不做 stepId → frontend stage 映射，直接用 stepId
    });
  }

  onModuleInit(): void {
    this.businessOrch.bindSessionLookup((missionId) =>
      this.getEntry(missionId),
    );
    if (!this.registry.has(SOCIAL_PIPELINE.id)) {
      this.registry.register(this.buildPipelineWithHooks(SOCIAL_PIPELINE));
      this.log.log(
        `[social-pipeline] registered "${SOCIAL_PIPELINE.id}" (${SOCIAL_PIPELINE.steps.length} step)`,
      );
    }
    if (!this.registry.has(SOCIAL_FAST_PIPELINE.id)) {
      this.registry.register(this.buildPipelineWithHooks(SOCIAL_FAST_PIPELINE));
      this.log.log(
        `[social-pipeline] registered "${SOCIAL_FAST_PIPELINE.id}" (${SOCIAL_FAST_PIPELINE.steps.length} step fast-track)`,
      );
    }
  }

  /**
   * dedup key：userId + contentId + sorted platforms。同一签名 5s 内
   * 重复请求返回已有 missionId（防 StrictMode 双调用 / 用户双击）。
   */
  computeDedupKey(
    userId: string,
    contentId: string,
    platforms: readonly string[],
  ): string {
    const sorted = [...platforms].sort().join(",");
    return createHash("sha1")
      .update(`${userId}|${contentId}|${sorted}`)
      .digest("hex");
  }

  /** controller 在启动 mission 之前调，返回 in-flight missionId 时直接复用 */
  tryReserveInFlight(
    userId: string,
    contentId: string,
    platforms: readonly string[],
  ): { missionId: string; reused: boolean } {
    const key = this.computeDedupKey(userId, contentId, platforms);
    const now = Date.now();
    const existing = this.inFlight.get(key);
    if (existing && now - existing.startedAt < DEDUP_WINDOW_MS) {
      return { missionId: existing.missionId, reused: true };
    }
    const missionId = `social-${randomUUID()}`;
    this.inFlight.set(key, { missionId, startedAt: now });
    return { missionId, reused: false };
  }

  async runMission(
    missionId: string,
    input: RunSocialMissionInput,
    userId: string,
    workspaceId?: string,
    preHydratedContent?: RawContentBag,
  ): Promise<SocialMissionSummary> {
    const t0 = Date.now();
    this.log.log(
      `[${missionId}] mission start; platforms=${input.platforms.join(",")} depth=${input.depth}`,
    );

    // 2026-05-19 fix: 注册 ownership 到 MissionOwnershipRegistry，使前端复用的
    //   playground/replay/:missionId endpoint 的 assertOwnership 能命中
    //   ——之前 social mission 从不注册，导致详情页 SSE/polling 端点全部 403。
    this.ownershipRegistry.assign(missionId, userId);

    let session: MissionRuntimeSession | undefined;
    try {
      session = await this.runtimeShell.openSession({
        missionId,
        input,
        userId,
        workspaceId,
      });

      // 装配 ctx + deps，hook 通过 sessionLookup(missionId) 拿到
      const contextIds: Record<string, string> = {};
      for (const platform of input.platforms) {
        const connId = input.connectionIds[platform] ?? "noconn";
        contextIds[platform] = `social-${platform}-${connId}`;
      }
      // ★ round-2-followup: 装配 contentRaw + stewardInputs（Reviewer A P0 / Audit P1）
      // ★ PR-V4: 当 SocialTaskService 已通过 multi-source registry 聚合好内容时，
      //   直接复用 preHydratedContent，跳过 SocialContent 表查询（task-mode）。
      const contentRaw =
        preHydratedContent ??
        (await this.hydrateContentRaw(input.contentId, userId));
      const stewardInputs = await this.hydrateStewardInputs(
        userId,
        input,
        session,
      );
      const ctx: MissionContext = {
        missionId,
        userId,
        input,
        t0,
        billing: session.billing,
        pool: session.pool,
        budgetMultiplier: session.budgetMultiplier,
        contextIds,
        contentRaw,
        stewardInputs,
      };
      const deps = this.buildDeps(missionId, userId);
      this.sessions.set(missionId, {
        session,
        t0,
        input,
        workspaceId,
        ctx,
        deps,
      });

      const sessionRef = session;
      const pipeline = selectSocialPipeline(input.depth);
      this.log.log(
        `[${missionId}] pipeline=${pipeline.id} (${pipeline.steps.length} step)`,
      );
      return await this.runtimeShell.runWithinContext(session, async () => {
        const result = await this.orchestrator.run({
          missionId,
          pipelineId: pipeline.id,
          input,
          userId,
          tenantId: workspaceId,
          signal: sessionRef.missionAbort.signal,
          onEvent: async (event) => {
            await this.bridgeOrchestratorEvent(missionId, userId, event);
          },
        });

        if (result.status === "completed") {
          // 只有赢得仲裁（本次首写 completed）才广播，避免与 abort/liveness 抢写后误发。
          await this.lifecycleManager.finalize({
            missionId,
            intent: {
              status: "completed",
              extra: {
                kind: "completed",
                detail: { elapsedWallTimeMs: Date.now() - t0 },
              },
            },
            arbiter: this.store,
            onWon: async () => {
              await this.eventBus
                .emit({
                  type: "social.mission:completed",
                  scope: { missionId, userId },
                  payload: { wallTimeMs: Date.now() - t0 },
                  timestamp: Date.now(),
                })
                .catch(() => undefined);
            },
          });
        } else {
          // ★ MINOR-2:把 abort reason(framework 传 enum)透传给失败分类,避免 budget/超时
          //   abort 被误记 user_cancelled。
          const abortReason = sessionRef.missionAbort.signal.aborted
            ? (sessionRef.missionAbort.signal.reason as MissionAbortReason)
            : undefined;
          // ★ 评审 code-MAJOR-1:真正"取消意图"落 cancelled(而非 failed),前端 outcome 才显示
          //   "已取消"。budget/超时等失败型 abort 仍走 handleMissionFailure。
          const isGenuineCancel =
            abortReason === MissionAbortReason.user_cancelled ||
            abortReason === MissionAbortReason.rerun_replacing_stale ||
            abortReason === MissionAbortReason.superseded;
          if (isGenuineCancel) {
            // abort signal 已在取消源触发（故走到此分支），finalize 不再重复 abort。
            await this.lifecycleManager.finalize({
              missionId,
              intent: {
                status: "cancelled",
                reason: abortReason,
                failureCode: MissionFailureCode.user_cancelled,
                extra: { kind: "cancelled", reason: `aborted: ${abortReason}` },
              },
              arbiter: this.store,
              onWon: async () => {
                await this.eventBus
                  .emit({
                    type: "social.mission:cancelled",
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
        // S12 postlude fire-and-forget（成功 / 失败都跑）
        this.fireSelfEvolutionPostlude(missionId, userId);
        return {
          missionId,
          status: result.status,
          // 2026-05-19: 透传 orchestrator.error，避免上层 task service 拿到 undefined
          //   只能 fallback "Mission failed"，失败原因消失。
          error: result.error,
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(`[${missionId}] mission threw: ${message}`);
      // ★ C0/G1：dispatcher 抛错也经 finalize 单入口写终态。此前只 emit 不写 DB，
      //   行留 running 靠 liveness 回收（延迟数分钟）；现条件写首写赢，立即标 failed。
      //   canonical failureCode=runtime_crashed（取代 ad-hoc "DISPATCHER_THREW"，对齐 C2）。
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
        arbiter: this.store,
        onWon: async () => {
          await this.eventBus
            .emit({
              type: "social.mission:failed",
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
      // 清 dedup 入口（5s 窗口让用户主动重试不被永久占住 key）
      for (const [k, v] of this.inFlight) {
        if (v.missionId === missionId) this.inFlight.delete(k);
      }
    }
  }

  getEntry(missionId: string): SessionEntry {
    const entry = this.sessions.get(missionId);
    if (!entry) {
      throw new Error(
        `[social-pipeline] no active session for mission ${missionId}`,
      );
    }
    return entry;
  }

  /**
   * 真停一个正在跑的 mission（★ 2026-05-22 C1/G0：治"取消假停继续烧预算"）。
   * 此前 SocialTaskService.cancelTask 只改 task 表 status，从不真停 mission——取消后
   * mission 继续跑、继续烧预算。本方法触发 missionAbort signal：正在跑的 stage 在下一个
   * stage 边界收到 abort → 抛 StageAbortError → handleMissionFailure 落终态。
   *
   * S8（publish-execute，唯一外部副作用 stage）内部不查 signal，故发布原子完成、不产生
   * 半发布——abort 只在 S8 完成后的 stage 边界生效（RB6 gate-before-stage 由构造保证）。
   *
   * @returns true=已触发 abort；false=无 in-flight session（pod 重启/已结束，调用方走 DB 兜底）
   */
  abortMission(missionId: string, reason = "user_cancelled"): boolean {
    const entry = this.sessions.get(missionId);
    if (!entry) return false;
    entry.session.missionAbort.abort(reason);
    this.log.log(`[${missionId}] abort requested (reason=${reason})`);
    return true;
  }

  /**
   * 从 SocialContent 表 hydrate raw 内容（title / body / digest / coverImageUrl），
   * 供 s3/s5/s6 stage 消费。若 contentId 找不到 → throw，dispatcher 把 mission
   * 标 failed（不让空跑）。
   */
  private async hydrateContentRaw(
    contentId: string,
    userId: string,
  ): Promise<RawContentBag> {
    const row = await this.prisma.socialContent.findFirst({
      where: { id: contentId, userId },
      select: {
        title: true,
        content: true,
        digest: true,
        coverImageUrl: true,
      },
    });
    if (!row) {
      throw new Error(
        `[dispatcher] SocialContent ${contentId} not found for user ${userId}`,
      );
    }
    return {
      title: row.title,
      body: row.content,
      digest: row.digest ?? null,
      coverImageUrl: row.coverImageUrl ?? null,
    };
  }

  /**
   * 装配 S1 Steward 4 闸输入：DB 查每平台 connection / running mission count，
   * 再用 budgetMultiplier × depth 估算 estimatedCostUsd。
   *
   * keyCooldownCount1h 当前留 0（W5 接 KeyHealthMap bridge 后再补；
   * feedback_bridge_inmemory_health_to_db）。
   */
  private async hydrateStewardInputs(
    userId: string,
    input: RunSocialMissionInput,
    session: MissionRuntimeSession,
  ): Promise<StewardInputs> {
    // 1. 每平台 session 过期时间（platform → ISO string；""=未连接或已过期）
    //    SocialPlatformConnection.expiresAt 是 Date | null
    const connectionRows = await this.prisma.socialPlatformConnection
      .findMany({
        where: {
          userId,
          platformType: { in: input.platforms as never },
        },
        select: {
          platformType: true,
          expiresAt: true,
        },
      })
      .catch(() => [] as { platformType: string; expiresAt: Date | null }[]);
    // 2026-05-19 fix: session-expired 闸早早拦截 mission（s1）让用户连 AI 生成
    //   内容都看不到。空 expiresAt 通常是用户还没完成 OAuth（只测试 + 没真发布）
    //   场景。改成填 24h 占位让 s1 闸过；真实 token 有效性检查推到 s6
    //   publish-executor 阶段（那时给精确错误"请重连微信公众号"，UX 更好）。
    const placeholderExpiry = new Date(
      Date.now() + 24 * 60 * 60 * 1000,
    ).toISOString();
    const sessionExpiresAt: Record<string, string> = {};
    for (const platform of input.platforms) {
      const row = connectionRows.find((r) => r.platformType === platform);
      sessionExpiresAt[platform] = row?.expiresAt
        ? row.expiresAt.toISOString()
        : placeholderExpiry;
    }

    // 2. 当前 running mission count（防资源耗尽）
    const inProgressMissionCount = await this.prisma.socialMission
      .count({
        where: { userId, status: "running" },
      })
      .catch(() => 0);

    // 3. 估算 cost：depth × budgetProfile heuristic
    const depthFactor: Record<RunSocialMissionInput["depth"], number> = {
      quick: 0.5,
      standard: 1.0,
      deep: 2.0,
    };
    const profileFactor: Record<
      RunSocialMissionInput["budgetProfile"],
      number
    > = {
      lean: 0.6,
      standard: 1.0,
      rich: 1.6,
    };
    // base estimate per platform：标准档 / 标准 depth ≈ 0.05 USD
    const baseUsdPerPlatform = 0.05;
    const estimatedCostUsd =
      baseUsdPerPlatform *
      input.platforms.length *
      (depthFactor[input.depth] ?? 1) *
      (profileFactor[input.budgetProfile] ?? 1) *
      session.budgetMultiplier;

    // 4. 预算剩余美元（pool snapshot）
    // 2026-05-19 fix: pool.snapshot() 返回 { poolTokensUsed, poolCostUsd,
    //   poolTokensRemaining, poolCostRemaining } —— 之前代码读 remainingCostUsd /
    //   maxCostUsd / poolCostUsd（三个全错），永远 undefined → remainingCreditsUsd=0
    //   → budget 闸永远 fail。修正字段名后真实剩余美元正确读出。
    const snap = session.pool.snapshot();
    const remainingCreditsUsd =
      (snap as { poolCostRemaining?: number }).poolCostRemaining ?? 0;

    return {
      remainingCreditsUsd,
      estimatedCostUsd,
      sessionExpiresAt,
      inProgressMissionCount,
      keyCooldownCount1h: 0,
    };
  }

  // ─── private ───────────────────────────────────────────────────

  private buildPipelineWithHooks(pipeline: typeof SOCIAL_PIPELINE) {
    const stepHooks = pipeline.steps.map((s) => ({
      ...s,
      hooks: this.businessOrch.buildHooksForStep(s.id, s.primitive),
    }));
    return {
      ...pipeline,
      steps: stepHooks,
    };
  }

  private buildDeps(_missionId: string, _userId: string): CommonDeps {
    const log = this.log;
    const invoker = this.invoker;
    const eventBus = this.eventBus;
    return {
      invoker,
      abortRegistry: this.abortRegistry,
      runner: this.runner,
      eventBus,
      log,
      emit: async (args) => {
        // 走与 SocialEventRelay 同一脱敏出口：narrative 等经 deps.emit 的旁路
        // 事件也受护（当前 narrative 是安全模板；此为结构性防未来误带凭证）。
        const redacted = redactSocialEvent(args.type, args.payload);
        if (redacted.drop) return;
        await eventBus
          .emit({
            type: args.type,
            scope: { missionId: args.missionId, userId: args.userId },
            payload: redacted.payload,
            agentId: args.agentId,
            traceId: args.traceId,
            timestamp: Date.now(),
          })
          .catch(() => undefined);
      },
      lifecycle: async (mid, uid, agentId, role, phase, detail) =>
        invoker.emitLifecycle(mid, uid, agentId, role, phase, detail),
      markStageDegraded: async (mid, uid, stepId, reason) => {
        log.warn(`[${mid}] stage ${stepId} degraded: ${reason}`);
        await eventBus
          .emit({
            type: "social.stage:degraded",
            scope: { missionId: mid, userId: uid },
            payload: { stepId, reason },
            timestamp: Date.now(),
          })
          .catch(() => undefined);
      },
      leader: this.leader,
      steward: this.steward,
      platformProbe: this.platformProbe,
      contentTransformer: this.contentTransformer,
      coverArtist: this.coverArtist,
      composer: this.composer,
      polishReviewer: this.polishReviewer,
      publishExecutor: this.publishExecutor,
      publishVerifier: this.publishVerifier,
      failureLearner: this.failureLearner,
      postmortemClassifier: this.postmortemClassifier,
      store: this.store,
    };
  }

  /**
   * 把 orchestrator 内置 stage 级事件 + social 专属 mission:aborted 桥接到
   * EventBus（前端 socket 订阅 social: room）。
   *
   * 2026-05-24 P4: stage:* 走 framework 通用 bridgeOrchestratorStageEvent；
   * mission:aborted 是 social 专属语义（携带 wallTimeMs from sessions Map），
   * 由本方法承担。
   *
   * mission:completed 由 dispatcher 在主路径单独 emit（携带 wallTimeMs），
   * 这里只透传 stage 级和异常 mission 级事件。
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
    // framework handles stage:started/completed/failed/stalled/degraded
    if (event.stepId) {
      await this.bridgeOrchestratorStageEvent(event, { missionId, userId });
      return;
    }
    if (event.type === "mission:aborted") {
      await this.emitToBus({
        type: "social.mission:aborted",
        missionId,
        userId,
        payload: {
          reason: event.reason,
          wallTimeMs:
            Date.now() - (this.sessions.get(missionId)?.t0 ?? Date.now()),
        },
        timestamp: event.timestamp,
      });
    }
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
    // ★ C2/G3 + MINOR-2:优先按 abort **reason** 定 code,不再"StageAbortError 一律 user_cancelled"
    //   (budget/超时 abort 也抛 StageAbortError → 原逻辑会把真因误记成 user_cancelled)。
    //   有 reason 走 canonical 映射;无 reason 才退回 message 启发式。
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
      arbiter: this.store,
      onWon: async () => {
        await this.eventBus
          .emit({
            type: "social.mission:failed",
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

  /**
   * S12 self-evolution fire-and-forget。mission terminal 后立即返回，
   * postmortem + memory 索引在后台跑；生命周期独立事件流
   * social.mission:postlude:started / :completed / :failed。
   */
  private fireSelfEvolutionPostlude(missionId: string, userId: string): void {
    const entry = this.sessions.get(missionId);
    if (!entry) {
      this.log.warn(`[postlude] no session for ${missionId}`);
      return;
    }
    const startedAt = Date.now();
    void this.eventBus
      .emit({
        type: "social.mission:postlude:started",
        scope: { missionId, userId },
        payload: { stage: "s12-self-evolution", startedAt },
        timestamp: startedAt,
      })
      .catch(() => undefined);

    void runSelfEvolutionStage(entry.ctx, entry.deps)
      .then(() =>
        this.eventBus
          .emit({
            type: "social.mission:postlude:completed",
            scope: { missionId, userId },
            payload: {
              stage: "s12-self-evolution",
              wallTimeMs: Date.now() - startedAt,
            },
            timestamp: Date.now(),
          })
          .catch(() => undefined),
      )
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        return this.eventBus
          .emit({
            type: "social.mission:postlude:failed",
            scope: { missionId, userId },
            payload: {
              stage: "s12-self-evolution",
              error: message.slice(0, 500),
              wallTimeMs: Date.now() - startedAt,
            },
            timestamp: Date.now(),
          })
          .catch(() => undefined);
      });
  }
}
