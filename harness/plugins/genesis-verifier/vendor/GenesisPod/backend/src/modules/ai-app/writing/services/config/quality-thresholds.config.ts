/**
 * Quality Thresholds Configuration
 *
 * Centralized quality gate thresholds for the three-stage quality pipeline.
 */

/**
 * Stage 1: Structural Gate (Code Gate, 0 LLM calls)
 */
export const STRUCTURAL_GATE = {
  /** Minimum word count for chapter content */
  MIN_CHAPTER_WORDS: 200,
  /** Minimum word count for outline content */
  MIN_OUTLINE_WORDS: 50,
  /** Maximum expression cooldown violations before blocking */
  MAX_EXPRESSION_VIOLATIONS: 5,
  /** Auto-fix: replace expressions exceeding cooldown */
  AUTO_FIX_EXPRESSIONS: true,
} as const;

/**
 * Stage 2: Content Gate (LLM quality scoring)
 */
export const CONTENT_GATE = {
  /** Minimum overall quality score to pass (0-100) */
  MIN_OVERALL_SCORE: 70,
  /** Minimum coherence score */
  MIN_COHERENCE_SCORE: 60,
  /** Minimum consistency score */
  MIN_CONSISTENCY_SCORE: 65,
  /** Minimum completeness score */
  MIN_COMPLETENESS_SCORE: 60,
  /** Quality dimensions and weights */
  DIMENSION_WEIGHTS: {
    coherence: 0.25,
    consistency: 0.25,
    completeness: 0.2,
    wordCount: 0.15,
    narrativeCraft: 0.15,
  },
} as const;

/**
 * Stage 3: Critique-Refine (iterative LLM improvement)
 */
export const CRITIQUE_REFINE = {
  /** Maximum refinement iterations */
  MAX_ITERATIONS: 2,
  /** Minimum score improvement to continue iterating */
  MIN_IMPROVEMENT: 5,
  /** Score threshold to skip critique (already good enough) */
  SKIP_THRESHOLD: 85,
  /** Score convergence window (stop if improvement < this) */
  CONVERGENCE_WINDOW: 3,
} as const;

/**
 * Narrative craft thresholds
 */
export const NARRATIVE_CRAFT = {
  /** NarrativeCraft score threshold for auto-rewrite */
  AUTO_REWRITE_THRESHOLD: 70,
  /** Issue types that trigger auto-rewrite */
  AUTO_REWRITE_TRIGGERS: [
    "ending",
    "ai_writing_cliche",
    "excessive_psychology",
  ] as const,
} as const;
