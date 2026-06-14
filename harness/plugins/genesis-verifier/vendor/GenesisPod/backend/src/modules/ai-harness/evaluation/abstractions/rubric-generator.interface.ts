/**
 * RubricGenerator — abstractions
 *
 * Canonical source of the IRubricGenerator port and its supporting types.
 * Lives in harness/evaluation/abstractions/ per the MECE rule: every aggregate
 * owns its own abstractions/ (§10, mece-05).
 *
 * The concrete implementation (RubricGeneratorService) calls AiChatService and
 * therefore belongs in harness/evaluation (harness layer, not engine/evaluation
 * which must remain LLM-free).
 *
 * passLine clamp: [REVIEW_PASS_THRESHOLD=60, RUBRIC_PASS_LINE_CAP=90].
 * Design reference: docs/architecture/ai-harness/self-driven-team/ §5.2/§9.
 */

/** A single rubric dimension with acceptance threshold. */
export interface RubricDimension {
  /** Human-readable dimension label (e.g. "accuracy", "completeness"). */
  dimension: string;
  /**
   * Relative importance weight in [0, 1]. Caller is responsible for ensuring
   * weights sum to 1 across all dimensions (or treating them as unnormalized).
   */
  weight: number;
  /**
   * Minimum score [0–100] required for this dimension to pass.
   * Always clamped to [REVIEW_PASS_THRESHOLD, RUBRIC_PASS_LINE_CAP] = [60, 90].
   */
  passLine: number;
}

/** Input contract for rubric generation. */
export interface RubricGenerationInput {
  /** The user's clarified request / objective. */
  prompt: string;
  /** Deliverable type. v1 only ships "report". */
  deliverableType: "report";
  /** Optional userId for BYOK key resolution. */
  userId?: string;
  /** Cooperative cancellation. */
  signal?: AbortSignal;
}

/** Port implemented by RubricGeneratorService. */
export interface IRubricGenerator {
  generate(input: RubricGenerationInput): Promise<RubricDimension[]>;
}
