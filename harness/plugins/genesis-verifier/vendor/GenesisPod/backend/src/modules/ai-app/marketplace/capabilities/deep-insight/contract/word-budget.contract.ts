/**
 * 字数预算契约 —— deep-insight 能力的报告体量单一源（中立，平台所有）。
 *
 * 历史上在 playground/api/contracts/；2026-06-08 上架沉淀挪入能力共享层（消费方 agents
 * 与生产方 services 都 import 的 leaf 契约）。原 depth/lengthProfile 取自 playground 的
 * RunMissionInput；此处改为本地 string-union（结构等价），切断对 playground 的反依赖。
 * 旧路径留 re-export 桩，playground 存量 import 不变。
 *
 * 总字数 = depthBase（实在体量：广度+深度，deep 仍大体量）× lengthProfile 密度倍率
 * （只往长调，standard=1.0 不缩水 → 深度报告永远实在）。
 */

/** 研究深度档（与 RunMissionInput["depth"] 结构等价）。 */
export type DeepInsightDepth = "quick" | "standard" | "deep";
/** 报告长度档（与 RunMissionInput["lengthProfile"] 结构等价）。 */
export type DeepInsightLengthProfile =
  | "brief"
  | "standard"
  | "deep"
  | "extended"
  | "epic"
  | "mega";

/** depth → 报告"实在体量"基线总字数（广度+深度；deep 大体量）。 */
export const DEPTH_BASE_WORDS: Record<DeepInsightDepth, number> = {
  quick: 10_000,
  standard: 40_000,
  deep: 150_000,
};

/** lengthProfile → 密度倍率（≥ standard 基线，只往长调，绝不缩水成走马观花）。 */
export const LENGTH_DENSITY_MULTIPLIER: Record<
  DeepInsightLengthProfile,
  number
> = {
  brief: 0.7,
  standard: 1.0,
  deep: 1.5,
  extended: 2.0,
  epic: 4.0,
  mega: 8.0,
};

/** 总字数 sane 上限（防 deep×mega 类组合算出不现实的体量）。 */
export const MISSION_TOTAL_WORDS_CAP = 400_000;

/**
 * 每章字数生产方范围（单一源）：覆盖两个生产方的并集——
 *   - per-dim-pipeline targetWordsPerChapter: [400, 8000]
 *   - s7 normalizeTargetWords: [500, 12000]
 * 并集 = [400, 12000]，必须 ⊆ chapter-writer / single-shot-writer 的 targetWords schema。
 */
export const CHAPTER_WORDS_PER_CHAPTER_RANGE = {
  min: 400,
  max: 12_000,
} as const;

/**
 * 报告总字数单一权威：depthBase × lengthProfile 倍率，夹到 sane 上限。
 * 全管线(per-dim / outline)+ 前端展示都从此函数取，不再各算各的。
 */
export function resolveMissionTotalWords(
  depth: DeepInsightDepth,
  lengthProfile: DeepInsightLengthProfile,
): number {
  const raw =
    DEPTH_BASE_WORDS[depth] * LENGTH_DENSITY_MULTIPLIER[lengthProfile];
  return Math.min(MISSION_TOTAL_WORDS_CAP, Math.round(raw));
}
