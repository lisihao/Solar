/**
 * Re-export shim — 实现已沉淀到 ai-engine/content/report-template/pipeline (2026-04-29)。
 * 维持 TI 历史 deep import 路径不变。
 *
 * 2026-05-01 (PR-X-N): contracts/* 是有意识的 backwards-compat 隧道，
 * 在 arch spec / ESLint 中明确 allowlist
 */
// eslint-disable-next-line no-restricted-imports
export * from "@/modules/ai-engine/content/report-template/pipeline/report-formatting.util";
