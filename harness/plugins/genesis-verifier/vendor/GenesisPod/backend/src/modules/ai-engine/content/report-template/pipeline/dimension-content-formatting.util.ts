/**
 * Unified Formatting Pipeline
 *
 * Single entry point for all dimension content formatting. Replaces the
 * previous two-pipeline approach (preprocessDimensionContent + processDimensionContent).
 *
 * Usage:
 *   - Storage time: `formatDimensionContent(content, { dimIndex })`
 *   - Assembly time: `formatDimensionContent(content, { dimIndex, globalSeenParagraphs, ... })`
 *   - Legacy:       `preprocessDimensionContent(content, dimIndex)`
 */

import {
  stripChapterHighlights,
  convertChineseNumeralHeadings,
  detectAndPromoteHeadings,
  sanitizeHeadingLevels,
  deduplicateHeadings,
  deduplicateHeadingEcho,
  collapsePseudoCodeHeadings,
  numberSubHeadings,
  hierarchicalNumberBoldListItems,
  convertDescriptiveListsToBullets,
  convertPlainNumberedListsUnderH3ToBullets,
  stripLLMMetaNotes,
  stripLeakedHtmlComments,
  stripInternalFigureNotation,
  normalizeArrowNotation,
  fixArrowChains,
  deduplicateAdjacentCitations,
  deduplicateParagraphs,
  truncateAtSentenceBoundary,
  repairTruncatedBlockquoteBullets,
  decodeHtmlEntities,
  fixDoubleSourceLabels,
  fixDuplicateHeadings,
  removeEmptySections,
  repairBrokenListItems,
  clearBrokenMediaAndEmptyBlocks,
  repairMarkdownTables,
  extractTableFootnotes,
  splitWallOfText,
  wrapPseudoCodeBlocks,
  collapseExcessSubHeadings,
  removeEmptyHeadings,
  renumberHeadings,
  truncateLongListItems,
  separateTrappedConclusions,
  bulletifyBlockquoteItems,
  splitEnumerationToList,
  cleanupEmptyBullets,
  boldSummaryPrefixes,
  removeHorizontalRules,
  repairBrokenBoldMarkers,
  stripFigureComments,
  wrapBareInlineLatex,
  wrapProseStyleMath,
  escapeLatexPipeInTables,
  normalizeInlineDoubleDollar,
  normalizeChapterToSection,
  mergeTelegramParagraphs,
} from "./report-formatting.util";

// ============ Context Interface ============

/**
 * Context for the unified formatting pipeline.
 *
 * All fields are optional — when omitted, context-dependent rules are skipped.
 * This allows the same pipeline to serve both storage-time (minimal context)
 * and assembly-time (full context) use cases.
 */
export interface FormattingContext {
  /** Dimension index (0-based). When provided, enables heading numbering. */
  dimIndex?: number;
  /** Shared set for cross-dimension paragraph dedup. */
  globalSeenParagraphs?: Set<string>;
  /** Per-dimension character limit. When exceeded, truncation is applied. */
  maxDimensionChars?: number;
  /** Dimension name for logging. */
  dimensionName?: string;
  /**
   * Callback to resolve chart placeholders (<!-- figure:N:M --> → chart HTML).
   * Provided by ReportAssemblerService which owns the chart injection logic.
   */
  resolveChartPlaceholders?: (content: string) => string;
  /** Logger for warnings (e.g., truncation). */
  logger?: { warn: (msg: string) => void };
}

// ============ Unified Pipeline ============

/**
 * Unified dimension content formatting pipeline.
 *
 * Replaces the previous two-pipeline approach:
 *   - `preprocessDimensionContent()` (storage-time, no context)
 *   - `processDimensionContent()` (assembly-time, with context)
 *
 * Now a single function with optional context. Rules that need context
 * (dimIndex, globalSeenParagraphs, etc.) are skipped when context is absent.
 *
 * @param content  Raw dimension content (markdown)
 * @param ctx      Optional formatting context
 */
