/**
 * ReconcilerService —— 跨 dim 对账（[3.5] 节点）的统一入口
 *
 * 接 ResearcherService 的产出，喂给 ReconcilerAgent 出 factTable / conflicts /
 * gaps / overlaps / figureCandidates / reconciliationReport，供下游 Analyst/Writer
 * 消费。
 */

import { Injectable } from "@nestjs/common";
import { ReconcilerAgent } from "../agents/reconciler/reconciler.agent";
import { AgentInvoker, type InvocationContext } from "./agent-invoker.service";
import type { IAgentEvent } from "@/modules/ai-harness/facade";
import { normalizeRunnerState } from "@/modules/ai-harness/facade";

export interface ReconcileInput {
  topic: string;
  language: "zh-CN" | "en-US";
  plan: {
    themeSummary: string;
    dimensions: { id: string; name: string; rationale: string }[];
  };
  researcherResults: {
    dimension: string;
    findings: { claim: string; evidence: string; source: string }[];
    summary: string;
  }[];
}

export interface ReconcileOutput {
  factTable: unknown[];
  conflicts: unknown[];
  overlaps: unknown[];
  gaps: unknown[];
  figureCandidates: unknown[];
  reconciliationReport: string;
}

@Injectable()
export class ReconcilerService {
  constructor(private readonly invoker: AgentInvoker) {}

  async reconcile(
    input: ReconcileInput,
    ctx: InvocationContext,
  ): Promise<{
    state: "completed" | "degraded" | "failed" | "cancelled";
    output?: ReconcileOutput;
    events: readonly IAgentEvent[];
    iterations: number;
    wallTimeMs: number;
  }> {
    const r = await this.invoker.invoke(ReconcilerAgent, input, ctx);
    return {
      state: normalizeRunnerState(r.state),
      output: r.output as ReconcileOutput | undefined,
      events: r.events,
      iterations: r.iterations,
      wallTimeMs: r.wallTimeMs,
    };
  }
}
