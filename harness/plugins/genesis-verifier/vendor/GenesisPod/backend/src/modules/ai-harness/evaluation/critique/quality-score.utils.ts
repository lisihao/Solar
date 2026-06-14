/**
 * Quality score 工具 —— 统一所有 reportArtifact.quality.* 字段写入的边界保护
 *
 * 背景（P1-NEW-C, round 2 修补）：ArtifactQualityVerdicts 是 TS interface 不是
 * zod schema，无运行时校验。各 stage 写入分数时若上游是 NaN/Infinity/负数/超 100，
 * 会污染前端柱状图（出现 -X 或 inf 的诡异显示）。
 *
 * 这里提供：
 *   clampScore(n)  -> 0-100 整数，NaN/Infinity 兜底为 0
 *   scaleScore(cur, factor) -> cur * factor 的 clamp 整数版（封装常见模式）
 */

export function clampScore(n: unknown): number {
  if (typeof n !== "number" || isNaN(n) || !isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function scaleScore(current: unknown, factor: number): number {
  return clampScore((typeof current === "number" ? current : 0) * factor);
}
