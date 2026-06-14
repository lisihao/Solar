/**
 * ContextIsolation — 独立 envelope，继承 userId
 *
 * 子 agent 拿到全新的 envelope（空 messages、空 reminders），
 * 但仍共享父的 userId（用于 long-term memory 访问）。
 * 适合：并行子任务，不需要父对话历史污染。
 */

import type { IContextEnvelope } from "@/modules/ai-harness/agents/abstractions";
import { ContextEnvelope } from "@/modules/ai-harness/agents/core/context-envelope";
import type {
  IsolationDeriveOptions,
  IsolationPolicy,
} from "./isolation.types";
import { filterInheritedTools } from "./isolation.types";

const DEFAULT_MAX_TOKENS = 20_000;
const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_MAX_WALL_TIME_MS = 5 * 60_000;

export class ContextIsolation implements IsolationPolicy {
  readonly kind = "context" as const;

  derive(
    parent: IContextEnvelope,
    options: IsolationDeriveOptions,
  ): IContextEnvelope {
    const over = options.budgetOverride;
    const parentRemainingTokens = parent.budget.tokensRemaining;
    const parentRemainingIters = parent.budget.iterationsRemaining;

    // Child budget cannot exceed parent's remaining; respects override as upper cap
    const childMaxTokens = Math.min(
      over?.maxTokens ?? DEFAULT_MAX_TOKENS,
      parentRemainingTokens,
    );
    const childMaxIters = Math.min(
      over?.maxIterations ?? DEFAULT_MAX_ITERATIONS,
      parentRemainingIters,
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
        // New session id for this subagent
        sessionId: options.subagentSessionId,
        userId: parent.memory.userId,
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
        isolation: "context",
      },
    });
  }
}

export const DEFAULT_CONTEXT_BUDGET = {
  maxTokens: DEFAULT_MAX_TOKENS,
  maxIterations: DEFAULT_MAX_ITERATIONS,
  maxWallTimeMs: DEFAULT_MAX_WALL_TIME_MS,
};
