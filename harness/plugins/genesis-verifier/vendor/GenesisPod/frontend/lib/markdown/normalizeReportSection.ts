/**
 * normalizeReportSection — 报告章节内容的标准化预处理
 *
 * 抽自 ChapterizedReportView.formatContent，作为平台能力让连续视图
 * （ReportEditor）和章节视图共用同一份段落归一化口径。
 *
 * 关键作用：chart.position="after_paragraph_N" 的 paragraphIdx 是 LLM 在
 * **预处理后**的章节内段落计数。如果两个视图预处理顺序/步骤不同，inject
 * 时探测到的段落边界数会偏移，导致同一张图在章节视图位置正确、连续视图
 * 跑到章节最前面（用户实测 bug）。
 *
 * 处理顺序（与 ChapterizedReportView 历史实现严格一致）：
 *   1) stripChartJsonBlock —— 清理 LLM 误吐的 raw chart JSON 块
 *   2) preprocessLatex —— 公式边界规范、列表项 promote
 *   3) strip abused headings —— `### 一方面/此外/...` → 普通段落
 *   4) stripProseBullets —— 把行首误用为列表的 prose 段去掉
 *   5) `**text**` → `<strong>text</strong>` —— CommonMark CJK bypass
 */

import { preprocessLatex } from './preprocessLatex';
import { stripProseBullets } from './stripProseBullets';

/** 清理 LLM 误吐的 raw `CHARTS--- {...}` JSON 块（嵌套大括号安全） */
function stripChartJsonBlock(content: string): string {
  const separatorPattern = /(?:-+\s*CHARTS\s*-*|CHARTS\s*-+)/gi;
  let match: RegExpExecArray | null;
  let result = content;
  const matches: { index: number; length: number }[] = [];
  while ((match = separatorPattern.exec(content)) !== null) {
    matches.push({ index: match.index, length: match[0].length });
  }
  for (let i = matches.length - 1; i >= 0; i--) {
    const sep = matches[i];
    const afterSep = result.substring(sep.index + sep.length);
    const braceStart = afterSep.search(/\{/);
    if (braceStart === -1) continue;
    const jsonStart = sep.index + sep.length + braceStart;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let jsonEnd = -1;
    for (let j = jsonStart; j < result.length; j++) {
      const ch = result[j];
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === '\\') {
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          jsonEnd = j + 1;
          break;
        }
      }
    }
    let stripStart = sep.index;
    while (stripStart > 0 && '\n\r \t'.includes(result[stripStart - 1]))
      stripStart--;
    result =
      result.substring(0, stripStart) +
      result.substring(jsonEnd > 0 ? jsonEnd : sep.index + sep.length);
  }
  return result;
}

/** 滥用为标题的连接词（H1-H4 + 可选 ** 包裹） */
const ABUSED_HEADING_RE =
  /^#{1,4}\s+\*{0,2}(一方面|另一方面|此外|首先|其次|再次|最后|然而|因此|总之|综上|不过|尽管|虽然|同时|接着)\*{0,2}[，,：:。]?\s*$/gm;

/**
 * 标准化一个章节的 markdown 内容。幂等（多次调用结果稳定）。
 *
 * @param raw - 章节原始 markdown body
 * @returns 标准化后的 markdown，可直接给 ReactMarkdown 渲染或给
 *          injectChartPlaceholders 计算 paragraph index
 */
export function normalizeReportSection(raw: string): string {
  if (!raw) return raw;
  // 1) Strip raw chart JSON 块
  const noChartJson = stripChartJsonBlock(raw);
  // 2) preprocessLatex（生成新的 ** via promotePhaseListItems 等）
  const withLatex = preprocessLatex(noChartJson);
  // 3) 滥用 heading → 普通段落
  const noAbused = withLatex.replace(ABUSED_HEADING_RE, '\n$1');
  // 4) Strip prose bullets BEFORE bold conversion
  const noBullets = stripProseBullets(noAbused);
  // 5) **text** → <strong>text</strong>（CommonMark CJK bypass）
  return noBullets.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
}
