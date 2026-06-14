/**
 * AGENT_STEP_BEFORE / AGENT_STEP_AFTER hook payload
 *
 * Fire point：ReActLoop 每轮 iteration（reason → act）前后
 * Plugin 用例：
 *   - 单步 trace / observability（OTel span 包裹）
 *   - 单步 plan-act 重写（replacePayload 改写 action 提示）
 *   - 早终止策略 plugin（abort 提前结束 loop）
 */

export interface AgentStepBeforePayload {
  readonly agentId: string;
  readonly iteration: number;
  readonly maxIterations: number;
  /** envelope 不透明引用，plugin 自行 cast */
  readonly envelope: unknown;
}

export interface AgentStepAfterPayload {
  readonly agentId: string;
  readonly iteration: number;
  readonly actionKind?: string;
  readonly tokensUsed?: number;
  readonly latencyMs?: number;
}
