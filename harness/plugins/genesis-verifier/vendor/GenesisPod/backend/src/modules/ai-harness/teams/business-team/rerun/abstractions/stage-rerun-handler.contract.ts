/**
 * BusinessAgentTeam — Stage Rerun Handler Contract
 *
 * 2026-05-24 (P5 Wave 1)：reference impl 中"stage handler 注册 + cascade
 * 链顺序执行 + best-effort partial"是机制，未来 social/radar 接入 rerun 时同样需要：
 *
 *   1. 同一 mission 想"从某个 stepId 起重跑下游链"
 *   2. cascade 链 = [stepId, ...successors]（DAG 上游已就位的产物不重跑）
 *   3. 每个 stage 失败不能让上游已成产物丢失（best-effort partial）
 *   4. cascade 跑成功后续 stage 共享上一 stage 的产物（mutable hydrated ctx）
 *
 * Framework 提供 cascade 调度骨架；business 提供：
 *   - stage handler registry: Map<stepId, StageRerunHandler<TContext>>
 *   - cascade chain provider:  stepId → string[]（业务自己的 DAG 走 computeCascadeChain）
 *   - rerunable check:         stepId → { rerunable: boolean; reason?: string }
 *   - emit hook:               把 cascade lifecycle 事件用业务 type 名 emit 出去
 *   - last-completed-stage 写库 hook（可选）：cascade 中每个 stage 完成后写回进度
 *
 * 跨业务复用证据：social mission cascade（discovery→fetch→qualify→post→relate）
 * 与 radar mission cascade（candidates→signals→materialize→narrative）都是同形的
 * "stepId 链 + best-effort + handler registry"，未来接入只需注入 hook。
 */

import type { Logger } from "@nestjs/common";

/**
 * Stage handler：一个 cascade stage 的真实执行函数。
 *
 * 入参：
 *   - ctx: 当前 cascade 中流动的 hydrated context（mutable，跨 stage 共享产物）
 *   - emit: 业务 emit fn（同一签名，避免 framework 依赖具体 EventBuffer）
 *   - stubs: handler 自己声明的依赖（DI 注入物，framework 不解释结构）
 *
 * 返回：
 *   - 新的 ctx（cascade 串起来时下个 stage 用此 ctx）
 *   - void：handler 不更新 ctx（legacy 路径）
 */
export type StageRerunHandler<TContext, TStubs, TEmit> = (
  ctx: TContext,
  emit: TEmit,
  stubs: TStubs,
) => Promise<TContext | void>;

/**
 * Cascade rerun 调度的入参。
 */
export interface CascadeRunInput<TContext, TEmit> {
  readonly ctx: TContext;
  readonly fromStepId: string;
  readonly emit: TEmit;
}

/**
 * Cascade rerun 调度的结果（best-effort partial）。
 */
export interface CascadeRunResult {
  /** 按顺序成功完成的 stepId */
  readonly completed: string[];
  /** 失败时的中止位置（undefined = 全链通过） */
  readonly abortedAt?: string;
  /** 失败原因（undefined = 全链通过） */
  readonly errorMessage?: string;
  /** 失败时未跑的下游 stepId */
  readonly remaining?: string[];
}

/**
 * Cascade 调度需要业务方提供的 hook。
 *
 * Framework 编排顺序、emit 桥接、错误捕获、last-stage 写库；business 提供：
 *   - handlers:           Map<stepId, handler>（业务自定义每 stage 怎么跑）
 *   - computeChain:       从 stepId 算出 cascade 链（业务自己的 PIPELINE_STEPS）
 *   - assertRerunable:    入站 stepId 校验（黑名单 / dag.rerunable）
 *   - eventTypes:         lifecycle / aborted 的业务 type 字符串
 *   - markStageProgress?: cascade 跑完每个 stage 后写库（可选）
 *   - log:                业务子类专属 Logger（带 namespace 前缀）
 *   - withMissionContext?: 让 framework 调度部分跑在业务 MissionContext 等域内
 */
/**
 * Note: TEmit 仅约束为 function（实参由业务自行定义）。framework 通过
 * `forwardEmit` helper 转发，业务可用宽松或严格的 EmitFn shape。
 */
export interface CascadeRunHooks<TContext, TStubs, TEmit> {
  readonly handlers: ReadonlyMap<
    string,
    StageRerunHandler<TContext, TStubs, TEmit>
  >;
  readonly computeChain: (fromStepId: string) => string[];
  readonly assertRerunable: (
    fromStepId: string,
  ) => { rerunable: true } | { rerunable: false; reason: string };
  readonly buildStubs: (ctx: TContext) => TStubs;
  /**
   * 可选：cascade 跑完后（成功 / 失败 / abort 均触发）的 cleanup hook。
   * 业务用此调 stubs.session.cleanup() 释放 abortRegistry / billing 等资源。
   * 调用顺序：finally 中（保证执行）。
   */
  readonly cleanupStubs?: (stubs: TStubs) => void | Promise<void>;
  readonly eventTypes: {
    readonly stageStarted: string;
    readonly cascadeAborted: string;
  };
  readonly markStageProgress?: (
    ctx: TContext,
    stepId: string,
    completed: string[],
  ) => Promise<void>;
  /**
   * Framework → business emit 桥接：framework 不知 business EmitFn 形状,通过此
   * hook 把 normalized event(type/payload) 投递给业务 emit（业务在此包装 missionId/
   * userId/traceId 等 EmitFn 必填字段）。
   */
  readonly forwardEmit: (
    rawEmit: TEmit,
    ctx: TContext,
    event: { type: string; payload: unknown },
  ) => Promise<void>;
  readonly log: Logger;
  /**
   * 把 dispatcher 跑在业务 context 域（如 MissionContext.run）。framework 调用此
   * hook 包裹内部 cascade 调度；business 可在此注入 missionId / userId 给链路追踪。
   */
  readonly withCascadeScope?: <T>(
    ctx: TContext,
    fn: () => Promise<T>,
  ) => Promise<T>;
}

/**
 * Stage handler 返回前/后 framework 调度 emit 的事件 payload 形状（框架定义；business
 * 在 eventTypes 配置 type 字符串）。
 */
export interface CascadeStageStartedPayload {
  readonly stepId: string;
  readonly fromStepId: string;
  readonly cascadeChain: readonly string[];
  readonly completedSoFar: readonly string[];
}

export interface CascadeAbortedPayload {
  readonly abortedAt: string;
  readonly completed: readonly string[];
  readonly remaining: readonly string[];
  readonly errorMessage: string;
  readonly partialModeNote: string;
}
