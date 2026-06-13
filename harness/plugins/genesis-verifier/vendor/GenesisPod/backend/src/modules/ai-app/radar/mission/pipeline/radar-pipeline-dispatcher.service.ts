/**
 * RadarPipelineDispatcher —— Radar mission 入口（彻底重构后）
 *
 * 完全对齐 playground/PlaygroundPipelineDispatcher 范式：
 *   - 启动时 register RADAR_REFRESH_PIPELINE + RADAR_DISCOVERY_PIPELINE 到
 *     MissionPipelineRegistry（每个 step 注入业务 hook 闭包）
 *   - runRefreshMission / runDiscoveryMission 都走 MissionRuntimeShell.openSession
 *     + orchestrator.run({ signal, onEvent })
 *   - per-mission session 存 sessions Map，hook 闭包通过 sessionLookup 反查
 *   - mission 结束（成功 / 失败 / 取消）cleanup session
 *
 * 设计要点：
 *   - dispatcher 是 runtime-glue，业务逻辑全在 BusinessOrchestrator + 9 个 stage adapter
 *   - 事件桥接：orchestrator 内置 stage:started/completed/failed → 桥到
 *     ai-radar.run.stage，前端 ws 订阅这个事件
 *   - Discovery mission 也走完整 runtimeShell.openSession（含 abortRegistry / wallTimer
 *     / heartbeat / billing），adapter 自己识别 discovery input 跳过 createMissionRow。
 */
import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import {
  BusinessTeamMissionDispatcherFramework,
  EventBus,
  MissionPipelineOrchestrator,
  MissionPipelineRegistry,
  MissionAbortReason,
  MissionFailureCode,
  MissionLifecycleManager,
  mapAbortReasonToFailureCode,
  type MissionPipelineConfig,
  type ResolvedStageHooks,
} from "@/modules/ai-harness/facade";
import {
  RadarMissionRuntimeShell,
  type MissionRuntimeSession,
} from "./radar-mission-runtime-shell.service";
import { RadarBusinessOrchestrator } from "./radar-business-orchestrator.service";
import { RadarMissionStore } from "../lifecycle/radar-mission-store.service";
import {
  RADAR_DISCOVERY_PIPELINE,
  RADAR_REFRESH_PIPELINE,
} from "../../runtime/radar.config";
import { RADAR_EVENTS } from "../../runtime/radar.constants";
import {
  emptyRadarMissionState,
  type RadarMissionContext,
} from "./stages/radar-stage-types";
import type {
  RunRadarDiscoveryMissionInput,
  RunRadarRefreshMissionInput,
} from "../../api/dto/run-radar-refresh-mission.dto";

export interface RadarMissionSummary {
  readonly missionId: string;
  // mission lifecycle 标准 4 终态（小写，对齐前端 RadarRunStatus + DB
  // VarChar(20) 值域）；2026-05-17 R4-B 加 'rejected' 闭环 markRejected。
  // 早期写 "aborted" 是私造词，已统一改 "cancelled"
  readonly status: "completed" | "failed" | "cancelled" | "rejected";
  readonly stageOutputs: Record<string, unknown>;
  /**
   * Discovery mission 特有：source-curator agent 输出的候选列表
   * （从 ctx.state.discoveryCandidates 取出）
   */
  readonly discoveryCandidates?: unknown[];
  /**
   * R7 2026-05-19：discovery stage preflight 过滤掉的不可达候选 + 原因，
   * 前端展示"AI 推荐 X 个，已过滤 Y 个不可达"。
   */
  readonly discoverySkipped?: Array<{
    type: string;
    identifier: string;
    reason: string;
  }>;
  readonly error?: unknown;
}

interface SessionEntry {
  readonly session: MissionRuntimeSession;
  readonly t0: number;
  readonly ctx: RadarMissionContext;
}

/**
 * 2026-05-17 R4-B 闭环：识别 framework 抛出的 reject 类异常（budget /
 * rate-limit / quota / forbidden），让 dispatcher.catch 分支调
 * markRejected 而不是 markFailed。
 *
 * 选 message 关键字匹配而不是 instanceof，原因：
 *   - ai-harness 框架的具体异常类（BudgetExceededException 等）契约还在演进
 *   - radar-mission-runtime-shell 当前以 generic Error 抛 message 出来
 *   - 关键字列表与既有 isAbort = message.includes("abort") 同模式
 *
 * 未来 ai-harness 暴露稳定异常类后可改 instanceof 判断，同步更新此 helper
 * 与对应 spec。
 */
