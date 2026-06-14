/**
 * MissionConfigSnapshot —— C5/G7 契约测试:deriveChildSnapshot 版本/谱系不变量。
 */

import {
  deriveChildSnapshot,
  type MissionConfigSnapshot,
} from "../mission-config-snapshot";
import { ResolvedBudgetCaps } from "../../../../guardrails/budget/resolved-budget-caps";
import type { ResolvedRuntimeLimits } from "../runtime-limits";

const limits: ResolvedRuntimeLimits = { wallTimeCapMs: 4 * 60 * 60 * 1000 };

function makeParent(): MissionConfigSnapshot<{ topic: string }> {
  return {
    schemaVersion: 1,
    snapshotRevision: 0,
    snapshotId: "snap-0",
    mutationReason: "fresh",
    resolvedAt: new Date().toISOString(),
    topic: "t",
    language: "zh",
    businessInput: { topic: "t" },
    budget: ResolvedBudgetCaps.resolve({ maxCredits: 100 }),
    runtimeLimits: limits,
  };
}

describe("MissionConfigSnapshot.deriveChildSnapshot (C5/G7)", () => {
  it("snapshotRevision++ / parentSnapshotId 链 / schemaVersion 不变", () => {
    const parent = makeParent();
    const child = deriveChildSnapshot(parent, {
      snapshotId: "snap-1",
      mutationReason: "full_rerun",
      budget: ResolvedBudgetCaps.resolve({
        maxCredits: 200,
        source: "override",
      }),
      runtimeLimits: limits,
      businessInput: { topic: "t2" },
    });
    expect(child.snapshotRevision).toBe(1); // ++ 派生次数
    expect(child.schemaVersion).toBe(1); // 结构未变
    expect(child.parentSnapshotId).toBe("snap-0"); // 谱系链
    expect(child.snapshotId).toBe("snap-1");
    expect(child.mutationReason).toBe("full_rerun");
    expect(child.budget.maxCredits).toBe(200);
    expect(child.businessInput.topic).toBe("t2");
  });

  it("不就地改父快照(G2:派生不可变)", () => {
    const parent = makeParent();
    const before = parent.snapshotRevision;
    deriveChildSnapshot(parent, {
      snapshotId: "snap-1",
      mutationReason: "settings_patch",
      budget: parent.budget,
      runtimeLimits: parent.runtimeLimits,
      businessInput: parent.businessInput,
    });
    expect(parent.snapshotRevision).toBe(before); // 父未被改
    expect(parent.snapshotId).toBe("snap-0");
  });

  it("derivedFromMissionId 继承(未显式传则沿用父)", () => {
    const parent = { ...makeParent(), derivedFromMissionId: "m-root" };
    const child = deriveChildSnapshot(parent, {
      snapshotId: "snap-1",
      mutationReason: "local_rerun",
      budget: parent.budget,
      runtimeLimits: parent.runtimeLimits,
      businessInput: parent.businessInput,
    });
    expect(child.derivedFromMissionId).toBe("m-root");
  });
});
