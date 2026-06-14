/**
 * AgentInvoker —— playground 内部的兼容门面。
 *
 * 原则：
 * 1. 执行支撑（run / 并发 / DAG）与业务事件语义拆开。
 * 2. Playground 特有的 event type 仍留在 app 层，不下沉到 harness。
 * 3. 现有 role services / stages 调用面先保持不变，避免重构扩散。
 *
 * 2026-05-24:
 *   retry / abort / backoff / span lifecycle 通用骨架已上提到
 *   `ai-harness/teams/business-team/invocation/business-team-agent-invoker.framework.ts`。
 *   本类作为业务侧 adapter:
 *     - invokeOnce 走 AgentExecutionSupport.invoke（业务 billingMeta 在那）
 *     - onDegrade 发 "playground.stage:degraded"（payload 字段保持不变）
 *     - onAgentStart/End 接 PlaygroundMissionSpanService（R3-#38 agent-level span）
 *   外接口（invoke/emitEvent/emitLifecycle/tickCost/runDagConcurrency 等）签名不变。
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import {
  AgentRunner,
  EventBus,
  MissionBudgetPool,
  BusinessTeamAgentInvokerFramework,
} from "@/modules/ai-harness/facade";
import { BillingRuntimeEnvAdapter } from "@/modules/ai-harness/facade";
import { MissionAbortRegistry } from "@/modules/ai-harness/facade";
import { FailureLearnerService } from "@/modules/ai-harness/facade";
import { estimateUsdFromTokens } from "@/modules/ai-harness/facade";
import type { IAgentEvent } from "@/modules/ai-harness/facade";
import { AgentExecutionSupport } from "./agent-execution-support";
import { AgentInvocationPolicy } from "./agent-invocation-policy";
import { AgentPlaygroundEventRelay } from "../../runtime/playground.event-relay";
import { PlaygroundMissionSpanService } from "../pipeline/playground-mission-span.service";
import { MissionStore } from "../lifecycle/mission-store.service";

/**
 * ★ Wire-Cost (2026-05-30)：从一个 stage 的 raw agent events 抽取真实 LLM 用量
 * （promptTokens / completionTokens / costUsd / 主导 modelId），用于逐 stage 写
 * 成本台账。promptTokens/completionTokens/costUsd 取所有 thinking 事件之和；
 * model 取出现次数最多的 modelId（同一 stage 内可能多轮 react，模型一般一致）。
 */
function extractStageUsage(events: readonly IAgentEvent[] | undefined): {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  model: string | null;
} {
  let promptTokens = 0;
  let completionTokens = 0;
  let costUsd = 0;
  const modelCounts = new Map<string, number>();
  if (events) {
    for (const ev of events) {
      if (ev.type !== "thinking") continue;
      const p = ev.payload as {
        promptTokens?: unknown;
        completionTokens?: unknown;
        costUsd?: unknown;
        modelId?: unknown;
      } | null;
      const pt = toFiniteNonNeg(p?.promptTokens);
      const ct = toFiniteNonNeg(p?.completionTokens);
      const cu = toFiniteNonNeg(p?.costUsd);
      promptTokens += pt;
      completionTokens += ct;
      costUsd += cu;
      if (typeof p?.modelId === "string" && p.modelId.length > 0) {
        modelCounts.set(p.modelId, (modelCounts.get(p.modelId) ?? 0) + 1);
      }
    }
  }
  let model: string | null = null;
  let best = 0;
  for (const [m, c] of modelCounts) {
    if (c > best) {
      best = c;
      model = m;
    }
  }
  return { promptTokens, completionTokens, costUsd, model };
}

