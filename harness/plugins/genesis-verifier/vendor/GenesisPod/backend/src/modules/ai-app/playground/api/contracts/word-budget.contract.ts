/**
 * 字数预算契约 —— 单一数据源（2026-05-22 ③L/M 契约单一源重构）
 *
 * 历史病灶：报告"总字数"在多处各定义一份且互相打架：
 *   - per-dim-pipeline.util.ts: missionTarget 按 **depth**(quick10K/standard40K/deep150K)
 *     —— 完全无视用户选的 lengthProfile。
 *   - mission-outline-planner.agent.ts: lengthTarget 按 **lengthProfile**(3K…200K)
 *     —— 又无视 depth。
 *   两套策略在不同 stage 生效 → 默认 mission 走 per-dim → lengthProfile 形同虚设。
 *
 * 治理（用户拍板）：总字数**只在这里定义一次**。
 *   总字数 = depthBase（实在体量：广度+深度，deep 仍大体量）× lengthProfile 密度倍率
 *   （只往长调，standard=1.0 不缩水 → 深度报告永远实在,不会走马观花）。
 *   per-dim / outline / 前端 都引用 resolveMissionTotalWords，杜绝漂移。
 *
 * 这是 agents/(消费方) 与 services/(生产方) 都能 import 的 leaf 契约模块。
 */

import type { RunMissionInput } from "../dto/run-mission.dto";

/** depth → 报告"实在体量"基线总字数（广度+深度；deep 大体量）。 */
export const DEPTH_BASE_WORDS: Record<RunMissionInput["depth"], number> = {
  quick: 10_000,
  standard: 40_000,
  deep: 150_000,
};

/** lengthProfile → 密度倍率（≥ standard 基线，只往长调，绝不缩水成走马观花）。 */
export const LENGTH_DENSITY_MULTIPLIER: Record<
  RunMissionInput["lengthProfile"],
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
 * 契约注册表 + 生产方 clamp 都引用它，杜绝"测试字面量 vs 生产方字面量"软缝。
 */
export const CHAPTER_WORDS_PER_CHAPTER_RANGE = {
  min: 400,
  max: 12_000,
} as const;

/**
 * 报告总字数单一权威：depthBase × lengthProfile 倍率,夹到 sane 上限。
 * 全管线(per-dim / outline)+ 前端展示都从此函数取,不再各算各的。
 */
export function resolveMissionTotalWords(
  depth: RunMissionInput["depth"],
  lengthProfile: RunMissionInput["lengthProfile"],
): number {
  const raw =
    DEPTH_BASE_WORDS[depth] * LENGTH_DENSITY_MULTIPLIER[lengthProfile];
  return Math.min(MISSION_TOTAL_WORDS_CAP, Math.round(raw));
}
