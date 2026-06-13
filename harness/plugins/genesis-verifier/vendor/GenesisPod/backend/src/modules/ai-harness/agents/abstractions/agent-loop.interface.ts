/**
 * Agent Loop — 决策循环（perceive → reason → act → reflect）
 *
 * Loop 是循环骨架；reasoning 策略（CoT / ReAct / ToT / Reflexion）是可插拔的。
 * Phase 1 只定义接口，具体 loop 实现在 Phase 2 落地。
 */

import type { IAgentEvent } from "./agent-event.interface";
import type { IContextEnvelope } from "./context-envelope.interface";
import type { IAction, IActionResult } from "./action.interface";

/** Loop 类型标识 */
export type AgentLoopKind =
  | "react"
  | "plan-execute"
  | "reflexion"
  | "leader-worker" // PR-L: 五元环
  | "simple";

/** Loop 单步的四阶段结果 */
export interface ILoopStep {
  readonly iteration: number;
  readonly perceived: IContextEnvelope;
  readonly reasoning: string; // LLM 产生的思考
  readonly action: IAction;
  readonly actionResult: IActionResult;
  readonly reflection?: string; // reflexion 才有
  readonly terminated: boolean;
}

/** Loop 终止条件 */
export interface ILoopTerminationCriteria {
  readonly maxIterations: number;
  readonly maxTokens?: number;
  readonly maxWallTimeMs?: number;
  /** 自定义终止判定（见到 finalize action 即终止） */
  readonly terminateOn?: readonly IAction["kind"][];
  /**
   * ★ 工具前置闸：为 true 时，agent 必须至少成功调用一次真实工具后才允许 finalize。
   * 用于 researcher 这类"必须先检索再产出"的角色，杜绝 0 工具直接幻觉 finalize。
   * 默认 false（向后兼容：leader/outline 等合法零工具 agent 不受影响）。
   */
  readonly requireToolBeforeFinalize?: boolean;
}

/** Loop 运行选项（v2 · 支持 access matrix + agent id + signal） */
export interface ILoopRunOptions {
  readonly agentId?: string;
  readonly signal?: AbortSignal;
  /** v2 access matrix：允许的 tool id（空 = 无限制） */
  readonly allowedTools?: readonly string[];
  /** v2 access matrix：禁止的 tool id（优先级高于 allowedTools） */
  readonly forbiddenTools?: readonly string[];
  /**
   * 模型级 failover provider（可选）。当 chat()/reason() 抛出（或返回）provider 级
   * 错误且 isModelLevelFailoverError 为真时，loop 调用本回调换一个模型重试，而非
   * 直接终止。入参是已失败的 modelId 列表（供排除），返回下一个候选 modelId 或
   * null（无更多候选 → loop 落回原有 error/terminated 路径）。
   *
   * AgentFactory 按 BYOK / admin 注入对应闭包；react-loop 自带 #66 实现，
   * simple-loop / plan-act 经 executeWithModelFailover 共享 helper 使用本字段。
   */
  readonly modelFailoverProvider?: (
    excludeModelIds: ReadonlyArray<string>,
    excludeProviders?: ReadonlyArray<string>,
  ) => Promise<string | null | undefined>;
}

/** AgentLoop 接口 */
export interface IAgentLoop {
  readonly kind: AgentLoopKind;
  run(
    envelope: IContextEnvelope,
    criteria: ILoopTerminationCriteria,
    options?: ILoopRunOptions,
  ): AsyncIterable<IAgentEvent>;
}
