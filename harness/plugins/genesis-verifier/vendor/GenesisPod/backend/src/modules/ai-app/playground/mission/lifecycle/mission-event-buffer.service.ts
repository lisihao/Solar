/**
 * MissionEventBuffer — 内存事件缓冲 + DB write-through 兜底
 *
 * ★ 2026-05-24 P6 Wave 1：framework 化下沉到
 *   `ai-harness/teams/business-team/lifecycle/business-team-event-buffer.framework.ts`。
 *   本文件仅注入 playground 专属 hooks（playground.* 前缀过滤 +
 *   agent_playground_mission_events 表写入 / 读取）。
 *
 * - 写：append 到内存（FIFO 5000，TTL 1h）+ fire-and-forget INSERT 到
 *   `agent_playground_mission_events` 表，不阻塞主流程。
 * - 读：sync 优先返回内存（fast path）。无内存时调用方需用 readPersisted() 兜底。
 */

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  BusinessTeamEventBufferFramework,
  type EventBufferHooks,
} from "@/modules/ai-harness/facade";

@Injectable()
export class MissionEventBuffer extends BusinessTeamEventBufferFramework {
  constructor(prisma: PrismaService) {
    const hooks: EventBufferHooks = {
      adapterId: "playground.mission-buffer",
      acceptsEvent: (type) => type.startsWith("playground."),
      persistEvent: async (event) => {
        await prisma.agentPlaygroundMissionEvent.create({
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
        const rows = await prisma.agentPlaygroundMissionEvent.findMany({
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
    super(hooks, "MissionEventBuffer");
  }
}
