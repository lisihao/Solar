/**
 * SOTA Runtime · BudgetAccountant (cost-aware tier downgrade)
 *
 * 方案文档 §4.4。超 budget 时自动 downgrade model (strong → standard → basic)，
 * 再超就 abort。防止 ReAct loop 无限烧 token。
 */

import type {
  TokenBudget,
  BudgetSnapshot,
} from "@/modules/ai-harness/runner/env/types";

export type ModelTier = "strong" | "standard" | "basic";

export class BudgetAccountant {
  protected tokensUsed = 0;
  protected costUsd = 0;
  protected currentTier: ModelTier = "strong";

  constructor(protected readonly cap: TokenBudget) {}

  exhausted(): boolean {
    return (
      this.tokensUsed >= this.cap.maxTokens ||
      this.costUsd >= this.cap.maxCostUsd
    );
  }

  /** 超 70% 时允许 downgrade，超 90% 强制 */
  shouldDowngrade(): boolean {
    const tokenPct = this.tokensUsed / this.cap.maxTokens;
    const costPct = this.costUsd / this.cap.maxCostUsd;
    return tokenPct >= 0.7 || costPct >= 0.7;
  }

  /**
   * token 或 cost 用量达到 ratio（默认 0.85）但尚未 exhausted —— 用于硬停前的
   * 早期预警（让 loop 发 budget_warning，给 agent 一个 finalize 的宽限窗口）。
   */
  nearLimit(ratio = 0.85): boolean {
    if (this.exhausted()) return false;
    const tokenPct = this.tokensUsed / this.cap.maxTokens;
    const costPct = this.costUsd / this.cap.maxCostUsd;
    return tokenPct >= ratio || costPct >= ratio;
  }

  canDowngrade(): boolean {
    return this.currentTier !== "basic";
  }

  downgrade(): ModelTier {
    this.currentTier = this.currentTier === "strong" ? "standard" : "basic";
    return this.currentTier;
  }

  /** 模型未在 ModelPricingRegistry 注册的累计调用次数（debug + warn 用） */
  protected uncostedLLMCalls = 0;

  /**
   * @param costUsd null = 模型未注册定价（DB 缺 costTier 或 price）。token 仍计入
   *   tokensUsed（以触发 context window cap），但 cost 不增。uncostedLLMCalls++ 用于
   *   暴露"假账"风险——caller 可在 snapshot 里看到有多少次 LLM 调用没算钱。
   * @param cacheReadTokens (PR-I 必修 #4) Anthropic prompt-cache 命中的 token 数。
   *   虽然计费按 1/10 价（已在 estimateCost 体现），但仍占用上下文窗口，必须计入 tokensUsed
   *   以防"context 已满但 budget 显未超 → provider 报 context-too-long"。
   */
  accountLLM(
    promptTokens: number,
    completionTokens: number,
    costUsd: number | null,
    cacheReadTokens = 0,
  ): void {
    this.tokensUsed += promptTokens + completionTokens + cacheReadTokens;
    if (costUsd == null) {
      this.uncostedLLMCalls += 1;
    } else {
      this.costUsd += costUsd;
    }
  }

  accountTool(costUsd: number | null): void {
    if (costUsd == null) return;
    this.costUsd += costUsd;
  }

  /**
   * 根据当前 tier + preference 选 modelId。
   * 由 protocol 传入 modelRegistry 注入，实现 tier → modelId 映射。
   */
  getCurrentTier(): ModelTier {
    return this.currentTier;
  }

  snapshot(): BudgetSnapshot {
    return {
      tokensUsed: this.tokensUsed,
      costUsd: this.costUsd,
      currentTier: this.currentTier,
      uncostedLLMCalls: this.uncostedLLMCalls,
    };
  }

  /** 恢复快照（从 checkpoint 重建） */
  restore(snap: BudgetSnapshot): void {
    this.tokensUsed = snap.tokensUsed;
    this.costUsd = snap.costUsd;
    this.currentTier = snap.currentTier;
    this.uncostedLLMCalls = snap.uncostedLLMCalls ?? 0;
  }
}
