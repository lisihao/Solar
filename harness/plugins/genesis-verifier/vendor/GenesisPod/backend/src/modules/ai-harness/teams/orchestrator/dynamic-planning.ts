/**
 * T6 (G1 动态规划) — LLM 任务分解 → ExecutionStep[] 的纯函数集合。
 *
 * 从 TeamsMissionOrchestrator 抽出，避免 god-class 继续膨胀（pre-push god-class
 * 看护：>2500 行文件单次净增 >50 行拒推）。orchestrator.plan() 调用 tryDynamic-
 * Decomposition()，失败/不满足条件时回落静态 workflow。
 */
import { Logger } from "@nestjs/common";
import { ITeam } from "../abstractions/team.interface";
import { RoleId } from "../abstractions/role.interface";
import { ILeader, SubTask, TaskInput } from "../abstractions/member.interface";
import { ParsedIntent } from "../../agents/abstractions/mission.types";
import { MissionExecutionProfile } from "../constraints";
import { ExecutionStep } from "./orchestrator.interface";

/** 步骤耗时/成本估算器（由 orchestrator 注入，复用其内部公式，避免重复）。 */
export interface PlanningEstimators {
  estimateStepDuration(stepType: string, depth: string): number;
  estimateStepCost(duration: number, modelPreference: string): number;
}

/** 叶子步骤 id = 没有任何其他步骤依赖它（mission 终端产物）。 */
export function leafStepIds(steps: ExecutionStep[]): string[] {
  return steps
    .filter((s) => !steps.some((o) => o.dependencies.includes(s.id)))
    .map((s) => s.id);
}

/**
 * 尝试 LLM 动态分解。返回 null（调用方回落静态 workflow）的条件：flag off、
 * 复杂度非 high/very_high、leader 不支持分解、或结果退化（<=1 子任务）。
 * flag HARNESS_DYNAMIC_PLANNING 默认 off → 现网行为不变。
 */
export async function tryDynamicDecomposition(
  intent: ParsedIntent,
  team: ITeam,
  constraints: MissionExecutionProfile,
  estimators: PlanningEstimators,
  logger: Logger,
): Promise<ExecutionStep[] | null> {
  if (process.env.HARNESS_DYNAMIC_PLANNING !== "true") return null;
  const overall = intent.complexity.overall;
  if (overall !== "high" && overall !== "very_high") return null;

  const leader = team.leader;
  // ILeader declares decomposeTask; setAvailableRoles lives on the concrete
  // Leader only, so probe it structurally.
  const roleSink = leader as Partial<{
    setAvailableRoles(roles: RoleId[]): void;
  }>;
  if (
    !("decomposeTask" in leader) ||
    typeof roleSink.setAvailableRoles !== "function"
  ) {
    return null;
  }

  try {
    // decomposeTask reads leader.availableRoles internally, and that field is
    // never populated by production wiring — seed it from the team's worker
    // roles first, else the LLM is told only "researcher" exists.
    const roles = [...new Set(team.members.map((m) => m.role.id))];
    if (roles.length === 0) return null;
    roleSink.setAvailableRoles(roles);

    const task: TaskInput = {
      id: intent.id,
      description: intent.primaryGoal,
      requirements: intent.secondaryGoals,
    };
    const subtasks = await (leader as ILeader).decomposeTask(task);

    // <=1 subtask means decomposition added no structure (incl. the adapter's
    // single-default-subtask error fallback) → the static workflow is richer.
    if (subtasks.length <= 1) return null;

    logger.log(
      `[plan] dynamic decomposition produced ${subtasks.length} steps (complexity=${overall})`,
    );
    return subtasks.map((st) =>
      subTaskToStep(st, team, constraints, estimators),
    );
  } catch (err) {
    logger.warn(
      `[plan] dynamic decomposition failed, falling back to static workflow: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

/**
 * 把 LLM SubTask 映射为 ExecutionStep。执行由 executor 驱动（executeStepFull 按
 * executor + skills 分派、不读 step.type），故动态步骤一律 type "task"，executor
 * 由 suggestedRole 解析，角色不在团队时兜底 leader。
 */
function subTaskToStep(
  st: SubTask,
  team: ITeam,
  constraints: MissionExecutionProfile,
  estimators: PlanningEstimators,
): ExecutionStep {
  const executor =
    team.getMembersByRole(st.suggestedRole)[0]?.id ?? team.leader.id;
  const estimatedDuration =
    st.estimatedDuration > 0
      ? st.estimatedDuration
      : estimators.estimateStepDuration("task", constraints.quality.depth);
  return {
    id: st.id,
    name: st.description.slice(0, 60),
    description: st.description,
    executor,
    type: "task",
    dependencies: st.dependencies,
    estimatedDuration,
    estimatedCost: estimators.estimateStepCost(
      estimatedDuration,
      constraints.cost.modelPreference,
    ),
  };
}
