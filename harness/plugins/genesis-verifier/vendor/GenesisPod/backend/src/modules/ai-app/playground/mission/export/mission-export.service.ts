/**
 * MissionExportService —— mission 报告导出装配（CSV / Markdown / JSON）
 *
 * 拆自 playground.controller.ts (PR-10c 2026-05-04, controller 1007 行
 * 严重违反 standards/16 §六 500 行硬上限)。
 *
 * 留 app（B 类领域装配，17 §四）：
 *   • 直接 read playground 业务表 schema (mission.reportFull / reconciliationReport)
 *   • 业务格式约定（factTable CSV 列名 / Markdown 附录布局 / leaderForeword 拼装）
 *   • Critic L4 警告 dimension 前缀 'l4-*' 是 playground 业务语义
 *
 * 后续 W22 评估时可抽通用 markdown-frontmatter / csv-escape 基元到 engine/content，
 * 但 mission 报告专属字段（factTable / citations / leaderForeword / reconciliation /
 * l4-warnings）必须留 app。
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { MissionStore } from "../../mission/lifecycle/mission-store.service";
import { normalizeV1ToV2 } from "../../mission/projectors/artifact.projector";

interface ExportedMission {
  filename: string;
  mimeType: string;
  content: string;
}

interface ReportFull {
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

@Injectable()
export class MissionExportService {
  constructor(private readonly store: MissionStore) {}

  async export(
    missionId: string,
    userId: string,
    format: string,
  ): Promise<ExportedMission> {
    const mission = await this.store.getById(missionId, userId);
    if (!mission) throw new ForbiddenException("Mission not found");

    const rawReportFull = (mission as { reportFull?: unknown }).reportFull;
    if (!rawReportFull) {
      throw new BadRequestException("Mission has no report yet");
    }

    // ★ 2026-05-26 WYSIWYG 修复：旧 mission row.reportFull 是 v1 shape
    //   （title / summary / sections{heading,body} / citations:string[]）；
    //   前端 ArtifactReader 走 ArtifactComposer 已 normalize 到 v2（含
    //   content.fullMarkdown + ArtifactCitation[]）。本服务之前直接读 row.reportFull
    //   导致 markdown 导出 fullMarkdown 缺失 / citations 不带 title，与 UI 不一致。
    //   现统一走 normalizeV1ToV2，确保导出 = UI 所见。
    const reportFull = this.normalizeReportFull(rawReportFull);

    const slug = this.makeSlug(reportFull, missionId);

    if (format === "csv-facts") return this.exportFactsCsv(reportFull, slug);
    if (format === "csv-citations")
      return this.exportCitationsCsv(reportFull, slug);
    if (format === "markdown")
      return this.exportMarkdown(reportFull, mission, slug, missionId);
    if (format === "json") return this.exportJson(reportFull, mission, slug);

    throw new BadRequestException(
      `Unsupported export format: ${format}. Use csv-facts | csv-citations | markdown | json`,
    );
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  /**
   * Ensure reportFull is in v2 shape (matching ArtifactReader display path).
   * - already v2 (has content.fullMarkdown) → 原样返回
   * - v1 shape (has title/summary/sections{heading,body}) → normalize 到 v2
   * - unknown → as-is（兜底）
   */
  private normalizeReportFull(raw: unknown): ReportFull {
    if (!raw || typeof raw !== "object") return {} as ReportFull;
    const obj = raw as Record<string, unknown>;
    const content = obj.content as { fullMarkdown?: string } | undefined;
    // v2 hallmark：content.fullMarkdown 已存在 → 直接用
    if (content && typeof content.fullMarkdown === "string") {
      return raw as ReportFull;
    }
    // v1 hallmark：sections 是 {heading, body} 数组
    const sections = obj.sections;
    const hasV1Sections =
      Array.isArray(sections) &&
      sections.length > 0 &&
      sections.every(
        (s) => s && typeof s === "object" && "heading" in s && "body" in s,
      );
    if (hasV1Sections || obj.summary || obj.title) {
      const v2 = normalizeV1ToV2(raw as Parameters<typeof normalizeV1ToV2>[0]);
      // ReportArtifactV2 字段子集 mirror ReportFull interface
      return v2 as unknown as ReportFull;
    }
    return raw as ReportFull;
  }

  private sanitize(s: string): string {
    return `"${s.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
  }

  private makeSlug(reportFull: ReportFull, missionId: string): string {
    const topic = reportFull.metadata?.topic as string | undefined;
    return topic
      ? topic
          .replace(/[^\w一-龥-]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 40)
      : missionId.slice(0, 8);
  }

  private exportFactsCsv(
    reportFull: ReportFull,
    slug: string,
  ): ExportedMission {
    const facts = reportFull.factTable ?? [];
    const lines = ["entity,attribute,value,source_count,source_indices"];
    for (const f of facts) {
      const sources = f.sources ?? [];
      lines.push(
        `${this.sanitize(f.entity)},${this.sanitize(f.attribute)},${this.sanitize(f.value)},${sources.length},${this.sanitize(sources.join("|"))}`,
      );
    }
    return {
      filename: `${slug}-facts.csv`,
      mimeType: "text/csv; charset=utf-8",
      content: "﻿" + lines.join("\n"),
    };
  }

  private exportCitationsCsv(
    reportFull: ReportFull,
    slug: string,
  ): ExportedMission {
    const cites = reportFull.citations ?? [];
    const lines = [
      "index,title,url,domain,source_type,credibility_score,published_at",
    ];
    for (const c of cites) {
      lines.push(
        `${c.index},${this.sanitize(c.title)},${this.sanitize(c.url)},${this.sanitize(c.domain)},${this.sanitize(c.sourceType ?? "")},${c.credibilityScore ?? ""},${this.sanitize(c.publishedAt ?? "")}`,
      );
    }
    return {
      filename: `${slug}-citations.csv`,
      mimeType: "text/csv; charset=utf-8",
      content: "﻿" + lines.join("\n"),
    };
  }

  private exportMarkdown(
    reportFull: ReportFull,
    mission: Awaited<ReturnType<MissionStore["getById"]>>,
    slug: string,
    missionId: string,
  ): ExportedMission {
    const meta = reportFull.metadata;
    let md = "";
    if (meta) md += this.frontmatter(meta, missionId);
    md += this.leaderForewordSection(meta);
    md += reportFull.content?.fullMarkdown ?? "";
    md += this.referencesAppendix(reportFull.citations ?? []);
    md += this.reconciliationAppendix(mission);
    md += this.criticL4Appendix(reportFull);

    return {
      filename: `${slug}.md`,
      mimeType: "text/markdown; charset=utf-8",
      content: md,
    };
  }

  private exportJson(
    reportFull: ReportFull,
    mission: Awaited<ReturnType<MissionStore["getById"]>>,
    slug: string,
  ): ExportedMission {
    const missionRow = mission as {
      reconciliationReport?: unknown;
    };
    return {
      filename: `${slug}.json`,
      mimeType: "application/json; charset=utf-8",
      content: JSON.stringify(
        {
          artifact: reportFull,
          reconciliation: missionRow.reconciliationReport ?? null,
        },
        null,
        2,
      ),
    };
  }

  // ─── Markdown sub-sections ────────────────────────────────────────

  /** Phase P6-15: YAML frontmatter (mission 元信息) */
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
    s += "---\n\n";
    return s;
  }

  /** ★ Phase Lead-2: Lead Foreword 放在 fullMarkdown 之前 */
  private leaderForewordSection(
    meta: Record<string, unknown> | undefined,
  ): string {
    const leaderForeword = (
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
    if (!leaderForeword) return "";

    let md = "## Foreword by Lead\n\n";
    if ((leaderForeword.whatWeAnswered ?? []).length > 0) {
      md += "### 我们回答了什么\n\n";
      for (const a of leaderForeword.whatWeAnswered ?? []) {
        const icon =
          a.addressed === "yes" ? "✓" : a.addressed === "partial" ? "⚠️" : "✗";
        md += `- ${icon} **${a.criterion}** — ${a.evidence}\n`;
      }
      md += "\n";
    }
    if ((leaderForeword.whatRemainsUnclear ?? []).length > 0) {
      md += "### 没回答 / 证据不足\n\n";
      for (const u of leaderForeword.whatRemainsUnclear ?? []) {
        md += `- ${u}\n`;
      }
      md += "\n";
    }
    if (leaderForeword.howToRead) {
      md += "### 如何阅读本报告\n\n";
      md += leaderForeword.howToRead + "\n\n";
    }
    if ((leaderForeword.recommendedFollowUp ?? []).length > 0) {
      md += "### 建议的后续研究方向\n\n";
      for (const r of leaderForeword.recommendedFollowUp ?? []) {
        md += `- ${r}\n`;
      }
      md += "\n";
    }
    md += "---\n\n";
    return md;
  }

  /** Phase P2-8: 末尾追加 references 附录（让导出 .md 自含引用） */
  private referencesAppendix(
    cites: NonNullable<ReportFull["citations"]>,
  ): string {
    if (cites.length === 0) return "";
    let md = "\n\n---\n\n## 参考文献\n\n";
    for (const c of cites) {
      const tag = c.sourceType ? ` [${c.sourceType}]` : "";
      const credit =
        c.credibilityScore != null ? ` ・可信度 ${c.credibilityScore}/100` : "";
      md += `[${c.index}]${tag} ${c.title} — ${c.domain}${c.publishedAt ? ` (${c.publishedAt.slice(0, 10)})` : ""}${credit}\n  ${c.url}\n\n`;
    }
    return md;
  }

  /** P103-1 / P108-1: Reconciliation 总览 + dedup 统计 + termGlossary */
  private reconciliationAppendix(
    mission: Awaited<ReturnType<MissionStore["getById"]>>,
  ): string {
    const recon = (
      mission as {
        reconciliationReport?: {
          reconciliationReport?: string;
          deduplicationStats?: {
            duplicatesRemoved?: number;
            termVariantsUnified?: number;
            dataInconsistenciesFlagged?: number;
          };
          termGlossary?: { canonical: string; variants: string[] }[];
        } | null;
      }
    ).reconciliationReport;
    if (!recon) return "";
    let md = "\n\n---\n\n## 附录：对账总览\n\n";
    if (recon.deduplicationStats) {
      md += `**去重统计**：去重 ${recon.deduplicationStats.duplicatesRemoved ?? 0} · 术语统一 ${recon.deduplicationStats.termVariantsUnified ?? 0} · 数据冲突 ${recon.deduplicationStats.dataInconsistenciesFlagged ?? 0}\n\n`;
    }
    if (recon.termGlossary && recon.termGlossary.length > 0) {
      md += "**术语对照表**：\n";
      for (const g of recon.termGlossary) {
        md += `- **${g.canonical}** ↔ ${g.variants.join(" / ")}\n`;
      }
      md += "\n";
    }
    if (recon.reconciliationReport) {
      md += recon.reconciliationReport;
    }
    return md;
  }

  /**
   * Critic L4 独立复审附录（auditLayers >= thorough 时生成）
   * 让导出 .md 包含独立审查发现，便于复盘 / 二次撰稿。
   */
  private criticL4Appendix(reportFull: ReportFull): string {
    const l4Warnings = (reportFull.quality?.warnings ?? []).filter((w) =>
      w.dimension?.startsWith("l4-"),
    );
    if (l4Warnings.length === 0) return "";

    const blindspots = l4Warnings.filter((w) => w.dimension === "l4-blindspot");
    const biases = l4Warnings.filter((w) => w.dimension === "l4-bias");
    const suggestions = l4Warnings.filter(
      (w) => w.dimension === "l4-suggestion",
    );
    const critics = l4Warnings.filter((w) => w.dimension === "l4-critic");

    let md = "\n\n---\n\n## 附录：独立审查（Critic L4）\n\n";
    if (critics.length > 0) {
      md += "### 整体判定\n";
      for (const w of critics) md += `- ${w.message}\n`;
      md += "\n";
    }
    if (blindspots.length > 0) {
      md += "### 盲点（Blind Spots）\n";
      for (const w of blindspots) md += `- ${w.message}\n`;
      md += "\n";
    }
    if (biases.length > 0) {
      md += "### 潜在偏见（Biases）\n";
      for (const w of biases) md += `- ${w.message}\n`;
      md += "\n";
    }
    if (suggestions.length > 0) {
      md += "### 改进建议（Suggestions）\n";
      for (const w of suggestions) md += `- ${w.message}\n`;
      md += "\n";
    }
    return md;
  }
}
