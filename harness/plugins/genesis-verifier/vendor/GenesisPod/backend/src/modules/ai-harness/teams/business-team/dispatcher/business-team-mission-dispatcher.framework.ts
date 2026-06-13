/**
 * BusinessAgentTeam — Mission Dispatcher Framework
 *
 * 三家 ai-app mission dispatcher 的通用 runtime-glue：
 *   - `emitToBus(event)` — 统一事件出口（catch + log，event 失败不阻断 dispatcher）
 *   - `bridgeOrchestratorStageEvent(event, ctx, opts)` — orchestrator 的 stage 级
 *     lifecycle/stalled/degraded 事件桥接到 EventBus（namespaced）
 *
 * 业务侧 dispatcher 实现 `runMission` 主流程（每团队 finalize 规则、failureCode 分类、
 * crash-resume / dedup window / discovery vs refresh dual-pipeline 等都不同），
 * framework 不替业务方决策这些；只下沉**纯机制**部分。
 *
 * 2026-05-24 (P4) 抽取自三家业务侧 pipeline-dispatcher 公共 emit/bridge 逻辑:
 *   - ai-app/playground/services/mission/workflow/playground-pipeline-dispatcher.service.ts emitToBus + onEvent bridge  @migrated-from
 *   - ai-app/social/services/mission/workflow/social-pipeline-dispatcher.service.ts bridgeOrchestratorEvent  @migrated-from
 *   - ai-app/radar/services/mission/workflow/radar-pipeline-dispatcher.service.ts handleOrchestratorEvent + emitToBus  @migrated-from
 *
 * 业务侧扩展模板：
 * ```ts
 * @Injectable()
 * export class MyPipelineDispatcher extends BusinessTeamMissionDispatcherFramework {
 *   constructor(eventBus: EventBus, ...) {
 *     super(eventBus, {
 *       namespace: "my-app",
 *       stageLifecycleEvent: "my-app.stage:lifecycle",
 *       stageStalledEvent: "my-app.stage:stalled",
 *       stageDegradedEvent: "my-app.stage:degraded",
 *     });
 *   }
 *   async runMission(missionId, input, userId): Promise<...> {
 *     // ... openSession → orchestrator.run({ onEvent: e => this.bridgeOrchestratorStageEvent(e, { missionId, userId }) })
 *     //     → finalize → cleanup
 *   }
 * }
 * ```
 */

import { Logger } from "@nestjs/common";
// ★ 不走 facade barrel（与同目录其他 framework 一致，详见 mission-runtime-shell.framework.ts）：
//   facade/index.ts 会 re-export 本 framework，构成循环加载。
import { EventBus } from "@/common/events/event-bus";
import type {
  BusinessTeamMissionBusEvent,
  MapStepIdHook,
  OrchestratorStageEventLike,
} from "./abstractions/business-team-mission-dispatcher.interface";

/**
 * Framework 配置：业务团队的事件 type 字符串（namespace prefix）注入点。
 *
 * 4 个事件 type 全由业务方决定（不在 framework 里硬编码 `${namespace}.stage:lifecycle`
 * 模板拼接，避免业务方未来改 type 字符串时被 framework 锁死）。
 */
export interface BusinessTeamMissionDispatcherConfig {
  /** logger 标签（业务子类名）+ 错误日志前缀 */
  readonly namespace: string;
  /** stage:started/completed/failed 桥接后 emit 的 type，如 `${ns}.stage:lifecycle` */
  readonly stageLifecycleEvent: string;
  /** stage:stalled 桥接后 emit 的 type */
  readonly stageStalledEvent: string;
  /** stage:degraded 桥接后 emit 的 type */
  readonly stageDegradedEvent: string;
  /**
   * 可选：把 orchestrator stepId 映射到前端 stage id（部分业务团队需要 step →
   * frontend stage 映射）；不提供时 stage 字段直接用 stepId。
   */
  readonly mapStepId?: MapStepIdHook;
}

