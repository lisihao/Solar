/**
 * ai-engine/content/figure —— 图表/图片抽取（沉淀自 {app}, 2026-04-29）
 *
 * 公共能力（figure pipeline）：
 *   Stage 1-2: FigureExtractorService —— 从 HTML 抽取 <img>/<figure>/<picture> →
 *     验证 URL 可访问 → 输出 ExtractedFigure[]。
 *   Stage 3:   FigureRelevanceService —— 对 ExtractedFigure[] 做 embedding 语义相关性
 *     过滤（caption vs 主题 cosine）。零 app/harness 依赖，仅用同层 EmbeddingService。
 *
 * 调用方：通过 ai-engine/facade 复用 FigureExtractorService / FigureRelevanceService。
 */

export {
  FigureExtractorService,
  type ExtractedFigure,
} from "./figure-extractor.service";
export { FigureRelevanceService } from "./figure-relevance.service";
export {
  FIGURE_RELEVANCE_CONFIG,
  resolveFigureRelevanceConfig,
  type FigureRelevanceConfig,
  type ResolvedFigureRelevanceConfig,
} from "./figure-relevance.config";
