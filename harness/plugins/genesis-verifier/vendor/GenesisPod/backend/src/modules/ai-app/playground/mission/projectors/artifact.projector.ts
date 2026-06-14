/**
 * artifact.projector.ts — Canonical ReportArtifact composer（B3-2）
 *
 * 落地依据：thinning plan §6.6 / §6.6.2 / §6.6.4 / §6.6.1 / §B3-2
 *
 * Source anchor:
 *   frontend/lib/features/playground/synthesize-artifact.ts
 *
 * 设计：
 * - 纯函数（无 DI）。
 * - 输入 mission row 的相关字段 + 已经投影的 mission view。
 * - 输出 ReportArtifactV2 或 EmptyArtifactSentinel（永不返回 undefined）。
 *
 * §6.6.2 严格 mapping：
 *   1. v1.title → metadata.topic + 顶层 display title
 *   2. v1.summary → quickView.executiveSummary.markdown
 *   3. v1.sections[] → sections[] + content.fullMarkdown
 *   4. v1.conclusion → sections[type=conclusion] when present
 *   5. v1.citations[] → citations[]，缺 title 用 hostname-derived fallback
 *   6. 缺失 figures/factTable/quality/quickView → 填 schema-complete empty collections
 *
 * §6.6.4 R2 off-load：
 *   projector 假设 Prisma JSON hydration 已就绪。reportFull = null 但 reportFullUri 非空时，
 *   说明 hydration 失败或未启用，返回 sentinel（first cut 不在 projector 内做 fetch）。
 */

import type { MissionDetail } from "../lifecycle/mission-store.service";
import type {
  ArtifactCitation,
  ArtifactSection,
  ReportArtifactV2,
} from "../../api/contracts/artifact.contract";
import { isReportArtifactV2 } from "../../api/contracts/artifact.contract";
import type { EmptyArtifactSentinel } from "../../api/contracts/view-state.contract";

// ============================================================================
// V1 shape（与 frontend/synthesize-artifact.ts 内部 V1Report 一致；§6.6.2 anchor）
// ============================================================================

interface V1Report {
  title?: string;
  summary?: string;
  sections?: Array<{ heading: string; body: string; sources?: string[] }>;
  conclusion?: string;
  citations?: string[];
}

// ============================================================================
// Public entry
// ============================================================================

/**
 * 从 MissionDetail 投影 canonical reportArtifact 字段。
 *
 * 返回：
 *   - ReportArtifactV2（mission row 已含完整 v2 reportFull）
 *   - normalized v2（从 v1 升级而来）
 *   - EmptyArtifactSentinel（reportFull = null / R2 off-load 未 hydrate / 无 v2 shape）
 */
export function projectArtifact(
  row: MissionDetail,
): ReportArtifactV2 | EmptyArtifactSentinel {
  const raw = row.reportFull;

  // §6.6.4：reportFull = null + reportFullUri 非空 → off-load 未 hydrate
  if (raw == null) {
    if (hasOffloadUri(row)) {
      return { kind: "empty-artifact", reason: "v1-needs-normalization" };
    }
    return { kind: "empty-artifact", reason: "not-yet-materialized" };
  }

  // v2 already canonical
  if (isReportArtifactV2(raw)) return raw;

  // v1 需要 normalize
  if (raw && typeof raw === "object") {
    const v1 = raw as V1Report;
    if (v1.sections || v1.summary || v1.title) {
      return normalizeV1ToV2(v1);
    }
  }

  // unrecognized shape
  return { kind: "empty-artifact", reason: "v1-needs-normalization" };
}

// ============================================================================
// V1 → V2 normalization（§6.6.2 严格映射）
// ============================================================================

