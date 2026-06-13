/**
 * Step Decomposition — role-agnostic engine primitive (ADR-009)
 *
 * MECE placement: engine/planning — no agent/mission state. The service
 * receives a goal string and returns a raw step skeleton. Roles, rubrics,
 * and model election are handled by the harness caller.
 *
 * Consumers (≥2, preventing 0-injection dead-code repeat):
 *   1. SelfDrivenMissionPlanner (harness/teams/orchestrator) — P1
 *   2. LeaderLLMAdapter.decomposeTask (harness/teams/base)   — thin wrapper
 */

/** One atomic step produced by the role-agnostic decomposition primitive. */
export interface RawExecutionStep {
  /** Stable within one decomposition call; index-based id assigned by service. */
  id: string;

  /** Human-readable step name. */
  name: string;

  /** What this step must produce or accomplish. */
  description: string;

  /**
   * Step classification: identical to ExecutionStep.type so harness can copy
   * the field directly without conversion.
   */
  type: "task" | "review" | "integration" | "delivery";

  /**
   * Loop kind that best fits this step's execution pattern.
   * Harness writes this to ExecutionStep.loopKind.
   */
  loopKind: "react" | "plan-act" | "leader-worker";

  /** Indices (0-based) of steps this step depends on within the same batch. */
  dependencyIndices: number[];

  /** Estimated wall-clock duration in milliseconds. */
  estimatedDurationMs: number;
}

/** Input to the role-agnostic step decomposition primitive. */
export interface StepDecompositionInput {
  /** The full goal / objective to decompose. */
  goal: string;

  /**
   * Optional extra context (domain, constraints, etc.) passed as structured
   * data to the LLM prompt user-message. Must NOT contain time-stamps or
   * random ids (prompt-cache stability, Claude Code reverse-insight #7).
   */
  context?: Record<string, unknown>;

  /**
   * Maximum number of steps the LLM should produce (soft guidance).
   * Defaults to 8 if omitted.
   */
  maxSteps?: number;
}

/** Result from the role-agnostic step decomposition primitive. */
export interface StepDecompositionResult {
  /** Ordered list of raw steps (IDs are string versions of their 0-based index). */
  steps: RawExecutionStep[];
}

/** Port contract implemented by StepDecompositionService. */
export interface IStepDecompositionService {
  decompose(input: StepDecompositionInput): Promise<StepDecompositionResult>;
}

export const STEP_DECOMPOSITION_PORT = Symbol("STEP_DECOMPOSITION_PORT");
