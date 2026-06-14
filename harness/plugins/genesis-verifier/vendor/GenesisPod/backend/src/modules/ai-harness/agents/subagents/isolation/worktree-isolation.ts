/**
 * WorktreeIsolation — 最强隔离（新 session + 不共享 userId）
 *
 * Phase 4 实现：session/memory 级隔离（为代码执行场景预留；本 phase 不真开 git worktree，
 * 那部分在未来与 Sandbox 集成时引入）。
 *
 * 适合：运行不可信代码、需要最强 blast-radius 控制的子任务。
 */

import type { IContextEnvelope } from "@/modules/ai-harness/agents/abstractions";
import { ContextEnvelope } from "@/modules/ai-harness/agents/core/context-envelope";
import type {
  IsolationDeriveOptions,
  IsolationPolicy,
} from "./isolation.types";
import { filterInheritedTools } from "./isolation.types";

const DEFAULT_MAX_TOKENS = 10_000;
const DEFAULT_MAX_ITERATIONS = 5;

export class WorktreeIsolation implements IsolationPolicy {
  readonly kind = "worktree" as const;

  derive(
    parent: IContextEnvelope,
    options: IsolationDeriveOptions,
  ): IContextEnvelope {
    const over = options.budgetOverride;
    const childMaxTokens = Math.min(
      over?.maxTokens ?? DEFAULT_MAX_TOKENS,
      parent.budget.tokensRemaining,
    );
    const childMaxIters = Math.min(
      over?.maxIterations ?? DEFAULT_MAX_ITERATIONS,
      parent.budget.iterationsRemaining,
    );

    return new ContextEnvelope({
      system: options.subagentSystemPrompt,
      messages: [],
      reminders: [],
      tools: filterInheritedTools(
        parent.tools,
        options.allowedTools,
        options.forbiddenTools,
      ),
      memory: {
        sessionId: options.subagentSessionId,
        // Explicitly DO NOT inherit userId → no long-term memory access
        userId: undefined,
      },
      budget: {
        tokensUsed: 0,
        tokensRemaining: childMaxTokens,
        iterationsUsed: 0,
        iterationsRemaining: childMaxIters,
        wallTimeStartMs: Date.now(),
      },
      metadata: {
        parentSessionId: parent.memory.sessionId,
        parentUserId: parent.memory.userId,
        isolation: "worktree",
      },
    });
  }
}
