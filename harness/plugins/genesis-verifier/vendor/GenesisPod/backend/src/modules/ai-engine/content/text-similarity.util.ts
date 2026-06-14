/**
 * text-similarity.util.ts (content/ 聚合根：轴外跨领域纯原语，无内容子能力可归)
 *
 * Lightweight text similarity helpers (zero LLM calls).
 * Pure token-set similarity primitives — no agent / mission state, fits
 * ai-engine/content per standards/16 §二 (engine 判别口诀: "不需要知道
 * agent / mission 即能做的事" → engine).
 *
 * Original use case: per-dim chapter pipeline detects "stuck revision"
 * loops where successive drafts are virtually identical despite repeated
 * reviewer-reject → revise cycles. Generic enough for any ai-app.
 *
 * Lifted from ai-app/{app} 2026-05-04 (PR-6 standardize consumer).
 */

/**
 * Jaccard similarity over word tokens (length > 2, case-insensitive).
 * Returns a value in [0, 1] where 1 = identical token sets.
 */
export function jaccardSimilarity(a: string, b: string): number {
  const tokensA = new Set(
    a
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
  const tokensB = new Set(
    b
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  const intersection = new Set([...tokensA].filter((x) => tokensB.has(x)));
  const union = new Set([...tokensA, ...tokensB]);
  return intersection.size / union.size;
}
