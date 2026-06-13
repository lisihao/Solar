/**
 * TopicReportImportService
 *
 * 把 `topic-insights` 模块生成的 TopicReport 导入 KB 作为 KnowledgeBaseDocument。
 *
 * 设计原则（同 [[playground-report-import.service]]，2026-05-19）：
 *   1. library 是 import sink，不反向 import topic-insights module
 *   2. 直接 PrismaService 读 TopicReport + TopicEvidence + ResearchTopic
 *   3. 每个 version 独立一份文档：sourceId = `topicId#vN`，title 后缀 `(Topic Insight · v{N})`
 *   4. 全带正文 + executiveSummary + evidence 引用附录 + highlights 摘要
 *   5. 不自动触发 wiki ingest
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { KnowledgeBaseSourceType } from "@prisma/client";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { KnowledgeBaseService } from "./knowledge-base.service";

export interface TopicReportImportResult {
  documentId: string;
  title: string;
  knowledgeBaseId: string;
  sourceId: string;
  version: number;
  charCount: number;
}

@Injectable()
export class TopicReportImportService {
  private readonly logger = new Logger(TopicReportImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledgeBaseService: KnowledgeBaseService,
  ) {}

  /**
   * 列出当前用户所有"可导入"的 topics（含 reports 数）。
   *
   * 用于 KB 创建/详情页的「从 Topic Insight 导入」面板浏览。返回 topic 概况 +
   * 最新报告版本号；用户多选后逐条 POST /import-topic-report。
   */
  async listImportableTopics(
    userId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<
    Array<{
      topicId: string;
      name: string;
      type: string;
      status: string;
      lastRefreshAt: Date | null;
      totalReports: number;
      latestReportVersion: number | null;
      latestGeneratedAt: Date | null;
    }>
  > {
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
    const offset = Math.max(options?.offset ?? 0, 0);

    const topics = await this.prisma.researchTopic.findMany({
      where: {
        userId,
        // 必须至少有一份报告才能导入
        totalReports: { gt: 0 },
      },
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        lastRefreshAt: true,
        totalReports: true,
      },
      orderBy: { lastRefreshAt: "desc" },
      take: limit,
      skip: offset,
    });

    // For each topic, fetch latest report version + generatedAt
    if (topics.length === 0) return [];
    const topicIds = topics.map((t) => t.id);
    const latestReports = await this.prisma.topicReport.findMany({
      where: { topicId: { in: topicIds } },
      select: { topicId: true, version: true, generatedAt: true },
      orderBy: [{ topicId: "asc" }, { version: "desc" }],
    });
    const latestByTopic = new Map<
      string,
      { version: number; generatedAt: Date }
    >();
    for (const r of latestReports) {
      if (!latestByTopic.has(r.topicId)) {
        latestByTopic.set(r.topicId, {
          version: r.version,
          generatedAt: r.generatedAt,
        });
      }
    }

    return topics.map((t) => {
      const latest = latestByTopic.get(t.id);
      return {
        topicId: t.id,
        name: t.name,
        type: t.type,
        status: t.status,
        lastRefreshAt: t.lastRefreshAt,
        totalReports: t.totalReports,
        latestReportVersion: latest?.version ?? null,
        latestGeneratedAt: latest?.generatedAt ?? null,
      };
    });
  }

  /**
   * 列出某 topic 下所有报告 version。
   */
  async listVersions(
    topicId: string,
    userId: string,
  ): Promise<
    Array<{
      reportId: string;
      version: number;
      versionLabel: string | null;
      generatedAt: Date;
      totalSources: number;
      isIncremental: boolean;
    }>
  > {
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
      select: { id: true, userId: true, name: true },
    });
    if (!topic) throw new NotFoundException("Topic not found");
    if (topic.userId !== userId) {
      throw new ForbiddenException("Not your topic");
    }

    const reports = await this.prisma.topicReport.findMany({
      where: { topicId },
      select: {
        id: true,
        version: true,
        versionLabel: true,
        generatedAt: true,
        totalSources: true,
        isIncremental: true,
      },
      orderBy: { version: "desc" },
    });

    return reports.map((r) => ({
      reportId: r.id,
      version: r.version,
      versionLabel: r.versionLabel,
      generatedAt: r.generatedAt,
      totalSources: r.totalSources,
      isIncremental: r.isIncremental,
    }));
  }

  /**
   * 把指定 topic + version 的 TopicReport 导入 KB。
   *
   * @param topicId        ResearchTopic id
   * @param userId         必须 = topic.ownerId
   * @param knowledgeBaseId 目标 KB id
   * @param version        可选；不传 = 最新版本
   */
  async importTopicReport(
    topicId: string,
    userId: string,
    knowledgeBaseId: string,
    version?: number,
  ): Promise<TopicReportImportResult> {
    // 1. KB ownership
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
      select: { id: true, userId: true, name: true },
    });
    if (!kb) throw new NotFoundException("Knowledge base not found");
    if (kb.userId !== userId) {
      throw new ForbiddenException("Not your knowledge base");
    }

    // 2. Topic ownership
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
      select: { id: true, userId: true, name: true, description: true },
    });
    if (!topic) throw new NotFoundException("Topic not found");
    if (topic.userId !== userId) {
      throw new ForbiddenException("Not your topic");
    }

    // 3. Load report (specific version or latest)
    const report = version
      ? await this.prisma.topicReport.findUnique({
          where: { topicId_version: { topicId, version } },
          select: {
            id: true,
            version: true,
            versionLabel: true,
            executiveSummary: true,
            fullReport: true,
            fullReportUri: true,
            highlights: true,
            generatedAt: true,
            totalSources: true,
          },
        })
      : await this.prisma.topicReport.findFirst({
          where: { topicId },
          orderBy: { version: "desc" },
          select: {
            id: true,
            version: true,
            versionLabel: true,
            executiveSummary: true,
            fullReport: true,
            fullReportUri: true,
            highlights: true,
            generatedAt: true,
            totalSources: true,
          },
        });
    if (!report) {
      throw new NotFoundException(
        version
          ? `TopicReport v${version} not found for topic ${topicId}`
          : `No TopicReport found for topic ${topicId}`,
      );
    }

    // 4. Load evidences (citations)
    const evidences = await this.prisma.topicEvidence.findMany({
      where: { reportId: report.id },
      select: {
        title: true,
        url: true,
        domain: true,
        snippet: true,
        publishedAt: true,
        sourceType: true,
        credibilityScore: true,
        citationIndex: true,
      },
      orderBy: [{ citationIndex: "asc" }, { title: "asc" }],
    });

    // 5. Assemble markdown
    const markdown = this.assembleMarkdown(topic, report, evidences);
    if (markdown.length === 0) {
      throw new BadRequestException(
        "Assembled report markdown is empty (fullReport missing)",
      );
    }

    const titleWithVersion = `${topic.name} (Topic Insight · v${report.version})`;
    const sourceIdValue = `${topicId}#v${report.version}`;
    const sourceUrlValue = `/topic-insights/${topicId}?reportVersion=${report.version}`;

    // 6. Dedup
    const dup = await this.prisma.knowledgeBaseDocument.findFirst({
      where: {
        knowledgeBaseId,
        sourceType: KnowledgeBaseSourceType.TOPIC_REPORT,
        sourceId: sourceIdValue,
      },
      select: { id: true, title: true },
    });
    if (dup) {
      this.logger.warn(
        `[topic-import] dup: kb=${knowledgeBaseId} sourceId=${sourceIdValue} existing=${dup.id}`,
      );
      throw new BadRequestException(
        `This topic report version is already imported as "${dup.title}" — delete the old doc first if you want to re-import`,
      );
    }

    this.logger.log(
      `[topic-import] start userId=${userId} kb=${knowledgeBaseId} topicId=${topicId} version=${report.version} chars=${markdown.length} evidences=${evidences.length}`,
    );

    // 7. addDocument
    const doc = await this.knowledgeBaseService.addDocument(knowledgeBaseId, {
      title: titleWithVersion,
      content: markdown,
      sourceType: KnowledgeBaseSourceType.TOPIC_REPORT,
      sourceId: sourceIdValue,
      sourceUrl: sourceUrlValue,
      mimeType: "text/markdown",
      metadata: {
        topicId,
        topicReportId: report.id,
        version: report.version,
        versionLabel: report.versionLabel,
        generatedAt: report.generatedAt.toISOString(),
        totalSources: report.totalSources,
      },
    });

    return {
      documentId: doc.id,
      title: titleWithVersion,
      knowledgeBaseId,
      sourceId: sourceIdValue,
      version: report.version,
      charCount: markdown.length,
    };
  }

  // ─── Markdown assembly ─────────────────────────────────────────────

  private assembleMarkdown(
    topic: { id: string; name: string; description: string | null },
    report: {
      id: string;
      version: number;
      versionLabel: string | null;
      executiveSummary: string;
      fullReport: string;
      highlights: unknown;
      generatedAt: Date;
      totalSources: number;
    },
    evidences: Array<{
      title: string;
      url: string;
      domain: string | null;
      snippet: string | null;
      publishedAt: Date | null;
      sourceType: string | null;
      credibilityScore: number | null;
      citationIndex: number | null;
    }>,
  ): string {
    const parts: string[] = [];

    // (a) frontmatter
    parts.push(this.frontmatter(topic, report));

    // (b) executive summary (短摘要)
    if (report.executiveSummary) {
      parts.push("## 执行摘要\n\n");
      parts.push(report.executiveSummary);
      parts.push("\n\n---\n\n");
    }

    // (c) highlights (core takeaways, 如有)
    parts.push(this.highlightsAppendix(report.highlights));

    // (d) full report body
    parts.push(report.fullReport ?? "");

    // (e) evidence appendix（与 mission citations 同模式但字段来源不同）
    parts.push(this.evidenceAppendix(evidences));

    return parts.join("");
  }

  private frontmatter(
    topic: { id: string; name: string; description: string | null },
    report: {
      id: string;
      version: number;
      versionLabel: string | null;
      generatedAt: Date;
      totalSources: number;
    },
  ): string {
    let s = "---\n";
    s += `topic: "${topic.name.replace(/"/g, "'")}"\n`;
    if (topic.description) {
      // 折行到一行避免 YAML 多行 quirk
      s += `description: "${topic.description.replace(/"/g, "'").replace(/\r?\n/g, " ").slice(0, 500)}"\n`;
    }
    s += `version: ${report.version}\n`;
    if (report.versionLabel) {
      s += `versionLabel: "${report.versionLabel}"\n`;
    }
    s += `generatedAt: "${report.generatedAt.toISOString()}"\n`;
    s += `totalSources: ${report.totalSources}\n`;
    s += "source: topic-insight\n";
    s += `topicId: ${topic.id}\n`;
    s += `reportId: ${report.id}\n`;
    s += "---\n\n";
    return s;
  }

  private highlightsAppendix(highlightsJson: unknown): string {
    if (!Array.isArray(highlightsJson) || highlightsJson.length === 0) {
      return "";
    }
    // highlights schema 历史多变；尽量宽容渲染
    let md = "## 核心亮点\n\n";
    for (const h of highlightsJson) {
      if (typeof h === "string") {
        md += `- ${h}\n`;
      } else if (h && typeof h === "object") {
        const obj = h as Record<string, unknown>;
        const title =
          typeof obj.title === "string"
            ? obj.title
            : typeof obj.headline === "string"
              ? obj.headline
              : null;
        const desc =
          typeof obj.description === "string"
            ? obj.description
            : typeof obj.detail === "string"
              ? obj.detail
              : null;
        if (title && desc) md += `- **${title}** — ${desc}\n`;
        else if (title) md += `- ${title}\n`;
        else if (desc) md += `- ${desc}\n`;
      }
    }
    md += "\n---\n\n";
    return md;
  }

  private evidenceAppendix(
    evidences: Array<{
      title: string;
      url: string;
      domain: string | null;
      snippet: string | null;
      publishedAt: Date | null;
      sourceType: string | null;
      credibilityScore: number | null;
      citationIndex: number | null;
    }>,
  ): string {
    if (evidences.length === 0) return "";
    let md = "\n\n---\n\n## 参考文献\n\n";
    for (const e of evidences) {
      const idx = e.citationIndex != null ? `[${e.citationIndex}]` : "—";
      const tag = e.sourceType ? ` [${e.sourceType}]` : "";
      const credit =
        e.credibilityScore != null ? ` ・可信度 ${e.credibilityScore}/100` : "";
      const date = e.publishedAt
        ? ` (${e.publishedAt.toISOString().slice(0, 10)})`
        : "";
      md += `${idx}${tag} ${e.title}${
        e.domain ? ` — ${e.domain}` : ""
      }${date}${credit}\n  ${e.url}\n\n`;
    }
    return md;
  }
}
