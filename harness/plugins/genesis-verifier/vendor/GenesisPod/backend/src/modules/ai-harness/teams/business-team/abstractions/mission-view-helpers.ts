/**
 * mission-view-helpers.ts —— Pure functions shared by 3 mission-view projectors
 *
 * 落地依据：projector-framework-lift-plan §3.3（"不做 BaseClass，加 2 个 helper"）。
 *
 * 范围：仅承载三方共享的 *pure* derivation（cost view + snapshot version）。
 * 业务字段（reportArtifactVersion / errorMessage / metricsSummary.llmCost）由调用方传入。
 *
 * 调用方：三方 mission-view projector 实现。
 */

// ============================================================================
// Cost view
// ============================================================================

export interface BaseMissionCostInput {
  tokensUsed: bigint | number | null;
  costUsd: number | null;
  elapsedWallTimeMs: number | null;
  trajectoryStored?: number | null;
}

export interface BaseMissionCostView {
  tokensUsed: string | null;
  costUsd: number | null;
  elapsedWallTimeMs: number | null;
  trajectoryStored: number | null;
  currency: "USD";
}

/**
 * 把行级 cost 字段拼成 view shape。
 * - tokensUsed: bigint → string（避免 JSON 精度丢失），null fallback
 * - costUsd / elapsedWallTimeMs / trajectoryStored: null fallback
 * - currency: 固定 "USD"
 */
export function buildMissionCostView(
  row: BaseMissionCostInput,
): BaseMissionCostView {
  return {
    tokensUsed: row.tokensUsed != null ? String(row.tokensUsed) : null,
    costUsd: row.costUsd ?? null,
    elapsedWallTimeMs: row.elapsedWallTimeMs ?? null,
    trajectoryStored: row.trajectoryStored ?? null,
    currency: "USD",
  };
}

// ============================================================================
// Snapshot version reducer (§6.7.1)
// ============================================================================

export interface BaseSnapshotVersionInput {
  lastCompletedStage?: number | null;
  completedAt?: Date | null;
}

export interface SnapshotVersionExtras {
  /** 累加到版本号的 int 字段（如 reportArtifactVersion） */
  extraInts?: ReadonlyArray<number | null | undefined>;
  /** 每个非空值 +1（如 finalScore presence / errorMessage presence） */
  extraFlags?: ReadonlyArray<unknown>;
}

/**
 * §6.7.1 snapshot version reducer —— 任何已观测的视图相关变化触发 +1。
 *
 * 复合规则：
 *   - lastCompletedStage 累加（stage ordinal 是 monotonic increasing）
 *   - completedAt 出现 +1
 *   - extras.extraInts 中每个非空 int 直接累加
 *   - extras.extraFlags 中每个非空值 +1
 */
export function deriveSnapshotVersionFromRow(
  row: BaseSnapshotVersionInput,
  extras?: SnapshotVersionExtras,
): number {
  let v = 0;
  if (row.lastCompletedStage != null) v += row.lastCompletedStage;
  if (row.completedAt != null) v += 1;
  for (const n of extras?.extraInts ?? []) {
    if (n != null) v += n;
  }
  for (const f of extras?.extraFlags ?? []) {
    if (f != null) v += 1;
  }
  return v;
}