export function formatDimensionContent(
  content: string,
  ctx: FormattingContext = {},
): string {
  let processed = content;

  // ── Phase 0: Content-level cleanup (before structure normalization) ──
  processed = stripHeadingSummaryBullets(processed);
  processed = convertOrdinalBulletsToText(processed);
  processed = fixLLMLatexCorruption(processed);

  // ── Phase 1: Structure normalization ──────────────────────────────────
  processed = stripChapterHighlights(processed);
  processed = removeHallucinatedImages(processed);
  processed = convertChineseNumeralHeadings(processed);
  processed = detectAndPromoteHeadings(processed);
  processed = sanitizeHeadingLevels(processed);
  processed = deduplicateHeadings(processed);
  processed = deduplicateHeadingEcho(processed);
  processed = collapsePseudoCodeHeadings(processed);

  // ── Phase 2: Context-dependent numbering (requires dimIndex) ─────────
  if (ctx.dimIndex !== undefined) {
    processed = numberSubHeadings(processed, ctx.dimIndex + 1);
    processed = hierarchicalNumberBoldListItems(processed);
  }

  // ── Phase 3: Content cleanup ─────────────────────────────────────────
  processed = normalizeChapterToSection(processed);
  processed = convertDescriptiveListsToBullets(processed);
  processed = convertPlainNumberedListsUnderH3ToBullets(processed);
  processed = stripLLMMetaNotes(processed);
  processed = mergeTelegramParagraphs(processed);
  processed = stripLeakedHtmlComments(processed);
  processed = stripInternalFigureNotation(processed);
  processed = normalizeArrowNotation(processed);
  processed = fixArrowChains(processed);
  processed = deduplicateAdjacentCitations(processed);

  // ── Phase 4: Context-dependent operations ────────────────────────────
  if (ctx.globalSeenParagraphs) {
    processed = deduplicateParagraphs(processed, ctx.globalSeenParagraphs);
  }
  if (ctx.maxDimensionChars && processed.length > ctx.maxDimensionChars) {
    ctx.logger?.warn(
      `[formatDimensionContent] Dimension "${ctx.dimensionName ?? "unknown"}" content too long (${processed.length} chars), truncating to ${ctx.maxDimensionChars}`,
    );
    processed = truncateAtSentenceBoundary(processed, ctx.maxDimensionChars);
  }
  if (ctx.resolveChartPlaceholders) {
    processed = ctx.resolveChartPlaceholders(processed);
  }

  // ── Phase 5: Formatting repair ───────────────────────────────────────
  processed = repairTruncatedBlockquoteBullets(processed);
  processed = decodeHtmlEntities(processed);
  processed = fixDoubleSourceLabels(processed);
  processed = fixDuplicateHeadings(processed);
  processed = removeEmptySections(processed);
  processed = repairBrokenListItems(processed);
  processed = clearBrokenMediaAndEmptyBlocks(processed);
  processed = repairMarkdownTables(processed);
  processed = normalizeTableDataRows(processed);
  processed = extractTableFootnotes(processed);
  processed = splitWallOfText(processed);
  processed = wrapPseudoCodeBlocks(processed);
  processed = collapseExcessSubHeadings(processed, 8);
  processed = removeEmptyHeadings(processed);
  processed = truncateLongListItems(processed);
  processed = separateTrappedConclusions(processed);
  processed = bulletifyBlockquoteItems(processed);
  processed = splitEnumerationToList(processed);
  processed = cleanupEmptyBullets(processed);
  processed = removeHorizontalRules(processed);
  processed = stripFigureComments(processed);
  // Note: stripOrphanedChartComments is NOT called here — chart comments
  // (<!-- chart:xxx -->) are valid markers used by the frontend to position
  // figures. They are only stripped in the frontend renderer (chapter view)
  // when no charts data is available for a given chapter.
  processed = escapeLatexPipeInTables(processed);
  // ── LaTeX wrapping must run BEFORE boldSummaryPrefixes ──
  // boldSummaryPrefixes captures `$` and `\` into bold markers, corrupting
  // math delimiters. Wrapping first ensures `$...$` are in place before
  // any bold formatting touches the line.
  //
  // ★ ORDER MATTERS: wrapBareInlineLatex MUST run BEFORE wrapProseStyleMath.
  // wrapBareInlineLatex handles full LaTeX commands (\frac, \sqrt, etc.) and
  // wraps them as complete expressions. wrapProseStyleMath handles prose-style
  // subscripts (d_k, W_1) and must skip content already inside $...$. If the
  // order is reversed, wrapProseStyleMath wraps inner variables (e.g. d_k
  // inside \sqrt{d_k}) first, fragmenting the LaTeX expression and causing
  // KaTeX parse errors like \frac{} or \sqrt{}d_k}.
  processed = normalizeInlineDoubleDollar(processed);
  processed = wrapBareInlineLatex(processed);
  processed = wrapProseStyleMath(processed);
  processed = fixUnbalancedLatexDelimiters(processed);
  // ── Bold and repair AFTER LaTeX is safely delimited ──
  processed = boldSummaryPrefixes(processed);
  processed = repairBrokenBoldMarkers(processed);
  processed = removeOrphanedFigureReferences(processed);
  // Reference-style markdown images: ![alt][figure:N] — internal figure refs
  processed = processed.replace(/!\[[^\]]*\]\[[^\]]*\]/g, "");
  // ★ Strip orphaned chart comments when no chart resolver is provided
  // These are <!-- chart:dN-sN-N:N --> markers that were not consumed by the chart resolver.
  // Without a resolver, they would leak into rendered content as visible HTML comments.
  if (!ctx.resolveChartPlaceholders) {
    processed = processed.replace(/<!--\s*chart:[^\s]+?\s*-->/g, "");
  }

  // ── Phase 5.5: Re-number headings to close gaps from removed headings ──
  if (ctx.dimIndex !== undefined) {
    processed = renumberHeadings(processed);
  }

  // ── Phase 5.8: Bold style normalization ─────────────────────────────
  // Strip bold from enumeration markers (第一/其一) and verbose leading phrases
  // (这意味着/核心原因在于) — runs at dimension level so chapter view also benefits.
  // Enumeration markers: **第一，** → 第一，
  processed = processed.replace(
    /\*\*(第[一二三四五六七八九十]|其[一二三四五六七八九十])[，,]?\*\*/g,
    (_, marker) => marker + "，",
  );
  // Verbose leading phrases: **这意味着，** → 这意味着，
  processed = processed.replace(
    /\*\*(这意味着|核心原因在于|值得警惕的是|值得注意的是|更关键的是|换言之|具体而言|总体而言|简言之)[，,：:]\*\*/g,
    (_, phrase) => phrase + "，",
  );

  // ── Phase 6: Final cleanup ───────────────────────────────────────────
  processed = processed.replace(/\n{3,}/g, "\n\n");

  return processed;
}

