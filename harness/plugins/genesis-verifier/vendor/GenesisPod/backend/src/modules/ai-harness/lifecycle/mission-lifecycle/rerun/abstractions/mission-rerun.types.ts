/**
 * MissionRerun abstractions（v5.1 §3.4 / §3.5 R1-D）
 *
 * Generic rerun primitive：从原 mission 派生新 mission，复用原 input + 可选
 * checkpoint clone + 可选 todo 局部重跑路由。所有业务规则（origin / scope /
 * 拒绝条件）通过 IMissionRerunPolicy 注入；orchestrator 自身不知 ai-app 命名。
 *
 * Adapter（consumer.config.ts 期 R2-A）：
 *   - consumer:    PlaygroundRerunPolicy.validateTodoRerun 实现 leader-assess-abort /
 *                    s11-persist 拒绝；cloneInput 解 mission.userProfile JSON
 *   - writing-team:  WritingTeamRerunPolicy.cloneInput 重建 RunDraftInput
 */
import type { MissionRecord } from "../../abstractions/mission-store.interface";

/**
 * 全 mission rerun 入参
 */
export interface RerunFullArgs {
  readonly sourceMissionId: string;
  /** 原 mission 持有者；orchestrator 用于做 mismatch 拒绝 */
  readonly userId: string;
}

/**
 * 单 todo rerun 入参（创建新 mission 跑 focus 流）
 *
 * @typeParam TBody - 业务自定义 todo body schema（consumer 含 origin / scope /
 *                    dimensionRef / chapterIndex / todoTitle / reasonText 等）
 */
export interface RerunTodoArgs<TBody = unknown> {
  readonly sourceMissionId: string;
  readonly userId: string;
  readonly todoId: string;
  readonly body: TBody;
}

/**
 * Rerun 结果（业务 controller 拼自己的 streamNamespace 等返回）
 */
export interface RerunResult {
  readonly newMissionId: string;
  readonly sourceMissionId: string;
}

/**
 * Override：cloneInput 时业务可注入的局部覆盖（todo rerun 场景常见 focused topic）
 */
export interface RerunInputOverrides {
  readonly topic?: string;
}

/**
 * MissionRunner —— orchestrator 不直接 import 业务 TeamMission；通过该接口
 * 委托真正的 mission 启动逻辑。返回 Promise 可 fire-and-forget；orchestrator
 * 用 logger 兜底 unhandled rejection。
 */
export interface IMissionRunner<TInput> {
  run(missionId: string, input: TInput, userId: string): Promise<void>;
}

/**
 * MissionRerunPolicy —— 业务策略钩子。三个职责：
 *   1. validateFullRerun: 全 mission 重跑可选拒绝（默认放行）
 *   2. validateTodoRerun: 单 todo 重跑可选拒绝（consumer 拒 leader-assess-abort 等）
 *   3. cloneInput: 把原 mission record 转成新 RunInput（必填，业务必知字段映射）
 *
 * 拒绝以 throw RerunNotAllowedError 表达；其它 error 透传。
 */
export interface IMissionRerunPolicy<
  TInput,
  TBusiness = Record<string, unknown>,
  TBody = unknown,
> {
  validateFullRerun?(record: MissionRecord<TBusiness>): void;
  validateTodoRerun?(
    record: MissionRecord<TBusiness>,
    args: RerunTodoArgs<TBody>,
  ): void;
  cloneInput(
    record: MissionRecord<TBusiness>,
    overrides: RerunInputOverrides,
  ): TInput;
}

/**
 * Optional checkpoint cloner（注入 ai-harness/memory checkpoint service 时启用）
 */
export interface IMissionCheckpointCloner {
  /** 复制 source mission 的 checkpoint 到 new mission；返回 true=复制成功 */
  clone(sourceMissionId: string, newMissionId: string): Promise<boolean>;
}

/**
 * Optional ownership assigner（注入 MissionOwnershipRegistry 时启用）
 */
export interface IMissionOwnershipAssigner {
  assign(missionId: string, userId: string): void;
}

/**
 * Optional logger（不 inject 时静默）
 */
export interface IMissionRerunLogger {
  log(message: string): void;
  error(message: string): void;
}

// ── Errors ───────────────────────────────────────────────────────────────

/**
 * Rerun 被拒绝（业务规则不允许 / source 仍在运行）；controller 转 BadRequest。
 */
export class RerunNotAllowedError extends Error {
  readonly code = "RERUN_NOT_ALLOWED";
  constructor(message: string) {
    super(message);
    this.name = "RerunNotAllowedError";
  }
}

/**
 * 找不到 source mission 或 user mismatch（不区分以避免 ownership 探测）；
 * controller 转 Forbidden。
 */
export class SourceMissionNotFoundError extends Error {
  readonly code = "SOURCE_MISSION_NOT_FOUND";
  constructor(missionId: string) {
    super(`source mission ${missionId} not found`);
    this.name = "SourceMissionNotFoundError";
  }
}
