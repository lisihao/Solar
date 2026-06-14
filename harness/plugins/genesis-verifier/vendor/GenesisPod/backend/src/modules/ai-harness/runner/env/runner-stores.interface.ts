/**
 * SOTA Runtime · Persistence Store 接口（方案 §0.3）
 *
 * harness 层只声明接口，不碰 Prisma。由 AI App 层（业务模块 / ...）
 * 提供 Prisma 实现，通过 NestJS DI 注入 ReActRunner。
 *
 * 归属：@/modules/ai-harness/runner/env/ — 通用（任何 App 复用）
 */

import type {
  AgentStepRecord,
  AgentTask,
  CheckpointData,
  TaskStatus,
  VerificationResult,
} from "../env/types";

/**
 * StepStore — AgentStep 持久化抽象
 *
 * {app} 实现：写 `agent_steps` 表（带 missionId/topicId）
 * research 将来实现：写 `research_agent_steps` 表（带 sessionId）
 * 等等
 */
export interface StepStore {
  /** 写入一条 step 记录，返回 stepId */
  write(
    record: AgentStepRecord,
    metadata: Record<string, unknown>,
  ): Promise<string>;

  /** 同 taskId + iteration 下的下一个 stepIndex */
  nextStepIndex(taskId: string, iteration: number): Promise<number>;
}

/**
 * CheckpointStore — 崩溃恢复快照持久化抽象
 */
export interface CheckpointStore {
  /** 保存 checkpoint，返回 checkpointId */
  save(
    taskId: string,
    data: CheckpointData,
    status: TaskStatus,
    metadata: Record<string, unknown>,
  ): Promise<string>;

  /** 加载最新 checkpoint；没有返回 null */
  loadLatest(taskId: string): Promise<CheckpointData | null>;

  /** 任务 COMPLETED 后清理 checkpoint（省空间） */
  clear(taskId: string): Promise<void>;
}

/**
 * VerificationStore — multi-judge 审核结果持久化抽象
 */
export interface VerificationStore {
  /** 写入一次 verification 结果，返回 recordId */
  write(
    result: VerificationResult,
    metadata: Record<string, unknown>,
  ): Promise<string>;
}

/**
 * TaskStore — AgentTask 业务行状态同步抽象
 *
 * ReAct runner 只通过此接口更新 task 状态/产物，不直接碰业务 schema。
 */
export interface TaskStore<TMetadata = Record<string, unknown>> {
  /** 加载 AgentTask（通用视图） */
  load(taskId: string): Promise<AgentTask<TMetadata> | null>;

  /** 更新状态（支持 FSM 转换） */
  updateStatus(
    taskId: string,
    status: TaskStatus,
    extra?: {
      startedAt?: Date;
      completedAt?: Date;
      pausedAt?: Date;
      resumedAt?: Date;
      requiresRevision?: boolean;
      resultSummary?: string;
    },
  ): Promise<void>;

  /** 更新迭代进度 + budget 快照 */
  updateProgress(
    taskId: string,
    data: {
      currentIteration?: number;
      tokensUsed?: number;
      costUsd?: number;
      latencyMs?: number;
      lastCheckpointId?: string;
    },
  ): Promise<void>;

  /** 写入最终 result（COMPLETED 时调用） */
  writeResult(
    taskId: string,
    data: {
      result: unknown;
      resultScore?: number;
      resultSummary?: string;
    },
  ): Promise<void>;

  /** retry count +1（fail 后重试） */
  markForRetry(taskId: string): Promise<void>;
}
