import { Injectable, Logger } from "@nestjs/common";
import { ExecutionStep, MissionExecutionPlan } from "./orchestrator.interface";

// ─── Types ───

export type ReplanTriggerType =
  | "task_failed"
  | "quality_low"
  | "new_information"
  | "budget_exceeded";

export interface ReplanTrigger {
  type: ReplanTriggerType;
  taskId: string;
  details: string;
  /** Quality score if applicable (0-100) */
  qualityScore?: number;
  /** Error message if task failed */
  errorMessage?: string;
}

export interface StepExecutionResult {
  stepId: string;
  success: boolean;
  output?: unknown;
  duration?: number;
  tokensUsed?: number;
  qualityScore?: number;
}

/**
 * 单步骤（replan 输入快照视图）
 *
 * ⚠️ 命名说明：与 ai-harness/teams/orchestrator/orchestrator.interface.ts
 * 的 ExecutionStep 同名异物 —— 后者表达的是 mission "plan 描述"（含 executor /
 * type / estimatedDuration / estimatedCost / timeout / input），本类型表达的是
 * "replan 进度视图"（含 status 状态机）。
 *
 * 为消除阅读歧义，本类型显式命名为 ReplanStep。
 */
export interface ReplanStep {
  id: string;
  name: string;
  description: string;
  assignee?: string;
  dependencies?: string[];
  status: "pending" | "running" | "completed" | "failed" | "skipped";
}

/**
 * Replan 输入：当前 plan 的进度视图（步骤 + 完成进度）
 *
 * ⚠️ 命名说明：harness/orchestrator.interface.ts 也有 MissionExecutionPlan，
 * 是 mission 完整 plan（含 id / parsedIntent / estimatedCost 等）。本类型只是
 * replan 模块用来评估"是否需要重规划"的进度快照，故命名为 ReplanContext。
 */
export interface ReplanContext {
  steps: ReplanStep[];
  totalSteps: number;
  completedSteps: number;
}

export interface ReplanResult {
  /** Whether replanning was performed */
  replanned: boolean;
  /** Steps added to the plan */
  addedSteps: ReplanStep[];
  /** Step IDs removed from the plan */
  removedSteps: string[];
  /** Steps with modifications */
  modifiedSteps: Array<{ stepId: string; changes: string }>;
  /** Reasoning behind the replanning decision */
  reasoning: string;
}

// ─── Service ───

/**
 * AdaptiveReplannerService
 *
 * Evaluates whether a mission execution plan should be adjusted
 * based on step execution results, quality feedback, or resource constraints.
 *
 * Integrates with ReflectionService (which supports decision: 'pivot')
 * to convert pivot decisions into concrete plan adjustments.
 *
 * This is a rule-based replanner (not LLM-driven) for reliability.
 * Can be extended to use LLM for complex replanning decisions.
 */
@Injectable()
export class AdaptiveReplannerService {
  private readonly logger = new Logger(AdaptiveReplannerService.name);

  /**
   * Determine whether replanning is warranted based on a trigger event.
   *
   * Rules:
   * - task_failed: replan if the step has pending dependents
   * - quality_low: replan if score < 40 (below acceptable threshold)
   * - new_information: always replan (information changes scope)
   * - budget_exceeded: replan to reduce remaining steps
   */
  shouldReplan(
    trigger: ReplanTrigger,
    currentPlan: ReplanContext,
    _executionHistory: StepExecutionResult[],
  ): boolean {
    const { type, qualityScore } = trigger;

    switch (type) {
      case "task_failed": {
        // Replan if the failed step has downstream dependencies
        const failedStep = currentPlan.steps.find(
          (s) => s.id === trigger.taskId,
        );
        if (!failedStep) return false;

        const hasDependents = currentPlan.steps.some(
          (s) =>
            s.dependencies?.includes(trigger.taskId) && s.status === "pending",
        );
        if (hasDependents) {
          this.logger.log(
            `[shouldReplan] task_failed: ${trigger.taskId} has pending dependents`,
          );
          return true;
        }
        return false;
      }

      case "quality_low": {
        const threshold = 40;
        if (qualityScore !== undefined && qualityScore < threshold) {
          this.logger.log(
            `[shouldReplan] quality_low: score=${qualityScore} < ${threshold}`,
          );
          return true;
        }
        return false;
      }

      case "new_information":
        this.logger.log(`[shouldReplan] new_information: always replan`);
        return true;

      case "budget_exceeded": {
        const pendingSteps = currentPlan.steps.filter(
          (s) => s.status === "pending",
        ).length;
        if (pendingSteps > 1) {
          this.logger.log(
            `[shouldReplan] budget_exceeded: ${pendingSteps} pending steps to reduce`,
          );
          return true;
        }
        return false;
      }

      default:
        return false;
    }
  }

