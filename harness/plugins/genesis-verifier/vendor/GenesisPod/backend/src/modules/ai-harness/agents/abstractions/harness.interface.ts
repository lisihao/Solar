/**
 * IHarness — Agent 运行时脚手架总接口
 *
 * "The harness makes the agent." —— Anthropic 2025
 *
 * Harness 负责：
 *   1. 把零件（LLM / Tools / Memory / Skills）组装成一个可跑的 Agent
 *   2. 管理 Agent 的 lifecycle 与事件流
 *   3. 派生 subagent 并做隔离
 *   4. 提供 hook 钩子扩展点
 */

import type { z } from "zod";
import type { IAgent, IAgentTask, IAgentResult } from "./agent.interface";
import type { IAgentIdentity } from "./identity.interface";
import type {
  IContextEnvelope,
  IContextMutation,
} from "./context-envelope.interface";
import type { IHookRegistry } from "./hook.interface";
import type { IAgentLoop, AgentLoopKind } from "./agent-loop.interface";
import type { TaskProfile } from "../../../ai-engine/llm/types/task-profile.types";

/**
 * 创建 Agent 的规格（App 层提供）
 *
 * 目标架构 v2（docs/architecture/ai-harness/redesign/11-target-architecture.md）：
 * AI App 只写 spec，不写 Agent 执行代码。L2 AgentFactory 读 spec 产出 IAgent。
 *
 * 泛型：
 *   - TInput  IAgentTask.input 的类型
 *   - TOutput 经 outputSchema + validateBusinessRules 校验后的输出类型
 * 默认 unknown 保持向后兼容 —— 旧调用点不传泛型照常工作。
 */
export interface IAgentSpec<TInput = unknown, TOutput = unknown> {
  readonly identity: IAgentIdentity;
  /** 指定 loop 策略（默认 react） */
  readonly loop?: AgentLoopKind;
  /** 初始 system prompt（可选，默认由 identity 生成） */
  readonly systemPrompt?: string;
  /** 初始 session id（用于 memory scoping） */
  readonly sessionId?: string;
  readonly userId?: string;
  /** PR-J: workspace（多租户隔离） */
  readonly workspaceId?: string;
  /** PR-J: 运行时环境（BYOK / credit / model 可用性）；不传走 Noop */
  readonly runtimeEnv?: import("./runtime-env.interface").IRuntimeEnvironment;

  // ============ v2 目标架构字段（全部 optional，向后兼容） ============

  /**
   * 输出 Zod schema。P1-2 实施后：LlmExecutor 收到 raw output → safeParse →
   * 失败触发 error-fed retry（最多 3 轮）。未启用 schema 时行为不变。
   */
  readonly outputSchema?: z.ZodType<TOutput>;

  /**
   * 业务规则校验钩子。Zod 解析成功后调用；throw 则同 Zod 失败处理（重试）。
   * 用于跨字段校验，如"assignment.modelId 必须在 capabilities.env.models 内"。
   */
  readonly validateBusinessRules?: (
    output: TOutput,
    ctx: { readonly input: TInput; readonly identity: IAgentIdentity },
  ) => void;

  /**
   * Stub 模式产出函数。设置时（或环境变量 AI_ENGINE_AGENT_STUB=1）绕过 LLM 调用，
   * 直接返回用于测试的 schema-valid 占位数据。产出必须过 outputSchema 校验。
   */
  readonly stubFn?: (ctx: {
    readonly input: TInput;
    readonly identity: IAgentIdentity;
  }) => Promise<TOutput>;

  /**
   * 语义化模型参数（creativity / outputLength → temperature / maxTokens）。
   * 透给 AiChatService；禁止在 spec 里硬编码 temperature/maxTokens。
   */
  readonly taskProfile?: TaskProfile;

  /**
   * 可选动态 prompt builder（当静态 systemPrompt 不够用时）。
   * 基于 TInput 动态构造；两个字段任一存在都会覆盖默认 identity.toSystemPrompt()。
   */
  readonly buildSystemPrompt?: (ctx: {
    readonly input: TInput;
    readonly identity: IAgentIdentity;
  }) => string;
  readonly buildUserPrompt?: (ctx: {
    readonly input: TInput;
    readonly identity: IAgentIdentity;
  }) => string;

  /**
   * 2026-05-13: 透传到 envelope.metadata 的 mission-scoped 上下文。
   *
   * 用途：tool-invoker 把 envelope.metadata 透传给 ToolContext.metadata，
   * search 类 tool 的 `resolveEffectiveTimeRange()` 会读 metadata.searchTimeRange
   * 作为 LLM 漏传 timeRange 时的兜底，避免 5 年前老文章命中。
   *
   * 典型字段：searchTimeRange, language, missionId, dimensionId 等。
   */
  readonly metadata?: Readonly<Record<string, unknown>>;

  /**
   * #35 — Strict JSON schema for the business finalize output payload
   * (e.g. ResearcherAgent findings/summary shape), derived from outputSchema.
   *
   * When set, the ReActLoop switches to a tighter provider-enforced decision
   * schema on final iterations (approachingLimit=true), non-FC branch only.
   * The permissive REACT_LOOP_DECISION_JSON_SCHEMA is used for all other turns.
   *
   * Must exactly mirror outputSchema's shape (additionalProperties:false, all
   * optional fields absent from required[]). A mismatch rejects valid output.
   */
  readonly outputJsonSchema?: Readonly<Record<string, unknown>>;

  /**
   * P1a/P1b (2026-05-25) — delimited finalize transport hints (env-gated by
   * ENABLE_DELIMITED_FINALIZE). Names of finalize-output fields holding LONG
   * free-text (`finalizeProseFields`, e.g. ["body"] / ["summary"]) and an
   * optional array field to emit as NDJSON (`finalizeNdjsonArrayField`, e.g.
   * "findings"). When enabled, the loop tells the model to emit those OUTSIDE
   * the JSON envelope so unescaped quotes / long prose can't break finalize.
   * Best-effort models (DeepSeek json_object etc.) benefit most.
   */
  readonly finalizeProseFields?: readonly string[];
  readonly finalizeNdjsonArrayField?: string;
}

/** Context 操作接口（只读 envelope 上的变换器） */
export interface IContextManager {
  readonly envelope: IContextEnvelope;
  append(messages: IContextEnvelope["messages"]): IContextMutation;
  reminder(
    content: string,
    priority?: "low" | "medium" | "high",
  ): IContextMutation;
  fork(): IContextEnvelope;
  compact(): Promise<IContextMutation>;
}

/** Harness 总接口 */
export interface IHarness {
  /** 创建 Agent 实例（不启动） */
  createAgent(spec: IAgentSpec): IAgent;

  /** 一次性 execute：创建并执行到完成，返回最终结果 */
  execute(spec: IAgentSpec, task: IAgentTask): Promise<IAgentResult>;

  /** 注册 Loop 实现（Phase 2 使用） */
  registerLoop(loop: IAgentLoop): void;

  /** Hook 注册表 */
  readonly hooks: IHookRegistry;
}
