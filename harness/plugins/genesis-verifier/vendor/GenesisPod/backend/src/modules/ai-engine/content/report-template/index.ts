/**
 * ai-engine/content/report-template —— 报告格式化标准（沉淀自 ai-app/contracts, 2026-04-29）
 *
 * 13 类内容规则的唯一实现：
 *   L1 Prompt 常量 → L2 后处理 pipeline → L3 前端渲染
 *
 * 历史路径 `@/modules/ai-app/contracts/report-template` 保留 re-export shim，
 * TI 商用基线零改动；consumer/新 ai-app 应通过本路径或 ai-engine/facade 消费。
 */
export * from "./constants/report-writing-standards.constants";
export * from "./pipeline/report-formatting.util";
export * from "./pipeline/dimension-content-formatting.util";
// ★ 2026-04-30 (REPORT QUALITY OVERHAUL): 沉淀 TI 第三道铁墙 + full-report
//   后处理管线，让 consumer / 任意 ai-app 都能复用同一份。
//   2026-05-01 (PR-X-R): sanitize-output 真身在 ../../llm/output/sanitization/，
//   本 barrel 不再重复 re-export（消费方应直接走 ai-engine/facade）。
export * from "./pipeline/final-report-post-processing.util";
