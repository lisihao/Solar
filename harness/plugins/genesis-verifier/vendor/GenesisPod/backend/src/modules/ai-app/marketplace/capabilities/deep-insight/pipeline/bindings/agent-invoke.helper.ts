/**
 * agent-invoke.helper —— bindings 内统一的 AgentRunner 调用封装。
 *
 * 所有 14 阶段 binding 跑共享 @DefineAgent 都经此 helper：
 *   - 解析 spec（resolveAgentSpec，与 playground / company 同一份 agent-spec-catalog）
 *   - 透传 RunOptions（userId / preferredModelId / signal / billingMeta / onEvent relay）
 *   - 把 tokens / cost 累计进 CrossStageState（deep-insight.tokensUsed / .costCents）
 *   - 每次 agent 调用前后各 emit 一条 "domain" agent:lifecycle（phase=started →
 *     completed/failed，后者带 tokensUsed/costCents/iterations）
 *   - 不碰 provider/model 硬编码（preferredModelId 缺省即走 TaskProfile + BYOK）
 *
 * Fix 1（agentId 命名空间桥接）：
 *   能力核 specId（playground.researcher / playground.leader）→ 消费侧 id（researcher#<dim> / leader）。
 *   映射规则：mapSpecIdToConsumerId(specId, dimension?)
 *     - 有 dimension：role 部分 + '#' + dimension（如 researcher#市场规模）
 *     - 无 dimension：剥去 'playground.' 前缀（playground.leader → leader；
 *         playground.writer.outline-planner → writer.outline-planner）
 *   向后兼容：保留 specId 字段（排查用），不影响现有消费方。
 */
import type {
  AgentRunner,
  CrossStageState,
  IAgentEvent,
} from "@/modules/ai-harness/facade";
import { resolveAgentSpec } from "@/modules/ai-app/contracts/agent-spec-catalog";
import type { CapabilityRunEvent } from "../../../../capability/capability-runner.port";
import { CS_KEY, type AgentInvocation } from "../ports";

/** agentRunner.run 的最小返回投影（只取 bindings 用到的字段）。 */
export interface AgentRunProjection {
  readonly output: unknown;
  readonly state: "completed" | "failed" | "cancelled" | "degraded";
  readonly tokensUsed: { total: number };
  readonly costCents: number;
  /** Fix1：真实产出模型 id（modelTrail 末项，供 agent:lifecycle 携带）。 */
  readonly modelId?: string;
}

/**
 * Fix 1：能力核 specId → 消费侧 agentId 映射。
 *
 * 消费侧（frontend dvCollectAgentTraces / agent-view.projector）按如下格式建行：
 *   - 有维度：`${role}#${dimension}`（如 researcher#市场规模）
 *   - 无维度：去掉 'playground.' 前缀（playground.leader → leader；
 *       playground.writer.outline-planner → writer.outline-planner）
 *
 * 这样 agent:lifecycle 的 agentId 与 agent:trace 的 agentId（经 agent-trace 桥映射后）
 * 保持一致，TodoDetailDrawer linkedAgent 选取链可正确对齐。
 */
export function mapSpecIdToConsumerId(
  specId: string,
  dimension?: string,
): string {
  // 剥去 'playground.' 前缀，得到 role 部分（如 leader / researcher / writer.outline-planner）
  const role = specId.startsWith("playground.")
    ? specId.slice("playground.".length)
    : specId;
  if (dimension) {
    // 有维度：取 role 的第一段（researcher.xxx → researcher）加 #<dim>
    const baseRole = role.split(".")[0] ?? role;
    return `${baseRole}#${dimension}`;
  }
  return role;
}

/**
 * 发 domain 事件（best-effort，catch 吞错，绝不因发事件失败破坏 mission 执行）。
 * event: 业务事件名（如 "agent:lifecycle" / "agent:narrative" / "dimension:research:started"）。
 * data: 事件载荷（与消费方 bridge 约定的字段）。
 */
export function emitDomain(
  onEvent: ((e: CapabilityRunEvent) => void | Promise<void>) | undefined,
  event: string,
  data: Record<string, unknown>,
): void {
  if (!onEvent) return;
  try {
    void onEvent({
      type: "domain",
      timestamp: Date.now(),
      payload: { event, data },
    });
  } catch {
    // best-effort：emit 失败不影响 mission 执行
  }
}

/**
 * 跑一个共享 agent，累计算力到 crossState，并 emit domain agent:lifecycle 事件。
 * spec 未沉淀 → 抛错（recipe 已声明的角色必须可解析）。
 */
