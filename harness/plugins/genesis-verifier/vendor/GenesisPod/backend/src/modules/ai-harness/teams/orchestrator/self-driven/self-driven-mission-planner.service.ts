/**
 * SelfDrivenMissionPlannerService — harness-level mission planner.
 *
 * Placement: harness/teams/orchestrator (ADR-009).
 * Produces the extended MissionExecutionPlan (roleAssignments / rubric /
 * deliverableType / loopKind per step).
 *
 * Internal chain:
 *   1. engine StepDecompositionService  → role-agnostic step skeleton (loopKind included)
 *   2. harness RubricGeneratorService   → LLM acceptance rubric (passLine clamped [60,90])
 *   3. per-role model election          → engine ModelElectionService.elect() per role
 *                                          (tier/role/health/cost scored + diversity)
 *   4. cost + duration estimation       → summed from step estimatedDurationMs
 *
 * Model selection is NOT hand-rolled here — it delegates to the shared
 * ModelElectionService capability, so roles get differentiated models and the
 * scoring/BYOK/health logic lives in one place.
 *
 * Prompt-cache safety (reverse-insights #3/#7):
 *   - system prompts in RubricGeneratorService are static (no timestamps/random ids)
 *   - dynamic content (prompt, deliverableType) goes into user-role messages only
 */