const REJECT_MESSAGE_PATTERNS = [
  /budget[_\s-]*(exceed|exhaust|over|too)/i,
  /(insufficient|low|no)\s+budget/i,
  /rate[_\s-]*limit/i,
  /quota[_\s-]*(exceed|exhaust|over)/i,
  /forbidden/i,
  /\bRejected\b/i,
  /pre[_\s-]?check[_\s-]+(fail|reject)/i,
];

export function isLikelyRejection(message: string): boolean {
  return REJECT_MESSAGE_PATTERNS.some((re) => re.test(message));
}

@Injectable()
export class RadarPipelineDispatcher
  extends BusinessTeamMissionDispatcherFramework
  implements OnModuleInit
{
  private readonly sessions = new Map<string, SessionEntry>();

  constructor(
    private readonly registry: MissionPipelineRegistry,
    private readonly orchestrator: MissionPipelineOrchestrator,
    private readonly runtimeShell: RadarMissionRuntimeShell,
    private readonly businessOrch: RadarBusinessOrchestrator,
    eventBus: EventBus,
    private readonly store: RadarMissionStore,
    // ★ C0/G1：唯一终态写入口。dispatcher 不再直写 store.markX，统一经 finalize 仲裁。
    private readonly lifecycleManager: MissionLifecycleManager,
  ) {
    // 2026-05-24 P4: framework 提供 emitToBus + bridgeOrchestratorStageEvent
    //   通用 mechanism；本 dispatcher 仅注入 radar 专属事件 type 字符串。
    //   注意：radar 业务侧 stage 事件用 RADAR_EVENTS.RUN_STAGE 单一类型（非
    //   `stage:lifecycle / stage:stalled / stage:degraded` 三分），故 framework
    //   bridge 不能直接用——radar 用自己的 handleOrchestratorEvent。
    //   但 emitToBus 通用 helper 仍受益继承。配置中 stage* 字段仅占位，
    //   framework bridgeOrchestratorStageEvent 不会在 radar 路径被调用。
    super(eventBus, {
      namespace: "radar",
      stageLifecycleEvent: "radar.stage:lifecycle",
      stageStalledEvent: "radar.stage:stalled",
      stageDegradedEvent: "radar.stage:degraded",
    });
  }

  async onModuleInit(): Promise<void> {
    this.businessOrch.bindSessionLookup((missionId) => {
      const entry = this.sessions.get(missionId);
      if (!entry) {
        throw new Error(
          `[radar-pipeline] no active session for mission ${missionId}`,
        );
      }
      return entry.ctx;
    });

    await this.businessOrch.preloadSystemPrompts();

    if (!this.registry.has(RADAR_REFRESH_PIPELINE.id)) {
      this.registry.register(
        this.buildPipelineWithHooks(RADAR_REFRESH_PIPELINE),
      );
      this.log.log(
        `[radar-pipeline] registered "${RADAR_REFRESH_PIPELINE.id}" (8 step)`,
      );
    }
    if (!this.registry.has(RADAR_DISCOVERY_PIPELINE.id)) {
      this.registry.register(
        this.buildPipelineWithHooks(RADAR_DISCOVERY_PIPELINE),
      );
      this.log.log(
        `[radar-pipeline] registered "${RADAR_DISCOVERY_PIPELINE.id}" (1 step)`,
      );
    }
  }

  async runRefreshMission(
    input: RunRadarRefreshMissionInput,
    userId: string,
    opts: { missionId?: string; workspaceId?: string } = {},
  ): Promise<RadarMissionSummary> {
    const missionId = opts.missionId ?? randomUUID();
    return this.runMission({
      missionId,
      pipelineId: RADAR_REFRESH_PIPELINE.id,
      input,
      userId,
      workspaceId: opts.workspaceId,
      trigger: input.trigger,
    });
  }

  async runDiscoveryMission(
    input: RunRadarDiscoveryMissionInput,
    userId: string,
    opts: { missionId?: string; workspaceId?: string } = {},
  ): Promise<RadarMissionSummary> {
    const missionId = opts.missionId ?? randomUUID();
    return this.runMission({
      missionId,
      pipelineId: RADAR_DISCOVERY_PIPELINE.id,
      input,
      userId,
      workspaceId: opts.workspaceId,
      trigger: "MANUAL",
    });
  }

  /**
   * 共通 mission 执行流程（refresh + discovery 共用 runtimeShell.openSession
   * 走完整 framework lifecycle —— framework adapter 自己识别 discovery input
   * 跳过 createMissionRow，但 abortRegistry / wallTimer / heartbeat 全保留）。
   */
  private async runMission(args: {
    missionId: string;
    pipelineId: string;
    input: RunRadarRefreshMissionInput | RunRadarDiscoveryMissionInput;
    userId: string;
    workspaceId?: string;
    trigger: "MANUAL" | "SCHEDULED" | "FIRST_RUN";
  }): Promise<RadarMissionSummary> {
    const { missionId, pipelineId, input, userId, workspaceId, trigger } = args;
    const t0 = Date.now();
    const isDiscovery = pipelineId === RADAR_DISCOVERY_PIPELINE.id;

    const session = await this.runtimeShell.openSession({
      missionId,
      input,
      userId,
      workspaceId,
    });

    const ctx: RadarMissionContext = {
      missionId,
      userId,
      trigger,
      input,
      state: emptyRadarMissionState(),
      signal: session.missionAbort.signal,
      // stage 内细粒度事件 emit（source-progress 等）—— fire-and-forget，
      // emitToBus 自身已 catch，故 void 即可（no-floating-promises）。
      emit: (type, payload) => {
        void this.emitToBus({ type, missionId, userId, payload });
      },
    };
    this.sessions.set(missionId, { session, t0, ctx });

    const topicId = input.topicId;

    if (!isDiscovery) {
      await this.emitToBus({
        type: RADAR_EVENTS.RUN_STARTED,
        missionId,
        userId,
        payload: {
          runId: missionId,
          topicId,
          trigger,
          startedAt: new Date(t0).toISOString(),
        },
      });
    }

    try {
      const result = await this.runtimeShell.runWithinContext(session, () =>
        this.orchestrator.run({
          missionId,
          pipelineId,
          input,
          userId,
          tenantId: workspaceId,
          signal: session.missionAbort.signal,
          onEvent: async (event) =>
            this.handleOrchestratorEvent(missionId, userId, event),
        }),
      );

      const durationMs = Date.now() - t0;
      if (isDiscovery) {
        const candidates =
          (ctx.state as { discoveryCandidates?: unknown[] })
            .discoveryCandidates ?? [];
        const skipped =
          (
            ctx.state as {
              discoverySkipped?: Array<{
                type: string;
                identifier: string;
                reason: string;
              }>;
            }
          ).discoverySkipped ?? [];
        return {
          missionId,
          status: "completed",
          stageOutputs: result.stageOutputs,
          discoveryCandidates: candidates,
          discoverySkipped: skipped,
        };
      }

      await this.lifecycleManager.finalize({
        missionId,
        intent: {
          status: "completed",
          extra: {
            kind: "completed",
            metrics: { ...ctx.state.metrics, durationMs },
          },
        },
        arbiter: this.store,
        // 只有赢得仲裁（本次首写 completed）才广播，避免与 abort/liveness 抢写后误发
        onWon: async () => {
          await this.emitToBus({
            type: RADAR_EVENTS.RUN_COMPLETED,
            missionId,
            userId,
            payload: {
              runId: missionId,
              topicId,
              // 2026-05-17 R4-B：小写对齐 DB VarChar(20) + 前端 RadarRunStatus
              // 类型枚举，原 "COMPLETED" 大写让前端 if (status==='completed') 恒 false
              status: "completed",
              durationMs,
              metrics: ctx.state.metrics,
            },
          });
        },
      });
      return {
        missionId,
        status: "completed",
        stageOutputs: result.stageOutputs,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err ?? "unknown error");
      const durationMs = Date.now() - t0;
      if (isDiscovery) {
        return { missionId, status: "failed", stageOutputs: {}, error: err };
      }
      // ★ MAJOR-3/C0:按 abort **reason** 分流,不再用 signal.aborted 一刀切成 cancelled。
      //   只有真正的"取消意图"(用户取消 / rerun 替换 / 被取代)才落 cancelled;
      //   budget/超时/孤儿等 abort 是**失败**,落 markFailed + canonical failureCode,
      //   否则真因 budget_exhausted/wall_time_exceeded 会被错记成 cancelled(C0 要消灭的场景)。
      const abortReason: MissionAbortReason | undefined = ctx.signal.aborted
        ? (ctx.signal.reason as MissionAbortReason)
        : undefined;
      const isGenuineCancel =
        abortReason === MissionAbortReason.user_cancelled ||
        abortReason === MissionAbortReason.rerun_replacing_stale ||
        abortReason === MissionAbortReason.superseded;
      if (isGenuineCancel) {
        // abort signal 已在取消源触发（故走到此 catch），finalize 不再重复 abort。
        await this.lifecycleManager.finalize({
          missionId,
          intent: {
            status: "cancelled",
            reason: abortReason,
            failureCode: MissionFailureCode.user_cancelled,
            extra: { kind: "cancelled", reason: message },
          },
          arbiter: this.store,
          onWon: async () => {
            await this.emitToBus({
              type: RADAR_EVENTS.RUN_CANCELLED,
              missionId,
              userId,
              payload: {
                runId: missionId,
                topicId,
                reason: abortReason,
              },
            });
          },
        });
        return {
          missionId,
          status: "cancelled",
          stageOutputs: {},
          error: err,
        };
      }
      // 2026-05-17 R4-B 闭环：识别 framework reject 类异常（budget 预检 /
      // rate-limit / forbidden / quota-exceeded）→ 调 markRejected + emit
      // RUN_REJECTED。原仅留 TODO 注释不接通 = R3 P0 #3 markRejected 方法是
      // dead code。同 message 检测策略与 isAbort 一致，避免依赖 framework
      // 自造异常类（ai-harness 边界契约稳定后可换 instanceof 判断）。
      const isRejected = isLikelyRejection(message);
      if (isRejected) {
        // reject = budget 预检/限额拒绝：平台 outcome=failure(G6)，DB 落 'rejected' 保业务细分。
        await this.lifecycleManager.finalize({
          missionId,
          intent: {
            status: "failed",
            failureCode: MissionFailureCode.budget_exhausted,
            errorMessage: message,
            extra: { kind: "rejected", reason: message },
          },
          arbiter: this.store,
          onWon: async () => {
            await this.emitToBus({
              type: RADAR_EVENTS.RUN_REJECTED,
              missionId,
              userId,
              payload: {
                runId: missionId,
                topicId,
                reason: message,
              },
            });
          },
        });
        return {
          missionId,
          status: "rejected",
          stageOutputs: {},
          error: err,
        };
      }
      // budget/超时等失败型 abort:传 canonical failureCode(精确),否则 store 走 message 启发式。
      const failureCode =
        abortReason != null
          ? mapAbortReasonToFailureCode(abortReason)
          : undefined;
      await this.lifecycleManager.finalize({
        missionId,
        intent: {
          status: "failed",
          reason: abortReason,
          failureCode,
          errorMessage: message,
          extra: { kind: "failed", error: message },
        },
        arbiter: this.store,
        onWon: async () => {
          await this.emitToBus({
            type: RADAR_EVENTS.RUN_FAILED,
            missionId,
            userId,
            payload: {
              runId: missionId,
              topicId,
              error: message,
              failureCode,
              durationMs,
            },
          });
        },
      });
      return { missionId, status: "failed", stageOutputs: {}, error: err };
    } finally {
      session.cleanup();
      this.sessions.delete(missionId);
    }
  }

  /**
   * 桥接 orchestrator 的 stage:* 事件到 radar.run.stage（前端 ws 订阅这个）。
   */
  private async handleOrchestratorEvent(
    missionId: string,
    userId: string,
    event: {
      type: string;
      stepId?: string;
      primitive?: string;
      timestamp?: number;
      error?: unknown;
      output?: unknown;
    },
  ): Promise<void> {
    if (!event.stepId) return;
    if (
      event.type !== "stage:started" &&
      event.type !== "stage:completed" &&
      event.type !== "stage:failed"
    ) {
      return;
    }
    const status =
      event.type === "stage:started"
        ? "started"
        : event.type === "stage:completed"
          ? "completed"
          : "failed";
    const entry = this.sessions.get(missionId);
    const topicId = entry?.ctx.input?.topicId ?? "";
    await this.emitToBus({
      type: RADAR_EVENTS.RUN_STAGE,
      missionId,
      userId,
      payload: {
        runId: missionId,
        topicId,
        stage: event.stepId,
        status,
        ...(status === "failed"
          ? {
              message:
                event.error instanceof Error
                  ? event.error.message
                  : String(event.error ?? ""),
            }
          : {}),
      },
      timestamp: event.timestamp,
    });
  }

  // 2026-05-24 P4: emitToBus 已上提到 BusinessTeamMissionDispatcherFramework，
  //   本 dispatcher 通过继承直接复用（this.emitToBus(...)），不再本地定义。

  /**
   * 取消 mission（controller 调）：触发 abortRegistry.abort → orchestrator
   * 内部 signal.aborted=true → 各 stage 早断 → finally cleanup。
   */
  abortMission(missionId: string, reason = "user_cancelled"): boolean {
    const entry = this.sessions.get(missionId);
    if (!entry) return false;
    try {
      entry.session.missionAbort.abort(reason);
      return true;
    } catch (err) {
      this.log.warn(
        `[radar-pipeline] abort ${missionId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  private buildPipelineWithHooks(
    config: MissionPipelineConfig,
  ): MissionPipelineConfig {
    const stepHooks: Record<string, ResolvedStageHooks> = {};
    for (const step of config.steps) {
      stepHooks[step.id] = this.businessOrch.buildHooksForStep(step.id);
    }
    return {
      ...config,
      steps: config.steps.map((s) => ({
        ...s,
        hooks: stepHooks[s.id] ?? {},
      })),
    };
  }
}
