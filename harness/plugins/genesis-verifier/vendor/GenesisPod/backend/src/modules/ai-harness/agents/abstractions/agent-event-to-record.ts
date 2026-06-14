/**
 * toMissionEventRecord — emit→persist boundary converter (Gap 5 / RB-Gap5)
 *
 * Enforces the typed `AgentEventPayload` boundary at the point where a
 * well-typed `IAgentEvent` is serialized into the deliberately-generic
 * `MissionEventRecord` (payload: unknown).
 *
 * Design:
 *   - Pure function — no side effects, no I/O.
 *   - `eventId` is caller-supplied so the converter stays stateless.
 *   - `MissionEventRecord.payload` is kept as `unknown` (per Option A, Gap 5);
 *     the IAgentEvent.payload type is validated at compile time via the
 *     `AgentEventPayload` parameter type, not at runtime.
 */

import { randomUUID } from "crypto";
import type { IAgentEvent } from "./agent-event.interface";
import type { MissionEventRecord } from "../../lifecycle/mission-lifecycle/abstractions/mission-store.interface";

/**
 * Converts a typed `IAgentEvent` to a `MissionEventRecord` for persistence.
 *
 * @param event     - The strongly-typed agent event (payload enforced as AgentEventPayload).
 * @param missionId - The mission this event belongs to.
 * @param eventId   - Optional stable ID; defaults to a new UUID.
 */
export function toMissionEventRecord(
  event: IAgentEvent,
  missionId: string,
  eventId?: string,
): MissionEventRecord {
  return {
    missionId,
    eventId: eventId ?? randomUUID(),
    type: event.type,
    // AgentEventPayload satisfies the payload: unknown contract at the boundary.
    // The type information is preserved in the serialized value; consumers that
    // need the typed form should read from IAgentEvent, not from this record.
    payload: event.payload,
    ts: event.timestamp,
    agentId: event.agentId,
  };
}
