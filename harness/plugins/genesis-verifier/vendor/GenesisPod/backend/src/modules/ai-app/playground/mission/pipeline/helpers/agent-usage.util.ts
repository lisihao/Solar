/**
 * agent-usage.util.ts — 把 RunResult 的 per-agent 用量映射成事件 payload 片段。
 *
 * 2026-05-29：「Agent 实例耗时」表的 Tokens / 成本 / 工具 / 模型 列原本对 reviewer 等
 * 单次调用型 agent 全是空（它们发的 trace 事件比 researcher/writer 薄），成本列对所有
 * agent 都空（per-agent 成本从未按 agentId 归集）。RunResult 本身已带这些字段，只需在
 * 各 agent 终态事件（chapter:*:completed / agent:lifecycle）上把它们带出来，projector 读取。
 *
 * 纯追加：返回的字段挂进 passthrough 的事件 payload，不改任何控制流。
 */

import {
  extractTokenSpend,
  extractRealCostUsd,
  estimateUsdFromTokens,
  type IAgentEvent,
} from "@/modules/ai-harness/facade";

/** RunResult 中用量相关字段的结构子集（避免硬依赖完整 RunResult 类型）。 */
export interface AgentUsageSource {
  tokensUsed?: { prompt: number; completion: number; total: number };
  costCents?: number;
  modelTrail?: readonly { modelId: string }[];
  toolsUsed?: readonly unknown[];
}

export interface AgentUsageDetail {
  tokensUsed?: number;
  costUsd?: number;
  modelId?: string;
  toolCallCount?: number;
}

/** 从 RunResult 提取 per-agent 用量；字段缺失时返回 undefined（不写 0，避免覆盖真值）。 */
export function agentUsageDetail(
  res: AgentUsageSource | null | undefined,
): AgentUsageDetail {
  if (!res) return {};
  const trail = res.modelTrail ?? [];
  const modelId =
    trail.length > 0 ? trail[trail.length - 1].modelId : undefined;
  const tokensUsed =
    typeof res.tokensUsed?.total === "number"
      ? res.tokensUsed.total
      : undefined;
  const costUsd =
    typeof res.costCents === "number" ? res.costCents / 100 : undefined;
  const toolCallCount = Array.isArray(res.toolsUsed)
    ? res.toolsUsed.length
    : undefined;
  return { tokensUsed, costUsd, modelId, toolCallCount };
}

/**
 * 从 agent events 提取用量 —— 给精简结果类型（reconciler / analyst 的 invoke 不返回
 * tokensUsed/costCents/modelTrail，只有 events）用。modelId 由这些 agent 的 trace 事件
 * 经 projector 单独填充，这里只补 tokensUsed / costUsd。
 */
export function agentUsageFromEvents(
  events: readonly IAgentEvent[] | undefined,
): { tokensUsed?: number; costUsd?: number } {
  if (!events || events.length === 0) return {};
  const tokensUsed = extractTokenSpend(events);
  const realCost = extractRealCostUsd(events);
  const costUsd = realCost > 0 ? realCost : estimateUsdFromTokens(tokensUsed);
  return {
    tokensUsed: tokensUsed > 0 ? tokensUsed : undefined,
    costUsd: costUsd > 0 ? costUsd : undefined,
  };
}
