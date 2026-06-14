/**
 * StewardService — S1 budget-eval 4 闸守门派发
 */

import { Injectable } from "@nestjs/common";
import {
  StewardAgent,
  type StewardInput,
  type StewardOutput,
} from "../../mission/agents/steward";
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

export interface StewardInvocationResult {
  state: "completed" | "degraded" | "failed" | "cancelled";
  output?: StewardOutput;
  events: readonly IAgentEvent[];
  iterations: number;
  wallTimeMs: number;
}

@Injectable()
export class StewardService {
  constructor(private readonly invoker: SocialAgentInvoker) {}

  async run(args: {
    input: StewardInput;
    ctx: SocialInvocationContext;
    pool?: MissionBudgetPool;
  }): Promise<StewardInvocationResult> {
    const r = await this.invoker.invoke(StewardAgent, args.input, args.ctx);
    if (args.pool) {
      await this.invoker.tickCost(
        args.ctx.missionId,
        args.ctx.userId,
        "steward",
        args.pool,
        extractTokenSpend(r.events),
      );
    }
    return {
      state: normalizeRunnerState(r.state),
      output: r.output as StewardOutput | undefined,
      events: r.events,
      iterations: r.iterations,
      wallTimeMs: r.wallTimeMs,
    };
  }
}
