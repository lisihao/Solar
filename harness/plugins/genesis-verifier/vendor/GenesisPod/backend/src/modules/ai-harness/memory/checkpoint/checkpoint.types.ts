/**
 * Checkpoint Types — Agent 执行快照
 *
 * Phase 6 设计：agent state + envelope + 已发射事件计数。
 * 未来可扩展：已用预算、skill cleanup fns（需要可序列化重建）、subagent tree 快照。
 */

import type {
  AgentId,
  AgentState,
  IAgentIdentity,
  IContextEnvelope,
} from "../../agents/abstractions";

/** 一个 checkpoint 记录 */
export interface ICheckpoint {
  readonly id: string;
  readonly agentId: AgentId;
  /** HARNESS-SEC-001：归属用户（取自 envelope.userId）。resume/fork 按属主过滤。可空=系统/匿名断点。 */
  readonly ownerUserId?: string;
  readonly takenAt: number;
  readonly reason: CheckpointReason;
  readonly agentState: AgentState;
  /** snapshot 时的 envelope（不可变引用；反序列化时按类重构） */
  readonly envelope: IContextEnvelope;
  /** snapshot 时的 identity（运行时不变，用于 resume 时重建 agent） */
  readonly identity: IAgentIdentity;
  /** 已发射的事件计数（用于 resume 时 replay 或跳过） */
  readonly eventsEmitted: number;
  /** 任务元信息（goal / input），resume 时不重发 user 消息 */
  readonly taskSnapshot?: {
    goal: string;
    input?: string | Record<string, unknown>;
  };
}

export type CheckpointReason =
  | "auto-interval" // 按 N 轮自动
  | "key-event" // 关键事件（action_executed 完成）
  | "manual" // 调用方主动
  | "pre-cancel" // cancel 前 last chance
  | "pre-terminate"; // terminated 前

/** Store 抽象 */
export interface ICheckpointStore {
  save(checkpoint: ICheckpoint): Promise<void>;
  load(id: string): Promise<ICheckpoint | null>;
  listByAgent(agentId: string): Promise<readonly ICheckpoint[]>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

/** AgentStepCheckpointService 对外接口 */
export interface ICheckpointService {
  snapshot(params: {
    agentId: AgentId;
    agentState: AgentState;
    envelope: IContextEnvelope;
    identity: IAgentIdentity;
    eventsEmitted: number;
    reason: CheckpointReason;
    taskSnapshot?: ICheckpoint["taskSnapshot"];
  }): Promise<ICheckpoint>;

  /** 按 checkpoint id 恢复（返回 checkpoint，实际 agent 重建在 Harness 层） */
  load(id: string): Promise<ICheckpoint | null>;

  latestForAgent(agentId: AgentId): Promise<ICheckpoint | null>;

  listForAgent(agentId: AgentId): Promise<readonly ICheckpoint[]>;
}
