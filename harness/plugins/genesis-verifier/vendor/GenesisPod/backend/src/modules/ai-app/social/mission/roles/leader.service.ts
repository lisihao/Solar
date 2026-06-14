/**
 * LeaderService — leader agent 4-phase 派发
 *
 * Mirror playground LeaderService pattern。leader 跨 4 milestone（plan / assess-
 * transform / foreword / signoff）同一 agent 实例，每 phase 单独 invoke。
 */

import { Injectable } from "@nestjs/common";
import {
  LeaderAgent,
  type LeaderInput,
  type LeaderOutput,
} from "../../mission/agents/leader";
import {
  SocialAgentInvoker,
  extractTokenSpend,
  type SocialInvocationContext,
} from "./social-agent-invoker.service";
import {
  MissionBudgetPool,
  type IAgentEvent,
} from "@/modules/ai-harness/facade";
import { normalizeRunnerState } from "@/modules/ai-harness/facade";

export interface LeaderInvocationResult {
  state: "completed" | "degraded" | "failed" | "cancelled";
  output?: LeaderOutput;
  events: readonly IAgentEvent[];
  iterations: number;
  wallTimeMs: number;
}

@Injectable()
export class LeaderService {
  constructor(private readonly invoker: SocialAgentInvoker) {}

  async run(args: {
    input: LeaderInput;
    ctx: SocialInvocationContext;
    pool?: MissionBudgetPool;
  }): Promise<LeaderInvocationResult> {
    const r = await this.invoker.invoke(LeaderAgent, args.input, args.ctx);
    if (args.pool) {
      await this.invoker.tickCost(
        args.ctx.missionId,
        args.ctx.userId,
        `leader-${args.input.phase}`,
        args.pool,
        extractTokenSpend(r.events),
      );
    }
    return {
      state: normalizeRunnerState(r.state),
      output: r.output as LeaderOutput | undefined,
      events: r.events,
      iterations: r.iterations,
      wallTimeMs: r.wallTimeMs,
    };
  }
}
