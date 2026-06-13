/**
 * PublishExecutorService — S8 真实发布执行派发
 *
 * Social 独有 service —— PublishExecutor 是唯一能产生平台副作用的角色。
 * 调本 service 即触发真实 saveDraft / publish API。
 *
 * 注意 vs 老的 services/publish-executor.service.ts：本服务是 agent team 版，
 * 调 LLM agent 编排 publish 流；老服务 PR-5 切换前继续承载旧路径。
 */

import { Injectable } from "@nestjs/common";
import {
  PublishExecutorAgent,
  type PublishExecutorInput,
  type PublishExecutorOutput,
} from "../../mission/agents/publish-executor";
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

export interface PublishExecutorInvocationResult {
  state: "completed" | "degraded" | "failed" | "cancelled";
  output?: PublishExecutorOutput;
  events: readonly IAgentEvent[];
  iterations: number;
  wallTimeMs: number;
}

@Injectable()
export class PublishExecutorAgentService {
  constructor(private readonly invoker: SocialAgentInvoker) {}

  async run(args: {
    input: PublishExecutorInput;
    ctx: SocialInvocationContext;
    pool?: MissionBudgetPool;
  }): Promise<PublishExecutorInvocationResult> {
    const r = await this.invoker.invoke(
      PublishExecutorAgent,
      args.input,
      args.ctx,
    );
    if (args.pool) {
      await this.invoker.tickCost(
        args.ctx.missionId,
        args.ctx.userId,
        `publish-execute-${args.input.platform}`,
        args.pool,
        extractTokenSpend(r.events),
      );
    }
    return {
      state: normalizeRunnerState(r.state),
      output: r.output as PublishExecutorOutput | undefined,
      events: r.events,
      iterations: r.iterations,
      wallTimeMs: r.wallTimeMs,
    };
  }
}
