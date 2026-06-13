/**
 * SelfDrivenMissionEventBuffer — in-memory FIFO + DB write-through journal.
 *
 * Mirrors playground's MissionEventBuffer: subclasses the shared
 * BusinessTeamEventBufferFramework and only injects self-driven-specific hooks
 * (`self-driven.*` prefix filter + ask_self_driven_mission_events table I/O).
 *
 * CHUNK POLICY (key divergence from playground): per-token `self-driven.chunk`
 * events are socket-only/ephemeral. They are intentionally rejected here so they
 * are NOT held in the in-memory FIFO, NOT persisted, and NOT replayable — only
 * structural events (plan / step_* / awaiting_approval / deliverable / done /
 * error / ...) are journaled. This keeps the events table from exploding under
 * high-frequency token streaming. The live SocketBroadcastAdapter still fans
 * chunk events to the room for the typewriter effect.
 */

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import {
  BusinessTeamEventBufferFramework,
  type EventBufferHooks,
} from "@/modules/ai-harness/facade";

/** Live-only event type that must never be persisted or buffered for replay. */
const EPHEMERAL_EVENT_TYPE = "self-driven.chunk";

@Injectable()
export class SelfDrivenMissionEventBuffer extends BusinessTeamEventBufferFramework {
  constructor(prisma: PrismaService) {
    const hooks: EventBufferHooks = {
      adapterId: "self-driven.mission-buffer",
      acceptsEvent: (type) =>
        type.startsWith("self-driven.") && type !== EPHEMERAL_EVENT_TYPE,
      persistEvent: async (event) => {
        await prisma.askSelfDrivenMissionEvent.create({
          data: {
            missionId: event.missionId,
            type: event.type.slice(0, 120),
            agentId: event.agentId?.slice(0, 120),
            traceId: event.traceId?.slice(0, 120),
            payload: (event.payload ?? {}) as object,
            ts: BigInt(event.timestamp),
          },
        });
      },
      fetchPersisted: async (missionId, sinceTs, limit) => {
        const rows = await prisma.askSelfDrivenMissionEvent.findMany({
          where: {
            missionId,
            ...(sinceTs != null ? { ts: { gte: BigInt(sinceTs) } } : {}),
          },
          orderBy: { ts: "asc" },
          take: limit,
        });
        return rows.map((r) => ({
          type: r.type,
          payload: r.payload as unknown,
          agentId: r.agentId ?? undefined,
          traceId: r.traceId ?? undefined,
          timestamp: Number(r.ts),
        }));
      },
    };
    super(hooks, "SelfDrivenMissionEventBuffer");
  }
}
