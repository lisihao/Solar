/**
 * SelfDrivenEventRelay — relays the self-driven mission generator's events onto
 * the shared EventBus as `self-driven.*` DomainEvents.
 *
 * Subclasses the shared EventRelayFramework (namespace "self-driven"). The
 * detached background runner (Stage 2) calls {@link emitMissionEvent} for every
 * event the underlying `SelfDrivenMissionRunner.run()` generator yields, so the
 * EventBus can fan it to the live Socket.IO room and the durable event buffer.
 *
 * NB: imports the framework via relative path (NOT ai-harness/facade) — the
 * facade barrel re-exports this framework, so going through it here would form a
 * circular load (same rationale as event-relay.framework.ts's own imports).
 */

import { Injectable } from "@nestjs/common";
import { EventBus } from "@/common/events/event-bus";
import { EventRelayFramework } from "../../business-team/events/event-relay.framework";
import type { SelfDrivenMissionEvent } from "../abstractions/self-driven-mission.types";

@Injectable()
export class SelfDrivenEventRelay extends EventRelayFramework {
  constructor(eventBus: EventBus) {
    super(eventBus, "self-driven");
  }

  /**
   * Relay one generator event. The event type is namespaced
   * (`self-driven.<type>`) and the full event object is carried as payload so
   * the frontend can render it verbatim from the live socket or /replay.
   */
  async emitMissionEvent(
    event: SelfDrivenMissionEvent,
    userId: string,
  ): Promise<void> {
    await this.emitEvent({
      type: `self-driven.${event.type}`,
      missionId: event.missionId,
      userId,
      payload: event,
    });
  }
}
