/**
 * PlatformProbeService — S2 schema 探测派发
 */

import { Injectable } from "@nestjs/common";
import {
  PlatformProbeAgent,
  type PlatformProbeInput,
  type PlatformProbeOutput,
} from "../../mission/agents/platform-probe";
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

export interface PlatformProbeInvocationResult {
  state: "completed" | "degraded" | "failed" | "cancelled";
  output?: PlatformProbeOutput;
  events: readonly IAgentEvent[];
  iterations: number;
  wallTimeMs: number;
}

@Injectable()
export class PlatformProbeService {
  constructor(private readonly invoker: SocialAgentInvoker) {}

  async run(args: {
    input: PlatformProbeInput;
    ctx: SocialInvocationContext;
    pool?: MissionBudgetPool;
  }): Promise<PlatformProbeInvocationResult> {
    const r = await this.invoker.invoke(
      PlatformProbeAgent,
      args.input,
      args.ctx,
    );
    if (args.pool) {
      await this.invoker.tickCost(
        args.ctx.missionId,
        args.ctx.userId,
        "platform-probe",
        args.pool,
        extractTokenSpend(r.events),
      );
    }
    return {
      state: normalizeRunnerState(r.state),
      output: r.output as PlatformProbeOutput | undefined,
      events: r.events,
      iterations: r.iterations,
      wallTimeMs: r.wallTimeMs,
    };
  }
}
