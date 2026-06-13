/**
 * Shared report formatting utilities.
 *
 * Extracted from report-synthesis.service.ts and report-generator.service.ts
 * to eliminate code duplication (both files had identical private methods).
 */

/**
 * Heading level safety net: removes # and ## lines (which AI should not use
 * in detailedContent — they are report-level titles, not section headings).
 * Leaves ### and #### untouched for numberSubHeadings to process.
 *
 * Paired with prompt instruction HEADING_HIERARCHY that tells AI:
 * "Use ### and #### only. # and ## are reserved for the report framework."
 *
 * Previously this demoted H1/H2 → H3, but that caused report titles like
 * "# 市场分析报告" to become numbered subheadings (e.g. "### 3.1. 市场分析报告").
 * Now H1/H2 lines are stripped entirely — their content is redundant with
 * the report/dimension title already present in the framework.
 */
export function sanitizeHeadingLevels(content: string): string {
  return (
    content
      // Strip H1/H2 (report-level titles that AI should not use in detailedContent)
      .replace(/^#{1,2}\s+.*$/gm, "")
      // Strip H5/H6 (prompt forbids them; LLM sometimes generates ##### for figure captions)
      .replace(/^#{5,6}\s+.*$/gm, "")
  );
  // ### and #### are preserved as-is for numberSubHeadings to process.
}

/**
 * Give dimension sub-headings hierarchical numbering.
 *
 * ### Title → ### N.M. Title   (from AI's ###)
 * #### Title → #### N.M.K. Title (from AI's ####)
 *
 * Strips existing numbering prefixes:
 * - Arabic: "1. ", "1.2. ", "1.2.3. "
 * - Chinese ordinal: "一、", "十二．"
 * - Parenthesized: "（一）", "（1）"
 */
export function numberSubHeadings(content: string, dimIndex: number): string {
  let h3Count = 0;
  let h4Count = 0;

  return content.replace(
    /^(#{3,4})\s+(.+)$/gm,
    (_match, hashes: string, title: string) => {
      // Strip existing numbering prefixes but preserve 4-digit years (e.g. "2026年")
      const cleanTitle = title
        .replace(/^(?!\d{4}[年\-–—/至])[\d.]+\s*/, "")
        .replace(/^[IVXivx]+[.、）)]\s*/, "") // Roman numerals: III. / IV、
        .replace(/^[一二三四五六七八九十百]+[、．.]\s*/, "")
        .replace(/^（[一二三四五六七八九十百\d]+）\s*/, "")
        .replace(/^[A-Z][.、)]\s*/, "") // Letter prefixes: A. / B、/ C)
        .trim();

      // ★ C3: Guard — filter out non-title content incorrectly using heading syntax
      // 1. JSON content masquerading as heading → remove entire line
      if (/^\s*[\[{]/.test(cleanTitle)) {
        return "";
      }
      // 2. Long text with periods → not a title, demote to bold paragraph
      if (cleanTitle.length > 40 && /[。.]/.test(cleanTitle)) {
        return `**${cleanTitle}**`;
      }
      // 3. Chart/figure caption (starts with 图/表 + long text) → italic
      if (/^[图表]/.test(cleanTitle) && cleanTitle.length > 30) {
        return `*${cleanTitle}*`;
      }

      if (hashes === "###") {
        h3Count++;
        h4Count = 0;
        return `### ${dimIndex}.${h3Count}. ${cleanTitle}`;
      }
      if (hashes === "####") {
        if (h3Count === 0) h3Count = 1; // implicit parent when h4 appears before any h3
        h4Count++;
        return `#### ${dimIndex}.${h3Count}.${h4Count}. ${cleanTitle}`;
      }
      return `${hashes} ${title}`;
    },
  );
}

/**
 * Re-number ### and #### headings to close gaps after heading removal.
 *
 * After `removeEmptyHeadings` and `collapsePseudoCodeHeadings` remove headings,
 * numbered headings like ### 1.7 → ### 1.9 have gaps. This function re-assigns
 * sequential numbers within each ## dimension section.
 *
 * Handles three heading patterns:
 *   - ### N.M.  — standard sub-section headings
 *   - #### N.M. — legacy demoted headings (two-part, kept for compatibility)
 *   - #### N.M.K. — original sub-sub-section headings (three-part)
 *
 * Also re-numbers bold list items (1. **text**) under headings.
 *
 * Only affects headings that already have N.M. or N.M.K. numbering format.
 */
export function renumberHeadings(content: string): string {
  const lines = content.split("\n");
  let currentDim = 0; // current ## N. dimension index
  let h3Count = 0; // shared counter for ### N.M. and #### N.M. (demoted)
  let h4Count = 0; // counter for #### N.M.K. (three-part sub-sections)
  let boldListCounter = 0; // counter for bold list items under headings

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect ## N. dimension heading to track current dimension index
    const dimMatch = line.match(/^##\s+(\d+)\.\s+/);
    if (dimMatch) {
      currentDim = parseInt(dimMatch[1]);
      h3Count = 0;
      h4Count = 0;
      boldListCounter = 0;
      continue;
    }

    if (currentDim === 0) continue; // before first numbered dimension

    // Re-number ### N.M. headings
    const h3Match = line.match(/^###\s+\d+\.\d+\.?\s+(.+)$/);
    if (h3Match) {
      h3Count++;
      h4Count = 0;
      boldListCounter = 0;
      lines[i] = `### ${currentDim}.${h3Count}. ${h3Match[1]}`;
      continue;
    }

    // Re-number #### N.M.K. headings (three-part — check BEFORE two-part)
    const h4ThreePartMatch = line.match(/^####\s+\d+\.\d+\.\d+\.?\s+(.+)$/);
    if (h4ThreePartMatch) {
      if (h3Count === 0) h3Count = 1; // implicit parent when #### appears before any ###
      h4Count++;
      boldListCounter = 0;
      lines[i] =
        `#### ${currentDim}.${h3Count}.${h4Count}. ${h4ThreePartMatch[1]}`;
      continue;
    }

    // Re-number #### N.M. headings (two-part — continues the same h3 counter as ###)
    // Note: #### N.M. format can appear when LLM uses #### with only dim.sub numbering.
    // h3Count++ treats it as a sequential sub-section (sibling to ### headings).
    const h4TwoPartMatch = line.match(/^####\s+\d+\.\d+\.?\s+(.+)$/);
    if (h4TwoPartMatch) {
      h3Count++; // continues the same counter as ### headings
      h4Count = 0;
      boldListCounter = 0;
      lines[i] = `#### ${currentDim}.${h3Count}. ${h4TwoPartMatch[1]}`;
      continue;
    }

    // Re-number bold list items with hierarchical numbering (N.M.K. **text**).
    // Phase 1 (hierarchicalNumberBoldListItems) assigns numbers like 8.22.1.,
    // but Phase 2 heading renumbering may change 8.22 → 8.21. This pass
    // re-aligns bold items to match their current parent heading number.
    // Also handles plain "1. **text**" items that were never numbered.
    if (currentDim > 0 && h3Count > 0 && /^(?:\d+\.)+\s+\*\*/.test(line)) {
      boldListCounter++;
      lines[i] = line.replace(
        /^(?:\d+\.)+/,
        `${currentDim}.${h3Count}.${boldListCounter}.`,
      );
      continue;
    }

    // Convert plain (non-bold) numbered items under ### / #### headings to
    // bullet points. "1. Reformer：..." under heading "1.10." looks like a
    // numbering error; converting to "- Reformer：..." removes the ambiguity.
    if (currentDim > 0 && h3Count > 0 && /^\d+\.\s+[^*|]/.test(line)) {
      lines[i] = line.replace(/^\d+\.\s+/, "- ");
      continue;
    }

    // Any heading resets bold list tracking
    if (/^#{2,6}\s+/.test(line)) {
      boldListCounter = 0;
      // Non-numbered ## heading resets everything (跨维度关联分析, 风险评估, etc.)
      if (/^##\s+[^#]/.test(line)) {
        currentDim = 0;
        h3Count = 0;
        h4Count = 0;
      }
    }
  }

  return lines.join("\n");
}

/**
 * Renumber bold ordered list items within numbered ### sections
 * to follow hierarchical numbering.
 *
 * Under "### N.M. Title":
 *   "1. **Item**" → "N.M.1. **Item**"
 *   "2. **Item**" → "N.M.2. **Item**"
 *
 * Only affects list items starting with bold text (structural sub-items).
 * Regular list items (no bold) are left unchanged.
 *
 * Must be called AFTER numberSubHeadings (which creates the N.M. prefix).
 */
export function hierarchicalNumberBoldListItems(content: string): string {
  const lines = content.split("\n");
  let currentPrefix = ""; // e.g., "5.14"
  let listCounter = 0;
  let sectionHasH4 = false; // Track if current section has #### headings

  // Pre-scan: check if each ### section contains #### headings
  // If so, skip bold list renumbering in that section to avoid conflicts
  const h4Sections = new Set<string>();
  let scanPrefix = "";
  for (const line of lines) {
    const h3Match = line.match(/^###\s+(\d+\.\d+)\.\s+/);
    if (h3Match) {
      scanPrefix = h3Match[1];
    }
    if (scanPrefix && /^####\s+/.test(line)) {
      h4Sections.add(scanPrefix);
    }
  }

  return lines
    .map((line) => {
      // Track ### N.M. headings (output of numberSubHeadings)
      const h3Match = line.match(/^###\s+(\d+\.\d+)\.\s+/);
      if (h3Match) {
        currentPrefix = h3Match[1];
        listCounter = 0;
        sectionHasH4 = h4Sections.has(currentPrefix);
        return line;
      }

      // Track #### headings — they already have proper N.M.K. numbering
      if (/^#{4,}\s+/.test(line)) {
        listCounter = 0;
        return line;
      }

      // Match "N. **bold text**" pattern — structural sub-item
      // Skip renumbering if the section already has #### headings (avoids conflict)
      if (currentPrefix && !sectionHasH4 && /^\d+\.\s+\*\*/.test(line)) {
        listCounter++;
        return line.replace(/^\d+\./, `${currentPrefix}.${listCounter}.`);
      }

      return line;
    })
    .join("\n");
}

/**
 * Convert plain (non-bold) ordered list items under #### headings to unordered bullets.
 *
 * Under "#### N.M.K. Title", descriptive ordered lists like:
 *   1. First item
 *   2. Second item
 * look like hierarchical sub-section numbers (N.M.K.1, N.M.K.2) after processing.
 * Converting them to bullets avoids this ambiguity.
 *
 * Only converts non-bold items. Bold items (1. **Item**) are structural and stay numbered.
 */
export function convertDescriptiveListsToBullets(content: string): string {
  const lines = content.split("\n");
  let underH4 = false;

  return lines
    .map((line) => {
      // Track #### headings
      if (/^####\s+/.test(line)) {
        underH4 = true;
        return line;
      }
      // Track ### headings — reset since we're at a higher level
      if (/^###\s+[^#]/.test(line)) {
        underH4 = false;
        return line;
      }
      // Under ####: convert non-bold ordered items to bullets
      if (underH4 && /^\d+\.\s+[^*]/.test(line)) {
        return line.replace(/^\d+\.\s+/, "- ");
      }
      return line;
    })
    .join("\n");
}

/**
 * Cross-dimension paragraph deduplication.
 * Paragraphs sharing the first DEDUP_KEY_LENGTH characters are removed (keep first occurrence).
 * Headings, comments, list items, and blockquotes are exempt.
 */
export function deduplicateParagraphs(
  content: string,
  globalSeenParagraphs: Set<string>,
): string {
  const DEDUP_MIN_LENGTH = 60;
  const DEDUP_KEY_LENGTH = 120;
  const paragraphs = content.split("\n\n");

  return paragraphs
    .filter((p) => {
      const trimmed = p.trim();
      if (trimmed.length < DEDUP_MIN_LENGTH) return true;
      // Exempt headings, comments, list items, blockquotes
      if (/^(#|<!--|[-*>|]|\d+\.)/.test(trimmed)) return true;

      // Primary key: first 120 chars (exact match)
      const key = trimmed.substring(0, DEDUP_KEY_LENGTH);
      if (globalSeenParagraphs.has(key)) return false;

      // Secondary key: normalized (no punctuation/spaces) first 80 chars
      // Catches rephrased duplicates with minor wording changes
      const normalized = trimmed
        .replace(/[，。；：、""''（）\s]/g, "")
        .substring(0, 80);
      if (normalized.length >= 40) {
        const normKey = `~${normalized}`;
        if (globalSeenParagraphs.has(normKey)) return false;
        globalSeenParagraphs.add(normKey);
      }

      globalSeenParagraphs.add(key);
      return true;
    })
    .join("\n\n");
}

/**
 * Deduplicate headings: if two headings have the same normalized text, keep only the first.
 * AI sometimes generates "### 1. Title" followed by "### Title".
 */
export function deduplicateHeadings(content: string): string {
  const lines = content.split("\n");
  const seenHeadings = new Set<string>();

  return lines
    .filter((line) => {
      const m = line.match(/^#{3,6}\s+(.+)/);
      if (!m) return true;
      const normalized = m[1]
        .replace(/^(?:\d+\.)+\s*/, "")
        .replace(/^[一二三四五六七八九十百]+[、．.]\s*/, "")
        // Normalize all whitespace (spaces, ideographic spaces) to single space
        // so "OpenAI的GPT" and "OpenAI 的 GPT" are treated as the same heading
        .replace(/\s+/g, "")
        .trim();
      if (seenHeadings.has(normalized)) return false;
      seenHeadings.add(normalized);
      return true;
    })
    .join("\n");
}

// ============ v4: Language Consistency Detection ============

/**
 * Foreign language block detected in content
 */
export interface ForeignLanguageBlock {
  /** Start character offset */
  start: number;
  /** End character offset */
  end: number;
  /** The foreign text */
  text: string;
}

/**
 * Result of language consistency check
 */
export interface LanguageConsistencyResult {
  /** Ratio of foreign language content (0-1) */
  foreignRatio: number;
  /** Foreign language blocks found */
  blocks: ForeignLanguageBlock[];
  /** Whether the content passes the threshold */
  passed: boolean;
}

/**
 * Detect foreign language blocks in content relative to target language.
 *
 * For Chinese target: detects continuous Latin-script passages (>= 80 chars)
 * For English target: detects continuous CJK passages (>= 40 chars)
 *
 * Excludes:
 * - Code blocks (```...```)
 * - Inline code (`...`)
 * - URLs (http://, https://)
 * - Citation markers ([1], [2])
 * - Chart/figure comments (<!-- ... -->)
 * - Known technical terms and proper nouns (short runs)
 *
 * @param content The report content (Markdown)
 * @param targetLanguage Target language code ("zh" or "en")
 * @param threshold Maximum allowed foreign ratio (default 0.05 = 5%)
 */
export function detectForeignLanguageBlocks(
  content: string,
  targetLanguage: string = "zh",
  threshold: number = 0.05,
): LanguageConsistencyResult {
  // Strip code blocks and inline code first
  const stripped = content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/https?:\/\/[^\s)]+/g, "")
    .replace(/\[[\d,\s]+\]/g, ""); // citation markers like [1], [1,2]

  const blocks: ForeignLanguageBlock[] = [];
  const totalChars = stripped.replace(/\s/g, "").length;

  if (totalChars === 0) {
    return { foreignRatio: 0, blocks: [], passed: true };
  }

  if (
    targetLanguage === "zh" ||
    targetLanguage === "zh-CN" ||
    targetLanguage === "zh-TW"
  ) {
    // For Chinese target: find long Latin-script runs
    // Match continuous ASCII letter sequences (with spaces/punctuation) >= 80 chars
    const latinPattern = /[A-Za-z][A-Za-z\s,.:;'"!?()\-]{79,}/g;
    let match: RegExpExecArray | null;
    while ((match = latinPattern.exec(stripped)) !== null) {
      const text = match[0].trim();
      // Skip if it's mostly short technical terms (average word length < 10 and < 5 words)
      const words = text.split(/\s+/);
      if (words.length < 5) continue;

      blocks.push({
        start: match.index,
        end: match.index + match[0].length,
        text: text.length > 200 ? text.substring(0, 200) + "..." : text,
      });
    }
  } else if (targetLanguage === "en") {
    // For English target: find long CJK runs
    const cjkPattern = /[\u4e00-\u9fff\u3400-\u4dbf]{40,}/g;
    let match: RegExpExecArray | null;
    while ((match = cjkPattern.exec(stripped)) !== null) {
      blocks.push({
        start: match.index,
        end: match.index + match[0].length,
        text:
          match[0].length > 200 ? match[0].substring(0, 200) + "..." : match[0],
      });
    }
  }

  const foreignChars = blocks.reduce((sum, b) => sum + (b.end - b.start), 0);
  const foreignRatio = foreignChars / totalChars;

  return {
    foreignRatio,
    blocks,
    passed: foreignRatio <= threshold,
  };
}

/**
 * Remove excessive bold formatting.
 * If bold count exceeds maxPerSection per section, strip extra bolds.
 *
 * Bold markers on hierarchical numbered list items (e.g. "1.2.3. **Title**")
 * are structural and are never stripped regardless of the count.
 */
export function limitBoldFormatting(
  content: string,
  maxPerSection: number = 2,
): string {
  const sections = content.split(/(?=^###\s)/m);

  return sections
    .map((section) => {
      let boldCount = 0;
      return section.replace(/\*\*([^*]+)\*\*/g, (match, inner, offset) => {
        // Preserve bold on hierarchical numbered list items (e.g. "1.2.3. **Title**")
        const beforeMatch = section.substring(
          Math.max(0, section.lastIndexOf("\n", offset) + 1),
          offset,
        );
        if (/^\d+(\.\d+)*\.\s*$/.test(beforeMatch.trim())) {
          return match;
        }
        boldCount++;
        if (boldCount > maxPerSection) {
          return inner;
        }
        return match;
      });
    })
    .join("");
}

/**
 * Remove blockquote lines that exceed the limit.
 * Keeps the first `maxCount` blockquotes, converts excess to regular paragraphs.
 */
export function limitBlockquotes(
  content: string,
  maxCount: number = 8,
  maxCharsPerBlock: number = 120,
): string {
  let count = 0;
  return content.replace(/^>\s*(.+)$/gm, (match, inner: string) => {
    count++;
    if (count > maxCount) {
      return inner; // Convert to regular paragraph
    }
    // Truncate overly long blockquotes at sentence boundary
    if (inner.length > maxCharsPerBlock) {
      const sentencePattern = /[。！？；]\s*|[.!?]\s+/g;
      let lastEnd = -1;
      let m: RegExpExecArray | null;
      while ((m = sentencePattern.exec(inner)) !== null) {
        if (m.index + m[0].length <= maxCharsPerBlock) {
          lastEnd = m.index + m[0].length;
        }
      }
      if (lastEnd > 0) {
        return `> ${inner.substring(0, lastEnd).trim()}`;
      }
    }
    return match;
  });
}

/**
 * Remove all horizontal rules (---, ***) from content.
 * These are unprofessional in formal reports.
 */
export function removeHorizontalRules(content: string): string {
  return content.replace(/^\s*[-*]{3,}\s*$/gm, "");
}

/**
 * Strip raw markdown bold syntax (**text**) that wasn't converted to HTML.
 * Some LLM outputs contain mixed markdown + plain text where **bold** markers
 * leak through to the final rendered output.
 */
export function stripRawMarkdownInContent(content: string): string {
  // Only strip ** markers, keep the text inside
  return content.replace(/\*\*([^*]+)\*\*/g, "$1");
}

/**
 * Strip LLM-leaked meta-notes, internal markers, and broken HTML escapes.
 *
 * Unified implementation shared by report-synthesis and report-generator.
 * Rules must be GENERIC — they must work for any report topic/language.
 */
export function stripLLMMetaNotes(content: string): string {
  return (
    content
      // ── 字数统计（各种变体） ──
      .replace(/（精简字数[^）]*）/g, "")
      .replace(/（原\d+[^）]*）/g, "")
      .replace(/（[约共]\d+字）/g, "")
      .replace(/（总字数[约共]?\d+字）/g, "")
      .replace(/（\d+字）/g, "")
      .replace(/[（(]字数[：:]?\s*[约共]?\d+[字词][)）]/g, "")
      .replace(/[（(]当前字数[：:]?\s*\d+[)）]/g, "")
      .replace(/\[当前字数[：:]\s*\d+\]/g, "")
      .replace(/\(字数[^)]{0,30}\)/g, "")
      .replace(/（字数[^）]{0,30}）/g, "")
      // Bold-wrapped word count annotations: **字数约1350字（内部统计，不输出）**
      .replace(/\*{2}字数[约共]?\d+字[^*]*\*{2}/g, "")
      // Bare word count with internal note: 字数约1250字（内部统计，不输出）
      .replace(
        /字数[约：:]*\s*\d+字[（(][^）)]*(?:不输出|内部)[^）)]*[）)]/g,
        "",
      )
      // HTML bold word count: <strong>字数统计</strong>：约1120字 (appears in rendered output)
      // Also handles: **字数统计**：约 1250 字### (with trailing heading markers)
      .replace(/\*{2}字数统计\*{2}[：:]\s*[约共]?\d+\s*字[^\n]*\n?/g, "")
      // Bold total word count: **总字数约1050字** (standalone bold line)
      .replace(/^\s*\*{2}总字数[约共]?\d+字\*{2}\s*$/gm, "")
      // Bold-wrapped word count with internal note: **字数统计（内部参考）**: 约860字
      .replace(/\*{2}字数统计[^*]*\*{2}[：:]\s*[约共]?\d+字[^\n]*/g, "")
      // Fully bold-wrapped word count: **字数统计：约1150字（中文）** or **字数统计：约860字**
      .replace(/\*{2}字数统计[：:][^*]*\*{2}/g, "")
      // Bold word count with any label: **字数：约1200字** / **字数约1350字**
      .replace(/\*{2}字数[：:约][^*]*\*{2}/g, "")
      // Bare word count at line end: （当前字数: 1350）or [当前字数: 1350]
      .replace(/[（(【\[]?\s*当前字数\s*[：:]\s*\d+\s*[)）】\]]?/g, "")
      // Standalone word count line: 字数：约1350字 / 字数统计：约1050字
      .replace(/^\s*字数[统计]*[：:]\s*[约共]?\d+[字词]?\s*$/gm, "")
      // Standalone 字数统计 line with extra text: 字数统计：约1050字（含引用）
      .replace(/^[ \t]*字数统计[：:][^\n]*/gm, "")
      // Editorial word count compliance note (Gemini format): （字数统计已严格控制在要求范围内，...）
      .replace(/（字数统计已严格控制在[^）]{0,300}）/g, "")
      // Inline word count before closing paren: ...风险[49]。字数：128） → ...风险[49]）
      .replace(/[。.，,]?\s*字数[：:]\s*\d+(?=[)）])/g, "")
      // English variants
      .replace(/\(\s*word\s+count[:\s]*\d+\s*\)/gi, "")
      .replace(/\(\s*approximately\s+\d+\s+words?\s*\)/gi, "")
      // ── 内部角色名泄露（Leader, Agent 等多 Agent 流程术语） ──
      .replace(/Leader\s*(?:分配|提供|生成|指派|要求|指导|规划)的?/g, "")
      .replace(/(?:研究|分析)?Agent\s*(?:分配|指派|生成|提供)的/g, "")
      .replace(
        /基于\s*Leader\s*(?:指导|要求|分配|规划)(?:\s*(?:要求|指导))?[，,]?\s*/g,
        "",
      )
      .replace(
        /根据\s*Leader\s*(?:指导|要求|分配|规划)(?:\s*(?:要求|指导))?[，,]?\s*/g,
        "",
      )
      // ── 内部术语泄露 ──
      // "题设" 系列 — LLM 把 prompt 中的指令当作事实引用
      .replace(
        /题设\s*(?:要求|给出|指出|提出|说明|表明|规定|限定|明确)[^，。；\n]{0,30}[，。；]?\s*/g,
        "",
      )
      .replace(/(?:根据|按照|基于)\s*题设[，,]?\s*/g, "")
      // "给定题设中的..." / "题设中的..." — "题设" with "中的" connector
      // Only remove the "题设" prefix, preserving the noun that follows
      .replace(/(?:给定)?题设中的/g, "")
      // ── 主观第一人称表达 — 研究报告应使用客观叙述 ──
      // "我们认为" → "分析表明" / "我们判断" → "判断" etc.
      .replace(/我们认为[，,]?\s*/g, "")
      .replace(/我们判断[，,]?\s*/g, "")
      .replace(/我们预测[，,]?\s*/g, "")
      .replace(/我们建议[，,]?\s*/g, "")
      .replace(/我们观察到[，,]?\s*/g, "")
      .replace(/我们注意到[，,]?\s*/g, "")
      // ── 孤立的 "引用：" 标签 ──
      .replace(/^\s*引用[：:]\s*$/gm, "")
      // ── "[N 等M项]" 证据压缩格式泄露 ──
      // e.g. "[1 等5项]", "[50 等3项]", "[数据 等5项]"
      .replace(/\[[^\]]{1,10}\s*等\d+项\]/g, "")
      // "前置章节/前文/上文" 交叉引用 — 章节间不能有内部引用
      .replace(
        /(?:如|正如)?前置章节\s*(?:所述|提到|分析|讨论|指出|显示|表明|中)?[，,]?\s*/g,
        "",
      )
      .replace(
        /(?:如|正如)?(?:前文|上文|前述)\s*(?:所述|提到|分析|讨论|指出|显示|表明)[，,]?\s*/g,
        "",
      )
      .replace(/独立洞察[：:]/g, "")
      .replace(/需补充\d{4}\s*Q\d\s*企业报告验证/g, "")
      .replace(/(?:需|应)补充.*?(?:验证|数据|报告)/g, "")
      // ── "图表提示" editorial commentary — LLM internal figure placement reasoning ──
      // e.g. "图表提示图 30.TiDAR架构全流程图...可在本节相关段落后插入，用于强调..."
      .replace(/图表提示[^\n]*(?:\n(?!#{1,6}\s|\n)[^\n]+)*/g, "")
      // ── 数据支撑总结块（内部标注） ──
      .replace(/^数据支撑总结[：:].+$/gm, "")
      // ── 教材/课程类源语言泄露 ──
      .replace(/从学习路线图可见[，,]?/g, "")
      .replace(/(?:多模态)?课程常将/g, "研究表明")
      .replace(/数据与课程实践表明/g, "数据与实践表明")
      .replace(/在安全与对齐学习路线中/g, "在安全与对齐研究中")
      // ── LLM 元分析标记（**分析判断：** 等）──
      // These appear as raw markdown in rendered HTML and should be stripped.
      // Remove the bold marker and label, keep the analysis text.
      .replace(/\*{2}分析判断[：:]\*{2}\s*/g, "")
      .replace(/\*{2}总结[：:]\*{2}\s*/g, "")
      .replace(/\*{2}小结[：:]\*{2}\s*/g, "")
      .replace(/\*{2}结论[：:]\*{2}\s*/g, "")
      .replace(/\*{2}综合分析[：:]\*{2}\s*/g, "")
      .replace(/\*{2}综合判断[：:]\*{2}\s*/g, "")
      .replace(/\*{2}综上所述[：:]\*{2}\s*/g, "")
      .replace(/\*{2}要点[：:]\*{2}\s*/g, "")
      // Also handle HTML <strong> wrapped variants (post markdown→HTML conversion)
      .replace(
        /<strong>(?:分析判断|总结|小结|结论|综合分析|综合判断|综上所述|要点)[：:]<\/strong>\s*/g,
        "",
      )
      // ── 内部交叉引用占位符 ──
      // LLM generates [前文], [上文], [前述] as cross-references that are never resolved
      .replace(/\[前文\]/g, "")
      .replace(/\[上文\]/g, "")
      .replace(/\[前述\]/g, "")
      .replace(/\[详见前文\]/g, "")
      .replace(/\[见前文\]/g, "")
      // ── 转义 HTML 标签修复 ──
      // LLM sometimes outputs <\span>, <\strong> etc. instead of </span>, </strong>
      .replace(/<\\\/?(span|strong|em|p|div|li|ul|ol|a|h[1-6])>/gi, (m) =>
        m.replace(/\\/g, ""),
      )
      // ── LLM 过渡短语冗余（高频模板句式） ──
      // Remove only when they appear as sentence starters followed by comma/colon
      .replace(
        /(?:^|\n)\s*(?:综合来看|总体来看|综上所述|值得注意的是|值得警惕的是|需要指出的是|不可忽视的是|毋庸置疑)[，,：:]\s*/g,
        (m) => (m.startsWith("\n") ? "\n" : ""),
      )
      // ── 翻译伪影（中英拼接错误，如"代理ic layers"） ──
      // Pattern: Chinese word + English suffix (indicates broken translation)
      .replace(/代理ic\s*/g, "代理")
      .replace(/模型el\s*/g, "模型")
      .replace(/训练ing\s*/g, "训练")
      .replace(/推理ence\s*/g, "推理")
      .replace(/注意力tion\s*/g, "注意力")
      .replace(/嵌入ding\s*/g, "嵌入")
      // ── 教材/教程口吻残余 ──
      .replace(/在学习路线中[，,]?/g, "")
      .replace(/多模态课程[中内]?[，,]?/g, "")
      .replace(/从教程中可以看到[，,]?/g, "")
      .replace(/如教材所述[，,]?/g, "")
      // ── 图片不存在标注（LLM 标注图片缺失状态） ──
      .replace(
        /^\s*(?:图片没有|没有图片|图片缺失|无图片|图片不可用)[：:].+$/gm,
        "",
      )
      .replace(/^\s*\[?(?:图片没有|没有图片|图片缺失|无图片)\]?\s*$/gm, "")
      // ── 孤立的图片 Source 行（H5 图片标题被删后残留的来源标注） ──
      // Pattern: "Source: Some Title, Journal, 2024" 或 "来源：某某文献"
      // Length-limited to ≤150 chars to avoid stripping legitimate paragraphs starting with "来源："
      .replace(
        /^\s*(?:Source|来源|数据来源|图片来源)\s*[：:]\s*[^\n]{1,120}$/gm,
        "",
      )
      // ── "图表说明" 冗余叙述（LLM 为被删图片生成的解说段落） ──
      .replace(
        /^\s*(?:上述图表?|该图表?|此图表?)\s*(?:展示了|显示了|呈现了|描述了|说明了|反映了|概括了|揭示了|对比了?|突出了?|表明了?|印证了?|佐证了?|确认了?|证实了?|验证了?)[^。]*。\s*$/gm,
        "",
      )
      // ── 残留图片 URL 片段（如 ".avif)" ".webp)" ".png)" 单独出现在行尾） ──
      .replace(/^\s*\.(?:avif|webp|png|jpg|jpeg|gif|svg)\)\s*$/gm, "")
      // ── 孤立的 fenced code block 标记（LLM 有时泄漏 ```json / ``` 而不包含代码内容）──
      .replace(/^```(?:json|markdown|md|text|plain)?\s*$/gm, "")
      // ── 截断的"年"开头标题修复 ──
      // LLM 有时输出 "年视角下的..." / "年技术路线..." 作为独立标题（年份被截断）
      // Prepend current year dynamically
      .replace(
        /^(#{0,4}\s*)年(视角|技术路线|趋势|展望|演进|发展方向|模型|大模型)/gm,
        `$1${new Date().getFullYear()}年$2`,
      )
      // ── 清理多余空行 ──
      .replace(/\n{3,}/g, "\n\n")
      // ── LLM 章节元注释（引用分布统计等内部备注） ──
      // Pattern: （注：本章约1650字，严格基于证据...引用分布：[1] x3、[2] x2...）
      .replace(/[（(]\s*注[：:]\s*本[章节段][^）)]{0,200}[）)]/g, "")
      // Simpler variant: （注：...）at end of paragraph
      .replace(
        /\s*[（(]\s*注[：:][^）)]{0,150}引用分布[^）)]{0,100}[）)]\s*/g,
        "",
      )
      // ── LLM 内部推理泄露（字数+引用统计组合） ──
      // Pattern: （字数约1250字，引用 [279] [284] 多次，结合前置数据构建模型，确保至少6处引用实例。）
      // Key: contains 字数 + 引用 in the same parenthetical
      .replace(/\s*[（(][^）)]*字数[^）)]*引用[^）)]*[）)]\s*/g, "")
      // Pattern: （...确保至少N处引用...）or （...引用分布...）
      .replace(/\s*[（(][^）)]*确保[^）)]*引用[^）)]*[）)]\s*/g, "")
      // Pattern: （...结合前置数据...）
      .replace(/\s*[（(][^）)]*结合前置[^）)]*[）)]\s*/g, "")
      // ── LLM 内部编辑指令残留 ──
      .replace(/[（(]\s*不含[^）)]{0,30}[）)][。.]?\s*/g, "")
      // ── 字数统计泄漏（圆括号和方括号变体）──
      .replace(/\[字数约?\d+字?\]/g, "")
      .replace(/\[约?\d+字\]/g, "")
      // ── 图表/证据内部标签泄漏 ──
      .replace(
        /^\s*\*{0,2}以下是.*(?:图表|配置|证据|引用)[^。\n]*\*{0,2}[：:。.]?\s*$/gm,
        "",
      )
      // ── 占位符泄漏 ──
      .replace(/\[图表引用[^\]]*\]/g, "")
      .replace(/\[待[补定完][^\]]*\]/g, "")
      .replace(/\[TODO[^\]]*\]/gi, "")
      // ── 维度内总结句（段落开头的 "总之" "综上"） ──
      .replace(
        /^(?:总之|综上所述|总的来说|总而言之)[，,][^\n]{0,200}[。.]\s*$/gm,
        "",
      )
      // ── 孤立 JSON 符号 ──
      .replace(/^\s*[\]})]\s*$/gm, "")
      .replace(/^\s*\{\s*$/gm, "")
      // ── C2: 维度字数注释泄漏 ──
      .replace(/[（(]本维度[约共]?\d+字[)）]/g, "")
      // ── C2: LaTeX/JSON 位置碎片泄漏（如 `3paragraph_4$`） ──
      .replace(/\d*paragraph_\d+\$/g, "")
      // ── 三连空行压缩 ──
      .replace(/\n{3,}/g, "\n\n")
  );
}

// ============ Reference Cleanup Utilities ============

/**
 * Domains known to be irrelevant to research reports.
 * Entries are matched against the reference domain field.
 */
const JUNK_REFERENCE_DOMAINS: ReadonlySet<string> = new Set([
  "dollskill.com",
  "shein.com",
  "temu.com",
  "aliexpress.com",
  "amazon.com",
  "ebay.com",
  "etsy.com",
  "wish.com",
  "taobao.com",
  "jd.com",
  "pinduoduo.com",
  "pinterest.com",
  "instagram.com",
  "tiktok.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "reddit.com",
  "youtube.com",
  "bilibili.com",
  "douyin.com",
  "weibo.com",
  "zhihu.com",
]);

/**
 * Filter out junk references whose domain matches known irrelevant sites.
 * Generic: works for any topic by checking against a domain blacklist.
 */
// Titles containing these keywords are likely irrelevant to tech/AI research
const JUNK_TITLE_KEYWORDS = [
  "biopolymer",
  "microalgae",
  "agri-food",
  "brachytherapy",
  "petroleum",
  "drug discovery",
  "wearable body",
  "food packaging",
  "protein structure",
  "coral reef",
  "gene editing",
  "clinical trial",
  "hydrocarbon",
];

export function filterJunkReferences<
  T extends { domain?: string | null; url?: string; title?: string },
>(references: T[]): T[] {
  return references.filter((ref) => {
    // Domain-based filtering
    const domain = (
      ref.domain || extractDomainFromUrl(ref.url || "")
    )?.toLowerCase();
    if (domain) {
      for (const junk of JUNK_REFERENCE_DOMAINS) {
        if (domain === junk || domain.endsWith(`.${junk}`)) {
          return false;
        }
      }
    }
    // Title-based filtering (catch irrelevant academic papers)
    const titleLower = (ref.title || "").toLowerCase();
    if (titleLower.length > 10) {
      for (const keyword of JUNK_TITLE_KEYWORDS) {
        if (titleLower.includes(keyword)) return false;
      }
    }
    return true;
  });
}

/**
 * Deduplicate references by normalized URL.
 * When multiple references share the same URL, keep only the first occurrence.
 * Returns the filtered references and a mapping from old indices to new indices.
 */
export function deduplicateReferencesByUrl<
  T extends { url?: string; index?: number },
>(references: T[]): { deduplicated: T[]; indexMapping: Map<number, number> } {
  const seen = new Map<string, number>(); // normalizedUrl → first ref's NEW index
  const deduplicated: T[] = [];
  const indexMapping = new Map<number, number>(); // oldIndex → newIndex

  for (const ref of references) {
    const normalizedUrl = normalizeUrl(ref.url || "");
    const existingNewIndex = seen.get(normalizedUrl);
    if (existingNewIndex !== undefined) {
      // Map old index to the existing reference's new index
      if (ref.index !== undefined) {
        indexMapping.set(ref.index, existingNewIndex);
      }
    } else {
      const newIndex = deduplicated.length + 1;
      seen.set(normalizedUrl, newIndex);
      if (ref.index !== undefined) {
        indexMapping.set(ref.index, newIndex);
      }
      deduplicated.push({ ...ref, index: newIndex });
    }
  }

  return { deduplicated, indexMapping };
}

/**
 * Upgrade HTTP URLs to HTTPS where possible.
 * Skips localhost and IP addresses.
 */
export function upgradeHttpToHttps<T extends { url?: string }>(
  references: T[],
): T[] {
  return references.map((ref) => {
    if (!ref.url) return ref;
    const url = ref.url.trim();
    // Only upgrade http:// to https:// (skip localhost/IP)
    if (
      url.startsWith("http://") &&
      !url.startsWith("http://localhost") &&
      !url.startsWith("http://127.") &&
      !url.startsWith("http://192.168.") &&
      !url.startsWith("http://10.")
    ) {
      return { ...ref, url: url.replace(/^http:\/\//, "https://") };
    }
    return ref;
  });
}

/**
 * Decode HTML entities in URLs (e.g. &amp; → &).
 */
export function decodeUrlEntities<T extends { url?: string }>(
  references: T[],
): T[] {
  return references.map((ref) => {
    if (!ref.url) return ref;
    const decoded = ref.url
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    return decoded !== ref.url ? { ...ref, url: decoded } : ref;
  });
}

/**
 * Remap citation indices in report body text after reference deduplication.
 */
export function remapCitationIndices(
  content: string,
  indexMapping: Map<number, number>,
): string {
  if (indexMapping.size === 0) return content;
  return content.replace(/\[(\d+)\]/g, (match, numStr) => {
    const oldIndex = Number(numStr);
    const newIndex = indexMapping.get(oldIndex);
    return newIndex !== undefined ? `[${newIndex}]` : match;
  });
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.replace(/&amp;/g, "&"));
    // Normalize: lowercase host, remove trailing slash, remove www prefix
    // ★ 故意忽略 query string：utm_source/ocid 等追踪参数不影响文章唯一性
    const normalized = `${u.protocol}//${u.host.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`;
    return normalized.toLowerCase();
  } catch {
    return url
      .toLowerCase()
      .replace(/\/+$/, "")
      .replace(/^https?:\/\/www\./, "");
  }
}

function extractDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    const match = url.match(/\/\/([^/?#]+)/);
    return match ? match[1].replace(/^www\./, "") : "";
  }
}

/**
 * Repair broken ordered list continuity in markdown.
 *
 * LLMs often restart list numbering after interruptions (paragraphs, blockquotes,
 * code blocks between list items). This function re-numbers ordered list items
 * so they form continuous sequences within each section.
 *
 * Example:
 *   1. First item
 *   Some paragraph text
 *   1. Second item (should be 2.)
 *   1. Third item  (should be 3.)
 *
 * Resets counter at each ### heading boundary.
 */
export function repairOrderedListContinuity(content: string): string {
  const lines = content.split("\n");
  let lastListNum = 0; // last seen list item number
  let gapLines = 0; // non-list lines since last list item
  let blankLinesSinceLastItem = 0; // blank lines since last list item

  return lines
    .map((line) => {
      // Reset at heading boundaries (any level)
      if (/^#{1,6}\s+/.test(line)) {
        lastListNum = 0;
        gapLines = 0;
        blankLinesSinceLastItem = 0;
        return line;
      }

      // Track blank lines — a paragraph break (2+ blank lines or blank + non-list content)
      // indicates a new context, so treat as list boundary
      if (line.trim() === "") {
        if (lastListNum > 0) {
          blankLinesSinceLastItem++;
        }
        return line;
      }

      // Match simple ordered list item: "N. text" (not hierarchical "N.M.K. text")
      const listMatch = line.match(/^(\s*)(\d+)\.\s+(?!\d+\.)(.+)/);
      if (listMatch) {
        const currentNum = Number(listMatch[2]);

        // ★ v4.3: Improved boundary detection
        // A paragraph (non-list content) between list items means separate lists.
        // Only repair within truly contiguous list blocks (gap = 0 non-list lines,
        // and at most 1 blank line separating items).
        const isContinuation =
          lastListNum > 0 &&
          currentNum <= lastListNum &&
          gapLines === 0 &&
          blankLinesSinceLastItem <= 1;

        if (isContinuation) {
          lastListNum++;
          gapLines = 0;
          blankLinesSinceLastItem = 0;
          return `${listMatch[1]}${lastListNum}. ${listMatch[3]}`;
        }

        // Otherwise accept the number as-is (new list or correct continuation)
        lastListNum = currentNum;
        gapLines = 0;
        blankLinesSinceLastItem = 0;
        return line;
      }

      // Non-list, non-blank line — counts as paragraph gap
      if (lastListNum > 0) {
        gapLines++;
      }

      // Any non-list content or structural break → reset list tracking
      if (
        gapLines >= 1 ||
        /^\s*[-*]\s/.test(line) ||
        /^>\s/.test(line) ||
        /^---/.test(line)
      ) {
        lastListNum = 0;
        gapLines = 0;
        blankLinesSinceLastItem = 0;
      }

      return line;
    })
    .join("\n");
}

/**
 * Strip leaked internal figure/evidence notation from report content.
 *
 * AI sometimes copies internal notation patterns into prose text:
 * - [证据[N] 图M] — internal evidence+figure citation format
 * - 证据[N] — bare evidence reference (not standard [N] citation)
 * - Leader 提供的 — leaked multi-agent role name
 * - Orphan figure refs (图N展示, 见图N, 如图N所示) without corresponding
 *   <!-- chart:xxx --> placeholder nearby
 *
 * Must run AFTER resolveChartPlaceholders (which converts valid figure
 * placeholders to chart placeholders) so we only strip truly orphaned refs.
 */
export function stripInternalFigureNotation(content: string): string {
  return (
    content
      // ── [证据[N] 图M] full bracket notation ──
      // e.g. "[证据[5] 图2]" → "" or "[证据[45] 图0]" → ""
      .replace(/\[证据\s*\[[\d,\s]+\]\s*图\d+\]/g, "")

      // ── 证据[N] bare notation (not inside standard citation brackets) ──
      // Negative lookbehind: don't match if preceded by [ (which would be standard [N])
      .replace(/(?<!\[)证据\s*\[[\d,\s]+\]/g, "")

      // ── figureReferences JSON leak ──
      // LLM outputs raw internal metadata: "figureReferences:" followed by figure list
      // e.g. "figureReferences:\n- [145] 图0：事实性错误示例"
      // Remove the label and following list items (until next paragraph/heading)
      .replace(
        /(?:^|\n)\s*figureReferences\s*[：:]\s*(?:\n(?:[-*]\s*[^\n]+|\s*\[[^\]]+\]\s*[^\n]+))+/gim,
        "",
      )
      // Also handle inline/bold variant: "figureReferences: ..." or "**figureReferences**:"
      // Delete the entire line to prevent residual content
      .replace(/\*{0,2}figureReferences\*{0,2}\s*[：:]\s*[^\n]*/gi, "")
      // Same for other leaked JSON field names
      .replace(/\*{0,2}generatedCharts\*{0,2}\s*[：:]\s*[^\n]*/gi, "")
      .replace(/\*{0,2}keyFindings\*{0,2}\s*[：:]\s*[^\n]*/gi, "")

      // ── 图表引用 section label ──
      // LLM outputs "图表引用 ：" or "图表引用：" as a section label before figure references
      .replace(/(?:^|\n)\s*图表引用\s*[：:]\s*/gm, "\n")
      // Standalone "图表引用" or "**图表引用**" without colon (bold or plain, full line)
      .replace(/^\s*\*{0,2}图表引用\*{0,2}\s*$/gm, "")
      // Standalone "CHARTS" or "**CHARTS**" placeholder (bold or plain, full line)
      .replace(/^\s*\*{0,2}CHARTS\*{0,2}\s*$/gm, "")
      // Inline "**CHARTS**" or "**图表引用**" within a line (remove the token)
      .replace(/\*{2}CHARTS\*{2}/g, "")
      .replace(/\*{2}图表引用\*{2}/g, "")

      // ── "[FIG-N]: https://..." — Markdown reference-link definition ──
      // Must run BEFORE the broadened [FIG-N...] pattern below, which would
      // strip only the [FIG-N] part and leave an orphaned "]: url" residual.
      .replace(/^\s*\[FIG-\d+\]:\s*https?:\/\/[^\s]+\s*$/gm, "")

      // ── [figure: ...] internal figure allocation notation ──
      // LLM leaks allocation markers in various forms:
      //   [figure: FIG-5]  /  [figure: FIG-6]
      //   [figure:, position: afterparagraph_1]  /  [figure:, position: after$paragraph_1$]
      // Must run before FIG-N patterns below since [figure: FIG-N] contains FIG-N.
      .replace(/\[figure:[^\]]*\]/g, "")

      // ── [FIG-N...] with suffixes inside brackets ──
      // LLM sometimes adds Chinese text inside: [FIG-7后插入], [FIG-9后插入]
      // Broadened from exact [FIG-N] to allow any suffix before closing bracket.
      .replace(/\[FIG-\d+[^\]]*\]/g, "")

      // ── FIG-N internal figure ID references ──
      // LLM leaks internal figure registry IDs: FIG-1, FIG-15 etc.

      // ★ "FIG-N置于此处" placement notes — full line removal (must run before verb patterns)
      // e.g. "FIG-12置于此处，揭示美国公众对AI总体看法分化..."
      // Also handles bold-wrapped: "**FIG-13置于此处，直观呈现...**"
      .replace(/^\s*\*{0,2}FIG-\d+\s*置于此处[^\n]*\*{0,2}\s*$/gm, "")

      // ★ "*图：...（figureId: FIG-N）*" — italic figure description with figureId metadata
      .replace(/\*图[：:][^*]*?figureId\s*[：:]\s*FIG-\d+[^*]*\*/g, "")
      // ★ "（figureId: FIG-N）" / "(figureId: FIG-N)" — inline figureId metadata
      .replace(/[（(]figureId\s*[：:]\s*FIG-\d+[)）]/g, "")

      // ★ "**FIG-N**" — bold-wrapped standalone FIG refs (full line)
      .replace(/^\s*\*{2}FIG-\d+\*{2}\s*$/gm, "")

      // ★ "FIG-N和FIG-M共同说明" / "FIG-N与FIG-M" — conjunctive FIG refs
      // Remove "FIG-N和" or "FIG-N与" or "FIG-N及" prefix before another FIG ref
      .replace(/FIG-\d+(?:和|与|及)(?=FIG-\d+)/g, "")

      // "FIG-N所示" / "FIG-N展示" / "FIG-N显示" / "FIG-N反映" — figure ref with verb
      .replace(
        /FIG-\d+(?:所示|展示了?|显示了?|呈现了?|描绘了?|说明了?|中可[见知]|反映了?|揭示了?|强化了?|将|共同说明了?|共同展示了?|调查显示|汇总[^\s，,。.]*|评估[^\s，,。.]*|直观[^\s，,。.]*)[，,。.；;]?\s*/g,
        "",
      )
      // "（FIG-N）" / "(FIG-N)" — parenthesized FIG refs
      .replace(/[（(]FIG-\d+[)）]/g, "")
      // NOTE: "[FIG-N]" and "[FIG-N后插入]" are handled above by the broadened
      // \[FIG-\d+[^\]]*\] pattern near the top of the FIG-N section.
      // NOTE: "[FIG-N]: https://..." reference-link definition is also handled
      // above (before the broadened pattern) to prevent orphaned "]: url" residual.
      // "*图：FIG-N。描述...*" — italic-wrapped figure description lines
      .replace(/\*图[：:]FIG-\d+[^*]*\*/g, "")
      // "见FIG-N" / "参见FIG-N" / "详见FIG-N"
      .replace(/(?:见|参见|详见)FIG-\d+[，,。.；;]?\s*/g, "")
      // "如FIG-N所示" — natural language ref
      .replace(/如FIG-\d+所示[，,。.；;]?\s*/g, "")
      // Standalone FIG-N at line boundaries or surrounded by CJK/Latin punctuation
      .replace(/(?:^|[\s。.！!？?；;，,])FIG-\d+(?=[，,。.；;：:\s]|$)/gm, "")
      // "FIG-N: afterparagraph_4" — placement metadata (FIG-N + position hint)
      .replace(
        /^\s*FIG-\d+\s*[：:]\s*(?:after|before|inside|near|next)[\w_]*\s*$/gim,
        "",
      )
      // "图像 FIG-N 适合对应本节关于..." — editorial image placement notes (full line)
      .replace(/^\s*图像\s*FIG-\d+\s*(?:适合|对应|用于|放在|插入)[^\n]*$/gm, "")

      // ── Leader/Agent role name leakage in prose ──
      .replace(/Leader\s*提供的[""「]?/g, "")
      .replace(/(?:研究员?|分析员?)\s*提供的[""「]?/g, "")

      // ── 图片不存在标注 ──
      .replace(/^\s*(?:图片没有|没有图片|图片缺失|无图片)[：:][^\n]*$/gm, "")

      // ── 图0 references (0-based figure index leak) ──
      // LLM uses 0-based indexing: "图0：事实性错误示例" or "图0，佐证审查周期缩短"
      // These are internal figure indices, not rendered figure numbers.
      // Remove "图0" + following description (up to sentence boundary)
      .replace(/图0[：:][^\n。.]{0,60}[。.]?\s*/g, "")
      .replace(/图0[，,][^\n。.]{0,60}[。.]?\s*/g, "")

      // ── Orphan figure references ──
      // "图N:M..." — leaked evidence:figure index notation in prose (e.g., "图8:2直观描绘...")
      .replace(
        /图\d+:\d+(?:直观|确认|展示了?|描绘了?|呈现了?|显示了?|聚焦|说明了?|对比了?|可[见知])/g,
        "",
      )
      // "图N展示了..." / "图N聚焦..." / "图N显示..." — full sentence opener with figure
      .replace(
        /(?:^|\n)\s*图\d+(?:展示了?|聚焦|显示了?|呈现了?|直观呈现)[^\n]*(?:\n|$)/g,
        "\n",
      )
      // "（图N）" / "(图N)" — parenthesized figure refs
      .replace(/[（(]图\d+[)）]/g, "")
      // "见图N" / "参见图N" — inline orphan refs (but preserve "如图N所示" natural language refs)
      .replace(
        /(?:见|参见|详见)(?:下)?图\d+(?:所示|中|可知)?[，,。.；;]?\s*/g,
        "",
      )

      // ── Standalone figure title lines (rendered by FigureRenderer, redundant in body) ──
      // "图 2. Transformer变体优化与演进预测图" — full line with figure number + title
      .replace(/^[ \t]*图\s*\d+[.．。]\s*[^\n]+$/gm, "")
      // "图N:M..." — garbled evidence:figure index (e.g., "图10:0确认...")
      .replace(/图\d+:\d+[^\n]{0,50}/g, "")
      // "来源: 证据 [N]" / "来源：证据[N]" — source labels handled by FigureRenderer
      .replace(/^[ \t]*来源[：:]\s*证据\s*\[\d+\]\s*$/gm, "")

      // ── "Source:证据[N] 分配图片[N]" — combined internal source + allocation metadata ──
      // e.g. "Source:证据[2] 分配图片[262]" or "Source: 证据 [5] 分配图片 [100]"
      .replace(
        /^[ \t]*Source\s*[：:]\s*证据\s*\[[\d,\s]+\]\s*分配图片\s*\[\d+\]\s*$/gm,
        "",
      )

      // ── "Source:证据[N] 图M" — internal evidence+figure source notation leaked to caption ──
      // e.g. "Source: 证据[4] 图8" or "Source:证据[2] 图3"
      .replace(/^[ \t]*Source\s*[：:]\s*证据\s*\[[\d,\s]+\]\s*图\d+\s*$/gm, "")

      // ── "Source:分配图表[N]" — allocation metadata leaked as figure source ──
      // e.g. "Source:分配图表[127]" or "来源: 分配图表"
      .replace(
        /^[ \t]*(?:Source|来源)\s*[：:]\s*分配图表\s*(?:\[\d+\])?\s*$/gm,
        "",
      )
      // Inline "分配图表" in caption/alt text
      .replace(/(?:来源|Source)\s*[：:]\s*分配图表/g, "")

      // ── Raw figure/chart JSON arrays leaked into prose ──
      // LLM outputs complete JSON arrays like:
      //   [ { "figureId": "FIG-5", "position": "afterparagraph_1", "caption": "...", "url": "..." } ]
      //   [ { "figureId": "FIG-10", "type": "line", "title": "...", "data": {...} } ]
      // These should have been consumed by the chart resolver but may leak through.
      // Match: line starting with [ { "figureId" ... ending with } ]
      .replace(/\[\s*\{\s*"figureId"\s*:\s*"FIG-\d+"[\s\S]*?\}\s*\]/g, "")

      // ── "已分配图片/已分配的" — internal allocation language in prose ──
      // Only match when followed by figure/chart context words to avoid false positives
      // e.g. "已分配图片所示的..." or "已分配的架构图显示"
      .replace(/已分配图片(?:所示的?)?/g, "")
      .replace(/已分配的(?:架构图|示意图|图表?|图片|流程图)/g, "")

      // ── "分配图片[N]" — standalone allocation metadata ──
      .replace(/分配图片\s*\[\d+\]/g, "")

      // ── Clean up resulting artifacts ──
      // Double punctuation from removed notation
      .replace(/([，,。.；;])\s*\1/g, "$1")
      // Multiple spaces collapsed
      .replace(/ {2,}/g, " ")
      // Triple+ newlines collapsed
      .replace(/\n{3,}/g, "\n\n")
  );
}

/**
 * Fix common LLM LaTeX subscript omissions.
 *
 * Repair broken LaTeX commands that cause KaTeX parse errors.
 *
 * Fixes:
 * 1. Commands requiring braced arguments: `\bar X` → `\bar{X}`, `\hat x` → `\hat{x}`
 *    KaTeX requires `\bar{A}` form; bare `\bar A` causes "Unexpected end of input".
 * 2. Broken `$` delimiter pairing: `$...$，其中 $$\alpha$` → `$...$，其中 $\alpha$`
 *    LLM sometimes outputs `$...$` followed by `$$` as a new inline math block.
 * 3. Extra/missing braces: `\text{align}}` → `\text{align}`
 */
export function repairLatexCommands(content: string): string {
  let result = content;

  // Fix 1: LaTeX commands that require braced arguments but got a bare letter/word
  // e.g. \bar A → \bar{A}, \hat x → \hat{x}, \vec v → \vec{v}, \tilde n → \tilde{n}
  const BRACE_REQUIRED_CMDS =
    "bar|hat|vec|tilde|dot|ddot|overline|underline|widetilde|widehat|acute|grave|breve|check";
  const braceFixRe = new RegExp(
    `(\\\\(?:${BRACE_REQUIRED_CMDS}))\\s+([A-Za-z](?:_\\{[^}]*\\}|_[A-Za-z0-9])?)(?![{])`,
    "g",
  );
  result = result.replace(braceFixRe, "$1{$2}");

  // Fix 2: $$ delimiter repairs
  // ★ SAFETY: All Fix 2 patterns use callbacks instead of replacement strings
  //   to avoid JS regex `$1` backreference conflicts with literal `$` in content.
  //   Before applying any fix, we verify the `$$` is NOT the boundary between
  //   two well-formed inline math blocks (e.g., `$a$$b$` = `$a$` + `$b$`).

  // Helper: check if a `$$` at position `pos` in `text` is actually the
  // closing `$` of one inline block + opening `$` of the next.
  // Uses parity check: if number of `$` before the `$$` is odd, there's
  // an open inline block that this `$` would close.
  const isTwoBlockBoundary = (
    text: string,
    dollarDollarPos: number,
  ): boolean => {
    const before = text.substring(0, dollarDollarPos);
    // Count unescaped $ signs before the $$
    const dollarsBefore = (before.match(/(?<!\\)\$/g) || []).length;
    // Odd count means there's an open $...$ block ending at this position
    if (dollarsBefore % 2 === 0) return false;
    // The char just before $$ must not be whitespace — real formulas don't
    // end with a space before the closing $. e.g. `$L(N) $$` is a typo.
    if (dollarDollarPos > 0 && /\s/.test(text[dollarDollarPos - 1]))
      return false;
    // After the $$, check if there's a closing $ forming a second block
    const after = text.substring(dollarDollarPos + 2);
    const nextDollar = after.indexOf("$");
    if (nextDollar <= 0) return false;
    const innerAfter = after.substring(0, nextDollar);
    // Content must not contain newlines and must have LaTeX-like content
    return !innerAfter.includes("\n") && /\\[a-zA-Z]/.test(innerAfter);
  };

  // Fix 2d: `$mathContent $$\command rest$` → `$mathContent \command rest$`
  result = result.replace(
    /(\$[A-Za-z0-9(),.+\-=\s\\^_{}\[\]|]+)\$\$(\\[a-zA-Z])/g,
    (match, g1: string, g2: string, offset: number) => {
      if (isTwoBlockBoundary(result, offset + g1.length)) return match;
      return g1 + g2;
    },
  );

  // Fix 2a: `$formula$$,` → `$formula$,`
  result = result.replace(
    /(\$[^$\n]+)\$\$([^$\n\\])/g,
    (match, g1: string, g2: string, offset: number) => {
      if (isTwoBlockBoundary(result, offset + g1.length)) return match;
      return g1 + "$" + g2;
    },
  );

  // Fix 2b: `$...$<text>$$\alpha` → `$...$<text>$\alpha`
  result = result.replace(
    /(\$[^$\n]+\$)([^$\n]{1,30})\$\$(?![\n$])/g,
    (match, g1: string, g2: string, offset: number) => {
      const ddPos = offset + g1.length + g2.length;
      if (isTwoBlockBoundary(result, ddPos)) return match;
      return g1 + g2 + "$";
    },
  );

  // Fix 2c: Mid-line `L = $$\alpha` → `L = $\alpha`
  result = result.replace(
    /([^\n$]{2,})\$\$(?!\$)(\\[a-zA-Z])/g,
    (match, g1: string, g2: string, offset: number) => {
      if (isTwoBlockBoundary(result, offset + g1.length)) return match;
      return g1 + "$" + g2;
    },
  );

  // Fix 3: Stray double-closing braces after \text{...}} → \text{...}
  // ★ Exclude legitimate nesting: X_{\text{...}} or X^{\text{...}} where
  // the second } closes the outer _{...} or ^{...} group, not the \text.
  result = result.replace(/\\text\{([^}]*)\}\}/g, (match, inner, offset) => {
    // Count open/close braces in surrounding context to detect nesting
    const ctx = result.substring(
      Math.max(0, offset - 200),
      Math.min(result.length, offset + match.length + 200),
    );
    const opens = (ctx.match(/\{/g) || []).length;
    const closes = (ctx.match(/\}/g) || []).length;
    // Only strip the extra } when braces are genuinely unbalanced (more closes)
    if (closes > opens) {
      return `\\text{${inner}}`;
    }
    // Otherwise the second } belongs to an outer group — keep it
    return match;
  });

  // Fix 4: Unbalanced braces in inline math — auto-close missing }
  // e.g. `$\mathbb{R}^{n \times n$` → `$\mathbb{R}^{n \times n}$`
  // Note: escaped braces \{ and \} are NOT counted (they are literal in LaTeX)
  result = result.replace(/\$([^$\n]+)\$/g, (_match, inner: string) => {
    const opens = (inner.match(/(?<!\\)\{/g) || []).length;
    const closes = (inner.match(/(?<!\\)\}/g) || []).length;
    if (opens > closes) {
      return "$" + inner + "}".repeat(opens - closes) + "$";
    }
    return _match;
  });

  // Fix 5: \frac{...}${...} — LLM closed inline math before \frac's denominator
  // e.g. `$P(H|E) = \frac{P(E|H) P(H)}${P(E)}` → `$P(H|E) = \frac{P(E|H) P(H)}{P(E)}$`
  // Also handles \binom, \overset, \underset which take two brace arguments.
  result = result.replace(
    /(\$[^$\n]*\\(?:frac|binom|overset|underset)\{[^}]*\})\$\{([^}]*)\}/g,
    "$1{$2}$",
  );

  return result;
}

/**
 * LLMs frequently drop the `_` before `{` in subscript expressions:
 * - `\sum{i=1}` → `\sum_{i=1}`
 * - `\prod{k}` → `\prod_{k}`
 * - `\log p\theta(...)` → `\log p_\theta(...)`
 * - `r\phi(x, y)` → `r_\phi(x, y)`
 * - `\pi\theta(...)` → `\pi_\theta(...)`
 *
 * Also protects LaTeX `_` from being parsed as markdown italic by wrapping
 * bare LaTeX blocks in $ delimiters (handled by mergeAdjacentMathBlocks).
 */
export function fixLatexSubscripts(content: string): string {
  let result = content;

  // Fix: \sum{, \prod{, \int{ → add _ when content looks like subscript bounds
  // e.g. \sum{i=1} → \sum_{i=1}, \sum{k} → \sum_{k}, \sum{t \in T} → \sum_{t \in T}
  // Skip when already has _ before { or content doesn't look like bounds
  result = result.replace(
    /\\(sum|prod|int|lim|sup|inf|bigcup|bigcap)\{([^}]{1,30})\}/g,
    (match, op, inner) => {
      // Only convert if inner looks like a subscript: variable, index, set notation
      if (/^[a-z_\s=<>\\,\-+|∈0-9()]+$/i.test(inner)) {
        return `\\${op}_{${inner}}`;
      }
      return match;
    },
  );

  // Fix: \log p\theta → \log p_\theta (single letter before \command = subscript)
  // Also handles: r\phi, y\hat, etc.
  // Negative lookbehind prevents matching last letter of \commands (e.g. \exp\theta)
  result = result.replace(
    /(?<![a-zA-Z\\])([a-zA-Z])\\(theta|phi|psi|hat|tilde|bar)\b/g,
    "$1_\\$2",
  );

  // Fix: \pi\theta → \pi_\theta (command before \command as subscript parameter)
  // Common in RL notation: \pi_\theta, \pi_{\theta_0}
  result = result.replace(/\\(pi|mu|sigma)\\(theta|phi|psi)\b/g, "\\$1_\\$2");

  // Fix: y{ik}, x{t}, z{0} → y_{ik}, x_{t}, z_{0}
  // Single letter followed by { where inner content looks like a subscript
  result = result.replace(
    /(?<![a-zA-Z\\_{])([a-zA-Z])\{([a-z0-9,: ]{1,10})\}/g,
    (match, letter, inner) => {
      if (/^[a-z0-9,: _]+$/i.test(inner)) {
        return `${letter}_{${inner}}`;
      }
      return match;
    },
  );

  return result;
}

/**
 * Merge adjacent inline math blocks that the LLM fragmented.
 *
 * LLMs sometimes split a single math expression across multiple `$...$` blocks,
 * e.g. `$W_Q$ $\in$ $\mathbb{R}^{d}$` instead of `$W_Q \in \mathbb{R}^{d}$`.
 * KaTeX renders each fragment independently, which often breaks because
 * individual fragments like `\left(` or `\frac{` are incomplete.
 *
 * This function merges adjacent `$...$` blocks separated only by whitespace
 * into a single block, and also cleans up double-dollar `$$..$$` artifacts.
 *
 * Skips code blocks (``` and inline `). Does NOT touch `$$...$$` display math.
 */
export function mergeAdjacentMathBlocks(content: string): string {
  // Protect code blocks and inline code
  const codeBlocks: string[] = [];
  let result = content.replace(/```[\s\S]*?```/g, (m) => {
    codeBlocks.push(m);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });
  const inlineCodes: string[] = [];
  result = result.replace(/`[^`]+`/g, (m) => {
    inlineCodes.push(m);
    return `__INLINE_CODE_${inlineCodes.length - 1}__`;
  });

  // ── Phase -2: Fix broken LaTeX commands that cause KaTeX parse errors ──
  result = repairLatexCommands(result);

  // ── Phase -1: Fix LLM subscript omissions BEFORE wrapping ──
  result = fixLatexSubscripts(result);

  // ── Phase -0.5: Convert bracket display math \[...\] → $$...$$ ──
  // LLMs output display math as \[ ... \] on separate lines (LaTeX standard)
  // ★ 必须以 \ 开头（\\[）才匹配，否则会吞掉普通 [引用] 和 ## 标题
  // Multi-line variant: \[\n formula \n\]
  result = result.replace(
    /^\\\[\s*\n([\s\S]*?)\n\s*\\\]\s*$/gm,
    (_match, inner: string) => {
      // Only convert if content contains LaTeX commands
      if (/\\[a-zA-Z]/.test(inner)) {
        return `$$\n${inner.trim()}\n$$`;
      }
      return _match;
    },
  );

  // Single-line variant: \[ formula \]
  // ★ 必须以 \ 开头（\\[）才匹配
  result = result.replace(/\\\[\s*(.+?)\s*\\\]/g, (_match, inner: string) => {
    if (/\\[a-zA-Z]/.test(inner) && !/\]\s*\(/.test(_match)) {
      return `$$${inner.trim()}$$`;
    }
    return _match;
  });

  // ── Previous "Phase -0.3" guess-work removed 2026-04-17 ──
  // Earlier commits added Case A / B / C here to reverse-engineer misplaced
  // `$` delimiters from LLM output. Every pattern we fixed uncovered a new
  // one, and the regex-patching made the pipeline more fragile, not less.
  //
  // Proper fix is layered outside this file:
  //   1. LLM boundary: `validateLatexDelimiters` + single retry (A scheme)
  //      — rejects malformed output at the source.
  //   2. Frontend KaTeX: `throwOnError: false, strict: 'ignore'` (B scheme)
  //      — whatever leaks through renders the raw source in red instead of
  //        corrupting surrounding content via bad regex fixes.
  // See `src/common/utils/latex-delimiter-validator.ts` and
  // `frontend/lib/report/katexOptions.ts`.

  // ── Phase 0: Wrap bare LaTeX expressions that lack $...$ delimiters ────
  // Handles both standalone formula lines and inline bare LaTeX.

  // 0a. Standalone formula lines: entire line is a LaTeX expression (e.g. \text{Attention}(Q,K,V) = ...)
  // These lines start with \command or contain multiple \commands and no $ delimiters
  // Also handles \begin{...}...\end{...} environment blocks
  // Covers all commonly used LaTeX commands from LLM output
  result = result.replace(
    /^(\\(?:text|frac|sqrt|left|right|mathbb|mathcal|mathbf|mathrm|mathit|operatorname|begin|end|sum|prod|int|ell|log|ln|exp|sin|cos|tan|min|max|arg|sup|inf|lim|hat|tilde|bar|vec|dot|ddot|overline|underline|overbrace|underbrace|partial|nabla|infty|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|sigma|omega|phi|psi|pi|rho|tau|chi|zeta|eta|kappa|nu|xi|subset|supset|cup|cap|in|notin|forall|exists|neg|wedge|vee|oplus|otimes|approx|equiv|sim|propto|leq|geq|neq|ll|gg|pm|mp|times|div|cdot|ldots|cdots|vdots|ddots)\b[^\n]*[=≈≤≥<>±∓×·∈∉⊂⊃∀∃∼∝≡≠≪≫\+\-][^\n]*)$/gm,
    (line) => {
      // Skip if already has $ delimiters
      if (/\$/.test(line)) return line;
      return `$$${line}$$`;
    },
  );

  // 0a2b. Lines containing LaTeX commands but not starting with backslash
  // Handles lines like: "P \propto N^{\alpha}" or "Attention(Q,K,V) = softmax(\frac{QK^T}{\sqrt{d}})V"
  result = result.replace(
    /^([^\n$]*\\(?:text|frac|sqrt|left|right|mathbb|mathcal|mathbf|mathrm|operatorname|sum|prod|int|ell|log|hat|tilde|bar|vec|overline|partial|nabla|infty|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|sigma|omega|phi|psi|pi|rho|approx|equiv|sim|propto|leq|geq|neq|times|cdot|ldots|cdots)\b[^\n$]*)$/gm,
    (line) => {
      // Skip if already has $ delimiters
      if (/\$/.test(line)) return line;
      // Skip headings
      if (/^#{1,6}\s/.test(line)) return line;
      // Skip blockquotes
      if (/^>\s/.test(line)) return line;
      // Skip list items
      if (/^[-*]\s|^\d+\.\s/.test(line)) return line;
      // ★ Skip lines with significant natural language text (>50% non-LaTeX chars)
      // These are prose paragraphs that happen to mention a formula — don't wrap entire line
      const nonLatexChars = line
        .replace(/\\[a-zA-Z]+|[{}^_=+\-*/\\()]/g, "")
        .trim();
      if (nonLatexChars.length > line.length * 0.5) return line;
      return `$$${line}$$`;
    },
  );

  // 0a2. Multi-line LaTeX environments: \begin{pmatrix}...\end{pmatrix}, \begin{aligned}...\end{aligned}
  // Wrap entire environment in $$...$$ if not already wrapped
  result = result.replace(
    /(?<!\$\$?\s*\n?)^(\\begin\{(?:pmatrix|bmatrix|vmatrix|aligned|align|cases|array|matrix|gathered|equation)\}[\s\S]*?\\end\{\1\})$/gm,
    (match) => {
      if (/\$/.test(match)) return match;
      return `$$${match}$$`;
    },
  );
  // Fallback: non-anchored match for \begin...\end blocks
  result = result.replace(
    /(?<!\$)(\\begin\{(pmatrix|bmatrix|vmatrix|aligned|align|cases|array|matrix|gathered|equation)\}[\s\S]*?\\end\{\2\})(?!\$)/g,
    (match) => `$$${match}$$`,
  );

  // 0b. Standalone formula lines: Q = XW_Q,\quad K = XW_K,... pattern
  // ★ Use display math $$...$$ (not inline $...$) for standalone formula lines
  //   to avoid KaTeX inline-mode limitations with \text{} and other commands
  result = result.replace(
    /^([A-Z](?:_[A-Za-z])?\s*=\s*[A-Z][^\n]*\\(?:quad|,|;)[^\n]*)$/gm,
    (line) => {
      if (/\$/.test(line)) return line;
      return `$$${line}$$`;
    },
  );

  // 0c. Inline bare LaTeX: expressions containing \commands outside of $ delimiters
  // Match sequences like: h^{(m)} \in \mathbb{R}^{d_m} or O_i = \phi(Q_i) S
  // Strategy: find runs of LaTeX-like tokens not already inside $...$
  // ★ {1,} not {2,}: single-command expressions like "n \times n" must also be wrapped
  // ★ Safety: protect existing $...$ and $$...$$ blocks with slots BEFORE the bare-LaTeX
  //   wrapping regex runs. This prevents partial matches inside already-delimited math.
  //   Slots are restored immediately after this step.
  const mathSlots: string[] = [];
  const MATH_SLOT_PREFIX = "\uE010MATH";
  const MATH_SLOT_SUFFIX = "\uE011";
  result = result.replace(/\$\$[\s\S]*?\$\$/g, (m) => {
    mathSlots.push(m);
    return `${MATH_SLOT_PREFIX}${mathSlots.length - 1}${MATH_SLOT_SUFFIX}`;
  });
  result = result.replace(/\$(?!\$)(?:[^$\n]|\\\$)+\$/g, (m) => {
    mathSlots.push(m);
    return `${MATH_SLOT_PREFIX}${mathSlots.length - 1}${MATH_SLOT_SUFFIX}`;
  });

  result = result.replace(
    /(?<!\$)(?:[A-Za-z_]\^?\{[^}]*\}|\\(?:text|frac|sqrt|left|right|mathbb|phi|in|approx|times|quad|cdot|top|sum|infty|operatorname|mathcal|log|exp|max|min|lim|sup|inf|neq|leq|geq|sim|propto|forall|exists|partial|nabla|alpha|beta|gamma|delta|epsilon|lambda|mu|sigma|pi|omega|theta|eta|tau|Phi|psi|rho|xi|zeta|kappa)\b[^$\n]*){1,}(?!\$)/g,
    (match) => {
      // Skip if it's inside a markdown link or heading marker
      if (/^\[|^#/.test(match.trim())) return match;
      // Skip if already wrapped
      if (/^\$/.test(match.trim())) return match;
      // Skip very short matches (likely false positives)
      if (match.trim().length < 8) return match;
      return `$${match}$`;
    },
  );

  // Phase 0c-bis removed 2026-04-17 — replaced by A+B scheme (source-level
  // LaTeX validator + KaTeX graceful rendering). See comment in Phase -0.3.

  // Restore math slots immediately after bare-LaTeX wrapping
  const mathSlotRe = new RegExp(
    `${MATH_SLOT_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)${MATH_SLOT_SUFFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    "g",
  );
  result = result.replace(mathSlotRe, (_, i) => mathSlots[Number(i)]);

  // 0d. Simple bare complexity notations: O(n^2), O(n\sqrt{n}), O(n d_k d_v)
  // Also handles Unicode superscript: O(n²), O(n³)
  result = result.replace(
    /(?<!\$)\bO\(([^)]*[\\^_{}²³⁴⁵⁶⁷⁸⁹⁰ⁿ][^)]*)\)(?!\$)/g,
    (_match, inner) => {
      return `$O(${inner})$`;
    },
  );

  // ── Phase 0e: Deduplicate consecutive identical math expressions ──
  // LLM sometimes outputs the same formula as: raw text, $...$, $$...$$
  // Normalize and keep only the first $-wrapped version.
  // ★ [^$\n]+ prevents absorbing prose paragraphs between unrelated formulas
  result = result.replace(
    /(\$\$?[^$\n]+\$\$?)\s*\n\s*(\$\$?[^$\n]+\$\$?)/g,
    (match, first: string, second: string) => {
      const norm = (s: string) =>
        s
          .replace(/\$+/g, "")
          .replace(/\s+/g, "")
          .replace(/\\text\{([^}]+)\}/g, "$1");
      if (norm(first) === norm(second)) {
        // Keep the display math ($$) version if available, else keep first
        return second.startsWith("$$") ? second : first;
      }
      return match;
    },
  );

  // Merge adjacent $...$ blocks: $A$ $B$ → $A B$  (also handles $A$$B$)
  // Repeat until stable (merging 3+ consecutive blocks)
  let prev = "";
  while (prev !== result) {
    prev = result;
    result = result.replace(
      /\$([^$\n]+)\$ *\$([^$\n]+)\$/g,
      (_, a, b) => `$${a} ${b}$`,
    );
  }

  // Absorb dangling ^{...} or _{...} after a closing $
  // e.g. $\mathbb{R}$^{d_m} → $\mathbb{R}^{d_m}$
  //      $\theta$_{p,k}   → $\theta_{p,k}$
  // ★ [^$\n]+ prevents cross-line absorption when $ delimiters are orphaned
  result = result.replace(
    /\$([^$\n]+)\$(\^|_)\{([^}]*)\}/g,
    (_, inner, op, sub) => `$${inner}${op}{${sub}}$`,
  );

  // Absorb dangling bare text between $ blocks when it looks like LaTeX
  // e.g. $Q_i = $XW_Q^{(i)} → merge if the bare part has LaTeX-like chars
  // This is conservative: only merges when bare part has \ or ^ or _ or { or }
  prev = "";
  while (prev !== result) {
    prev = result;
    result = result.replace(
      /\$([^$\n]+)\$([^$\n]{1,40})\$([^$\n]+)\$/g,
      (match, a, between, b) => {
        // Only merge if the between text contains LaTeX-like characters
        if (/[\\^_{}]/.test(between)) {
          return `$${a}${between}${b}$`;
        }
        return match;
      },
    );
  }

  // Absorb trailing LaTeX-like text after closing $ (e.g. $...$\right)V)
  // Only when the trailing text starts with \ (LaTeX command)
  // ★ [^$\n]+ prevents cross-line absorption
  result = result.replace(
    /\$([^$\n]+)\$(\\(?:right|left|Big|big)[^$\s]*)/g,
    (_, inner, trail) => `$${inner}${trail}$`,
  );

  // ── Phase 2: Repair broken $ nesting ──
  // Fix cases like $S = $\phi(K)^\top $V$ → $S = \phi(K)^\top V$
  // Pattern: $ opens, inner $ re-opens without closing → remove inner $
  // ★ [^$\n]*? in all three capture groups prevents cross-line nesting repair
  result = result.replace(
    /\$([^$\n]*?)\$([^$\n]{0,5}\\[a-zA-Z]+[^$\n]*?)\$([^$\n]*?)\$/g,
    (match, a, between, b) => {
      // Only fix if between contains LaTeX-like content
      if (/[\\^_{}]/.test(between)) {
        return `$${a}${between}${b}$`;
      }
      return match;
    },
  );

  // Fix asymmetric display/inline delimiter pairs:
  //   $$formula$ → $$formula$$   (display math missing closing $$)
  //   $formula$$ → $$formula$$   (display math missing opening $$)
  // ★ [^$\n]+ prevents treating two orphaned $ on different lines as one pair,
  //   which was the root cause of }$} insertion damage (e.g. T_{\mathrm{ret}$})
  // ★ Replacement string: $$ = literal $, $1 = capture group.
  //   Correct: $$$$$1$$$$ = "$$" + "$1" + "$$" (5 $ + 1 + 4 $).
  //   Previous "$$$$$$1$$$$" (6 $ + 1 + 4 $) produced literal "$$$1$$" because
  //   the extra leading $$ paired off before $1, making it a literal "1".
  result = result.replace(/\$\$([^$\n]+)\$(?!\$)/g, "$$$$$1$$$$");
  result = result.replace(/(?<!\$)\$([^$\n]+)\$\$/g, "$$$$$1$$$$");

  // Fix unpaired $ in a line: odd number of $ suggests broken delimiters
  // Strategy: if a line has exactly 1 or 3 $ signs, it's likely broken
  result = result.replace(/^([^\n]*\$[^\n]*)$/gm, (line) => {
    const dollarCount = (line.match(/\$/g) || []).length;
    if (dollarCount % 2 !== 0 && dollarCount <= 3) {
      // Check if there's LaTeX content - if so, try to wrap the entire LaTeX expression
      const latexPattern = /\$([^$]*(?:\\[a-zA-Z]+[^$]*)+)$/;
      const m = line.match(latexPattern);
      if (m) {
        // Find where the LaTeX expression starts and add closing $
        return line + "$";
      }
    }
    return line;
  });

  // Restore protected sections
  result = result.replace(/__INLINE_CODE_(\d+)__/g, (_, i) => inlineCodes[i]);
  result = result.replace(/__CODE_BLOCK_(\d+)__/g, (_, i) => codeBlocks[i]);

  return result;
}

/**
 * Convert citation markers `[N]` in report body to clickable HTML anchor links.
 *
 * Transforms `[N]` → `<a href="#ref-N" class="citation-link">[N]</a>` so they
 * link to anchored references. Also handles comma-separated multi-citations:
 * `[1,2,3]` → individual links.
 *
 * Uses HTML `<a>` tags instead of markdown link syntax `[\[N\]](#ref-N)` to
 * avoid conflict with remark-math display math delimiters (`\[...\]`), which
 * would cause citation links to render as raw text when math is present.
 *
 * Safety:
 * - Only processes the body (before the references section)
 * - Skips `[N]` already part of a markdown link (`[N](url)`)
 * - Skips `[N]` inside code blocks
 */
export function linkifyCitations(content: string): string {
  // Split at references section to only process body
  // Support both "---\n\n# References" and plain "# References" (different builders use different formats)
  const refSectionPattern = /\n(?:---\n\n)?#\s*(?:参考文献|References)\s*\n/;
  const refMatch = content.match(refSectionPattern);
  if (refMatch?.index === undefined) return content;

  const body = content.substring(0, refMatch.index);
  const refSection = content.substring(refMatch.index);

  // Process single citations: [N] → <a href="#ref-N" class="citation-link">[N]</a>
  // Uses HTML <a> tags to avoid conflict with remark-math \[...\] display math delimiters.
  // Negative lookahead (?!\() ensures we don't touch existing markdown links [text](url)
  // Negative lookbehind (?<!\[) ensures we don't touch nested brackets [[N]]
  let linked = body.replace(
    /(?<!\[)\[(\d+)\](?!\()/g,
    (_match, num) => `<a href="#ref-${num}" class="citation-link">[${num}]</a>`,
  );

  // Process multi-citations: [1,2,3] → <a>[1]</a><a>[2]</a><a>[3]</a>
  linked = linked.replace(/\[((\d+),(\d[\d,]*))\](?!\()/g, (_match, _full) => {
    // Extract all numbers from the comma-separated list
    const nums = _full.split(",").map((s: string) => s.trim());
    return nums
      .map(
        (n: string) => `<a href="#ref-${n}" class="citation-link">[${n}]</a>`,
      )
      .join("");
  });

  return linked + refSection;
}

/**
 * Add anchor IDs to reference entries so citation links can target them.
 *
 * Converts:
 *   [1] Title. domain. url. 访问日期: date
 * To:
 *   <a id="ref-1"></a>[1] Title. domain. url. 访问日期: date
 */
export function anchorReferences(content: string): string {
  return content.replace(
    /^\[(\d+)\]\s/gm,
    (match, num) => `<a id="ref-${num}"></a>${match}`,
  );
}

/**
 * Strip HTML citation links back to plain `[N]` markers.
 *
 * ReactMarkdown (without rehypeRaw) renders `<a href>` as literal text.
 * This function reverses the effect of linkifyCitations / anchorReferences,
 * converting:
 *   `<a href="#ref-N" class="citation-link">[N]</a>` → `[N]`
 *   `<a id="ref-N"></a>` → `` (empty — anchor targets for references)
 *
 * Safe to apply multiple times (idempotent).
 */
export function stripHtmlCitationLinks(content: string): string {
  let result = content;
  // Strip citation links: <a href="#ref-N" class="citation-link">[N]</a> → [N]
  result = result.replace(
    /<a\s+href="#ref-\d+"\s+class="citation-link">\[(\d+)\]<\/a>/g,
    "[$1]",
  );
  // Strip reference anchor tags: <a id="ref-N"></a> → (nothing)
  result = result.replace(/<a\s+id="ref-\d+"><\/a>/g, "");
  return result;
}

/**
 * Strip citation markers from heading lines.
 *
 * LLM sometimes includes citations in heading text:
 *   #### 1.29. 演化路径包括三类[113][114]
 * These should be removed — citations belong in body text, not headings.
 */
export function stripCitationsFromHeadings(content: string): string {
  return content.replace(/^(#{2,6}\s+.+?)(?:\s*\[\d+\])+\s*$/gm, "$1");
}

/**
 * Wrap standalone LaTeX display-math lines in $$ delimiters.
 *
 * LLM sometimes outputs bare LaTeX formulas on their own lines:
 *   (blank line)
 *   p(y_t \mid y{<t}, x) = \mathrm{Softmax}(W_o h^D_t)
 *   (blank line)
 *
 * These need $$ wrapping for remark-math / rehype-katex to render them.
 * Only wraps lines that:
 *   - Contain at least one LaTeX command (\mathrm, \frac, \sum, etc.)
 *   - Are surrounded by blank/whitespace-only lines
 *   - Are NOT already inside $$ or code blocks
 */
export function wrapBareDisplayMath(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inCodeBlock = false;
  let inMathBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track code blocks
    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }
    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    // Track math blocks
    if (trimmed === "$$") {
      inMathBlock = !inMathBlock;
      result.push(line);
      continue;
    }
    if (inMathBlock) {
      result.push(line);
      continue;
    }

    // Check if this is a bare LaTeX line
    const hasLatexCommand =
      /\\(?:mathrm|frac|sum|prod|int|alpha|beta|gamma|delta|theta|phi|psi|sigma|omega|pi|lambda|mu|epsilon|log|exp|sqrt|mathbb|mathcal|text|left|right|quad|cdot|dots|ldots|cdots|operatorname|mid|leq|geq|neq|approx|infty|forall|exists|partial|nabla|times|begin|end)\b/.test(
        trimmed,
      );
    const isAlreadyWrapped =
      trimmed.startsWith("$") || trimmed.startsWith("$$");
    const isHeading = trimmed.startsWith("#");
    const isListOrBlockquote = /^[>|\-*\d]/.test(trimmed);
    const isTableRow = trimmed.startsWith("|");

    if (
      hasLatexCommand &&
      !isAlreadyWrapped &&
      !isHeading &&
      !isListOrBlockquote &&
      !isTableRow
    ) {
      // Check surrounding lines are blank/whitespace
      const prevBlank =
        i === 0 || lines[i - 1].trim() === "" || lines[i - 1].trim() === "$$";
      const nextBlank =
        i === lines.length - 1 ||
        lines[i + 1].trim() === "" ||
        lines[i + 1].trim() === "$$";

      // Also check: line should look like a formula, not prose with an inline command
      // A formula line is mostly math symbols, not mostly CJK/prose text
      const cjkChars = (trimmed.match(/[\u4e00-\u9fff]/g) || []).length;
      const isFormula = cjkChars < 5; // Allow a few CJK chars but mostly math

      if (prevBlank && nextBlank && isFormula) {
        result.push(`$$${trimmed}$$`);
        continue;
      }
    }

    result.push(line);
  }

  return result.join("\n");
}

/**
 * Wrap bare inline LaTeX commands that appear outside of `$...$` or `$$...$$`
 * delimiters. LLMs occasionally emit LaTeX commands like `\alpha_{ij}` or
 * `X \in \mathbb{R}^{n \times d}` without wrapping them in math delimiters,
 * which causes remark-math / rehype-katex to ignore them and renders them as
 * raw backslash text.
 *
 * Strategy (per line):
 *   1. Skip code blocks, display-math lines ($$), headings, table rows.
 *   2. Split the line by existing $...$ / $$...$$ regions.
 *   3. In non-math segments: find contiguous spans that contain known LaTeX
 *      commands and wrap each span in `$...$`.
 *   4. Re-join and return the line.
 *
 * Only targets lines with NO existing `$` delimiter (simplest, lowest risk).
 * Lines that already use `$` are left untouched to avoid double-wrapping.
 */
/**
 * Wrap prose-style math notation that uses subscripts, superscripts, or
 * known function names WITHOUT backslash prefixes.
 *
 * Targets patterns like:
 *   W_1, PE_{(pos,2i)}, head_i, QW_i^Q, d_{model}
 *   sin(x), cos(θ), log(n), FFN(x)
 *   Attention(Q,K,V)
 *
 * These are NOT LaTeX commands (no backslash) but are mathematical
 * notation that should be rendered as inline math.
 */
export function wrapProseStyleMath(content: string): string {
  // ── Pattern 1: variable with subscript and/or superscript ──
  // Matches: W_1, W_{model}, PE_{(pos,2i)}, head_i, QW_i^Q, d_k, b_1
  // Also matches superscript-only: R^d, x^{n+1}, e^{-x}, 10^{6}
  // Must start with a letter/digit, contain _ or ^, and have alphanumeric/brace content
  const SUBSCRIPT_RE =
    /(?<![$\\a-zA-Z])([A-Za-z0-9][A-Za-z0-9]*(?:(?:_(?:\{[^}]+\}|[A-Za-z0-9]))|(?:\^(?:\{[^}]+\}|[A-Za-z0-9])))(?:(?:_(?:\{[^}]+\}|[A-Za-z0-9]))|(?:\^(?:\{[^}]+\}|[A-Za-z0-9])))*)(?![a-zA-Z$])/g;

  // ── Pattern 2: prose function calls like sin(x), cos(θ), log(n) ──
  // Only match when NOT preceded by \ (which wrapBareInlineLatex handles)
  const PROSE_FUNC_RE =
    /(?<![$\\a-zA-Z])((?:sin|cos|tan|log|ln|exp|max|min|lim|inf|sup|softmax|Attention|Concat|FFN|ReLU|GELU|sigmoid|tanh)\s*\([^)]{1,80}\))(?![$])/g;

  // ── Pattern 3: expressions with = containing subscripts/superscripts ──
  // Like: PE_{(pos,2i)}=sin(pos/10000^{2i/d_{model}})
  // This catches full equations in prose math style
  const EQUATION_RE =
    /(?<![$])([A-Za-z][A-Za-z_{}0-9,()]*(?:_\{[^}]+\}|_[a-z0-9])[^=]*=[^，。；\n]{3,80})(?![$])/g;

  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      // Skip display math, code blocks, headings, table rows, blockquotes
      if (
        trimmed.startsWith("$$") ||
        trimmed.startsWith("```") ||
        /^#{1,6}\s/.test(trimmed) ||
        trimmed.startsWith("|") ||
        trimmed.startsWith("> ")
      ) {
        return line;
      }

      // Skip lines with no math-like content at all
      if (
        !/_[{a-z0-9]|[A-Za-z0-9]\^[{a-z0-9]/i.test(line) &&
        !/(?:sin|cos|log|FFN|softmax|Attention)\s*\(/i.test(line)
      ) {
        return line;
      }

      // ★ If line already contains $...$ (from prior wrapBareInlineLatex),
      // only apply wrapping to text OUTSIDE existing math spans.
      if (line.includes("$")) {
        return applyProseWrapOutsideMath(
          line,
          EQUATION_RE,
          PROSE_FUNC_RE,
          SUBSCRIPT_RE,
        );
      }

      // No existing $ — safe to apply patterns to the whole line
      let result = line;

      // Apply pattern 3 first (equations), then 2 (functions), then 1 (subscripts)
      result = result.replace(EQUATION_RE, (_match, expr: string) => {
        return `$${expr}$`;
      });

      result = result.replace(PROSE_FUNC_RE, (match, expr: string) => {
        if (result.includes(`$${expr}$`)) return match; // already wrapped by equation
        return `$${expr}$`;
      });

      result = result.replace(SUBSCRIPT_RE, (match, expr: string) => {
        if (result.includes(`$${expr}`) || result.includes(`${expr}$`))
          return match;
        return `$${expr}$`;
      });

      return result;
    })
    .join("\n");
}

