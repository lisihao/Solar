/**
 * EditorService — 薄包 AgentInvoker，派发 EditorAgent
 *
 * 语义方法 run：执行 fix_issues / polish / unify_style / final_review（operation 由 input 决定）。
 * 质量评估问题列表由 s6/s7 stage 生成后喂进 input.params（见 editor.agent.ts 头注）。
 */

import { Injectable } from "@nestjs/common";
import {
  EditorAgent,
  type EditorInput,
  type EditorOutput,
} from "../agents/editor.agent";
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

export interface EditorInvocationResult {
  state: "completed" | "degraded" | "failed" | "cancelled";
  output?: EditorOutput;
  events: readonly IAgentEvent[];
  iterations: number;
  wallTimeMs: number;
}

@Injectable()
export class EditorService {
  constructor(private readonly invoker: AgentInvoker) {}

  async run(args: {
    input: EditorInput;
    ctx: InvocationContext;
    pool?: MissionBudgetPool;
  }): Promise<EditorInvocationResult> {
    const r = await this.invoker.invoke(EditorAgent, args.input, args.ctx);
    if (args.pool) {
      await this.invoker.tickCost(
        args.ctx.missionId,
        args.ctx.userId,
        `editor-${args.input.operation}-${args.input.chapterId}`,
        args.pool,
        extractTokenSpend(r.events),
        r.events,
      );
    }
    return {
      state: normalizeRunnerState(r.state),
      output: r.output as EditorOutput | undefined,
      events: r.events,
      iterations: r.iterations,
      wallTimeMs: r.wallTimeMs,
    };
  }
}