export function normalizeV1ToV2(v1: V1Report): ReportArtifactV2 {
  const title = v1.title ?? "研究报告";
  const summary = v1.summary ?? "";
  const v1Sections = Array.isArray(v1.sections) ? v1.sections : [];

  // §6.6.2 rule 3 + rule 1: sections + fullMarkdown 同时拼接
  const mdParts: string[] = [];
  if (summary) {
    mdParts.push(`# ${title}\n\n${summary}\n`);
  } else {
    mdParts.push(`# ${title}\n`);
  }

  let charOffset = mdParts.join("").length;
  const sections: ArtifactSection[] = [];

  // §6.6.2 rule 2: summary → quickView.executiveSummary.markdown （在底部 quickView 填充）
  // 在 sections 里也放一个 executive_summary section 以贴 v1 视觉
  if (summary) {
    sections.push({
      id: "sec-summary",
      type: "executive_summary",
      level: 2,
      title: "摘要",
      anchor: "summary",
      startOffset: 0,
      endOffset: charOffset,
      wordCount: summary.length,
      readingTimeMinutes: estimateReadingTime(summary.length),
      citations: [],
      figureIds: [],
      factIds: [],
    });
  }

  v1Sections.forEach((s, i) => {
    const heading = (s.heading ?? `章节 ${i + 1}`).trim();
    const body = (s.body ?? "").trim();
    const block = `\n## ${heading}\n\n${body}\n`;
    const startOffset = charOffset;
    mdParts.push(block);
    charOffset += block.length;
    sections.push({
      id: `sec-${i + 1}`,
      type: "dimension",
      level: 2,
      title: heading,
      anchor: `sec-${i + 1}`,
      startOffset,
      endOffset: charOffset,
      wordCount: body.length,
      readingTimeMinutes: estimateReadingTime(body.length),
      citations: [],
      figureIds: [],
      factIds: [],
    });
  });

  // §6.6.2 rule 4: conclusion → sections[type=conclusion] when present
  if (v1.conclusion) {
    const block = `\n## 结论\n\n${v1.conclusion.trim()}\n`;
    const startOffset = charOffset;
    mdParts.push(block);
    charOffset += block.length;
    sections.push({
      id: "sec-conclusion",
      type: "conclusion",
      level: 2,
      title: "结论",
      anchor: "conclusion",
      startOffset,
      endOffset: charOffset,
      wordCount: v1.conclusion.length,
      readingTimeMinutes: estimateReadingTime(v1.conclusion.length),
      citations: [],
      figureIds: [],
      factIds: [],
    });
  }

  const fullMarkdown = mdParts.join("");

  // §6.6.2 rule 5: citations URL 数组 → ArtifactCitation[]，缺 title 用 hostname 派生
  const citations: ArtifactCitation[] = (v1.citations ?? []).map((url, i) => {
    const domain = safeHostname(url);
    return {
      index: i + 1,
      uuid: `cite-${i + 1}`,
      title: domain || url,
      url,
      domain,
      accessedAt: new Date().toISOString(),
      sourceType: "other",
      credibilityScore: 0,
      occurrences: [],
    };
  });

  // §6.6.2 rule 6: 必填 schema-complete empty collections / zeroed structures
  return {
    content: {
      fullMarkdown,
      fullReportSize: fullMarkdown.length,
    },
    sections,
    citations,
    figures: [],
    factTable: [],
    metadata: {
      topic: title,
      generatedAt: new Date().toISOString(),
      generationTimeMs: 0,
      version: 1,
      isIncremental: false,
      dimensionCount: 0,
      sourceCount: citations.length,
      factCount: 0,
      figureCount: 0,
      wordCount: fullMarkdown.length,
      readingTimeMinutes: estimateReadingTime(fullMarkdown.length),
      styleProfile: "executive",
      lengthProfile: "standard",
      audienceProfile: "domain-expert",
      language: "zh-CN",
      totalTokens: { prompt: 0, completion: 0, total: 0 },
      costCents: 0,
      modelTrail: [],
    },
    quality: {
      overall: 0,
      dimensions: {
        traceability: 0,
        factualConsistency: 0,
        novelty: 0,
        coverage: 0,
        redundancy: 0,
        formatCorrectness: 0,
        citationDensity: 0,
        styleConformance: 0,
        lengthAccuracy: 0,
        chapterBalance: 0,
      },
      hardGateViolations: [],
      warnings: [],
      qualityTrace: [],
    },
    quickView: {
      executiveSummary: { markdown: summary, wordCount: summary.length },
      topHighlights: [],
      topTrends: [],
      keyRisks: [],
      topRecommendations: [],
      keyCitations: [],
      keyFigures: [],
      estimatedReadingTime: estimateReadingTime(fullMarkdown.length),
      whatYouWillLearn: [],
      riskMatrix: [],
      keyFindingsByDimension: [],
    },
  };
}

// ============================================================================
// helpers
// ============================================================================

function estimateReadingTime(charLength: number): number {
  return Math.max(1, Math.ceil(charLength / 400));
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * §6.6.4 R2 off-load 兼容：MissionDetail 当前未暴露 reportFullUri 字段
 * （仅 reportFullSize），所以判定改为"reportFullSize 非 null 但 reportFull null"——
 * 表示行内有 off-load 痕迹但 hydration 未填回。
 */
function hasOffloadUri(row: MissionDetail): boolean {
  const cast = row as unknown as { reportFullSize?: number | null };
  return cast.reportFullSize != null && cast.reportFullSize > 0;
}
