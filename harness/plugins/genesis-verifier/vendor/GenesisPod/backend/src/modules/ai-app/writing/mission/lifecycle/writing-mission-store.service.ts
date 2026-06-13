/**
 * WritingMissionStoreService — implements WritingMissionStore interface
 *
 * Implements the two methods declared in mission-deps.ts:
 *   • markIntermediateState — persists ctx patch to framework shared checkpoint
 *     (keyed by missionId); cascade-rerun reads it back via MissionCheckpointService.
 *   • markStageDegraded — emits "writing.stage:degraded" domain event so that the
 *     orchestrator + frontend can surface the soft-failure without blocking the mission.
 *
 * Design decisions (locked):
 *   - Middle state goes into the framework shared MissionCheckpointService (no new
 *     Prisma columns). The checkpoint payload is Partial<WritingMissionContext> merged
 *     on top of whatever was already saved.
 *   - markStageDegraded is never silently swallowed — it throws if eventBus.emit()
 *     fails. Caller (stage) decides whether to let that propagate or catch+log.
 *   - Event type "writing.stage:degraded" mirrors playground pattern
 *     "playground.stage:degraded", 7-field DomainEvent shape.
 *
 * @see docs/architecture/writing-pipeline-migration.md §3 (store)
 */

import { Injectable, Logger } from "@nestjs/common";
import type { WritingMissionStore } from "../context/mission-deps";
import type { WritingMissionContext } from "../context/mission-context";
import {
  MissionCheckpointService,
  EventBus,
} from "@/modules/ai-harness/facade";

@Injectable()
export class WritingMissionStoreService implements WritingMissionStore {
  private readonly log = new Logger(WritingMissionStoreService.name);

  constructor(
    private readonly checkpoint: MissionCheckpointService<
      Partial<WritingMissionContext>
    >,
    private readonly eventBus: EventBus,
  ) {}

  /**
   * Merges `patch` into the existing checkpoint payload for `missionId`.
   *
   * Merge strategy: shallow Object.assign — newer fields overwrite older ones.
   * For append-semantic fields (e.g. chapterDrafts[]), the caller is responsible
   * for providing the full accumulated array in `patch`.
   *
   * Checkpoint failure is swallowed (best-effort, matches framework policy in
   * checkpoint.service.ts save() — "checkpoint 失败不能阻断主流程").
   */
  async markIntermediateState(
    missionId: string,
    patch: Partial<WritingMissionContext>,
    userId?: string,
  ): Promise<void> {
    try {
      const existing = await this.checkpoint.load(missionId);
      const merged: Partial<WritingMissionContext> = Object.assign(
        {},
        existing?.payload ?? {},
        patch,
      );
      await this.checkpoint.save(
        missionId,
        merged,
        existing?.completedKeys ?? [],
        "running",
      );
      this.log.debug(
        `[checkpoint] markIntermediateState mission=${missionId} user=${userId ?? "?"} patchKeys=${Object.keys(patch).join(",")}`,
      );
    } catch (err) {
      // Best-effort: checkpoint failure must not block stage execution.
      this.log.warn(
        `[checkpoint] markIntermediateState failed mission=${missionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Emits "writing.stage:degraded" domain event.
   *
   * Payload (7 fields, mirroring playground "playground.stage:degraded"):
   *   DomainEvent outer: type, scope { userId, missionId }, payload, timestamp  (4)
   *   payload inner:     stage (=stepId), stepId, reason                        (3)
   *
   * Does NOT swallow errors — caller (stage catch block) decides how to handle.
   */
  async markStageDegraded(
    missionId: string,
    userId: string,
    stepId: string,
    reason: string,
  ): Promise<void> {
    const emitted = await this.eventBus.emit({
      type: "writing.stage:degraded",
      scope: { userId, missionId },
      payload: {
        stage: stepId,
        stepId,
        reason: reason.slice(0, 500),
      },
      timestamp: Date.now(),
    });

    if (!emitted) {
      // Event was dropped (unregistered type, throttle, or dedupe).
      // Log as warn so the caller can still decide to surface it.
      this.log.warn(
        `[event] writing.stage:degraded dropped (unregistered or throttled) mission=${missionId} stepId=${stepId}`,
      );
    }
  }
}
