/**
 * PrismaMissionCheckpointStore — playground 的 MissionCheckpointStore 实现
 *
 * ★ 2026-05-24 P6 Wave 1：framework 化下沉到
 *   `ai-harness/teams/business-team/lifecycle/business-team-checkpoint-store.framework.ts`。
 *   本文件仅注入 playground 专属 SQL（jsonb_set on agent_playground_missions /
 *   leader_journal 字段 / `__checkpoint` reserved key）。
 *
 * 与 ai-harness/memory/mission-checkpoint 的 MissionCheckpointStore 接口对齐。
 */

import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  BusinessTeamCheckpointStoreFramework,
  type CheckpointStoreHooks,
  type PersistedCheckpoint,
} from "@/modules/ai-harness/facade";

/** leaderJournal 中的保留 key（保持向后兼容；framework 默认即 `__checkpoint`）。 */
export const CHECKPOINT_KEY = "__checkpoint";

@Injectable()
export class PrismaMissionCheckpointStore<
  TPayload = unknown,
> extends BusinessTeamCheckpointStoreFramework<TPayload> {
  constructor(prisma: PrismaService) {
    const hooks: CheckpointStoreHooks<TPayload> = {
      reservedKey: CHECKPOINT_KEY,
      loadJsonContainer: async (missionId) => {
        const row = await prisma.agentPlaygroundMission.findUnique({
          where: { id: missionId },
          // 2026-05-13 #40: leaderJournalUri 必须配套 select，否则 PrismaService
          // hydrate hook 会 warn "select contains JSON 'leaderJournal' but not
          // 'leaderJournalUri'. Off-loaded content will be empty."
          select: { leaderJournal: true, leaderJournalUri: true },
        });
        if (!row) return null;
        return (row.leaderJournal as Record<string, unknown> | null) ?? {};
      },
      upsertJsonKey: async (missionId, _key, persisted) => {
        // ★ P1-R5-A (2026-04-30): jsonb_set 原子 update，避免与 appendLeaderJournal
        //   并发时 read-modify-write 互覆盖。COALESCE 处理 null。
        // ★ 2026-04-30 fix: 用 DB 实际表名 agent_playground_missions / leader_journal
        //  (Prisma model AgentPlaygroundMission @@map "agent_playground_missions";
        //   field leaderJournal @map "leader_journal"，raw SQL 必须用 mapped 实名)
        await prisma.$executeRaw`
          UPDATE agent_playground_missions
          SET leader_journal = jsonb_set(
            COALESCE(leader_journal, '{}'::jsonb),
            '{__checkpoint}',
            ${JSON.stringify(persisted satisfies PersistedCheckpoint<TPayload>)}::jsonb,
            true
          )
          WHERE id = ${missionId}
        `;
      },
      removeJsonKey: async (missionId, key) => {
        const row = await prisma.agentPlaygroundMission.findUnique({
          where: { id: missionId },
          select: { leaderJournal: true, leaderJournalUri: true },
        });
        if (!row) return;
        const journal =
          (row.leaderJournal as Record<string, unknown> | null) ?? {};
        if (!(key in journal)) return;
        const next = { ...journal };
        delete next[key];
        await prisma.agentPlaygroundMission.update({
          where: { id: missionId },
          data: { leaderJournal: next as Prisma.InputJsonValue },
        });
      },
      listRunningWithJson: async (userId) => {
        // ★ P0-R5-3 (2026-04-30): 用 startedAt 过滤 24h 窗口会漏掉长 mission（25h+ 但
        // 最近刚 save checkpoint）。改成拉所有 running，应用层按 savedAt 过滤。
        const rows = await prisma.agentPlaygroundMission.findMany({
          where: { userId, status: "running" },
          select: {
            id: true,
            leaderJournal: true,
            leaderJournalUri: true, // #40: 配套 hydrate hook
            startedAt: true,
          },
          take: 50,
          orderBy: { startedAt: "desc" },
        });
        return rows.map((row) => ({
          missionId: row.id,
          json: (row.leaderJournal as Record<string, unknown> | null) ?? {},
        }));
      },
    };
    super(hooks, "PrismaMissionCheckpointStore");
  }
}
