/**
 * RadarMissionEventBuffer — 内存事件缓冲（B6-L3 lift：复用 framework）
 *
 * 注册为 EventBus adapter，截获所有 ai-radar.* 事件按 runId(=missionId)
 * 缓存，供 GET /radar/replay/:runId 回放。
 *
 * 2026-05-26 B6 lift：原 80-LOC 自实现替换为继承 BusinessTeamEventBufferFramework；
 * radar 无 DB write-through（短任务，FIFO + TTL 足够），persistEvent / fetchPersisted
 * 走 no-op hooks（仅内存）。
 *
 * 与 playground MissionEventBuffer 的唯一差异：no DB persist（短任务）。
 */

import { Injectable } from "@nestjs/common";
import {
  BusinessTeamEventBufferFramework,
  type EventBufferHooks,
} from "@/modules/ai-harness/facade";

export type RadarBufferedEvent = {
  readonly type: string;
  readonly payload: unknown;
  readonly timestamp: number;
};

@Injectable()
export class RadarMissionEventBuffer extends BusinessTeamEventBufferFramework {
  constructor() {
    const hooks: EventBufferHooks = {
      adapterId: "ai-radar.mission-buffer",
      acceptsEvent: (type) => type.startsWith("ai-radar."),
      // radar 短任务无 DB write-through；persist no-op（事件仅留内存）
      persistEvent: () => Promise.resolve(),
      // 内存 FIFO 足够，fetchPersisted 返回空 — 调用方应 fallback 到 read()
      fetchPersisted: () => Promise.resolve([]),
    };
    super(hooks, "RadarMissionEventBuffer");
  }
}
