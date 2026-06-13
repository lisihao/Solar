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

// ---------------------------------------------------------------------------
// Local shapes returned by Prisma select queries
// ---------------------------------------------------------------------------

interface ProjectListRow {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  _count: { outputs: number };
}

interface ProjectBundleRow {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  outputs: Array<{ content: string | null; createdAt: Date }>;
  deepResearchSessions: Array<{
    report: unknown;
    query: string;
    createdAt: Date;
  }>;
}

/**
 * ResearchContentSourceProvider
 *
 * 2026-05-24 P17a: renamed from ResearchSocialSourceProvider; implements
 * generic engine `ContentSource`. id "AI_RESEARCH" preserved.
 *
 * Exposes the current user's AI Research projects (and their generated
 * outputs / DeepResearch session reports) as a generic ContentSource so
 * any consumer (ai-app/social, future apps) can pull via the registry.
 *
 * Isolation guarantee: every query is scoped to the caller's userId —
 * cross-user access is structurally impossible.
 */
@Injectable()
@ContentSourceProvider()
export class ResearchContentSourceProvider implements ContentSource {
  readonly id = "AI_RESEARCH";
  readonly displayName = {
    "zh-CN": "AI 研究",
    "en-US": "AI Research",
  } as const;
  readonly icon = "FlaskConical";
  readonly description = {
    "zh-CN": "从我的 AI 研究报告中选择",
    "en-US": "Pick from my AI Research reports",
  } as const;
  // Widened to satisfy ContentSource['contentKinds']: SourceItem['contentKind'][]
  readonly contentKinds: SourceItem["contentKind"][] = ["report"];
  readonly maxItemsPerTask = 10;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * List research projects belonging to the given user.
   * Each active project is returned as a SourceItem with contentKind = 'report'.
   */
  async listItems(
    userId: string,
    filter: SourceListFilter,
  ): Promise<SourceListResult> {
    const limit = Math.min(filter.limit ?? 20, this.maxItemsPerTask);
    const skip = filter.cursor ? parseInt(filter.cursor, 10) : 0;

    const where: Record<string, unknown> = {
      userId,
      status: "ACTIVE",
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

    const [items, total] = await Promise.all([
      this.prisma.researchProject.findMany({
        where,
        select: {
          id: true,
          name: true,
          description: true,
          createdAt: true,
          _count: { select: { outputs: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit + 1, // fetch one extra to detect next page
      }) as Promise<ProjectListRow[]>,
      this.prisma.researchProject.count({ where }),
    ]);

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;

    const sourceItems: SourceItem[] = page.map((p: ProjectListRow) => ({
      id: p.id,
      title: p.name,
      preview: p.description ?? undefined,
      contentKind: "report" as const,
      wordCount: undefined,
      createdAt: p.createdAt.toISOString(),
      tags: [],
    }));

    const nextOffset = skip + page.length;
    const nextCursor =
      hasMore || nextOffset < total ? String(nextOffset) : undefined;

    return { items: sourceItems, nextCursor };
  }

  /**
   * Fetch full content bundles for the given project IDs.
   *
   * For each project we materialise its body from:
   *   1. The latest COMPLETED ResearchProjectOutput (type = REPORT) if present.
   *   2. Otherwise, the latest DeepResearchSession report JSON.
   *   3. Otherwise, a short summary constructed from project metadata.
   *
   * userId is enforced on every query — a project not belonging to userId
   * is simply omitted from the result.
   */
  async fetchBundle(
    itemIds: string[],
    userId: string,
  ): Promise<SourceContentBundle[]> {
    if (itemIds.length === 0) return [];

    const projects = (await this.prisma.researchProject.findMany({
      where: {
        id: { in: itemIds },
        userId, // strict user-isolation
      },
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        outputs: {
          where: { status: "COMPLETED" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { content: true, createdAt: true },
        },
        deepResearchSessions: {
          where: { status: "COMPLETED" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { report: true, query: true, createdAt: true },
        },
      },
    })) as ProjectBundleRow[];

    return projects.map((project: ProjectBundleRow) => {
      const body = this.resolveBody(project);

      return {
        sourceType: this.id,
        sourceId: project.id,
        title: project.name,
        body,
        bodyMime: "text/markdown" as const,
        sourceMetadata: {
          projectId: project.id,
          createdAt: project.createdAt.toISOString(),
        },
        displayMetadata: {
          description: project.description ?? "",
        },
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private resolveBody(project: {
    name: string;
    description: string | null;
    outputs: Array<{ content: string | null }>;
    deepResearchSessions: Array<{
      report: unknown;
      query: string;
    }>;
  }): string {
    // 1. Latest completed report output
    const outputContent = project.outputs[0]?.content;
    if (outputContent) return outputContent;

    // 2. DeepResearchSession report JSON → extract text
    const sessionReport = project.deepResearchSessions[0]?.report;
    if (sessionReport) {
      return this.extractReportText(
        sessionReport as Record<string, unknown>,
        project.deepResearchSessions[0].query,
      );
    }

    // 3. Fallback: project metadata summary
    return [`# ${project.name}`, project.description ?? ""]
      .filter(Boolean)
      .join("\n\n");
  }

  /**
   * Best-effort plain-text extraction from a DeepResearchSession report JSON.
   * Expected shape: { executiveSummary, sections: [{ title, content }], conclusion }
   */
  private extractReportText(
    report: Record<string, unknown>,
    query: string,
  ): string {
    const parts: string[] = [];

    if (query) parts.push(`# ${query}`);

    const summary = report["executiveSummary"];
    if (typeof summary === "string" && summary) {
      parts.push(`## Executive Summary\n\n${summary}`);
    }

    const sections = report["sections"];
    if (Array.isArray(sections)) {
      for (const section of sections) {
        if (
          section &&
          typeof section === "object" &&
          "title" in section &&
          "content" in section
        ) {
          const s = section as { title: string; content: string };
          parts.push(`## ${s.title}\n\n${s.content}`);
        }
      }
    }

    const conclusion = report["conclusion"];
    if (typeof conclusion === "string" && conclusion) {
      parts.push(`## Conclusion\n\n${conclusion}`);
    }

    return parts.join("\n\n");
  }
}