// ============ Phase 0 Functions ============

/**
 * Strip bullet-list summaries that immediately follow ### or #### headings.
 * LLMs generate 3-6 "key point" bullets before the actual prose content.
 *
 * Pattern detected:
 *   ### 1.1. Heading Title
 *
 *   - Short summary point 1。
 *   - Short summary point 2。
 *   - Short summary point 3。
 *
 *   Actual detailed content starts here...
 */
export function stripHeadingSummaryBullets(content: string): string {
  return content.replace(
    /^(#{3,4}\s+[^\n]+\n)\n?((?:[-*]\s+[^\n]{5,80}[。.]\n){2,8})\n/gm,
    "$1\n",
  );
}

/**
 * Convert bullets starting with ordinal markers (其一/其二/第一/第二)
 * or transition phrases (这意味着/值得...的是/换言之/因此) to plain paragraphs.
 * These are continuous prose that the LLM incorrectly formatted as bullet items.
 */
export function convertOrdinalBulletsToText(content: string): string {
  // Handle both plain and bold-wrapped markers: - 其一， / - **其一**
  return content.replace(
    /^[-*]\s+(\*{0,2}(?:其[一二三四五六七八九十]|第[一二三四五六七八九十]|一方面|另一方面|这意味着|这使得|这说明|这表明|这也意味|值得[^\s，]{0,4}的是|换言之|因此|对于|从[^\s]{0,4}角度|综合[^\s]{0,4}[，,]|结合[^\s]{0,4}[，,])\*{0,2})/gm,
    "$1",
  );
}

/**
 * Fix common LLM LaTeX corruption patterns:
 * 1. \$arg\max → \arg\max (escaped dollar before LaTeX command)
 * 2. \text{s.t.$ → \text{s.t.}$$ (incomplete text command)
 * 3. $U_i$($s_i$^*,...) → $U_i(s_i^*,...)$ (fragmented inline math)
 * 4. $$$ → $$ (triple dollar sign)
 */
export function fixLLMLatexCorruption(content: string): string {
  let result = content;
  // 1. Escaped dollar before LaTeX commands: \$arg → \arg, \$max → \max
  result = result.replace(
    /\\\$(arg|max|min|lim|sup|inf|log|exp|sin|cos|tan)/g,
    "\\$1",
  );
  // 2. Fix $$$ → $$ (triple dollar → display math delimiter)
  result = result.replace(/\${3}(?!\$)/g, "$$");
  // 3. Fix fragmented inline math: $X$($Y$^*,$Z$^*) → $X(Y^*, Z^*)$
  // Pattern: $var$( or $var$^ outside of $...$
  result = result.replace(
    /\$([A-Za-z_][A-Za-z0-9_{}\\]*)\$\((\$[^$]+\$(?:\^\*)?(?:,\s*\$[^$]+\$(?:\^\*)?)*)\)/g,
    (_, head, args) => {
      const cleanArgs = args.replace(/\$/g, "");
      return `$${head}(${cleanArgs})$`;
    },
  );
  // 4. Fix $)$ → )$  (closing paren trapped inside dollar)
  result = result.replace(/\$\)\$/g, ")$");
  return result;
}

