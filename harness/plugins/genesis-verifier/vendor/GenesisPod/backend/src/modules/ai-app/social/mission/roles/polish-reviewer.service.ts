/**
 * PolishReviewerService — S7 critique + refine 派发
 */

import { Injectable } from "@nestjs/common";
import {
  PolishReviewerAgent,
  type PolishReviewerInput,
  type PolishReviewerOutput,
} from "../../mission/agents/polish-reviewer";
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

export interface PolishReviewerInvocationResult {
  state: "completed" | "degraded" | "failed" | "cancelled";
  output?: PolishReviewerOutput;
  events: readonly IAgentEvent[];
  iterations: number;
  wallTimeMs: number;
}

@Injectable()
export class PolishReviewerService {
  constructor(private readonly invoker: SocialAgentInvoker) {}

  async run(args: {
    input: PolishReviewerInput;
    ctx: SocialInvocationContext;
    pool?: MissionBudgetPool;
  }): Promise<PolishReviewerInvocationResult> {
    const r = await this.invoker.invoke(
      PolishReviewerAgent,
      args.input,
      args.ctx,
    );
    if (args.pool) {
      await this.invoker.tickCost(
        args.ctx.missionId,
        args.ctx.userId,
        `polish-review-${args.input.platform}`,
        args.pool,
        extractTokenSpend(r.events),
      );
    }
    return {
      state: normalizeRunnerState(r.state),
      output: r.output as PolishReviewerOutput | undefined,
      events: r.events,
      iterations: r.iterations,
      wallTimeMs: r.wallTimeMs,
    };
  }
}
