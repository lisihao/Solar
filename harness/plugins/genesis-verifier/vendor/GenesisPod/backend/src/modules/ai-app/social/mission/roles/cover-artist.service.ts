/**
 * CoverArtistService — S5 封面生成派发
 */

import { Injectable } from "@nestjs/common";
import {
  CoverArtistAgent,
  type CoverArtistInput,
  type CoverArtistOutput,
} from "../../mission/agents/cover-artist";
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

export interface CoverArtistInvocationResult {
  state: "completed" | "degraded" | "failed" | "cancelled";
  output?: CoverArtistOutput;
  events: readonly IAgentEvent[];
  iterations: number;
  wallTimeMs: number;
}

@Injectable()
export class CoverArtistService {
  constructor(private readonly invoker: SocialAgentInvoker) {}

  async run(args: {
    input: CoverArtistInput;
    ctx: SocialInvocationContext;
    pool?: MissionBudgetPool;
  }): Promise<CoverArtistInvocationResult> {
    const r = await this.invoker.invoke(CoverArtistAgent, args.input, args.ctx);
    if (args.pool) {
      await this.invoker.tickCost(
        args.ctx.missionId,
        args.ctx.userId,
        `cover-craft-${args.input.platform}`,
        args.pool,
        extractTokenSpend(r.events),
      );
    }
    return {
      state: normalizeRunnerState(r.state),
      output: r.output as CoverArtistOutput | undefined,
      events: r.events,
      iterations: r.iterations,
      wallTimeMs: r.wallTimeMs,
    };
  }
}
