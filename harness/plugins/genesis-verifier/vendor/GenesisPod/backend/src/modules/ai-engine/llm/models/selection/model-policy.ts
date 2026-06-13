/**
 * model-policy.ts — 模型选择的单一权威（Capability Contract · "Resolve")
 *
 * 背景（2026-05-21 根因）：模型选择此前被 5 套互不相通的机制各自断言——
 *   - executor 钉死 CHAT、judge 钉死 verifier→CHAT_FAST、~40 处内联 modelType:CHAT_FAST、
 *     一套死的 pickModelType、react-runner / constraint-engine 两套 budget tier。
 * 没有任何一处对账"用户其实只想用主模型"，于是出现"配了 grok-4，却用 grok-3-mini"。
 *
 * 本模块是收口点：把"请求的 modelType（用途）"按 downgradePolicy 解析成"有效 modelType"。
 * 所有 modelType→model 解析必须先过这里（AiChatService 调用，guard spec 看护）。
 *
 * 纯函数，0 DI，0 LLM 调用 —— 易测、易守护。
 */

import { AIModelType } from "@prisma/client";

/**
 * 降级策略 —— 决定"轻量/快速 tier 请求"是否降级到便宜模型。
 * - quality-first：成本降级 tier（CHAT_FAST）回退到主模型（CHAT）；EVALUATOR 等保留。
 * - cost-first：保留分级降级（维持现状的省钱意图）。
 * - single-model：用户主模型统治一切 chat 类调用（含 CHAT_FAST / EVALUATOR）。
 */
export type DowngradePolicy = "quality-first" | "cost-first" | "single-model";

/** 全局默认策略（2026-05-21 用户决策：quality-first）。可被 env MODEL_DOWNGRADE_POLICY 覆盖。 */
export const DEFAULT_DOWNGRADE_POLICY: DowngradePolicy = "quality-first";

/** 代表"主 chat 能力的成本降级版"的 tier —— quality-first 下回退到 CHAT。 */
const COST_DOWNGRADE_TIERS: ReadonlySet<AIModelType> = new Set<AIModelType>([
  AIModelType.CHAT_FAST,
]);

/**
 * 正交能力 —— 与"主模型强弱"无关的独立用途，任何策略都不折叠成 CHAT。
 * （向量 / 重排 / 图像 / 代码 / 多模态）
 */
const ORTHOGONAL_TYPES: ReadonlySet<AIModelType> = new Set<AIModelType>([
  AIModelType.EMBEDDING,
  AIModelType.RERANK,
  AIModelType.IMAGE_GENERATION,
  AIModelType.IMAGE_EDITING,
  AIModelType.CODE,
  AIModelType.MULTIMODAL,
]);

/**
 * 把"请求的 modelType"按策略解析成"有效 modelType"。
 *
 * @param requested 调用方请求的用途（modelType）
 * @param policy    生效的降级策略，默认 {@link DEFAULT_DOWNGRADE_POLICY}
 * @returns 实际应解析模型的 modelType
 */
export function resolveEffectiveModelType(
  requested: AIModelType,
  policy: DowngradePolicy = DEFAULT_DOWNGRADE_POLICY,
): AIModelType {
  // 正交能力永不折叠
  if (ORTHOGONAL_TYPES.has(requested)) return requested;

  switch (policy) {
    case "quality-first":
      // 成本降级 tier 回退主模型；EVALUATOR（consensus 去相关）保留
      return COST_DOWNGRADE_TIERS.has(requested) ? AIModelType.CHAT : requested;
    case "single-model":
      // 主模型统治：CHAT_FAST 和 EVALUATOR 都回退到 CHAT
      return COST_DOWNGRADE_TIERS.has(requested) ||
        requested === AIModelType.EVALUATOR
        ? AIModelType.CHAT
        : requested;
    case "cost-first":
    default:
      // 维持现状：按请求的 tier 解析
      return requested;
  }
}

/** 把任意字符串规范化为合法 DowngradePolicy，非法值回落默认。 */
export function normalizeDowngradePolicy(
  raw: string | undefined | null,
): DowngradePolicy {
  if (
    raw === "quality-first" ||
    raw === "cost-first" ||
    raw === "single-model"
  ) {
    return raw;
  }
  return DEFAULT_DOWNGRADE_POLICY;
}
