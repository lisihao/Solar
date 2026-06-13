/**
 * ResolvedBudgetCaps —— C3a/G4 契约测试：换算不变量 + 工厂唯一产出 + TokenBudget 投影。
 */

import {
  ResolvedBudgetCaps,
  CREDITS_TO_TOKENS,
  CREDITS_TO_USD,
} from "../resolved-budget-caps";

describe("ResolvedBudgetCaps (C3a/G4)", () => {
  it("resolve 换算不变量：maxTokens=credits×1000, creditBudgetProxyUsd=credits×0.002", () => {
    const caps = ResolvedBudgetCaps.resolve({ maxCredits: 500 });
    expect(caps.maxCredits).toBe(500);
    expect(caps.maxTokens).toBe(500 * CREDITS_TO_TOKENS);
    expect(caps.creditBudgetProxyUsd).toBe(500 * CREDITS_TO_USD);
    expect(caps.maxTokens).toBe(500_000);
    expect(caps.creditBudgetProxyUsd).toBeCloseTo(1.0, 10);
  });

  it("默认 budgetMultiplier=1 / source=default / resolvedAt 是 ISO", () => {
    const caps = ResolvedBudgetCaps.resolve({ maxCredits: 100 });
    expect(caps.budgetMultiplier).toBe(1);
    expect(caps.source).toBe("default");
    expect(() => new Date(caps.resolvedAt).toISOString()).not.toThrow();
  });

  it("负 credits 兜底为 0（不产生负 caps）", () => {
    const caps = ResolvedBudgetCaps.resolve({ maxCredits: -50 });
    expect(caps.maxCredits).toBe(0);
    expect(caps.maxTokens).toBe(0);
    expect(caps.creditBudgetProxyUsd).toBe(0);
  });

  it("toTokenBudget 投影：maxCostUsd 槽位放额度代理值", () => {
    const caps = ResolvedBudgetCaps.resolve({
      maxCredits: 200,
      budgetMultiplier: 2,
      source: "override",
    });
    const tb = caps.toTokenBudget();
    expect(tb.maxTokens).toBe(200_000);
    expect(tb.maxCostUsd).toBe(caps.creditBudgetProxyUsd);
    expect(caps.source).toBe("override");
    expect(caps.budgetMultiplier).toBe(2);
  });

  it("私有构造——只能由 resolve 工厂产出（编译期 L1 主防线）", () => {
    // @ts-expect-error 私有构造不可外部 new（这就是 L1 类型守护：别处拿不到原料散落换算）
    const illegal = () => new ResolvedBudgetCaps(1, 1, 1, 1, "default", "");
    void illegal;
    expect(typeof ResolvedBudgetCaps.resolve).toBe("function");
  });
});