/**
 * Apply prose-style math wrapping only to segments OUTSIDE existing $...$ spans.
 *
 * Splits the line into math (inside $...$) and non-math segments, applies
 * the three regex patterns only to non-math segments, then reassembles.
 */
function applyProseWrapOutsideMath(
  line: string,
  equationRe: RegExp,
  proseFuncRe: RegExp,
  subscriptRe: RegExp,
): string {
  // Split into segments: alternating non-math / math
  const segments: { text: string; isMath: boolean }[] = [];
  let inMath = false;
  let current = "";

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "$") {
      // Skip $$ (display math)
      if (line[i + 1] === "$") {
        current += "$$";
        i++;
        continue;
      }
      if (inMath) {
        // Closing $
        current += ch;
        segments.push({ text: current, isMath: true });
        current = "";
        inMath = false;
      } else {
        // Opening $
        if (current) segments.push({ text: current, isMath: false });
        current = ch;
        inMath = true;
      }
    } else {
      current += ch;
    }
  }
  if (current) segments.push({ text: current, isMath: inMath });

  // Apply wrapping only to non-math segments
  const result = segments
    .map((seg) => {
      if (seg.isMath) return seg.text;

      let text = seg.text;

      // Equations
      text = text.replace(equationRe, (_match, expr: string) => `$${expr}$`);

      // Prose functions (skip if already wrapped by equation pass)
      text = text.replace(proseFuncRe, (match, expr: string) => {
        if (text.includes(`$${expr}$`)) return match;
        return `$${expr}$`;
      });

      // Subscript/superscript variables
      text = text.replace(subscriptRe, (match, expr: string) => {
        if (text.includes(`$${expr}`) || text.includes(`${expr}$`))
          return match;
        return `$${expr}$`;
      });

      return text;
    })
    .join("");

  return result;
}

