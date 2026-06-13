/**
 * SOTA Runtime · Shared Types（通用 DSL，零业务字段）
 *
 * 方案文档：docs/architecture/ai-harness/redesign/30-sota-task-centric-architecture.md §0.3 §4
 *
 * 架构归属硬约束（方案 §0.1）：
 *   - 本文件不得 import 任何 ai-app/** 业务 model
 *   - 不得 import @prisma/client 里业务命名的 model（ResearchTask / TopicReport / ...）
 *   - 所有业务字段（missionId / topicId / dimensionId / ...）通过泛型 TMetadata 注入
 *
 * 消费方：
 *   - ai-harness/runner/*（本层）
 *   - ai-app/{any}/agent/adapters/* 适配层（把业务 model 转成 AgentTask<TMetadata>）
 */

/**
 * AgentTask — 通用执行单位
 *
 * 任何 AI App（业务模块 / teams / writing / ...）都可以把自己的业务
 * 任务行（ResearchTask / ResearchMission / TeamTurn / ...）包成 AgentTask 喂给 ReAct runner。
 *
 * 业务字段走 metadata 泛型，runner 对它零感知。
 */
export interface AgentTask<TMetadata = Record<string, unknown>> {
  /** 业务 id（由 adapter 从业务表的 id 透传） */
  readonly id: string;
  /** task 类型（映射到 Protocol 注册表） */
  readonly type: string;
  /** 人类可读标题（日志/UI 用） */
  readonly title: string;
  /** 自然语言描述（初始 prompt 用） */
  readonly description: string;
  /** 执行预配（modelId/skills/tools，由 Leader agent 产出） */
  readonly input: Record<string, unknown>;
  /** 当前 ReAct iteration */
  readonly currentIteration: number;
  /** 最大 iteration 硬上限 */
  readonly maxIterations: number;
  /** 已 retry 次数 */
  readonly retryCount: number;
  /** 最大 retry */
  readonly maxRetries: number;
  /** 业务上下文（missionId / topicId / parentTaskId / ...）— 泛型注入 */
  readonly metadata: TMetadata;
}

/**
 * AgentStepRecord — 通用 step 记录（通用 DSL，不含业务字段）
 *
 * StepStore 实现方（App 层 adapter）把此对象转换为业务表行（带 missionId/topicId）。
 */
export interface AgentStepRecord {
  readonly taskId: string;
  readonly iteration: number;
  readonly stepIndex: number;
  readonly stepType: AgentStepType;
  readonly content?: string;
  readonly structuredData?: unknown;
  readonly modelId?: string;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly costUsd?: number;
  readonly toolName?: string;
  readonly toolArgs?: Record<string, unknown>;
  readonly toolResult?: unknown;
  readonly toolLatencyMs?: number;
  readonly toolSuccess?: boolean;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly parentSpanId?: string;
}

export type AgentStepType =
  | "OBSERVE"
  | "THINK"
  | "PLAN"
  | "TOOL_CALL"
  | "TOOL_RESULT"
  | "REFLECT"
  | "SELF_EVAL"
  | "JUDGE_EVAL"
  | "HUMAN_INPUT"
  | "CHECKPOINT"
  | "DONE";

/**
 * TaskStatus — 通用 FSM 状态（业务可映射到自家 enum）
 */
export type TaskStatus =
  | "CREATED"
  | "QUEUED"
  | "SCHEDULED"
  | "RUNNING"
  | "PAUSED"
  | "AWAITING_HUMAN"
  | "VERIFYING"
  | "NEEDS_REVISION"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

/**
 * Observation — ReAct loop 中的观察
 */
export interface Observation {
  readonly source: string; // tool id / 'initial' / 'human_input'
  readonly data: unknown;
  readonly timestamp: number;
}

/**
 * Scratchpad — agent 短期记忆（iter 间共享）
 */
export interface Scratchpad {
  notes: string[];
  keyFindings: string[];
  pendingQuestions: string[];
  [key: string]: unknown;
}

/**
 * AgentAction — LLM 决定下一步动作
 */
export type AgentAction =
  | {
      kind: "tool_call";
      tool: string;
      args: Record<string, unknown>;
      rationale?: string;
      toolCallId?: string;
    }
  | { kind: "done"; rationale?: string }
  | { kind: "think_more"; thought: string }
  | { kind: "need_human"; question: string }
  | { kind: "abort"; reason: string };

/**
 * Message — OpenAI-style chat message
 */
export interface Message {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly toolCallId?: string;
  readonly toolCalls?: ToolCall[];
}

export interface ToolCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly id: string;
}

/**
 * ToolResult — 统一 tool 返回
 */
export interface ToolResult<T = unknown> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly latencyMs: number;
  readonly costUsd?: number;
}

/**
 * Verdict — 单 judge 的评价
 */
export interface Verdict {
  readonly judgeId: string;
  readonly score: number; // 0-100
  readonly critique: string;
  readonly criteria?: Record<string, number>;
  readonly modelId?: string;
}

/**
 * ConsensusDecision — multi-judge 仲裁结果
 */
export interface ConsensusDecision {
  readonly verdict: "pass" | "fail" | "escalate_to_meta" | "escalate_to_human";
  readonly score: number;
  readonly note?: string;
}

/**
 * TokenBudget — task 级预算
 */
export interface TokenBudget {
  readonly maxTokens: number;
  readonly maxCostUsd: number;
}

/**
 * ModelPreference — 调模型偏好
 */
export interface ModelPreference {
  readonly creativity?: "deterministic" | "low" | "medium" | "high";
  readonly outputLength?: "minimal" | "short" | "medium" | "long" | "extended";
  readonly reasoningDepth?: "shallow" | "moderate" | "deep";
}

/**
 * CheckpointData — 崩溃恢复快照
 */
export interface CheckpointData {
  readonly iteration: number;
  readonly stepIndex: number;
  readonly observations: readonly Observation[];
  readonly reasoningMemory: Scratchpad;
  readonly toolInvocationHistory: readonly ToolInvocation[];
  readonly budgetSnapshot: BudgetSnapshot;
  readonly reason?: string;
}

export interface ToolInvocation {
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly result: ToolResult;
  readonly iteration: number;
  readonly stepIndex: number;
}

export interface BudgetSnapshot {
  readonly tokensUsed: number;
  readonly costUsd: number;
  readonly currentTier: "strong" | "standard" | "basic";
  /**
   * 模型未在 ModelPricingRegistry 注册的累计调用次数。
   * > 0 表示 costUsd 是不完整的——caller 应警示用户去 DB 给那些 model 配 costTier+price。
   */
  readonly uncostedLLMCalls?: number;
}

/**
 * VerificationResult — multi-judge 审核结果（写入 VerificationStore）
 */
export interface VerificationResult {
  readonly taskId: string;
  readonly iteration: number;
  readonly verdicts: readonly Verdict[];
  readonly decision: ConsensusDecision;
}

/**
 * ReAct 异常信号（非 fail，orchestrator 识别用）
 */
export class HumanInLoopPause extends Error {
  constructor(
    public readonly taskId: string,
    public readonly payload: unknown,
  ) {
    super(`HITL pause on task=${taskId}`);
    this.name = "HumanInLoopPause";
  }
}

export class DelayedDependencyError extends Error {
  constructor(public readonly delayMs: number) {
    super(`Dependency not ready, retry in ${delayMs}ms`);
    this.name = "DelayedDependencyError";
  }
}
