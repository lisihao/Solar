/**
 * SOTA Runtime · TaskQueue 接口（方案 §0.3 §10）
 *
 * 归属：@/modules/ai-harness/runner/env/ — 通用
 * 实现方：ai-app/{app}/agent/adapters/{biz}-task-queue.ts
 *
 * harness 只声明"DAG 调度 + 优先级 + 并发控制 + 终态检查"能力，具体 persistence
 * 由 App 层实现（比如 {app} 实现 ResearchTaskQueue 操作 `research_tasks` 表）。
 */

export interface QueueStats {
  readonly pending: number;
  readonly queued: number;
  readonly scheduled: number;
  readonly running: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly awaitingHuman: number;
  readonly total: number;
}

export interface EnqueueOptions {
  readonly priority?: number;
  readonly delayMs?: number;
}

/**
 * TaskQueue — DAG 依赖驱动的 task 队列
 *
 * 业务字段（missionId / sessionId / ...）通过 scope 参数传入，runner 不知道具体含义。
 */
export interface TaskQueue {
  /** 把一个 task 入队（CREATED/PENDING → QUEUED） */
  enqueue(taskId: string, options?: EnqueueOptions): Promise<void>;

  /** 批量入队 */
  enqueueMany(taskIds: readonly string[]): Promise<void>;

  /**
   * 取下一个可执行 task：
   *   - status=QUEUED
   *   - 所有 dependencies 已 COMPLETED
   *   - 按 priority DESC, queuedAt ASC 排序
   * 返回的 task 已自动 → SCHEDULED
   */
  dequeueNext(scope: string): Promise<string | null>;

  /** 取消 */
  cancel(taskId: string, reason?: string): Promise<void>;

  /** 查 scope 级 queue 统计 */
  getStats(scope: string): Promise<QueueStats>;

  /** 是否全 task 进入终态 */
  isFinal(stats: QueueStats): boolean;
}
