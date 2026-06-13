/**
 * WriterService — 薄包 AgentInvoker，派发 WriterAgent（章节写作）
 *
 * 形态对齐 social/playground role service：注入 invoker，暴露语义方法
 * writeChapter，返回 normalizeRunnerState 透传的结果。12 类质量约束的生成
 * 由 s4-chapter-fanout stage 注入到 input.chapterContext（见 writer.agent.ts 头注）。
 */

import { Injectable } from "@nestjs/common";
import {
  WriterAgent,
  type WriterInput,
  type WriterOutput,
} from "../agents/writer.agent";
import {
  AgentInvoker,
  extractTokenSpend,
  type InvocationContext,
} from "./agent-invoker.service";
import {
  MissionBudgetPool,
  type IAgentEvent,
} from "@/modules/ai-harness/facade";
import { normalizeRunnerState } from "@/modules/ai-harness/facade";

export interface WriterInvocationResult {
  state: "completed" | "degraded" | "failed" | "cancelled";
  output?: WriterOutput;
  events: readonly IAgentEvent[];
  iterations: number;
  wallTimeMs: number;
}

@Injectable()
export class WriterService {
  constructor(private readonly invoker: AgentInvoker) {}

  async writeChapter(args: {
    input: WriterInput;
    ctx: InvocationContext;
    pool?: MissionBudgetPool;
  }): Promise<WriterInvocationResult> {
    const r = await this.invoker.invoke(WriterAgent, args.input, args.ctx);
    if (args.pool) {
      await this.invoker.tickCost(
        args.ctx.missionId,
        args.ctx.userId,
        `chapter-write-${args.input.chapterId}`,
        args.pool,
        extractTokenSpend(r.events),
        r.events,
      );
    }
    return {
      state: normalizeRunnerState(r.state),
      output: r.output as WriterOutput | undefined,
      events: r.events,
      iterations: r.iterations,
      wallTimeMs: r.wallTimeMs,
    };
  }
}
