import { Injectable, Logger } from "@nestjs/common";
import {
  sanitizeMarkdownContent,
  stripLeadingHeading,
} from "@/common/utils/sanitize-content.utils";
import { normalizeMarkdownSlug } from "@/modules/ai-engine/facade";
import {
  filterJunkReferences,
  deduplicateReferencesByUrl,
  upgradeHttpToHttps,
  decodeUrlEntities,
  remapCitationIndices,
  limitBoldFormatting,
  removeHorizontalRules,
  repairOrderedListContinuity,
  stripInternalFigureNotation,
  mergeAdjacentMathBlocks,
  decodeHtmlEntities,
  repairBrokenListItems,
  clearBrokenMediaAndEmptyBlocks,
  fixDoubleSourceLabels,
  splitWallOfText,
  repairMarkdownTables,
  removeEmptyHeadings,
  repairTruncatedBlockquoteBullets,
  truncateLongListItems,
  separateTrappedConclusions,
  enforceExecSummarySections,
  normalizeArrowNotation,
  stripLeakedHtmlComments,
  deduplicateAdjacentCitations,
  extractTableFootnotes,
  boldSummaryPrefixes,
  bulletifyBlockquoteItems,
  splitEnumerationToList,
  repairBrokenBoldMarkers,
  stripFigureComments,
  escapeLatexPipeInTables,
  normalizeInlineDoubleDollar,
  renumberHeadings,
  ensureBlankLineAfterTables,
  stripHtmlCitationLinks,
  stripCitationsFromHeadings,
  wrapBareDisplayMath,
  deduplicateTerminalSections,
  deduplicateIdenticalSections,
  stripChapterHighlights,
  cleanupEmptyBullets,
  normalizeInformalTerms,
  normalizeSourceLabels,
  formatDimensionContent,
  mergeUndersizedSections,
  // Used by postProcessFinalReport
  stripLLMMetaNotes,
  detectAndPromoteHeadings,
  deduplicateHeadingEcho,
  collapsePseudoCodeHeadings,
  wrapPseudoCodeBlocks,
  collapseExcessSubHeadings,
} from "@/modules/ai-app/contracts/report-template";
import {
  sanitizeSectionOutput,
  stripLeadingBulletLists,
  stripCitationStacking,
  replaceMarketingLanguage,
  repairBrokenBoldPairs,
  normalizeBoldStyle,
  convertOrdinalBulletsToParagraphs,
} from "@/modules/ai-harness/facade";
import {
  stripChartJsonFromContent,
  extractMarkdownFromJsonString,
} from "@/modules/ai-engine/facade";
import { resolveChartPlaceholders as sharedResolveChartPlaceholders } from "../../utils/chart-placeholder.utils";
import type { ResearchTopic } from "@prisma/client";
import type { DimensionAnalysisInput } from "../../types/report.types";
import type {
  FigureReference,
  GeneratedChart,
} from "../../types/research.types";
import type { ReportQualityGateService } from "../quality/report-quality-gate.service";

// ==================== Public Interfaces ====================

export interface SupplementaryContent {
  preface?: string;
  executiveSummary?: string;
  crossDimensionAnalysis?: string;
  riskAssessment?: string;
  strategicRecommendations?: string;
  conclusion?: string;
}

export interface ReportReference {
  index?: number;
  title: string;
  domain?: string;
  url: string;
  accessDate?: string;
}

export interface AssembleOptions {
  /** References to append. If provided, runs the reference pipeline. */
  references?: ReportReference[];
  /** Language labels for appendices and references sections */
  appendices?: Array<{ title: string; content: string }>;
}

export interface PostProcessResult {
  content: string;
  warnings: string[];
}

// ==================== Constants ====================

/** Maximum characters per dimension content block (~8000 Chinese characters) */
const MAX_DIMENSION_CHARS = 24000;

// ==================== Helpers ====================

/**
 * Detect chapter highlights header in a line.
 * Matches all LLM format variants:
 *   > 本章要点 / > **本章要点** / > - 本章要点 / > - **本章要点：**
 *   本章要点（没有 blockquote 前缀）/ **本章要点** / - 本章要点
 *   > Chapter Highlights / Chapter Highlights
 */
// normalizeChapterHighlights is now handled by the unified formatDimensionContent pipeline

// ==================== Service ====================

/**
 * ReportAssemblerService — unified report assembly pipeline.
 *
 * Replaces the near-identical `buildFullReportFromDimensions` implementations
 * that existed in both ReportGeneratorService and ReportSynthesisService.
 *
 * Public API:
 *   processDimensionContent()  — per-dimension content normalization
 *   assembleFullReport()       — build complete markdown from parts
 *   postProcessFinalReport()   — quality gate + final cleanup
 */
@Injectable()
export class ReportAssemblerService {
  private readonly logger = new Logger(ReportAssemblerService.name);

  // ==================== Public Methods ====================

