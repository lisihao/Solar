import { Injectable, Logger } from "@nestjs/common";
import { ResourceType } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { RAGFacade } from "@/modules/ai-harness/facade";
import {
  ContentSource,
  ContentSourceProvider,
  SourceContentBundle,
  SourceItem,
  SourceListFilter,
  SourceListResult,
} from "@/modules/ai-engine/facade";

/** ResourceType values that represent video content */
const VIDEO_TYPES = new Set<ResourceType>([ResourceType.YOUTUBE_VIDEO]);

function toContentKind(type: ResourceType): SourceItem["contentKind"] {
  return VIDEO_TYPES.has(type) ? "video" : "article";
}

/**
 * ExploreContentSourceProvider
 *
 * 2026-05-24 P17a: renamed from ExploreSocialSourceProvider; implements the
 * generic engine `ContentSource`. id "AI_EXPLORE" preserved.
 *
 * Exposes the current user's curated Explore resources as a generic ContentSource.
 *
 * Resource itself has no userId — it is a public catalog. A resource counts as
 * "the user's" only when it appears in at least one of the user's collections
 * (Collection.userId === requestingUserId). Cross-user isolation is enforced
 * structurally via the `collectionItems.some.collection.userId` filter.
 */
@Injectable()
@ContentSourceProvider()
export class ExploreContentSourceProvider implements ContentSource {
  readonly id = "AI_EXPLORE";
  readonly displayName = { "zh-CN": "AI 探索", "en-US": "AI Explore" };
  readonly icon = "Compass";
  readonly description = {
    "zh-CN": "从我收藏的 AI 探索资源（视频/文章）中选择",
    "en-US": "Pick from my curated AI Explore resources (videos/articles)",
  };
  readonly contentKinds = ["article", "video"] as const;
  readonly maxItemsPerTask = 10;

  private readonly logger = new Logger(ExploreContentSourceProvider.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ragFacade: RAGFacade,
  ) {}

  async listItems(
    userId: string,
    filter: SourceListFilter,
  ): Promise<SourceListResult> {
    const limit = filter.limit ?? 20;

    const resources = await this.prisma.resource.findMany({
      where: {
        // Structural cross-user isolation: only resources in user's own
        // collections are visible.
        collectionItems: {
          some: { collection: { userId } },
        },
        NOT: { title: "" },
        ...(filter.search
          ? {
              OR: [
                { title: { contains: filter.search, mode: "insensitive" } },
                { abstract: { contains: filter.search, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(filter.tags && filter.tags.length > 0
          ? { tags: { path: [], array_contains: filter.tags } }
          : {}),
        ...(filter.dateRange
          ? {
              createdAt: {
                gte: new Date(filter.dateRange.from),
                lte: new Date(filter.dateRange.to),
              },
            }
          : {}),
        ...(filter.cursor ? { id: { gt: filter.cursor } } : {}),
      },
      select: {
        id: true,
        type: true,
        title: true,
        abstract: true,
        thumbnailUrl: true,
        tags: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    });

    const hasMore = resources.length > limit;
    const items = hasMore ? resources.slice(0, limit) : resources;

    const result: SourceItem[] = items.map((r) => ({
      id: r.id,
      title: r.title,
      preview: r.abstract ? r.abstract.slice(0, 200) : undefined,
      contentKind: toContentKind(r.type),
      thumbnailUrl: r.thumbnailUrl ?? undefined,
      tags: Array.isArray(r.tags) ? (r.tags as string[]) : undefined,
      createdAt: r.createdAt.toISOString(),
    }));

    return {
      items: result,
      nextCursor: hasMore ? items[items.length - 1].id : undefined,
    };
  }

  async fetchBundle(
    itemIds: string[],
    userId: string,
  ): Promise<SourceContentBundle[]> {
    if (itemIds.length === 0) return [];

    // Strict cross-user isolation: resource must be in one of the user's
    // own collections. A resource that was never collected by the caller
    // is structurally excluded from results.
    const resources = await this.prisma.resource.findMany({
      where: {
        id: { in: itemIds },
        collectionItems: {
          some: { collection: { userId } },
        },
      },
      select: {
        id: true,
        type: true,
        title: true,
        abstract: true,
        content: true,
        sourceUrl: true,
        thumbnailUrl: true,
        tags: true,
        createdAt: true,
      },
    });

    return Promise.all(
      resources.map(async (r) => ({
        sourceType: this.id,
        sourceId: r.id,
        title: r.title,
        body: await this.resolveBody(r),
        bodyMime: "text/plain" as const,
        sourceMetadata: {
          resourceType: r.type,
          contentKind: toContentKind(r.type),
          sourceUrl: r.sourceUrl,
          thumbnailUrl: r.thumbnailUrl ?? null,
          tags: Array.isArray(r.tags) ? r.tags : [],
          createdAt: r.createdAt.toISOString(),
        },
        displayMetadata: {
          contentKind: toContentKind(r.type),
          thumbnailUrl: r.thumbnailUrl ?? null,
        },
      })),
    );
  }

  /**
   * 取正文：视频资源用引擎字幕能力抓脚本（DB 缓存优先 → Supadata/youtubei.js），
   * 而非占位 content；抓不到才回退 content/abstract。
   * 与 social/content-fetcher.service.ts 走同一能力（fetchFromYoutubeUrl），消除「拿到 stub」的根因。
   */
  private async resolveBody(r: {
    id: string;
    type: ResourceType;
    content: string | null;
    abstract: string | null;
    sourceUrl: string | null;
  }): Promise<string> {
    const fallback = r.content ?? r.abstract ?? "";
    if (!VIDEO_TYPES.has(r.type) || !r.sourceUrl) return fallback;
    try {
      const videoId = this.ragFacade.contentFetch!.extractYoutubeVideoId(
        r.sourceUrl,
      );
      if (!videoId) return fallback;
      const yt = await this.ragFacade.contentFetch!.fetchFromYoutubeUrl(
        videoId,
        r.sourceUrl,
      );
      if (yt?.content && yt.content.trim().length > 100) return yt.content;
    } catch (err) {
      this.logger.warn(
        `YouTube transcript fetch failed for resource ${r.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return fallback;
  }
}
