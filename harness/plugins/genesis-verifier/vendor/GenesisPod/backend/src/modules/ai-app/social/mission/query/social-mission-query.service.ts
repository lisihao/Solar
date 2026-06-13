/**
 * SocialMissionQueryService — Canonical view input aggregator for social（B7-1）
 *
 * 落地依据：thinning plan §B7-1 / §6.5.1 rule 3 (ownership in QueryService).
 *
 * 2026-05-26 B7 完整 port：events 加入 inputs（mirror playground MissionQueryService），
 * 供 todo board projector + artifact composer 消费。
 */

import { ForbiddenException, Injectable } from "@nestjs/common";

import { SocialMissionStore } from "../lifecycle/social-mission-store.service";
import { SocialEventBuffer } from "../lifecycle/social-event-buffer.service";

export interface SocialMissionQueryInputs {
  mode: "starting-placeholder" | "row-loaded";
  missionId: string;
  row: Awaited<ReturnType<SocialMissionStore["getById"]>>;
  /** Replay events（buffer 优先 + persisted fallback；first-cut social buffer 仅内存）。 */
  events: ReadonlyArray<{
    type: string;
    payload: unknown;
    timestamp: number;
    agentId?: string;
    traceId?: string;
  }>;
}

@Injectable()
export class SocialMissionQueryService {
  constructor(
    private readonly store: SocialMissionStore,
    private readonly eventBuffer: SocialEventBuffer,
  ) {}

  async loadInputs(
    missionId: string,
    userId: string | undefined,
  ): Promise<SocialMissionQueryInputs> {
    if (!userId) {
      throw new ForbiddenException("Authentication required");
    }
    const row = await this.store.getById(missionId, userId);
    if (!row) {
      throw new ForbiddenException(`mission ${missionId} not found`);
    }
    const events = this.eventBuffer.read(missionId);
    return { mode: "row-loaded", missionId, row, events };
  }
}
