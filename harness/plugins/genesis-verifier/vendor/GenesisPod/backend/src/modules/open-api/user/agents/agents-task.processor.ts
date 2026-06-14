/**
 * AgentsTaskProcessor — L4 durable task worker（P0 整改）
 *
 * 消费 BullMQ queue 'agents-task'，跑原 agents.controller.executeTaskAsync 的
 * 完整执行逻辑（PLANNING → EXECUTING → COMPLETED/FAILED + orchestrator 事件消费），
 * 行为与原内存路径等价，但脱离 HTTP 请求生命周期，进程崩溃可由 BullMQ 重试/恢复。
 *
 * 照 radar-briefing.processor.ts 模式（@Processor + WorkerHost）。
 */
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
// agents-api 直引 ai-harness agent.types primitive（与 controller / service 同源，
// 见 agents.controller.ts header + .eslintrc.js 文档化豁免）。
import { AgentOrchestrator } from "../../../ai-harness/agents/registry/agent-orchestrator";
import { AgentsService } from "./agents.service";
import {
  AgentsTaskQueueService,
  AgentsTaskJobData,
} from "./agents-task-queue.service";

@Processor(AgentsTaskQueueService.QUEUE_NAME, {
  concurrency: AgentsTaskQueueService.WORKER_CONCURRENCY,
})
export class AgentsTaskProcessor extends WorkerHost {
  private readonly logger = new Logger(AgentsTaskProcessor.name);

  constructor(
    private readonly orchestrator: AgentOrchestrator,
    private readonly agentsService: AgentsService,
  ) {
    super();
  }

  async process(job: Job<AgentsTaskJobData>): Promise<{ status: string }> {
    const { taskId, input, agentId, userId } = job.data;

    try {
      await this.agentsService.updateTaskStatus(taskId, "PLANNING");

      for await (const event of this.orchestrator.execute(
        input,
        agentId,
        userId,
      )) {
        // 发布事件到 SSE 流（注意：仅本 worker 进程内的 SSE 订阅可见；多实例下
        // SSE 流跨进程不可达——这是既有限制，本次整改只迁执行不改 SSE 传输层）
        this.agentsService.publishEvent(taskId, event);

        if (event.type === "plan_ready") {
          await this.agentsService.updateTaskStatus(taskId, "EXECUTING");
          await this.agentsService.updateTaskPlan(taskId, event.plan);
        }

        if (event.type === "artifact") {
          await this.agentsService.saveArtifact(taskId, event.artifact);
        }

        if (event.type === "complete") {
          await this.agentsService.updateTaskStatus(taskId, "COMPLETED");
          await this.agentsService.updateTaskResult(taskId, event.result);
        }

        if (event.type === "error") {
          await this.agentsService.updateTaskStatus(
            taskId,
            "FAILED",
            event.error,
          );
        }
      }

      this.logger.log(`agents-task done task=${taskId} job=${job.id}`);
      return { status: "ok" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Task execution error task=${taskId}: ${message}`);
      // 标记 FAILED 让 UI 能展示；同时 throw 让 BullMQ 走 attempts 重试，
      // 重试耗尽后 job 进 failed 队列（removeOnFail 保留 7 天用于排障）。
      await this.agentsService.updateTaskStatus(taskId, "FAILED", message);
      throw error;
    }
  }
}
