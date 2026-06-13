/**
 * ai-engine/llm/output/sanitization —— LLM 输出后处理工具（沉淀自 {app}, 2026-04-29）
 *
 * 纯函数 utility（0 DI，0 LLM）。所有 ai-app 都可用。
 *
 * - sanitize-output: 白名单铁墙清理 LLM 输出（13 个正交修复函数）
 * - strip-chart-json: 清理 LLM 泄漏的图表 JSON 块、Figure References 元数据
 *
 * TI 是商用基线，保留独立的本地副本不切换到本实现；consumer 等新模块从这里消费。
 */

export {
  sanitizeSectionOutput,
  stripLeadingBulletLists,
  stripAnalyticalInlineBullets,
  stripSectionOpeningShortLines,
  stripCitationStacking,
  replaceMarketingLanguage,
  repairBrokenBoldPairs,
  normalizeTransitionHeadings,
  normalizeBoldStyle,
  convertOrdinalBulletsToParagraphs,
  fixOrdinalBoldPosition,
  convertLongListItemsToParagraphs,
  removeOrphanCitations,
} from "./sanitize-output.utils";

export {
  stripChartJsonFromContent,
  extractMarkdownFromJsonString,
} from "./strip-chart-json.utils";
