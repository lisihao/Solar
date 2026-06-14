/**
 * ResolvedRuntimeLimits / MissionLifecycleMetrics —— C4/G5 契约测试。
 */

import {
  buildLifecycleMetrics,
  type ResolvedRuntimeLimits,
  type MissionLifecycleMetrics,
} from "../runtime-limits";

describe("runtime-limits (C4/G5)", () => {
  it("buildLifecycleMetrics 算 elapsedWallTimeMs = end − start", () => {
    const m = buildLifecycleMetrics(1000, 4000);
    expect(m.elapsedWallTimeMs).toBe(3000);
  });

  it("end < start 兜底为 0（不产生负耗时）", () => {
    const m = buildLifecycleMetrics(5000, 1000);
    expect(m.elapsedWallTimeMs).toBe(0);
  });

  it("cap(ResolvedRuntimeLimits) 与 elapsed(MissionLifecycleMetrics) 是不同字段名(语义不混)", () => {
    const limits: ResolvedRuntimeLimits = { wallTimeCapMs: 4 * 60 * 60 * 1000 };
    const metrics: MissionLifecycleMetrics = { elapsedWallTimeMs: 123 };
    // 类型层面 cap 字段不叫 elapsed、elapsed 字段不叫 cap —— 二义被消除
    expect("wallTimeCapMs" in limits).toBe(true);
    expect("elapsedWallTimeMs" in metrics).toBe(true);
    expect((limits as Record<string, unknown>).wallTimeMs).toBeUndefined();
    expect((metrics as Record<string, unknown>).wallTimeMs).toBeUndefined();
  });
});