import { Injectable, Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import { StepDecompositionService } from "../../../../ai-engine/planning/decomposition/step-decomposition.service";
import { RubricGeneratorService } from "../../../evaluation/rubric/rubric-generator.service";
// Shared engine model-election capability (NOT hand-rolled). Direct source
// import (not the facade barrel) to avoid the value-import circular-load class.
import { ModelElectionService } from "../../../../ai-engine/llm/models/selection/model-election.service";
import type { ElectionRoleHint } from "../../../../ai-engine/llm/models/selection/model-election.types";
import type {
  ISelfDrivenMissionPlanner,
  SelfDrivenPlannerInput,
} from "../abstractions/self-driven-mission-planner.interface";
import type {
  ExecutionStep,
  MissionExecutionPlan,
  RoleAssignment,
} from "../orchestrator.interface";
import type { RawExecutionStep } from "../../../../ai-engine/planning/decomposition/abstractions/step-decomposition.interface";
import type { ParsedIntent } from "../../../agents/abstractions/mission.types";

// ---------------------------------------------------------------------------
// Role-to-modelType mapping for per-role election (P1 lite).
// Leader / critic roles get the stronger CHAT model; parallel workers default
// to CHAT (CHAT_FAST wiring arrives in P2 with full ScoredRouter election).
// ---------------------------------------------------------------------------

/** Known role ids the planner recognises for slot extraction. */
const KNOWN_ROLES = [
  "researcher",
  "analyst",
  "writer",
  "critic",
  "leader",
  "domain-expert",
  "reviewer",
  "integrator",
] as const;

type KnownRole = (typeof KNOWN_ROLES)[number];

/** How many unique roles the planner may assign per plan (safety cap). */
const MAX_ROLES = 5;

/** Analysis depth → step-decomposition step budget. */
function depthToMaxSteps(
  depth: "quick" | "standard" | "deep" | undefined,
): number {
  switch (depth) {
    case "quick":
      return 4;
    case "deep":
      return 12;
    case "standard":
    default:
      return 8;
  }
}

/** Fallback single role when LLM decomposition yields no useful role hints. */
const FALLBACK_ROLE: KnownRole = "researcher";

/** Map a self-driven role to the ModelElectionService role hint (tier/lens). */
function toElectionRoleHint(roleId: string): ElectionRoleHint {
  switch (roleId) {
    case "leader":
      return "leader";
    case "critic":
    case "reviewer":
      return "reviewer";
    case "writer":
    case "integrator":
      return "writer";
    case "researcher":
    case "analyst":
    case "domain-expert":
      return "researcher";
    default:
      return "default";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Infer a role from a RawExecutionStep's type/name/description.
 * Rule: delivery → writer; review → reviewer; integration → integrator;
 * task → researcher (default parallel worker role).
 */
function inferRole(step: RawExecutionStep, index: number): KnownRole {
  if (step.type === "delivery") return "writer";
  if (step.type === "review") return "reviewer";
  if (step.type === "integration") return "integrator";
  // "task" steps: use index 0 as analyst (planning / scoping), rest as researcher
  return index === 0 ? "analyst" : "researcher";
}

/**
 * Estimate a flat USD cost proxy from step duration.
 * Very rough heuristic: 1 s ≈ $0.0001 (token budget at $1/1M tokens × ~100 tok/s).
 * The planner is intentionally imprecise here; a real billing projection is P2.
 */
function estimateCostFromDuration(durationMs: number): number {
  return Math.round((durationMs / 1000) * 0.0001 * 100_000) / 100_000;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class SelfDrivenMissionPlannerService implements ISelfDrivenMissionPlanner {
  private readonly logger = new Logger(SelfDrivenMissionPlannerService.name);

  constructor(
    private readonly decomposition: StepDecompositionService,
    private readonly rubricGenerator: RubricGeneratorService,
    private readonly modelElection: ModelElectionService,
  ) {}

  /**
   * Plan a self-driven mission.
   *
   * @param input  Clarified user request + userId for BYOK key resolution.
   * @returns      Extended MissionExecutionPlan (roleAssignments / rubric /
   *               deliverableType / loopKind per step all populated).
   */
  async plan(input: SelfDrivenPlannerInput): Promise<MissionExecutionPlan> {
    const planId = uuidv4();
    const missionId = uuidv4();

    this.logger.log(
      `[SelfDrivenPlanner] planning mission ${missionId} for user ${input.userId}: "${input.prompt.slice(0, 60)}..."`,
    );

    // ── Step 1: role-agnostic step decomposition (engine primitive) ──────────
    const rawSteps = await this.decomposeSteps(input);

    // ── Step 2: LLM rubric generation (harness/evaluation) ──────────────────
    const rubric = await this.generateRubric(input);

    // ── Step 3: per-role model election (lite, P1) ───────────────────────────
    const roleAssignments = await this.electRoles(rawSteps, input.userId);

    // ── Step 4: assemble ExecutionStep[] (with loopKind + dependencies) ──────
    const stepIds = rawSteps.map(() => uuidv4());
    const steps: ExecutionStep[] = rawSteps.map((raw, i) =>
      this.assembleStep(raw, i, stepIds, roleAssignments),
    );

    // Disambiguate duplicate step names so the progress UI never renders two
    // identical rows — the decomposition LLM occasionally emits e.g. two review
    // steps both named "审查报告质量". Suffix repeats with a 1-based counter.
    this.disambiguateStepNames(steps);

    // ── Step 5: aggregate timing + cost estimates ─────────────────────────────
    const estimatedDuration = steps.reduce(
      (sum, s) => sum + s.estimatedDuration,
      0,
    );
    const estimatedCost = steps.reduce((sum, s) => sum + s.estimatedCost, 0);

    const parsedIntent: ParsedIntent = {
      id: uuidv4(),
      missionId,
      primaryGoal: input.prompt,
      secondaryGoals: [],
      extractedInfo: {
        topics: [],
        entities: [],
      },
      taskType: "mixed",
      complexity: {
        overall: "medium",
        informational: "medium",
        logical: "medium",
        creative: "low",
        estimatedSubTasks: steps.length,
        estimatedDuration: estimatedDuration,
        estimatedCost: estimatedCost,
      },
      suggestedStrategy: {
        workflowType: steps.some((s) => s.loopKind === "leader-worker")
          ? "parallel"
          : "sequential",
        memberConfig: roleAssignments.map((ra) => ({
          roleId: ra.roleId,
          count: 1,
          modelSuggestion: ra.modelId,
          reason: "elected by SelfDrivenMissionPlanner",
        })),
        needsIteration: false,
        needsHumanReview: false,
        riskFactors: [],
      },
      confidence: 0.8,
    };

    const plan: MissionExecutionPlan = {
      id: planId,
      missionId,
      parsedIntent,
      steps,
      estimatedCost: Math.round(estimatedCost * 1_000_000) / 1_000_000,
      estimatedDuration,
      createdAt: new Date(),
      roleAssignments,
      rubric,
      deliverableType: "report",
    };

    this.logger.log(
      `[SelfDrivenPlanner] plan ${planId}: ${steps.length} steps, ` +
        `${roleAssignments.length} roles, duration≈${estimatedDuration}ms, cost≈$${plan.estimatedCost}`,
    );

    return plan;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async decomposeSteps(
    input: SelfDrivenPlannerInput,
  ): Promise<RawExecutionStep[]> {
    try {
      const result = await this.decomposition.decompose({
        goal: input.prompt,
        context: input.context,
        maxSteps: depthToMaxSteps(input.analysisDepth),
      });
      this.logger.debug(
        `[SelfDrivenPlanner] decomposed → ${result.steps.length} raw steps`,
      );
      return result.steps;
    } catch (err) {
      this.logger.warn(
        `[SelfDrivenPlanner] decomposition failed, using single-step fallback: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [
        {
          id: "0",
          name: "Execute",
          description: input.prompt,
          type: "task",
          loopKind: "react",
          dependencyIndices: [],
          estimatedDurationMs: 120_000,
        },
      ];
    }
  }

  private async generateRubric(
    input: SelfDrivenPlannerInput,
  ): Promise<Array<{ dimension: string; weight: number; passLine: number }>> {
    try {
      const dims = await this.rubricGenerator.generate({
        prompt: input.prompt,
        deliverableType: "report",
        userId: input.userId,
        signal: input.signal,
      });
      return dims;
    } catch (err) {
      this.logger.warn(
        `[SelfDrivenPlanner] rubric generation failed, using defaults: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Sensible defaults (passLine already within [60,90] range).
      return [
        { dimension: "accuracy", weight: 0.35, passLine: 75 },
        { dimension: "completeness", weight: 0.3, passLine: 70 },
        { dimension: "clarity", weight: 0.2, passLine: 65 },
        { dimension: "actionability", weight: 0.15, passLine: 65 },
      ];
    }
  }

  /**
   * Lite per-role election (P1).
   *
   * Derives unique roles from the step skeleton, then resolves a modelId for
   * each role from the list of available models returned by AiChatService.
   * The first available model is used for all roles (uniform assignment).
   * Full ScoredRouter election with per-role modelType routing lands in P2.
   */
  private async electRoles(
    rawSteps: RawExecutionStep[],
    userId: string,
  ): Promise<RoleAssignment[]> {
    // Derive up to MAX_ROLES unique roles from the step skeleton.
    const roleSet = new Set<string>();
    rawSteps.forEach((step, i) => {
      if (roleSet.size >= MAX_ROLES) return;
      roleSet.add(inferRole(step, i));
    });
    if (roleSet.size === 0) roleSet.add(FALLBACK_ROLE);

    // Per-role model election via the shared ModelElectionService (engine
    // capability) — tier/role/health/cost scored with mission-scoped diversity.
    // Replaces the previous hand-rolled "first available model for all roles":
    // roles now get differentiated models (leader→reasoning, writer→narrative
    // STRONG, extractor→BASIC, ...) exactly as the election service intends.
    const assignments: RoleAssignment[] = [];
    const elected: string[] = [];
    for (const roleId of roleSet) {
      try {
        const r = await this.modelElection.elect({
          modelType: AIModelType.CHAT,
          candidates: [], // [] → service loads enabled CHAT models from DB
          role: toElectionRoleHint(roleId),
          userId,
          previouslyElected: elected,
        });
        elected.push(r.elected.modelId);
        assignments.push({ roleId, modelId: r.elected.modelId });
        this.logger.log(`[SelfDrivenPlanner] role=${roleId} → ${r.reason}`);
      } catch (err) {
        // NoEligibleModelError etc. — surface the ROOT cause loudly here; leave
        // modelId empty so the downstream team-build failure is explained.
        this.logger.error(
          `[SelfDrivenPlanner] model election failed for role "${roleId}" ` +
            `(user ${userId}): ${err instanceof Error ? err.message : String(err)} ` +
            `— enable a CHAT model (Admin Console) or configure a user BYOK key.`,
        );
        assignments.push({ roleId, modelId: "" });
      }
    }
    return assignments;
  }

  /**
   * Append a 1-based counter to any step name that occurs more than once, so the
   * progress list shows distinct labels (e.g. "Review (1)" / "Review (2)").
   */
  private disambiguateStepNames(steps: ExecutionStep[]): void {
    const totals = new Map<string, number>();
    for (const s of steps) totals.set(s.name, (totals.get(s.name) ?? 0) + 1);
    const seen = new Map<string, number>();
    for (const s of steps) {
      if ((totals.get(s.name) ?? 0) > 1) {
        const n = (seen.get(s.name) ?? 0) + 1;
        seen.set(s.name, n);
        s.name = `${s.name} (${n})`;
      }
    }
  }

  private assembleStep(
    raw: RawExecutionStep,
    index: number,
    stepIds: string[],
    roleAssignments: RoleAssignment[],
  ): ExecutionStep {
    // Resolve dependency IDs from 0-based indices.
    const dependencies = raw.dependencyIndices
      .filter((di) => di >= 0 && di < stepIds.length)
      .map((di) => stepIds[di]);

    // Pick executor: infer role then resolve to its assigned modelId.
    const roleId = inferRole(raw, index);
    const assignment = roleAssignments.find((a) => a.roleId === roleId);
    const executor = assignment?.roleId ?? roleId;

    return {
      id: stepIds[index],
      name: raw.name,
      description: raw.description,
      executor,
      type: raw.type,
      loopKind: raw.loopKind,
      dependencies,
      estimatedDuration: raw.estimatedDurationMs,
      estimatedCost: estimateCostFromDuration(raw.estimatedDurationMs),
    };
  }
}
