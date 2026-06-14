/**
 * PublishVerifierService — S9 发布后回读校验派发
 */

import { Injectable } from "@nestjs/common";
import {
  PublishVerifierAgent,
  type PublishVerifierInput,
  type PublishVerifierOutput,
} from "../../mission/agents/publish-verifier";
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

export interface PublishVerifierInvocationResult {
  state: "completed" | "degraded" | "failed" | "cancelled";
  output?: PublishVerifierOutput;
  events: readonly IAgentEvent[];
  iterations: number;
  wallTimeMs: number;
}

@Injectable()
export class PublishVerifierService {
  constructor(private readonly invoker: SocialAgentInvoker) {}

  async run(args: {
    input: PublishVerifierInput;
    ctx: SocialInvocationContext;
    pool?: MissionBudgetPool;
  }): Promise<PublishVerifierInvocationResult> {
    const r = await this.invoker.invoke(
      PublishVerifierAgent,
      args.input,
      args.ctx,
    );
    if (args.pool) {
      await this.invoker.tickCost(
        args.ctx.missionId,
        args.ctx.userId,
        `publish-verify-${args.input.platform}`,
        args.pool,
        extractTokenSpend(r.events),
      );
    }
    return {
      state: normalizeRunnerState(r.state),
      output: r.output as PublishVerifierOutput | undefined,
      events: r.events,
      iterations: r.iterations,
      wallTimeMs: r.wallTimeMs,
    };
  }
}