export function wrapBareInlineLatex(content: string): string {
  const KNOWN_CMDS =
    "mathbb|mathcal|mathrm|mathbf|mathit|frac|sqrt|text|sum|prod|int|lim|inf|sup|max|min|log|ln|exp|sin|cos|tan|alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|left|right|times|cdot|leq|geq|neq|approx|equiv|subset|supset|subseteq|supseteq|cap|cup|forall|exists|in|notin|top|bot|nabla|partial|infty|dots|ldots|cdots|quad|qquad|mid|vert|Vert|hat|bar|vec|tilde|overline|underline|oplus|otimes|circ|bullet|dagger|ddagger|angle|perp|parallel|sim|simeq|cong|propto|asymp|ll|gg|prec|succ|vee|wedge|neg|not|pm|mp|div|ast|star|begin|end|operatorname|underbrace|overbrace|limits|nolimits";

  // Regex to detect at least one known LaTeX command
  const CMD_DETECT_RE = new RegExp(
    `\\\\(?:${KNOWN_CMDS})(?:\\b|[{_^\\\\])`,
    "",
  );

  // Regex to find the start of a LaTeX expression:
  // Optional variable prefix (e.g. "X" or "d_k"), then a backslash + known command.
  // We capture everything up to a Chinese char, sentence-ending punctuation, or EOL.
  const LATEX_SPAN_RE = new RegExp(
    `(?:[A-Za-z0-9_][A-Za-z0-9_]*\\s*)?(?:\\\\(?:${KNOWN_CMDS})(?:\\b|[{_^\\\\]))` +
      `(?:[^\\u4e00-\\u9fff，。；：、！？\\n])*`,
    "g",
  );

  // ── Big-O / Theta / Omega complexity notation ──
  // Matches: O(n log n), O(n^2), Θ(n), Ω(log n), o(1)
  // These use math letters but no backslash, so they bypass CMD_DETECT_RE.
  const BIG_O_RE = /(?<![$\w])([OΘΩo])\(([^)]{1,60})\)(?![$\w])/g;

  // ── Bare exponent with curly braces in plain text ──
  // Matches: 10^{-3}, 2^{32}, n^{k+1} that appear outside math spans.
  // These are distinguishable from footnote markers like "text^1" by the braces.
  const BARE_BRACE_EXPONENT_RE =
    /(?<![$\\])(\b[A-Za-z0-9]+\^)\{([^}]{1,30})\}(?![{$])/g;

  return content
    .split("\n")
    .map((line) => {
      // Skip display math, fenced code blocks, headings, table rows
      const trimmed = line.trim();
      if (
        trimmed.startsWith("$$") ||
        trimmed.startsWith("```") ||
        /^#{1,6}\s/.test(trimmed) ||
        trimmed.startsWith("|")
      ) {
        return line;
      }

      let result = line;

      // ── Wrap Big-O complexity notation ──
      // Run unconditionally (no backslash check needed)
      if (BIG_O_RE.test(result) && !result.includes("$")) {
        BIG_O_RE.lastIndex = 0;
        result = result.replace(
          BIG_O_RE,
          (_m, letter: string, inner: string) => {
            // Only wrap if inner contains a math-like token (letter, digit, log, etc.)
            if (!/[a-zA-Z0-9]/.test(inner)) return _m;
            // Normalize "log n" → "\log n" inside big-O for proper KaTeX rendering
            const normalized = inner
              .replace(/\blog\b/g, "\\log")
              .replace(/\bln\b/g, "\\ln");
            return `$${letter}(${normalized})$`;
          },
        );
      } else {
        BIG_O_RE.lastIndex = 0;
      }

      // ── Wrap bare brace exponents ──
      if (BARE_BRACE_EXPONENT_RE.test(result) && !result.includes("$")) {
        BARE_BRACE_EXPONENT_RE.lastIndex = 0;
        result = result.replace(
          BARE_BRACE_EXPONENT_RE,
          (_m, base: string, exp: string) => `$${base}{${exp}}$`,
        );
      } else {
        BARE_BRACE_EXPONENT_RE.lastIndex = 0;
      }

      // Skip lines with no known LaTeX commands at all
      if (!CMD_DETECT_RE.test(result)) return result;

      // ★ For lines WITH existing $ delimiters: only wrap bare LaTeX outside math spans
      // For lines WITHOUT $: wrap all bare LaTeX spans
      if (result.includes("$")) {
        return wrapBareLatexOutsideMath(result, CMD_DETECT_RE, LATEX_SPAN_RE);
      }

      // Find LaTeX spans and wrap each in $...$
      return result.replace(LATEX_SPAN_RE, (match) => {
        const inner = match.trim();
        if (inner.length < 3) return match; // too short to be meaningful
        // Only wrap if it actually contains a backslash (not a stray letter match)
        if (!inner.includes("\\")) return match;
        // Preserve leading/trailing whitespace from original match
        const leading = match.slice(0, match.length - match.trimStart().length);
        const trailing = match.slice(match.trimEnd().length);
        return `${leading}$${inner}$${trailing}`;
      });
    })
    .join("\n");
}

