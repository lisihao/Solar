/**
 * ReviewerService —— 主观质量评审角色统一入口
 *
 * 暴露 3 个方法对应 3 个 reviewer agent class:
 *   reviewMission()  → MissionReviewerAgent      （5-axis verifier 兜底，可选）
 *   criticL4()       → MissionCriticAgent        L4 元评审（blindspots/biases）
 *   judgeDimension() → DimensionQualityJudgeAgent dim-level 质量打分
 */

import { Injectable } from "@nestjs/common";
import { MissionReviewerAgent } from "../agents/reviewer/mission-reviewer.agent";
import { MissionCriticAgent } from "../agents/reviewer/mission-critic.agent";
import { DimensionQualityJudgeAgent } from "../agents/reviewer/dimension-quality-judge.agent";
import { ForecastRedTeamAgent } from "../agents/reviewer/forecast-red-team.agent";
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
export class ReviewerService {
  constructor(private readonly invoker: AgentInvoker) {}

  async reviewMission<TIn, TOut>(
    input: TIn,
    ctx: InvocationContext,
  ): Promise<InvokeResult<TOut>> {
    return this.invokeReviewer(MissionReviewerAgent, input, ctx);
  }

  async criticL4<TIn, TOut>(
    input: TIn,
    ctx: InvocationContext,
  ): Promise<InvokeResult<TOut>> {
    return this.invokeReviewer(MissionCriticAgent, input, ctx);
  }

  async judgeDimension<TIn, TOut>(
    input: TIn,
    ctx: InvocationContext,
  ): Promise<InvokeResult<TOut>> {
    return this.invokeReviewer(DimensionQualityJudgeAgent, input, ctx);
  }

  // ★ Forecast 红队 (2026-05-29 L2)：对 foresight 做事前验尸，评未来脆性
  async forecastRedTeam<TIn, TOut>(
    input: TIn,
    ctx: InvocationContext,
  ): Promise<InvokeResult<TOut>> {
    return this.invokeReviewer(ForecastRedTeamAgent, input, ctx);
  }

  private async invokeReviewer<TSpec, TIn, TOut>(
    spec: TSpec,
    input: TIn,
    ctx: InvocationContext,
  ): Promise<InvokeResult<TOut>> {
    const r = await this.invoker.invoke(
      spec as Parameters<AgentInvoker["invoke"]>[0],
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
