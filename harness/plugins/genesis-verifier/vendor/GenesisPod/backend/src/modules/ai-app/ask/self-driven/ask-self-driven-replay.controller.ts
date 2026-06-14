/**
 * AskSelfDrivenReplayController — durable event replay for reconnect/refresh.
 *
 * GET /api/v1/ask/self-driven/replay/:missionId?since=<ts>
 *
 * Returns the structural event history (chunk events are socket-only and never
 * journaled) from the in-memory buffer, falling back to the DB after a pod
 * recycle. The frontend calls this on mount, on socket (re)connect, and after a
 * refresh, deduping by (type,timestamp) against a max-ts cursor. IDOR-guarded:
 * only the mission owner may read.
 */

import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import {
  RateLimit,
  RateLimitGuard,
} from "../../../../common/guards/rate-limit.guard";
import { MissionOwnershipRegistry } from "@/modules/ai-harness/facade";
import { SelfDrivenMissionEventBuffer } from "./self-driven-mission-event-buffer.service";
import { AskSelfDrivenMissionStore } from "./ask-self-driven-mission.store";

@ApiTags("AI Ask")
@Controller("ask/self-driven")
@UseGuards(JwtAuthGuard)
export class AskSelfDrivenReplayController {
  constructor(
    private readonly buffer: SelfDrivenMissionEventBuffer,
    private readonly ownership: MissionOwnershipRegistry,
    private readonly store: AskSelfDrivenMissionStore,
  ) {}

  @Get("replay/:missionId")
  @UseGuards(RateLimitGuard)
  @RateLimit({ maxRequests: 60, windowSeconds: 60, keyType: "user" })
  @ApiOperation({ summary: "Replay durable self-driven mission events" })
  async replay(
    @Param("missionId") missionId: string,
    @Query("since") since: string | undefined,
    @Request() req: { user: { id: string } },
  ): Promise<{ events: readonly unknown[]; serverNow: number }> {
    await this.assertOwner(missionId, req.user.id);

    const sinceTs = since ? Number(since) : undefined;
    const ts = Number.isFinite(sinceTs as number)
      ? (sinceTs as number)
      : undefined;

    let events: readonly unknown[] = this.buffer.read(missionId, ts);
    if (events.length === 0) {
      events = await this.buffer.readPersisted(missionId, ts);
    }
    return { events, serverNow: Date.now() };
  }

  private async assertOwner(missionId: string, userId: string): Promise<void> {
    let owner = this.ownership.getOwner(missionId);
    if (!owner) {
      owner = (await this.store.getOwnerById(missionId)) ?? undefined;
      if (owner) this.ownership.assign(missionId, owner);
    }
    if (!owner) throw new NotFoundException("Mission not found");
    if (owner !== userId) throw new NotFoundException("Mission not found");
  }
}
