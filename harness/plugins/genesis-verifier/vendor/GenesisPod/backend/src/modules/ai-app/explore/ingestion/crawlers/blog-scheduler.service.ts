import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BlogCollectionService } from "./blog-collection.service";
import { SchedulerConfig, CollectionTask } from "./blog-collection.types";
import { getErrorMessage } from "../../../../../common/utils/error.utils";

/**
 * Blog Scheduler Service
 * 负责定时触发博客采集任务
 * 使用node-cron进行定时调度
 */
@Injectable()
export class BlogSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BlogSchedulerService.name);
  private schedulerConfig: SchedulerConfig;
  private activeTasks: Map<string, CollectionTask> = new Map();
  private cronJob: { stop: () => void; destroy: () => void } | null = null;
  private isScheduling = false;

  constructor(
    private configService: ConfigService,
    private blogCollectionService: BlogCollectionService,
  ) {
    // 从配置初始化调度器配置
    this.schedulerConfig = {
      enabled: this.configService.get<boolean>(
        "BLOG_COLLECTION_ENABLED",
        false,
      ),
      cronExpression: this.configService.get<string>(
        "BLOG_COLLECTION_CRON",
        "0 */6 * * *", // 默认每6小时一次
      ),
      maxConcurrent: this.configService.get<number>(
        "BLOG_COLLECTION_MAX_CONCURRENT",
        3,
      ),
      activeTasks: 0,
    };
  }

  /**
   * 模块初始化时启动调度器
   */
  async onModuleInit() {
    if (this.schedulerConfig.enabled) {
      await this.startScheduler();
    }
  }

  /**
   * 模块销毁时停止调度器
   */
  async onModuleDestroy() {
    await this.stopScheduler();
  }

  /**
   * 启动调度器
   */
  async startScheduler(): Promise<void> {
    try {
      // 动态导入node-cron（避免硬依赖）
      let cron:
        | {
            schedule: (...args: unknown[]) => {
              stop: () => void;
              destroy: () => void;
            };
          }
        | undefined;
      try {
        // Dynamic import of optional dependency - cron library may not be installed
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const module = await import("node-cron" as string);
        // Handle both ESM default export and CommonJS module.exports
        cron = module.default || module;
      } catch (error) {
        this.logger.warn(
          "node-cron not available, scheduler disabled. Please install: npm install node-cron",
        );
        return;
      }

      // Check if cron.schedule is available
      if (!cron || typeof cron.schedule !== "function") {
        this.logger.warn(
          "node-cron module loaded but schedule function not available. Scheduler disabled.",
        );
        return;
      }

      this.logger.log(
        `Starting blog collection scheduler with cron: ${this.schedulerConfig.cronExpression}`,
      );

      // 创建定时任务
      this.cronJob = cron.schedule(
        this.schedulerConfig.cronExpression,
        async () => {
          await this.executeCollectionCycle();
        },
        {
          runOnInit: false,
          timezone: "Asia/Shanghai",
        },
      );

      // 立即执行一次（可选）
      this.logger.log("Scheduler started successfully");
      this.schedulerConfig.enabled = true;
      this.schedulerConfig.nextRun = this.getNextRunTime();
    } catch (error) {
      this.logger.error(`Failed to start scheduler: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * 停止调度器
   */
  async stopScheduler(): Promise<void> {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob.destroy();
      this.cronJob = null;
      this.logger.log("Scheduler stopped");
      this.schedulerConfig.enabled = false;
    }
  }

  /**
   * 执行一次完整的采集周期
   */
  private async executeCollectionCycle(): Promise<void> {
    if (this.isScheduling) {
      this.logger.warn("Collection cycle already in progress, skipping");
      return;
    }

    this.isScheduling = true;
    const startTime = Date.now();

    try {
      this.logger.log("Starting collection cycle");

      // 获取所有活跃源
      const sources = await this.blogCollectionService.getActiveSources();

      // 按照maxConcurrent限制并发数量
      const chunks = this.chunkArray(
        sources,
        this.schedulerConfig.maxConcurrent,
      );

      for (const chunk of chunks) {
        const tasks = chunk.map((source) =>
          this.blogCollectionService.collectFromSource(source.id),
        );

        const results = await Promise.all(tasks);

        // 记录任务结果
        for (const result of results) {
          this.activeTasks.set(result.id, result);

          if (result.status === "completed") {
            this.logger.log(
              `✓ Collection completed for ${result.sourceName}: ${result.postsSaved}/${result.postsCollected} posts`,
            );
          } else {
            this.logger.error(
              `✗ Collection failed for ${result.sourceName}: ${result.error}`,
            );
          }
        }
      }

      const duration = (Date.now() - startTime) / 1000;
      this.logger.log(
        `Collection cycle completed in ${duration.toFixed(2)}s, ${this.activeTasks.size} sources processed`,
      );

      // 更新调度器配置
      this.schedulerConfig.lastRun = new Date();
      this.schedulerConfig.nextRun = this.getNextRunTime();
      this.schedulerConfig.activeTasks = this.activeTasks.size;

      // 清理已完成的任务（保留最近100个）
      if (this.activeTasks.size > 100) {
        const sortedTasks = Array.from(this.activeTasks.values())
          .sort((a, b) => {
            const timeA = a.endTime?.getTime() || 0;
            const timeB = b.endTime?.getTime() || 0;
            return timeB - timeA;
          })
          .slice(100);

        for (const task of sortedTasks) {
          this.activeTasks.delete(task.id);
        }
      }
    } catch (error) {
      this.logger.error(`Collection cycle failed: ${getErrorMessage(error)}`);
    } finally {
      this.isScheduling = false;
    }
  }

  /**
   * 手动触发采集任务
   */
  async triggerCollection(sourceId?: string): Promise<CollectionTask> {
    try {
      if (sourceId) {
        this.logger.log(
          `Manually triggering collection for source: ${sourceId}`,
        );
        const task =
          await this.blogCollectionService.collectFromSource(sourceId);
        this.activeTasks.set(task.id, task);
        return task;
      } else {
        this.logger.log("Manually triggering full collection cycle");
        await this.executeCollectionCycle();
        // 返回最后一个任务的状态
        const lastTask = Array.from(this.activeTasks.values()).pop();
        return (
          lastTask || {
            id: "",
            sourceId: "",
            sourceName: "",
            status: "completed" as const,
            postsCollected: 0,
            postsSaved: 0,
            retryCount: 0,
          }
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to trigger collection: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 更新调度器配置
   */
  async updateConfig(
    config: Partial<SchedulerConfig>,
  ): Promise<SchedulerConfig> {
    try {
      if (config.cronExpression) {
        this.schedulerConfig.cronExpression = config.cronExpression;

        // 重新启动调度器以应用新的cron表达式
        if (this.schedulerConfig.enabled) {
          await this.stopScheduler();
          await this.startScheduler();
        }

        this.logger.log(`Cron expression updated to: ${config.cronExpression}`);
      }

      if (config.maxConcurrent) {
        this.schedulerConfig.maxConcurrent = config.maxConcurrent;
        this.logger.log(
          `Max concurrent tasks updated to: ${config.maxConcurrent}`,
        );
      }

      if (config.enabled !== undefined) {
        this.schedulerConfig.enabled = config.enabled;

        if (config.enabled && !this.cronJob) {
          await this.startScheduler();
        } else if (!config.enabled && this.cronJob) {
          await this.stopScheduler();
        }
      }

      return this.schedulerConfig;
    } catch (error) {
      this.logger.error(
        `Failed to update scheduler config: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 获取调度器配置和状态
   */
  getSchedulerStatus(): SchedulerConfig & { tasks: CollectionTask[] } {
    return {
      ...this.schedulerConfig,
      tasks: Array.from(this.activeTasks.values()).slice(-10), // 返回最近10个任务
    };
  }

  /**
   * 获取所有活跃任务
   */
  getActiveTasks(): CollectionTask[] {
    return Array.from(this.activeTasks.values());
  }

  /**
   * 获取任务详情
   */
  getTaskDetail(taskId: string): CollectionTask | null {
    return this.activeTasks.get(taskId) || null;
  }

  /**
   * 计算下一次运行时间（简单实现）
   */
  private getNextRunTime(): Date {
    // 这是一个简单的实现，实际应该解析cron表达式
    const next = new Date();
    next.setHours(next.getHours() + 6);
    return next;
  }

  /**
   * 将数组分块
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
