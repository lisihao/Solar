/**
 * 发布队列服务
 *
 * 管理发布任务队列，支持延迟发布、重试等
 * 使用内存队列，不依赖数据库存储
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { SocialPlatformType } from "../mission/types";
import {
  PublishJobData,
  PublishOptions,
  JobStatus,
  JobStatusInfo,
} from "../mission/types/platform.types";
import { RETRY_CONFIG } from "../runtime/platforms.config";

interface QueuedJob {
  id: string;
  data: PublishJobData;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  scheduledAt: Date;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: unknown;
  error?: string;
}

type JobProcessor = (
  job: QueuedJob,
) => Promise<{ success: boolean; error?: string }>;

@Injectable()
export class PublishQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PublishQueueService.name);
  private queue: Map<string, QueuedJob> = new Map();
  private processingInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private processor: JobProcessor | null = null;

  async onModuleInit(): Promise<void> {
    this.startProcessing();
    this.logger.log("Publish queue service initialized");
  }

  async onModuleDestroy(): Promise<void> {
    this.stopProcessing();
  }

  /**
   * 设置任务处理器
   */
  setProcessor(processor: JobProcessor): void {
    this.processor = processor;
  }

  /**
   * 添加发布任务到队列
   */
  async addJob(
    contentId: string,
    userId: string,
    platformType: SocialPlatformType,
    options: PublishOptions,
  ): Promise<string> {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const scheduledAt = options.scheduledAt || new Date();
    const maxAttempts = options.maxRetries || RETRY_CONFIG.maxAttempts;

    const job: QueuedJob = {
      id: jobId,
      data: {
        contentId,
        userId,
        platformType,
        options,
      },
      status: options.scheduledAt ? "delayed" : "waiting",
      attempts: 0,
      maxAttempts,
      scheduledAt,
      createdAt: new Date(),
    };

    this.queue.set(jobId, job);

    this.logger.log(
      `Job ${jobId} added to queue for content ${contentId}, scheduled at ${scheduledAt}`,
    );

    return jobId;
  }

  /**
   * 获取任务状态
   */
  getJobStatus(jobId: string): JobStatusInfo | null {
    const job = this.queue.get(jobId);
    if (!job) {
      return null;
    }
    return this.jobToStatusInfo(job);
  }

  /**
   * 取消任务
   */
  cancelJob(jobId: string): boolean {
    const job = this.queue.get(jobId);
    if (!job) {
      return false;
    }

    if (job.status === "active") {
      this.logger.warn(`Cannot cancel active job: ${jobId}`);
      return false;
    }

    job.status = "failed";
    job.error = "Cancelled by user";

    this.logger.log(`Job ${jobId} cancelled`);
    return true;
  }

  /**
   * 重试失败的任务
   */
  retryJob(jobId: string): boolean {
    const job = this.queue.get(jobId);
    if (!job) {
      return false;
    }

    if (job.status !== "failed") {
      this.logger.warn(`Job ${jobId} is not in failed state`);
      return false;
    }

    job.status = "waiting";
    job.attempts = 0;
    job.error = undefined;
    job.scheduledAt = new Date();

    this.logger.log(`Job ${jobId} scheduled for retry`);
    return true;
  }

  /**
   * 获取队列统计
   */
  getQueueStats(): {
    total: number;
    waiting: number;
    active: number;
    delayed: number;
    completed: number;
    failed: number;
  } {
    const stats = {
      total: this.queue.size,
      waiting: 0,
      active: 0,
      delayed: 0,
      completed: 0,
      failed: 0,
    };

    for (const job of this.queue.values()) {
      switch (job.status) {
        case "waiting":
        case "pending":
          stats.waiting++;
          break;
        case "active":
          stats.active++;
          break;
        case "delayed":
          stats.delayed++;
          break;
        case "completed":
          stats.completed++;
          break;
        case "failed":
          stats.failed++;
          break;
      }
    }

    return stats;
  }

  /**
   * 获取用户的任务列表
   */
  getUserJobs(
    userId: string,
    options?: { status?: JobStatus; limit?: number },
  ): QueuedJob[] {
    const jobs: QueuedJob[] = [];

    for (const job of this.queue.values()) {
      if (job.data.userId === userId) {
        if (!options?.status || job.status === options.status) {
          jobs.push(job);
        }
      }
    }

    // 按创建时间排序
    jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    if (options?.limit) {
      return jobs.slice(0, options.limit);
    }

    return jobs;
  }

  /**
   * 清理已完成的任务（保留最近 1 小时的）
   */
  cleanupCompletedJobs(): number {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    let cleaned = 0;

    for (const [jobId, job] of this.queue.entries()) {
      if (
        (job.status === "completed" || job.status === "failed") &&
        job.completedAt &&
        job.completedAt < oneHourAgo
      ) {
        this.queue.delete(jobId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.log(`Cleaned up ${cleaned} old jobs`);
    }

    return cleaned;
  }

  /**
   * 启动队列处理
   */
  private startProcessing(): void {
    if (this.processingInterval) {
      return;
    }

    this.processingInterval = setInterval(() => {
      void this.processQueue();
    }, 5000).unref(); // 每5秒检查一次

    // 每小时清理一次旧任务（unref 防止测试/进程退出时被阻塞）
    setInterval(
      () => {
        this.cleanupCompletedJobs();
      },
      60 * 60 * 1000,
    ).unref();

    this.logger.log("Queue processing started");
  }

  /**
   * 停止队列处理
   */
  private stopProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    this.logger.log("Queue processing stopped");
  }

  /**
   * 处理队列
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || !this.processor) {
      return;
    }

    this.isProcessing = true;

    try {
      const now = new Date();

      for (const [jobId, job] of this.queue.entries()) {
        // 跳过已完成或失败的任务
        if (job.status === "completed" || job.status === "failed") {
          continue;
        }

        // 跳过未到时间的任务
        if (job.scheduledAt > now) {
          continue;
        }

        // 跳过正在处理的任务
        if (job.status === "active") {
          continue;
        }

        // 检查重试次数
        if (job.attempts >= job.maxAttempts) {
          job.status = "failed";
          job.error = "Max retry attempts exceeded";
          job.completedAt = new Date();
          continue;
        }

        // 开始处理
        job.status = "active";
        job.attempts++;
        job.startedAt = new Date();

        this.logger.log(
          `Processing job ${jobId}, attempt ${job.attempts}/${job.maxAttempts}`,
        );

        try {
          const result = await this.processor(job);

          if (result.success) {
            job.status = "completed";
            job.completedAt = new Date();
            job.result = result;
            this.logger.log(`Job ${jobId} completed successfully`);
          } else {
            throw new Error(result.error || "Unknown error");
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(`Job ${jobId} failed: ${errorMessage}`);

          if (job.attempts >= job.maxAttempts) {
            job.status = "failed";
            job.error = errorMessage;
            job.completedAt = new Date();
          } else {
            // 计算下次重试时间
            const delay = Math.min(
              RETRY_CONFIG.initialDelay *
                Math.pow(RETRY_CONFIG.backoffMultiplier, job.attempts - 1),
              RETRY_CONFIG.maxDelay,
            );
            job.status = "delayed";
            job.scheduledAt = new Date(Date.now() + delay);
            job.error = errorMessage;
            this.logger.log(`Job ${jobId} will retry in ${delay / 1000}s`);
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 转换任务为状态信息
   */
  private jobToStatusInfo(job: QueuedJob): JobStatusInfo {
    return {
      status: job.status,
      progress:
        job.status === "completed" ? 100 : job.status === "active" ? 50 : 0,
      result: job.result
        ? {
            success: true,
            attempts: job.attempts,
            duration:
              job.completedAt && job.startedAt
                ? job.completedAt.getTime() - job.startedAt.getTime()
                : 0,
          }
        : undefined,
      failReason: job.error,
      nextRetryAt: job.status === "delayed" ? job.scheduledAt : undefined,
    };
  }
}
