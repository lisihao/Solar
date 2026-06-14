/**
 * SOTA Runtime · MissionOrchestrator (thin + generic)
 *
 * 方案文档 §2.1 Layer 1 / §5。位于 @/modules/ai-harness/runner/ — 通用。
 *
 * 职责（薄层）：
 *   - enqueue 初始 task 列表
 *   - 循环 dequeue → ReActRunner.execute → task.status=COMPLETED
 *   - 所有 task 终态后 finalize（调 finalizer 回调）
 *
 * 不负责：
 *   - 具体业务 schema（由 TaskStore/TaskQueue/StepStore 接口注入）
 *   - 动态 replan（由 DynamicReplanner 事件触发，通过 onTaskCompleted hook）
 *   - HITL UI（由 app 层 API 处理）
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  ReActRunner,
  type ConsensusResolver,
  type LLMCaller,
  type ReActStores,
} from "@/modules/ai-harness/runner/env/react-runner";
import type {
  TaskQueue,
  QueueStats,
} from "@/modules/ai-harness/runner/env/task-queue-interface";
import type { ProtocolRegistry } from "@/modules/ai-harness/runner/env/protocol-registry-interface";
import {
  HumanInLoopPause,
  type AgentTask,
} from "@/modules/ai-harness/runner/env/types";

export interface FinalizerCallback<TMetadata extends Record<string, unknown>> {
  (scope: string, stats: QueueStats, metadata: TMetadata): Promise<void>;
}

export interface TaskCompletedHook<TMetadata extends Record<string, unknown>> {
  (task: AgentTask<TMetadata>, scope: string): Promise<void>;
}

export interface OrchestrateOptions<TMetadata extends Record<string, unknown>> {
  /** mission 级 scope（由 app 层决定，通常 = missionId） */
  readonly scope: string;
  /** 通用 metadata（finalizer 回调时透传） */
  readonly scopeMetadata: TMetadata;
  /** 每个 task 完成后触发（用于 DynamicReplanner） */
  readonly onTaskCompleted?: TaskCompletedHook<TMetadata>;
  /** mission 终态时触发（用于 update ResearchMission 表 / emit event） */
  readonly onFinalize?: FinalizerCallback<TMetadata>;
  /** 单 mission 轮询上限（防死循环） */
  readonly maxIterations?: number;
  /** 无可执行 task 时等待毫秒（等待 deps complete） */
  readonly idleWaitMs?: number;
}

@Injectable()
export class MissionOrchestrator {
  private readonly logger = new Logger(MissionOrchestrator.name);

  constructor(private readonly runner: ReActRunner) {}

  /**
   * 执行一个 mission 的完整生命周期（enqueue → loop → finalize）。
   *
   * 前置：
   *   - 业务层已经把初始 task 行入库（status=PENDING/CREATED）
   *   - 通过 enqueueTaskIds 把它们标记 QUEUED
   */
  async orchestrate<TMetadata extends Record<string, unknown>>(
    options: OrchestrateOptions<TMetadata>,
    enqueueTaskIds: readonly string[],
    stores: ReActStores<TMetadata>,
    taskQueue: TaskQueue,
    protocols: ProtocolRegistry<TMetadata>,
    llm: LLMCaller,
    consensus: ConsensusResolver,
  ): Promise<QueueStats> {
    const maxIterations = options.maxIterations ?? 200;
    const idleWaitMs = options.idleWaitMs ?? 2_000;

    if (enqueueTaskIds.length > 0) {
      await taskQueue.enqueueMany(enqueueTaskIds);
      this.logger.log(
        `[${options.scope}] enqueued ${enqueueTaskIds.length} initial tasks`,
      );
    }

    let iter = 0;
    while (iter < maxIterations) {
      iter++;

      const stats = await taskQueue.getStats(options.scope);
      if (taskQueue.isFinal(stats)) {
        this.logger.log(
          `[${options.scope}] mission final after ${iter} loops — ` +
            `completed=${stats.completed} failed=${stats.failed} cancelled=${stats.cancelled}`,
        );
        await options.onFinalize?.(options.scope, stats, options.scopeMetadata);
        return stats;
      }

      const taskId = await taskQueue.dequeueNext(options.scope);
      if (!taskId) {
        // 没有可执行 task（依赖未就绪）→ 等待
        if (
          stats.awaitingHuman > 0 ||
          stats.running > 0 ||
          stats.scheduled > 0
        ) {
          // 有别的在跑或等人类，稍后轮询
          await sleep(idleWaitMs);
          continue;
        }
        // 没在跑也 dequeue 不到，pipeline 死锁（可能依赖环或 dep 失败）
        this.logger.warn(
          `[${options.scope}] no executable task but queue not final — stats=${JSON.stringify(stats)}`,
        );
        await options.onFinalize?.(options.scope, stats, options.scopeMetadata);
        return stats;
      }

      // Load full task
      const task = await stores.taskStore.load(taskId);
      if (!task) {
        this.logger.warn(
          `[${options.scope}] task=${taskId} not found, skipping`,
        );
        continue;
      }

      const protocol = protocols.get(task.type);
      if (!protocol) {
        this.logger.warn(
          `[${options.scope}] no protocol for taskType=${task.type} — marking task FAILED`,
        );
        await stores.taskStore.updateStatus(task.id, "FAILED", {
          completedAt: new Date(),
          resultSummary: `no protocol registered for taskType='${task.type}'`,
        });
        continue;
      }

      try {
        await this.runner.execute(task, protocol, llm, consensus, stores);
        await options.onTaskCompleted?.(task, options.scope);
      } catch (err) {
        if (err instanceof HumanInLoopPause) {
          this.logger.log(
            `[${options.scope}] task=${task.id} paused for human input`,
          );
          continue;
        }
        this.logger.error(
          `[${options.scope}] task=${task.id} crashed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 超 maxIterations 硬停
    const finalStats = await taskQueue.getStats(options.scope);
    this.logger.warn(
      `[${options.scope}] orchestrator hit max iterations (${maxIterations}), forcing finalize`,
    );
    await options.onFinalize?.(
      options.scope,
      finalStats,
      options.scopeMetadata,
    );
    return finalStats;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
