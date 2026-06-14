/**
 * RadarMissionQueryService — Canonical view input aggregator for radar（B7-2）
 *
 * 落地依据：thinning plan §B7-2 / §6.5.1 rule 3.
 *
 * 2026-05-26 B7 完整 port：events 加入 inputs（mirror playground/social），
 * 供 radar-todo-board projector 消费。
 */

import { ForbiddenException, Injectable } from "@nestjs/common";

import { RadarMissionStore } from "../lifecycle/radar-mission-store.service";
import { RadarMissionEventBuffer } from "../lifecycle/radar-mission-event-buffer.service";

export interface RadarMissionQueryInputs {
  mode: "row-loaded";
  missionId: string;
  row: NonNullable<Awaited<ReturnType<RadarMissionStore["getById"]>>>;
  /** Replay events（radar 内存 FIFO；无 DB write-through 按 §radar-mission-event-buffer 说明）。 */
  events: ReadonlyArray<{
    type: string;
    payload: unknown;
    timestamp: number;
    agentId?: string;
    traceId?: string;
  }>;
}

@Injectable()
export class RadarMissionQueryService {
  constructor(
    private readonly store: RadarMissionStore,
    private readonly eventBuffer: RadarMissionEventBuffer,
  ) {}

  async loadInputs(
    missionId: string,
    userId: string | undefined,
  ): Promise<RadarMissionQueryInputs> {
    if (!userId) {
      throw new ForbiddenException("Authentication required");
    }
    const row = await this.store.getById(missionId, userId);
    if (!row) {
      throw new ForbiddenException(`run ${missionId} not found`);
    }
    const events = this.eventBuffer.read(missionId);
    return { mode: "row-loaded", missionId, row, events };
  }
}
