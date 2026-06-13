/**
 * NarrativeEmitter — social-specific thin binding over ai-harness narrate factory
 *
 * Wave-1 P4 (2026-05-24, mirroring playground R2-#50): The generic narrate()
 * function and NarrativeEvent/NarrativeTag types live in ai-harness
 * (protocols/ipc/narrate.ts) and are exported via the harness facade. This
 * file is a binding shim that:
 *   - Re-exports the types so stage files keep the same import path
 *   - Binds the social-specific event type string "social.agent:narrative"
 *     so all 14 call sites in stages/ remain unchanged (no extra argument
 *     needed)
 *
 * Call sites continue to use:  narrate(emit, missionId, userId, { stage, role, tag, text })
 */

import { narrate as harnessNarrate } from "@/modules/ai-harness/facade";
import type { NarrativeEvent } from "@/modules/ai-harness/facade";
import type { EmitFn } from "../context/mission-deps";

export type { NarrativeEvent, NarrativeTag } from "@/modules/ai-harness/facade";

/** NarrativeStage enum kept here — it is social-domain-specific (not harness concern). */
export type NarrativeStage =
  | "s1-budget-eval"
  | "s2-platform-probe"
  | "s3-content-transform"
  | "s4-leader-assess-transform"
  | "s5-cover-craft"
  | "s6-body-compose"
  | "s7-polish-review"
  | "s8-publish-execute"
  | "s8b-publish-retry"
  | "s9-publish-verify"
  | "s10-leader-signoff"
  | "s11-mission-persist"
  | "s12-self-evolution";

/** NarrativeRole enum kept here — it is social-domain-specific (not harness concern). */
export type NarrativeRole =
  | "leader"
  | "steward"
  | "platform-probe"
  | "content-transformer"
  | "cover-artist"
  | "composer"
  | "polish-reviewer"
  | "publish-executor"
  | "publish-verifier"
  | "mission";

const SOCIAL_NARRATIVE_EVENT_TYPE = "social.agent:narrative";

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
    SOCIAL_NARRATIVE_EVENT_TYPE,
    ev,
  );
}
