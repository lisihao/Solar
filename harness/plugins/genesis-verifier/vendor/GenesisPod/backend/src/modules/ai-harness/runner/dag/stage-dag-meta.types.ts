/**
 * StageDagMeta —— Stage 静态依赖图元数据（per-task rerun + cascade v1.2 §3.1）
 *
 * 上游：docs/architecture/ai-harness/runner/per-task-rerun-with-cascade.md v1.2
 *
 * 用途：
 *   - 给 cascade 执行器读 "重跑某 stage 时哪些下游必须自动跑"
 *   - 给 ctx-hydrator 校验 "重跑该 stage 前需要 ctx 哪些字段"
 *   - 给 mission-store reset 知道 "重跑前清哪些 mission 行字段"
 *
 * v1.2 类别 C4 + H1 修订：
 *   - 类别 C4: ctxWrites / dbWrites 拆为两个独立命名空间，编译期严格 union（不再混 keyof MissionContext | "mission.dimensions" 字符串）
 *   - 类别 H1: 类型放在 ai-harness/runner/dag/（通用层），其它 ai-app（office / writing 等）后续可复用
 *
 * 与 runner/dag/dag-executor.ts 的区别：
 *   - dag-executor 是"运行期"DAG 执行器（task 间动态依赖）
 *   - stage-dag-meta 是"声明期"Stage 静态依赖元数据（pipeline 配置层）
 *   两者协作：cascade 执行器读 stage-dag-meta 决定调度顺序，而后调用 dag-executor 执行（如需）
 *
 * stateless：纯类型 + 工具函数，无副作用，可 Promise.all 并发使用。
 */

/**
 * Mission 行 DB 列名联合（**仅含可被 stage 写入的列**）。
 *
 * 用途：cascade reset / dbWrites 声明 / resetFields 显式列出受影响列。
 *
 * v1.2 类别 C4：与 ctxWrites（keyof MissionContext）拆开两个命名空间，
 * 不再混在一个 union 里（v1.0 的 BLOCKER）。
 *
 * 同步规则：当 prisma schema agent_playground_missions 加新列时必须更新此 union。
 */
export type MissionColumnKey =
  | "report_full"
  | "report_artifact_version"
  | "completed_at"
  | "final_score"
  | "status"
  | "error_message"
  | "dimensions"
  | "theme_summary"
  | "reconciliation_report"
  | "verdicts"
  | "leader_journal"
  | "leader_signed"
  | "leader_overall_score"
  | "leader_verdict"
  | "outline_plan" // PR-R0 加（S7 主动持久化）
  | "analyst_output" // PR-R0 加（S6 主动持久化）
  | "tokens_used"
  | "cost_usd"
  | "trajectory_stored"
  | "last_completed_stage"
  | "max_credits"; // S1-budget 写

/**
 * Stage DAG 元数据 —— 给 cascade 执行器读的 "重跑影响图"。
 *
 * 注意：本类型对 ai-app/MissionContext 字段是 string 引用（避免循环依赖：
 * ai-harness/runner 不应 import ai-app 的 MissionContext 类型）。
 * caller 在 ai-app 层声明时用 `as const satisfies StageDagMeta` 拿到字段名 lint。
 */
export interface StageDagMeta {
  /**
   * stage 在 ctx 中读取的字段名（仅用于 hydrator 校验完整性 + 文档化依赖）。
   * 用 string 而非 keyof MissionContext 是因 ai-harness 不依赖 ai-app 的 ctx 类型。
   */
  readonly ctxReads: ReadonlyArray<string>;

  /** stage 写入 ctx 的字段名（ctx 副作用范围；与 ctxReads 同语义）。*/
  readonly ctxWrites: ReadonlyArray<string>;

  /** DB 列：stage 写入 mission 表的列（cascade reset 时用）。*/
  readonly dbWrites: ReadonlyArray<MissionColumnKey>;

