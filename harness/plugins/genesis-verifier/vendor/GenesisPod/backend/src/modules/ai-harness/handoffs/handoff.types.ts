/**
 * Handoff —— Agent-to-Agent peer 转移
 *
 * 与 Subagent 区别：
 *   - Subagent: parent 派 child，child 完成后回 parent（星型）
 *   - Handoff: A 把控制权交给 B，A 不再主导（链式 / 接力）
 *
 * 对标 OpenAI Agents SDK 1.x 的 handoff()。
 *
 * 用途：
 *   - 多 stage 流水线：intent agent → planner agent → executor agent
 *   - 角色切换：客服 agent → 技术 agent
 *   - 升级路径：Tier-1 agent → Tier-2 agent
 */

import type { IContextEnvelope } from "@/modules/ai-harness/agents/abstractions";

export interface HandoffContext {
  /** 来源 agent id */
  readonly fromAgentId: string;
  /** 目标 agent id（必须在 AgentRegistry 注册） */
  readonly toAgentId: string;
  /** 转移原因（observability 用） */
  readonly reason: string;
  /**
   * 透传给目标 agent 的初始消息 / context；目标 agent 看到这些后接力。
   * 不传则 fromAgent 的 envelope.messages 全量透传。
   */
  readonly handoverMessage?: string;
  /** 是否携带 fromAgent 的 envelope（默认 true）；false 则目标 agent 全新 envelope */
  readonly carryEnvelope?: boolean;
  /**
   * G6: 结构化转移载荷（对标 OpenAI Agents SDK handoff 的 input_type）。`handoverMessage`
   * 是自由文本给 LLM 看；`input` 是给 policy.onHandoff 校验/路由的结构化业务数据
   * （如 `{ escalationLevel, ticketId }`）。policy 自行用 Zod 等校验其形状。
   */
  readonly input?: unknown;
  /** 业务自定义元数据（如 escalation level / priority） */
  readonly metadata?: Record<string, unknown>;
}

export interface HandoffResult {
  readonly toAgentId: string;
  readonly accepted: boolean;
  readonly rejectedReason?: string;
  readonly handoffId: string;
  readonly handoverEnvelope?: IContextEnvelope;
}

/**
 * IHandoffPolicy —— 业务方决定 "A → B 是否允许 / 如何携带 context"。
 *
 * 默认策略：拒绝跨 workspace handoff；同 workspace 全 envelope 透传。
 */
export interface IHandoffPolicy {
  authorize(ctx: HandoffContext): Promise<{ allow: boolean; reason?: string }>;
  /** 重写 envelope（脱敏、加 reminder、调 budget 等） */
  shapeEnvelope?(
    envelope: IContextEnvelope,
    ctx: HandoffContext,
  ): Promise<IContextEnvelope>;
  /**
   * G6: on_handoff 钩子（对标 OpenAI Agents SDK on_handoff）。在 authorize 通过后、
   * 形塑 envelope 前触发，用于校验 `ctx.input`、做审计、或基于业务条件二次否决转移。
   * 返回 `{ block: true, reason }` 则拒绝本次 handoff。
   */
  onHandoff?(
    ctx: HandoffContext,
  ): Promise<{ block?: boolean; reason?: string } | void>;
}
