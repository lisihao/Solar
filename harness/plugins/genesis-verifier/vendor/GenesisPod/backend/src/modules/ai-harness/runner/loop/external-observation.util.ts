/**
 * external-observation.util.ts —— R2-#42 间接注入防御（OWASP LLM01）
 *
 * loop 把工具观测回填进 LLM 上下文时，对"外部不可信来源"工具的输出做
 * <external_source trust="untrusted"> 隔离 + sanitize（去注入模式 / 隐藏 Unicode /
 * 转义闭合标签），让抓取内容里的"忽略上述指令"只会被当成研究素材而非执行指令。
 * 内部工具（计算 / 代码 / 记忆等）原样透传，不加标签。
 *
 * 隔离原语来自 ai-engine/safety（wrapExternalContent）；本文件只负责判定"哪些工具
 * 算外部不可信来源"并推断 source 类型。纯函数，便于单测。
 */
import { wrapExternalContent } from "@/modules/ai-engine/safety/security/llm-injection/external-content-wrapper.utils";

/** 单段观测最大保留字符数（≈4k tokens）——超长抓取内容截断，保上下文健康 */
const MAX_OBSERVATION_CHARS = 16000;

/** toolId 命中即视为外部不可信来源，并给出 <external_source source="..."> 的来源类型 */
const EXTERNAL_TOOL_SOURCE: ReadonlyArray<readonly [RegExp, string]> = [
  // Highest-risk: arbitrary-URL fetches and user-uploaded file parsing
  [/data.?fetch|fetch.?data/i, "web"],
  [/file.?pars|pars.?file/i, "document"],
  [/scrap|fetch.?url|url.?fetch|browse|crawl/i, "web"],
  [
    /web.?search|search.?web|google|bing|duckduckgo|serp|tavily|brave|exa/i,
    "web",
  ],
  [/arxiv|pubmed|semantic.?scholar|scholar|crossref|academic/i, "academic"],
  // Policy / government data sources (must be before generic /news/ rule)
  [/whitehouse.?news|congress.?gov|federal.?register/i, "policy"],
  [/news/i, "news"],
  [
    /github|gitlab|stack.?overflow|stack.?exchange|hacker.?news|reddit/i,
    "social",
  ],
  [/twitter|weibo|social|linkedin|youtube/i, "social"],
  [
    /rag.?search|knowledge.?base|kb.?search|vector.?search|retrieval/i,
    "knowledge-base",
  ],
  // Financial / industry data
  [/finance.?api|industry.?report/i, "financial-data"],
  // SEC EDGAR filings（M5：财报正文是外部内容，必须包裹防间接注入）
  [/sec.?edgar|edgar.?sec|sec.?filing/i, "financial-data"],
  // Image search engines
  [/image.?search|bing.?image|google.?image|serpapi.?image/i, "web"],
  // Knowledge graph (external graph traversal)
  [/knowledge.?graph/i, "knowledge-base"],
  // General wiki lookups
  [/wiki.?search|wiki.?page|wiki.?read/i, "web"],
  // Job postings (scraped boards)
  [/job.?search/i, "web"],
];

/** 推断外部来源类型；非外部工具返回 null */
export function inferExternalSource(toolId: string | undefined): string | null {
  if (!toolId) return null;
  for (const [re, source] of EXTERNAL_TOOL_SOURCE) {
    if (re.test(toolId)) return source;
  }
  return null;
}

/**
 * 外部不可信工具 → <external_source> 隔离；内部工具原样返回。
 * @param rawContent 已 stringify 的工具观测文本
 * @param toolId 产生该观测的工具 id
 */
export function wrapToolObservation(
  rawContent: string,
  toolId: string | undefined,
): string {
  const source = inferExternalSource(toolId);
  if (!source) return rawContent;
  const wrapped = wrapExternalContent(rawContent, {
    source,
    maxLength: MAX_OBSERVATION_CHARS,
  });
  // 空内容时 wrapExternalContent 返回 ""，回退原文避免观测被吞
  return wrapped.length > 0 ? wrapped : rawContent;
}
