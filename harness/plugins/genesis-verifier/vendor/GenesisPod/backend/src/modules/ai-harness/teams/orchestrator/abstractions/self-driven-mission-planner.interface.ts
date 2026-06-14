/**
 * ISelfDrivenMissionPlanner — port contract for the harness-level mission planner.
 *
 * Canonical source of the planner interface.  Lives in
 * teams/orchestrator/abstractions/ per the MECE rule (each aggregate owns its
 * own abstractions/).
 *
 * Design reference:
 *   docs/architecture/ai-harness/self-driven-team/ §5.1 / ADR-009 / ADR-011
 *
 * Dependency direction:
 *   SelfDrivenMissionPlannerService (implementation) ← consumes:
 *     - engine StepDecompositionService (role-agnostic step skeleton)
 *     - harness RubricGeneratorService  (LLM-generated acceptance rubric)
 *     - engine AiChatService            (via AiChatService injection)
 *     - engine AiModelConfigService     (candidate pool for per-role election)
 *
 * Output: extended MissionExecutionPlan (roleAssignments / rubric / deliverableType).
 */

import type { MissionExecutionPlan } from "../orchestrator.interface";
import type { SelfDrivenAnalysisDepth } from "./self-driven-mission.types";

/** Input that drives one SelfDrivenMissionPlanner.plan() call. */
export interface SelfDrivenPlannerInput {
  /** Clarified user request / objective. */
  prompt: string;
  /** Owning user id (BYOK key resolution). */
  userId: string;
  /** Optional context hints (domain, constraints, etc.). Must NOT include
   *  timestamps or random ids (prompt-cache stability, reverse-insight #3/#7). */
  context?: Record<string, unknown>;
  /** Analysis depth — controls step-decomposition maxSteps (default "standard"). */
  analysisDepth?: SelfDrivenAnalysisDepth;
  /** Cooperative cancellation. */
  signal?: AbortSignal;
}

/** Port implemented by SelfDrivenMissionPlannerService. */
export interface ISelfDrivenMissionPlanner {
  /**
   * Plan a self-driven mission.
   *
   * Chain: step skeleton (engine) → rubric (harness) → per-role election → cost estimate.
   * Returns an extended MissionExecutionPlan with roleAssignments, rubric,
   * and deliverableType populated.
   */
  plan(input: SelfDrivenPlannerInput): Promise<MissionExecutionPlan>;
}

export const SELF_DRIVEN_MISSION_PLANNER = Symbol(
  "SELF_DRIVEN_MISSION_PLANNER",
);
