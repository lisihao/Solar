/**
 * run-mission.dto 预算上限校验 —— BYOK 放宽（2026-06-10）。
 *
 * maxCredits 硬上限从 100k 提到 500k：BYOK 用户花自己 provider 的钱，不该被平台
 * 100k 档位卡死；500k（≈ cost cap $1000）仍是"防 mission bug 失控烧爆"的 backstop。
 */

import {
  RunMissionInputSchema,
  BUDGET_FIELD_LIMITS,
  DEPTH_BUDGET_TIERS,
  resolveMissionCredits,
} from "../run-mission.dto";

const BASE = {
  topic: "量子计算前沿进展",
  depth: "deep" as const,
};

describe("run-mission.dto maxCredits limit (BYOK 放宽)", () => {
  it("accepts maxCredits up to the new 500k ceiling", () => {
    const parsed = RunMissionInputSchema.parse({
      ...BASE,
      maxCredits: 500_000,
    });
    expect(parsed.maxCredits).toBe(500_000);
  });

  it("accepts a value that the old 100k ceiling would have rejected", () => {
    const parsed = RunMissionInputSchema.parse({
      ...BASE,
      maxCredits: 250_000,
    });
    expect(parsed.maxCredits).toBe(250_000);
  });

  it("rejects maxCredits above the 500k ceiling", () => {
    expect(() =>
      RunMissionInputSchema.parse({ ...BASE, maxCredits: 500_001 }),
    ).toThrow();
  });

  it("rejects maxCredits below the 10 floor", () => {
    expect(() =>
      RunMissionInputSchema.parse({ ...BASE, maxCredits: 9 }),
    ).toThrow();
  });

  it("BUDGET_FIELD_LIMITS.maxCredits.max matches the schema ceiling (single source)", () => {
    expect(BUDGET_FIELD_LIMITS.maxCredits.max).toBe(500_000);
    expect(BUDGET_FIELD_LIMITS.maxCredits.min).toBe(10);
  });

  it("per-depth defaults stay conservative (protection preserved, not removed)", () => {
    // 放宽的是输入上限，不是默认档位 —— 缺省档位仍是保守值
    expect(DEPTH_BUDGET_TIERS.deep.maxCredits).toBe(20_000);
    expect(resolveMissionCredits({ ...BASE } as never)).toBe(20_000);
  });
});