  /**
   * 该 stage 后必须自动跑的下游 stage id 列表（按 pipeline 数组顺序）。
   *
   * cascade 执行器：rerun(stage_i) → 跑 stage_i + successors[0..n-1] 顺序执行。
   * 终态 stage（如 s11-persist）的 successors = []。
   */
  readonly successors: ReadonlyArray<string>;

  /** 是否允许用户从该 stage 触发重跑。某些 stage（如 s1-budget）拒绝。*/
  readonly rerunable: boolean;

  /** 拒绝重跑的原因（rerunable=false 时必填，用户在 UI 看到此文字）。*/
  readonly rerunableReason?: string;

  /**
   * 重跑前需要 reset 的 mission 列（独立于 dbWrites — 含错误标记等"清状态"字段）。
   * cascade 执行器 reset 整链 successors[].resetFields 的并集后再开跑。
   */
  readonly resetFields?: ReadonlyArray<MissionColumnKey>;
}

/**
 * 自洽校验：给定一组 step 配置（{ id, dag }），校验 successors 引用合法 + 无环。
 *
 * 用法（spec / pipeline registry boot 时调）：
 *   const issues = validateStageDag(PLAYGROUND_PIPELINE.steps);
 *   if (issues.length > 0) throw new Error(issues.join("; "));
 */
export function validateStageDag(
  steps: ReadonlyArray<{ id: string; dag?: StageDagMeta }>,
): string[] {
  const issues: string[] = [];
  const ids = new Set(steps.map((s) => s.id));

  // 1. successors 都是合法 step id
  for (const step of steps) {
    if (!step.dag) continue;
    for (const succ of step.dag.successors) {
      if (!ids.has(succ)) {
        issues.push(`step ${step.id}: successor "${succ}" not in pipeline`);
      }
    }
  }

  // 2. rerunable=false 时 rerunableReason 必填
  for (const step of steps) {
    if (step.dag && !step.dag.rerunable && !step.dag.rerunableReason) {
      issues.push(
        `step ${step.id}: rerunable=false requires rerunableReason for UI`,
      );
    }
  }

  // 3. 无环（拓扑排序失败 → 有环）
  // 简化：因 PLAYGROUND_PIPELINE 是线性 DAG，successors 必须严格在 step 数组中位置之后
  const idxOf = new Map(steps.map((s, i) => [s.id, i]));
  for (const step of steps) {
    if (!step.dag) continue;
    const myIdx = idxOf.get(step.id)!;
    for (const succ of step.dag.successors) {
      const succIdx = idxOf.get(succ);
      if (succIdx !== undefined && succIdx <= myIdx) {
        issues.push(
          `step ${step.id}: successor "${succ}" appears earlier (${succIdx} <= ${myIdx}) — cycle/back-edge detected`,
        );
      }
    }
  }

  return issues;
}

/**
 * 计算给定 fromStepId 的 cascade 链（含起点 + 所有 successors）。
 *
 * 用法（cascade 执行器 / UI preview）：
 *   const chain = computeCascadeChain(MY_PIPELINE.steps, "step-final");
 *   // → ["step-final"]
 *   const chain2 = computeCascadeChain(MY_PIPELINE.steps, "step-draft");
 *   // → ["step-draft", "step-review", "step-signoff", "step-final"]
 */
export function computeCascadeChain(
  steps: ReadonlyArray<{ id: string; dag?: StageDagMeta }>,
  fromStepId: string,
): string[] {
  const fromStep = steps.find((s) => s.id === fromStepId);
  if (!fromStep?.dag) return [];
  return [fromStepId, ...fromStep.dag.successors];
}

/**
 * 收集 cascade 链上所有 stage 的 resetFields 并集（cascade 起点前一次性 reset）。
 */
export function collectResetFieldsForCascade(
  steps: ReadonlyArray<{ id: string; dag?: StageDagMeta }>,
  cascadeChain: ReadonlyArray<string>,
): MissionColumnKey[] {
  const fields = new Set<MissionColumnKey>();
  for (const stepId of cascadeChain) {
    const step = steps.find((s) => s.id === stepId);
    step?.dag?.resetFields?.forEach((f) => fields.add(f));
  }
  return [...fields];
}