/** Context for bridging an orchestrator event to the bus */
export interface BridgeContext {
  readonly missionId: string;
  readonly userId: string;
}

export abstract class BusinessTeamMissionDispatcherFramework {
  protected readonly log: Logger;

  constructor(
    protected readonly eventBus: EventBus,
    protected readonly config: BusinessTeamMissionDispatcherConfig,
  ) {
    this.log = new Logger(`${config.namespace}-pipeline-dispatcher`);
  }

  /**
   * 统一事件出口 —— 所有 dispatcher 直接 emit 的事件都走 eventBus（同时分发给
   * MissionEventBuffer adapter + Socket adapter）。emit 失败时 log warn 不阻断
   * dispatcher 主流程（critical 失败由 eventBus 自身告警）。
   */
  protected async emitToBus(event: BusinessTeamMissionBusEvent): Promise<void> {
    await this.eventBus
      .emit({
        type: event.type,
        scope: { missionId: event.missionId, userId: event.userId },
        payload: event.payload,
        timestamp: event.timestamp ?? Date.now(),
      })
      .catch((err: unknown) => {
        this.log.warn(
          `[${this.config.namespace}] emit ${event.type} for ${event.missionId} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  /**
   * 把 orchestrator 内置的 stage 级事件（stage:started / stage:completed /
   * stage:failed / stage:stalled / stage:degraded）桥接到 EventBus，
   * 用业务方注入的 type 字符串。
   *
   * 返回 true 表示事件已被 framework 接管（业务侧 onEvent 不需要再处理）；
   * 返回 false 表示事件类型不属于本桥（业务方自己处理 mission:* 等其它事件）。
   *
   * Stage hook output（如 dimensions / themeSummary / results / finalScore）由
   * orchestrator stage:completed 携带 → 平铺到 lifecycle payload 的 output 字段
   * 下，stage 文件不再 emit 业务级 stage:metrics（单轨化避免双源）。
   */
  protected async bridgeOrchestratorStageEvent(
    event: OrchestratorStageEventLike,
    ctx: BridgeContext,
  ): Promise<boolean> {
    if (!event.stepId) return false;
    const stage = this.config.mapStepId
      ? this.config.mapStepId(event.stepId)
      : event.stepId;
    if (
      event.type === "stage:started" ||
      event.type === "stage:completed" ||
      event.type === "stage:failed"
    ) {
      const status =
        event.type === "stage:started"
          ? "started"
          : event.type === "stage:completed"
            ? "completed"
            : "failed";
      const output = event.output as Record<string, unknown> | undefined;
      await this.emitToBus({
        type: this.config.stageLifecycleEvent,
        missionId: ctx.missionId,
        userId: ctx.userId,
        payload: {
          stage,
          stepId: event.stepId,
          primitive: event.primitive,
          status,
          ...(output ? { output } : {}),
          ...(status === "failed"
            ? {
                error:
                  event.error instanceof Error
                    ? event.error.message
                    : String(event.error ?? ""),
              }
            : {}),
        },
        timestamp: event.timestamp,
      });
      return true;
    }
    if (event.type === "stage:stalled") {
      await this.emitToBus({
        type: this.config.stageStalledEvent,
        missionId: ctx.missionId,
        userId: ctx.userId,
        payload: {
          stage,
          stepId: event.stepId,
          elapsedMs: event.elapsedMs,
          reason: event.reason,
        },
        timestamp: event.timestamp,
      });
      return true;
    }
    if (event.type === "stage:degraded") {
      await this.emitToBus({
        type: this.config.stageDegradedEvent,
        missionId: ctx.missionId,
        userId: ctx.userId,
        payload: {
          stage,
          stepId: event.stepId,
          reason: event.reason,
        },
        timestamp: event.timestamp,
      });
      return true;
    }
    return false;
  }
}
