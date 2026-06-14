/**
 * 共享信号打分公式（W2-E 去重单一源）
 *
 * health / priority / diversity 三个公式在 ModelElectionService（LLM 选举）与
 * routing/signal-scorers（tools/skills router）中**逐字相同**，此前各持一份。
 * 这里抽成纯函数单一源，两侧 import 复用，行为零变化（election golden snapshot 字节不变）。
 *
 * 注：cost 公式**故意不共享**——election 的 unknown-costTier 回退是 `tierToCost(tier)`
 * （按 tier 派生 basic/standard/strong），routing 的回退是固定 `"standard"`，两者已
 * 业务性 diverge。强行统一会改 election 选举结果（golden snapshot 漂移），属行为决策、
 * 非机械去重，故各自保留。relevance 亦不在此（需 embedding，由 ScoredRouter 内置）。
 */

/**
 * 健康：recentErrorRate 越低越好。
 * undefined → 中位 15；<=0.01 → 20；<=0.1 → 10；<=0.3 → 0；更高 → -20。
 */
export function scoreHealthRate(rate: number | undefined): number {
  if (rate === undefined) return 15;
  if (rate <= 0.01) return 20;
  if (rate <= 0.1) return 10;
  if (rate <= 0.3) return 0;
  return -20;
}

/**
 * 运营优先级：(priority ?? 50) / 10 → 0~10。
 */
export function scorePriority(priority: number | undefined): number {
  return (priority ?? 50) / 10;
}

/**
 * 多样性反坍缩：候选 id 在"已被选过列表"中出现 N 次 → -10 × N（空列表 → 0）。
 */
export function scoreDiversity(
  id: string,
  previous: readonly string[] | undefined,
): number {
  if (!previous || previous.length === 0) return 0;
  const occurrences = previous.filter((x) => x === id).length;
  return -10 * occurrences;
}
