/**
 * CompanyMissionPostmortemHelper — company 侧 mission 复盘记录。
 *
 * 薄 helper：照 playground/mission/lifecycle/mission-postmortem.helper.ts 结构，
 * extends BusinessTeamPostmortemHelperFramework（复用框架的 recordMissionPostmortem /
 * listRecentPostmortems），只配置 company 专属的 namespace / source / tags / table 查询。
 *
 * 差异（vs playground）：
 *   - source: 'deep-insight:mission'（能力核标识）
 *   - tags: ['company', 'mission-postmortem', signed|unsigned]
 *   - findRecentMissionId: 查 company_missions 表（NOT agent_playground_missions）
 */

import { PrismaService } from "../../../../common/prisma/prisma.service";
import { Prisma } from "@prisma/client";
import { EmbeddingService } from "@/modules/ai-engine/facade";
import {
  BusinessTeamPostmortemHelperFramework,
  type PostmortemHelperHooks,
  type PostmortemListBase,
  type PostmortemRecordBase,
} from "@/modules/ai-harness/facade";
import { PrismaVectorStore } from "@/modules/ai-harness/facade";

export interface CompanyPostmortemRecord extends PostmortemRecordBase {
  readonly recommendations: string[];
  readonly qualityScore: number | null;
  readonly tokensUsed: number;
  readonly costUsd: number;
  readonly source: string;
  readonly tags: readonly string[];
  readonly failureClassification?: {
    readonly mode: string;
    readonly signals: readonly string[];
    readonly confidence: number;
  };
}

export interface CompanyPostmortemListItem extends PostmortemListBase {
  readonly recommendations: string[];
  readonly qualityScore: number | null;
}

export class CompanyMissionPostmortemHelper extends BusinessTeamPostmortemHelperFramework<
  CompanyPostmortemRecord,
  CompanyPostmortemListItem
> {
  constructor(
    prisma: PrismaService,
    embeddingService?: EmbeddingService,
    vectorStore?: PrismaVectorStore,
  ) {
    const hooks: PostmortemHelperHooks<
      CompanyPostmortemRecord,
      CompanyPostmortemListItem
    > = {
      loggerNamespace: "CompanyMissionPostmortemHelper",
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
            source: input.source ?? "deep-insight:mission",
            entryKey: `mission-postmortem:${input.missionId}`,
            content: input.summary.slice(0, 2000),
            embedding,
            confidence: 1.0,
            tags: [
              "company",
              "mission-postmortem",
              input.leaderSigned === true ? "signed" : "unsigned",
              ...(input.tags ?? []).filter(
                (t) =>
                  t !== "company" &&
                  t !== "mission-postmortem" &&
                  t !== "signed" &&
                  t !== "unsigned",
              ),
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
        // company_missions 无 completedAt；用 updatedAt 近似（done 后 updatedAt 即终态写入时刻）。
        // 注意：仅匹配 capability（deep-insight）mission——chat mission 从不写 postmortem，
        // 若匹配到 chat mission（result 无 capabilityId），框架 catch-up 轮询必然 3s 超时空转。
        // 判别方式：result->>'capabilityId' 非 NULL（Prisma JSONB path filter）。
        const row = await prisma.companyMission.findFirst({
          where: {
            userId,
            status: "done",
            updatedAt: { gte: new Date(Date.now() - 5 * 60_000) },
            result: {
              path: ["capabilityId"],
              not: Prisma.JsonNull,
            },
          },
          select: { id: true },
          orderBy: { updatedAt: "desc" },
        });
        return row?.id ?? null;
      },
      listVectorMemories: async (userId, limit, queryEmbedding) => {
        const mapRow = (r: {
          tags: readonly string[];
          metadata?: unknown;
          content: string;
          createdAt: Date;
        }): CompanyPostmortemListItem => {
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
        };

        // 语义路径：有 queryEmbedding + vectorStore → cosine 召回（PrismaVectorStore.recall）
        if (queryEmbedding && queryEmbedding.length > 0 && vectorStore) {
          const hits = await vectorStore.recall(queryEmbedding, {
            namespace: userId,
            k: limit,
            tags: ["mission-postmortem", "company"],
          });
          return hits.map(({ entry: r }) => mapRow(r));
        }

        // 回退路径：recency 倒序（无 queryEmbedding / 无 vectorStore）
        const rows = await prisma.harnessVectorMemory.findMany({
          where: {
            namespace: userId,
            tags: { has: "mission-postmortem" },
            AND: [{ tags: { has: "company" } }],
          },
          orderBy: { createdAt: "desc" },
          take: limit,
        });
        return rows.map(mapRow);
      },
    };
    super(hooks);
  }
}
