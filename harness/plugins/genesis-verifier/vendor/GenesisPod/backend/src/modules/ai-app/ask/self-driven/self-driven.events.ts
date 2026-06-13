/**
 * SelfDrivenEvents — event type registry for the Self-Driven Agent Team.
 *
 * EventBus drops (with a warn) any event whose `type` is not registered here,
 * so every event the runner relays MUST be declared. The payload of each event
 * is the full SelfDrivenMissionEvent object; we validate the two invariant
 * fields (type + missionId) and passthrough the rest — the precise per-event
 * shape is already enforced by the TS union on the emit side.
 *
 * Mirrors the runner's SelfDrivenMissionEvent union (self-driven-mission.types.ts).
 * `self-driven.chunk` is registered so the live socket receives it, but the
 * buffer rejects it (see SelfDrivenMissionEventBuffer) so it is never persisted.
 */

import { z } from "zod";
import type { DomainEventTypeSpec } from "@/modules/ai-harness/facade";

const base = z
  .object({ type: z.string(), missionId: z.string() })
  .passthrough();

const S = (suffix: string): DomainEventTypeSpec => ({
  type: `self-driven.${suffix}`,
  schema: base,
});

export const SELF_DRIVEN_EVENTS: readonly DomainEventTypeSpec[] = [
  S("mission_started"),
  S("phase"),
  S("plan"),
  S("team_built"),
  S("step_started"),
  S("step_completed"),
  S("chunk"), // live socket only — buffer rejects, never persisted
  S("tool_call"),
  S("deliverable"),
  S("done"),
  S("error"),
  S("awaiting_approval"),
  S("approval_resolved"),
];