/**
 * Wrap bare LaTeX commands on a line that already has $...$ math spans.
 *
 * Strategy: split line into "inside math" and "outside math" segments,
 * only apply wrapping to the "outside" segments.
 */
function wrapBareLatexOutsideMath(
  line: string,
  cmdDetectRe: RegExp,
  latexSpanRe: RegExp,
): string {
  // Split line into segments: [outside, inside, outside, inside, ...]
  // Use a simple state machine to track $ delimiters (skip $$)
  const segments: { text: string; isMath: boolean }[] = [];
  let inMath = false;
  let current = "";

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "$") {
      // Skip $$ (display math — shouldn't appear mid-line, but be safe)
      if (line[i + 1] === "$") {
        current += "$$";
        i++;
        continue;
      }
      if (inMath) {
        // Closing $
        current += ch;
        segments.push({ text: current, isMath: true });
        current = "";
        inMath = false;
      } else {
        // Opening $
        if (current) segments.push({ text: current, isMath: false });
        current = ch;
        inMath = true;
      }
    } else {
      current += ch;
    }
  }
  if (current) segments.push({ text: current, isMath: inMath });

  // Only wrap bare LaTeX in non-math segments
  let changed = false;
  const result = segments
    .map((seg) => {
      if (seg.isMath) return seg.text;
      if (!cmdDetectRe.test(seg.text)) return seg.text;
      const wrapped = seg.text.replace(latexSpanRe, (match) => {
        const inner = match.trim();
        if (inner.length < 3) return match;
        if (!inner.includes("\\")) return match;
        changed = true;
        const leading = match.slice(0, match.length - match.trimStart().length);
        const trailing = match.slice(match.trimEnd().length);
        return `${leading}$${inner}$${trailing}`;
      });
      return wrapped;
    })
    .join("");

  return changed ? result : line;
}

