/**
 * NoneIsolation — 共享父 envelope
 *
 * 子 agent 直接拿到父 envelope 的引用（只换 system prompt）。
 * 适合：轻量委托（把一个子任务交给另一个 role 做），不需要独立状态。
 */

import type { IContextEnvelope } from "@/modules/ai-harness/agents/abstractions";
import { ContextEnvelope } from "@/modules/ai-harness/agents/core/context-envelope";
import type {
  IsolationDeriveOptions,
  IsolationPolicy,
} from "./isolation.types";
import { filterInheritedTools } from "./isolation.types";

export class NoneIsolation implements IsolationPolicy {
  readonly kind = "none" as const;

  derive(
    parent: IContextEnvelope,
    options: IsolationDeriveOptions,
  ): IContextEnvelope {
    // Clone messages/reminders/tools but keep memory/budget pointers.
    // T3: even shared-context delegation honors the child's allow/forbid policy
    // (forbidden wins; empty allowlist ⇒ inherit all non-forbidden parent tools).
    return new ContextEnvelope({
      system: options.subagentSystemPrompt,
      messages: [...parent.messages],
      reminders: [...parent.reminders],
      tools: filterInheritedTools(
        parent.tools,
        options.allowedTools,
        options.forbiddenTools,
      ),
      memory: parent.memory,
      budget: parent.budget,
      metadata: parent.metadata,
    });
  }
}
