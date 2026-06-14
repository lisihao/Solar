/**
 * NarrativeEmitter — playground-specific thin binding over ai-harness narrate factory
 *
 * R2-#50: The generic narrate() function and NarrativeEvent/NarrativeTag types now
 * live in ai-harness (protocols/ipc/narrate.ts) and are exported via the harness
 * facade. This file is a binding shim that:
 *   - Re-exports the types so stage files keep the same import path
 *   - Binds the playground-specific event type string "playground.agent:narrative"
 *     so all 15 call sites remain unchanged (no extra argument needed)
 *
 * Call sites continue to use:  narrate(emit, missionId, userId, { stage, role, tag, text })
 */

import { narrate as harnessNarrate } from "@/modules/ai-harness/facade";
import type { NarrativeEvent } from "@/modules/ai-harness/facade";
import type { EmitFn } from "../context/mission-deps";

export type { NarrativeEvent, NarrativeTag } from "@/modules/ai-harness/facade";

/** NarrativeStage enum kept here — it is playground-domain-specific (not harness concern). */
export type NarrativeStage =
  | "s1-budget"
  | "s2-leader-plan"
  | "s3-researchers"
  | "s4-leader-assess"
  | "s5-reconciler"
  | "s6-analyst"
  | "s7-writer-outline"
  | "s8-writer-draft"
  | "s8b-quality-enhancement"
  | "s9-critic-l4"
  | "s9b-objective-evaluation"
  | "s10-leader-signoff"
  | "s11-persist";

const PLAYGROUND_NARRATIVE_EVENT_TYPE = "playground.agent:narrative";

export async function narrate(
  emit: EmitFn,
  missionId: string,
  userId: string,
  ev: NarrativeEvent,
): Promise<void> {
  return harnessNarrate(
    emit,
    missionId,
    userId,
    PLAYGROUND_NARRATIVE_EVENT_TYPE,
    ev,
  );
}
