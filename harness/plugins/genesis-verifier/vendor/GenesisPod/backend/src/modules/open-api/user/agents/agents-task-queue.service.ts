import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import {
  AgentId,
  AgentInput,
} from "@/modules/ai-harness/agents/abstractions/agent.types";
import { AgentsService } from "./agents.service";

/**
 * AgentsTaskQueueService — L4 durable task queue（P0 整改）
 *
 * 背景：agents.controller 原先用 `void this.executeTaskAsync(...)` 做内存
 * fire-and-forget 执行——HTTP 进程崩溃/重启即丢任务，无重试、无恢复。
 *
 * 改造：照 radar-briefing-queue.service.ts 模式，把异步执行迁到 BullMQ：
 * - enqueue() 入队，HTTP 立即返回
 * - AgentsTaskProcessor 消费 job 跑完整状态机
 * - boot recovery 重投在途任务（jobId=taskId 幂等防重复）
 *
 * BullMQ root 连接由全局 BullModule.forRootAsync 提供（radar.module 注册的
 * shared config 是 global: true，全 app 可用）；本 queue 仅 registerQueue。
 */
export interface AgentsTaskJobData {
  taskId: string;
  input: AgentInput;
  agentId?: AgentId;
  userId?: string;
}

@Injectable()
export class AgentsTaskQueueService implements OnModuleInit {
  static readonly QUEUE_NAME = "agents-task";
  static readonly WORKER_CONCURRENCY = 10;
  static readonly JOB_NAME = "execute";

  private readonly logger = new Logger(AgentsTaskQueueService.name);

  constructor(
    @InjectQueue(AgentsTaskQueueService.QUEUE_NAME)
    private readonly queue: Queue<AgentsTaskJobData>,
    private readonly agentsService: AgentsService,
  ) {}

  /**
   * boot recovery：扫描进程崩溃遗留的在途任务（PLANNING/EXECUTING）重投队列。
   *
   * jobId=taskId 保证幂等——若该 job 仍在 BullMQ 里（未被清理），add 同 id 不会
   * 产生第二个 job；若 job 已丢（内存执行随进程消失），则重新入队让 worker 接管。
   * fail-open：恢复失败不阻塞 boot（HTTP 仍可用，只是个别旧任务可能卡住）。
   */
  async onModuleInit(): Promise<void> {
    try {
      const inFlight = await this.agentsService.findInFlightTasks();
      if (inFlight.length === 0) return;
      let requeued = 0;
      for (const task of inFlight) {
        const input = await this.agentsService.getTaskInput(task.id);
        if (!input) continue;
        await this.enqueue(
          task.id,
          input,
          this.agentsService.officeAgentTypeToAgentId(task.agentType),
          task.userId ?? undefined,
        );
        requeued += 1;
      }
      this.logger.log(
        `boot recovery: re-enqueued ${requeued}/${inFlight.length} in-flight agents-task(s)`,
      );
    } catch (err) {
      this.logger.warn(
        `boot recovery failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * 入队一个 Agent 执行任务。
   *
   * jobId 用 taskId：BullMQ 对同 jobId 去重（add 同 id 不会产生第二个 job），
   * 因此 boot recovery 重投在途任务时天然幂等，不会重复执行。
   */
  async enqueue(
    taskId: string,
    input: AgentInput,
    agentId?: AgentId,
    userId?: string,
  ): Promise<{ jobId: string }> {
    const job = await this.queue.add(
      AgentsTaskQueueService.JOB_NAME,
      { taskId, input, agentId, userId },
      {
        jobId: taskId,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: 86400 * 7 },
      },
    );
    this.logger.log(
      `enqueued agents-task job=${job.id ?? taskId} task=${taskId}`,
    );
    return { jobId: job.id ?? taskId };
  }

  /** queue 健康指标（observability + 测试用） */
  async getStats(): Promise<{
    waiting: number;
    active: number;
    failed: number;
  }> {
    const [waiting, active, failed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getFailedCount(),
    ]);
    return { waiting, active, failed };
  }
}
