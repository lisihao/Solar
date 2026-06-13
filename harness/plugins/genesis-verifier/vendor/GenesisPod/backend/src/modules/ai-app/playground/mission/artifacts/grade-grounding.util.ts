/**
 * grade-grounding.util.ts — playground binding shim over harness multi-axis grading framework
 *
 * Wave-1 P4 (2026-05-24): The multi-axis grade-grounding mechanism
 * (LLM-verbatim discard + supply-axis ceiling + axis-mean recompute + grade
 * label rederive) was generic enough to be extracted to ai-harness. The
 * playground-specific knobs ("sources_sufficiency" axis, 20-per-unit multiplier,
 * excellent/good/fair/poor buckets) are the framework defaults so this shim is
 * a one-line forward.
 *
 * Public surface unchanged so the per-dim-pipeline call-site keeps working.
 */

import { groundMultiAxisGrade } from "@/modules/ai-harness/facade";

/**
 * (a) sources_sufficiency 按真实 uniqueSources 平滑封顶（1→20 / 4→80 / 5+→100）。
 * (b) overall 由各轴均值重算，与展示一致；grade 标签随之派生。
 *
 * 原地修改传入对象（caller 已持有引用）。
 */
export function groundDimensionGrade(
  grade: { overall: number; grade: string; axes: unknown },
  uniqueSources: number,
): void {
  groundMultiAxisGrade(grade, uniqueSources);
}
