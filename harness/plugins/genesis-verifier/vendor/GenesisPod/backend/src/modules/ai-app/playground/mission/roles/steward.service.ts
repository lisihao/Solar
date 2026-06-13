/**
 * StewardService —— 资源守门统一入口
 *
 * 当前唯一 scope: budget-guard。历史预留方法（checkCompliance/checkBoundary/
 * checkSourceDiversity）已删（2026-05-15 PR-E）：从未接入 orchestrator + agent
 * 也没保留这些 scope。后续真要这些能力再加 agent scope + 本服务方法。
 */

import { Injectable } from "@nestjs/common";
import { StewardAgent } from "../agents/steward/steward.agent";
import { AgentInvoker, type InvocationContext } from "./agent-invoker.service";
import type { IAgentEvent } from "@/modules/ai-harness/facade";
import { normalizeRunnerState } from "@/modules/ai-harness/facade";

interface InvokeResult<TOut> {
  state: "completed" | "degraded" | "failed" | "cancelled";
  output?: TOut;
  events: readonly IAgentEvent[];
  iterations: number;
  wallTimeMs: number;
}

@Injectable()
export class StewardService {
  constructor(private readonly invoker: AgentInvoker) {}

  async guardBudget<TIn, TOut>(
    input: TIn,
    ctx: InvocationContext,
  ): Promise<InvokeResult<TOut>> {
    const r = await this.invoker.invoke(
      StewardAgent,
      {
        ...(input as object),
        scope: "budget-guard",
      } as Parameters<AgentInvoker["invoke"]>[1],
      ctx,
    );
    return {
      state: normalizeRunnerState(r.state),
      output: r.output as TOut | undefined,
      events: r.events,
      iterations: r.iterations,
      wallTimeMs: r.wallTimeMs,
    };
  }
}
