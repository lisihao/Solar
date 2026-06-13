/**
 * Isolation Types — 3 级子 Agent 隔离策略
 *
 * - none:     共享父 envelope（同一 session，同一工具集）
 * - context:  独立 envelope（新 session id）；memory binding 继承（共享 userId）
 * - worktree: 独立 envelope + 独立 session + session-level memory 隔绝
 *             (文件系统级 worktree 预留给 code-executing subagent，本 phase 不实际开 worktree)
 */

import type {
  IContextEnvelope,
  SubagentIsolation,
} from "@/modules/ai-harness/agents/abstractions";

export interface IsolationDeriveOptions {
  subagentSessionId: string;
  subagentSystemPrompt: string;
  budgetOverride?: {
    maxTokens?: number;
    maxIterations?: number;
    maxWallTimeMs?: number;
  };
  /**
   * T3 (sub-agent least-privilege): the child's own tool allowlist. When set,
   * the child inherits only (parent.tools ∩ allowedTools); empty/undefined ⇒
   * inherit all non-forbidden parent tools.
   */
  allowedTools?: readonly string[];
  /** T3: tools the child must never see, even if the parent has them. */
  forbiddenTools?: readonly string[];
}

export interface IsolationPolicy {
  readonly kind: SubagentIsolation;
  /** 从父 envelope 派生出子 envelope */
  derive(
    parent: IContextEnvelope,
    options: IsolationDeriveOptions,
  ): IContextEnvelope;
}

/**
 * T3 (sub-agent least-privilege): a child inherits the INTERSECTION of the
 * parent's tools and its own allowlist, minus its forbidden set — never the
 * full parent tool surface. Mirrors Claude Code's sub-agent allowlist mandate
 * (see CLAUDE.md「Sub-Agent 管控」). forbidden wins over allowed; an empty/
 * undefined allowlist means "inherit all non-forbidden parent tools".
 */
export function filterInheritedTools(
  parentTools: readonly string[],
  allowed?: readonly string[],
  forbidden?: readonly string[],
): string[] {
  return parentTools.filter((id) => {
    if (forbidden?.includes(id)) return false;
    if (allowed && allowed.length > 0) return allowed.includes(id);
    return true;
  });
}
