/**
 * Subagent — 带隔离的子 Agent 派生
 *
 * 三级 isolation（借鉴 Claude Code 的 Task isolation）：
 *   - none:     共享父 agent 的 context
 *   - context:  独立 envelope，但共享 memory binding
 *   - worktree: 独立 envelope + 独立 session + 独立资源（重型场景）
 */

import type { IAgent } from "./agent.interface";
import type { IAgentEvent } from "./agent-event.interface";
import type { IAgentIdentity } from "./identity.interface";

export type SubagentIsolation = "none" | "context" | "worktree";

/** 子 Agent 派生规格 */
export interface ISubagentSpec {
  /** 派生 Agent 的 display name（可观测性用） */
  name: string;
  /** 派生 Agent 的 identity（可以是精简的 role） */
  identity: IAgentIdentity;
  /** 启动 prompt（子 agent 的初始任务） */
  prompt: string;
  /** 隔离等级，默认 context */
  isolation?: SubagentIsolation;
  /** 独立预算，超出则子 agent 自动终止 */
  budget?: {
    maxTokens?: number;
    maxIterations?: number;
    maxWallTimeMs?: number;
  };
  /**
   * T3 (sub-agent least-privilege): the child's tool allowlist. When set, the
   * child inherits only (parent.tools ∩ allowedTools). Empty/undefined ⇒ inherit
   * all non-forbidden parent tools. Mirrors Claude Code's sub-agent allowlist.
   */
  allowedTools?: readonly string[];
  /** T3: tools the child must never see, even if the parent has them. */
  forbiddenTools?: readonly string[];
}

/** 子 Agent 运行句柄 */
export interface ISubagentHandle {
  readonly id: string;
  readonly name: string;
  readonly parent: IAgent;
  readonly spec: ISubagentSpec;
  /** 事件流 */
  readonly events: AsyncIterable<IAgentEvent>;
  /** 等待结果（最终 output event 的 payload） */
  waitForResult(): Promise<string | Record<string, unknown>>;
  /** 中止 */
  abort(reason?: string): Promise<void>;
}

/** Spawner 对外接口（Harness 内部实现） */
export interface ISubagentSpawner {
  spawn(parent: IAgent, spec: ISubagentSpec): Promise<ISubagentHandle>;
}
