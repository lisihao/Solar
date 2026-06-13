/**
 * PlaygroundMissionInputRebuilder —— C5/C6 契约测试:fresh 冻结 + rerun 派生不变量。
 */

import {
  PlaygroundMissionInputRebuilder,
  PLAYGROUND_SNAPSHOT_SCHEMA_VERSION,
} from "../../../runtime/playground.input-rebuilder";
import type { RunMissionInput } from "../../../api/dto/run-mission.dto";

function makeInput(over: Partial<RunMissionInput> = {}): RunMissionInput {
  return {
    topic: "AI 芯片",
    language: "zh-CN",
    depth: "standard",
    budgetProfile: "medium",
    styleProfile: "executive",
    lengthProfile: "standard",
    audienceProfile: "domain-expert",
    withFigures: true,
    auditLayers: "default",
    concurrency: 3,
    viewMode: "continuous",
    searchTimeRange: "all",
    ...over,
  } as RunMissionInput;
}

describe("PlaygroundMissionInputRebuilder (C5/C6)", () => {
  const rb = new PlaygroundMissionInputRebuilder();

  it("buildForFreshRun:冻结 v0 snapshot,businessInput 是业务子集(不含 budget/wallTime)", () => {
    const snap = rb.buildForFreshRun(makeInput({ depth: "deep" }));
    expect(snap.schemaVersion).toBe(PLAYGROUND_SNAPSHOT_SCHEMA_VERSION);
    expect(snap.snapshotRevision).toBe(0);
    expect(snap.mutationReason).toBe("fresh");
    expect(snap.topic).toBe("AI 芯片");
    expect(snap.language).toBe("zh-CN");
    expect(snap.businessInput.depth).toBe("deep");
    // ★ 岔口1:budget/wallTime 不进 businessInput,在顶层
    expect(
      (snap.businessInput as Record<string, unknown>).maxCredits,
    ).toBeUndefined();
    expect(
      (snap.businessInput as Record<string, unknown>).wallTimeMs,
    ).toBeUndefined();
    expect(snap.budget.maxCredits).toBeGreaterThan(0);
    expect(snap.budget.maxTokens).toBe(snap.budget.maxCredits * 1000); // 走 ResolvedBudgetCaps
    expect(snap.runtimeLimits.wallTimeCapMs).toBeGreaterThan(0);
  });

  it("buildForFullRerun 无 patch:派生 v1(parentSnapshotId 链),沿用父预算", () => {
    const v0 = rb.buildForFreshRun(makeInput());
    const v1 = rb.buildForFullRerun(v0);
    expect(v1.snapshotRevision).toBe(1);
    expect(v1.parentSnapshotId).toBe(v0.snapshotId);
    expect(v1.mutationReason).toBe("full_rerun");
    expect(v1.budget.maxCredits).toBe(v0.budget.maxCredits);
  });

  it("buildForFullRerun 带 budgetOverride:re-resolve 走唯一工厂", () => {
    const v0 = rb.buildForFreshRun(makeInput());
    const v1 = rb.buildForFullRerun(v0, {
      budgetOverride: { maxCredits: 500 },
    });
    expect(v1.budget.maxCredits).toBe(500);
    expect(v1.budget.maxTokens).toBe(500_000);
    expect(v1.budget.source).toBe("override");
  });

  it("buildForLocalRerun 带 businessInputPatch:merge 业务字段", () => {
    const v0 = rb.buildForFreshRun(makeInput({ depth: "standard" }));
    const v1 = rb.buildForLocalRerun(v0, "s8-writer", {
      businessInputPatch: { depth: "deep" },
    });
    expect(v1.businessInput.depth).toBe("deep");
    expect(v1.mutationReason).toBe("local_rerun");
  });
});
