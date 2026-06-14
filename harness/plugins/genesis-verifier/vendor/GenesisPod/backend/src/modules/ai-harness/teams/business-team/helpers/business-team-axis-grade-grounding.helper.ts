/**
 * BusinessAgentTeam — Multi-Axis Grade Grounding Framework (P4 generic helper)
 *
 * "Grade grounding" mechanism = "discard the LLM's verbatim `overall` field and
 * recompute it from the axis scores, optionally capping a 'supply' axis by a
 * real measured ceiling so the LLM cannot inflate self-reported supply".
 *
 * @migrated-from ai-app grade-grounding.util.ts
 * (review-fix #3, 2026-05-23). The original use-case is *sources_sufficiency*
 * (LLM tends to score sources very high even when only 1 URL exists). But the
 * algorithm generalises: any multi-axis grading shape where one axis represents
 * a *measurable supply* (and other axes are LLM-judged prose qualities) benefits
 * from the same anti-fake-success grounding.
 *
 * Domain knobs are parameterised:
 *   - `supplyAxisKey`     — which axis to cap (default `"sources_sufficiency"`)
 *   - `supplyMultiplier`  — `score ≤ supplyMultiplier × measuredSupply`
 *                           (default 20: 1 source → ceil 20, 4 → 80, 5+ → 100)
 *   - `gradeBuckets`      — score → grade-string mapping
 *                           (default: excellent ≥80, good ≥65, fair ≥50, poor)
 *
 * Pure function, mutates the passed grade object in place (caller already holds
 * the reference and the original call-site relies on in-place mutation).
 */

export interface BusinessTeamGradeAxis {
  score: number;
  comment: string;
}

export interface BusinessTeamGradeShape {
  overall: number;
  grade: string;
  axes: unknown; // Record<string, BusinessTeamGradeAxis> — typed as unknown so the binding-shim caller (axes: unknown) does not need a cast.
}

export interface BusinessTeamGradeGroundingOptions {
  /** Which axis represents measurable supply (default: "sources_sufficiency"). */
  supplyAxisKey?: string;
  /** Per-unit ceiling multiplier (default 20: 5 units → 100). */
  supplyMultiplier?: number;
  /** Score → grade-string buckets (default: 80/65/50). */
  gradeBuckets?: ReadonlyArray<{ minScore: number; grade: string }>;
}

const DEFAULT_BUCKETS: ReadonlyArray<{ minScore: number; grade: string }> = [
  { minScore: 80, grade: "excellent" },
  { minScore: 65, grade: "good" },
  { minScore: 50, grade: "fair" },
  { minScore: 0, grade: "poor" },
];

/**
 * (a) Cap the supply axis by `supplyMultiplier × measuredSupply` (anti-fake-success).
 * (b) Recompute `overall` as the integer mean of all axis scores → frontend shows
 *     an overall that matches the displayed axes (no more "all axes low but
 *     overall = 80").
 * (c) Re-derive `grade` from `overall` using the bucket table → string label
 *     stays consistent with the score.
 *
 * Mutates `grade` in place (caller already holds the reference).
 *
 * @param grade           - The grade object to ground (axes: Record<string,{score,comment}>).
 * @param measuredSupply  - The real measured supply (e.g. uniqueSources count).
 * @param opts            - Per-team overrides; defaults match the original
 *                          binding-shim behaviour (R0-A5 — see @migrated-from).
 */
export function groundMultiAxisGrade(
  grade: BusinessTeamGradeShape,
  measuredSupply: number,
  opts: BusinessTeamGradeGroundingOptions = {},
): void {
  const supplyKey = opts.supplyAxisKey ?? "sources_sufficiency";
  const multiplier = opts.supplyMultiplier ?? 20;
  const buckets = opts.gradeBuckets ?? DEFAULT_BUCKETS;

  const axesRec = grade.axes as Record<string, BusinessTeamGradeAxis>;
  const supplyCeil = Math.min(100, Math.max(0, measuredSupply) * multiplier);
  if (axesRec[supplyKey]) {
    axesRec[supplyKey].score = Math.min(axesRec[supplyKey].score, supplyCeil);
  }
  const axisVals = Object.values(axesRec).map((a) => a.score);
  if (axisVals.length > 0) {
    grade.overall = Math.round(
      axisVals.reduce((a, b) => a + b, 0) / axisVals.length,
    );
    grade.grade = deriveGradeLabel(grade.overall, buckets);
  }
}

function deriveGradeLabel(
  score: number,
  buckets: ReadonlyArray<{ minScore: number; grade: string }>,
): string {
  // Buckets are expected in descending minScore order; pick the first match.
  // Defensive: if caller passes a malformed bucket list, fall back to "poor".
  for (const b of buckets) {
    if (score >= b.minScore) return b.grade;
  }
  return "poor";
}
