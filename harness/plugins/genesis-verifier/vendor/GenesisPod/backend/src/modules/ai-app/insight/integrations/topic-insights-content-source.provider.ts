import { Injectable, Logger } from "@nestjs/common";
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
 * TopicInsightsContentSourceProvider
 *
 * 2026-05-24 P17a: renamed from TopicInsightsSocialSourceProvider; implements
 * generic engine `ContentSource`. id "AI_TOPIC_INSIGHTS" preserved.
 */
@Injectable()
@ContentSourceProvider()
export class TopicInsightsContentSourceProvider implements ContentSource {
  private readonly logger = new Logger(TopicInsightsContentSourceProvider.name);

  readonly id = "AI_TOPIC_INSIGHTS";
  readonly displayName = { "zh-CN": "AI 洞察", "en-US": "AI Topic Insights" };
  readonly icon = "Lightbulb";
  readonly description = {
    "zh-CN": "从我的话题洞察中选择",
    "en-US": "Pick from my topic insights",
  };
  readonly contentKinds = ["note"] as const;
  readonly maxItemsPerTask = 10;

  constructor(private readonly prisma: PrismaService) {}

  async listItems(
    userId: string,
    filter: SourceListFilter,
  ): Promise<SourceListResult> {
    const limit = Math.min(filter.limit ?? 20, 50);

    const where: Record<string, unknown> = {
      userId,
      // soft-deleted / archived topics are excluded
      status: { not: "ARCHIVED" },
    };

    if (filter.search) {
      where.OR = [
        { name: { contains: filter.search, mode: "insensitive" } },
        { description: { contains: filter.search, mode: "insensitive" } },
      ];
    }

    if (filter.dateRange) {
      where.createdAt = {
        gte: new Date(filter.dateRange.from),
        lte: new Date(filter.dateRange.to),
      };
    }

    const baseArgs = {
      where,
      orderBy: { updatedAt: "desc" as const },
      take: limit + 1, // fetch one extra to determine if there is a next page
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        // Pick only the latest report's executiveSummary for the preview
        reports: {
          orderBy: { version: "desc" as const },
          take: 1,
          select: { executiveSummary: true, totalSources: true },
        },
      },
    };

    const topics = filter.cursor
      ? await this.prisma.researchTopic.findMany({
          ...baseArgs,
          cursor: { id: filter.cursor },
          skip: 1,
        })
      : await this.prisma.researchTopic.findMany(baseArgs);

    const hasMore = topics.length > limit;
    const page = hasMore ? topics.slice(0, limit) : topics;

    const items: SourceItem[] = page.map((t) => {
      const latestReport = t.reports[0];
      const preview = latestReport?.executiveSummary
        ? latestReport.executiveSummary.slice(0, 200)
        : t.description?.slice(0, 200);

      return {
        id: t.id,
        title: t.name,
        preview,
        contentKind: "note",
        wordCount: latestReport?.executiveSummary
          ? Math.round(latestReport.executiveSummary.length / 5)
          : undefined,
        createdAt: t.createdAt.toISOString(),
      };
    });

    return {
      items,
      nextCursor: hasMore ? page[page.length - 1]?.id : undefined,
    };
  }

  async fetchBundle(
    itemIds: string[],
    userId: string,
  ): Promise<SourceContentBundle[]> {
    if (itemIds.length === 0) return [];

    const topics = await this.prisma.researchTopic.findMany({
      where: {
        id: { in: itemIds },
        userId, // cross-user isolation: only return topics owned by the requesting user
      },
      select: {
        id: true,
        name: true,
        description: true,
        type: true,
        topicConfig: true,
        createdAt: true,
        updatedAt: true,
        reports: {
          orderBy: { version: "desc" },
          take: 1,
          select: {
            version: true,
            executiveSummary: true,
            fullReport: true,
            totalSources: true,
            generatedAt: true,
          },
        },
      },
    });

    this.logger.debug(
      `fetchBundle: requested ${itemIds.length} topic(s), found ${topics.length} for userId=${userId}`,
    );

    return topics.map((t) => {
      const report = t.reports[0];
      const body = buildMarkdownBody(t.name, t.description, report);

      return {
        sourceType: "AI_TOPIC_INSIGHTS",
        sourceId: t.id,
        title: t.name,
        body,
        bodyMime: "text/markdown",
        sourceMetadata: {
          topicType: t.type,
          topicConfig: t.topicConfig,
          reportVersion: report?.version ?? null,
          reportGeneratedAt: report?.generatedAt?.toISOString() ?? null,
          totalSources: report?.totalSources ?? 0,
        },
        displayMetadata: {
          icon: "Lightbulb",
          sourceLabel: "AI Topic Insights",
          topicName: t.name,
          hasReport: report != null,
        },
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Pure helper — no side effects, fully unit-testable
// ---------------------------------------------------------------------------

interface ReportSnapshot {
  executiveSummary: string;
  fullReport: string;
  version: number;
  generatedAt: Date;
  totalSources: number;
}

function buildMarkdownBody(
  name: string,
  description: string | null,
  report: ReportSnapshot | undefined,
): string {
  const lines: string[] = [];

  lines.push(`# ${name}`);

  if (description) {
    lines.push("");
    lines.push(description);
  }

  if (!report) {
    return lines.join("\n");
  }

  if (report.executiveSummary) {
    lines.push("");
    lines.push("## Executive Summary");
    lines.push("");
    lines.push(report.executiveSummary);
  }

  if (report.fullReport) {
    lines.push("");
    lines.push("## Full Report");
    lines.push("");
    lines.push(report.fullReport);
  }

  return lines.join("\n");
}
