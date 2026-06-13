/**
 * StoryArchitectService — 薄包 AgentInvoker，派发 StoryArchitectAgent
 *
 * 语义方法 run：执行整体规划 / 卷章分解 / 章节审核 / 冲突解决（taskType 由 input 决定）。
 * 质量门禁文本由 s3/s7 stage 生成后喂进 input.payload（见 story-architect.agent.ts 头注）。
 */

import { Injectable } from "@nestjs/common";
import {
  StoryArchitectAgent,
  type StoryArchitectInput,
  type StoryArchitectOutput,
} from "../agents/story-architect.agent";
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

export interface StoryArchitectInvocationResult {
  state: "completed" | "degraded" | "failed" | "cancelled";
  output?: StoryArchitectOutput;
  events: readonly IAgentEvent[];
  iterations: number;
  wallTimeMs: number;
}

@Injectable()
export class StoryArchitectService {
  constructor(private readonly invoker: AgentInvoker) {}

  async run(args: {
    input: StoryArchitectInput;
    ctx: InvocationContext;
    pool?: MissionBudgetPool;
  }): Promise<StoryArchitectInvocationResult> {
    const r = await this.invoker.invoke(
      StoryArchitectAgent,
      args.input,
      args.ctx,
    );
    if (args.pool) {
      await this.invoker.tickCost(
        args.ctx.missionId,
        args.ctx.userId,
        `architect-${args.input.taskType}`,
        args.pool,
        extractTokenSpend(r.events),
        r.events,
      );
    }
    return {
      state: normalizeRunnerState(r.state),
      output: r.output as StoryArchitectOutput | undefined,
      events: r.events,
      iterations: r.iterations,
      wallTimeMs: r.wallTimeMs,
    };
  }
}
