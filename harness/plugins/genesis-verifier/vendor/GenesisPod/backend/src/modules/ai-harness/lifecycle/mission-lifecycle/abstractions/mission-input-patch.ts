/**
 * MissionInputPatch / applyInputPatch —— C6 / G8（2026-05-22）：rerun 配置改动的 canonical patch。
 *
 * ★ G3:patch 是受白名单约束的 canonical 类型,不允许 app 自由扩展字段(防"平台 builder 一套 +
 * 业务层再套一层"的双主脑)。应用顺序钉死:snapshot → apply patch(白名单) → policy re-resolve
 * (budget 重解析) → 产出新 versioned snapshot(snapshotRevision++,G2)。
 * status/failure 等终态敏感字段**不在白名单**(类型上不含),禁 patch。
 */

import {
  ResolvedBudgetCaps,
  type BudgetCapsSource,
} from "../../../guardrails/budget/resolved-budget-caps";
import type { ResolvedRuntimeLimits } from "./runtime-limits";
import {
  deriveChildSnapshot,
  type MissionConfigSnapshot,
  type MissionMutationReason,
} from "./mission-config-snapshot";

/** rerun 可改的白名单字段(canonical)。app 业务 patch 经 businessInputPatch 透传(受 app schema 约束)。 */
export interface MissionInputPatch<TBusinessPatch = unknown> {
  readonly budgetOverride?: {
    readonly maxCredits?: number;
    readonly budgetMultiplier?: number;
  };
  readonly runtimeLimitsOverride?: {
    readonly wallTimeCapMs?: number;
  };
  readonly businessInputPatch?: TBusinessPatch;
}

/**
 * rerun 重建入口(app 实现 fresh,平台提供 patch 重建)。
 * 应用顺序见文件头;buildFor* 一律产出新 versioned snapshot,不就地改。
 */
export interface MissionInputRebuilder<
  TInput,
  TBusiness,
  TBusinessPatch = Partial<TBusiness>,
> {
  buildForFreshRun(input: TInput): MissionConfigSnapshot<TBusiness>;
  buildForFullRerun(
    snapshot: MissionConfigSnapshot<TBusiness>,
    patch?: MissionInputPatch<TBusinessPatch>,
  ): MissionConfigSnapshot<TBusiness>;
  buildForIncrementalRerun(
    snapshot: MissionConfigSnapshot<TBusiness>,
    checkpointStepId: string,
    patch?: MissionInputPatch<TBusinessPatch>,
  ): MissionConfigSnapshot<TBusiness>;
  buildForLocalRerun(
    snapshot: MissionConfigSnapshot<TBusiness>,
    targetStage: string,
    patch?: MissionInputPatch<TBusinessPatch>,
  ): MissionConfigSnapshot<TBusiness>;
}

/**
 * canonical patch 应用(纯函数):snapshot → 白名单 patch → re-resolve budget(走唯一工厂)→
 * 派生新 versioned snapshot。businessInputPatch 由 app merge 函数处理(平台不懂业务字段)。
 */
export function applyInputPatch<TBusiness, TBusinessPatch = Partial<TBusiness>>(
  snapshot: MissionConfigSnapshot<TBusiness>,
  patch: MissionInputPatch<TBusinessPatch> | undefined,
  args: {
    snapshotId: string;
    mutationReason: MissionMutationReason;
    /** app 提供:把 businessInputPatch merge 进 businessInput(typed,平台不懂业务字段语义但保留类型)。 */
    mergeBusinessInput?: (
      current: TBusiness,
      businessInputPatch: TBusinessPatch,
    ) => TBusiness;
  },
): MissionConfigSnapshot<TBusiness> {
  // 1. budget re-resolve(走 ResolvedBudgetCaps 唯一工厂,override 才重算,否则沿用父值)
  const budget =
    patch?.budgetOverride != null
      ? ResolvedBudgetCaps.resolve({
          maxCredits:
            patch.budgetOverride.maxCredits ?? snapshot.budget.maxCredits,
          budgetMultiplier:
            patch.budgetOverride.budgetMultiplier ??
            snapshot.budget.budgetMultiplier,
          source: "override" as BudgetCapsSource,
        })
      : snapshot.budget;

  // 2. runtimeLimits override(仅白名单 wallTimeCapMs)
  const runtimeLimits: ResolvedRuntimeLimits =
    patch?.runtimeLimitsOverride?.wallTimeCapMs != null
      ? {
          ...snapshot.runtimeLimits,
          wallTimeCapMs: patch.runtimeLimitsOverride.wallTimeCapMs,
        }
      : snapshot.runtimeLimits;

  // 3. businessInput merge(app 负责;无 merge 函数则沿用父值)
  const businessInput =
    patch?.businessInputPatch != null && args.mergeBusinessInput
      ? args.mergeBusinessInput(
          snapshot.businessInput,
          patch.businessInputPatch,
        )
      : snapshot.businessInput;

  // 4. 派生新 versioned snapshot(snapshotRevision++,不就地改)
  return deriveChildSnapshot(snapshot, {
    snapshotId: args.snapshotId,
    mutationReason: args.mutationReason,
    budget,
    runtimeLimits,
    businessInput,
  });
}