// ============ Legacy Wrapper ============

/**
 * @deprecated Use `formatDimensionContent()` instead.
 *
 * Legacy wrapper that delegates to the unified pipeline without context.
 * Kept for backward compatibility with existing callsites.
 *
 * For new code, prefer `formatDimensionContent(content, { dimIndex })` to
 * get heading numbering and other context-dependent rules.
 */
export function preprocessDimensionContent(
  content: string,
  dimIndex?: number,
): string {
  return formatDimensionContent(
    content,
    dimIndex !== undefined ? { dimIndex } : {},
  );
}

// ============ New Formatting Rules ============

/**
 * Remove hallucinated markdown images (data URIs, placeholder domains, broken paths).
 *
 * ★ v2: 增强过滤 — 基于生产数据分析（2026-03-13），LLM 编造图片 URL 的模式：
 * - data: base64 URLs（占 93%）
 * - placeholder/example.com 域名
 * - 含 "xxxx" 的伪造 URL
 * - PDF 链接被误当图片
 * - /img/example-*, /images/sample-* 等通用路径模式
 */
function removeHallucinatedImages(content: string): string {
  let result = content;

  // ★ 2026-05-08 PR-4 (mission 843f6958 实证修): LLM 把图 URL inline 写到 markdown
  //   绕过 #fig-N 占位机制。无论 URL 是否真实，所有 ![FIG-N](xxx) 形式都剥掉
  //   (chapter-writer 严令禁止此用法，唯一图引用路径是 finalize.figureReferences)。
  result = result.replace(/!\[FIG-\d+[^\]]*\]\([^)]+\)/gi, "");

  // ★ 2026-05-08 PR-4: LLM 把 JSON 字段名当 XML 标签写出 — 整个标签连内容剥光
  result = result.replace(/<\/?figureReferences?>/gi, "");
  result = result.replace(
    /<figureReferences?>[\s\S]*?<\/figureReferences?>/gi,
    "",
  );
  // ★ 2026-05-08 PR-4: HTML <figure> 标签也是 LLM 误把图引用当 HTML 写的产物
  //   markdown 渲染管线下不该出现（图通过 figure component 由 #fig-N 渲染）
  result = result.replace(/<figure[^>]*>[\s\S]*?<\/figure>/gi, "");
  result = result.replace(/<\/?figure[^>]*>/gi, "");

  return result.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_match, _alt: string, url: string) => {
      const lower = url.toLowerCase();
      // Base64 data URLs
      if (lower.startsWith("data:")) return "";
      // Placeholder/example domains
      if (
        lower.includes("placeholder.com") ||
        lower.includes("example.com") ||
        lower.includes("via.placeholder")
      )
        return "";
      // Error indicator paths
      if (lower.includes("image-not-found") || lower.includes("no-image"))
        return "";
      // ★ 2026-05-08 PR-4 (mission 843f6958): LLM 把 prompt 提示语当 url 写
      //   `![](FIG-1位置由figureReferences控制)` —— 这种"非 URL 文字"剥掉。
      //   原 line 356 已用 `!startsWith('http')` 剥光所有非 HTTP url，保留兜底。
      // 保留 #fig-N 占位（这是 reportAssembler 注入的合法占位）
      if (lower.startsWith("#fig-") || lower.startsWith("#fig_")) return _match;
      // Non-HTTP URLs (relative paths, file://, etc.)
      if (!lower.startsWith("http://") && !lower.startsWith("https://"))
        return "";
      // ★ Fabricated URLs with "xxxx" patterns
      if (lower.includes("xxxx")) return "";
      // ★ PDF links misidentified as images
      if (/\.pdf(\?|$)/i.test(url)) return "";
      // ★ Generic example/sample image paths (LLM common fabrication patterns)
      if (
        /\/img\/example[-_]/i.test(url) ||
        /\/images?\/(sample|placeholder|dummy|test)[-_]/i.test(url)
      )
        return "";
      return _match;
    },
  );
}

