/**
 * IAgent — Model + Harness 封装体的运行时实例
 *
 * 区别：
 *   - IAgentIdentity = 蓝图（静态，描述"是谁"）
 *   - IAgent = 实例（运行时，"正在跑"）
 */

import type { IAgentIdentity } from "./identity.interface";
import type { IContextEnvelope } from "./context-envelope.interface";
import type { IAgentEvent } from "./agent-event.interface";
import type { ISubagentHandle, ISubagentSpec } from "./subagent.interface";
import type { AgentId } from "./agent.types";

/** Agent 运行时状态 */
export type AgentState =
  | "idle" // 未启动
  | "running" // 正在执行
  | "paused" // 暂停（HITL 等待）
  | "completed" // 成功完成
  | "failed" // 失败
  | "cancelled"; // 取消

/** PR-M: 失败模式分类 —— 业务方按 mode 选恢复策略 */
export type FailureMode =
  | "timeout"
  | "rate_limit"
  | "invalid_input"
  | "tool_error"
  | "schema_violation"
  | "context_too_long"
  | "no_credit"
  | "model_outage"
  | "user_cancelled"
  | "unknown";

export interface RetryPolicy {
  readonly maxRetries: number;
  /** 每种 failure mode 是否允许 retry */
  readonly retryableModes?: readonly FailureMode[];
  /** Backoff 策略 */
  readonly backoff?: "linear" | "exponential" | "constant";
  readonly initialDelayMs?: number;
}

/** 一次 execute 调用的输入 */
export interface IAgentTask {
  readonly goal: string;
  readonly input?: string | Record<string, unknown>;
  /** 覆盖 identity 默认约束 */
  readonly constraintsOverride?: Partial<IAgentIdentity["constraints"]>;
  /**
   * Phase P13-1: AbortSignal 透传 (mission-pipeline-baseline.md §9.4 / Q11)
   * Loop 内会检查 signal.aborted；上层 cancel 信号链到 LLM call。
   */
  readonly signal?: AbortSignal;

  /**
   * PR-M: 增量复用 —— 上次同一 task 的部分结果，executor 可决定复用还是重跑。
   * Topic Insights 的"incremental research"模式直接对应此字段。
   */
  readonly previousResult?: unknown;

  /** PR-M: 重试策略 */
  readonly retryPolicy?: RetryPolicy;

  /** PR-M: 业务自定义 metadata（dimensionId / topicId / missionId 等） */
  readonly metadata?: Record<string, unknown>;
}

/**
 * PR-M: 业务 Executor 在执行中可调用的运行时上下文。
 *
 * Topic Insights 的 dimension-research executor 在执行中发现"还需要研究子领域"
 * → 调 ctx.enqueueTask({ type, input }) 让 Leader 后续派发；
 * 失败时 → 抛 TaskExecutionError(mode) 让 Loop 按 retryPolicy 决策。
 */
export interface IAgentExecutionContext {
  /** 当前 envelope（含 runtimeEnv） */
  readonly envelope: IContextEnvelope;
  /** 入队新任务（运行时扩展） */
  enqueueTask(task: {
    type: string;
    input: unknown;
    dependsOn?: readonly string[];
    priority?: number;
    metadata?: Record<string, unknown>;
  }): void;
  /** 主动报告失败模式 */
  reportFailure(mode: FailureMode, detail?: string): void;
  /** 取出当前已积累的子任务（debug / observability） */
  getEnqueuedTasks(): readonly {
    type: string;
    input: unknown;
    dependsOn?: readonly string[];
    priority?: number;
  }[];
}

/** PR-M: 业务 executor 抛出此 error，Loop 按 retryPolicy 决定恢复 */
export class TaskExecutionError extends Error {
  constructor(
    public readonly mode: FailureMode,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(`[${mode}] ${message}`);
    this.name = "TaskExecutionError";
  }
}

/** 一次 execute 的最终结果 */
export interface IAgentResult {
  readonly output: string | Record<string, unknown>;
  readonly state: Exclude<AgentState, "idle" | "running" | "paused">;
  readonly iterations: number;
  readonly tokensUsed: number;
  readonly wallTimeMs: number;
  readonly errors?: readonly string[];
}

/** Agent 运行时实例 */
export interface IAgent {
  readonly id: AgentId;
  readonly identity: IAgentIdentity;
  readonly state: AgentState;

  /** 执行任务，流式发射事件 */
  execute(task: IAgentTask): AsyncIterable<IAgentEvent>;

  /** 派生子 Agent */
  spawnSubagent(spec: ISubagentSpec): Promise<ISubagentHandle>;

  /** 获取当前 context envelope 快照 */
  getEnvelope(): IContextEnvelope;

  /** 取消执行 */
  cancel(reason?: string): Promise<void>;
}
