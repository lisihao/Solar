/**
 * AnalystService —— 跨 dim 综合分析的统一入口
 *
 * 责任:
 *   - 从 reconciler.factTable / conflicts / gaps + researcher findings 综合
 *   - 输出 insights[] / contradictions[] / strategicRecommendations 等
 *   - schema 由 AnalystAgent.outputSchema 决定（orchestrator 传 input 时按需裁剪）
 */

import { Injectable } from "@nestjs/common";
import { AnalystAgent } from "../agents/analyst/analyst.agent";
import { QuickViewSynthesizerAgent } from "../agents/analyst/quick-view-synthesizer.agent";
import { AgentInvoker, type InvocationContext } from "./agent-invoker.service";
import type { IAgentEvent } from "@/modules/ai-harness/facade";
import { normalizeRunnerState } from "@/modules/ai-harness/facade";

@Injectable()
export class AnalystService {
  constructor(private readonly invoker: AgentInvoker) {}

  async analyze<TIn, TOut>(
    input: TIn,
    ctx: InvocationContext,
  ): Promise<{
    // degraded: reflexion verifier 评分 < passThreshold 但 outputSchema 合法的次优产物
    state: "completed" | "degraded" | "failed" | "cancelled";
    output?: TOut;
    events: readonly IAgentEvent[];
    iterations: number;
    wallTimeMs: number;
  }> {
    const r = await this.invoker.invoke(
      AnalystAgent,
      input as Parameters<AgentInvoker["invoke"]>[1],
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

  /**
   * 快速视图结构化字段的专用合成（与 analyze 主调用拆开，避免 body 被散文章节
   * 挤占输出预算饿死）。失败由调用方兜底（保留 analyst 主调用的内联字段）。
   */
  async synthesizeQuickView<TIn, TOut>(
    input: TIn,
    ctx: InvocationContext,
  ): Promise<{
    state: "completed" | "degraded" | "failed" | "cancelled";
    output?: TOut;
    events: readonly IAgentEvent[];
    iterations: number;
    wallTimeMs: number;
  }> {
    const r = await this.invoker.invoke(
      QuickViewSynthesizerAgent,
      input as Parameters<AgentInvoker["invoke"]>[1],
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
