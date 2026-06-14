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
 * AgentPlaygroundContentSourceProvider
 *
 * 2026-05-24 P17a: renamed from PlaygroundSocialSourceProvider; now implements
 * the generic engine `ContentSource` (no longer social-specific). The runtime
 * id "AI_PLAYGROUND" is preserved for DB / frontend compatibility.
 *
 * Exposes the current user's completed Agent Playground mission artifacts as
 * a generic ContentSource. Any consumer (ai-app/social, future apps) can pull
 * via ContentSourceRegistry without importing this class directly.
 *
 * Only missions with status = 'completed' and a non-null reportFull are
 * surfaced. Running / failed / rejected missions are structurally excluded.
 *
 * Isolation guarantee: every query is scoped to the caller's userId —
 * cross-user access is structurally impossible.
 */
@Injectable()
@ContentSourceProvider()
export class AgentPlaygroundContentSourceProvider implements ContentSource {
  readonly id = "AI_PLAYGROUND";
  readonly displayName = {
    "zh-CN": "Agent Playground",
    "en-US": "Agent Playground",
  } as const;
  readonly icon = "Bot";
  readonly description = {
    "zh-CN": "从我的 Agent Playground 已完成任务的产出中选择",
    "en-US": "Pick from my completed Agent Playground mission artifacts",
  } as const;
  readonly contentKinds = ["report", "article"] as const;
  readonly maxItemsPerTask = 10;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * List completed missions belonging to the given user.
   * Only missions with status = 'completed' and a populated reportTitle are
   * returned. Each mission is exposed as a SourceItem with contentKind = 'report'.
   */
  async listItems(
    userId: string,
    filter: SourceListFilter,
  ): Promise<SourceListResult> {
    const limit = Math.min(filter.limit ?? 20, this.maxItemsPerTask);
    const skip = filter.cursor ? parseInt(filter.cursor, 10) : 0;

    // Build where clause — userId + status are always required
    const where: Record<string, unknown> = {
      userId,
      status: "completed",
      // Only expose missions that have a meaningful reportFull artifact
      reportFull: { not: null },
    };

    if (filter.search) {
      where.OR = [
        { topic: { contains: filter.search, mode: "insensitive" } },
        { reportTitle: { contains: filter.search, mode: "insensitive" } },
      ];
    }

    if (filter.dateRange) {
      where.completedAt = {
        gte: new Date(filter.dateRange.from),
        lte: new Date(filter.dateRange.to),
      };
    }

    const [missions, total] = await Promise.all([
      this.prisma.agentPlaygroundMission.findMany({
        where,
        select: {
          id: true,
          topic: true,
          reportTitle: true,
          reportSummary: true,
          completedAt: true,
          startedAt: true,
          finalScore: true,
          depth: true,
        },
        orderBy: { completedAt: "desc" },
        skip,
        take: limit + 1, // fetch one extra to detect next page
      }),
      this.prisma.agentPlaygroundMission.count({ where }),
    ]);

    const hasMore = missions.length > limit;
    const page = hasMore ? missions.slice(0, limit) : missions;

    const sourceItems: SourceItem[] = page.map((m) => ({
      id: m.id,
      title: m.reportTitle ?? m.topic,
      preview: m.reportSummary?.slice(0, 200) ?? undefined,
      contentKind: "report" as const,
      createdAt: (m.completedAt ?? m.startedAt).toISOString(),
      tags: [m.depth],
    }));

    const nextOffset = skip + page.length;
    const nextCursor =
      hasMore || nextOffset < total ? String(nextOffset) : undefined;

    return { items: sourceItems, nextCursor };
  }

  /**
   * Fetch full content bundles for the given mission IDs.
   *
   * Body is extracted from reportFull in the following priority:
   *   1. reportFull.content.fullMarkdown — the full writer markdown (v2 artifact)
   *   2. reportSummary + topic — plain text fallback when fullMarkdown is absent
   *
   * userId is enforced on every query — a mission not belonging to userId
   * is simply omitted from the result (cross-user isolation guarantee).
   */
  async fetchBundle(
    itemIds: string[],
    userId: string,
  ): Promise<SourceContentBundle[]> {
    if (itemIds.length === 0) return [];

    const missions = await this.prisma.agentPlaygroundMission.findMany({
      where: {
        id: { in: itemIds },
        userId, // strict user-isolation: other users' missions never appear
        status: "completed",
      },
      select: {
        id: true,
        topic: true,
        reportTitle: true,
        reportSummary: true,
        reportFull: true,
        completedAt: true,
        startedAt: true,
        depth: true,
        finalScore: true,
        leaderSigned: true,
      },
    });

    return missions.map((m) => {
      const body = this.resolveBody(m);

      return {
        sourceType: this.id,
        sourceId: m.id,
        title: m.reportTitle ?? m.topic,
        body,
        bodyMime: "text/markdown" as const,
        sourceMetadata: {
          missionId: m.id,
          completedAt: (m.completedAt ?? m.startedAt).toISOString(),
          depth: m.depth,
          finalScore: m.finalScore ?? null,
          leaderSigned: m.leaderSigned ?? null,
        },
        displayMetadata: {
          topic: m.topic,
          reportSummary: m.reportSummary ?? "",
        },
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private resolveBody(mission: {
    topic: string;
    reportTitle: string | null;
    reportSummary: string | null;
    reportFull: unknown;
  }): string {
    const reportFull = mission.reportFull as Record<string, unknown> | null;

    // 1. v2 ReportArtifact: content.fullMarkdown
    if (reportFull) {
      const content = reportFull["content"];
      if (content && typeof content === "object") {
        const fullMarkdown = (content as Record<string, unknown>)[
          "fullMarkdown"
        ];
        if (typeof fullMarkdown === "string" && fullMarkdown.trim()) {
          return fullMarkdown;
        }
      }
    }

    // 2. Fallback: compose from reportSummary + topic
    const parts: string[] = [];
    const title = mission.reportTitle ?? mission.topic;
    if (title) parts.push(`# ${title}`);
    if (mission.reportSummary) parts.push(mission.reportSummary);
    return parts.join("\n\n");
  }
}
