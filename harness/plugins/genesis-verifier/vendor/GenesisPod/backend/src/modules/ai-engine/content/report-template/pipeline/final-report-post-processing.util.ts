/**
 * postProcessFinalReport — TI 沉淀的 full-report 后处理管线
 *
 * 原属 `{app}/services/report/report-assembler.service.ts:postProcessFinalReport`
 * 类方法。2026-04-30 (REPORT QUALITY OVERHAUL) 晋升到 ai-engine 层，
 * 让 TI / consumer / 任何 ai-app 都能调同一份。
 *
 * 与 `formatDimensionContent` 的分工：
 *   - `formatDimensionContent`: 单维章节装配前清洗（会 strip H1/H2，per-dimension 用）
 *   - `postProcessFinalReport`: 整篇 fullMarkdown 装配后清洗（保留 H1/H2 章节标题）
 *
 * 流程（与 TI 同序，详见 mission 4fd5efa1 报告问题清单）：
 *   ① quality-gate 自动修复 OR 最小清洗（HR + bold limit）
 *   ② 残留分隔线 / figure 占位符 / LLM meta-notes 清理
 *   ③ 列表 / 表格 / blockquote / wall-of-text / pseudo-code 修复
 *   ④ 启发式标题提升（detectAndPromoteHeadings —— 修「mid-line glued ##」）
 *   ⑤ 章节合并 / 空标题清理 / 全局 renumberHeadings
 *   ⑥ Bold / 引用 / 来源标签 / 装饰瘦身
 *   ⑦ 第三道铁墙：sanitize 白名单 + marketing 替换 + bold pairs 修复 + 排序词去 bold
 */
import {
  bulletifyBlockquoteItems,
  boldSummaryPrefixes,
  cleanupEmptyBullets,
  clearBrokenMediaAndEmptyBlocks,
  collapsePseudoCodeHeadings,
  collapseExcessSubHeadings,
  decodeHtmlEntities,
  deduplicateAdjacentCitations,
  deduplicateHeadingEcho,
  deduplicateIdenticalSections,
  deduplicateTerminalSections,
  detectAndPromoteHeadings,
  enforceExecSummarySections,
  ensureBlankLineAfterTables,
  escapeLatexPipeInTables,
  extractTableFootnotes,
  fixDoubleSourceLabels,
  limitBoldFormatting,
  mergeAdjacentMathBlocks,
  mergeUndersizedSections,
  normalizeArrowNotation,
  normalizeInformalTerms,
  normalizeInlineDoubleDollar,
  normalizeSourceLabels,
  removeEmptyHeadings,
  removeHorizontalRules,
  renumberHeadings,
  repairBrokenBoldMarkers,
  repairBrokenListItems,
  repairMarkdownTables,
  repairOrderedListContinuity,
  repairTruncatedBlockquoteBullets,
  separateTrappedConclusions,
  splitEnumerationToList,
  splitWallOfText,
  stripChapterHighlights,
  stripCitationsFromHeadings,
  stripFigureComments,
  stripHtmlCitationLinks,
  stripInternalFigureNotation,
  stripLeakedHtmlComments,
  stripLLMMetaNotes,
  truncateLongListItems,
  wrapBareDisplayMath,
  wrapPseudoCodeBlocks,
} from "./report-formatting.util";
import {
  convertOrdinalBulletsToParagraphs,
  normalizeBoldStyle,
  repairBrokenBoldPairs,
  replaceMarketingLanguage,
  sanitizeSectionOutput,
  stripCitationStacking,
  stripLeadingBulletLists,
} from "../../../llm/output/sanitization/sanitize-output.utils";

/**
 * Quality gate interface (decoupled from any specific service implementation).
 *
 * `postProcessFinalReport` accepts an optional gate that follows this shape so
 * both consumer (`@/modules/ai-harness/facade` ReportQualityGateService) and
 * TI's own gate adapter can be passed in.
 */
export interface PostProcessQualityGate {
  validateFullReport: (
    content: string,
    targetLanguage: string,
  ) => {
    violations: { rule: string; message: string }[];
    fixedContent: string;
    wasAutoFixed: boolean;
    passed: boolean;
  };
}

export interface PostProcessFinalReportResult {
  content: string;
  warnings: string[];
}

export interface PostProcessFinalReportOptions {
  /** "zh" | "en" — language hint for quality gate rules. */
  language?: string;
  /** Optional quality gate; when omitted minimal cleanup is applied. */
  qualityGate?: PostProcessQualityGate;
  /** Logger sink (defaults: warn → console.warn / error → console.error). */
  logger?: {
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
  };
}