/**
 * Convert plain numbered list items (1. 2. 3. ...) under ### headings to
 * bullet points (- ...) in the chapter (pre-assembly) context.
 *
 * This is the counterpart of `convertDescriptiveListsToBullets` (which only
 * targets #### headings). Here we target ### headings — which is where LLMs
 * most often generate descriptive sub-items that should be bullets, not
 * ordered items.
 *
 * Only non-bold items are converted. Bold items (`1. **Item**`) are structural
 * (they receive hierarchical numbering later) and are left intact.
 * Table rows and blockquotes are also left intact.
 */
export function convertPlainNumberedListsUnderH3ToBullets(
  content: string,
): string {
  const lines = content.split("\n");
  let underH3 = false;

  return lines
    .map((line) => {
      if (/^###\s+/.test(line)) {
        underH3 = true;
        return line;
      }
      if (/^##\s+/.test(line)) {
        underH3 = false;
        return line;
      }
      // Under ###: convert non-bold ordered items to bullets
      if (underH3 && /^\d+\.\s+[^*|>]/.test(line)) {
        return line.replace(/^\d+\.\s+/, "- ");
      }
      return line;
    })
    .join("\n");
}

/**
 * Remove duplicate terminal sections (结语 repeating content from 跨维度关联分析).
 *
 * The report assembler sometimes produces:
 *   ## 跨维度关联分析
 *   ### 维度对比 (table)
 *   ### 系统性效应
 *   ...
 *   ## 结语
 *   (text)
 *   ### 维度对比 (duplicate table!)
 *   ### 系统性效应 (duplicate!)
 *
 * This removes the duplicated ### sub-sections from ## 结语 that already
 * appear under ## 跨维度关联分析.
 */
export function deduplicateTerminalSections(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];

  // First pass: collect ### sub-section titles under ## 跨维度关联分析
  const crossDimSubSections = new Set<string>();
  let inCrossDim = false;
  for (const line of lines) {
    if (/^##\s+跨维度关联分析/.test(line)) {
      inCrossDim = true;
      continue;
    }
    if (/^##\s+[^#]/.test(line) && inCrossDim) {
      inCrossDim = false;
    }
    if (inCrossDim) {
      const h3Match = line.match(/^###\s+(.+)$/);
      if (h3Match) crossDimSubSections.add(h3Match[1].trim());
    }
  }

  if (crossDimSubSections.size === 0) return content;

  // Second pass: remove duplicate sub-sections from ## 结语
  let inConclusion = false;
  let skipBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^##\s+结语/.test(line)) {
      inConclusion = true;
      result.push(line);
      continue;
    }
    if (/^##\s+[^#]/.test(line) && inConclusion) {
      inConclusion = false;
      skipBlock = false;
    }

    if (inConclusion) {
      const h3Match = line.match(/^###\s+(.+)$/);
      if (h3Match && crossDimSubSections.has(h3Match[1].trim())) {
        skipBlock = true; // Start skipping this duplicated sub-section
        continue;
      }
      if (skipBlock) {
        // Stop skipping when we hit the next heading or end
        if (/^##/.test(line)) {
          skipBlock = false;
          // Fall through to push
        } else {
          continue; // Skip this line (part of duplicate block)
        }
      }
    }

    result.push(line);
  }

  return result.join("\n");
}

/**
 * Remove duplicate heading blocks that have identical title AND content.
 *
 * LLMs sometimes output the same subsection twice in a row (e.g. "### WWNBT情景"
 * with identical scenario text). This function detects consecutive sections with
 * the same heading title and removes the duplicate.
 *
 * Works for ##, ###, and #### level headings.
 */
export function deduplicateIdenticalSections(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];

  // Parse into section blocks: { heading, headingLine, bodyLines }
  interface SectionBlock {
    headingLine: number;
    heading: string;
    bodyLines: string[];
  }

  const sections: SectionBlock[] = [];
  let currentSection: SectionBlock | null = null;

  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i].match(/^(#{2,4})\s+(.+)$/);
    if (headingMatch) {
      if (currentSection) sections.push(currentSection);
      currentSection = {
        headingLine: i,
        heading: headingMatch[2].trim(),
        bodyLines: [],
      };
    } else if (currentSection) {
      currentSection.bodyLines.push(lines[i]);
    } else {
      result.push(lines[i]);
    }
  }
  if (currentSection) sections.push(currentSection);

  // Detect and skip duplicates
  const skipIndices = new Set<number>();
  for (let i = 1; i < sections.length; i++) {
    if (
      sections[i].heading === sections[i - 1].heading &&
      !skipIndices.has(i - 1)
    ) {
      const bodyA = sections[i - 1].bodyLines.join("\n").trim();
      const bodyB = sections[i].bodyLines.join("\n").trim();
      // Exact or near-exact match (allow minor whitespace diff)
      if (
        bodyA === bodyB ||
        bodyA.replace(/\s+/g, "") === bodyB.replace(/\s+/g, "")
      ) {
        skipIndices.add(i);
      }
    }
  }

  // Rebuild
  for (let i = 0; i < sections.length; i++) {
    if (skipIndices.has(i)) continue;
    result.push(lines[sections[i].headingLine]);
    result.push(...sections[i].bodyLines);
  }

  return result.join("\n");
}

