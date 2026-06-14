/**
 * narrate — generic agent narrative event emitter
 *
 * R2-#50: Extracted to ai-harness so that any ai-app module can emit structured
 * "human-readable narration" events through the domain event bus without
 * duplicating the emit pattern.
 *
 * Usage in ai-app (binding shim pattern):
 *   import { narrate, NarrativeEvent, NarrativeTag } from "@/modules/ai-harness/facade";
 *   await narrate(emit, missionId, userId, "my-app.agent:narrative", ev);
 *
 * Design:
 *   - text must be natural language (no JSON dumps)
 *   - tag controls frontend icon / colour
 *   - emit failures are swallowed (best-effort — narration must not break the pipeline)
 */

import type { EmitFn } from "./stage-emit.utils";

// ── Types exported via facade ─────────────────────────────────────────────

export type NarrativeTag =
  | "thinking"
  | "planning"
  | "searching"
  | "scraping"
  | "analyzing"
  | "writing"
  | "reviewing"
  | "judging"
  | "publishing" // P4 (2026-05-24): social publish stages emit this
  | "verifying" // P4 (2026-05-24): social publish-verify stage emits this
  | "signing"
  | "warning"
  | "success"
  | "info";

export interface NarrativeEvent {
  stage: string;
  role: string;
  tag: NarrativeTag;
  text: string;
  /** dimension name (researcher / chapter narrative) */
  dimension?: string;
  /** chapter index (chapter-level narrative) */
  chapterIndex?: number;
  /** agent id (lets the frontend map narrative to a specific agent row) */
  agentId?: string;
}

// ── Factory ───────────────────────────────────────────────────────────────

/**
 * Emit a structured narrative event through the domain event bus.
 *
 * @param emit      - the EmitFn provided by mission deps
 * @param missionId
 * @param userId
 * @param eventType - fully-qualified domain event type string
 * @param ev        - the narrative payload
 */
export async function narrate(
  emit: EmitFn,
  missionId: string,
  userId: string,
  eventType: string,
  ev: NarrativeEvent,
): Promise<void> {
  await emit({
    type: eventType,
    missionId,
    userId,
    agentId: ev.agentId,
    payload: {
      stage: ev.stage,
      role: ev.role,
      tag: ev.tag,
      text: ev.text,
      dimension: ev.dimension,
      chapterIndex: ev.chapterIndex,
      agentId: ev.agentId,
    },
  }).catch(() => {
    /* narrative best-effort — do not break the pipeline */
  });
}
