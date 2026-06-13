/**
 * PlaygroundModule
 *
 * Demo 模块 —— 展示 Harness 全栈能力（loop / verify / handoff / memory / cost）。
 *
 * 模型解析（系统配置感知 + BYOK）：
 *   完全走 Harness。Harness 的 ReAct/PlanAct/ContextCompactor/SkillLearner 都已
 *   修成"chat() 时透传 modelType + userId"——AiChatService 自然走：
 *     1. 用户 UserModelConfig 默认（BYOK）
 *     2. 全局 ai_models DB 默认
 *     3. DEFAULT_AI_MODEL env（兜底）
 *   API Key 由 Secret Manager 通过 ai_models.secret_key 解析，
 *   不需要任何独立 env var。AI App 层不再做模型 promotion 或硬编码。
 */

import {
  Logger,
  Module,
  Optional,
  OnApplicationBootstrap,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { AgentPlaygroundController } from "../api/controller/playground.controller";
// ★ 2026-05-15 PR-C god-class 拆分：原 856 行 controller 拆 3 个聚焦 controller
import { MissionReadController } from "../api/controller/mission-read.controller";
import { MissionRerunController } from "../api/controller/mission-rerun.controller";
// ★ 2026-05-26 Mission DAG 可视化(后端定义、前端呈现):/dag + /dag/cascade
import { MissionDagController } from "../mission/dag-view/mission-dag.controller";
import { MissionDagService } from "../mission/dag-view/mission-dag.service";
// ★ 2026-06-07: Mission knowledge-graph artifact
import { MissionGraphController } from "../api/controller/mission-graph.controller";
import { MissionGraphService } from "../mission/graph/mission-graph.service";
import { AgentPlaygroundGateway } from "../api/controller/playground.gateway";
import { MissionRuntimeShellService } from "../mission/pipeline/mission-runtime-shell.service";
import { MissionStageBindingsService } from "../mission/pipeline/mission-stage-bindings.service";
// ★ R2-C 单轨化 (2026-05-04)：pipelineDispatcher 是唯一 mission orchestrator
//   legacy TeamMission 已删除，flag service 已删除
import { PlaygroundPipelineDispatcher } from "../mission/pipeline/playground.pipeline";
// ★ Stage 1 / S1-1 (2026-05-09): 业务编排已抽到独立 service(STAGE_NUMBER / CHECKPOINT_AT
//   字面量 + 11 个 build*Hooks),dispatcher inject + delegate
import { PlaygroundBusinessOrchestrator } from "../mission/pipeline/playground-business-orchestrator.service";
import { PredictionCalibrationService } from "../mission/calibration/prediction-calibration.service";
import { PredictionRecalibrationScheduler } from "../mission/calibration/prediction-recalibration.scheduler";
import { PlaygroundMissionSpanService } from "../mission/pipeline/playground-mission-span.service";
// ★ 2026-06-07: MissionPipelineRegistry 已提升为 @Global（teams.module），不再 local-provide。
import { MissionPipelineOrchestrator } from "@/modules/ai-harness/facade";
import {
  SkillLoaderService,
  PromptSkillRegistrationService,
} from "@/modules/ai-engine/facade";
import { MissionEventBuffer } from "../mission/lifecycle/mission-event-buffer.service";
import { MissionStore } from "../mission/lifecycle/mission-store.service";
import { PrismaMissionCheckpointStore } from "../mission/lifecycle/prisma-mission-checkpoint.store";
import {
  MissionCheckpointService,
  type MissionCheckpointStore,
} from "@/modules/ai-harness/facade";
import { LeaderChatService } from "../mission/chat/leader-chat.service";
// MissionStateService 已上提到 harness/memory/working/handoff-compactor.service.ts（@Global RuntimeMemoryModule）
// ── 2026-04-30 (B 路线): 单 stage 局部重跑 ──
import { LocalRerunService } from "../mission/rerun/local-rerun.service";
import { CtxHydratorService } from "../mission/rerun/ctx-hydrator.service";
import { RerunGuardService } from "../mission/rerun/rerun-guard.service";
// ★ B2-1 / B2-1a (2026-05-26 thinning plan)：canonical view 单轨化
import { MissionQueryService } from "../mission/query/mission-query.service";
import { ResumeRerunPolicyService } from "../mission/rerun/resume-rerun-policy.service";
// ★ P0-2 (2026-05-26 hotfix): ArtifactComposerService
import { ArtifactComposerService } from "../mission/services/artifact-composer.service";
// RerunLockRegistry 已上提到 ai-harness/facade（@Global TeamsModule provider）
import { StageRerunDispatcher } from "../mission/rerun/stage-rerun.dispatcher";
// ★ PR-R5b-FULL (2026-05-07): rerun runtime builder（billing/pool/leader 装配 stub）
import { RerunMissionRuntimeBuilder } from "../mission/rerun/rerun-runtime-builder.service";
// ★ C5/C6 (2026-05-22): MissionInputRebuilder 实现(config snapshot 冻结/派生)
import { PlaygroundMissionInputRebuilder } from "../runtime/playground.input-rebuilder";
// ★ 单源 LeaderRunFn 工厂（dispatcher + rerun 共用，去 buildLeaderInvocation 双源）
import { LeaderInvocationFactory } from "../mission/pipeline/leader-invocation.factory";
import { MissionRerunOrchestratorService } from "../mission/rerun/mission-rerun-orchestrator.service";
// ★ 2026-06-12: liveness 停滞击杀后的自动恢复（boot 孤儿路径之外的第二条恢复线）
import { MissionAutoRecoveryService } from "../mission/rerun/mission-auto-recovery.service";
import { MissionExportService } from "../mission/export/mission-export.service";
import { AgentPlaygroundContentSourceProvider } from "../integrations/playground-content-source.provider";
// PostmortemClassifierService 已上提到 @Global HarnessModule（PR-2 standardize playground）
import {
  AgentInvoker,
  LeaderService,
  ResearcherService,
  ReconcilerService,
  AnalystService,
  WriterService,
  ReviewerService,
  VerifierService,
  StewardService,
} from "../mission/roles";
import { CreditsModule } from "../../../platform/credits/credits.module";
// e2e P0-#5: 提供 MissionFailedPreset（mission 失败通知，dispatcher @Optional 注入）
import { NotificationDispatcherModule } from "../../../platform/notifications/dispatcher/notification-dispatcher.module";
import { MissionFailedPreset } from "../../../platform/facade";
import {
  EventBus,
  EventRegistry,
  MissionAbortReason,
  MissionElectionTracker,
  MissionFailureCode,
  MissionLifecycleManager,
  MissionLivenessGuard,
} from "@/modules/ai-harness/facade";
import type { PlaygroundTerminalExtra } from "../mission/lifecycle/mission-store.service";
import { AGENT_PLAYGROUND_EVENTS } from "../events/playground.events";
import { PrismaService } from "../../../../common/prisma/prisma.service";
// ★ Rev 5 / S1-5 (2026-05-09): mission platform contract tokens — 让 custom-agents
//   通过 contract interface 注入,而非直接 import dispatcher / store 具体类。
import {
  MISSION_RUNNER,
  MISSION_LIST_READER,
} from "@/modules/ai-app/contracts/mission-platform.contract";
// ★ 2026-05-13 (PR2): typed runtime tunables, single source of truth.
//   `loadPlaygroundRuntimeConfig()` is used here because module factories
//   resolve at registration time (before ConfigService is available).
//   Services / hooks elsewhere can inject `playgroundRuntimeConfig.KEY` once
//   the ConfigModule.forFeature call below has loaded it.
import {
  playgroundRuntimeConfig,
  loadPlaygroundRuntimeConfig,
} from "../runtime/playground-runtime.config";

@Module({
  imports: [
    CreditsModule,
    NotificationDispatcherModule,
    ConfigModule.forFeature(playgroundRuntimeConfig),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>("JWT_SECRET"),
        signOptions: { expiresIn: "7d" },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [
    AgentPlaygroundController,
    MissionReadController,
    MissionRerunController,
    MissionDagController,
    MissionGraphController,
  ],
  providers: [
    MissionDagService,
    MissionGraphService,
    AgentPlaygroundGateway,
    MissionRuntimeShellService,
    MissionStageBindingsService,
    // MissionOwnershipRegistry / MissionAbortRegistry 由 @Global HarnessModule 提供（PR-X-E 上提）
    MissionEventBuffer,
    MissionStore,
    // ★ Foresight L3 (2026-05-29)：前瞻预测校准闭环（留痕 + 到期裁决 + Brier 反哺）
    PredictionCalibrationService,
    PredictionRecalibrationScheduler,
    // ★ Phase 5 (2026-04-29): playground 接入 ai-harness 沉淀的 MissionCheckpointService
    PrismaMissionCheckpointStore,
    {
      provide: MissionCheckpointService,
      useFactory: (store: MissionCheckpointStore) =>
        new MissionCheckpointService(store),
      inject: [PrismaMissionCheckpointStore],
    },
    // ★ 2026-05-05 MissionHealthScheduler 已删（DISABLED + 由 unified MissionLivenessGuard 接管）
    LeaderChatService,
    // FailureLearnerService / ReportArtifactAssembler 由 @Global HarnessModule 提供（PR-X-failure-learner 上提 / PR-X-report-artifact 上提）
    // MissionStateService → HandoffCompactorService 已上提到 @Global RuntimeMemoryModule（PR-5 standardize playground）
    // ── Per-role services（Phase Lead-Services）──
    AgentInvoker,
    LeaderInvocationFactory,
    LeaderService,
    ResearcherService,
    ReconcilerService,
    AnalystService,
    WriterService,
    ReviewerService,
    VerifierService,
    StewardService,
    // ── 局部重跑 ──
    LocalRerunService,
    CtxHydratorService,
    // ── B2 canonical view 单轨（thinning plan §B2-1 / §B2-1a）──
    ResumeRerunPolicyService,
    MissionQueryService,
    // ── P0-2 ArtifactComposerService（取代 projectArtifact 纯函数，含 R2 off-load fetch）──
    ArtifactComposerService,
    // ★ 2026-05-07 rerun-overhaul v1.1：唯一 in-flight 判定 + zombie 主动清理
    RerunGuardService,
    // RerunLockRegistry 已上提到 ai-harness/facade（PR-3 standardize playground）
    StageRerunDispatcher,
    // ★ PR-R5b-FULL (2026-05-07): RerunRuntimeBuilder — dispatcher 8 stage handler 必读
    RerunMissionRuntimeBuilder,
    PlaygroundMissionInputRebuilder,
    MissionRerunOrchestratorService,
    // liveness 停滞击杀 → 带护栏自动恢复（终生 1 次 + canResume 门 + wall-time 不复活）
    MissionAutoRecoveryService,
    // ── 导出装配（CSV / Markdown / JSON）──
    MissionExportService,
    // ── Social data source (PR-V2g: Playground as social content source) ──
    //   Auto-discovered via DiscoveryService at runtime
    AgentPlaygroundContentSourceProvider,
    // ★ R2-C 单轨化 (2026-05-04)：pipeline-v1 是唯一 mission 入口
    //   dispatcher.onModuleInit 注册 PLAYGROUND_PIPELINE 到 @Global MissionPipelineRegistry
    //   legacy TeamMission 已删除，PlaygroundRuntimeFlagService 已删除
    //   ★ 2026-06-07: MissionPipelineRegistry 已 @Global，此处不再 local-provide
    MissionPipelineOrchestrator,
    // ★ Stage 1 / S1-1 (2026-05-09): business-orch 必须在 dispatcher 之前 register,
    //   保证 dispatcher.onModuleInit 调 businessOrch.bindSessionLookup 时 instance 已存在
    PlaygroundBusinessOrchestrator,
    // ★ R2-#38: OTel span emission for mission + stage lifecycle
    PlaygroundMissionSpanService,
    PlaygroundPipelineDispatcher,
    // ── S12 postmortem 失败模式分类（已上提到 @Global HarnessModule）──
    // ★ Rev 5 / S1-5 (2026-05-09): mission-platform contract token bindings —
    //   custom-agents 通过 contract interface 注入(useExisting 复用同一实例,
    //   不重复 instantiate)。closes audit §3.3 custom-agents back-coupling
    //   via "ai-app/contracts/" path(三选项中 (b) 选项)。
    {
      provide: MISSION_RUNNER,
      useExisting: PlaygroundPipelineDispatcher,
    },
    {
      provide: MISSION_LIST_READER,
      useExisting: MissionStore,
    },
  ],
  // R-CA (2026-05-05): 导出 dispatcher + store 让 custom-agents 模块复用启动 + 列表能力
  // Rev 5 / S1-5: 同时 export contract tokens — custom-agents 通过 token 注入,
  //               playground 内部仍 export 具体类(其他 ai-app module 可能直接消费)。
  exports: [
    MissionEventBuffer,
    PlaygroundPipelineDispatcher,
    MissionStore,
    MISSION_RUNNER,
    MISSION_LIST_READER,
  ],
})
export class PlaygroundModule implements OnModuleInit, OnApplicationBootstrap {
  // 2026-05-12 修复：playgroundLogger 之前是 constructor 默认值参数（Logger 类型）
  // 触发 NestJS DI 解析 Logger 失败 → Railway 部署炸。改为类字段无 DI 参与。
  private readonly playgroundLogger = new Logger(PlaygroundModule.name);

  constructor(
    private readonly eventBus: EventBus,
    private readonly registry: EventRegistry,
    private readonly buffer: MissionEventBuffer,
    private readonly store: MissionStore,
    private readonly prisma: PrismaService,
    // ★ 2026-05-05 unified harness liveness guard（替代 4 个旧 detector）
    private readonly livenessGuard: MissionLivenessGuard,
    // ★ Round 4 (2026-05-11): liveness-guard markFailed 路径必须清 election state，
    //   否则 mission_election_states 行在 heartbeat / wall-time 杀死 mission 后永久残留。
    private readonly electionTracker: MissionElectionTracker,
    // ★ C0/G1：liveness 回收也经唯一终态写入口仲裁，不直写 store。
    private readonly lifecycleManager: MissionLifecycleManager,
    // R0-A3 (2026-05-04): 注册 playground skills 目录到 engine SkillLoader
    //   17 个 SKILL.md (mece-mission-planning / leader-* / dimension-research / web-research 等)
    //   下推到 ai-app/playground/skills/，需要在这里 register 到 SkillRegistry
    //   否则 SkillActivator 在 leader/researcher role 启动时报 "skipped: <skill-id>"
    private readonly skillLoader: SkillLoaderService,
    // ★ 2026-05-12 真因修复：addSkillDirectory 只把目录加入 config，
    //   loadAllLocalSkills 在 onApplicationBootstrap 才跑，并不会 bridge
    //   localSkills → SkillRegistry。必须在 onApplicationBootstrap 显式
    //   调 promptSkillBridge.registerDomain，否则 SkillActivator tryGet
    //   全部 miss → "skipped: dimension-research / web-research"。
    private readonly promptSkillBridge: PromptSkillRegistrationService,
    // ★ 2026-06-12: liveness 停滞击杀后的带护栏自动恢复（wall-time 击杀不恢复）
    private readonly autoRecovery: MissionAutoRecoveryService,
    // ★ e2e P0-#5 / 深审 F1：liveness 回收(pod 崩/wall-time/失联)也要发失败通知 ——
    //   这才是"用户关了 UI 不知道失败"最典型的场景（dispatcher handleMissionFailure
    //   只覆盖即时失败）。@Optional：NotificationDispatcherModule 未装配则优雅缺省。
    @Optional() private readonly missionFailedPreset?: MissionFailedPreset,
  ) {}

  async onModuleInit(): Promise<void> {
    // R0-A3: 注册 playground skill 目录
    const path = await import("path");
    // 2026-05-24 P9b: skills/ 已挪到 mission/skills/(蓝图 §8.2 Agent App 基线)。
    // module 在 module/,skills 在 mission/skills/,从 module/ 到目标:../mission/skills
    await this.skillLoader.addSkillDirectory({
      path: path.resolve(__dirname, "..", "mission", "skills"),
      domain: "playground",
      recursive: false,
    });

    // 1. 注册事件类型 —— EventBus 校验未注册的 type 会 drop+warn
    this.registry.registerAll(AGENT_PLAYGROUND_EVENTS);
    // 2. 注册缓冲 adapter，截获所有 playground.* 事件入内存（给 /replay 用）
    this.eventBus.registerAdapter(this.buffer);
    // 3. ★ 2026-05-05 归并 4 个 detector → 单一 harness MissionLivenessGuard
    //    用户驱动重构，归一 + 友好 + 完整覆盖：
    //      - 归一：playground / writing / research / topic-insights 共用同一算法
    //      - 多信号：heartbeat + events 必须双 stale 才认死，单一信号失败不误杀
    //      - 启动期豁免 5min：避免 fire-and-forget refreshHeartbeat 未落库即被杀
    //      - 三阶梯：soft warn 10min（不杀）/ hard kill 5min 双 stale / wall-time 4h
    //
    //    ★ 历史路径全部废弃（保留写路径 refreshHeartbeat / markStageComplete）：
    //      - this.store.recoverOrphanedRunning(240)              ← removed
    //      - this.store.recoverPodCrashedRunning(300) on 60s     ← removed
    //      - MissionHealthScheduler                              ← deleted (file removed)
    //      - MissionOrphanDetectorService                        ← deleted (file removed)
    this.livenessGuard.registerAdapter(
      "playground",
      {
        fetchRunningMissions: async () => {
          const rows = await this.prisma.agentPlaygroundMission
            .findMany({
              where: { status: "running" },
              select: {
                id: true,
                userId: true,
                startedAt: true,
                heartbeatAt: true,
              },
              take: 200,
            })
            .catch((err: unknown) => {
              this.playgroundLogger.warn(
                `[liveness] findMany running missions failed: ${err instanceof Error ? err.message : String(err)}`,
              );
              return [] as Array<{
                id: string;
                userId: string;
                startedAt: Date;
                heartbeatAt: Date | null;
              }>;
            });
          if (rows.length === 0) return [];
          // ★ 2026-05-07 rerun-overhaul：wall-time 用 effective start = max(startedAt,
          //   lastReopenedAt)。reopen 后的 mission 不应被原 startedAt 误判超时。
          //   按 missionId 取最近一条 mission:reopened 事件 ts。
          const ids = rows.map((r) => r.id);
          const reopenedMap = new Map<string, number>();
          try {
            const reopens =
              await this.prisma.agentPlaygroundMissionEvent.findMany({
                where: {
                  missionId: { in: ids },
                  type: "playground.mission:reopened",
                },
                select: { missionId: true, ts: true },
                orderBy: { ts: "desc" },
              });
            for (const ev of reopens) {
              if (!reopenedMap.has(ev.missionId)) {
                const tsMs = Number(ev.ts);
                if (Number.isFinite(tsMs)) reopenedMap.set(ev.missionId, tsMs);
              }
            }
          } catch {
            // best-effort：reopen 查询失败不阻断 liveness 主流程，回退到 startedAt
          }
          return rows.map((r) => {
            const reopenedTs = reopenedMap.get(r.id);
            return {
              id: r.id,
              userId: r.userId,
              startedAt: r.startedAt,
              heartbeatAt: r.heartbeatAt,
              lastReopenedAt: reopenedTs != null ? new Date(reopenedTs) : null,
            };
          });
        },
        getMostRecentEventTs: async (missionIds, sinceMs) => {
          const grouped = await this.prisma.agentPlaygroundMissionEvent
            .groupBy({
              by: ["missionId"],
              where: {
                missionId: { in: missionIds as string[] },
                ts: { gte: BigInt(sinceMs) },
              },
              _max: { ts: true },
            })
            .catch((err: unknown) => {
              this.playgroundLogger.warn(
                `[liveness] getMostRecentEventTs groupBy failed: ${err instanceof Error ? err.message : String(err)}`,
              );
              return [] as { missionId: string; _max: { ts: bigint | null } }[];
            });
          const out = new Map<string, number>();
          for (const g of grouped) {
            const ts = g._max.ts;
            if (ts != null) {
              const tsMs = Number(ts);
              if (Number.isFinite(tsMs) && tsMs <= Number.MAX_SAFE_INTEGER) {
                out.set(g.missionId, tsMs);
              }
            }
          }
          return out;
        },
        markFailed: async (missionId, reason, errorMessage) => {
          // ★ C0/C2/MAJOR-4:liveness 回收经 finalize 仲裁(条件写首写赢,不覆盖已终态),
          //   落 canonical failureCode(超时→wall_time;失联→runtime_crashed)。
          const isWallTime = reason === "wall-time-exceeded";
          const failureCode = isWallTime
            ? MissionFailureCode.wall_time_exceeded
            : MissionFailureCode.runtime_crashed;
          // ★ 2026-06-11 (#2 调用超时硬化): liveness 回收**一律 abort** in-flight 止血。
          //   背景——心跳改为跟随真实进度后（#1），"无活动"(no-activity) 不再等于"worker
          //   已死"：可能是活着但卡在某 stage / 空转重试，仍在烧 LLM/tool credit。abort 幂等：
          //   worker 死或在异 pod → 本 pod abortRegistry 无该 controller，no-op；活在本 pod
          //   → 立即中断在飞调用。原仅 wall-time abort 会漏掉这类"活着卡住"的烧钱。
          const abortReason = isWallTime
            ? MissionAbortReason.mission_wall_time_exceeded
            : MissionAbortReason.mission_no_activity;
          await this.lifecycleManager.finalize<PlaygroundTerminalExtra>({
            missionId,
            abort: true,
            intent: {
              status: "failed",
              failureCode,
              reason: abortReason,
              errorMessage,
              extra: {
                kind: "failed",
                detail: {
                  errorMessage,
                  failureCode,
                },
              },
            },
            arbiter: this.store,
            onWon: async () => {
              this.electionTracker.clear(missionId);
              await this.eventBus
                .emit({
                  type: "playground.mission:failed",
                  scope: { missionId, userId: "" },
                  payload: {
                    message: errorMessage,
                    failureCode:
                      reason === "wall-time-exceeded"
                        ? "RUNNER_WALL_TIME_EXCEEDED"
                        : "MISSION_STALE",
                    source: "liveness-guard",
                  },
                  timestamp: Date.now(),
                })
                .catch((err: unknown) => {
                  this.playgroundLogger.warn(
                    `[liveness] emit mission:failed failed: ${err instanceof Error ? err.message : String(err)}`,
                  );
                });
              // ★ 2026-06-12: 停滞击杀（非 wall-time）→ 尝试带护栏自动恢复。
              //   fire-and-forget：恢复成功会 markReopened 转回 running 并发
              //   mission:reopened；失败/被护栏拦截则维持 failed（上面的失败
              //   事件与通知已如实送达，恢复只是后续的 best-effort 升级）。
              if (!isWallTime) {
                const meta = await this.store
                  .getMetaForNotify(missionId)
                  .catch(() => null);
                if (meta?.userId) {
                  void this.autoRecovery
                    .attemptAfterStaleKill(missionId, meta.userId)
                    .catch((err: unknown) => {
                      this.playgroundLogger.warn(
                        `[liveness] auto-recovery threw: ${err instanceof Error ? err.message : String(err)}`,
                      );
                    });
                }
              }
              // ★ 深审 F1 (2026-05-25): liveness 回收也发 MISSION_FAILED 通知(email +
              //   site) —— 这是"用户关了 UI"最典型场景。mission:failed 事件 userId 为空,
              //   需从 DB 反查真实 owner + topic。fire-and-forget,查不到/未装配则跳。
              if (this.missionFailedPreset) {
                const meta = await this.store
                  .getMetaForNotify(missionId)
                  .catch(() => null);
                if (meta?.userId) {
                  await this.missionFailedPreset
                    .notify({
                      userId: meta.userId,
                      missionId,
                      missionTitle: meta.topic || "Mission",
                      missionUrl: `/agent-playground/team/${missionId}`,
                      reason: errorMessage,
                      failureCode: isWallTime
                        ? "RUNNER_WALL_TIME_EXCEEDED"
                        : "MISSION_STALE",
                    })
                    .catch((err: unknown) => {
                      this.playgroundLogger.warn(
                        `[liveness] mission-failed notify failed: ${err instanceof Error ? err.message : String(err)}`,
                      );
                    });
                }
              }
            },
          });
          this.playgroundLogger.warn(
            `[liveness] playground mission ${missionId} reclaimed (${reason})`,
          );
        },
        emitWarning: async (missionId, userId, payload) => {
          await this.eventBus
            .emit({
              type: "playground.mission:warning",
              scope: { missionId, userId },
              payload: {
                message: `Mission 心跳/事件已停 ≥ 20 分钟，可能已卡死。建议主动取消重试，或继续等待至 wall-time 4h 自动失败。`,
                ageMs: payload.ageMs,
                heartbeatAgeMs: payload.heartbeatAgeMs,
                eventAgeMs: payload.eventAgeMs,
                source: "liveness-guard",
              },
              timestamp: Date.now(),
            })
            .catch((err: unknown) => {
              this.playgroundLogger.warn(
                `[liveness] emit mission:warning failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            });
        },
      },
      (() => {
        // ★ 2026-05-13 (PR2): pull tunables from typed runtime config.
        //   Defaults are tuned for production frontier models (4h wall-time
        //   cap, 15min stale / 20min soft-warn). Local / reasoning models
        //   override upward via env vars (PLAYGROUND_WALL_TIME_CAP_MS,
        //   PLAYGROUND_STALE_THRESHOLD_MIN, PLAYGROUND_SOFT_WARN_THRESHOLD_MIN).
        //   wallTimeCapMs === 0 means "unlimited" — preserve that as Infinity
        //   for the guard, never 0 (which would be instant-kill).
        const rt = loadPlaygroundRuntimeConfig();
        return {
          wallTimeCapMs:
            rt.wallTimeCapMs > 0 ? rt.wallTimeCapMs : Number.POSITIVE_INFINITY,
          staleThresholdMs: rt.staleThresholdMin * 60 * 1000,
          softWarnThresholdMs: rt.softWarnThresholdMin * 60 * 1000,
          startupGraceMs: 5 * 60 * 1000,
          scanIntervalMs: 60_000,
          bootDelayMs: 60_000,
        };
      })(),
    );
  }

  /**
   * ★ 2026-05-12 真因修复 (skill miss "dimension-research / web-research")
   *
   * 顺序：
   *   1. onModuleInit: addSkillDirectory（仅 push 配置进 skillDirectories）
   *   2. SkillLoader.onApplicationBootstrap: 扫所有 skillDirectories，
   *      把 SKILL.md 解析为 SkillMdDefinition 塞 localSkills Map
   *   3. 本 onApplicationBootstrap: promptSkillBridge.registerDomain
   *      把 localSkills["playground"] 桥接到 engine SkillRegistry
   *      → SkillActivator.resolveFromProviders 才能查到
   *
   * NestJS 文档保证 OnApplicationBootstrap 在所有 OnModuleInit 之后执行；
   * 此模块依赖另一模块（SkillLoader）的 ApplicationBootstrap，二者都用
   * onApplicationBootstrap 时按 module 注册顺序触发——加载器先于本模块
   * 因为 SkillLoaderService 在 SkillsModule 里、被本模块 import。
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const result = await this.promptSkillBridge.registerDomain("playground");
      this.playgroundLogger.log(
        `Registered playground skill domain: ${result.registered.length} skills bridged ` +
          `(skipped=${result.skipped.length}, errors=${result.errors.length})`,
      );
    } catch (err) {
      this.playgroundLogger.warn(
        `Failed to register playground skill domain: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
