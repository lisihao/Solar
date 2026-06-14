/**
 * ai-harness/governance/figure —— 图片相关性判断（沉淀自 {app}, 2026-04-29）
 *
 * 用 embedding 语义相似度判断图片 caption 与研究主题相关性，替代 Vision LLM 方案。
 * 配合 ai-engine/content/figure 的 FigureExtractorService 形成完整图片管道。
 *
 * TI 仍在使用 ai-app/{app}/services/report/figure-relevance.service.ts，
 * 待 {app} 验证稳定后再考虑切换。
 */

export { FigureRelevanceService } from "./figure-relevance.service";
