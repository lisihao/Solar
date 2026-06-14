/**
 * MissionPostmortemHelper — mission 复盘记录
 *
 * ★ 2026-05-24 P6 Wave 1：framework 化下沉到
 *   `ai-harness/teams/business-team/lifecycle/business-team-postmortem-helper.framework.ts`。
 *   本文件仅注入 playground 专属：embedding 服务 / vector memory schema /
 *   recent mission 查询（agent_playground_missions 表）。
 */

import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { EmbeddingService } from "@/modules/ai-engine/facade";
import {
  BusinessTeamPostmortemHelperFramework,
  type PostmortemHelperHooks,
  type PostmortemListBase,
  type PostmortemRecordBase,
} from "@/modules/ai-harness/facade";

export interface PlaygroundPostmortemRecord extends PostmortemRecordBase {
  readonly recommendations: string[];
  readonly qualityScore: number | null;
  readonly tokensUsed: number;
  readonly costUsd: number;
  readonly failureClassification?: {
    readonly mode: string;
    readonly signals: string[];
    readonly confidence: number;
  };
}

export interface PlaygroundPostmortemListItem extends PostmortemListBase {
  readonly recommendations: string[];
  readonly qualityScore: number | null;
}

export class MissionPostmortemHelper extends BusinessTeamPostmortemHelperFramework<
  PlaygroundPostmortemRecord,
  PlaygroundPostmortemListItem
> {
  constructor(prisma: PrismaService, embeddingService?: EmbeddingService) {
    const hooks: PostmortemHelperHooks<
      PlaygroundPostmortemRecord,
      PlaygroundPostmortemListItem
    > = {
      loggerNamespace: "MissionPostmortemHelper",
      embeddingPort: embeddingService
        ? {
            generateEmbedding: (text) =>
              embeddingService
                .generateEmbedding(text)
                .then((r) =>
                  Array.isArray(r?.embedding)
                    ? { embedding: r.embedding }
                    : null,
                ),
          }
        : undefined,
      createVectorMemory: async ({ input, embedding }) => {
        await prisma.harnessVectorMemory.create({
          data: {
            namespace: input.userId,
            source: "playground:mission",
            entryKey: `mission-postmortem:${input.missionId}`,
            content: input.summary.slice(0, 2000),
            embedding,
            confidence: 1.0,
            tags: [
              "playground",
              "mission-postmortem",
              input.leaderSigned === true ? "signed" : "unsigned",
            ],
            metadata: {
              missionId: input.missionId,
              topic: input.topic,
              recommendations: input.recommendations,
              qualityScore: input.qualityScore,
              tokensUsed: input.tokensUsed,
              costUsd: input.costUsd,
              ...(input.failureClassification
                ? { failureClassification: input.failureClassification }
                : {}),
            },
          },
        });
      },
      findRecentMissionId: async (userId) => {
        const row = await prisma.agentPlaygroundMission.findFirst({
          where: {
            userId,
            status: { in: ["completed", "quality-failed"] },
            completedAt: { gte: new Date(Date.now() - 5 * 60_000) },
          },
          select: { id: true, completedAt: true },
          orderBy: { completedAt: "desc" },
        });
        return row?.id ?? null;
      },
      listVectorMemories: async (userId, limit) => {
        const rows = await prisma.harnessVectorMemory.findMany({
          where: {
            namespace: userId,
            tags: { has: "mission-postmortem" },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
        });
        return rows.map((r) => {
          const meta = (r.metadata ?? {}) as Record<string, unknown>;
          return {
            missionId: String(meta.missionId ?? ""),
            topic: String(meta.topic ?? ""),
            summary: r.content,
            recommendations: Array.isArray(meta.recommendations)
              ? (meta.recommendations as string[])
              : [],
            leaderSigned: r.tags.includes("signed")
              ? true
              : r.tags.includes("unsigned")
                ? false
                : null,
            qualityScore:
              typeof meta.qualityScore === "number" ? meta.qualityScore : null,
            createdAt: r.createdAt,
          };
        });
      },
    };
    super(hooks);
  }

  /**
   * Back-compat shim — caller 传 plain object，转 framework input shape。
   */
  async recordMissionPostmortem(input: {
    missionId: string;
    userId: string;
    topic: string;
    summary: string;
    recommendations: string[];
    leaderSigned: boolean | null;
    qualityScore: number | null;
    tokensUsed: number;
    costUsd: number;
    failureClassification?: {
      mode: string;
      signals: string[];
      confidence: number;
    };
  }): Promise<void> {
    await super.recordMissionPostmortem(input);
  }
}
