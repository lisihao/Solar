/**
 * SocialAgentInvoker — playground AgentInvoker 的 social 对应物
 *
 * 责任：
 *   1. 把 AgentRunner.run() 用 social 业务上下文（missionId / userId / role）包装
 *   2. abortRegistry signal 注入（mission 终止时立即停 agent）
 *   3. agent 事件经 SocialEventRelay 转 social.* 前缀广播
 *   4. tickCost 把 token spend 计入 MissionBudgetPool（mission 总预算闸）
 *
 * 设计简化 vs playground:
 *   - 不持有 FailureLearner / InvocationPolicy（PR-5 publish-executor 真接通时再加）
 *   - 不实现 DAG concurrency（social 多平台用平面 ConcurrencyLimiter 即可）
 *
 * 2026-05-24:
 *   retry / abort / backoff 通用骨架走 ai-harness/teams/business-team
 *   /invocation/business-team-agent-invoker.framework.ts（与 playground 共享）。
 *   social 暂不走 retry（maxRetries=0），但 emit lifecycle started/completed/failed
 *   保持原先 9 个 role 行为不变。
 */

import { Injectable } from "@nestjs/common";
import {
  AgentRunner,
  EventBus,
  MissionAbortRegistry,
  MissionBudgetPool,
  BusinessTeamAgentInvokerFramework,
  type IAgentEvent,
  type BillingRuntimeEnvAdapter,
} from "@/modules/ai-harness/facade";
import { SocialEventRelay } from "./social-event-relay";

export interface SocialInvocationContext {
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
export class SocialAgentInvoker {
  private readonly relay: SocialEventRelay;

  constructor(
    private readonly runner: AgentRunner,
    eventBus: EventBus,
    private readonly abortRegistry: MissionAbortRegistry,
  ) {
    this.relay = new SocialEventRelay(eventBus);
    this.relay.setAbortRegistry(abortRegistry);
  }

  async invoke<TSpec extends Parameters<AgentRunner["run"]>[0]>(
    Spec: TSpec,
    input: Parameters<AgentRunner["run"]>[1],
    ctx: SocialInvocationContext,
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
              moduleType: "ai-social",
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
          // per-agent lifecycle —— social 此前从不发 agent:lifecycle，前端拿不到精确
          // agent 状态/wallTime（只能按 stage 兜底）。在唯一 invoke 出口统一发，覆盖 9 个角色。
          // started 用 fire-and-forget（emit 慢/挂不阻塞主流水线；CLAUDE.md 反向洞察 #4）。
          void this.relay.emitLifecycle(
            runCtx.missionId,
            runCtx.userId,
            runCtx.agentId,
            runCtx.role,
            "started",
          );
        },
        onAgentEnd: (runCtx, status, err) => {
          // 与原实现一致：success 路径 result.state="failed" 也算业务失败
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
          // fire-and-forget 与原 await 等价：原代码也忽略 emit 返回值
          void this.relay.emitLifecycle(
            runCtx.missionId,
            runCtx.userId,
            runCtx.agentId,
            runCtx.role,
            phase,
            detail,
          );
        },
      },
      this.abortRegistry,
      // social 暂不走 retry（保持原先无 retry 行为）
      { maxRetries: 0 },
    );
    return fw.invoke(Spec, input, ctx);
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
  ): Promise<void> {
    await this.relay.tickCost(missionId, userId, stage, pool, deltaTokens);
  }

  clearMissionRelayState(missionId: string): void {
    this.relay.clearMission(missionId);
  }
}

/**
 * Re-export harness facade extractTokenSpend
 *
 * Round-2 Reviewer A P1: 移除 social local copy，统一走 facade 版（处理
 * thinking token，本地版会漏算）。9 个 role service 透过 ./roles barrel
 * 拿到的仍是同名 export，无需改 import path。
 */
export { extractTokenSpend } from "@/modules/ai-harness/facade";
