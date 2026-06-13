/**
 * PlaygroundReportImportService
 *
 * 把 `playground` 模块生成的 mission 报告导入 KB 作为 KnowledgeBaseDocument。
 *
 * 设计原则（2026-05-19）：
 *   1. **library 是 import sink**，所有外部源（含内部 ai-app 模块产物）都通过
 *      library 内的 import service 被拉进来——与 `feishu-import` / `platform-import` /
 *      `google-drive-rag` 完全同模式
 *   2. **不反向 import source 模块** — 直接通过 PrismaService 读 source 表
 *      （AgentPlaygroundMission / MissionReportVersion），不依赖 playground module
 *   3. **每个 version 独立一份文档**（用户 2026-05-19 决策）：sourceId = `missionId#vN`，
 *      title 后缀 ` (v{N})`；rerun 产生新版本不覆盖
 *   4. **附录全带**（用户 2026-05-19 决策）：frontmatter + leaderForeword + fullMarkdown
 *      + references + reconciliation + critic L4
 *   5. **不自动触发 wiki ingest**（用户 2026-05-19 决策）：addDocument 只跑
 *      preparse + chunking，wiki ingest 由用户在 wiki 标签页主动点
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { KnowledgeBaseSourceType, Prisma } from "@prisma/client";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { KnowledgeBaseService } from "./knowledge-base.service";

interface MissionReportFull {
  factTable?: {
    entity: string;
    attribute: string;
    value: string;
    sources?: number[];
  }[];
  citations?: {
    index: number;
    title: string;
    url: string;
    domain: string;
    sourceType?: string;
    credibilityScore?: number;
    publishedAt?: string;
  }[];
  content?: { fullMarkdown?: string };
  metadata?: Record<string, unknown>;
  quality?: { warnings?: { dimension: string; message: string }[] };
}

export interface PlaygroundReportImportResult {
  documentId: string;
  title: string;
  knowledgeBaseId: string;
  sourceId: string;
  version: number | null;
  charCount: number;
}

@Injectable()
export class PlaygroundReportImportService {
  private readonly logger = new Logger(PlaygroundReportImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledgeBaseService: KnowledgeBaseService,
  ) {}

  /**
   * 列出当前用户所有"可导入"的 mission（completed + 有 reportFull）。
   *
   * 用于 KB 创建/详情页的「从 Playground 导入」面板浏览。返回 mission 概况 +
   * 最新版本号 + 已生成版本数；用户多选后逐条 POST /import-playground-mission。
   */
  async listImportableMissions(
    userId: string,
    options?: { limit?: number; offset?: number; status?: string },
  ): Promise<
    Array<{
      missionId: string;
      topic: string;
      status: string;
      completedAt: Date | null;
      startedAt: Date;
      finalScore: number | null;
      leaderSigned: boolean | null;
      reportTitle: string | null;
      versionCount: number;
      latestVersion: number;
    }>
  > {
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
    const offset = Math.max(options?.offset ?? 0, 0);
    const status = options?.status ?? "completed";

    const missions = await this.prisma.agentPlaygroundMission.findMany({
      where: {
        userId,
        status,
        // 必须有 reportFull 或对应的 R2 off-load uri，否则不能装配 markdown
        OR: [
          { reportFull: { not: Prisma.JsonNull } },
          { reportFullUri: { not: null } },
        ],
      },
      select: {
        id: true,
        topic: true,
        status: true,
        startedAt: true,
        completedAt: true,
        finalScore: true,
        leaderSigned: true,
        reportTitle: true,
        reportVersions: {
          select: { version: true },
          orderBy: { version: "desc" },
          take: 1,
        },
        _count: { select: { reportVersions: true } },
      },
      orderBy: [{ completedAt: "desc" }, { startedAt: "desc" }],
      take: limit,
      skip: offset,
    });

    return missions.map((m) => {
      const hasVersions = m._count.reportVersions > 0;
      const latestVersion = hasVersions
        ? (m.reportVersions[0]?.version ?? 1)
        : 1;
      return {
        missionId: m.id,
        topic: m.topic,
        status: m.status,
        completedAt: m.completedAt,
        startedAt: m.startedAt,
        finalScore: m.finalScore,
        leaderSigned: m.leaderSigned,
        reportTitle: m.reportTitle,
        versionCount: hasVersions ? m._count.reportVersions : 1,
        latestVersion,
      };
    });
  }

  /**
   * 列出用户某个 mission 的所有版本（供前端版本选择器用）。
   *
   * 行为：
   *   - 若 mission 没有 MissionReportVersion 行（老 mission），返回单个伪版本 v1
   *     用 mission.reportFull 自身（current view）
   *   - 否则返回所有 versions（含 versionLabel / generatedAt / 大小）
   */
  async listVersions(
    missionId: string,
    userId: string,
  ): Promise<
    Array<{
      version: number;
      versionLabel: string | null;
      reportTitle: string | null;
      finalScore: number | null;
      leaderSigned: boolean | null;
      triggerType: string | null;
      generatedAt: Date;
    }>
  > {
    const mission = await this.prisma.agentPlaygroundMission.findUnique({
      where: { id: missionId },
      select: {
        id: true,
        userId: true,
        reportTitle: true,
        finalScore: true,
        leaderSigned: true,
        completedAt: true,
        startedAt: true,
      },
    });
    if (!mission) throw new NotFoundException("Mission not found");
    if (mission.userId !== userId) {
      throw new ForbiddenException("Not your mission");
    }

    const versions = await this.prisma.missionReportVersion.findMany({
      where: { missionId },
      select: {
        version: true,
        versionLabel: true,
        reportTitle: true,
        finalScore: true,
        leaderSigned: true,
        triggerType: true,
        generatedAt: true,
      },
      orderBy: { version: "desc" },
    });

    if (versions.length > 0) return versions;

    return [
      {
        version: 1,
        versionLabel: "initial",
        reportTitle: mission.reportTitle,
        finalScore: mission.finalScore,
        leaderSigned: mission.leaderSigned,
        triggerType: "initial",
        generatedAt: mission.completedAt ?? mission.startedAt,
      },
    ];
  }

  /**
   * 把指定 mission 报告导入到指定 KB。
   *
   * @param missionId Playground mission id
   * @param userId    当前用户（必须 = mission.userId，admin 也走自己 KB）
   * @param knowledgeBaseId 目标 KB id
   * @param version   可选，指定 MissionReportVersion；不传 = 用 mission.reportFull
   */
  async importMissionReport(
    missionId: string,
    userId: string,
    knowledgeBaseId: string,
    version?: number,
  ): Promise<PlaygroundReportImportResult> {
    // 1. Ownership check on KB
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
      select: { id: true, userId: true, name: true },
    });
    if (!kb) throw new NotFoundException("Knowledge base not found");
    if (kb.userId !== userId) {
      throw new ForbiddenException("Not your knowledge base");
    }

    // 2. Load mission + (optional) version
    //
    // off-load URI 字段必须与 JSON 字段成对 select，让 PrismaService.hydrate
    // hook 能透明回填 R2 内容；漏 *Uri 字段会让 off-loaded mission 读到 null
    // 装配出残缺 markdown（特别是大 mission 完成后 reportFull / reconciliation
    // 多半已 off-load）。
    const mission = await this.prisma.agentPlaygroundMission.findUnique({
      where: { id: missionId },
      select: {
        id: true,
        userId: true,
        topic: true,
        reportTitle: true,
        reportFull: true,
        reportFullUri: true,
        reconciliationReport: true,
        reconciliationReportUri: true,
        completedAt: true,
        startedAt: true,
        finalScore: true,
      },
    });
    if (!mission) throw new NotFoundException("Mission not found");
    if (mission.userId !== userId) {
      throw new ForbiddenException("Not your mission");
    }

    let reportFull: MissionReportFull | null = null;
    let resolvedVersion: number | null = null;
    let versionGeneratedAt: Date | null = null;

    if (version != null) {
      const versionRow = await this.prisma.missionReportVersion.findUnique({
        where: { missionId_version: { missionId, version } },
        select: {
          version: true,
          // off-load 字段成对 select（见上方 mission select 注释）
          reportFull: true,
          reportFullUri: true,
          generatedAt: true,
        },
      });
      if (!versionRow) {
        throw new NotFoundException(
          `Mission version ${version} not found for mission ${missionId}`,
        );
      }
      reportFull = versionRow.reportFull as MissionReportFull | null;
      resolvedVersion = versionRow.version;
      versionGeneratedAt = versionRow.generatedAt;
    } else {
      reportFull = mission.reportFull as MissionReportFull | null;
    }

    if (!reportFull) {
      throw new BadRequestException(
        "Mission has no report yet — wait for mission completion first",
      );
    }

    // 3. Assemble full markdown with all appendices
    const markdown = this.assembleMarkdown(reportFull, mission);
    if (markdown.length === 0) {
      throw new BadRequestException(
        "Assembled report markdown is empty (reportFull.content.fullMarkdown missing)",
      );
    }

    // 4. Build title / sourceId / sourceUrl
    const topic =
      (reportFull.metadata?.topic as string | undefined) ||
      mission.reportTitle ||
      mission.topic ||
      `Mission ${missionId.slice(0, 8)}`;
    const titleWithVersion =
      resolvedVersion != null
        ? `${topic} (Playground · v${resolvedVersion})`
        : `${topic} (Playground)`;
    const sourceIdValue =
      resolvedVersion != null ? `${missionId}#v${resolvedVersion}` : missionId;
    const sourceUrlValue =
      resolvedVersion != null
        ? `/playground/missions/${missionId}?version=${resolvedVersion}`
        : `/playground/missions/${missionId}`;

    // 5. Dedup: same (kb, sourceType, sourceId) already imported → reject (避免重复)
    const dup = await this.prisma.knowledgeBaseDocument.findFirst({
      where: {
        knowledgeBaseId,
        sourceType: KnowledgeBaseSourceType.PLAYGROUND_REPORT,
        sourceId: sourceIdValue,
      },
      select: { id: true, title: true },
    });
    if (dup) {
      this.logger.warn(
        `[playground-import] dup: kb=${knowledgeBaseId} sourceId=${sourceIdValue} existing=${dup.id}`,
      );
      throw new BadRequestException(
        `This report version is already imported as "${dup.title}" — delete the old doc first if you want to re-import`,
      );
    }

    this.logger.log(
      `[playground-import] start userId=${userId} kb=${knowledgeBaseId} missionId=${missionId} version=${resolvedVersion ?? "current"} chars=${markdown.length}`,
    );

    // 6. addDocument — KnowledgeBaseService 会 fire-and-forget 跑 preparse,
    //    后续 user 在 KB 详情页点 "处理文档" 才跑 chunking + embedding
    const doc = await this.knowledgeBaseService.addDocument(knowledgeBaseId, {
      title: titleWithVersion,
      content: markdown,
      sourceType: KnowledgeBaseSourceType.PLAYGROUND_REPORT,
      sourceId: sourceIdValue,
      sourceUrl: sourceUrlValue,
      mimeType: "text/markdown",
      metadata: {
        playgroundMissionId: missionId,
        version: resolvedVersion,
        generatedAt: (
          versionGeneratedAt ??
          mission.completedAt ??
          mission.startedAt
        ).toISOString(),
        finalScore: mission.finalScore,
        topic,
      },
    });

    return {
      documentId: doc.id,
      title: titleWithVersion,
      knowledgeBaseId,
      sourceId: sourceIdValue,
      version: resolvedVersion,
      charCount: markdown.length,
    };
  }

  // ─── Markdown assembly (mirrors mission-export.service.ts shape, but kept
  //     local to avoid cross-app module dep on playground) ──────────

  private assembleMarkdown(
    reportFull: MissionReportFull,
    mission: {
      id: string;
      reconciliationReport: unknown;
    },
  ): string {
    const parts: string[] = [];

    // (a) frontmatter (YAML)
    const meta = reportFull.metadata;
    if (meta) {
      parts.push(this.frontmatter(meta, mission.id));
    }

    // (b) leader foreword
    parts.push(this.leaderForewordSection(meta));

    // (c) full markdown body
    parts.push(reportFull.content?.fullMarkdown ?? "");

    // (d) references appendix
    parts.push(this.referencesAppendix(reportFull.citations ?? []));

    // (e) reconciliation appendix
    parts.push(this.reconciliationAppendix(mission.reconciliationReport));

    // (f) critic L4 appendix
    parts.push(this.criticL4Appendix(reportFull));

    return parts.join("");
  }

  private frontmatter(
    meta: Record<string, unknown>,
    missionId: string,
  ): string {
    let s = "---\n";
    s += `topic: "${(meta.topic as string)?.replace(/"/g, "'") ?? missionId}"\n`;
    if (meta.generatedAt) s += `generatedAt: "${meta.generatedAt}"\n`;
    if (meta.wordCount) s += `wordCount: ${meta.wordCount}\n`;
    if (meta.sourceCount) s += `sourceCount: ${meta.sourceCount}\n`;
    if (meta.figureCount) s += `figureCount: ${meta.figureCount}\n`;
    if (meta.factCount) s += `factCount: ${meta.factCount}\n`;
    if (meta.styleProfile) s += `styleProfile: ${meta.styleProfile}\n`;
    if (meta.lengthProfile) s += `lengthProfile: ${meta.lengthProfile}\n`;
    if (meta.audienceProfile) s += `audienceProfile: ${meta.audienceProfile}\n`;
    if (meta.searchTimeRange) s += `searchTimeRange: ${meta.searchTimeRange}\n`;
    s += "source: playground\n";
    s += `missionId: ${missionId}\n`;
    s += "---\n\n";
    return s;
  }

  private leaderForewordSection(
    meta: Record<string, unknown> | undefined,
  ): string {
    const lf = (
      meta as
        | {
            leaderForeword?: {
              whatWeAnswered?: {
                criterion: string;
                addressed: string;
                evidence: string;
              }[];
              whatRemainsUnclear?: string[];
              howToRead?: string;
              recommendedFollowUp?: string[];
            };
          }
        | undefined
    )?.leaderForeword;
    if (!lf) return "";

    let md = "## Foreword by Lead\n\n";
    if ((lf.whatWeAnswered ?? []).length > 0) {
      md += "### 我们回答了什么\n\n";
      for (const a of lf.whatWeAnswered ?? []) {
        const icon =
          a.addressed === "yes" ? "✓" : a.addressed === "partial" ? "⚠" : "✗";
        md += `- ${icon} **${a.criterion}** — ${a.evidence}\n`;
      }
      md += "\n";
    }
    if ((lf.whatRemainsUnclear ?? []).length > 0) {
      md += "### 没回答 / 证据不足\n\n";
      for (const u of lf.whatRemainsUnclear ?? []) md += `- ${u}\n`;
      md += "\n";
    }
    if (lf.howToRead) md += `### 如何阅读本报告\n\n${lf.howToRead}\n\n`;
    if ((lf.recommendedFollowUp ?? []).length > 0) {
      md += "### 建议的后续研究方向\n\n";
      for (const r of lf.recommendedFollowUp ?? []) md += `- ${r}\n`;
      md += "\n";
    }
    md += "---\n\n";
    return md;
  }

  private referencesAppendix(
    cites: NonNullable<MissionReportFull["citations"]>,
  ): string {
    if (cites.length === 0) return "";
    let md = "\n\n---\n\n## 参考文献\n\n";
    for (const c of cites) {
      const tag = c.sourceType ? ` [${c.sourceType}]` : "";
      const credit =
        c.credibilityScore != null ? ` ・可信度 ${c.credibilityScore}/100` : "";
      md += `[${c.index}]${tag} ${c.title} — ${c.domain}${
        c.publishedAt ? ` (${c.publishedAt.slice(0, 10)})` : ""
      }${credit}\n  ${c.url}\n\n`;
    }
    return md;
  }

  private reconciliationAppendix(recon: unknown): string {
    const r = recon as {
      reconciliationReport?: string;
      deduplicationStats?: {
        duplicatesRemoved?: number;
        termVariantsUnified?: number;
        dataInconsistenciesFlagged?: number;
      };
      termGlossary?: { canonical: string; variants: string[] }[];
    } | null;
    if (!r) return "";
    let md = "\n\n---\n\n## 附录：对账总览\n\n";
    if (r.deduplicationStats) {
      md += `**去重统计**：去重 ${r.deduplicationStats.duplicatesRemoved ?? 0} · 术语统一 ${r.deduplicationStats.termVariantsUnified ?? 0} · 数据冲突 ${r.deduplicationStats.dataInconsistenciesFlagged ?? 0}\n\n`;
    }
    if (r.termGlossary && r.termGlossary.length > 0) {
      md += "**术语对照表**：\n";
      for (const g of r.termGlossary) {
        md += `- **${g.canonical}** ↔ ${g.variants.join(" / ")}\n`;
      }
      md += "\n";
    }
    if (r.reconciliationReport) md += r.reconciliationReport;
    return md;
  }

  private criticL4Appendix(reportFull: MissionReportFull): string {
    const l4 = (reportFull.quality?.warnings ?? []).filter((w) =>
      w.dimension?.startsWith("l4-"),
    );
    if (l4.length === 0) return "";

    const groups = {
      整体判定: l4.filter((w) => w.dimension === "l4-critic"),
      "盲点（Blind Spots）": l4.filter((w) => w.dimension === "l4-blindspot"),
      "潜在偏见（Biases）": l4.filter((w) => w.dimension === "l4-bias"),
      "改进建议（Suggestions）": l4.filter(
        (w) => w.dimension === "l4-suggestion",
      ),
    };

    let md = "\n\n---\n\n## 附录：独立审查（Critic L4）\n\n";
    for (const [heading, items] of Object.entries(groups)) {
      if (items.length === 0) continue;
      md += `### ${heading}\n`;
      for (const w of items) md += `- ${w.message}\n`;
      md += "\n";
    }
    return md;
  }
}
