/**
 * DAGExecutor — 通用动态任务 DAG 调度器
 *
 * 沉淀自：ai-app/{app}/services/core/mission/mission-execution.service.ts:1138-1261
 * 剥离对 prisma.researchTask 的耦合，业务侧通过 DAGAdapter 注入 fetch / cancellation / 持久化。
 *
 * 核心特性：
 *   1. **真正动态** —— Promise.race 在任意任务完成时立即检查是否有新可执行任务
 *      （不像 Promise.all 必须等所有任务完成才下一轮）
 *   2. **依赖求解** —— 调用方在 fetchExecutable 中过滤"依赖已完成"的任务
 *   3. **并发上限** —— maxConcurrent 限制同时 in-flight 数
 *   4. **死锁检测** —— 30 次连续无任务可拾取时退出（依赖循环 / 业务 bug）
 *   5. **取消感知** —— 每轮检查 isCancelled，支持优雅停止
 *
 * 业务侧职责：
 *   - fetchExecutable: 返回当前可执行的 task 列表（已过滤已完成 / 依赖未满足）
 *   - executor: 执行单个任务（含失败兜底，不抛错以免污染调度循环）
 *   - countPending: 返回剩余待处理任务数（用于判断退出 / 死锁）
 *   - isCancelled: 业务侧检查 mission 是否已取消
 */

import { Injectable, Logger } from "@nestjs/common";

export interface DAGTask {
  id: string;
  // 业务侧任意附加字段（透传给 executor）
  [key: string]: unknown;
}

export interface DAGAdapter<TTask extends DAGTask> {
  /** 返回当前可执行的任务（业务侧已过滤已完成 / 依赖未满足）*/
  fetchExecutable(): Promise<TTask[]>;
  /** 单任务执行 —— 失败应内部 catch，不抛出 */
  executor: (task: TTask) => Promise<void>;
  /** 剩余 pending 任务数（用于退出判断 / 死锁检测）*/
  countPending(): Promise<number>;
  /** 业务侧是否已取消 mission */
  isCancelled(): Promise<boolean>;
}

export interface DAGSchedulerConfig {
  maxConcurrent: number;
  /** 无新任务可拾取时等待轮询间隔（默认 2000ms）*/
  pollIntervalMs?: number;
  /** 任务完成后短暂延迟让 DB 状态稳定（默认 100ms）*/
  postTaskDelayMs?: number;
  /** 连续等待轮数上限触发死锁退出（默认 30）*/
  maxConsecutiveWaits?: number;
}

const DEFAULT_CONFIG: Required<Omit<DAGSchedulerConfig, "maxConcurrent">> = {
  pollIntervalMs: 2000,
  postTaskDelayMs: 100,
  maxConsecutiveWaits: 30,
};

export interface DAGExecutionResult {
  completed: number;
  cancelled: boolean;
  deadlocked: boolean;
  totalRounds: number;
}

@Injectable()
export class DAGExecutor {
  private readonly log = new Logger(DAGExecutor.name);

  /**
   * 启动动态调度。返回 promise 在所有任务完成 / 取消 / 死锁时 resolve。
   */
  async run<TTask extends DAGTask>(
    adapter: DAGAdapter<TTask>,
    config: DAGSchedulerConfig,
  ): Promise<DAGExecutionResult> {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const executingTasks = new Map<string, Promise<void>>();
    const completedTaskIds = new Set<string>();
    let consecutiveWaits = 0;
    let cancelled = false;
    let deadlocked = false;
    let rounds = 0;

    while (true) {
      rounds++;
      // 0. 取消检查
      if (await adapter.isCancelled()) {
        this.log.log("[dag] cancelled, stopping scheduler");
        cancelled = true;
        break;
      }

      // 1. 拉可执行任务
      const executable = await adapter.fetchExecutable();
      const newTasks = executable.filter(
        (t) => !completedTaskIds.has(t.id) && !executingTasks.has(t.id),
      );

      // 2. 调度新任务到空闲槽位
      const availableSlots = cfg.maxConcurrent - executingTasks.size;
      const tasksToStart = newTasks.slice(0, availableSlots);

      if (tasksToStart.length > 0) consecutiveWaits = 0;

      for (const task of tasksToStart) {
        const taskPromise = adapter
          .executor(task)
          .then(() => {
            // 仅成功时标记完成（失败任务可能被业务侧重置为 PENDING 重试）
            completedTaskIds.add(task.id);
          })
          .catch((err) => {
            this.log.warn(
              `[dag] task ${task.id} failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          })
          .finally(() => {
            executingTasks.delete(task.id);
          });
        executingTasks.set(task.id, taskPromise);
      }

      // 3. 退出 / 等待判断
      if (executingTasks.size === 0) {
        const remaining = await adapter.countPending();
        if (remaining === 0) {
          this.log.log("[dag] no more tasks, scheduler exit");
          break;
        }
        consecutiveWaits++;
        if (consecutiveWaits >= cfg.maxConsecutiveWaits) {
          this.log.error(
            `[dag] deadlock: ${remaining} pending but no executable after ${consecutiveWaits} waits`,
          );
          deadlocked = true;
          break;
        }
        this.log.debug(
          `[dag] waiting for deps (${remaining} pending, wait ${consecutiveWaits}/${cfg.maxConsecutiveWaits})`,
        );
        await new Promise((r) => setTimeout(r, cfg.pollIntervalMs));
        continue;
      }

      // 4. 等任意一个任务完成，立即下轮拾取（真动态）
      await Promise.race(executingTasks.values());

      if (cfg.postTaskDelayMs > 0) {
        await new Promise((r) => setTimeout(r, cfg.postTaskDelayMs));
      }
    }

    // 5. 等剩余任务全部完成
    if (executingTasks.size > 0) {
      this.log.log(`[dag] flushing ${executingTasks.size} remaining tasks`);
      await Promise.all(executingTasks.values());
    }

    return {
      completed: completedTaskIds.size,
      cancelled,
      deadlocked,
      totalRounds: rounds,
    };
  }
}
