/**
 * WordCountBalancer — 字数中位数归一化（沉淀）
 *
 * 沉淀自：ai-app/{app}/services/core/leader/leader-planning.service.ts:859-880
 * 移植落地：ai-app/{app}/services/.../helpers/word-count-normalizer.util.ts (Phase 1)
 *
 * 价值：所有"长文规划 → 章节字数分配"任务通用，TI 在 200+ 报告生产环境验证。
 *
 * 算法：
 *   1. 取所有 targetWords 中位数 median
 *   2. 动态允许范围 [median × 0.5, median × 2]，但有下限 / 上限保护
 *   3. 越界值拉回到 median（下限）或 maxAllowed（上限）
 *
 * 防止：
 *   - LLM 极度不均的字数分配（500/500/500/7000）
 *   - 极小章节凑空话连篇
 *   - 极大章节超出 writer budget.maxTokens 触发死循环
 */

export interface BalancerOptions {
  /** 绝对下限 (默认 500) — 任何值不会被归一化到此以下 */
  absoluteMin?: number;
  /** 上限保底 (默认 2000) — maxAllowed = max(this, median × 2) */
  maxFloor?: number;
  /** 绝对上限 (默认 12000) — maxAllowed = min(this, max(maxFloor, median × 2)) */
  absoluteMax?: number;
  /** 当某 key 值缺失或 < minAllowed 时的兜底（默认 max(800, median)）*/
  fallbackTarget?: (median: number) => number;
}

export interface BalancerResult {
  targetWords: Record<string, number>;
  /** 是否实际归一化过 */
  normalized: boolean;
  stats: {
    median: number;
    minAllowed: number;
    maxAllowed: number;
    countClampedDown: number;
    countClampedUp: number;
  };
}

const DEFAULT_OPTS: Required<BalancerOptions> = {
  absoluteMin: 500,
  maxFloor: 2000,
  absoluteMax: 12000,
  fallbackTarget: (median: number) => Math.max(800, median),
};

/**
 * 归一化 targetWords map。
 *
 * @param raw sectionId → targetWords
 * @param fallbackMedian 输入全空时使用的中位数兜底
 * @param opts 边界参数（不传用 TI 800-2000 默认值）
 */
export function balanceTargetWords(
  raw: Record<string, number>,
  fallbackMedian = 1000,
  opts: BalancerOptions = {},
): BalancerResult {
  const o = { ...DEFAULT_OPTS, ...opts };
  const entries = Object.entries(raw);
  if (entries.length === 0) {
    return {
      targetWords: {},
      normalized: false,
      stats: {
        median: fallbackMedian,
        minAllowed: o.absoluteMin,
        maxAllowed: o.maxFloor,
        countClampedDown: 0,
        countClampedUp: 0,
      },
    };
  }
  const values = entries.map(([, v]) => v).filter((v) => v > 0);
  const sorted = [...values].sort((a, b) => a - b);
  const median =
    sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : fallbackMedian;
  const minAllowed = Math.max(o.absoluteMin, Math.round(median * 0.5));
  const maxAllowed = Math.min(
    o.absoluteMax,
    Math.max(o.maxFloor, Math.round(median * 2)),
  );

  let countClampedDown = 0;
  let countClampedUp = 0;
  let normalized = false;
  const out: Record<string, number> = {};
  for (const [k, v] of entries) {
    let next = v;
    if (!next || next < minAllowed) {
      next = o.fallbackTarget(median);
      countClampedDown++;
      normalized = next !== v;
    } else if (next > maxAllowed) {
      next = maxAllowed;
      countClampedUp++;
      normalized = true;
    }
    out[k] = next;
  }

  return {
    targetWords: out,
    normalized,
    stats: {
      median,
      minAllowed,
      maxAllowed,
      countClampedDown,
      countClampedUp,
    },
  };
}
