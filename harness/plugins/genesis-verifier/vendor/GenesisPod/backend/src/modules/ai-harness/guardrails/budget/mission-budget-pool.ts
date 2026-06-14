/**
 * MissionBudgetPool — PR-I 修复 #7
 *
 * 一个 Mission 创建一个池；父 Agent + N 个 SubAgent 共享同一池子。
 * 每个 Agent 拥有自己的 BudgetAccountant，但 accountLLM 时同步扣池子。
 * 池子耗尽 → 任何 Agent 的 exhausted() 都返回 true。
 *
 * 用法：
 *   const pool = new MissionBudgetPool({ maxTokens: 100_000, maxCostUsd: 5 });
 *   const parentBudget = pool.allocate({ maxTokens: 50_000, maxCostUsd: 2.5 });
 *   const childBudget  = pool.allocate({ maxTokens: 30_000, maxCostUsd: 1.5 });
 *
 * 当 parentBudget.accountLLM(...) 时，池子总额同步增加；
 * 若池子超额，所有挂载的 BudgetAccountant.exhausted() 都返回 true。
 */

import { BudgetAccountant } from "@/modules/ai-harness/guardrails/budget/budget-accountant";
import type { TokenBudget } from "@/modules/ai-harness/runner/env/types";

export class MissionBudgetPool {
  private poolTokensUsed = 0;
  private poolCostUsd = 0;
  private readonly attached: BudgetAccountant[] = [];

  constructor(private readonly cap: TokenBudget) {}

  /**
   * 给一个 Agent 分配 BudgetAccountant；返回的 accountant 会自动联动池子。
   * 子 cap 不能超过池子剩余 —— 自动按剩余裁剪。
   */
  allocate(subCap: Partial<TokenBudget>): BudgetAccountant {
    const remainingTokens = Math.max(
      0,
      this.cap.maxTokens - this.poolTokensUsed,
    );
    const remainingCost = Math.max(0, this.cap.maxCostUsd - this.poolCostUsd);
    const effectiveCap: TokenBudget = {
      maxTokens: Math.min(subCap.maxTokens ?? remainingTokens, remainingTokens),
      maxCostUsd: Math.min(subCap.maxCostUsd ?? remainingCost, remainingCost),
    };
    const accountant = new MissionAwareBudgetAccountant(effectiveCap, this);
    this.attached.push(accountant);
    return accountant;
  }

  /** 给已存在的 BudgetAccountant 注入 mission-pool 联动（用于 spawn 后挂接） */
  attach(accountant: BudgetAccountant): void {
    if (!this.attached.includes(accountant)) this.attached.push(accountant);
  }

  recordSpend(
    promptTokens: number,
    completionTokens: number,
    costUsd: number,
  ): void {
    this.poolTokensUsed += promptTokens + completionTokens;
    this.poolCostUsd += costUsd;
  }

  isExhausted(): boolean {
    // ★ R2-#36 comparator unification: use >= (at-cap means exhausted), matching
    //   BudgetAccountant.exhausted() which also uses >=. The previous comment
    //   ("allow last token") was stale; MissionAwareBudgetAccountant.exhausted()
    //   delegates here, so the two must agree to avoid one saying exhausted while
    //   the other says not.
    return (
      this.poolTokensUsed >= this.cap.maxTokens ||
      this.poolCostUsd >= this.cap.maxCostUsd
    );
  }

  snapshot(): {
    poolTokensUsed: number;
    poolCostUsd: number;
    poolTokensRemaining: number;
    poolCostRemaining: number;
  } {
    return {
      poolTokensUsed: this.poolTokensUsed,
      poolCostUsd: this.poolCostUsd,
      poolTokensRemaining: Math.max(
        0,
        this.cap.maxTokens - this.poolTokensUsed,
      ),
      poolCostRemaining: Math.max(0, this.cap.maxCostUsd - this.poolCostUsd),
    };
  }
}

/**
 * MissionAwareBudgetAccountant —— 联动 pool 的 BudgetAccountant 子类。
 *
 * accountLLM/Tool 时同步上报池子；exhausted() 任一耗尽即 true。
 */
class MissionAwareBudgetAccountant extends BudgetAccountant {
  constructor(
    cap: TokenBudget,
    private readonly pool: MissionBudgetPool,
  ) {
    super(cap);
  }

  override accountLLM(
    promptTokens: number,
    completionTokens: number,
    costUsd: number,
    cacheReadTokens = 0,
  ): void {
    super.accountLLM(promptTokens, completionTokens, costUsd, cacheReadTokens);
    // 池子也要计入 cache token（context window 共享）
    this.pool.recordSpend(
      promptTokens + cacheReadTokens,
      completionTokens,
      costUsd,
    );
  }

  override accountTool(costUsd: number): void {
    super.accountTool(costUsd);
    this.pool.recordSpend(0, 0, costUsd);
  }

  override exhausted(): boolean {
    return super.exhausted() || this.pool.isExhausted();
  }
}
