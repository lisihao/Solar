/**
 * S3 — dedupe stage adapter
 *
 * 主键 dedup（topicId + externalId）+ insert RadarItem 行（score/summary 留 null，
 * 后续 S4-S7 stage 通过 updateMany 回填）。
 * 用 prisma.$transaction 批量原子 insert（避免部分失败留下 inconsistent rows）。
 */
import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import type {
  RadarMissionContext,
  RadarRawItem,
  RadarStageHookArgs,
  RadarStageRunner,
} from "./radar-stage-types";

@Injectable()
export class RadarS3DedupeStage implements RadarStageRunner {
  private readonly log = new Logger(RadarS3DedupeStage.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(
    _args: RadarStageHookArgs,
    ctx: RadarMissionContext,
  ): Promise<void> {
    const topicId = ctx.state.topic?.id;
    const rawItems = ctx.state.rawItems ?? [];
    if (!topicId) throw new Error("S3 dedupe: ctx.state.topic 缺失");
    if (rawItems.length === 0) {
      ctx.state.uniqueItems = [];
      ctx.state.newItemIds = [];
      ctx.state.itemSourceMap = new Map();
      return;
    }

    // 主键 dedup（topicId + externalId）
    const existingExternalIds = await this.prisma.radarItem.findMany({
      where: {
        topicId,
        externalId: { in: rawItems.map((i) => i.externalId) },
      },
      select: { externalId: true },
    });
    const seen = new Set(existingExternalIds.map((e) => e.externalId));
    const toInsert = rawItems.filter((i) => !seen.has(i.externalId));

    if (toInsert.length === 0) {
      ctx.state.uniqueItems = [];
      ctx.state.newItemIds = [];
      ctx.state.itemSourceMap = new Map();
      ctx.state.metrics.itemsDeduped = rawItems.length;
      this.log.log(
        `[${ctx.missionId}] S3 dedupe: all ${rawItems.length} items already seen`,
      );
      return;
    }

    // Build sourceId → isPublicSource lookup from ctx.state.sources (populated by S1)
    const sourcePublicMap = new Map<string, boolean>(
      (ctx.state.sources ?? []).map((s) => [s.id, s.isPublicSource]),
    );

    // 2026-05-19 fix: 用 upsert 替代 create —— rawItems 同 batch 自身重复 +
    //   两个并发 mission 抢同一 topicId/externalId 时 create 会撞
    //   @@unique([topicId, externalId])。upsert update:{} 让已存在保持原值。
    const rows = await this.prisma.$transaction(
      toInsert.map((i) =>
        this.prisma.radarItem.upsert({
          where: {
            topicId_externalId: { topicId, externalId: i.externalId },
          },
          create: {
            topicId,
            sourceId: i.sourceId,
            externalId: i.externalId,
            contentHash: i.contentHash,
            title: i.title,
            content: i.content,
            author: i.author,
            authorAvatar: i.authorAvatar,
            url: i.url,
            publishedAt: i.publishedAt,
            raw: i.raw as Prisma.InputJsonValue,
            metrics:
              i.metrics === null
                ? Prisma.JsonNull
                : (i.metrics as Prisma.InputJsonValue),
            accepted: false,
            // K2: propagate public/private flag and ownership from source
            isPublicSource: sourcePublicMap.get(i.sourceId) ?? true,
            sourceOwnerUserId: ctx.userId,
          },
          update: {}, // 已存在不更新（保留首次入库值）
          select: { id: true, externalId: true },
        }),
      ),
    );

    const newItemIds = rows.map((r) => r.id);
    const itemSourceMap = new Map<string, string>();
    // 关联 itemId → sourceId（后续 stage 用，避免再查 DB）
    const byExternalId = new Map(rows.map((r) => [r.externalId, r.id]));
    const uniqueItems: RadarRawItem[] = [];
    for (const raw of toInsert) {
      const id = byExternalId.get(raw.externalId);
      if (!id) continue;
      itemSourceMap.set(id, raw.sourceId);
      uniqueItems.push(raw);
    }

    ctx.state.uniqueItems = uniqueItems;
    ctx.state.newItemIds = newItemIds;
    ctx.state.itemSourceMap = itemSourceMap;
    ctx.state.metrics.itemsDeduped = rawItems.length - toInsert.length;
    ctx.state.metrics.itemsInserted = newItemIds.length;

    this.log.log(
      `[${ctx.missionId}] S3 dedupe: total=${rawItems.length} inserted=${newItemIds.length} deduped=${rawItems.length - toInsert.length}`,
    );
  }
}