// ============ Additional Post-Processing Utilities ============

/**
 * Decode HTML entities in report body text.
 * LLMs sometimes output &gt; &lt; &amp; &quot; instead of > < & "
 * which renders as literal entity text in the final report.
 *
 * Skips code blocks (``` and inline `).
 * Task #30
 */
export function decodeHtmlEntities(content: string): string {
  // Protect code blocks
  const codeBlocks: string[] = [];
  let result = content.replace(/```[\s\S]*?```/g, (m) => {
    codeBlocks.push(m);
    return `__HTML_CB_${codeBlocks.length - 1}__`;
  });
  const inlineCodes: string[] = [];
  result = result.replace(/`[^`]+`/g, (m) => {
    inlineCodes.push(m);
    return `__HTML_IC_${inlineCodes.length - 1}__`;
  });

  result = result
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // Restore
  result = result.replace(/__HTML_IC_(\d+)__/g, (_, i) => inlineCodes[i]);
  result = result.replace(/__HTML_CB_(\d+)__/g, (_, i) => codeBlocks[i]);
  return result;
}

/**
 * Convert Chinese numeral headings to standard Markdown headings.
 * LLMs sometimes output "一、标题" or "（一）标题" as section headers
 * instead of proper ### headings.
 *
 * Converts:
 *   一、标题名 → ### 标题名
 *   （一）标题名 → ### 标题名
 *   二．标题名 → ### 标题名
 *
 * Only converts when the line looks like a standalone heading
 * (starts at line beginning, followed by heading-like text).
 * Task #23
 */
export function convertChineseNumeralHeadings(content: string): string {
  return content.replace(
    /^([一二三四五六七八九十百]+)[、．.]\s*(.+)$/gm,
    (_match, _num, title: string) => {
      const trimmed = title.trim();
      // Only convert if title looks like a heading (not a list item continuation)
      if (trimmed.length < 2 || trimmed.length > 60) return _match;
      return `### ${trimmed}`;
    },
  );
}

/**
 * Repair broken list items where the bullet is on one line
 * and the content is on the next line.
 *
 * Converts:
 *   -\n  Content text  → - Content text
 *   1.\n  Content text → 1. Content text
 *
 * Task #15
 */
export function repairBrokenListItems(content: string): string {
  // Unordered: "- " or "* " alone on a line, content on next line
  let result = content.replace(
    /^(\s*[-*])\s*\n(\s+\S[^\n]*)$/gm,
    (_match, bullet, text) => `${bullet} ${text.trim()}`,
  );
  // Ordered: "N." alone on a line, content on next line
  result = result.replace(
    /^(\s*\d+\.)\s*\n(\s+\S[^\n]*)$/gm,
    (_match, bullet, text) => `${bullet} ${text.trim()}`,
  );
  return result;
}

/**
 * Clear empty blockquotes, image load failure placeholders,
 * and orphaned image markdown that won't render.
 *
 * Removes:
 *   > (empty blockquote with nothing after >)
 *   ![alt](broken-url) on its own line
 *   ![]() empty image markdown
 *   Image load failure text patterns
 *
 * Task #25
 */
export function clearBrokenMediaAndEmptyBlocks(content: string): string {
  return (
    content
      // Empty blockquotes (> followed by only whitespace or nothing)
      .replace(/^>\s*$/gm, "")
      // Empty image markdown: ![...]() or ![]()
      .replace(/^!\[[^\]]*\]\(\s*\)\s*$/gm, "")
      // Image failure placeholders
      .replace(/^\s*\[?图片加载失败\]?\s*$/gm, "")
      .replace(/^\s*\[?Image (?:load|loading) (?:failed|error)\]?\s*$/gim, "")
      // Orphaned image alt text without URL (just ![alt text] without (url))
      .replace(/^!\[[^\]]+\]\s*$/gm, "")
      // Clean up resulting empty lines
      .replace(/\n{3,}/g, "\n\n")
  );
}

/**
 * Fix double source labels in references.
 * LLM generates "来源：来源：" or "来源: 来源:" doubled prefixes.
 *
 * Also normalizes "来源：证据 [N]" → "证据 [N]"
 * (the "来源：" prefix is redundant when followed by evidence citation).
 *
 * Task #3
 */
export function fixDoubleSourceLabels(content: string): string {
  return (
    content
      // Double source label: 来源：来源：→ 来源：
      .replace(/来源[：:]\s*来源[：:]/g, "来源：")
      // Source label before evidence citation: 来源：证据 [N] → 证据 [N]
      .replace(/来源[：:]\s*证据\s*/g, "证据 ")
      // English double: Source: Source: → Source:
      .replace(/Source:\s*Source:/gi, "Source:")
      // Figure source duplication: 来源: [N] 证据 [N] → [N]
      // (used in inline figure source notation in markdown body)
      .replace(/来源[：:]\s*\[(\d+)\]\s*证据\s*\[\1\]/g, "[$1]")
      // Evidence label before citation: 证据 [N] → [N]
      // (standalone usage in figure captions)
      .replace(/证据\s+(\[\d+\])/g, "$1")
  );
}

/**
 * Fix duplicate adjacent headings.
 * LLM sometimes generates "## 执行摘要\n\n执行摘要" or
 * "### 3.1. Title\n\nTitle" where the heading text is repeated
 * as the first line of the paragraph.
 */
export function fixDuplicateHeadings(content: string): string {
  // Pattern: heading line followed by blank line(s) then the same text as a paragraph
  return content.replace(
    /^(#{1,4}\s+(?:\d+\.?\s*)*)(.*?)\s*\n(\s*\n)+\2\s*$/gm,
    "$1$2\n",
  );
}

/**
 * Remove empty sections (heading followed immediately by another heading of same or higher level).
 * Example: "### 3.1. Title\n\n### 3.2. Next" → "### 3.2. Next"
 */
export function removeEmptySections(content: string): string {
  // Remove a heading whose body is empty (only whitespace before the next heading).
  // e.g. "### 3.1. Title\n\n### 3.2. Next" → "### 3.2. Next"
  // Safe: only removes when zero content lines exist between two headings.
  return content.replace(/^#{1,4}\s+[^\n]+\n(?:\s*\n)+(?=#{1,4}\s)/gm, "");
}

/**
 * Detect and split wall-of-text paragraphs.
 *
 * Paragraphs longer than maxChars are split at the nearest sentence boundary
 * (。！？；or .\s) near the midpoint. This prevents unreadable text blocks.
 *
 * Only splits plain text paragraphs (not headings, lists, blockquotes, tables).
 * Task #8
 */
export function splitWallOfText(
  content: string,
  maxChars: number = 400,
): string {
  const paragraphs = content.split("\n\n");

  return paragraphs
    .map((p) => {
      const trimmed = p.trim();
      // Skip non-prose: headings, lists, blockquotes, tables, code, images
      // Note: [-*] requires trailing \s to avoid matching **bold** text
      if (/^#{1,6}\s|^>|^\||^!\[|^[-*]\s|^\d+[.)]\s|^```/.test(trimmed))
        return p;
      // Skip short paragraphs
      if (trimmed.length <= maxChars) return p;

      // Find sentence boundaries (Chinese and English)
      const sentenceEnds: number[] = [];
      const sentencePattern = /[。！？；]\s*|[.!?]\s+/g;
      let m: RegExpExecArray | null;
      while ((m = sentencePattern.exec(trimmed)) !== null) {
        sentenceEnds.push(m.index + m[0].length);
      }

      if (sentenceEnds.length < 2) return p; // Can't split single sentence

      // Find the split point nearest to midpoint
      const midpoint = trimmed.length / 2;
      let bestSplit = sentenceEnds[0];
      let bestDist = Math.abs(bestSplit - midpoint);
      for (const pos of sentenceEnds) {
        const dist = Math.abs(pos - midpoint);
        if (dist < bestDist) {
          bestDist = dist;
          bestSplit = pos;
        }
      }

      // Don't create tiny fragments (< 80 chars)
      if (bestSplit < 80 || trimmed.length - bestSplit < 80) return p;

      return (
        trimmed.substring(0, bestSplit).trim() +
        "\n\n" +
        trimmed.substring(bestSplit).trim()
      );
    })
    .join("\n\n");
}

/**
 * Fix arrow chains in text (→ used to express causality).
 * Converts "A → B → C" patterns to natural language.
 *
 * Already called in report-assembler postProcessFinalReport,
 * but exported here for reuse.
 */
export function fixArrowChains(content: string): string {
  // Match lines with 2+ arrows: "A → B → C" or "A→B→C"
  return content.replace(
    /^(.+?)\s*→\s*(.+?)\s*→\s*(.+)$/gm,
    (_match, a: string, b: string, c: string) => {
      // Check if there are more arrows in c
      const parts = c.split(/\s*→\s*/);
      if (parts.length === 1) {
        return `${a.trim()}，进而${b.trim()}，最终${c.trim()}`;
      }
      // Multiple remaining parts
      const allParts = [
        a.trim(),
        b.trim(),
        ...parts.map((p: string) => p.trim()),
      ];
      return allParts
        .map((part: string, i: number) => {
          if (i === 0) return part;
          if (i === allParts.length - 1) return `最终${part}`;
          return `进而${part}`;
        })
        .join("，");
    },
  );
}

/**
 * Ensure a blank line after every table block.
 *
 * Markdown requires a blank line between block-level elements. Without it,
 * text immediately following a table row (e.g. a footnote like
 * "w为窗口大小…") is rendered as part of the table.
 */
export function ensureBlankLineAfterTables(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    result.push(lines[i]);
    if (/^\|/.test(lines[i].trim())) {
      const next = lines[i + 1];
      if (
        next !== undefined &&
        next.trim() !== "" &&
        !/^\|/.test(next.trim())
      ) {
        result.push("");
      }
    }
  }
  return result.join("\n");
}

/**
 * Repair Markdown tables that render as plain text.
 *
 * Fixes:
 * 1. Missing blank lines before/after tables (ReactMarkdown requires them)
 * 2. Missing or malformed separator rows (| --- | --- |)
 * 3. Inconsistent column counts between header, separator, and data rows
 */
export function repairMarkdownTables(content: string): string {
  // Match table blocks: consecutive lines starting with |
  return content.replace(
    /(^|\n)((?:\|[^\n]+\|\s*\n){2,})/g,
    (_match, prefix: string, tableBlock: string) => {
      const lines = tableBlock.trimEnd().split("\n");
      if (lines.length < 2) return _match;

      // Count columns from first row
      const headerCols = (lines[0].match(/\|/g) || []).length - 1;
      if (headerCols < 1) return _match;

      // Check if second line is a valid separator
      const isSeparator = (line: string) =>
        /^\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(line.trim());

      let result: string[];
      if (!isSeparator(lines[1])) {
        // Insert separator row after header
        const sep = "| " + Array(headerCols).fill("---").join(" | ") + " |";
        result = [lines[0], sep, ...lines.slice(1)];
      } else {
        // Validate existing separator has correct column count
        const sepCols = (lines[1].match(/\|/g) || []).length - 1;
        if (sepCols !== headerCols) {
          const sep = "| " + Array(headerCols).fill("---").join(" | ") + " |";
          result = [lines[0], sep, ...lines.slice(2)];
        } else {
          // Normalize alignment: replace ---: or :--- or :---: with plain ---
          const normalizedSep = lines[1].replace(/:?-{2,}:?/g, "---");
          result = [lines[0], normalizedSep, ...lines.slice(2)];
        }
      }

      // Ensure blank line before and after table
      const before =
        prefix.endsWith("\n\n") || prefix === "" ? prefix : prefix + "\n";
      return before + result.join("\n") + "\n\n";
    },
  );
}

/**
 * Extract footnote rows from markdown tables.
 *
 * LLMs sometimes append an explanatory paragraph as the last row of a table:
 *   | 风险项 | 概率 | 影响 |
 *   |---|---|---|
 *   | 计算成本 | 75 | 9 |
 *   | 影响评分依据：成本9分（EBITDA影响15%）... | | |
 *
 * This extracts such rows into a paragraph below the table. A row is treated
 * as a footnote when:
 * - It's the last row of the table
 * - The first cell is much longer (>50 chars) than other cells
 * - Other cells are empty or nearly empty
 */
export function extractTableFootnotes(content: string): string {
  return content.replace(
    /((?:^\|[^\n]+\|\s*\n){3,})/gm,
    (tableBlock: string) => {
      const lines = tableBlock.trimEnd().split("\n");
      if (lines.length < 4) return tableBlock; // header + sep + data + footnote minimum

      const lastLine = lines[lines.length - 1];
      const cells = lastLine.split("|").filter((c) => c !== "");
      if (cells.length === 0) return tableBlock;

      const firstCell = cells[0].trim();
      const otherCells = cells.slice(1).map((c) => c.trim());
      const otherCellsEmpty = otherCells.every((c) => c.length <= 2);

      // Footnote: first cell is long, others are empty
      if (firstCell.length > 50 && otherCellsEmpty) {
        const tableWithout = lines.slice(0, -1).join("\n");
        return tableWithout + "\n\n" + firstCell + "\n";
      }

      return tableBlock;
    },
  );
}

/**
 * Deduplicate heading echo: remove a plain text line that immediately follows
 * a heading and matches the heading text (with or without numbering prefix).
 *
 * LLMs sometimes output:
 *   ### 5.1. 技术架构演进
 *   技术架构演进
 *   (actual content...)
 *
 * This removes the echoed plain text line.
 */
export function deduplicateHeadingEcho(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i].match(/^#{1,6}\s+(?:[\d.]+\s+)?(.+)$/);
    if (headingMatch && i + 1 < lines.length) {
      const headingText = headingMatch[1].trim();
      const nextLine = lines[i + 1].trim();
      // Skip blank lines
      if (nextLine === "") {
        result.push(lines[i]);
        continue;
      }
      // Check if next line is an echo of the heading (exact or prefix match)
      const normalizedHeading = headingText
        .replace(/\*\*/g, "")
        .replace(/\s+/g, "");
      const normalizedNext = nextLine
        .replace(/\*\*/g, "")
        .replace(/^(?:[\d.]+\s+)?/, "")
        .replace(/\s+/g, "");
      if (
        normalizedNext === normalizedHeading ||
        normalizedHeading.startsWith(normalizedNext) ||
        normalizedNext.startsWith(normalizedHeading)
      ) {
        result.push(lines[i]);
        i++; // Skip the echo line
        continue;
      }
    }
    result.push(lines[i]);
  }

  return result.join("\n");
}

/**
 * Detect heading-like plain text lines and promote to ### headings.
 *
 * Detects patterns like:
 * - "标题：内容" at line start (short line, looks like a heading)
 * - Standalone short bold lines: "**技术架构**" alone on a line
 * - Lines ending with ：or : that are short (< 30 chars) and followed by content
 *
 * Only promotes when the line is clearly structural (short, followed by content paragraphs).
 */
export function detectAndPromoteHeadings(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip already-heading lines, list items, blockquotes, empty lines
    if (/^[#>|\-*\d]|^```|^\s*$/.test(trimmed)) {
      result.push(line);
      continue;
    }

    // Pattern 2: Short line ending with ：or : (Chinese heading pattern)
    // Only if 6-25 chars and followed by a content paragraph
    if (
      trimmed.length >= 6 &&
      trimmed.length <= 25 &&
      /^[\u4e00-\u9fff\w].*[：:]$/.test(trimmed) &&
      !/[，。；！？、]/.test(trimmed.slice(0, -1))
    ) {
      const nextContent = lines.slice(i + 1).find((l) => l.trim() !== "");
      // Skip promotion if next content line is a heading, blockquote, table,
      // or list item (ordered/unordered) — those indicate the current line is
      // a lead-in sentence, not a section heading.
      if (
        nextContent &&
        !/^[#>|\-*]/.test(nextContent.trim()) &&
        !/^\d+[.)]\s/.test(nextContent.trim())
      ) {
        const headingText = trimmed.replace(/[：:]$/, "");
        result.push(`### ${headingText}`);
        continue;
      }
    }

    // Pattern 3: Standalone short Chinese line WITHOUT ending punctuation
    // e.g. "网络作战与信号情报中的速度竞争" or "制度瓶颈为何拖慢规模化列装"
    // These are sub-headings the LLM forgot to format.
    //
    // 白名单条件（全部满足才提升为标题）：
    // 1. 5-30 字符，含 3+ 中文字符
    // 2. 无句中/句末标点（不是句子）
    // 3. 前一行是空行（标题前必有段落分隔）
    // 4. 后面紧跟实质段落内容（不是列表/标题/引用）
    // 5. 不是 bold 标记行
    if (
      trimmed.length >= 5 &&
      trimmed.length <= 30 &&
      /[\u4e00-\u9fff]{3,}/.test(trimmed) &&
      !/[，。；！？、）)》」】]$/.test(trimmed) &&
      !/[，。；！？]/.test(trimmed) && // no mid-sentence punctuation → not a sentence
      !/^\[?\d+\]/.test(trimmed) && // not a citation
      !/^\*\*/.test(trimmed) && // not a bold line
      !/^(?:图示|以下图表|上图|下图|图\d+)/.test(trimmed) // not a chart caption line
    ) {
      const nextContent = lines.slice(i + 1).find((l) => l.trim() !== "");
      const prevLine =
        result.length > 0 ? result[result.length - 1].trim() : null;
      // 白名单：前一行必须是空行（null=文档开头，不算空行），后面是段落内容
      if (
        prevLine === "" && // ★ 标题前必须有空行分隔（null 不通过）
        nextContent &&
        !/^[#>|\-*]/.test(nextContent.trim()) &&
        !/^\d+[.)]\s/.test(nextContent.trim())
      ) {
        result.push(`### ${trimmed}`);
        continue;
      }
    }

    result.push(line);
  }

  return result.join("\n");
}

/**
 * Demote headings that contain pseudocode keywords or code fragments.
 *
 * LLM sometimes outputs headings like:
 * - "### 1.2. 以下伪代码展示自注意力核心实现"
 * - "### 1.3. if mask is not None"
 * - "### 1.5. 伪代码对比凸显效率跃迁"
 *
 * These are not real section headings; they should be plain text or code comments.
 */