export function postProcessFinalReport(
  markdown: string,
  options: PostProcessFinalReportOptions = {},
): PostProcessFinalReportResult {
  const { language = "zh", qualityGate, logger } = options;
  const log = {
    warn: (m: string) => (logger?.warn ?? console.warn)(m),
    error: (m: string) => (logger?.error ?? console.error)(m),
  };
  const warnings: string[] = [];
  let content = markdown;

  // ★ Snapshot: count $$$ before any processing to track formula damage
  const triplesBefore = (content.match(/\$\$\$/g) || []).length;
  if (triplesBefore > 0) {
    log.warn(
      `[postProcessFinalReport] INPUT already has ${triplesBefore} $$$ — damage originated upstream`,
    );
  }

  if (qualityGate) {
    const qc = qualityGate.validateFullReport(content, language);
    warnings.push(...qc.violations.map((v) => v.message));
    content = qc.wasAutoFixed ? qc.fixedContent : content;
  } else {
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

  // Stray --- separators
  content = content.replace(/\n---\n/g, "\n\n");
  // Residual figure placeholders
  content = content.replace(/<!--\s*figure:\d+:\d+\s*-->/g, "");
  content = content.replace(/&lt;!--\s*figure:\d+:\d+\s*--&gt;/g, "");
  // Internal figure notation / LLM meta-notes
  content = stripInternalFigureNotation(content);
  content = stripLLMMetaNotes(content);
  // Repair fragments
  content = repairTruncatedBlockquoteBullets(content);
  content = decodeHtmlEntities(content);
  content = fixDoubleSourceLabels(content);
  content = repairBrokenListItems(content);
  content = clearBrokenMediaAndEmptyBlocks(content);
  content = repairMarkdownTables(content);
  content = ensureBlankLineAfterTables(content);
  content = extractTableFootnotes(content);
  content = splitWallOfText(content);
  // ★ Critical for mission 4fd5efa1 mid-line H2 issue
  content = detectAndPromoteHeadings(content);
  content = deduplicateHeadingEcho(content);
  content = repairOrderedListContinuity(content);
  content = collapsePseudoCodeHeadings(content);
  // Bold-only line → ### heading（在装饰瘦身之前）
  content = content.replace(
    /^(\*\*([^*]+)\*\*)\s*$/gm,
    (_match, _full, inner: string) => `### ${inner.trim()}`,
  );
  // Double ### headings: ### 2.1. ### Title → ### 2.1. Title
  content = content.replace(/^(###\s+\d+\.\d+\.?\s+)###\s+/gm, "$1");
  // Empty []
  content = content.replace(/\[\s*\](?!\[)/g, "");
  // Triple+ blank lines
  content = content.replace(/\n{3,}/g, "\n\n");
  // Pseudocode blocks
  content = wrapPseudoCodeBlocks(content);
  // Sub-heading caps
  content = collapseExcessSubHeadings(content, 8);
  content = mergeUndersizedSections(content, 500);
  content = removeEmptyHeadings(content);
  content = renumberHeadings(content);
  content = truncateLongListItems(content);
  content = separateTrappedConclusions(content);
  content = enforceExecSummarySections(content);
  content = mergeAdjacentMathBlocks(content);
  content = normalizeArrowNotation(content);
  content = stripLeakedHtmlComments(content);
  content = deduplicateAdjacentCitations(content);
  content = bulletifyBlockquoteItems(content);
  content = splitEnumerationToList(content);
  content = cleanupEmptyBullets(content);
  content = boldSummaryPrefixes(content);
  content = repairBrokenBoldMarkers(content);
  content = stripFigureComments(content);
  content = escapeLatexPipeInTables(content);
  content = normalizeInlineDoubleDollar(content);
  content = stripChapterHighlights(content);
  content = renumberHeadings(content);
  content = stripHtmlCitationLinks(content);
  content = stripCitationsFromHeadings(content);
  content = wrapBareDisplayMath(content);
  content = normalizeInformalTerms(content);
  content = normalizeSourceLabels(content);
  content = deduplicateTerminalSections(content);
  content = deduplicateIdenticalSections(content);

  const deepHeadingCount = (content.match(/^#{5,6}\s+/gm) ?? []).length;
  if (deepHeadingCount > 0) {
    warnings.push(
      `Deep headings (h5/h6) count ${deepHeadingCount}, should be 0`,
    );
  }

  // ★ 第三道铁墙：终极兜底清理（sanitize-output 工具）
  content = stripLeadingBulletLists(content);
  content = sanitizeSectionOutput(content);
  content = stripCitationStacking(content);
  content = replaceMarketingLanguage(content);
  content = repairBrokenBoldPairs(content);
  content = normalizeBoldStyle(content);
  content = convertOrdinalBulletsToParagraphs(content);

  // Table cell alignment fix
  content = content.replace(/^(\|[\s:]*-+):\s*\|/gm, "$1 |");
  // 4+ blank lines → 3
  content = content.replace(/\n{4,}/g, "\n\n\n");

  if (warnings.length > 0) {
    log.warn(
      `[postProcessFinalReport] Quality fixes/warnings:\n${warnings.join("\n")}`,
    );
  }

  // ★ Safety net: detect formula damage
  const triplesAfter = (content.match(/\$\$\$/g) || []).length;
  if (triplesAfter > 0 && triplesAfter > triplesBefore) {
    log.error(
      `[postProcessFinalReport] FORMULA DAMAGE DETECTED: $$$ count ${triplesBefore} → ${triplesAfter} (+${triplesAfter - triplesBefore})`,
    );
  }

  return { content, warnings };
}
