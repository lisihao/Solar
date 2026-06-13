/**
 * Progress Tracker Interface
 * 进度追踪器抽象接口
 */

import { ProgressEvent, RoomConfig } from "./event-emitter.interface";

/**
 * 任务阶段
 */
export interface TaskPhase {
  id: string;
  name: string;
  order: number;
  weight: number; // 权重（用于计算总进度）
  status: "pending" | "in_progress" | "completed" | "skipped" | "failed";
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

/**
 * 追踪的任务
 */
export interface TrackedTask {
  id: string;
  type: string;
  name: string;
  roomConfig: RoomConfig;
  phases: TaskPhase[];
  currentPhaseId?: string;
  progress: number; // 0-100
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 创建任务追踪请求
 */
export interface CreateTrackedTaskRequest {
  id: string;
  type: string;
  name: string;
  roomConfig: RoomConfig;
  phases: Array<{
    id: string;
    name: string;
    weight?: number;
  }>;
  metadata?: Record<string, unknown>;
}

/**
 * 进度追踪器接口
 */
export interface IProgressTracker {
  /**
   * 创建任务追踪
   */
  create(request: CreateTrackedTaskRequest): TrackedTask;

  /**
   * 开始任务
   */
  start(taskId: string): void;

  /**
   * 开始阶段
   */
  startPhase(taskId: string, phaseId: string, message?: string): void;

  /**
   * 更新阶段进度
   */
  updatePhaseProgress(
    taskId: string,
    phaseId: string,
    progress: number,
    message?: string,
  ): void;

  /**
   * 完成阶段
   */
  completePhase(taskId: string, phaseId: string, message?: string): void;

  /**
   * 跳过阶段
   */
  skipPhase(taskId: string, phaseId: string, reason?: string): void;

  /**
   * 阶段失败
   */
  failPhase(taskId: string, phaseId: string, error: string): void;

  /**
   * 完成任务
   */
  complete(taskId: string, message?: string): void;

  /**
   * 任务失败
   */
  fail(taskId: string, error: string): void;

  /**
   * 取消任务
   */
  cancel(taskId: string, reason?: string): void;

  /**
   * 获取当前进度
   */
  getProgress(taskId: string): ProgressEvent | null;

  /**
   * 获取任务详情
   */
  getTask(taskId: string): TrackedTask | null;

  /**
   * 获取所有活跃任务
   */
  getActiveTasks(): TrackedTask[];

  /**
   * 清理已完成的任务
   */
  cleanup(olderThan?: Date): number;

  /**
   * 设置进度回调
   * @returns 取消回调的函数
   */
  onProgress(
    taskId: string,
    callback: (progress: ProgressEvent) => void,
  ): () => void;

  /**
   * 设置任务完成回调
   */
  onComplete(taskId: string, callback: (task: TrackedTask) => void): () => void;

  /**
   * 设置任务失败回调
   */
  onFail(
    taskId: string,
    callback: (task: TrackedTask, error: string) => void,
  ): () => void;
}

/**
 * 进度计算器
 * 计算所有阶段的总体进度（考虑 completed、skipped 状态）
 * 注意：in_progress 阶段的部分进度由 ProgressTrackerService.calculateProgress 单独处理
 */
export function calculateOverallProgress(phases: TaskPhase[]): number {
  const totalWeight = phases.reduce((sum, p) => sum + p.weight, 0);
  if (totalWeight === 0) return 0;

  let completedWeight = 0;
  for (const phase of phases) {
    if (phase.status === "completed" || phase.status === "skipped") {
      // 已完成和跳过的阶段计入完成权重
      completedWeight += phase.weight;
    }
    // 注意：in_progress 状态的部分进度不在此函数处理
    // 这是为了与 completePhase() 调用时的行为一致
  }

  return Math.round((completedWeight / totalWeight) * 100);
}