export function collapsePseudoCodeHeadings(content: string): string {
  return content.replace(
    /^(#{2,4})\s+(?:\d+\.\d+\.?\s*)?(.+)$/gm,
    (match, _hashes, title: string) => {
      const t = title.trim();
      // Heading IS a code statement (e.g., "if mask is not None", "scores += mask")
      if (/^(?:if|for|while|return|def|class|else|elif)\b/.test(t)) return t;
      if (/^\w+\s*[+=]/.test(t) && !/[\u4e00-\u9fff]/.test(t)) return t;
      // Heading title contains "伪代码" — demote to bold paragraph
      if (/伪代码/.test(t)) return `\n**${t}**\n`;
      // Heading title is descriptive intro like "以下伪代码展示..." or "以下代码展示..."
      if (/^以下(?:伪)?代码/.test(t)) return `\n**${t}**\n`;
      return match;
    },
  );
}

/**
 * Collapse excess sub-headings when a dimension has too many ### sections.
 *
 * Works in two modes:
 *   - **Full-report mode**: content contains `## N. Title` dimension headings.
 *     Each dimension resets the counter independently.
 *   - **Per-dimension mode**: content has no `## N. Title` heading (e.g. when
 *     called from `formatDimensionContent`). The entire content is treated as
 *     a single dimension.
 *
 * Excess ### headings (beyond maxSubHeadings) are converted to bold paragraph
 * titles (`**Title**`) rather than demoted to #### — this produces a more
 * natural reading flow than deep heading nesting.
 */
export function collapseExcessSubHeadings(
  content: string,
  maxSubHeadings: number = 10,
): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let h3Count = 0;

  // Per-dimension mode: if no ## N. dimension headings exist, treat
  // the entire content as one dimension (activate counting immediately).
  const hasH2Dimensions = lines.some((l) => /^##\s+\d+\.?\s+/.test(l));
  let inDimension = !hasH2Dimensions;

  for (const line of lines) {
    // New dimension section (## N. Title) resets counter
    if (/^##\s+\d+\.?\s+/.test(line)) {
      h3Count = 0;
      inDimension = true;
      result.push(line);
      continue;
    }
    // Non-dimension ## heading (executive summary etc.) — stop tracking
    if (/^##\s+/.test(line) && !/^##\s+\d+\.?\s+/.test(line)) {
      inDimension = false;
      h3Count = 0;
      result.push(line);
      continue;
    }

    if (inDimension && /^###\s+/.test(line) && !/^####/.test(line)) {
      h3Count++;
      if (h3Count > maxSubHeadings) {
        // Convert to bold paragraph title for natural reading flow.
        // Strip heading marker and any numbering prefix (e.g. "### 1.9. Title" → "**Title**")
        const title = line
          .replace(/^###\s+/, "")
          .replace(/^(?!\d{4}[年\-])[\d.]+\s*/, "")
          .trim();
        if (title) {
          result.push("");
          result.push(`**${title}**`);
        }
        continue;
      }
    }

    result.push(line);
  }

  return result.join("\n");
}

/**
 * Merge undersized ### sections within numbered ## dimensions.
 *
 * When an LLM splits a topic into too many granular sections, some sections end up
 * with very little content (e.g., only a blockquote 核心判断). This function detects
 * sections with < MIN_SECTION_CHARS of content and merges them with the next section
 * by demoting the next section's heading to a bold inline header.
 *
 * After merging, call `renumberHeadings` to fix the numbering.
 *
 * @param minChars  Minimum content chars for a section to stand alone (default 500)
 */
export function mergeUndersizedSections(
  content: string,
  minChars: number = 500,
): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Only process ### headings within numbered dimensions (### N.M. Title)
    const h3Match = line.match(/^###\s+(\d+)\.(\d+)\.?\s+(.+)$/);
    if (!h3Match) {
      result.push(line);
      i++;
      continue;
    }

    // Found a ### heading — measure content until next ### or ## heading
    let contentChars = 0;
    let nextHeadingIdx = -1;

    for (let j = i + 1; j < lines.length; j++) {
      if (/^#{2,3}\s+/.test(lines[j]) && !/^####/.test(lines[j])) {
        nextHeadingIdx = j;
        break;
      }
      // Count non-blank, non-heading content chars
      const trimmed = lines[j].trim();
      if (trimmed) {
        contentChars += trimmed.length;
      }
    }

    // If section is large enough or there's no next heading, keep as-is
    if (contentChars >= minChars || nextHeadingIdx === -1) {
      result.push(line);
      i++;
      continue;
    }

    // Check if next heading is also a ### within the same dimension
    const nextH3Match = lines[nextHeadingIdx]?.match(
      /^###\s+(\d+)\.(\d+)\.?\s+(.+)$/,
    );
    if (!nextH3Match || nextH3Match[1] !== h3Match[1]) {
      // Next heading is a different dimension or ## level — keep current section
      result.push(line);
      i++;
      continue;
    }

    // Merge: keep current ### heading, copy content lines, then demote next heading
    result.push(line);
    i++;

    // Copy content lines between current heading and next heading
    while (i < nextHeadingIdx) {
      result.push(lines[i]);
      i++;
    }

    // Demote next section's ### heading to bold inline header
    const nextTitle = nextH3Match[3].trim();
    // Strip any existing number prefix from title for clean display
    const cleanTitle = nextTitle
      .replace(/^(?!\d{4}[年\-])[\d.]+\s*/, "")
      .trim();
    result.push("");
    result.push(`**${cleanTitle || nextTitle}**`);
    result.push("");
    i++; // skip the demoted heading
  }

  return result.join("\n");
}

/**
 * Remove headings that have no content before the next heading or end of document.
 * A heading is "empty" if between it and the next heading (or EOF) there are only
 * blank lines, no substantive text.
 */
export function removeEmptyHeadings(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if this line is a heading
    if (/^#{1,6}\s+/.test(line)) {
      // Never remove ## headings — these are dimension/chapter titles inserted by
      // the assembler; they legitimately precede ### sub-headings with no body text.
      if (/^##\s+[^#]/.test(line)) {
        result.push(line);
        continue;
      }

      // Look ahead to see if there's content before the next heading
      let hasContent = false;
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j].trim();
        if (nextLine === "") continue; // skip blank lines
        if (/^#{1,6}\s+/.test(nextLine)) break; // hit next heading
        hasContent = true; // found content
        break;
      }

      if (!hasContent) {
        // Empty heading - skip it (and any trailing blank lines)
        continue;
      }
    }

    result.push(line);
  }

  return result.join("\n");
}

/**
 * Detect pseudocode or code-like lines and wrap them in fenced code blocks.
 *
 * Detects patterns:
 * - Lines with `if/for/while/return/function/def/class` keywords + common syntax chars
 * - Lines that look like function calls: `foo(bar, baz)`
 * - Lines with assignment operators: `x = f(y)` or `x := f(y)`
 * - Consecutive lines matching these patterns → group into a single code block
 *
 * Skips lines already inside code blocks.
 */
export function wrapPseudoCodeBlocks(content: string): string {
  // Protect existing code blocks
  const codeBlocks: string[] = [];
  let result = content.replace(/```[\s\S]*?```/g, (m) => {
    codeBlocks.push(m);
    return `__PSEUDO_CB_${codeBlocks.length - 1}__`;
  });

  const lines = result.split("\n");
  const output: string[] = [];
  let codeBuffer: string[] = [];

  const isCodeLike = (line: string): boolean => {
    const trimmed = line.trim();
    if (trimmed === "" || /^[#>|]/.test(trimmed)) return false;
    // Common pseudocode keywords + syntax
    if (
      /^(?:if|for|while|return|function|def|class|else|elif|end|do|then)\b/.test(
        trimmed,
      )
    )
      return true;
    // Assignment with function call: x = func(...)  or  x := func(...)
    if (/^[A-Za-z_]\w*\s*[:=]\s*\w+\(/.test(trimmed)) return true;
    // Indented lines with common syntax (arrows, semicolons, braces)
    if (/^\s{2,}/.test(line) && /[{};→←]/.test(trimmed)) return true;
    // Lines starting with // or # comment (inside a code context)
    if (codeBuffer.length > 0 && /^(?:\/\/|#\s)/.test(trimmed)) return true;
    return false;
  };

  const flushCodeBuffer = () => {
    if (codeBuffer.length >= 2) {
      output.push("```");
      output.push(...codeBuffer);
      output.push("```");
    } else {
      output.push(...codeBuffer);
    }
    codeBuffer = [];
  };

  for (const line of lines) {
    if (isCodeLike(line)) {
      codeBuffer.push(line);
    } else {
      if (codeBuffer.length > 0) {
        flushCodeBuffer();
      }
      output.push(line);
    }
  }
  if (codeBuffer.length > 0) flushCodeBuffer();

  result = output.join("\n");

  // Restore protected code blocks
  result = result.replace(/__PSEUDO_CB_(\d+)__/g, (_, i) => codeBlocks[i]);
  return result;
}

/**
 * Enforce max length on list items by splitting at sentence boundaries.
 *
 * List items exceeding maxChars are split into multiple items.
 * Only splits at Chinese or English sentence boundaries.
 */
export function truncateLongListItems(
  content: string,
  maxChars: number = 120,
): string {
  return content.replace(
    /^(\s*(?:[-*]|\d+\.)\s+)(.+)$/gm,
    (match, prefix: string, text: string) => {
      if (text.length <= maxChars) return match;

      // Find sentence boundary near maxChars
      const sentencePattern = /[。！？；]\s*|[.!?]\s+/g;
      let lastBreak = -1;
      let m: RegExpExecArray | null;
      while ((m = sentencePattern.exec(text)) !== null) {
        const breakAt = m.index + m[0].length;
        if (breakAt <= maxChars && breakAt > text.length * 0.3) {
          lastBreak = breakAt;
        }
      }

      if (lastBreak === -1) return match; // Can't split cleanly

      const first = text.substring(0, lastBreak).trim();
      const rest = text.substring(lastBreak).trim();
      if (rest.length < 20) return match; // Don't create tiny fragments

      // Determine sub-item prefix (indent + dash for continuation)
      const indent = prefix.match(/^(\s*)/)?.[1] || "";
      return `${prefix}${first}\n${indent}  - ${rest}`;
    },
  );
}

/**
 * Detect conclusion paragraphs trapped inside list structures.
 *
 * LLMs sometimes put concluding paragraphs as list items at the end of a list.
 * These are sentences like "综上所述..." or "总体来看..." that should be
 * standalone paragraphs.
 *
 * Detects list items starting with conclusion markers and converts them
 * to regular paragraphs.
 */
export function separateTrappedConclusions(content: string): string {
  const conclusionMarkers =
    /^(\s*)(?:[-*]|\d+\.)\s+((?:综上所述|总体来看|综合来看|总之|由此可见|综上|总而言之|结论是|综合以上|整体而言|最终|归结起来)[，,：:].{30,})$/gm;

  return content.replace(conclusionMarkers, (_match, _indent, text) => {
    // Convert to standalone paragraph with blank line before
    return `\n${text.trim()}`;
  });
}

/**
 * Enforce structural separators in executive summary between sections.
 *
 * Ensures that within the executive summary (## 执行摘要), the risk alerts
 * and action items sections have proper heading markers (### or **bold**).
 * This prevents them from being merged into a single continuous list.
 */
export function enforceExecSummarySections(content: string): string {
  // Find executive summary section
  return content.replace(
    /(##\s*执行摘要[\s\S]*?)(?=\n##\s|$)/,
    (execSection) => {
      let result = execSection;

      // Ensure "风险预警" / "Risk Alerts" has a heading if it's just bold text in a list
      result = result.replace(
        /^(\d+\.)\s*\*\*风险预警\*\*\s*$/gm,
        "\n### 风险预警",
      );
      result = result.replace(
        /^(\d+\.)\s*\*\*行动建议\*\*\s*$/gm,
        "\n### 行动建议",
      );
      result = result.replace(
        /^(\d+\.)\s*\*\*Risk Alerts?\*\*\s*$/gim,
        "\n### Risk Alerts",
      );
      result = result.replace(
        /^(\d+\.)\s*\*\*Action Items?\*\*\s*$/gim,
        "\n### Action Items",
      );

      return result;
    },
  );
}

/**
 * Sentence-safe truncation: truncate content at a sentence boundary
 * rather than cutting mid-sentence.
 *
 * Unlike raw substring truncation, this finds the last complete sentence
 * before the limit and appends an ellipsis indicator if content was truncated.
 */
export function truncateAtSentenceBoundary(
  content: string,
  maxChars: number,
): string {
  if (content.length <= maxChars) return content;

  // Try paragraph boundary first (most natural break)
  const lastParagraph = content.lastIndexOf("\n\n", maxChars);
  if (lastParagraph > maxChars * 0.7) {
    return content.substring(0, lastParagraph);
  }

  // Try sentence boundary
  const truncated = content.substring(0, maxChars);
  const sentencePattern = /[。！？；]\s*|[.!?]\s+/g;
  let lastSentenceEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = sentencePattern.exec(truncated)) !== null) {
    lastSentenceEnd = m.index + m[0].length;
  }

  if (lastSentenceEnd > maxChars * 0.7) {
    return content.substring(0, lastSentenceEnd);
  }

  // Fallback: use paragraph boundary
  return lastParagraph > maxChars * 0.5
    ? content.substring(0, lastParagraph)
    : truncated;
}

/**
 * Repair blockquote bullet points that were truncated mid-sentence
 * (e.g., by token budget limits).
 *
 * If a `> -` line ends without terminal punctuation and is < 120 chars,
 * it was likely cut off. Append "..." to signal truncation gracefully.
 * If the line is extremely short (< 10 chars after the bullet marker),
 * remove it entirely as it adds no value.
 */
export function repairTruncatedBlockquoteBullets(content: string): string {
  return content.replace(
    /^(>\s*-\s+)(.+)$/gm,
    (_match, prefix: string, text: string) => {
      const trimmed = text.trim();
      // If ends with proper punctuation, keep as-is
      if (/[。！？；.!?;）)」】]$/.test(trimmed)) return `${prefix}${trimmed}`;
      // If extremely short fragment (< 10 chars), remove it
      if (trimmed.length < 10) return "";
      // Truncated mid-word — try to trim at last Chinese punctuation or space
      const lastClean = trimmed.search(/[，,；;、]\s*[^\s]{0,5}$/);
      if (lastClean > trimmed.length * 0.6) {
        return `${prefix}${trimmed.substring(0, lastClean + 1)}...`;
      }
      // Just append ellipsis
      return `${prefix}${trimmed}...`;
    },
  );
}

/**
 * Normalize arrow notation corruption.
 *
 * LLMs sometimes translate flow-diagram arrows (→, ->, -->) into Chinese
 * prose "进而推动" (meaning "thereby driving"), creating unnatural text like:
 *   "分词，进而推动构造token序列，进而推动自回归预测"
 * This should read:
 *   "分词 → 构造token序列 → 自回归预测"
 *
 * Also handles "，进而推动" → " → " and standalone "进而推动" in flow contexts.
 */
export function normalizeArrowNotation(content: string): string {
  return (
    content
      // "X，进而推动Y" or "X, 进而推动Y" → "X → Y"
      .replace(/[，,]\s*进而推动\s*/g, " → ")
      // "X。进而推动Y" (sentence boundary) — less common but seen
      .replace(/[。.]\s*进而推动\s*/g, "。")
  );
}

/**
 * Strip leaked HTML comments from markdown content.
 *
 * LLMs sometimes output HTML comments as internal authoring notes:
 *   <!-- 在文本中自然提及图表：图4已在上文... -->
 * These render as escaped text in some markdown renderers.
 */
export function stripLeakedHtmlComments(content: string): string {
  // Preserve <!-- chart:xxx --> placeholders used by frontend FigureRenderer
  return content.replace(/<!--[\s\S]*?-->/g, (match) => {
    if (/<!--\s*chart:/.test(match)) return match;
    return "";
  });
}

/**
 * Deduplicate adjacent identical citations.
 *
 * LLMs sometimes repeat the same citation reference consecutively:
 *   "[5][5]" → "[5]"
 *   "[107][107]" → "[107]"
 *
 * Only deduplicates when the same number appears consecutively.
 */
export function deduplicateAdjacentCitations(content: string): string {
  return content.replace(/\[(\d+)\]\s*\[\1\]/g, "[$1]");
}

/**
 * Bold the summary prefix before a Chinese full-width colon at paragraph start.
 *
 * SOTA reports (McKinsey, Stanford HAI) use bold labels for scannable text.
 * Pattern: A paragraph starts with a short phrase (≤25 chars) followed by `：`,
 * then continues with explanation text.
 *
 * Example:
 *   规模扩张强化回路：前沿模型性能提升...
 *   → **规模扩张强化回路**：前沿模型性能提升...
 *
 * Guards:
 * - Skip lines already containing bold markers
 * - Skip headings, list items, blockquotes, table rows
 * - Skip if prefix is too short (≤2 chars) or too long (>25 chars)
 * - Only applies to the FIRST colon in a line (avoids double-bolding)
 */
export function boldSummaryPrefixes(content: string): string {
  return content.replace(
    /^(?![#>|\-*\d])((?:(?!\*\*)[^\n：]){3,25})：/gm,
    (_match, prefix: string) => {
      // Skip if line already has bold or is inside a code block
      if (prefix.includes("**") || prefix.includes("`")) return _match;
      // ★ Skip if prefix contains math delimiters or LaTeX commands — bolding would corrupt them
      if (prefix.includes("$") || prefix.includes("\\")) return _match;
      // Skip very generic single-word prefixes (e.g., "注" "如" "但")
      if (prefix.trim().length <= 2) return _match;
      return `**${prefix.trim()}**：`;
    },
  );
}

/**
 * Add bullet markers to consecutive parallel lines in blockquotes.
 *
 * LLMs sometimes produce blockquote items without list markers:
 *   > 核心架构Transformer变体（O(N log N)），进而推动...
 *   > 训练优化持续预训练（Chinchilla N∝C^0.46），进而推动...
 *
 * This converts them to:
 *   > - 核心架构Transformer变体（O(N log N)），进而推动...
 *   > - 训练优化持续预训练（Chinchilla N∝C^0.46），进而推动...
 *
 * Only applies when 2+ consecutive `> ` lines exist without `-` markers.
 */
export function bulletifyBlockquoteItems(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];

  // Regex requires actual non-whitespace content after "> " prefix,
  // preventing empty blockquote lines from being converted to empty bullets.
  const bqContentRe = /^>\s+(?![-*]\s|>|\*\*)\S/;

  let i = 0;
  while (i < lines.length) {
    // Detect a run of consecutive blockquote lines without bullet markers
    if (bqContentRe.test(lines[i])) {
      const runStart = i;
      while (i < lines.length && bqContentRe.test(lines[i])) {
        i++;
      }
      const runLength = i - runStart;
      if (runLength >= 2) {
        // Add bullet markers to the run
        for (let j = runStart; j < i; j++) {
          result.push(lines[j].replace(/^>\s+/, "> - "));
        }
      } else {
        // Single blockquote line — leave as-is
        result.push(lines[runStart]);
      }
    } else {
      result.push(lines[i]);
      i++;
    }
  }

  return result.join("\n");
}

/**
 * Bold Chinese enumeration markers in flowing text for visual scannability.
 *
 * SOTA reports emphasize enumeration markers so readers can quickly scan
 * parallel items within dense paragraphs:
 *   一是/二是/三是, 一方面/另一方面, 首先/其次/最后/此外,
 *   第一/第二/第三, 其一/其二/其三
 *
 * Example:
 *   ...一是以通用语言模型为核心...二是以世界模型为代表...
 *   → ...**一是**以通用语言模型为核心...**二是**以世界模型为代表...
 *
 * Guards:
 * - Only bolded when preceded by punctuation, start-of-line, or whitespace
 * - Skip if already bold
 * - The marker word itself is bolded (not the following text)
 */
/**
 * Split Chinese enumeration patterns in paragraphs into bullet lists.
 *
 * Detects patterns like "一是...二是...三是..." within a paragraph and
 * splits them into a leading sentence + bullet list items.
 *
 * Supported patterns:
 *   一是/二是/三是, 一方面/另一方面, 首先/其次/最后/此外,
 *   第一/第二/第三, 其一/其二/其三
 *
 * Example:
 *   "在技术栈层面，可观察到三条路线：一是以通用语言模型为核心...二是以世界模型为代表..."
 *   →
 *   "在技术栈层面，可观察到三条路线：\n\n- 以通用语言模型为核心...\n- 以世界模型为代表..."
 *
 * Guards:
 * - Only splits when >=2 enumeration markers found in the same paragraph
 * - Skips headings, blockquotes, list items
 * - Preserves the leading sentence before the first marker
 */
export function splitEnumerationToList(content: string): string {
  // All marker families: each array is a group that appears together
  const markerGroups = [
    ["一是", "二是", "三是", "四是", "五是"],
    ["一方面", "另一方面"],
    ["首先", "其次", "再次", "最后", "此外"],
    ["其一", "其二", "其三", "其四"],
    ["第一", "第二", "第三", "第四", "第五"],
  ];
  const allMarkers = markerGroups.flat();

  // Build a single regex that matches any marker preceded by a boundary
  // ★ 支持 bold 包裹的枚举：**第一，** 或 **第一层，**
  const markerPattern = new RegExp(
    `([；;，,。：:！!？?\\s]|^)\\*{0,2}(${allMarkers.join("|")})[层，,]?\\*{0,2}`,
    "g",
  );

  const paragraphs = content.split("\n\n");
  const result: string[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();

    // Skip headings, blockquotes, list items, short paragraphs
    if (
      /^[#>]/.test(trimmed) ||
      /^[-*\d]+[.)]\s/.test(trimmed) ||
      trimmed.length < 20
    ) {
      result.push(para);
      continue;
    }

    // Count how many enumeration markers appear
    const matches = [...trimmed.matchAll(markerPattern)];
    if (matches.length < 2) {
      result.push(para);
      continue;
    }

    // Find the first marker's position to split leading sentence
    const firstMatch = matches[0];
    const firstMarkerStart = firstMatch.index;
    // Include the boundary character (punctuation before marker) in the lead
    const boundaryChar = firstMatch[1];
    const leadEnd =
      firstMarkerStart + (boundaryChar.trim() ? boundaryChar.length : 0);

    const leadSentence = trimmed.substring(0, leadEnd).trim();

    // Split content at each marker position into list items
    const items: string[] = [];
    for (let i = 0; i < matches.length; i++) {
      const markerWord = matches[i][2]; // The actual marker (一是, 二是, etc.)
      const startAfterMarker = matches[i].index + matches[i][0].length;
      const endPos =
        i < matches.length - 1 ? matches[i + 1].index : trimmed.length;

      // Get content after marker, trim leading/trailing punctuation and bold markers
      const itemContent = trimmed
        .substring(startAfterMarker, endPos)
        .replace(/^[，,；;：:\s]*\*{0,2}\s*/, "") // strip bold + punctuation
        .replace(/[；;，,]\s*$/, "")
        .trim();

      // Preserve marker word as prefix for semantic clarity (一是X → "一是X")
      if (itemContent.length > 0) {
        items.push(`- **${markerWord}**${itemContent}`);
      }
      // else: Marker with no content — skip entirely (don't push empty bullet)
    }

    if (items.length >= 2) {
      const parts = leadSentence ? [leadSentence, "", ...items] : items;
      result.push(parts.join("\n"));
    } else {
      result.push(para);
    }
  }

  // ── Pass 2: Split inline numeric lists ──────────────────────────────────
  // Handles paragraphs where LLM embeds ordered items as inline text:
  //   "分析角度：1. 技术可行性 2. 商业化路径 3. 竞争格局"
  // → "分析角度：\n1. 技术可行性\n2. 商业化路径\n3. 竞争格局"
  //
  // Pattern: a single paragraph line (no existing newlines) that contains
  // "1. text 2. text 3. text" with >= 2 inline numeric markers.
  //
  // Guards:
  // - Only splits when >= 2 consecutive numeric markers (1. ... 2. ...)
  // - Each item must have at least 3 chars of content
  // - Skips headings, code blocks, blockquotes, table rows, list-starting lines
  const inlineNumericResult: string[] = [];
  for (const para of result) {
    const trimmed = para.trim();

    // Skip structural elements and multi-line paragraphs (they were already processed)
    if (
      /^[#>`|]/.test(trimmed) ||
      trimmed.includes("\n") ||
      trimmed.length < 15
    ) {
      inlineNumericResult.push(para);
      continue;
    }

    // Detect inline numeric markers: "1. xxx 2. xxx" pattern
    // Match positions of "N. " (number dot space) that appear mid-sentence
    // Require at least 2 markers after position 0 (position 0 items are already proper list items)
    const inlineMarkerRe = /(?<=[^\n])\s+(\d+)\.\s+(?=[^\n]{3,})/g;
    const markerMatches = [...trimmed.matchAll(inlineMarkerRe)];

    if (markerMatches.length < 1) {
      inlineNumericResult.push(para);
      continue;
    }

    // Verify markers are consecutive (1, 2, 3... or 2, 3, 4...)
    const markerNums = markerMatches.map((m) => parseInt(m[1]));
    const isConsecutive = markerNums.every(
      (n, i) => i === 0 || n === markerNums[i - 1] + 1,
    );
    if (!isConsecutive) {
      inlineNumericResult.push(para);
      continue;
    }

    // Split: text before first marker becomes lead sentence, then numbered items
    const firstMarkerMatch = markerMatches[0];
    const firstMarkerPos =
      firstMarkerMatch.index + firstMarkerMatch[0].indexOf(firstMarkerMatch[1]);

    const leadText = trimmed.slice(0, firstMarkerPos).trim();

    // Reconstruct items by splitting at each marker position
    const items: string[] = [];
    const allPositions = markerMatches.map((m) => ({
      start: m.index + m[0].indexOf(m[1]),
      end: m.index + m[0].length,
      num: parseInt(m[1]),
    }));

    for (let i = 0; i < allPositions.length; i++) {
      const { end, num } = allPositions[i];
      const nextStart =
        i < allPositions.length - 1
          ? allPositions[i + 1].start
          : trimmed.length;
      const itemContent = trimmed.slice(end, nextStart).trim();
      if (itemContent.length > 0) {
        items.push(`${num}. ${itemContent}`);
      }
    }

    if (items.length >= 2) {
      const parts = leadText ? [leadText, ...items] : items;
      inlineNumericResult.push(parts.join("\n"));
    } else {
      inlineNumericResult.push(para);
    }
  }

  return inlineNumericResult.join("\n\n");
}

/**
 * Repair broken bold markers in report content.
 *
 * LLMs sometimes produce incomplete bold syntax:
 *   **，值得警惕的是...  →  值得警惕的是...  (orphan opening **)
 *   ** [104]。          →  [104]。           (orphan opening **)
 *   内容**              →  内容              (orphan closing ** with no opener)
 *
 * Strategy: Remove orphan ** markers that don't have a matching pair.
 */
export function repairBrokenBoldMarkers(content: string): string {
  // Process line by line to avoid cross-line matching issues
  return content
    .split("\n")
    .map((line) => {
      const boldCount = (line.match(/\*\*/g) || []).length;
      if (boldCount === 0) return line;

      // Valid bold: even number of ** markers
      if (boldCount % 2 === 0) return line;

      // Odd number of ** markers — repair
      // Case 1: Line starts with ** followed by punctuation/space/citation
      // e.g. "**，text" or "** [104]" — remove the orphan opening **
      let repaired = line.replace(/^\*\*([，,。.；;：:\s\[])/g, "$1");

      // Case 2: ** at end of line after punctuation/citation
      // e.g. "text。**" — remove the orphan closing **
      repaired = repaired.replace(/([。.！!？?\]）)])\*\*\s*$/g, "$1");

      // Case 3: ** immediately before closing punctuation with no matching opener
      // e.g. "，值得**。" where ** is stray
      if ((repaired.match(/\*\*/g) || []).length % 2 !== 0) {
        // Remove the first orphan ** if no matching pair exists
        let firstRemoved = false;
        repaired = repaired.replace(/\*\*/g, (match) => {
          if (!firstRemoved) {
            firstRemoved = true;
            return "";
          }
          return match;
        });
      }

      return repaired;
    })
    .join("\n");
}

/**
 * Strip unresolved figure placeholders from content.
 *
 * Removes `<!-- figure:N:M -->` and HTML-escaped variants
 * that were not mapped to chart IDs during report assembly.
 */
export function stripFigureComments(content: string): string {
  let result = content;
  result = result.replace(/<!--\s*figure:\d+:\d+\s*-->/g, "");
  result = result.replace(/&lt;!--\s*figure:\d+:\d+\s*--&gt;/g, "");
  return result;
}

// preprocessDimensionContent and formatDimensionContent are in dimension-content-formatting.util.ts
// Re-exported via ../index.ts barrel for backward compatibility

/**
 * Strip ALL "本章要点" / "Chapter Highlights" blockquote blocks from content.
 *
 * In the continuous (full) report view, these per-dimension highlight boxes
 * are redundant with the executive summary. Removing them produces a cleaner
 * reading experience.
 *
 * Recognizes blocks that start with `> **本章要点**` (or `> **Chapter Highlights**`)
 * and continue with `> - item` lines until the first non-blockquote line.
 */
export function stripChapterHighlights(content: string): string {
  const HEADER_RE = /^>\s*\**(?:本章要点|Chapter Highlights)\**[：:]*\s*$/i;
  // ★ 同时匹配 ### 本章要点 heading 格式（LLM 可能直接输出 H3）
  const HEADING_RE =
    /^#{1,4}\s+\**(?:本章要点|本节小结|小结|Chapter Highlights)\**[：:]*\s*$/i;
  // ★ Gemini 输出的 standalone bold paragraph 格式（无 > 前缀，无 # heading）
  const BOLD_PARA_RE = /^\*{2}(?:本章要点|Chapter Highlights)\*{2}[：:]*\s*$/i;
  // ★ 独占一行的加粗标题（Gemini 用作子节分隔符，应升级为 ### heading）
  const BOLD_HEADING_RE = /^\*{2}([^*\n]{3,60})\*{2}\s*$/;

  const lines = content.split("\n");
  const result: string[] = [];
  // "blockquote" = > lines block; "bulletpara" = standalone bold + bullet list
  let skippingMode: "blockquote" | "bulletpara" | null = null;
  let trailingBlanks = 0; // count trailing blank lines after block ends

  /** 回看 result，找最后一个非空行的索引 */
  const lastNonBlankIdx = () => {
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i].trim() !== "") return i;
    }
    return -1;
  };

  for (const line of lines) {
    if (HEADER_RE.test(line) || HEADING_RE.test(line.trim())) {
      skippingMode = "blockquote";
      trailingBlanks = 0;
      continue;
    }
    if (BOLD_PARA_RE.test(line.trim())) {
      // ★ 若前一个非空行是独占一行加粗标题，升级为 ### heading
      const prevIdx = lastNonBlankIdx();
      if (prevIdx >= 0) {
        const m = result[prevIdx].match(BOLD_HEADING_RE);
        if (m) result[prevIdx] = `### ${m[1].trim()}`;
      }
      skippingMode = "bulletpara";
      trailingBlanks = 0;
      continue;
    }
    if (skippingMode) {
      if (skippingMode === "blockquote") {
        // Continue skipping blockquote continuation lines
        if (/^>\s/.test(line) || line.trim() === ">") continue;
      } else {
        // Skip bullet list items following the bold paragraph header
        if (/^\s*[-*]\s/.test(line)) continue;
      }
      // Allow skipping at most 1 blank line after the block (the separator)
      if (line.trim() === "") {
        trailingBlanks++;
        if (trailingBlanks <= 1) continue; // skip one blank line
        // Additional blank lines: stop skipping, keep them
      }
      skippingMode = null;
      trailingBlanks = 0;
    }
    result.push(line);
  }

  return result.join("\n");
}

/**
 * Normalizes chapter highlights: keep only the FIRST "本章要点" / "Chapter Highlights"
 * block, remove ALL blocks from their original positions, and prepend the first
 * block's content at the very beginning of the output.
 */
export function normalizeChapterHighlights(content: string): string {
  const CHAPTER_HIGHLIGHTS_RE =
    /^(?:>\s*)?[-*]*\s*\**(?:本章要点|Chapter Highlights|Key Takeaways)\**[：:]*\**\s*$/i;

  const lines = content.split("\n");

  let firstBlockLines: string[] | null = null;
  let currentBlockLines: string[] = [];
  let insideBlock = false;
  const bodyLines: string[] = [];

  const flushBlock = () => {
    if (currentBlockLines.length > 0 && firstBlockLines === null) {
      firstBlockLines = currentBlockLines;
    }
    currentBlockLines = [];
    insideBlock = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (CHAPTER_HIGHLIGHTS_RE.test(line)) {
      if (insideBlock) {
        flushBlock();
      }
      insideBlock = true;
      const isEn = /Chapter Highlights/i.test(line);
      const label = isEn ? "Chapter Highlights" : "本章要点";
      currentBlockLines = [`> **${label}**`];
      continue;
    }

    if (insideBlock) {
      const trimmed = line.replace(/^>\s*/, "").trim();

      if (/^>\s*[-*]/.test(line) || /^\s*[-*]\s/.test(line)) {
        const pointText = trimmed.replace(/^[-*]\s*/, "").trim();
        if (pointText) {
          currentBlockLines.push(`> - ${pointText}`);
        }
        continue;
      }

      if (line.trim() === "" || line.trim() === ">") {
        flushBlock();
        bodyLines.push(line);
        continue;
      }

      if (!/^>/.test(line)) {
        flushBlock();
        bodyLines.push(line);
        continue;
      }

      if (trimmed) {
        currentBlockLines.push(`> - ${trimmed}`);
        continue;
      }
    }

    bodyLines.push(line);
  }

  flushBlock();

  if (firstBlockLines === null) {
    return content;
  }

  const blockText = (firstBlockLines as string[]).join("\n");
  const bodyText = bodyLines.join("\n").replace(/^\n+/, "");
  return `${blockText}\n\n${bodyText}`;
}

/**
 * Normalize 本章要点 blocks IN-PLACE for fullReport context.
 *
 * Unlike `normalizeChapterHighlights` (which moves the block to top of each
 * chapter), this function fixes formatting without repositioning — suitable
 * for the assembled fullReport where each chapter already has its highlights
 * in the correct location.
 *
 * Fixes:
 *   > 本章要点        → > **本章要点**
 *   **本章要点**      → > **本章要点**
 *   - bullet          → > - bullet    (when following a highlights header)
 */
export function normalizeHighlightsInPlace(content: string): string {
  const HEADER_RE =
    /^(?:>\s*)?[-*]*\s*\**(?:本章要点|Chapter Highlights)\**[：:]*\**\s*$/i;

  const lines = content.split("\n");
  const result: string[] = [];
  let insideBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (HEADER_RE.test(line)) {
      insideBlock = true;
      const isEn = /Chapter Highlights/i.test(line);
      const label = isEn ? "Chapter Highlights" : "本章要点";
      result.push(`> **${label}**`);
      continue;
    }

    if (insideBlock) {
      const trimmed = line.replace(/^>\s*/, "").trim();

      // Blockquote bullet or plain bullet continuation
      if (/^>\s*[-*]/.test(line) || /^\s*[-*]\s/.test(line)) {
        const pointText = trimmed.replace(/^[-*]\s*/, "").trim();
        if (pointText) {
          result.push(`> - ${pointText}`);
        }
        continue;
      }

      // Empty line or bare blockquote marker ends the block
      if (line.trim() === "" || line.trim() === ">") {
        insideBlock = false;
        result.push(line);
        continue;
      }

      // Non-blockquote, non-list line ends the block
      if (!/^>/.test(line)) {
        insideBlock = false;
        result.push(line);
        continue;
      }

      // Blockquote line without list marker — treat as continuation point
      if (trimmed) {
        result.push(`> - ${trimmed}`);
        continue;
      }
    }

    result.push(line);
  }

  return result.join("\n");
}