  /**
   * Unified per-dimension content processing pipeline.
   *
   * Applies, in order:
   *   1. stripLeadingHeading
   *   2. stripChartJsonFromContent
   *   3. Remove inline markdown images
   *   4. sanitizeHeadingLevels
   *   5. deduplicateHeadings
   *   6. numberSubHeadings (using dimIndex + 1 as section number)
   *   7. hierarchicalNumberBoldListItems
   *   8. deduplicateParagraphs (caller supplies globalSeenParagraphs)
   *   9. Truncate to MAX_DIMENSION_CHARS at a paragraph boundary
   *  10. resolveChartPlaceholders
   *  11. stripInternalFigureNotation
   *  12. stripLLMMetaNotes
   *
   * @param content           Raw dimension content (detailedContent or summary)
   * @param dimIndex          Zero-based dimension index (used for section numbering)
   * @param globalSeenParagraphs  Shared set for cross-dimension paragraph dedup
   * @param dimensionName     Used in truncation warning logs
   * @param figureReferences  Optional figure-to-chart reference map
   * @param generatedCharts   Optional AI-generated chart data (currently disabled in v4)
   */
  processDimensionContent(
    content: string,
    dimIndex: number,
    globalSeenParagraphs: Set<string>,
    dimensionName?: string,
    figureReferences?: FigureReference[],
    generatedCharts?: GeneratedChart[],
  ): string {
    // Pre-steps that need external imports not available in the shared pipeline
    let processed = stripLeadingHeading(content);
    processed = stripChartJsonFromContent(processed);
    // ★ 铁墙清理必须在 resolveChartPlaceholders 之前执行，否则删除 bullets 会导致图片位置偏移
    processed = stripLeadingBulletLists(processed);
    processed = sanitizeSectionOutput(processed);

    // Delegate to the unified formatting pipeline with full context
    return formatDimensionContent(processed, {
      dimIndex,
      globalSeenParagraphs,
      dimensionName,
      maxDimensionChars: MAX_DIMENSION_CHARS,
      resolveChartPlaceholders: (c: string) =>
        this.resolveChartPlaceholders(
          c,
          dimIndex,
          figureReferences,
          generatedCharts,
        ),
      logger: this.logger,
    });
  }

