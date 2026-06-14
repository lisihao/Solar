/**
 * ConsistencyService — 薄包 AgentInvoker，派发 ConsistencyCheckerAgent
 *
 * 语义方法 checkChapter：对单章正文做五维一致性检查 + 新事实提取。
 * SemanticConsistency / FactExtractor 等领域 dep 的补充信号由 s5 stage 喂进 input
 * （见 consistency-checker.agent.ts 头注）。
 */

import { Injectable } from "@nestjs/common";
import {
  ConsistencyCheckerAgent,
  type ConsistencyCheckerInput,
  type ConsistencyCheckerOutput,
} from "../agents/consistency-checker.agent";
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

export interface ConsistencyInvocationResult {
  state: "completed" | "degraded" | "failed" | "cancelled";
  output?: ConsistencyCheckerOutput;
  events: readonly IAgentEvent[];
  iterations: number;
  wallTimeMs: number;
}

@Injectable()
export class ConsistencyService {
  constructor(private readonly invoker: AgentInvoker) {}

  async checkChapter(args: {
    input: ConsistencyCheckerInput;
    ctx: InvocationContext;
    pool?: MissionBudgetPool;
  }): Promise<ConsistencyInvocationResult> {
    const r = await this.invoker.invoke(
      ConsistencyCheckerAgent,
      args.input,
      args.ctx,
    );
    if (args.pool) {
      await this.invoker.tickCost(
        args.ctx.missionId,
        args.ctx.userId,
        `consistency-${args.input.chapterId}`,
        args.pool,
        extractTokenSpend(r.events),
        r.events,
      );
    }
    return {
      state: normalizeRunnerState(r.state),
      output: r.output as ConsistencyCheckerOutput | undefined,
      events: r.events,
      iterations: r.iterations,
      wallTimeMs: r.wallTimeMs,
    };
  }
}