/**
 * Minimum data points required per chart type.
 */
export function getMinDataPoints(chartType: string): number {
  switch (chartType) {
    case "line":
    case "area":
      return 5;
    case "bar":
    case "pie":
      return 3;
    case "radar":
      return 10;
    default:
      return 3;
  }
}

/**
 * Remove empty bullet items and stray bullet markers from content.
 *
 * Cleans up artifacts left by bulletifyBlockquoteItems and splitEnumerationToList:
 * - Empty list items: `- ` or `* ` with no content after marker
 * - Empty blockquote bullets: `> - ` with no content
 * - Consecutive blank lines left by removals
 */
export function cleanupEmptyBullets(content: string): string {
  return (
    content
      // Remove empty list items (- or * with only whitespace after)
      .replace(/^\s*[-*]\s*$/gm, "")
      // Remove empty blockquote list items (> - with only whitespace after)
      .replace(/^>\s*[-*]\s*$/gm, "")
      // Collapse triple+ newlines left by removals
      .replace(/\n{3,}/g, "\n\n")
  );
}

/**
 * Replace informal English terms with formal Chinese equivalents.
 *
 * Formal reports should not contain casual English loanwords when
 * proper Chinese terminology exists. This is a post-processing step
 * that normalizes common informal terms found in LLM-generated content.
 */
export function normalizeInformalTerms(content: string): string {
  // Map of informal English terms to formal Chinese replacements
  const replacements: Array<[RegExp, string]> = [
    // "hype" variants — must handle compound forms
    [/hype宣传/g, "过度宣传"],
    [/hype曲线/g, "技术炒作周期曲线"],
    [/忽略hype/g, "忽略炒作"],
    [/(?<![a-zA-Z])hype(?![a-zA-Z])/gi, "炒作"],
  ];
  let result = content;
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Normalize citation source labels to consistent format.
 *
 * Unifies variants like `Source:[94]`, `Source: [94]`, `来源:[94]`
 * to the standard format `Source: [N]` (with space after colon).
 */
export function normalizeSourceLabels(content: string): string {
  return (
    content
      // "Source:[N]" → "Source: [N]"
      .replace(/Source:\[(\d+)\]/g, "Source: [$1]")
      // "来源：[N]" → "Source: [N]"
      .replace(/来源[：:]\s*\[(\d+)\]/g, "Source: [$1]")
      // "来源: 证据 [N]" → "Source: [N]"
      .replace(/来源[：:]\s*证据\s*\[(\d+)\]/g, "Source: [$1]")
  );
}

/**
 * Escape literal `|` inside inline LaTeX (`$...$`) within Markdown table rows.
 *
 * Markdown tables use `|` as column separators. When a LaTeX expression like
 * `$P(A|B)$` appears inside a table cell, the `|` breaks the table structure.
 *
 * This function replaces `|` with `\vert` inside `$...$` spans that appear
 * on lines starting with `|` (table rows).
 */
export function escapeLatexPipeInTables(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      // Only process table rows
      if (!trimmed.startsWith("|")) return line;
      // Skip separator rows (|---|---|)
      if (/^\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(trimmed)) return line;

      // Find $...$ spans and escape | inside them
      return line.replace(/\$([^$]+)\$/g, (_match, inner: string) => {
        if (!inner.includes("|")) return _match;
        return "$" + inner.replace(/\|/g, "\\vert ") + "$";
      });
    })
    .join("\n");
}

/**
 * Normalize inline double-dollar `$$...$$` to single-dollar `$...$` when
 * the expression is clearly inline (appears mid-line with surrounding text).
 *
 * Display math (`$$...$$`) should appear on its own line. When LLMs produce
 * inline `$$` like `L=$$\alpha$$+1`, this converts it to `L=$\alpha$+1`.
 *
 * Guards:
 * - Only converts when `$$` is NOT at the start/end of a line (which would be display math)
 * - Skips fenced code blocks
 */
export function normalizeInlineDoubleDollar(content: string): string {
  let inCodeBlock = false;
  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("```")) {
        inCodeBlock = !inCodeBlock;
        return line;
      }
      if (inCodeBlock) return line;

      // ★ 修复 LLM 的 $ 分隔符粘连（不删除公式，而是还原正确配对）
      // $$$  → $ $（拆分粘连的结尾$和下一个开头$）
      // $$$$ → $ $（同上）
      line = line.replace(/\${3,}/g, "$ $");

      // Skip lines that are pure display math (start and end with $$)
      if (
        trimmed.startsWith("$$") &&
        trimmed.endsWith("$$") &&
        trimmed.length > 4
      ) {
        return line;
      }

      // Convert inline $$...$$ to $...$
      // Match $$ that is NOT at start-of-line (has content before it)
      return (
        line
          .replace(
            /(?<=\S)\$\$([^$]+?)\$\$(?=\S|[，。；：、！？])/g,
            (_, inner: string) => `$${inner}$`,
          )
          // Also handle $$ with space before it (e.g. "O(n $$\log n)")
          .replace(
            /(?<=\S\s)\$\$([^$]+?)\$\$(?=[\S，。；：、！？)\]）】])/g,
            (_, inner: string) => `$${inner}$`,
          )
          // Orphan $$ mid-line with no closing $$ — strip the extra $
          // Handles: "O(n $$\log n)" → "O(n $\log n)"
          // Also: "a $$\log(C)" → "a $\log(C)"
          .replace(/(?<=\S)\$\$(?=\\[a-zA-Z])/g, "$")
          .replace(/(?<=\S\s)\$\$(?=\\[a-zA-Z])/g, "$")
      );
    })
    .join("\n");
}

/**
 * Replace "本章" with "本节" in dimension content.
 *
 * Each dimension is a section (节), not a chapter (章). LLMs sometimes
 * use "本章" which is incorrect at the section level. This only applies
 * within dimension content — NOT in the assembled full report where
 * dimensions become actual chapters.
 *
 * Preserves "本章要点" as-is (it's a recognized block type).
 */
export function normalizeChapterToSection(content: string): string {
  return content
    .replace(/本章节/g, "本维度") // Must run before 本章 → 本节
    .replace(/本章(?!要点)/g, "本节");
}

/**
 * Strip orphaned chart comment markers from content.
 *
 * After report assembly, some `<!-- chart:xxx -->` markers may remain unresolved
 * (e.g., when chart data is missing). These show up as raw HTML comments in
 * the rendered report. Also catches HTML-escaped variants.
 */
export function stripOrphanedChartComments(content: string): string {
  let result = content;
  // Raw HTML comment form
  result = result.replace(/<!--\s*chart:[^\s]+?\s*-->/g, "");
  // HTML-escaped form (appears in exported HTML)
  result = result.replace(/&lt;!--\s*chart:[^\s]+?\s*--&gt;/g, "");
  return result;
}

/**
 * Merge "telegram-style" short isolated paragraphs into bullet lists.
 *
 * Problem: LLMs (especially GPT) sometimes break key points into a series of
 * very short standalone paragraphs (10-60 chars each), each ending with a CJK
 * sentence-ending punctuation mark. Each line becomes its own paragraph block,
 * creating a visually poor "telegram" appearance.
 *
 * Solution: Detect runs of 3+ consecutive short paragraphs that match the
 * pattern (single line, < 80 chars, ends with 。！？…) and convert them into
 * a `- ` bullet list for visual clarity and structural intent.
 *
 * Uses a 3-paragraph minimum to avoid converting legitimate short transitions.
 */
export function mergeTelegramParagraphs(content: string): string {
  // Split into paragraph blocks (separated by blank lines)
  const blocks = content.split(/\n{2,}/);

  /** True if a block looks like a "telegram-style" short sentence */
  const isTelegram = (block: string): boolean => {
    const t = block.trim();
    // Must be a single line (no embedded newlines after trim)
    if (t.includes("\n")) return false;
    // Length: 5–80 chars
    if (t.length < 5 || t.length > 80) return false;
    // Must end with CJK sentence-ending punctuation
    if (!/[。！？…]$/.test(t)) return false;
    // Must not be a Markdown structural element
    if (/^(#{1,6}|[-*+]|\d+\.|>|\||<!--)/.test(t)) return false;
    // Must not contain a citation marker mid-sentence (those are real paragraphs)
    if (/\[\d+\]/.test(t)) return false;
    return true;
  };

  const result: string[] = [];
  let i = 0;

  while (i < blocks.length) {
    if (isTelegram(blocks[i])) {
      // Collect a contiguous run of telegram blocks
      const group: string[] = [blocks[i].trim()];
      while (i + 1 < blocks.length && isTelegram(blocks[i + 1])) {
        i++;
        group.push(blocks[i].trim());
      }
      if (group.length >= 3) {
        // Convert the group into a bullet list
        result.push(group.map((p) => `- ${p}`).join("\n"));
      } else {
        // 1–2 short paragraphs: keep as-is (likely a legitimate short transition)
        result.push(...group);
      }
    } else {
      result.push(blocks[i]);
    }
    i++;
  }

  return result.join("\n\n");
}

