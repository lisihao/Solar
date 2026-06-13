/**
 * DynamicReplanner 接口
 *
 * 归属：@/modules/ai-harness/runner/env/ — 通用
 * 具体 Leader 逻辑由 app 层实现（{app} 的 ResearchDynamicReplanner 等）。
 *
 * 动作枚举：harness 定义通用的 ReplanOperation，Leader 根据观察执行态产出操作序列。
 */

import type { AgentTask } from "../env/types";

export type ReplanOperation<TMetadata extends Record<string, unknown>> =
  | {
      kind: "spawn_subtask";
      parentTaskId?: string;
      newTask: Partial<AgentTask<TMetadata>> & {
        type: string;
        title: string;
        description: string;
        metadata: TMetadata;
      };
    }
  | { kind: "merge_tasks"; taskIds: readonly string[]; reason?: string }
  | { kind: "cancel_task"; taskId: string; reason?: string }
  | { kind: "extend_budget"; taskId: string; extraTokens: number }
  | { kind: "add_judge"; taskId: string; judgeId: string }
  | { kind: "no_op"; reason?: string };

export interface ReplanObservations<TMetadata extends Record<string, unknown>> {
  readonly completedTasks: ReadonlyArray<AgentTask<TMetadata>>;
  readonly failedTasks: ReadonlyArray<AgentTask<TMetadata>>;
  readonly runningTasks: ReadonlyArray<AgentTask<TMetadata>>;
  /** 用来累积 Leader 观察到的跨 task keyFindings / gaps / conflicts 等（业务自填） */
  readonly missionContext: Record<string, unknown>;
}

export interface ReplanDecision<TMetadata extends Record<string, unknown>> {
  readonly operations: readonly ReplanOperation<TMetadata>[];
  readonly rationale: string;
}

export interface DynamicReplanner<TMetadata extends Record<string, unknown>> {
  /**
   * 每当 mission 内一个 task COMPLETED 时被调用（由 MissionOrchestrator 触发）。
   * 返回的 operations 会被 orchestrator 逐一执行（spawn/merge/cancel/extend/...）。
   */
  onTaskCompleted(
    completedTask: AgentTask<TMetadata>,
    observations: ReplanObservations<TMetadata>,
  ): Promise<ReplanDecision<TMetadata>>;
}