/**
 * Normalize table data rows to match the column count of the separator row.
 *
 * After `repairMarkdownTables` ensures a valid separator, this function
 * fixes data rows that have too few or too many columns:
 *   - Short rows: pad with empty cells
 *   - Long rows: truncate excess columns
 */
export function normalizeTableDataRows(content: string): string {
  return content.replace(
    /((?:^\|[^\n]+\|\s*\n){3,})/gm,
    (tableBlock: string) => {
      const lines = tableBlock.trimEnd().split("\n");
      if (lines.length < 3) return tableBlock;

      // Find separator row to determine expected column count
      const isSeparator = (line: string) =>
        /^\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(line.trim());

      let sepIndex = -1;
      for (let i = 0; i < Math.min(lines.length, 3); i++) {
        if (isSeparator(lines[i])) {
          sepIndex = i;
          break;
        }
      }
      if (sepIndex < 0) return tableBlock;

      const expectedCols = (lines[sepIndex].match(/\|/g) || []).length - 1;
      if (expectedCols < 1) return tableBlock;

      let changed = false;
      for (let i = 0; i < lines.length; i++) {
        if (i === sepIndex) continue;
        const line = lines[i].trim();
        if (!line.startsWith("|") || !line.endsWith("|")) continue;

        const cells = line.slice(1, -1).split("|");
        if (cells.length === expectedCols) continue;

        changed = true;
        if (cells.length < expectedCols) {
          // Pad with empty cells
          while (cells.length < expectedCols) cells.push(" ");
        } else {
          // Truncate excess columns
          cells.length = expectedCols;
        }
        lines[i] = "| " + cells.join(" | ") + " |";
      }

      return changed ? lines.join("\n") + "\n" : tableBlock;
    },
  );
}

/**
 * Remove orphaned figure/chart references from text.
 *
 * AI often generates "如图1所示" / "as shown in Figure 1" / "(见图3)" but
 * no corresponding figure data exists. These orphaned references confuse readers.
 *
 * Only removes parenthetical/inline references. Preserves heading-level captions
 * and lines that contain chart placeholder comments (<!-- chart:... -->).
 */
