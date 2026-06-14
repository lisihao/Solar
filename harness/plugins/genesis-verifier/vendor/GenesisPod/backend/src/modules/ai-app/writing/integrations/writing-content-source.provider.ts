import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import {
  ContentSource,
  ContentSourceProvider,
  SourceListFilter,
  SourceListResult,
  SourceContentBundle,
  SourceItem,
} from "@/modules/ai-engine/facade";

type ChapterRow = {
  id: string;
  title: string;
  content: string | null;
  wordCount: number;
  createdAt: Date;
};

type ChapterBundleRow = ChapterRow & {
  chapterNumber: number;
  volume: { title: string; project: { name: string } };
};

/**
 * WritingContentSourceProvider
 *
 * 2026-05-24 P17a: renamed from WritingSocialSourceProvider; implements
 * generic engine `ContentSource`. id "AI_WRITING" preserved.
 */
@Injectable()
@ContentSourceProvider()
export class WritingContentSourceProvider implements ContentSource {
  readonly id = "AI_WRITING";
  readonly displayName = { "zh-CN": "AI 写作", "en-US": "AI Writing" };
  readonly icon = "PenLine";
  readonly description = {
    "zh-CN": "从我的 AI 写作文章中选择",
    "en-US": "Pick from my AI Writing articles",
  };
  readonly contentKinds: SourceItem["contentKind"][] = ["article"];
  readonly maxItemsPerTask = 10;

  constructor(private readonly prisma: PrismaService) {}

  async listItems(
    userId: string,
    filter: SourceListFilter,
  ): Promise<SourceListResult> {
    const limit = filter.limit ?? 20;

    const chapters: ChapterRow[] = await this.prisma.writingChapter.findMany({
      where: {
        volume: {
          project: {
            ownerId: userId,
          },
        },
        ...(filter.search
          ? { title: { contains: filter.search, mode: "insensitive" } }
          : {}),
        ...(filter.cursor ? { id: { gt: filter.cursor } } : {}),
      },
      select: {
        id: true,
        title: true,
        content: true,
        wordCount: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    });

    const hasMore = chapters.length > limit;
    const items = hasMore ? chapters.slice(0, limit) : chapters;

    const result: SourceItem[] = items.map((ch: ChapterRow) => ({
      id: ch.id,
      title: ch.title,
      preview: ch.content ? ch.content.slice(0, 200) : undefined,
      contentKind: "article" as const,
      wordCount: ch.wordCount,
      createdAt: ch.createdAt.toISOString(),
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

    const chapters: ChapterBundleRow[] =
      await this.prisma.writingChapter.findMany({
        where: {
          id: { in: itemIds },
          volume: {
            project: {
              ownerId: userId,
            },
          },
        },
        select: {
          id: true,
          title: true,
          content: true,
          wordCount: true,
          createdAt: true,
          chapterNumber: true,
          volume: {
            select: {
              title: true,
              project: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

    return chapters.map((ch: ChapterBundleRow) => ({
      sourceType: this.id,
      sourceId: ch.id,
      title: ch.title,
      body: ch.content ?? "",
      bodyMime: "text/plain" as const,
      sourceMetadata: {
        wordCount: ch.wordCount,
        chapterNumber: ch.chapterNumber,
        volumeTitle: ch.volume.title,
        projectName: ch.volume.project.name,
        createdAt: ch.createdAt.toISOString(),
      },
      displayMetadata: {
        projectName: ch.volume.project.name,
        volumeTitle: ch.volume.title,
        chapterNumber: ch.chapterNumber,
      },
    }));
  }
}
