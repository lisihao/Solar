/**
 * RerunGuardService —— playground 业务子类(继承 BusinessTeamRerunGuardFramework)
 *
 * 设计来源：rerun-overhaul-design-v1.md §3.1 / §3.2 / §3.7
 *
 * 2026-05-24 P5 (Wave 1)：framework 9-cell 决策 + ensureRerunable + zombieCleanup
 * 骨架已上提到 ai-harness/teams/business-team/rerun/business-team-rerun-guard.framework。
 * 本类只剩业务 hook：playground 事件表 schema / SQL LIKE BUSINESS_PREFIXES 查询 /
 * 终态 extra payload shape / event type 字符串。
 */

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  MissionStore,
  type PlaygroundTerminalExtra,
} from "../lifecycle/mission-store.service";
import { EVENT_CATEGORY } from "../lifecycle/event-categories";
import {
  BusinessTeamRerunGuardFramework,
  MissionLifecycleManager,
  type BusinessRerunGuardDetailMinimal,
  type BusinessTeamRerunGuardHooks,
} from "@/modules/ai-harness/facade";

export type MissionStatus =
  | "running"
  | "completed"
  | "failed"
  | "quality-failed"
  | "cancelled";

/** playground detail 投影给 framework guard（必含 status / heartbeatAt） */
interface PlaygroundGuardDetail extends BusinessRerunGuardDetailMinimal {
  readonly id: string;
  readonly status: string;
  readonly heartbeatAt: Date | null;
}

@Injectable()
export class RerunGuardService extends BusinessTeamRerunGuardFramework<
  PlaygroundGuardDetail,
  PlaygroundTerminalExtra
> {
  constructor(
    prisma: PrismaService,
    store: MissionStore,
    lifecycleManager: MissionLifecycleManager,
  ) {
    const hooks: BusinessTeamRerunGuardHooks<
      PlaygroundGuardDetail,
      PlaygroundTerminalExtra
    > = {
      namespace: "playground",
      detailReader: async (missionId, userId) => {
        const detail = await store.getById(missionId, userId);
        if (!detail) return null;
        return {
          id: detail.id,
          status: detail.status,
          heartbeatAt: detail.heartbeatAt ?? null,
        };
      },
      latestBusinessEventTsReader: async (missionId) => {
        // SQL LIKE BUSINESS_PREFIXES（playground 业务事件表 schema）
        const prefixes = EVENT_CATEGORY.BUSINESS_PREFIXES;
        const likeClause = prefixes
          .map((_, i) => `type LIKE $${i + 2}`)
          .join(" OR ");
        const params: unknown[] = [missionId, ...prefixes.map((p) => `${p}%`)];
        const rows = await prisma.$queryRawUnsafe<{ ts: bigint }[]>(
          `SELECT ts FROM agent_playground_mission_events
           WHERE mission_id = $1 AND (${likeClause})
           ORDER BY ts DESC LIMIT 1`,
          ...params,
        );
        if (rows.length === 0) return null;
        const tsMs = Number(rows[0].ts);
        return Number.isFinite(tsMs) ? tsMs : null;
      },
      clearHeartbeat: (missionId, userId) =>
        store.clearHeartbeat(missionId, userId),
      emitZombieCleanup: async ({ missionId, payload }) => {
        await prisma.agentPlaygroundMissionEvent.create({
          data: {
            missionId,
            type: "playground.mission:zombie-cleanup",
            payload: payload as never, // Prisma JsonInput
            ts: BigInt(Date.now()),
          },
        });
      },
      terminalArbiter: store,
      buildZombieTerminalExtra: ({ userId }) => ({
        kind: "failed",
        detail: { errorMessage: "zombie-heartbeat-cleanup" },
        userId,
      }),
      eventTypes: {
        zombieCleanup: "playground.mission:zombie-cleanup",
      },
    };
    super(lifecycleManager, hooks);
  }
}

/** 类型导出，给上游调用方用（不用 import 类） */
export type { RerunGuardService as RerunGuardServiceType };