export function removeOrphanedFigureReferences(content: string): string {
  return (
    content
      // "如图N所示" / "如图 N 所示" → ""
      .replace(/如图\s*\d+\s*所示[，,。；]?/g, "")
      // "(见图N)" / "（见图N）" → ""
      .replace(/[（(]见图\s*\d+[）)][，,。；]?/g, "")
      // "图N展示(了)" / "图N显示" (subject-position Chinese) → ""
      .replace(
        /图\s*\d+\s*(?:展示了?|显示了?|呈现了?|描述了?|说明了?|反映了?|列出了?|对比了?|总结了?|汇总了?|概括了?|给出了?|提供了?|揭示了?)/g,
        "",
      )
      // "(Figure N)" / "(Fig. N)" → ""
      .replace(/\((?:Figure|Fig\.?)\s*\d+\)/gi, "")
      // "as shown in Figure N" / "as illustrated in Figure N" → ""
      .replace(
        /[,，]?\s*as\s+(?:shown|illustrated|depicted|presented|seen)\s+in\s+(?:Figure|Fig\.?)\s*\d+/gi,
        "",
      )
      // "Figure N shows/illustrates/presents..." (subject-position English) → ""
      .replace(
        /(?:Figure|Fig\.?)\s*\d+\s+(?:shows?|illustrates?|presents?|depicts?|displays?|demonstrates?|summarizes?)\s*/gi,
        "",
      )
      // Inline "see Figure N" at end of sentence → ""
      .replace(/[,，]\s*(?:see|参见)\s+(?:Figure|Fig\.?)\s*\d+/gi, "")
      // Clean up double spaces left by removals
      .replace(/ {2,}/g, " ")
  );
}

/**
 * Fix unbalanced LaTeX inline delimiters on a line.
 *
 * Detects lines with an odd number of `$` (excluding `$$` display math)
 * and attempts to close or remove the orphan delimiter.
 *
 * Strategy:
 *   - Opening `$` with LaTeX content after it → find closing boundary
 *     at Chinese char or Chinese punctuation (NOT whitespace — LaTeX
 *     expressions like `$\alpha = 0.95$` contain spaces).
 *   - Orphan `$` with no LaTeX content (no backslash) → remove it.
 */
export function fixUnbalancedLatexDelimiters(content: string): string {
  let inCodeBlock = false;
  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      // Track fenced code blocks (``` ... ```)
      if (trimmed.startsWith("```")) {
        inCodeBlock = !inCodeBlock;
        return line;
      }
      // Skip everything inside code blocks, display math, headings, table rows
      if (
        inCodeBlock ||
        trimmed.startsWith("$$") ||
        /^#{1,6}\s/.test(trimmed) ||
        trimmed.startsWith("|")
      ) {
        return line;
      }

      // Count single $ (not $$)
      const withoutDisplay = line.replace(/\$\$/g, "\x00");
      const dollarCount = (withoutDisplay.match(/\$/g) || []).length;

      if (dollarCount % 2 !== 0) {
        const lastIdx = line.lastIndexOf("$");
        const before = line.slice(0, lastIdx);
        const after = line.slice(lastIdx + 1);

        // Determine if this is an opening $ (LaTeX content follows)
        const hasLatexAfter = /\\[a-zA-Z]/.test(after);
        const hasLatexBefore = /\\[a-zA-Z]/.test(before);

        if (hasLatexAfter) {
          // Opening $ without closing — find boundary at Chinese char/punctuation
          // Do NOT treat ASCII space as boundary (LaTeX has spaces: $\alpha = 0.95$)
          const endMatch = after.match(/[\u4e00-\u9fff，。；：、！？]/);
          if (endMatch?.index !== undefined && endMatch.index > 0) {
            return (
              line.slice(0, lastIdx + 1 + endMatch.index) +
              "$" +
              line.slice(lastIdx + 1 + endMatch.index)
            );
          }
          // No Chinese boundary — close at EOL
          return line + "$";
        }

        // Orphan $ with no LaTeX content after it — remove it
        // Also handle: content before has LaTeX (closing $ was misplaced)
        if (!hasLatexAfter && !hasLatexBefore) {
          // Stray $ with no LaTeX anywhere near it — just remove
          return before + after;
        }

        // LaTeX is before this $ but nothing after — likely a misplaced closing $
        // Remove it (the LaTeX was already closed or wrapped by wrapBareInlineLatex)
        return before + after;
      }

      return line;
    })
    .join("\n");
}
