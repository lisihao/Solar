/**
 * ComposerService — S6 正文 HTML schema 注入派发
 */

import { Injectable } from "@nestjs/common";
import {
  ComposerAgent,
  type ComposerInput,
  type ComposerOutput,
} from "../../mission/agents/composer";
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

export interface ComposerInvocationResult {
  state: "completed" | "degraded" | "failed" | "cancelled";
  output?: ComposerOutput;
  events: readonly IAgentEvent[];
  iterations: number;
  wallTimeMs: number;
}

@Injectable()
export class ComposerService {
  constructor(private readonly invoker: SocialAgentInvoker) {}

  async run(args: {
    input: ComposerInput;
    ctx: SocialInvocationContext;
    pool?: MissionBudgetPool;
  }): Promise<ComposerInvocationResult> {
    const r = await this.invoker.invoke(ComposerAgent, args.input, args.ctx);
    if (args.pool) {
      await this.invoker.tickCost(
        args.ctx.missionId,
        args.ctx.userId,
        `body-compose-${args.input.platform}`,
        args.pool,
        extractTokenSpend(r.events),
      );
    }
    return {
      state: normalizeRunnerState(r.state),
      output: r.output as ComposerOutput | undefined,
      events: r.events,
      iterations: r.iterations,
      wallTimeMs: r.wallTimeMs,
    };
  }
}
