/**
 * MissionInputPatch / applyInputPatch —— C6/G8 契约测试:白名单 patch + 应用顺序 + 派生新版本。
 */

import {
  applyInputPatch,
  type MissionInputPatch,
} from "../mission-input-patch";
import { type MissionConfigSnapshot } from "../mission-config-snapshot";
import { ResolvedBudgetCaps } from "../../../../guardrails/budget/resolved-budget-caps";
import type { ResolvedRuntimeLimits } from "../runtime-limits";

const limits: ResolvedRuntimeLimits = { wallTimeCapMs: 100 };

function makeSnap(): MissionConfigSnapshot<{ topic: string; depth: string }> {
  return {
    schemaVersion: 1,
    snapshotRevision: 0,
    snapshotId: "s0",
    mutationReason: "fresh",
    resolvedAt: new Date().toISOString(),
    topic: "t",
    language: "zh",
    businessInput: { topic: "t", depth: "deep" },
    budget: ResolvedBudgetCaps.resolve({ maxCredits: 100 }),
    runtimeLimits: limits,
  };
}

describe("applyInputPatch (C6/G8)", () => {
  it("budgetOverride → 走 ResolvedBudgetCaps 唯一工厂 re-resolve(tokens/proxy 重算)", () => {
    const patch: MissionInputPatch = { budgetOverride: { maxCredits: 500 } };
    const child = applyInputPatch(makeSnap(), patch, {
      snapshotId: "s1",
      mutationReason: "full_rerun",
    });
    expect(child.budget.maxCredits).toBe(500);
    expect(child.budget.maxTokens).toBe(500_000); // 经工厂重算
    expect(child.budget.source).toBe("override");
    expect(child.snapshotRevision).toBe(1);
    expect(child.parentSnapshotId).toBe("s0");
  });

  it("runtimeLimitsOverride 仅白名单 wallTimeCapMs", () => {
    const patch: MissionInputPatch = {
      runtimeLimitsOverride: { wallTimeCapMs: 999 },
    };
    const child = applyInputPatch(makeSnap(), patch, {
      snapshotId: "s1",
      mutationReason: "settings_patch",
    });
    expect(child.runtimeLimits.wallTimeCapMs).toBe(999);
  });

  it("businessInputPatch 经 app mergeBusinessInput merge(平台不懂业务字段)", () => {
    const patch: MissionInputPatch<{ depth: string }> = {
      businessInputPatch: { depth: "quick" },
    };
    const child = applyInputPatch(makeSnap(), patch, {
      snapshotId: "s1",
      mutationReason: "settings_patch",
      mergeBusinessInput: (cur, p) => ({ ...cur, ...(p as { depth: string }) }),
    });
    expect(child.businessInput.depth).toBe("quick");
    expect(child.businessInput.topic).toBe("t"); // 其余保留
  });

  it("无 patch → 沿用父 budget/limits,仅派生新版本号", () => {
    const child = applyInputPatch(makeSnap(), undefined, {
      snapshotId: "s1",
      mutationReason: "full_rerun",
    });
    expect(child.budget.maxCredits).toBe(100);
    expect(child.runtimeLimits.wallTimeCapMs).toBe(100);
    expect(child.snapshotRevision).toBe(1);
  });

  it("patch 类型不含 status/failure(终态敏感字段禁 patch,L1 类型守护)", () => {
    // @ts-expect-error status 不在 MissionInputPatch 白名单
    const illegal: MissionInputPatch = { status: "completed" };
    void illegal;
    expect(true).toBe(true);
  });
});
