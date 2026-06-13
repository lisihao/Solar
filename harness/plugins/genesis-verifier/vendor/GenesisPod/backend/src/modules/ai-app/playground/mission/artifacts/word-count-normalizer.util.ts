/**
 * 字数归一化（playground 薄 wrapper）
 *
 * 实现已沉淀到 ai-harness/evaluation/critique/word-count-balancer.ts (Phase 3)，
 * 此处仅做参数预设：playground epic 档位单章可达 12K（chapter 而非 section），
 * 故 maxFloor 提高到 8000，与 chapter-writer schema max=12000 对齐。
 *
 * 历史：Phase 1 移植时本地实现 → Phase 3 沉淀到 harness 公共层。
 */

import {
  balanceTargetWords,
  type BalancerResult,
} from "@/modules/ai-harness/facade";

export type NormalizedRecord = BalancerResult;

const PLAYGROUND_OPTS = {
  absoluteMin: 500,
  maxFloor: 8000,
  absoluteMax: 12000,
} as const;

/**
 * 对 targetWordsPerChapter 做中位数归一化（playground 预设）。
 */
export function normalizeTargetWords(
  raw: Record<string, number>,
  fallbackMedian = 1000,
): NormalizedRecord {
  return balanceTargetWords(raw, fallbackMedian, PLAYGROUND_OPTS);
}