function toFiniteNonNeg(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

/** 每次 invoke 时给到 invoker 的 context，统一所有 role service 入参 shape */
export interface InvocationContext {
  missionId: string;
  userId: string;
  agentId: string;
  role: string;
  envAdapter?: BillingRuntimeEnvAdapter;
  budgetMultiplier?: number;
  toolRecallHint?: {
    categories?: readonly string[];
    excludeIds?: readonly string[];
    preferIds?: readonly string[];
  };
  loopOverride?: "react" | "reflexion";
}

@Injectable()
export class AgentInvoker {
  private readonly log = new Logger(AgentInvoker.name);
  private readonly execution: AgentExecutionSupport;
  private readonly relay: AgentPlaygroundEventRelay;
  private readonly policy: AgentInvocationPolicy;

  constructor(
    runner: AgentRunner,
    eventBus: EventBus,
    private readonly abortRegistry: MissionAbortRegistry,
    failureLearner: FailureLearnerService,
    @Optional() private readonly spanService?: PlaygroundMissionSpanService,
    // ★ Wire-Cost (2026-05-30)：逐 stage 把 LLM 用量 append 到成本台账。
    //   Optional：spec / 无 store 环境下降级为仅原 tickCost 行为。
    @Optional() private readonly missionStore?: MissionStore,
  ) {
    this.execution = new AgentExecutionSupport(runner, abortRegistry);
    this.relay = new AgentPlaygroundEventRelay(eventBus);
    // ★ 业务链修2 (2026-05-06): 把 abortRegistry 注入 relay，让 tickCost 在 budget
    //   exhausted 时立即触发 abort（不再要等到 S3 末尾才检查一次）
    this.relay.setAbortRegistry(abortRegistry);
    this.policy = new AgentInvocationPolicy(failureLearner);
  }

  /**
   * Invoke a role agent with transient-error retry (up to MAX_ROLE_RETRIES extra attempts).
   *
   * R2-#46: role-level retry + degradation reporting.
   *   - Retries ONLY on transient errors (network/5xx/rate-limit) detected by isRetryableError.
   *   - Non-transient errors (context overflow, auth, 4xx) surface immediately.
   *   - After all retries are exhausted, emits "playground.stage:degraded" so the UI
   *     can surface partial failure without crashing the whole mission.
   *   - AbortSignal abort bypasses retry immediately.
   *
   * R3-#38 (agent-level span nesting): wraps the entire retry loop in a single
   * agent span parented to the currently active stage span (via PlaygroundMissionSpanService).
   * The span covers all retry attempts; the final status reflects the outcome.
   */
  async invoke<TSpec extends Parameters<AgentRunner["run"]>[0]>(
    Spec: TSpec,
    input: Parameters<AgentRunner["run"]>[1],
    ctx: InvocationContext,
  ): Promise<Awaited<ReturnType<AgentRunner["run"]>>> {
    type RunResult = Awaited<ReturnType<AgentRunner["run"]>>;
    const fw = new BusinessTeamAgentInvokerFramework<
      TSpec,
      typeof input,
      RunResult
    >(
      {
        invokeOnce: async (spec, runInput, _runCtx) => {
          const playgroundCtx = ctx; // 完整 InvocationContext，supports envAdapter / budgetMultiplier 等
          const onEvent = async (event: IAgentEvent) => {
            await this.relay.relayAgentEvents([event], playgroundCtx);
          };
          return this.execution.invoke(spec, runInput, playgroundCtx, onEvent);
        },
        onAgentStart: (runCtx) => {
          this.spanService?.startAgentSpan(runCtx.missionId, runCtx.agentId);
        },
        onAgentEnd: (runCtx, status, err) => {
          this.spanService?.endAgentSpan(
            runCtx.missionId,
            runCtx.agentId,
            status,
            err,
          );
        },
        onDegrade: async (runCtx, err, info) => {
          // R2-#46: degraded payload 字段保持不变（前端依赖 stage / reason / role / agentId
          // / attempts / error / transient 7 字段）
          await this.relay
            .emitEvent({
              type: "playground.stage:degraded",
              missionId: runCtx.missionId,
              userId: runCtx.userId,
              agentId: runCtx.agentId,
              payload: {
                stage: runCtx.role,
                reason: `role degraded after ${info.attempts} attempt(s): ${err.message.slice(0, 300)}`,
                role: runCtx.role,
                agentId: runCtx.agentId,
                attempts: info.attempts,
                error: err.message.slice(0, 500),
                transient: info.transient,
              },
            })
            .catch((emitErr: unknown) => {
              this.log.warn(
                `[AgentInvoker] degraded-event emit failed (non-fatal): ${
                  emitErr instanceof Error ? emitErr.message : String(emitErr)
                }`,
              );
            });
        },
      },
      this.abortRegistry,
    );
    return fw.invoke(Spec, input, ctx);
  }

  async preDisableKnownFailingModels(
    billing: BillingRuntimeEnvAdapter,
    agentSpecId: string,
    promptKey: string,
  ): Promise<{ failed: string; fallback: string }[]> {
    return this.policy.preDisableKnownFailingModels(
      billing,
      agentSpecId,
      promptKey,
    );
  }

  resolveLoopOverride(
    auditLayers: string,
    stage:
      | "leader"
      | "researcher"
      | "reconciler"
      | "analyst"
      | "writer"
      | "reviewer"
      | "verifier"
      | "critic"
      | "steward",
  ): "react" | "reflexion" | undefined {
    return this.policy.resolveLoopOverride(auditLayers, stage);
  }

  async emitEvent(args: {
    type: string;
    missionId: string;
    userId: string;
    agentId?: string;
    traceId?: string;
    payload: unknown;
  }): Promise<void> {
    await this.relay.emitEvent(args);
  }

  async emitLifecycle(
    missionId: string,
    userId: string,
    agentId: string,
    role: string,
    phase: "started" | "completed" | "failed",
    detail?: Record<string, unknown>,
  ): Promise<void> {
    await this.relay.emitLifecycle(
      missionId,
      userId,
      agentId,
      role,
      phase,
      detail,
    );
  }

  async tickCost(
    missionId: string,
    userId: string,
    stage: string,
    pool: MissionBudgetPool,
    deltaTokens: number,
    /** R2-#36: pass raw agent events so tickCost can read real per-model costUsd */
    agentEvents?: readonly IAgentEvent[],
  ): Promise<void> {
    await this.relay.tickCost(
      missionId,
      userId,
      stage,
      pool,
      deltaTokens,
      agentEvents,
    );
    // ★ Wire-Cost (2026-05-30)：逐 stage 把真实 LLM 用量 append 到成本台账。
    //   fire-and-forget（不阻塞主链路）；CostLedgerStore 内部失败已结构化 warn
    //   'cost_ledger_write_failed' 不吞错。此处再包一层 void+catch 兜底防 reject 逃逸。
    if (this.missionStore) {
      const usage = extractStageUsage(agentEvents);
      void this.missionStore
        .appendCostEntry({
          missionId,
          userId,
          stepId: stage,
          role: stage,
          model: usage.model,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          // 真实 per-model costUsd 优先；thinking 事件无 costUsd 时回退 canonical
          //   estimateUsdFromTokens（与 relay.tickCost / agent-usage.util 同口径，
          //   消除内联 0.000003 魔数 —— PG-08）。
          costUsd:
            usage.costUsd > 0
              ? usage.costUsd
              : estimateUsdFromTokens(deltaTokens),
        })
        .catch((err: unknown) => {
          this.log.warn(
            `cost_ledger_write_failed mission=${missionId} stage=${stage}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
    }
  }

  /**
   * P0-1 (2026-05-06): 清理 relay 层 exhaustedMissions Map 中指定 mission 的条目，
   * 防止 short mission 在 finally 阶段 leak。
   * dispatcher finally 通过本方法转发，不直接访问 private relay。
   */
  clearMissionRelayState(missionId: string): void {
    this.relay.clearMission(missionId);
  }

  async runDagConcurrency<
    TIn extends { id: string; dependsOn?: string[] },
    TOut,
  >(
    items: readonly TIn[],
    concurrency: number,
    fn: (item: TIn, idx: number) => Promise<TOut>,
  ): Promise<TOut[]> {
    return this.execution.runDagConcurrency(items, concurrency, fn);
  }
}
