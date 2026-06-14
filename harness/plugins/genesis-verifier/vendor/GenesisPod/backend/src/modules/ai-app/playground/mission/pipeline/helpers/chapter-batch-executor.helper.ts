/**
 * chapter-batch-executor.helper.ts — playground binding shim over harness framework
 *
 * Wave-1 P4 (2026-05-24): The batch-executor mechanism (concurrent per-item
 * execution + pre-dispatch budget gate + per-item error boundary) was generic
 * enough to be extracted to ai-harness so radar/social/future teams can reuse
 * it. The playground-specific terms ("chapter") map onto the framework's
 * neutral terms ("item") via this binding shim:
 *
 *   chapter         → TItem extends BusinessTeamBatchItem
 *   chapter.heading → caller-specific, framework ignores
 *   dimensionName   → sliceName (framework label, log-only)
 *
 * All previous call-sites keep their existing imports and signatures unchanged.
 */

import { executeBusinessTeamBatch } from "@/modules/ai-harness/facade";
import type { MissionBudgetPool } from "@/modules/ai-harness/facade";
import type { MissionDeps } from "../../context/mission-deps";

/**
 * Minimal shape required for a chapter outline entry consumed by this executor.
 */
export interface BatchChapterSpec {
  index: number;
  heading: string;
}

/**
 * Execute all chapters concurrently (up to `concurrency` at a time).
 *
 * Thin pass-through to {@link executeBusinessTeamBatch} — see harness framework
 * for the full mechanism contract (R2-#45 pre-dispatch budget gate +
 * per-chapter error boundary that converts throws into `null` results so the
 * frontend always receives a terminal event).
 */
export async function executeChapterBatch<
  TChapter extends BatchChapterSpec,
  TWritten,
>(
  outline: TChapter[],
  concurrency: number,
  headingsSnapshot: readonly string[],
  runOne: (
    chapter: TChapter,
    snapshot: readonly string[],
  ) => Promise<TWritten | null>,
  onChapterThrow: (chapter: TChapter, err: unknown) => Promise<void>,
  deps: Pick<MissionDeps, "log">,
  ctx: { missionId: string; dimensionName: string },
  pool?: MissionBudgetPool,
): Promise<PromiseSettledResult<TWritten | null>[]> {
  return executeBusinessTeamBatch<TChapter, readonly string[], TWritten>(
    outline,
    concurrency,
    headingsSnapshot,
    runOne,
    onChapterThrow,
    deps,
    { missionId: ctx.missionId, sliceName: ctx.dimensionName },
    pool,
  );
}
