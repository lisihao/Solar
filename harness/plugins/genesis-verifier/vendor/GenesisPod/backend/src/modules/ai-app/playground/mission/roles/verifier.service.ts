/**
 * VerifierService —— 客观事实核验统一入口
 *
 * 当前唯一 mode: citation-audit。历史预留方法（checkNumber/groundClaim/
 * tierSource）已删（2026-05-15 PR-E）：从未接入 orchestrator + agent 也没保留
 * 这些 mode。后续真要这些能力再加 agent mode + 本服务方法。
 */

import { Injectable } from "@nestjs/common";
import { VerifierAgent } from "../agents/verifier/verifier.agent";
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
export class VerifierService {
  constructor(private readonly invoker: AgentInvoker) {}

  async auditCitation<TIn, TOut>(
    input: TIn,
    ctx: InvocationContext,
  ): Promise<InvokeResult<TOut>> {
    const r = await this.invoker.invoke(
      VerifierAgent,
      {
        ...(input as object),
        mode: "citation-audit",
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
