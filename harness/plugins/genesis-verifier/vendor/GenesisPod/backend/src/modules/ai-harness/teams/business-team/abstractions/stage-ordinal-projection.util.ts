/**
 * stage-ordinal-projection.util.ts — Shared canonical helper（C / B6）
 *
 * 落地依据：thinning plan §B6-3 shared mechanism extraction in existing
 * framework areas (abstractions/ 是 §22.2 approved 子目录).
 *
 * 用途：多 mission app 共用的 first-cut "row.lastCompletedStage +
 * mission.status → stages[]" 投影算法。
 *
 * 算法（business-agnostic）：
 *   - ord ≤ lastCompleted          → done
 *   - ord == lastCompleted + 1     → mission.status terminal-success → done
 *                                    mission.status terminal-failed → failed
 *                                    其他 → running
 *   - ord > lastCompleted + 1      → pending
 *
 * Apps may extend / override (e.g. events-based projection with attempts +
 * rerun-in-flight semantics). 本 helper 是 first-cut baseline。
 *
 * Lift criteria (plan §8.2):
 *   ✅ business-agnostic — 不依赖具体 app status enum
 *   ✅ parameterizable — apps 传入自己的 stages list
 *   ✅ benefits ≥ 2 apps
 *   ✅ no app-code import
 *   ✅ harness-only fixture-testable
 */

import type {
  MissionViewBaseStage,
  StageStatus as MissionViewStageStatus,
  MissionStatus as MissionViewStatus,
} from "./mission-view-base.contract";

export interface StagePresetEntry {
  id: string;
  label: string;
}

const TERMINAL_FAILED: ReadonlySet<MissionViewStatus> = new Set([
  "failed",
  "cancelled",
  "quality-failed",
]);

/**
 * 按 ordinal + mission status 投影 stages[]。
 *
 * @param stages       App-defined stage presets (顺序敏感；ordinal = index + 1)
 * @param lastCompletedStage  Persisted ordinal of last completed stage (Int? from
 *                            Prisma row.last_completed_stage)
 * @param missionStatus       Outward MissionViewStatus（已经过 §6.4.1.a per-app
 *                            persistence-to-view mapping）
 */
export function projectStagesByOrdinal(
  stages: ReadonlyArray<StagePresetEntry>,
  lastCompletedStage: number | null | undefined,
  missionStatus: MissionViewStatus,
): MissionViewBaseStage[] {
  const lastCompleted = lastCompletedStage ?? 0;
  const isCompleted = missionStatus === "completed";
  const isTerminalFailed = TERMINAL_FAILED.has(missionStatus);
  return stages.map((s, i) => {
    const ord = i + 1;
    let status: MissionViewStageStatus;
    if (ord <= lastCompleted) {
      status = "done";
    } else if (ord === lastCompleted + 1) {
      if (isCompleted) status = "done";
      else if (isTerminalFailed) status = "failed";
      else status = "running";
    } else {
      status = "pending";
    }
    return { id: s.id, label: s.label, status };
  });
}
