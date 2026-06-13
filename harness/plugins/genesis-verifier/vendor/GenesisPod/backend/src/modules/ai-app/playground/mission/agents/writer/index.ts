/**
 * Writer stage agents — barrel export
 *
 * 现状：每个 mode 一个独立 @DefineAgent class（保持 orchestrator 现有 wiring）。
 * 长期方向：合并到单一 WriterAgent (multi-mode discriminatedUnion)，prompt body
 * 已在 SKILL.md duty anchors 就位（chapter / dimension-outline / mission-outline /
 * single-shot），class 合并留给后续 PR。
 *
 * 两条互斥执行路径（由 depth + auditLayers 决定走哪条）:
 *
 *   单次成稿 (quick mode):
 *     - SingleShotWriterAgent          整篇一次性生成 markdown
 *
 *   章节流水线 (chapter mode, standard / deep):
 *     - MissionOutlinePlannerAgent     mission 级章节框架（W1）
 *     - DimensionOutlinePlannerAgent   每 dim 拆 3-5 章
 *     - ChapterWriterAgent             单章节写作（并发 N）
 *     - ChapterReviewerAgent           单章节 QA gate
 *     - DimensionIntegratorAgent       章节合成 dim section
 */

export { SingleShotWriterAgent } from "./single-shot-writer.agent";
export { MissionOutlinePlannerAgent } from "./mission-outline-planner.agent";
export { DimensionOutlinePlannerAgent } from "./dimension-outline-planner.agent";
export { ChapterWriterAgent } from "./chapter-writer.agent";
export { ChapterReviewerAgent } from "./chapter-reviewer.agent";
export { DimensionIntegratorAgent } from "./dimension-integrator.agent";
