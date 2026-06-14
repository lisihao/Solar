/**
 * Report Template - Shared Report Formatting Standards (re-export shim)
 *
 * 实现已沉淀到 ai-engine/content/report-template (2026-04-29)。
 * 本 shim 维持原 import 路径不变，TI 等商用模块零改动。
 *
 * 新模块（Playground 等）请改从 `@/modules/ai-harness/facade` 或
 * `@/modules/ai-engine/content/report-template` 直接导入。
 */
// 2026-05-01 (PR-X-N): contracts/* 是有意识的"backwards-compat 隧道"，
// 在 arch spec / ESLint 已明确 allowlist；shim 仍指向 engine 内部 barrel
// 以保留原 export 边界（不污染调用方 namespace）
// eslint-disable-next-line no-restricted-imports
export * from "@/modules/ai-engine/content/report-template";