  /**
   * Unified full-report builder.
   *
   * Assembly order:
   *   title → generatedAt → preface → executiveSummary → TOC
   *   → dimension sections → fallback sections (when supplementary is empty)
   *   → crossDimension → riskAssessment → strategicRecommendations
   *   → conclusion (with duplication guard) → appendices → references
   *
   * Returns the assembled markdown after `sanitizeMarkdownContent`.
   * Call `postProcessFinalReport` separately for quality-gate processing.
   *
   * @param topic               ResearchTopic (used for name and language)
   * @param dimensionInputs     Per-dimension analysis results
   * @param supplementaryContent  AI-generated supplementary sections
   * @param options             Optional references and appendices
   */
  assembleFullReport(
    topic: ResearchTopic,
    dimensionInputs: DimensionAnalysisInput[],
    supplementaryContent: SupplementaryContent,
    options?: AssembleOptions,
  ): string {
    // ── Language-aware labels ──────────────────────────────────────────────
    const isEn = topic.language === "en";
    const labels = {
      generatedAt: isEn ? "Generated" : "生成时间",
      preface: isEn ? "Preface" : "前言",
      executiveSummary: isEn ? "Executive Summary" : "执行摘要",
      toc: isEn ? "Table of Contents" : "目录",
      dimension: isEn ? "Dimension" : "维度",
      crossDimension: isEn ? "Cross-Dimension Analysis" : "跨维度关联分析",
      riskAssessment: isEn ? "Risk Assessment" : "风险评估",
      strategicRec: isEn ? "Strategic Recommendations" : "战略建议",
      conclusion: isEn ? "Conclusion" : "结语",
      references: isEn ? "References" : "参考文献",
      accessed: isEn ? "Accessed" : "访问日期",
      appendix: isEn ? "Appendix" : "附录",
    };
    const locale = isEn ? "en-US" : "zh-CN";

    // ── Sanitize supplementary content ────────────────────────────────────
    // Extract plain markdown from raw JSON strings, strip LLM meta-notes,
    // and remove blockquotes from supplementary sections (spec: 禁止补充节使用引用块)
    const sc: SupplementaryContent = {};
    for (const key of Object.keys(
      supplementaryContent,
    ) as (keyof SupplementaryContent)[]) {
      const val = supplementaryContent[key];
      if (val) {
        let cleaned = stripLLMMetaNotes(extractMarkdownFromJsonString(val));
        // Strip blockquotes from supplementary sections (cross-dimension, risk, strategy)
        if (
          key === "crossDimensionAnalysis" ||
          key === "riskAssessment" ||
          key === "strategicRecommendations"
        ) {
          cleaned = cleaned.replace(/^>\s*(.+)$/gm, "$1");
        }
        sc[key] = cleaned;
      } else {
        sc[key] = val;
      }
    }

    // ── Sort dimensions by priority ────────────────────────────────────────
    const sortedDimensions = [...dimensionInputs].sort((a, b) => {
      const pa = a.priority ?? 999;
      const pb = b.priority ?? 999;
      return pa - pb;
    });

    const parts: string[] = [];

    // ── 1. Report title ───────────────────────────────────────────────────
    parts.push(`# ${topic.name}`);
    parts.push(
      `\n> ${labels.generatedAt}：${new Date().toLocaleDateString(locale)}\n`,
    );

    // ── 2. Preface (AI-generated) ─────────────────────────────────────────
    if (sc.preface) {
      parts.push(`## ${labels.preface}\n`);
      parts.push(stripLeadingHeading(sc.preface));
      parts.push("\n");
    }

    // ── 3. Executive summary (AI-generated) ──────────────────────────────
    if (sc.executiveSummary) {
      parts.push(`## ${labels.executiveSummary}\n`);
      parts.push(stripLeadingHeading(sc.executiveSummary));
      parts.push("\n");
    }

    // ── 4. Table of contents (built after dimension filtering) ──
    const tocInsertIndex = parts.length;
    // Placeholder — actual TOC entries inserted after pass 1 determines non-empty dims

    // ── 5. Dimension sections ─────────────────────────────────────────────
    // ★ 不再使用跨维度共享的 globalSeenParagraphs。
    // 跨维度去重已在 editor 阶段（语义层面）完成。
    // 字符级去重（前120字符匹配）在同主题报告中会大量误杀不同维度的正常段落，
    // 导致维度内容被全部删除。每个维度用独立的 Set 只去维度内部重复。

    // Diagnostic log: record content lengths for observability
    const dimContentLengths = sortedDimensions.map(
      (d) =>
        `${d.dimensionName}:${(d.detailedContent || "").length}/${(d.summary || "").length}`,
    );
    this.logger.log(
      `[assembleFullReport] Dimension content lengths (detailed/summary): ${dimContentLengths.join(", ")}`,
    );

    // ★ Two-pass processing — reuses already-formatted detailedContent from DB.
    // Content was formatted by formatDimensionContent() at save time (saveDimensionAnalysis).
    // Only chart placeholder injection is applied here; no re-processing of text.
    const nonEmptyDims: Array<{
      dim: (typeof sortedDimensions)[number];
      processed: string;
    }> = [];
    for (const dim of sortedDimensions) {
      const rawContent = dim.detailedContent || dim.summary || "";

      // Content already has chart placeholders (embedded at save time)
      const processed = rawContent;

      const contentBody = processed
        .replace(/^\s*#{1,6}\s+[^\n]*\n?/gm, "")
        .trim();

      this.logger.log(
        `[assembleFullReport] Dimension "${dim.dimensionName}": content=${rawContent.length} → withCharts=${processed.length} → body=${contentBody.length}`,
      );

      if (!contentBody) {
        this.logger.warn(
          `[assembleFullReport] Skipping empty dimension: ${dim.dimensionName} (content=${rawContent.length})`,
        );
        continue;
      }

      nonEmptyDims.push({ dim, processed });
    }

    // Pass 2: Emit with continuous numbering
    for (let i = 0; i < nonEmptyDims.length; i++) {
      const { dim, processed } = nonEmptyDims[i];
      parts.push(`## ${i + 1}. ${dim.dimensionName}\n`);
      parts.push(processed);
      parts.push("\n\n");
    }

    // ── 4b. Build TOC from non-empty dimensions ──
    const tocParts: string[] = [];
    tocParts.push(`## ${labels.toc}\n`);
    let tocIndex = 0;
    for (const { dim } of nonEmptyDims) {
      tocIndex++;
      const dimName = dim.dimensionName || `${labels.dimension}${tocIndex}`;
      const anchor = `${tocIndex}-${normalizeMarkdownSlug(dimName)}`;
      tocParts.push(`${tocIndex}. [${dimName}](#${anchor})`);
    }
    // Only add TOC entries for non-empty supplementary sections
    if (sc.crossDimensionAnalysis) {
      tocIndex++;
      tocParts.push(
        `${tocIndex}. [${labels.crossDimension}](#${normalizeMarkdownSlug(labels.crossDimension)})`,
      );
    }
    if (sc.riskAssessment) {
      tocIndex++;
      tocParts.push(
        `${tocIndex}. [${labels.riskAssessment}](#${normalizeMarkdownSlug(labels.riskAssessment)})`,
      );
    }
    if (sc.strategicRecommendations) {
      tocIndex++;
      tocParts.push(
        `${tocIndex}. [${labels.strategicRec}](#${normalizeMarkdownSlug(labels.strategicRec)})`,
      );
    }
    tocParts.push("\n\n");
    // Splice TOC into the correct position
    parts.splice(tocInsertIndex, 0, ...tocParts);

    // ── Collect existing H2 titles for duplicate guard ────────────────────
    const existingH2Titles = new Set(
      parts
        .join("\n")
        .match(/^## .+$/gm)
        ?.map((h) => h.replace(/^## /, "").trim()) ?? [],
    );

    // ── A4 Fallback: auto-generate supplementary sections from dimension data
    // when all three supplementary sections are empty
    if (
      !sc.crossDimensionAnalysis &&
      !sc.riskAssessment &&
      !sc.strategicRecommendations
    ) {
      this.logger.warn(
        "[assembleFullReport] crossDimensionAnalysis, riskAssessment, strategicRecommendations are all empty. Generating fallback from dimension data.",
      );

      // Cross-dimension: synthesized from keyFindings
      const fallbackCross = sortedDimensions
        .filter((d) => d.keyFindings?.length > 0)
        .map(
          (d) =>
            `**${d.dimensionName}**：${d.keyFindings
              .slice(0, 2)
              .map((f) => f.finding)
              .join("；")}`,
        )
        .join("\n\n");
      if (fallbackCross) {
        parts.push(`## ${labels.crossDimension}\n`);
        parts.push(fallbackCross);
        parts.push("\n\n");
      }

      // Risk assessment: synthesized from challenges
      const fallbackRisks = sortedDimensions
        .flatMap(
          (d) => d.challenges?.slice(0, 1).map((c) => `- ${c.challenge}`) ?? [],
        )
        .join("\n");
      if (fallbackRisks) {
        parts.push(`## ${labels.riskAssessment}\n`);
        parts.push(fallbackRisks);
        parts.push("\n\n");
      }

      // Strategic recommendations: synthesized from opportunities
      const fallbackRecs = sortedDimensions
        .flatMap(
          (d) =>
            d.opportunities?.slice(0, 1).map((o) => `- ${o.opportunity}`) ?? [],
        )
        .join("\n");
      if (fallbackRecs) {
        parts.push(`## ${labels.strategicRec}\n`);
        parts.push(fallbackRecs);
        parts.push("\n\n");
      }
    }

    // ── 6. Cross-dimension analysis (AI-generated) — duplicate guard ──────
    if (
      sc.crossDimensionAnalysis &&
      !existingH2Titles.has(labels.crossDimension)
    ) {
      parts.push(`## ${labels.crossDimension}\n`);
      parts.push(stripLeadingHeading(sc.crossDimensionAnalysis));
      parts.push("\n\n");
    }

    // ── 7. Risk assessment (AI-generated) ────────────────────────────────
    if (sc.riskAssessment && !existingH2Titles.has(labels.riskAssessment)) {
      parts.push(`## ${labels.riskAssessment}\n`);
      parts.push(stripLeadingHeading(sc.riskAssessment));
      parts.push("\n\n");
    }

    // ── 8. Strategic recommendations (AI-generated) ───────────────────────
    if (
      sc.strategicRecommendations &&
      !existingH2Titles.has(labels.strategicRec)
    ) {
      parts.push(`## ${labels.strategicRec}\n`);
      parts.push(stripLeadingHeading(sc.strategicRecommendations));
      parts.push("\n\n");
    }

    // ── 9. Conclusion (AI-generated) — with enhanced duplication guard ────
    if (sc.conclusion) {
      let conclusionText = stripLeadingHeading(sc.conclusion).trim();

      // Collect all supplementary sections to check against
      const supplementarySections = [
        sc.crossDimensionAnalysis,
        sc.riskAssessment,
        sc.strategicRecommendations,
      ]
        .filter(Boolean)
        .map((s) => (s as string).trim());

      // Extract 120-char paragraph keys from supplementary sections
      const supplementaryParagraphKeys = new Set<string>();
      for (const section of supplementarySections) {
        const paras = section.split("\n\n");
        for (const p of paras) {
          const trimmed = p.trim();
          if (trimmed.length >= 60 && !/^[#>|!\-*\d]/.test(trimmed)) {
            supplementaryParagraphKeys.add(
              trimmed.substring(0, 120).replace(/\s/g, ""),
            );
          }
        }
      }

      // Build 4-gram sets for fuzzy paragraph matching
      const extractNgrams = (text: string, n = 4): Set<string> => {
        const clean = text.replace(/[\s，。；：、！？""''（）\[\]]/g, "");
        const grams = new Set<string>();
        for (let i = 0; i <= clean.length - n; i++) {
          grams.add(clean.substring(i, i + n));
        }
        return grams;
      };
      const jaccardSimilarity = (a: Set<string>, b: Set<string>): number => {
        if (a.size === 0 || b.size === 0) return 0;
        let intersection = 0;
        for (const g of a) {
          if (b.has(g)) intersection++;
        }
        return intersection / (a.size + b.size - intersection);
      };

      // Pre-compute n-grams for each supplementary paragraph
      const supplementaryNgrams: Set<string>[] = [];
      for (const section of supplementarySections) {
        for (const p of section.split("\n\n")) {
          const trimmed = p.trim();
          if (trimmed.length >= 60 && !/^[#>|!\-*\d]/.test(trimmed)) {
            supplementaryNgrams.push(extractNgrams(trimmed));
          }
        }
      }

      // Check 1: paragraph-level content overlap (exact key + fuzzy n-gram)
      const conclusionParas = conclusionText
        .split("\n\n")
        .filter((p) => p.trim().length >= 60);
      const duplicateParas = conclusionParas.filter((p) => {
        const trimmed = p.trim();
        // Exact match on 120-char prefix
        const key = trimmed.substring(0, 120).replace(/\s/g, "");
        if (supplementaryParagraphKeys.has(key)) return true;
        // Fuzzy match: Jaccard similarity > 0.5 on 4-grams
        const pNgrams = extractNgrams(trimmed);
        return supplementaryNgrams.some(
          (supNgrams) => jaccardSimilarity(pNgrams, supNgrams) > 0.5,
        );
      });
      const overlapRatio =
        conclusionParas.length > 0
          ? duplicateParas.length / conclusionParas.length
          : 0;

      // Check 2: H3 heading overlap with cross-dimension analysis
      const extractH3 = (t: string): string[] =>
        (t.match(/^###\s+(.+)$/gm) ?? []).map((h) =>
          h
            .replace(/^###\s+/, "")
            .replace(/^[\d.]+\s*/, "")
            .trim(),
        );
      const conclusionH3 = extractH3(conclusionText);
      const crossH3 = extractH3(
        (sc.crossDimensionAnalysis || "") +
          (sc.riskAssessment || "") +
          (sc.strategicRecommendations || ""),
      );
      const h3Overlap =
        crossH3.length > 0 && conclusionH3.length > 0
          ? conclusionH3.filter((h) => crossH3.includes(h)).length /
            conclusionH3.length
          : 0;

      if (overlapRatio > 0.4 || h3Overlap > 0.5) {
        // Strip duplicate paragraphs but keep unique content
        if (
          overlapRatio < 1.0 &&
          conclusionParas.length > duplicateParas.length
        ) {
          // Partial overlap: remove only duplicate paragraphs (exact + fuzzy)
          const uniqueParas = conclusionText.split("\n\n").filter((p) => {
            const trimmed = p.trim();
            if (trimmed.length < 60 || /^[#>|!\-*\d]/.test(trimmed))
              return true;
            const key = trimmed.substring(0, 120).replace(/\s/g, "");
            if (supplementaryParagraphKeys.has(key)) return false;
            const pNgrams = extractNgrams(trimmed);
            return !supplementaryNgrams.some(
              (supNgrams) => jaccardSimilarity(pNgrams, supNgrams) > 0.5,
            );
          });
          conclusionText = uniqueParas.join("\n\n").trim();
          this.logger.warn(
            `[assembleFullReport] Conclusion had ${duplicateParas.length}/${conclusionParas.length} duplicate paragraphs, stripped duplicates`,
          );
          if (conclusionText.length > 50) {
            parts.push(`## ${labels.conclusion}\n`);
            parts.push(conclusionText);
            parts.push("\n");
          }
        } else {
          this.logger.warn(
            `[assembleFullReport] Conclusion is fully duplicate (overlap=${(overlapRatio * 100).toFixed(0)}%, h3=${(h3Overlap * 100).toFixed(0)}%), skipping`,
          );
        }
      } else if (
        conclusionText.length > 10 &&
        !/^(无|暂无|N\/A|None|无内容|待补充)$/i.test(conclusionText.trim())
      ) {
        parts.push(`## ${labels.conclusion}\n`);
        parts.push(conclusionText);
        parts.push("\n");
      }
    }

    // ── 10. Appendices ────────────────────────────────────────────────────
    if (options?.appendices && options.appendices.length > 0) {
      for (const appendix of options.appendices) {
        parts.push(`\n## ${appendix.title}\n`);
        parts.push(appendix.content);
        parts.push("\n");
      }
    }

    // ── 11. References ────────────────────────────────────────────────────
    let refIndexMapping = new Map<number, number>();
    if (options?.references && options.references.length > 0) {
      const { section: refSection, indexMapping } = this.buildReferencesSection(
        options.references,
        labels.references,
        labels.accessed,
        locale,
      );
      refIndexMapping = indexMapping;
      if (refSection) {
        parts.push(refSection);
      }
    }

    let fullReport = sanitizeMarkdownContent(parts.join("\n"));
    fullReport = removeHorizontalRules(fullReport);

    // ★ Apply citation index remapping to the FULL report body (not just the
    // reference section). When references are deduplicated, the dimension body
    // content still has old citation indices that must be updated.
    if (refIndexMapping.size > 0) {
      fullReport = remapCitationIndices(fullReport, refIndexMapping);
    }

    // ★ Diagnostic: check assembled report for $$$ before postProcess
    const assembledTriples = (fullReport.match(/\$\$\$/g) || []).length;
    if (assembledTriples > 0) {
      this.logger.warn(
        `[assembleFullReport] OUTPUT has ${assembledTriples} $$$ occurrences`,
      );
    }

    return fullReport;
  }

  /**
   * Unified final report cleanup and quality-gate pass.
   *
   * Steps:
   *   1. Quality gate (if qualityGate provided): validateFullReport
   *      Fallback (no quality gate): removeHorizontalRules + limitBoldFormatting if bold > 120
   *   2. Strip stray `---` separators in flow text
   *   3. Strip figure placeholders (<!-- figure:N:M --> and HTML-escaped forms)
   *   4. stripInternalFigureNotation (full-document pass)
   *   5. stripLLMMetaNotes (full-document pass)
   *   6. repairOrderedListContinuity
   *   7. Arrow chain warning (> 5 arrows)
   *   8. Deep heading warning (h5/h6 present)
   *
   * @param markdown        Assembled report markdown
   * @param targetLanguage  Language code ("zh" | "en")
   * @param qualityGate     Optional quality gate service; if omitted, minimal cleanup is applied
   */
  postProcessFinalReport(
    markdown: string,
    targetLanguage: string = "zh",
    qualityGate?: ReportQualityGateService,
  ): PostProcessResult {
    const warnings: string[] = [];
    let content = markdown;

    // ★ Snapshot: count $$$ before any processing to track where damage originates
    const triplesBefore = (content.match(/\$\$\$/g) || []).length;
    if (triplesBefore > 0) {
      this.logger.warn(
        `[postProcessFinalReport] INPUT already has ${triplesBefore} $$$ — damage originated upstream`,
      );
    }

    if (qualityGate) {
      // Full quality-gate path
      const qc = qualityGate.validateFullReport(content, targetLanguage);
      warnings.push(...qc.violations.map((v) => v.message));
      content = qc.wasAutoFixed ? qc.fixedContent : content;
    } else {
      // Minimal fallback: horizontal rules + excessive bold
      const hrCount = (content.match(/^\s*[-*]{3,}\s*$/gm) ?? []).length;
      if (hrCount > 0) {
        content = removeHorizontalRules(content);
        warnings.push(`Removed ${hrCount} horizontal rule(s)`);
      }
      const boldCount = (content.match(/\*\*[^*]+\*\*/g) ?? []).length;
      if (boldCount > 60) {
        content = limitBoldFormatting(content, 2);
        warnings.push(
          `Bold formatting count ${boldCount} exceeds limit 60, reduced`,
        );
      }
    }

    // Strip stray --- separators in flow text (not caught by HR regex)
    content = content.replace(/\n---\n/g, "\n\n");

    // Strip residual figure placeholders (plain and HTML-escaped)
    content = content.replace(/<!--\s*figure:\d+:\d+\s*-->/g, "");
    content = content.replace(/&lt;!--\s*figure:\d+:\d+\s*--&gt;/g, "");

    // Full-document pass: strip leaked internal figure/evidence notation
    content = stripInternalFigureNotation(content);

    // Full-document pass: strip LLM meta-notes
    content = stripLLMMetaNotes(content);

    // Repair blockquote bullets truncated mid-sentence
    content = repairTruncatedBlockquoteBullets(content);

    // Decode HTML entities (&gt; &lt; &amp;) in body text
    content = decodeHtmlEntities(content);

    // Fix double source labels (来源：来源：→ 来源：)
    content = fixDoubleSourceLabels(content);

    // Repair broken list items (empty bullet + content on next line)
    content = repairBrokenListItems(content);

    // Clear empty blockquotes and broken image placeholders
    content = clearBrokenMediaAndEmptyBlocks(content);

    // Repair Markdown tables (missing separator rows, blank lines)
    content = repairMarkdownTables(content);

    // Ensure blank line after tables (prevents footnotes from becoming table rows)
    content = ensureBlankLineAfterTables(content);

    // Extract footnote rows from tables (long explanatory text in last row)
    content = extractTableFootnotes(content);

    // Split wall-of-text paragraphs (> 400 chars) at sentence boundaries
    content = splitWallOfText(content);

    // Detect and promote heading-like plain text lines in supplementary sections
    content = detectAndPromoteHeadings(content);

    // Remove plain text echoes of headings
    content = deduplicateHeadingEcho(content);

    // Repair ordered list continuity (LLM often restarts from 1 mid-section)
    content = repairOrderedListContinuity(content);

    // Demote headings that contain pseudocode (e.g., "### if mask is not None")
    content = collapsePseudoCodeHeadings(content);

    // ★ v3.1: Convert bold-only lines to ### headings in supplementary sections
    // e.g., "**因果链 1：模块化架构推动生产部署**" → "### 因果链 1：模块化架构推动生产部署"
    content = content.replace(
      /^(\*\*([^*]+)\*\*)\s*$/gm,
      (_match, _full, inner: string) => `### ${inner.trim()}`,
    );

    // ★ v3.2: Fix double ### headings (### 2.1. ### Title → ### 2.1. Title)
    content = content.replace(/^(###\s+\d+\.\d+\.?\s+)###\s+/gm, "$1");

    // ★ v3.2: Remove empty citations [] (not followed by [ which would be reference-style link)
    content = content.replace(/\[\s*\](?!\[)/g, "");

    // ★ v3.2: Compress triple+ blank lines
    content = content.replace(/\n{3,}/g, "\n\n");

    // Wrap pseudocode blocks in fenced code blocks
    content = wrapPseudoCodeBlocks(content);

    // Collapse excess sub-headings (> 8 per dimension → demote to ####)
    content = collapseExcessSubHeadings(content, 8);

    // ★ Merge undersized sections (< 500 chars) with the next section.
    // Fixes LLM splitting a single topic into multiple tiny sections
    // (e.g., section 4.3 having only a 核心判断 blockquote, with 4.4-4.6 as sub-aspects)
    content = mergeUndersizedSections(content, 500);

    // Remove empty headings (heading → next heading with no content between)
    content = removeEmptyHeadings(content);

    // Close numbering gaps immediately after heading removal (before other steps
    // that depend on correct heading numbers, e.g. truncateLongListItems)
    content = renumberHeadings(content);

    // Enforce max list item length
    content = truncateLongListItems(content);

    // Separate conclusion paragraphs trapped in list structures
    content = separateTrappedConclusions(content);

    // Enforce structural separators in executive summary
    content = enforceExecSummarySections(content);

    // Merge fragmented adjacent $...$ math blocks into single blocks
    content = mergeAdjacentMathBlocks(content);

    // NOTE: anchorReferences + linkifyCitations produce HTML <a> tags that
    // ReactMarkdown (without rehypeRaw) renders as literal text. Skip them.
    // Citations remain as plain [N] which is standard academic format.
    // content = anchorReferences(content);
    // content = linkifyCitations(content);

    // Normalize arrow notation: fix prior "进而推动" corruption back to →
    content = normalizeArrowNotation(content);

    // Strip leaked HTML comments (LLM internal authoring notes)
    content = stripLeakedHtmlComments(content);

    // Deduplicate adjacent identical citations ([5][5] → [5])
    content = deduplicateAdjacentCitations(content);

    // Add bullet markers to consecutive blockquote lines without them
    content = bulletifyBlockquoteItems(content);

    // Split enumeration patterns (一是/二是...) into bullet lists
    content = splitEnumerationToList(content);

    // Clean up empty bullet items left by bulletify/enumeration steps
    content = cleanupEmptyBullets(content);

    // Bold summary prefix before Chinese colon (短语：→ **短语**：)
    content = boldSummaryPrefixes(content);

    // Repair broken bold markers (**，text or ** [N])
    content = repairBrokenBoldMarkers(content);

    // Strip residual figure placeholders (catch any missed by per-dimension pass)
    content = stripFigureComments(content);

    // Note: stripOrphanedChartComments is NOT called here — chart comments
    // (<!-- chart:xxx -->) are valid markers used by the frontend to position
    // figures in both continuous view (ReportEditor) and chapter view
    // (ChapterizedReportView). Stripping them here kills all chart rendering.

    // Escape LaTeX pipe characters inside table rows
    content = escapeLatexPipeInTables(content);

    // Normalize inline $$...$$ to $...$
    content = normalizeInlineDoubleDollar(content);

    // Strip 本章要点 blocks from final report
    content = stripChapterHighlights(content);

    // Re-number headings to close gaps from removed/collapsed headings
    content = renumberHeadings(content);

    // Strip HTML citation links from historical data or upstream transforms
    content = stripHtmlCitationLinks(content);

    // Strip citation markers from heading lines (belong in body, not titles)
    content = stripCitationsFromHeadings(content);

    // Wrap standalone LaTeX display-math lines in $$ delimiters
    content = wrapBareDisplayMath(content);

    // Normalize informal English terms to formal Chinese (e.g. "hype" → "炒作")
    content = normalizeInformalTerms(content);

    // Normalize citation source labels to consistent format (Source: [N])
    content = normalizeSourceLabels(content);

    // Remove duplicate terminal sections (结语 repeating 跨维度关联分析 sub-sections)
    content = deduplicateTerminalSections(content);

    // Remove identical consecutive sections (e.g. duplicated WWNBT scenario blocks)
    content = deduplicateIdenticalSections(content);

    const deepHeadingCount = (content.match(/^#{5,6}\s+/gm) ?? []).length;
    if (deepHeadingCount > 0) {
      warnings.push(
        `Deep headings (h5/h6) count ${deepHeadingCount}, should be 0`,
      );
    }

    // ★ 第三道铁墙：终极兜底清理
    content = stripLeadingBulletLists(content); // 全文删除 heading 后的裸 bullets
    content = sanitizeSectionOutput(content); // 白名单过滤
    content = stripCitationStacking(content); // 引用堆积拆分
    content = replaceMarketingLanguage(content); // 营销话术替换
    content = repairBrokenBoldPairs(content); // 修复 **** markdown 语法错误
    content = normalizeBoldStyle(content); // 修复 Bold 枚举无逗号 + 引导词去粗 + 段落开头导语句去粗
    content = convertOrdinalBulletsToParagraphs(content); // 其一/其二/第一/第二 bullet → 段落

    // ★ C4: LaTeX/table/spacing fixes
    // Note: removed `(/(\d)\s+(\d)\$/g, "$1$2")` — it was intended to fix
    // LLM residuals like "1 1$" but destroyed LaTeX formulas by eating `$`
    // delimiters, producing patterns like `$$$1$$` throughout the report.
    //
    // Bare LaTeX command wrapping is also removed — the lookbehind/lookahead
    // approach fails when formulas span multiple lines or use nested `$`.
    // LaTeX rendering is handled by the frontend's KaTeX/MathJax processor.
    // Fix text-column right-alignment in markdown tables → left-align
    content = content.replace(/^(\|[\s:]*-+):\s*\|/gm, "$1 |");
    // Compress 4+ consecutive blank lines → 2
    content = content.replace(/\n{4,}/g, "\n\n\n");

    // ★ removeOrphanCitations 不在此处执行——postProcessFinalReport 时报告尚无参考文献。
    // 孤儿引用清理在 synthesizeReport 中参考文献追加后执行。

    if (warnings.length > 0) {
      this.logger.warn(
        `[postProcessFinalReport] Quality fixes/warnings:\n${warnings.join("\n")}`,
      );
    }

    // ★ Safety net: detect and log $$$ damage introduced during processing
    const triplesAfter = (content.match(/\$\$\$/g) || []).length;
    if (triplesAfter > 0 && triplesAfter > triplesBefore) {
      this.logger.error(
        `[postProcessFinalReport] FORMULA DAMAGE DETECTED: $$$ count ${triplesBefore} → ${triplesAfter} (+${triplesAfter - triplesBefore}). Code version: FIX_2_REWRITE_2026_04_16`,
      );
    }

    return { content, warnings };
  }

  /**
   * Re-process an already-stored fullReport through the latest post-processing pipeline.
   *
   * This is a lightweight operation (no LLM call) that applies all formatting fixes
   * to an existing report. Use this to fix reports generated with older pipeline versions.
   *
   * @param storedMarkdown  The fullReport field from TopicReport
   * @param targetLanguage  Target language (default "zh")
   * @returns Updated markdown with all fixes applied
   */
  reprocessStoredReport(
    storedMarkdown: string,
    targetLanguage: string = "zh",
  ): PostProcessResult {
    return this.postProcessFinalReport(storedMarkdown, targetLanguage);
  }

  /**
   * Apply citation-related post-processing to a complete report
   * (body + references section already concatenated).
   *
   * Use this when references are appended AFTER postProcessFinalReport
   * (e.g. in synthesizeReport where references are built separately).
   *
   * Steps: mergeAdjacentMathBlocks (anchorReferences + linkifyCitations disabled —
   * ReactMarkdown has no rehypeRaw, HTML <a> renders as literal text)
   */
  finalizeReportWithCitations(content: string): string {
    return mergeAdjacentMathBlocks(content);
  }

  // ==================== Private Methods ====================

  /**
   * Resolves chart placeholders in dimension content:
   *   1. Converts <!-- figure:N:M --> to <!-- chart:dX-id --> via figureReferences
   *   2. Strips unresolved <!-- figure:N:M --> placeholders
   *   3. Deduplicates chart placeholders by chartId
   *
   * Note: generatedCharts injection is disabled in v4 (AI-fabricated charts disabled).
   */
  private resolveChartPlaceholders(
    content: string,
    dimIndex: number,
    figureReferences?: FigureReference[],
    generatedCharts?: GeneratedChart[],
  ): string {
    return sharedResolveChartPlaceholders(
      content,
      dimIndex,
      figureReferences,
      generatedCharts,
    );
  }

  /**
   * Builds and returns the references section markdown string,
   * after running the full reference cleanup pipeline:
   *   filterJunkReferences → decodeUrlEntities → upgradeHttpToHttps
   *   → deduplicateReferencesByUrl → remapCitationIndices (applied to caller's content)
   *
   * Note: `remapCitationIndices` cannot be applied here because it operates on
   * the full report body, not on the references alone. The caller should pass
   * the returned `citationIndexMapping` to `remapCitationIndices` separately
   * when needed. This method applies the mapping to the section itself.
   */
  private buildReferencesSection(
    references: ReportReference[],
    referencesLabel: string,
    _accessedLabel: string,
    _locale: string,
  ): { section: string; indexMapping: Map<number, number> } {
    if (references.length === 0)
      return { section: "", indexMapping: new Map<number, number>() };

    // Normalize entries to the shape expected by reference pipeline utilities
    let refEntries = references
      .filter((r) => r.url)
      .map((r, i) => ({
        index: r.index ?? i + 1,
        title: r.title,
        url: r.url,
        domain: r.domain ?? null,
        accessedAt: r.accessDate ? new Date(r.accessDate) : undefined,
      }));

    const beforeCount = refEntries.length;

    refEntries = filterJunkReferences(refEntries);
    refEntries = decodeUrlEntities(refEntries);
    refEntries = upgradeHttpToHttps(refEntries);

    const { deduplicated, indexMapping } = deduplicateReferencesByUrl(
      refEntries as Parameters<typeof deduplicateReferencesByUrl>[0],
    );
    refEntries = deduplicated as typeof refEntries;

    if (refEntries.length < beforeCount) {
      this.logger.log(
        `[buildReferencesSection] Reference cleanup: ${beforeCount} → ${refEntries.length} (removed ${beforeCount - refEntries.length} junk/duplicate references)`,
      );
    }

    if (refEntries.length === 0)
      return { section: "", indexMapping: new Map<number, number>() };

    const refLines = refEntries.map((e) => {
      // Escape brackets in title to avoid breaking markdown link syntax
      const safeTitle = e.title.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
      return `[${e.index}] [${safeTitle}](${e.url})${e.domain ? `. ${e.domain}` : ""}`;
    });

    let section = `\n\n---\n\n## ${referencesLabel}\n\n${refLines.join("\n\n")}`;

    // Apply citation index remapping to the references section itself
    if (indexMapping.size > 0) {
      section = remapCitationIndices(section, indexMapping);
    }

    // NOTE: anchorReferences disabled — produces HTML <a id> that ReactMarkdown
    // renders as literal text (no rehypeRaw). stripHtmlCitationLinks cleans up.
    // section = anchorReferences(section);

    return { section, indexMapping };
  }
}
