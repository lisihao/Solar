/**
 * BibleKeeperService — 薄包 AgentInvoker，派发 BibleKeeperAgent
 *
 * 语义方法 run：执行 Story Bible 设定查询 / 校验 / 快照操作（operation 由 input 决定）。
 * 纯查询型 operation 的数据装配在 s2 stage 完成后喂进 input，Agent 侧只做需要 LLM
 * 的语义校验（见 bible-keeper.agent.ts 头注）。
 */

import { Injectable } from "@nestjs/common";
import {
  BibleKeeperAgent,
  type BibleKeeperInput,
  type BibleKeeperOutput,
} from "../agents/bible-keeper.agent";
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

export interface BibleKeeperInvocationResult {
  state: "completed" | "degraded" | "failed" | "cancelled";
  output?: BibleKeeperOutput;
  events: readonly IAgentEvent[];
  iterations: number;
  wallTimeMs: number;
}

@Injectable()
export class BibleKeeperService {
  constructor(private readonly invoker: AgentInvoker) {}

  async run(args: {
    input: BibleKeeperInput;
    ctx: InvocationContext;
    pool?: MissionBudgetPool;
  }): Promise<BibleKeeperInvocationResult> {
    const r = await this.invoker.invoke(BibleKeeperAgent, args.input, args.ctx);
    if (args.pool) {
      await this.invoker.tickCost(
        args.ctx.missionId,
        args.ctx.userId,
        `bible-${args.input.operation}`,
        args.pool,
        extractTokenSpend(r.events),
        r.events,
      );
    }
    return {
      state: normalizeRunnerState(r.state),
      output: r.output as BibleKeeperOutput | undefined,
      events: r.events,
      iterations: r.iterations,
      wallTimeMs: r.wallTimeMs,
    };
  }
}
