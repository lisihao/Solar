/**
 * WriterService —— 写作角色统一入口（多 mode 派发）
 *
 * 当前阶段（PR-S 系列）：
 *   - 6 个 writer agent class 仍各自独立（merge 留作 PR-S4）
 *   - WriterService 暴露 6 个语义化方法，对应 6 种"写"任务
 *   - orchestrator 不再从 ../agents/writer/* 大堆 import，改成单一 WriterService 注入
 *
 * 6 个方法映射 6 个 agent:
 *   writeSingleShot()      → SingleShotWriterAgent     一次成稿
 *   planMissionOutline()   → MissionOutlinePlannerAgent mission 级 outline
 *   planDimensionOutline() → DimensionOutlinePlannerAgent 单 dim outline
 *   writeChapter()         → ChapterWriterAgent       单章成稿
 *   reviewChapter()        → ChapterReviewerAgent     章节自审
 *   integrateDimension()   → DimensionIntegratorAgent dim 整合
 */

import { Injectable } from "@nestjs/common";
import { SingleShotWriterAgent } from "../agents/writer/single-shot-writer.agent";
import { MissionOutlinePlannerAgent } from "../agents/writer/mission-outline-planner.agent";
import { DimensionOutlinePlannerAgent } from "../agents/writer/dimension-outline-planner.agent";
import { ChapterWriterAgent } from "../agents/writer/chapter-writer.agent";
import { ChapterReviewerAgent } from "../agents/writer/chapter-reviewer.agent";
import { DimensionIntegratorAgent } from "../agents/writer/dimension-integrator.agent";
import { AgentInvoker, type InvocationContext } from "./agent-invoker.service";
import type { IAgentEvent } from "@/modules/ai-harness/facade";
import { normalizeRunnerState } from "@/modules/ai-harness/facade";

interface InvokeResult<TOut> {
  // degraded: reflexion verifier 评分 < passThreshold 但 outputSchema 合法的次优产物，
  // 调用方应当作"可用"对待（避免因为 75 分门槛把整个 mission 全废）。
  state: "completed" | "degraded" | "failed" | "cancelled";
  output?: TOut;
  events: readonly IAgentEvent[];
  iterations: number;
  wallTimeMs: number;
}

@Injectable()
export class WriterService {
  constructor(private readonly invoker: AgentInvoker) {}

  async writeSingleShot<TIn, TOut>(
    input: TIn,
    ctx: InvocationContext,
  ): Promise<InvokeResult<TOut>> {
    return this.invokeWriter(SingleShotWriterAgent, input, ctx);
  }

  async planMissionOutline<TIn, TOut>(
    input: TIn,
    ctx: InvocationContext,
  ): Promise<InvokeResult<TOut>> {
    return this.invokeWriter(MissionOutlinePlannerAgent, input, ctx);
  }

  async planDimensionOutline<TIn, TOut>(
    input: TIn,
    ctx: InvocationContext,
  ): Promise<InvokeResult<TOut>> {
    return this.invokeWriter(DimensionOutlinePlannerAgent, input, ctx);
  }

  async writeChapter<TIn, TOut>(
    input: TIn,
    ctx: InvocationContext,
  ): Promise<InvokeResult<TOut>> {
    return this.invokeWriter(ChapterWriterAgent, input, ctx);
  }

  async reviewChapter<TIn, TOut>(
    input: TIn,
    ctx: InvocationContext,
  ): Promise<InvokeResult<TOut>> {
    return this.invokeWriter(ChapterReviewerAgent, input, ctx);
  }

  async integrateDimension<TIn, TOut>(
    input: TIn,
    ctx: InvocationContext,
  ): Promise<InvokeResult<TOut>> {
    return this.invokeWriter(DimensionIntegratorAgent, input, ctx);
  }

  // ── private ──

  private async invokeWriter<TSpec, TIn, TOut>(
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
