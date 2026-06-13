export { NoneIsolation } from "./none-isolation";
export { ContextIsolation, DEFAULT_CONTEXT_BUDGET } from "./context-isolation";
export { WorktreeIsolation } from "./worktree-isolation";
export type { IsolationPolicy } from "./isolation.types";

import type { SubagentIsolation } from "@/modules/ai-harness/agents/abstractions";
import type { IsolationPolicy } from "./isolation.types";
import { NoneIsolation } from "./none-isolation";
import { ContextIsolation } from "./context-isolation";
import { WorktreeIsolation } from "./worktree-isolation";

/** 根据 kind 选择对应的 isolation 策略（单例） */
const NONE = new NoneIsolation();
const CONTEXT = new ContextIsolation();
const WORKTREE = new WorktreeIsolation();

export function resolveIsolation(kind: SubagentIsolation): IsolationPolicy {
  switch (kind) {
    case "none":
      return NONE;
    case "context":
      return CONTEXT;
    case "worktree":
      return WORKTREE;
  }
}
