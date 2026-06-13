/**
 * FigureRelevance 阈值/参数化配置（figure re-home, 2026-06-09）。
 *
 * 设计：FigureRelevanceService 的可调参数从模块级常量提为可注入 config，让不同消费方
 *   按场景调参（policy/regulation 类放宽 cosine 阈值；tech/product 类收紧），而服务实现
 *   保持零 app/harness 依赖。不注入时走默认值（与原 insight/harness 实证值一致）。
 *
 * 注入方式（消费方在自己的 module providers）：
 *   { provide: FIGURE_RELEVANCE_CONFIG, useValue: { cosineThreshold: 0.25 } }
 */

/** DI token：消费方覆盖 FigureRelevance 参数时用（@Optional 注入，缺省走默认）。 */
export const FIGURE_RELEVANCE_CONFIG = Symbol("FIGURE_RELEVANCE_CONFIG");

/** 消费方可覆盖的 FigureRelevance 参数（全可选；未传字段走默认值）。 */
export interface FigureRelevanceConfig {
  /**
   * Stage 2 photo caption 与主题的 cosine 相似度下限。
   *
   * 实证（R-LIVE-3, 2026-04-30）：0.35 对中文政策/法规类维度过严（跨语言
   * caption 下游 cosine 普遍 0.25-0.32）；0.28 作为 safety net 让边缘相关图通过。
   */
  cosineThreshold?: number;
  /** photo 有效 caption 最小长度（< 此值视为无描述，直接拒绝）。 */
  minCaptionLength?: number;
}

/** resolve 后的只读参数（运行期使用，全字段必有值）。 */
export interface ResolvedFigureRelevanceConfig {
  readonly cosineThreshold: number;
  readonly minCaptionLength: number;
}

/** 默认 cosine 阈值（沉淀自 harness 实证值，跨语言 safety net）。 */
const DEFAULT_COSINE_THRESHOLD = 0.28;

/** 默认 caption 最小长度（学术图说明经验值）。 */
const DEFAULT_MIN_CAPTION_LENGTH = 10;

/** 把可选 config 解析成全字段只读参数（缺字段补默认）。 */
export function resolveFigureRelevanceConfig(
  config?: FigureRelevanceConfig,
): ResolvedFigureRelevanceConfig {
  return {
    cosineThreshold: config?.cosineThreshold ?? DEFAULT_COSINE_THRESHOLD,
    minCaptionLength: config?.minCaptionLength ?? DEFAULT_MIN_CAPTION_LENGTH,
  };
}