  /**
   * Generate a replanning result based on the trigger.
   */
  replan(
    trigger: ReplanTrigger,
    currentPlan: ReplanContext,
    _executionHistory: StepExecutionResult[],
  ): ReplanResult {
    switch (trigger.type) {
      case "task_failed":
        return this.replanForFailure(trigger, currentPlan);
      case "quality_low":
        return this.replanForQuality(trigger, currentPlan);
      case "budget_exceeded":
        return this.replanForBudget(trigger, currentPlan);
      case "new_information":
        return this.replanForNewInfo(trigger, currentPlan);
      default:
        return {
          replanned: false,
          addedSteps: [],
          removedSteps: [],
          modifiedSteps: [],
          reasoning: "Unknown trigger type",
        };
    }
  }

  // ─── Private Strategies ───

  private replanForFailure(
    trigger: ReplanTrigger,
    plan: ReplanContext,
  ): ReplanResult {
    // Skip dependents of the failed step
    const stepsToSkip = plan.steps
      .filter(
        (s) =>
          s.dependencies?.includes(trigger.taskId) && s.status === "pending",
      )
      .map((s) => s.id);

    // Add a retry step for the failed task
    const retryStep: ReplanStep = {
      id: `retry-${trigger.taskId}-${Date.now()}`,
      name: `Retry: ${trigger.taskId}`,
      description: `Retry after failure: ${trigger.details}`,
      status: "pending",
      dependencies: [],
    };

    return {
      replanned: true,
      addedSteps: [retryStep],
      removedSteps: stepsToSkip,
      modifiedSteps: [],
      reasoning: `Task ${trigger.taskId} failed. Added retry step, skipped ${stepsToSkip.length} dependent steps.`,
    };
  }

  private replanForQuality(
    trigger: ReplanTrigger,
    _plan: ReplanContext,
  ): ReplanResult {
    // Add a revision step
    const revisionStep: ReplanStep = {
      id: `revise-${trigger.taskId}-${Date.now()}`,
      name: `Revise: ${trigger.taskId}`,
      description: `Quality too low (${trigger.qualityScore}/100): ${trigger.details}`,
      status: "pending",
      dependencies: [trigger.taskId],
    };

    return {
      replanned: true,
      addedSteps: [revisionStep],
      removedSteps: [],
      modifiedSteps: [],
      reasoning: `Quality score ${trigger.qualityScore}/100 below threshold. Added revision step.`,
    };
  }

  private replanForBudget(
    _trigger: ReplanTrigger,
    plan: ReplanContext,
  ): ReplanResult {
    // Skip low-priority pending steps
    const pendingSteps = plan.steps.filter((s) => s.status === "pending");

    // Keep at most 2 pending steps (the most important ones)
    const stepsToSkip =
      pendingSteps.length > 2 ? pendingSteps.slice(2).map((s) => s.id) : [];

    return {
      replanned: stepsToSkip.length > 0,
      addedSteps: [],
      removedSteps: stepsToSkip,
      modifiedSteps: [],
      reasoning: `Budget exceeded. Skipped ${stepsToSkip.length} lower-priority pending steps.`,
    };
  }

