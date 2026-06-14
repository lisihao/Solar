/**
 * 章节数契约 —— 单一数据源（2026-05-22 契约单一源重构）
 *
 * 历史病灶：管线 per-dim-pipeline 算 targetChapterCount ∈ [1,25]（Evidence Contract
 * 让稀缺证据维度只开 1-2 章），但 dimension-outline-planner agent 的 inputSchema 却写
 * min(3) —— 两处各定义一份"章节数下限"，漂移 → 稀缺维度被 schema 拒 →
 * ORCH_CHAPTER_PIPELINE_FAILED → mission 崩。
 *
 * 治理：章节数的合法范围**只在这里定义一次**。
 *   - agents/writer/dimension-outline-planner.agent.ts 的 inputSchema 用它（不变量）
 *   - services/mission/workflow/per-dim-pipeline.util.ts 的 clamp 用它（生产方）
 *   - __tests__ 契约测试 assertNumberProducerWithinSchema 校验两者一致
 *
 * 这是 agents/（消费方）与 services/（生产方）都能 import 的 leaf 契约模块，
 * 避免 agent → service 的反向依赖。
 */

/**
 * 章节数不变量：
 *   - min 1：每个维度至少 1 章（稀缺证据维度的合法下限；citation floor 自适应保证不空引）
 *   - max 25：绝对上限（防失控）
 */
export const CHAPTER_COUNT_RANGE = { min: 1, max: 25 } as const;

/** 把任意推导出的章节数收敛到合法区间（生产方唯一 clamp 入口）。 */
export function clampChapterCount(n: number): number {
  return Math.max(
    CHAPTER_COUNT_RANGE.min,
    Math.min(CHAPTER_COUNT_RANGE.max, Math.round(n)),
  );
}
