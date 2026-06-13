/**
 * AgentInvoker (writing) — playground AgentInvoker 的 writing 对应物
 *
 * 责任：
 *   1. 把 AgentRunner.run() 用 writing 业务上下文（missionId / userId / role）包装
 *   2. abortRegistry signal 注入（mission 终止时立即停 agent）
 *   3. agent 事件经 WritingEventRelay 转 writing.* 前缀广播
 *   4. tickCost 把 token spend 计入 MissionBudgetPool（mission 总预算闸）
 *   5. retry（transient error，maxRetries=2）+ degrade（重试耗尽 emit
 *      "writing.stage:degraded"，payload 字段对齐 playground 7 字段）
 *
 * 通用 retry / abort / backoff / span lifecycle 骨架走 ai-harness/teams/business-team
 * /invocation/business-team-agent-invoker.framework.ts（与 social / playground 共享）。
 * 本类只注入 writing 业务专属语义（runner.run billingMeta=ai-writing、事件中继、
 * degraded payload）。
 *
 * 设计简化 vs playground:
 *   - 不持有 PlaygroundMissionSpanService / MissionStore（writing 无 agent-level span /
 *     cost-ledger store；逐 stage 成本走 tickCost → MissionBudgetPool）。
 *   - WritingEventRelay 无脱敏层（writing 无 social 的平台凭证暴露面）。
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  AgentRunner,
  EventBus,
  EventRelayFramework,
  MissionAbortRegistry,
  MissionBudgetPool,
  BusinessTeamAgentInvokerFramework,
  type IAgentEvent,
  type BillingRuntimeEnvAdapter,
} from "@/modules/ai-harness/facade";

/** writing.* 前缀事件中继薄壳（无脱敏层，writing 无凭证暴露面） */
class WritingEventRelay extends EventRelayFramework {
  constructor(eventBus: EventBus) {
    super(eventBus, "writing");
  }
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
  private readonly relay: WritingEventRelay;

  constructor(
    private readonly runner: AgentRunner,
    eventBus: EventBus,
    private readonly abortRegistry: MissionAbortRegistry,
  ) {
    this.relay = new WritingEventRelay(eventBus);
    // budget exhausted 时立即触发 abort（不等 stage 末尾再查）
    this.relay.setAbortRegistry(abortRegistry);
  }

  async invoke<TSpec extends Parameters<AgentRunner["run"]>[0]>(
    Spec: TSpec,
    input: Parameters<AgentRunner["run"]>[1],
    ctx: InvocationContext,
  ): Promise<Awaited<ReturnType<AgentRunner["run"]>>> {
    type RunResult = Awaited<ReturnType<AgentRunner["run"]>>;
    let startedAt = 0;
    let lastResult: RunResult | undefined;

    const fw = new BusinessTeamAgentInvokerFramework<
      TSpec,
      typeof input,
      RunResult
    >(
      {
        invokeOnce: async (spec, runInput, runCtx) => {
          const signal = this.abortRegistry.getSignal(runCtx.missionId);
          const result = await this.runner.run(spec, runInput, {
            userId: ctx.userId,
            environment: ctx.envAdapter,
            budgetMultiplier: ctx.budgetMultiplier,
            toolRecallHint: ctx.toolRecallHint,
            loopOverride: ctx.loopOverride,
            signal,
            billingMeta: {
              moduleType: "ai-writing",
              operationType: runCtx.role,
              referenceId: runCtx.missionId,
            },
            onEvent: async (event: IAgentEvent) => {
              await this.relay.relayAgentEvents([event], ctx);
            },
          });
          lastResult = result;
          return result;
        },
        onAgentStart: (runCtx) => {
          startedAt = Date.now();
          // per-agent lifecycle 在唯一 invoke 出口统一发，覆盖 5 个角色。
          // started 用 fire-and-forget（emit 慢/挂不阻塞主流水线）。
          void this.relay.emitLifecycle(
            runCtx.missionId,
            runCtx.userId,
            runCtx.agentId,
            runCtx.role,
            "started",
          );
        },
        onAgentEnd: (runCtx, status, err) => {
          // 与 social 一致：success 路径 result.state="failed" 也算业务失败
          const phase: "completed" | "failed" =
            status === "failed" ||
            (lastResult &&
              (lastResult as { state?: string }).state === "failed")
              ? "failed"
              : "completed";
          const detail: Record<string, unknown> = {
            wallTimeMs: Date.now() - startedAt,
          };
          if (lastResult) {
            const r = lastResult as { iterations?: number };
            if (typeof r.iterations === "number") {
              detail.iterations = r.iterations;
            }
          }
          if (err) {
            detail.error = err.message;
          }
          void this.relay.emitLifecycle(
            runCtx.missionId,
            runCtx.userId,
            runCtx.agentId,
            runCtx.role,
            phase,
            detail,
          );
        },
        onDegrade: async (runCtx, err, info) => {
          // degraded payload 字段对齐 playground（前端依赖 stage / reason / role /
          // agentId / attempts / error / transient 7 字段）
          await this.relay
            .emitEvent({
              type: "writing.stage:degraded",
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
  }

  clearMissionRelayState(missionId: string): void {
    this.relay.clearMission(missionId);
  }
}

/**
 * Re-export harness facade extractTokenSpend（统一走 facade 版，处理 thinking token）。
 * role service 透过 ./agent-invoker barrel import，与 social 形态一致。
 */
export { extractTokenSpend } from "@/modules/ai-harness/facade";
