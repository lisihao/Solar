/**
 * Agent Playground — agent specs barrel export
 *
 * 命名规约（mission-pipeline-baseline.md §Agent-Naming）:
 *   - 文件名 + 类名都明确表达"做什么 + 在什么粒度做"
 *   - 类名格式: `<Scope><Role>Agent`
 *     · Scope ∈ { Mission, Dimension, Chapter, Leader (special, multi-phase) }
 *     · Role  = 简洁名词（Researcher / Reconciler / Analyst / Writer / Reviewer / Critic / ...）
 *   - 文件名格式: `<scope>-<role>.agent.ts` 或单一名词（当目录已隐含 scope 时）
 *
 * 6 类 agent role × 不同粒度，全部走 @DefineAgent + SKILL.md (frontmatter +
 * soul/duty body anchors) 模式（部分仍内联 prompt，后续逐步迁移到 SKILL.md）。
 */

// Leader：mission 唯一最终负责对象（multi-phase 单 class）
export * from "./leader";

// Researcher：dim 数据采集
export * from "./researcher";

// Reconciler：跨 dim 对账（[3.5] 节点）
export * from "./reconciler";

// Analyst：跨 dim 综合分析
export * from "./analyst";

// Writer：报告写作（单次成稿 + chapter pipeline）
export * from "./writer";

// Reviewer：主观质量评审（mission L3 + L4 + dim 5-axis）
export * from "./reviewer";

// Verifier：客观事实核验（引用 / 数字 / claim / 来源分级）
export * from "./verifier";

// Steward：资源 / 合规 / 边界守门
export * from "./steward";