export async function invokeAgent(args: {
  runner: AgentRunner;
  specId: string;
  input: Record<string, unknown>;
  invocation: AgentInvocation;
  crossStageState: CrossStageState;
  signal?: AbortSignal;
  stepId: string;
  role: string;
  dimension?: string;
  operationType: string;
  /** optional：ctx.onEvent 引用，用于 emit domain 事件（best-effort）。 */
  onEvent?: ((e: CapabilityRunEvent) => void | Promise<void>) | undefined;
}): Promise<AgentRunProjection> {
  const Spec = resolveAgentSpec(args.specId);
  if (!Spec) {
    throw new Error(
      `[deep-insight] agent spec "${args.specId}" 未在 agent-spec-catalog 沉淀`,
    );
  }
  const { invocation } = args;
  // 基线 emitLifecycle 双发语义：invoke 前发 phase=started（前端时间线『启动』行、
  // agent-view startedAt、roster running 态都依赖此相位），完成后发 completed/failed。
  const consumerId = mapSpecIdToConsumerId(args.specId, args.dimension);
  emitDomain(args.onEvent, "agent:lifecycle", {
    agentId: consumerId,
    specId: args.specId,
    role: args.role,
    ...(args.dimension !== undefined ? { dimension: args.dimension } : {}),
    stepId: args.stepId,
    phase: "started",
  });
  const res = await args.runner.run(Spec, args.input, {
    userId: invocation.userId,
    ...(invocation.preferredModelId
      ? { preferredModelId: invocation.preferredModelId }
      : {}),
    ...(args.signal ? { signal: args.signal } : {}),
    billingMeta: {
      moduleType: "marketplace-deep-insight",
      operationType: args.operationType,
    },
    onEvent: (ev: IAgentEvent) => {
      invocation.onAgentEvent?.(args.stepId, args.role, args.dimension, ev);
    },
  });
  const tokens = res.tokensUsed?.total ?? 0;
  const cost = res.costCents ?? 0;
  if (tokens) args.crossStageState.incr(CS_KEY.tokensUsed, tokens);
  if (cost) args.crossStageState.incr(CS_KEY.costCents, cost);

  // Fix1：从 modelTrail 末项取真实产出模型 id（trail 为空则省略）。
  const trail = (res as { modelTrail?: ReadonlyArray<{ modelId: string }> })
    .modelTrail;
  const modelId =
    Array.isArray(trail) && trail.length > 0
      ? trail[trail.length - 1].modelId
      : undefined;

  // 报告元信息富化：把真实产出模型 id 去重累积进 crossState（assembler metadata.modelTrail 源）。
  //   不依赖 token 回报、不硬编码模型名——trail 缺省即跳过，绝不造假。
  const modelIdStr: string | undefined =
    typeof modelId === "string" ? modelId : undefined;
  if (modelIdStr) {
    const seen = args.crossStageState.get<string[]>(CS_KEY.modelTrail) ?? [];
    if (!seen.includes(modelIdStr)) {
      args.crossStageState.append<string>(CS_KEY.modelTrail, modelIdStr);
    }
  }

  // ★ P0 #16b：每次 agent 调用完成后 emit domain agent:lifecycle 事件（best-effort）。
  // costCents → costUsd 换算（前端 useMissionLegacyView 读 costUsd 字段）。
  // Fix 1：agentId 用消费侧格式（researcher#<dim> / leader），保留 specId 向后兼容。
  emitDomain(args.onEvent, "agent:lifecycle", {
    agentId: consumerId,
    specId: args.specId,
    role: args.role,
    ...(args.dimension !== undefined ? { dimension: args.dimension } : {}),
    stepId: args.stepId,
    // C12：degraded 表示次优但可用产出（与 completed 同路径走下游），映射为 "completed"；
    //   cancelled/failed 才是真失败。degraded: true 供消费方区分。
    phase:
      res.state === "completed" || res.state === "degraded"
        ? "completed"
        : "failed",
    ...(res.state === "degraded" ? { degraded: true } : {}),
    // ReAct 轮次数（RunResult 段 3；mock/降级实现可能缺省，缺则不造）。
    ...(typeof res.iterations === "number"
      ? { iterations: res.iterations }
      : {}),
    tokensUsed: tokens,
    costCents: cost,
    costUsd: cost / 100,
    // Fix1：真实产出模型 id（bridge 用于填 model 列；trail 为空时省略）。
    ...(modelId !== undefined ? { modelId } : {}),
  });

  // Fix2：每次 agent 完成后 emit cost:tick domain 事件（CostTickSchema + dvProjectCost）。
  // 字段：deltaTokens / deltaCostUsd / stage（前端 dvProjectCost 按 stage 聚合 byStage）。
  if (tokens > 0 || cost > 0) {
    emitDomain(args.onEvent, "cost:tick", {
      stage: args.stepId,
      deltaTokens: tokens,
      deltaCostUsd: cost / 100,
      // costUsd / tokensUsed 是累计值快照（CostTickSchema passthrough 允许额外字段）；
      // 当前 invokeAgent 不持有全局累计——消费方从 deltaTokens/deltaCostUsd 聚合即可。
    });
  }

  return {
    output: res.output,
    state: res.state,
    tokensUsed: { total: tokens },
    costCents: cost,
    ...(modelId !== undefined ? { modelId } : {}),
  };
}
