/**
 * NarrativeEmitter — writing-specific thin binding over ai-harness narrate factory
 *
 * Mirrors the pattern in playground and social: binds the writing-domain
 * event type string "writing.agent:narrative" so stage files can call
 * narrate(emit, missionId, userId, { stage, role, tag, text }) without
 * knowing the event type string.
 */

import { narrate as harnessNarrate } from "@/modules/ai-harness/facade";
import type { NarrativeEvent } from "@/modules/ai-harness/facade";
import type { EmitFn } from "../context/mission-deps";

export type { NarrativeEvent, NarrativeTag } from "@/modules/ai-harness/facade";

const WRITING_NARRATIVE_EVENT_TYPE = "writing.agent:narrative";

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
    WRITING_NARRATIVE_EVENT_TYPE,
    ev,
  );
}
