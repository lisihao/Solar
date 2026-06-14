/**
 * BusinessAgentTeam — Mission Dispatcher Framework 接口
 *
 * 业务团队 mission dispatcher 协议；framework 提供 emitToBus / bridgeStageEvents
 * 等通用 mechanism，业务侧实现 runMission 主流程（每团队 lifecycle 终态规则不同）。
 *
 * 2026-05-24 (P4) 抽取自三家 ai-app 业务侧 pipeline-dispatcher 公共部分:
 *   - ai-app/playground/services/mission/workflow/playground-pipeline-dispatcher.service.ts  @migrated-from
 *   - ai-app/social/services/mission/workflow/social-pipeline-dispatcher.service.ts  @migrated-from
 *   - ai-app/radar/services/mission/workflow/radar-pipeline-dispatcher.service.ts  @migrated-from
 */

/** Orchestrator → bus 事件桥接的输入事件最小契约 */
export interface OrchestratorStageEventLike {
  readonly type: string;
  readonly stepId?: string;
  readonly primitive?: string;
  readonly output?: unknown;
  readonly error?: unknown;
  readonly elapsedMs?: number;
  readonly reason?: string;
  readonly timestamp: number;
}

/** 桥接后业务侧 emit 出去的事件统一形状 */
export interface BusinessTeamMissionBusEvent {
  readonly type: string;
  readonly missionId: string;
  readonly userId: string;
  readonly payload: unknown;
  readonly timestamp?: number;
}

/**
 * 业务侧把 stepId 映射到前端 stage id 的可选 hook
 * （部分业务有 step → frontend stage 映射；不提供时 stage 字段直接用 stepId）。
 */
export type MapStepIdHook = (stepId: string) => string;
