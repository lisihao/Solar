import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { ContentSourceProvider } from "@/modules/ai-engine/facade";
import type {
  ContentSource,
  SourceItem,
  SourceListFilter,
  SourceListResult,
  SourceContentBundle,
} from "@/modules/ai-engine/facade";

/**
 * RadarContentSourceProvider
 *
 * 把 AI 雷达持续采集的高分信号（RadarItem, accepted = true）暴露为通用
 * ContentSource。任何消费方（ai-app/social、playground researcher、未来的
 * foresight）通过 ContentSourceRegistry 拉取，零跨模块 import。
 *
 * 暴露范围：
 *   - 仅当前用户自己的雷达话题（topic.userId = userId，严格用户隔离）
 *   - 仅 accepted = true 的条目（已通过 S4 相关性 / S5 质量双重 AI 筛选）
 *
 * 价值：为深度洞察类任务提供"最近的新鲜信号"素材层 —— 与知识库（私有沉淀）、
 * 历史报告（平台结论）互补的第三层时效性输入。
 */
@Injectable()
@ContentSourceProvider()
export class RadarContentSourceProvider implements ContentSource {
  readonly id = "AI_RADAR";
  readonly displayName = {
    "zh-CN": "AI 雷达",
    "en-US": "AI Radar",
  } as const;
  readonly icon = "Radar";
  readonly description = {
    "zh-CN": "从我的雷达话题采集的高分信号中选择（已通过 AI 相关性与质量筛选）",
    "en-US": "Pick from high-score signals collected by my radar topics",
  } as const;
  readonly contentKinds = ["article"] as const;
  readonly maxItemsPerTask = 10;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * List accepted radar items across the user's topics, newest first.
   * Isolation: topic.userId = userId is enforced on every query.
   */
  async listItems(
    userId: string,
    filter: SourceListFilter,
  ): Promise<SourceListResult> {
    const limit = Math.min(filter.limit ?? 20, 50);
    const skip = filter.cursor ? parseInt(filter.cursor, 10) : 0;

    const where: Record<string, unknown> = {
      accepted: true,
      topic: { userId },
    };

    if (filter.search) {
      where.OR = [
        { title: { contains: filter.search, mode: "insensitive" } },
        { aiSummary: { contains: filter.search, mode: "insensitive" } },
      ];
    }

    if (filter.dateRange) {
      where.publishedAt = {
        gte: new Date(filter.dateRange.from),
        lte: new Date(filter.dateRange.to),
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.radarItem.findMany({
        where,
        select: {
          id: true,
          title: true,
          aiSummary: true,
          url: true,
          author: true,
          publishedAt: true,
          relevanceScore: true,
          topic: { select: { name: true } },
          source: { select: { type: true, label: true } },
        },
        orderBy: { publishedAt: "desc" },
        skip,
        take: limit + 1, // fetch one extra to detect next page
      }),
      this.prisma.radarItem.count({ where }),
    ]);

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;

    const sourceItems: SourceItem[] = page.map((it) => ({
      id: it.id,
      title: it.title ?? it.url ?? "(无标题信号)",
      preview: it.aiSummary?.slice(0, 200) ?? undefined,
      contentKind: "article" as const,
      createdAt: it.publishedAt.toISOString(),
      tags: [it.topic.name, it.source.label ?? it.source.type].filter(Boolean),
    }));

    const nextOffset = skip + page.length;
    const nextCursor =
      hasMore || nextOffset < total ? String(nextOffset) : undefined;

    return { items: sourceItems, nextCursor };
  }

  /**
   * Fetch full content bundles for the given radar item IDs.
   * Items not belonging to the user's topics are silently omitted
   * (cross-user isolation guarantee, same contract as other providers).
   */
  async fetchBundle(
    itemIds: string[],
    userId: string,
  ): Promise<SourceContentBundle[]> {
    if (itemIds.length === 0) return [];

    const items = await this.prisma.radarItem.findMany({
      where: {
        id: { in: itemIds },
        accepted: true,
        topic: { userId }, // strict user-isolation
      },
      select: {
        id: true,
        topicId: true,
        title: true,
        content: true,
        aiSummary: true,
        url: true,
        author: true,
        publishedAt: true,
        relevanceScore: true,
        qualityScore: true,
        topic: { select: { name: true } },
        source: { select: { type: true, label: true } },
      },
    });

    return items.map((it) => ({
      sourceType: this.id,
      sourceId: it.id,
      title: it.title ?? it.url ?? "(无标题信号)",
      body: this.composeBody(it),
      bodyMime: "text/markdown" as const,
      sourceMetadata: {
        itemId: it.id,
        topicId: it.topicId,
        topicName: it.topic.name,
        sourceType: it.source.type,
        url: it.url ?? null,
        publishedAt: it.publishedAt.toISOString(),
        relevanceScore: it.relevanceScore ?? null,
        qualityScore: it.qualityScore ?? null,
      },
      displayMetadata: {
        topicName: it.topic.name,
        author: it.author ?? "",
        url: it.url ?? "",
      },
    }));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private composeBody(it: {
    title: string | null;
    content: string | null;
    aiSummary: string | null;
    url: string | null;
    author: string | null;
    publishedAt: Date;
    topic: { name: string };
    source: { type: string; label: string | null };
  }): string {
    const parts: string[] = [];
    parts.push(`# ${it.title ?? "(无标题信号)"}`);

    const meta: string[] = [];
    meta.push(`雷达话题：${it.topic.name}`);
    meta.push(`信号源：${it.source.label ?? it.source.type}`);
    if (it.author) meta.push(`作者：${it.author}`);
    meta.push(`发布时间：${it.publishedAt.toISOString()}`);
    if (it.url) meta.push(`原文链接：${it.url}`);
    parts.push(meta.map((m) => `> ${m}`).join("\n"));

    if (it.aiSummary) {
      parts.push(`## AI 摘要\n\n${it.aiSummary}`);
    }
    if (it.content) {
      parts.push(`## 原文内容\n\n${it.content}`);
    }
    return parts.join("\n\n");
  }
}
