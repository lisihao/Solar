/**
 * MissionBudgetPool 单元测试 (PR-I)
 */

import { MissionBudgetPool } from "../mission-budget-pool";

describe("MissionBudgetPool (PR-I)", () => {
  it("shares spend across allocated accountants", () => {
    const pool = new MissionBudgetPool({ maxTokens: 1000, maxCostUsd: 1 });
    const parent = pool.allocate({ maxTokens: 600, maxCostUsd: 0.6 });
    const child = pool.allocate({ maxTokens: 600, maxCostUsd: 0.6 });

    parent.accountLLM(500, 0, 0.5);
    expect(pool.snapshot()).toMatchObject({
      poolTokensUsed: 500,
      poolCostUsd: 0.5,
    });
    // child can still spend up to remaining 500
    child.accountLLM(400, 0, 0.4);
    expect(pool.snapshot().poolTokensUsed).toBe(900);
  });

  it("exhausts both children when pool depleted", () => {
    const pool = new MissionBudgetPool({ maxTokens: 100, maxCostUsd: 1 });
    const a = pool.allocate({ maxTokens: 100, maxCostUsd: 1 });
    const b = pool.allocate({ maxTokens: 100, maxCostUsd: 1 });

    a.accountLLM(150, 0, 0); // pool exhausted
    expect(a.exhausted()).toBe(true);
    expect(b.exhausted()).toBe(true); // pool kills b too
  });

  it("clips sub-cap to remaining pool", () => {
    const pool = new MissionBudgetPool({ maxTokens: 1000, maxCostUsd: 10 });
    const a = pool.allocate({ maxTokens: 600, maxCostUsd: 6 });
    a.accountLLM(800, 0, 8);
    // After spend, remaining is 200 / 2; allocate(maxTokens: 500) gets clipped to 200
    const b = pool.allocate({ maxTokens: 500, maxCostUsd: 5 });
    b.accountLLM(150, 0, 1.5);
    expect(b.exhausted()).toBe(false);
    b.accountLLM(100, 0, 1);
    // Now b's own cap (200 tokens) hit
    expect(b.exhausted()).toBe(true);
  });
});