  private replanForNewInfo(
    trigger: ReplanTrigger,
    plan: ReplanContext,
  ): ReplanResult {
    // Mark all pending steps as needing re-evaluation
    const modified = plan.steps
      .filter((s) => s.status === "pending")
      .map((s) => ({
        stepId: s.id,
        changes: `Re-evaluate in light of: ${trigger.details}`,
      }));

    return {
      replanned: modified.length > 0,
      addedSteps: [],
      removedSteps: [],
      modifiedSteps: modified,
      reasoning: `New information received. ${modified.length} pending steps flagged for re-evaluation.`,
    };
  }

  /**
   * T7 (G1): apply a ReplanResult to a live MissionExecutionPlan **in place**.
   *
   * Safe by construction:
   * - removes only steps that are neither completed nor currently running;
   * - adds steps only when the id is new and every dependency resolves (exists
   *   in the plan or is already completed);
   * - rolls back additions that would introduce a dependency cycle;
   * - defers `modifiedSteps` (its `changes` is free-text, not machine-applicable).
   *
   * executePlan() re-evaluates `plan.steps` every tick, so the mutation is picked
   * up on the next scheduling pass without restarting the loop.
   */
  applyToPlan(
    plan: MissionExecutionPlan,
    result: ReplanResult,
    ctx: {
      completedStepIds: ReadonlySet<string>;
      runningStepIds: ReadonlySet<string>;
    },
  ): { added: string[]; removed: string[]; skipped: string[] } {
    const skipped: string[] = [];

    // 1. remove — never drop completed/running steps
    const removable = new Set(
      result.removedSteps.filter(
        (id) => !ctx.completedStepIds.has(id) && !ctx.runningStepIds.has(id),
      ),
    );
    for (const id of result.removedSteps) {
      if (!removable.has(id)) skipped.push(id);
    }
    if (removable.size > 0) {
      plan.steps = plan.steps.filter((s) => !removable.has(s.id));
    }

    // 2. add — unique id + resolvable dependencies
    const existingIds = new Set(plan.steps.map((s) => s.id));
    const added: string[] = [];
    for (const rs of result.addedSteps) {
      const deps = rs.dependencies ?? [];
      const depsResolvable = deps.every(
        (d) => existingIds.has(d) || ctx.completedStepIds.has(d),
      );
      if (existingIds.has(rs.id) || !depsResolvable) {
        skipped.push(rs.id);
        continue;
      }
      plan.steps.push(this.replanStepToExecutionStep(rs));
      existingIds.add(rs.id);
      added.push(rs.id);
    }

    // 3. cycle guard — roll back additions if they introduced a cycle
    if (added.length > 0 && this.hasDependencyCycle(plan.steps)) {
      plan.steps = plan.steps.filter((s) => !added.includes(s.id));
      this.logger.warn(
        `[applyToPlan] additions introduced a dependency cycle; rolled back: ${added.join(", ")}`,
      );
      skipped.push(...added);
      added.length = 0;
    }

    return { added, removed: [...removable], skipped };
  }

  /** ReplanStep (replan 视图) → ExecutionStep (执行视图)。recovery 步骤用固定估算。 */
  private replanStepToExecutionStep(rs: ReplanStep): ExecutionStep {
    return {
      id: rs.id,
      name: rs.name,
      description: rs.description,
      // 无 assignee → executor 空串，executePlan 兜底到 team.leader。
      executor: rs.assignee ?? "",
      type: "task",
      dependencies: rs.dependencies ?? [],
      estimatedDuration: 30000,
      estimatedCost: 5,
    };
  }

  /** DFS 检测有向依赖图是否存在环（dependencies 指向前置步骤）。 */
  private hasDependencyCycle(steps: ExecutionStep[]): boolean {
    const byId = new Map(steps.map((s) => [s.id, s]));
    const mark = new Map<string, 0 | 1>(); // 0 = visiting, 1 = done
    const visit = (id: string): boolean => {
      const m = mark.get(id);
      if (m === 0) return true; // back-edge → cycle
      if (m === 1) return false;
      mark.set(id, 0);
      for (const dep of byId.get(id)?.dependencies ?? []) {
        if (byId.has(dep) && visit(dep)) return true;
      }
      mark.set(id, 1);
      return false;
    };
    return steps.some((s) => visit(s.id));
  }
}
