/**
 * ResolvedBudgetCaps —— C3a / G4（2026-05-22）：mission 预算额度 canonical 值对象
 * （single source of truth + L1 类型主防线）。
 *
 * 此前 credits→tokens(×1000) / credits→USD(×0.002) 的换算散在 framework / rerun-builder /
 * app 各处（且 3 个 app 各发明第二套估算）。本值对象把换算收成唯一一处：
 *   - **私有构造 + 只能由 resolve() 工厂产出 + 字段 readonly** → 别处拿不到原料去散落换算
 *     （make illegal states unrepresentable，比事后 grep 守护根本）。
 *   - `creditBudgetProxyUsd`（★ RB2：额度代理值，**非真实成本**——真实成本是逐模型
 *     ModelPricingRegistry / BudgetAccountant。此值仅 credits 的粗略闸）。
 */

import type { TokenBudget } from "@/modules/ai-harness/runner/env/types";

/** 唯一换算常量（仅平台额度语义）。真实成本不走这里。 */
export const CREDITS_TO_TOKENS = 1000;
export const CREDITS_TO_USD = 0.002;

export type BudgetCapsSource = "default" | "override" | "inherited";

export class ResolvedBudgetCaps {
  private constructor(
    readonly maxCredits: number,
    readonly maxTokens: number,
    /** ★ 额度代理 USD（= maxCredits × CREDITS_TO_USD），非真实成本。 */
    readonly creditBudgetProxyUsd: number,
    readonly budgetMultiplier: number,
    readonly source: BudgetCapsSource,
    readonly resolvedAt: string,
  ) {}

  /** 唯一工厂——所有 credits→caps 换算只在这里发生。 */
  static resolve(args: {
    maxCredits: number;
    budgetMultiplier?: number;
    source?: BudgetCapsSource;
  }): ResolvedBudgetCaps {
    const credits = Math.max(0, args.maxCredits);
    return new ResolvedBudgetCaps(
      credits,
      credits * CREDITS_TO_TOKENS,
      credits * CREDITS_TO_USD,
      args.budgetMultiplier ?? 1,
      args.source ?? "default",
      new Date().toISOString(),
    );
  }

  /** 投影成 MissionBudgetPool 的 TokenBudget（maxCostUsd 槽位放额度代理值）。 */
  toTokenBudget(): TokenBudget {
    return { maxTokens: this.maxTokens, maxCostUsd: this.creditBudgetProxyUsd };
  }
}
