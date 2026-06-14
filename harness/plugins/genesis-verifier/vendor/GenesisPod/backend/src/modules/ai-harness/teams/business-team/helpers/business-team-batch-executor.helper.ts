/**
 * BusinessAgentTeam — Batch Executor Framework (P4 generic helper)
 *
 * Concurrent per-item execution with budget gate + per-item error boundary.
 * @migrated-from ai-app chapter-batch-executor.helper.ts
 * (PR-D-1 god-class split, R2-#45 pre-dispatch budget gate).
 *
 * Domain terms (per-item heading) are parameterised: the framework takes a
 * generic `TItem extends BusinessTeamBatchItem` and an optional `slice` context
 * label, so the same mechanism can drive section loops, dim sub-loops, or any
 * other "execute N items concurrently under a shared budget" pipeline.
 *
 * Design invariants (Karpathy: keep it boring + mechanical):
 *   1. **Pre-dispatch budget gate**: if `pool.isExhausted()` returns true before a
 *      slot fires, the item is skipped (no LLM call starts) and `onItemThrow`
 *      receives a synthetic `budget-pool-exhausted` error so the caller can emit
 *      a terminal event and close the per-item state machine cleanly.
 *   2. **Per-item error boundary**: a `runOne` rejection is caught, logged, and
 *      converted into a `null` result so unrelated items continue. Without this,
 *      `Promise.allSettled` would silently swallow the rejection and the
 *      frontend would never receive a terminal event → item stuck in a transient
 *      state.
 *   3. **Backward-compatible**: `pool` is optional. Legacy callers that have not
 *      yet adopted the mission budget pool keep working unchanged.
 *
 * Business-side adapter pattern (binding shim):
 * ```ts
 * import { executeBusinessTeamBatch } from "@/modules/ai-harness/facade";
 * // example: per-chapter loop binding
 * await executeBusinessTeamBatch(
 *   outline,
 *   concurrency,
 *   headingsSnapshot,
 *   (ch, snap) => runChapterPipeline(ch, snap),
 *   (ch, err) => emitChapterFailedDone(ch, err),
 *   deps,
 *   { missionId, sliceName: dimensionName },
 *   pool,
 * );
 * ```
 */

import pLimit from "p-limit";
import type { MissionBudgetPool } from "../../../facade";

/**
 * Minimal shape every batch item must satisfy.
 * `index` is the stable item identity used for logging.
 */
export interface BusinessTeamBatchItem {
  index: number;
}

/**
 * Logging surface the framework needs. Subset of NestJS Logger / MissionDeps.log
 * so tests can pass a plain jest.fn() bag.
 */
export interface BusinessTeamBatchLogger {
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Context labels used only for human-readable log lines.
 * `sliceName` replaces the original team-specific `dimensionName` so callers
 * from other teams (social platform, radar source, etc.) can label slices.
 */
export interface BusinessTeamBatchContext {
  missionId: string;
  /** Human-readable label for the slice this batch belongs to (e.g. dimension/platform/source). */
  sliceName: string;
}

/**
 * Execute all items concurrently (up to `concurrency` at a time) under a shared
 * mission budget pool.
 *
 * @param items         - Ordered list of items (each must expose `.index`).
 * @param concurrency   - Maximum number of parallel slots.
 * @param snapshot      - Immutable readonly snapshot passed unchanged to every runOne (e.g. prior headings).
 * @param runOne        - Single-item pipeline; returns null on per-item failure.
 * @param onItemThrow   - Called when runOne throws OR when pool is exhausted (caller emits terminal event).
 * @param deps          - Logging surface (warn / error only).
 * @param ctx           - { missionId, sliceName } for log lines.
 * @param pool          - Optional shared mission budget pool; if exhausted before
 *                        an item slot fires, the item is skipped and onItemThrow
 *                        receives a synthetic `budget-pool-exhausted` error.
 */
export async function executeBusinessTeamBatch<
  TItem extends BusinessTeamBatchItem,
  TSnapshot,
  TResult,
>(
  items: TItem[],
  concurrency: number,
  snapshot: TSnapshot,
  runOne: (item: TItem, snapshot: TSnapshot) => Promise<TResult | null>,
  onItemThrow: (item: TItem, err: unknown) => Promise<void>,
  deps: { log: BusinessTeamBatchLogger },
  ctx: BusinessTeamBatchContext,
  pool?: MissionBudgetPool,
): Promise<PromiseSettledResult<TResult | null>[]> {
  const limit = pLimit(concurrency);
  return Promise.allSettled(
    items.map((item) =>
      limit(async () => {
        // ★ Pre-dispatch budget gate: skip item entirely if pool exhausted before
        //   this slot fires. Emit terminal event via onItemThrow so the frontend
        //   state machine closes cleanly.
        if (pool?.isExhausted?.()) {
          deps.log.warn(
            `[${ctx.missionId}] budget pool exhausted; skipping item §${item.index} (${ctx.sliceName})`,
          );
          await onItemThrow(
            item,
            new Error("budget-pool-exhausted: skipped before LLM call"),
          );
          return null;
        }
        // ★ Per-item error boundary: runOne throws are caught here. Otherwise
        //   Promise.allSettled would silently filter the rejection so the
        //   frontend never receives a terminal event → item stuck in a transient
        //   state. Emit terminal via onItemThrow before returning null.
        try {
          return await runOne(item, snapshot);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          deps.log.error(
            `[${ctx.missionId}] item pipeline §${item.index} (${ctx.sliceName}) threw: ${msg}`,
          );
          await onItemThrow(item, err);
          return null;
        }
      }),
    ),
  );
}
