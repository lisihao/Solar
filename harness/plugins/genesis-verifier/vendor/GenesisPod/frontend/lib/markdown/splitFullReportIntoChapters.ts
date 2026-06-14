/**
 * Split an assembled `fullReport` markdown string into chapter segments by H2
 * headings. Single source of truth for chapter view rendering.
 *
 * Previously, ChapterizedReportView rebuilt chapters from `dimensionAnalyses[]`
 * + a few supplementary fields (`crossDimensionAnalysis.fullText`, etc.),
 * missing preface / executiveSummary / conclusion entirely. That caused the
 * chapter view to show dramatically less content than the continuous view.
 *
 * This utility parses the authoritative `fullReport` (the same string the
 * continuous view renders) so both views agree exactly on content.
 *
 * Rules:
 *   - Split at every `## ` at start of line
 *   - Strip the References section (appendix markers `---` + `## 参考文献` / `## References`)
 *   - Skip the Table of Contents (目录 / Table of Contents)
 *   - Leading content before the first H2 (title + `> 生成时间：…`) is dropped —
 *     we don't render the big `# Title` as a chapter; the page header handles it
 */

export type ChapterType =
  | 'preface'
  | 'summary'
  | 'dimension'
  | 'cross-dimension'
  | 'risk'
  | 'strategy'
  | 'conclusion'
  | 'other';

export interface ParsedChapter {
  /** Stable id derived from sectionNumber + normalized title */
  id: string;
  /** Chapter H2 title (without leading "N. " numbering) */
  title: string;
  /** Raw section number extracted from H2 prefix, e.g. "## 3. Foo" → "3" */
  sectionNumber: string | null;
  /** Markdown content AFTER the H2 line, with chart placeholders preserved */
  content: string;
  /** Classified type for status / styling / ordering */
  type: ChapterType;
}

const REF_SECTION_RE =
  /\n(?:---\s*\n+)?##\s*(?:参考文献|References)\s*\n[\s\S]*$/;
const TOC_TITLE_RE = /^(目录|Table of Contents)$/i;
const PREFACE_TITLE_RE = /^(前言|Preface)$/i;
const EXEC_SUMMARY_TITLE_RE = /^(执行摘要|Executive\s*Summary)$/i;
const CROSS_DIM_TITLE_RE = /^(跨维度关联分析|Cross[- ]?Dimension\s*Analysis)$/i;
const RISK_TITLE_RE = /^(风险评估|Risk\s*Assessment)$/i;
const STRATEGY_TITLE_RE = /^(战略建议|Strategic\s*Recommendations)$/i;
const CONCLUSION_TITLE_RE = /^(结语|结论|Conclusion)$/i;

/**
 * Extract a leading "N." or "N.M." number from a title, returning
 * `{ number, rest }`. e.g. "3. 技术架构" → { number: "3", rest: "技术架构" }.
 * Accepts both "1. Name" (backend canonical) and "1.2 Name" forms.
 */
function extractSectionNumber(title: string): {
  number: string | null;
  rest: string;
} {
  const m = title.match(/^(\d+(?:\.\d+)*)\.?\s+(.+)$/);
  if (m) return { number: m[1], rest: m[2].trim() };
  return { number: null, rest: title.trim() };
}

function classifyChapter(
  title: string,
  sectionNumber: string | null
): ChapterType {
  if (PREFACE_TITLE_RE.test(title)) return 'preface';
  if (EXEC_SUMMARY_TITLE_RE.test(title)) return 'summary';
  if (CROSS_DIM_TITLE_RE.test(title)) return 'cross-dimension';
  if (RISK_TITLE_RE.test(title)) return 'risk';
  if (STRATEGY_TITLE_RE.test(title)) return 'strategy';
  if (CONCLUSION_TITLE_RE.test(title)) return 'conclusion';
  // Numbered chapters that aren't a known supplementary section are dimensions
  if (sectionNumber) return 'dimension';
  return 'other';
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '');
}

export function splitFullReportIntoChapters(
  fullReport: string | null | undefined
): ParsedChapter[] {
  if (!fullReport) return [];

  // Drop the References section entirely — it's rendered separately by
  // the references panel, not as a chapter.
  let body = fullReport.replace(REF_SECTION_RE, '');

  // Defense in depth: recover from mid-line `## N. ` headings that can appear
  // when an upstream pipeline step (historically LatexRepair's chunked path,
  // now fixed) eats the newline between sections. The split regex below is
  // line-anchored, so without this normalization any glued heading would
  // silently hide an entire chapter.
  body = body.replace(/([^\n])(##\s+\d+\.\s)/g, '$1\n\n$2');

  // Drop the top-level `# Title` + optional generated-at blockquote before the
  // first H2 so the page-level header doesn't duplicate.
  const firstH2Idx = body.search(/^##\s+/m);
  if (firstH2Idx > 0) body = body.slice(firstH2Idx);

  if (!/^##\s+/m.test(body)) return [];

  const chapters: ParsedChapter[] = [];
  // Split at every H2 boundary. Capture group keeps the headings.
  const segments = body.split(/^(##\s+[^\n]+)\n/m).filter((s) => s.length > 0);

  // segments: [heading, body, heading, body, ...]
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!/^##\s+/.test(seg)) continue; // content before first heading — skip
    const rawHeading = seg.replace(/^##\s+/, '').trim();
    const content = (segments[i + 1] ?? '').replace(/^\n+/, '').trimEnd();
    i++; // consumed content

    if (TOC_TITLE_RE.test(rawHeading)) continue;

    const { number, rest } = extractSectionNumber(rawHeading);
    const type = classifyChapter(rest, number);

    chapters.push({
      id: `${type}-${number ?? (slugify(rest) || chapters.length)}`,
      title: rest,
      sectionNumber: number,
      content,
      type,
    });
  }

  return chapters;
}
