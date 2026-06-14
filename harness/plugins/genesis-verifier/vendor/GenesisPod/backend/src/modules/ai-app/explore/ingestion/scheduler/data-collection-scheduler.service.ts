import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { SettingsService } from "../../../../platform/facade";
import { CollectionTaskService } from "../sources/collection-task.service";
import { getErrorMessage } from "../../../../../common/utils/error.utils";
import { ResourceType } from "@prisma/client";
import {
  SchedulerConfig,
  SchedulerInfo,
  SchedulerStatus,
  TriggerResult,
  UpdateSchedulerConfigDto,
  DEFAULT_CRON_EXPRESSIONS,
  INTERVAL_TO_CRON,
} from "./data-collection-scheduler.types";

interface CronJob {
  stop: () => void;
  start: () => void;
  destroy?: () => void;
}

interface CronModule {
  schedule(
    expression: string,
    callback: () => void,
    options?: { timezone?: string },
  ): CronJob;
  validate?(expression: string): boolean;
}

/**
 * Data Collection Scheduler Service
 * 通用数据采集调度器，支持所有数据源类型的定期自动采集
 */
@Injectable()
export class DataCollectionSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DataCollectionSchedulerService.name);

  /** 调度器配置 */
  private config: SchedulerConfig;

  /** 定时任务 Map: resourceType -> CronJob */
  private cronJobs: Map<string, CronJob> = new Map();

  /** 正在执行的资源类型集合，防止重复执行 */
  private runningResourceTypes: Set<string> = new Set();

  /** cron 模块引用 */
  private cron: CronModule | null = null;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private settingsService: SettingsService,
    private collectionTaskService: CollectionTaskService,
  ) {
    this.config = {
      enabled: this.configService.get<boolean>(
        "DATA_COLLECTION_ENABLED",
        false,
      ),
      defaultInterval: this.configService.get<string>(
        "DATA_COLLECTION_INTERVAL",
        "12h",
      ),
      timezone: this.configService.get<string>(
        "DATA_COLLECTION_TIMEZONE",
        "Asia/Shanghai",
      ),
    };
  }

  async onModuleInit(): Promise<void> {
    // Load persisted config from DB (overrides env vars)
    await this.loadConfigFromDb();

    if (this.config.enabled) {
      this.logger.log("Data collection scheduler is enabled, initializing...");
      await this.initializeSchedulers();
    } else {
      this.logger.log(
        "Data collection scheduler is disabled. Set DATA_COLLECTION_ENABLED=true to enable.",
      );
    }
  }

  /**
   * 从数据库加载持久化配置，DB 值优先于环境变量
   */
  private async loadConfigFromDb(): Promise<void> {
    try {
      const dbEnabled = await this.settingsService.get("scheduler.enabled");
      if (dbEnabled !== null) {
        this.config.enabled = dbEnabled === "true";
      }

      const dbInterval = await this.settingsService.get(
        "scheduler.default_interval",
      );
      if (dbInterval !== null) {
        this.config.defaultInterval = dbInterval;
      }

      this.logger.log(
        `Scheduler config loaded: enabled=${this.config.enabled}, interval=${this.config.defaultInterval}`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to load scheduler config from DB, using env defaults: ${getErrorMessage(error)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.stopAllSchedulers();
  }

  /**
   * 初始化所有调度器
   */
  private async initializeSchedulers(): Promise<void> {
    try {
      // 动态导入 node-cron (避免硬依赖)
      try {
        // @ts-expect-error - Dynamic import of optional peer dependency node-cron (no type declarations)
        const cronModule = await import("node-cron");
        // Handle both ESM default export and CommonJS module.exports
        this.cron = cronModule.default || cronModule;
      } catch {
        this.logger.warn(
          "node-cron not available, scheduler disabled. Install: npm install node-cron",
        );
        return;
      }

      if (!this.cron || typeof this.cron.schedule !== "function") {
        this.logger.warn("node-cron schedule function not available");
        return;
      }

      // 获取所有活跃的 CollectionRule
      const rules = await this.prisma.collectionRule.findMany({
        where: { isActive: true },
      });

      this.logger.log(`Found ${rules.length} active collection rules`);

      // 为每个 ResourceType 创建 cron job
      for (const rule of rules) {
        const cronExpression =
          rule.cronExpression ||
          this.getDefaultCronExpression(rule.resourceType);

        this.createCronJob(rule.resourceType, cronExpression);
      }

      this.logger.log(
        `Scheduler initialized with ${this.cronJobs.size} jobs, timezone: ${this.config.timezone}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to initialize schedulers: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * 创建单个 cron job
   */
  private createCronJob(resourceType: string, cronExpression: string): void {
    if (!this.cron) return;

    try {
      const job = this.cron.schedule(
        cronExpression,
        () => {
          this.executeCollectionForResourceType(resourceType).catch(
            (err: Error) => {
              this.logger.error(
                `Scheduled collection failed for ${resourceType}: ${getErrorMessage(err)}`,
              );
            },
          );
        },
        {
          timezone: this.config.timezone,
        },
      );

      this.cronJobs.set(resourceType, job);
      this.logger.log(
        `Created cron job for ${resourceType}: ${cronExpression}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create cron job for ${resourceType}: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * 停止所有调度器
   */
  async stopAllSchedulers(): Promise<void> {
    for (const [resourceType, job] of this.cronJobs.entries()) {
      try {
        job.stop();
        // 销毁 cron job 释放资源
        if (job.destroy) {
          job.destroy();
        }
        this.logger.log(`Stopped cron job for ${resourceType}`);
      } catch (error) {
        this.logger.error(
          `Failed to stop cron job for ${resourceType}: ${getErrorMessage(error)}`,
        );
      }
    }
    this.cronJobs.clear();
  }

  /**
   * 获取默认 cron 表达式
   * 优先使用用户配置的 defaultInterval，仅在无配置时回退到类型默认值
   */
  private getDefaultCronExpression(resourceType: string): string {
    // 优先使用用户配置的统一间隔
    if (INTERVAL_TO_CRON[this.config.defaultInterval]) {
      return INTERVAL_TO_CRON[this.config.defaultInterval];
    }
    // 回退到类型特定的默认值
    if (DEFAULT_CRON_EXPRESSIONS[resourceType]) {
      return DEFAULT_CRON_EXPRESSIONS[resourceType];
    }
    return "0 */12 * * *";
  }

  /**
   * 执行指定资源类型的采集
   */
  async executeCollectionForResourceType(
    resourceType: string,
  ): Promise<TriggerResult> {
    // 防止重复执行
    if (this.runningResourceTypes.has(resourceType)) {
      this.logger.warn(`${resourceType} collection already running, skipping`);
      return {
        resourceType,
        success: false,
        message: `${resourceType} collection is already running`,
      };
    }

    this.runningResourceTypes.add(resourceType);
    const taskIds: string[] = [];

    try {
      this.logger.log(`Starting scheduled collection for ${resourceType}`);

      // 1. 获取该类型的活跃数据源
      const dataSources = await this.prisma.dataSource.findMany({
        where: {
          category: resourceType as ResourceType,
          status: "ACTIVE",
        },
      });

      if (dataSources.length === 0) {
        this.logger.log(`No active data sources for ${resourceType}`);
        return {
          resourceType,
          success: true,
          message: `No active data sources for ${resourceType}`,
          taskIds: [],
        };
      }

      this.logger.log(
        `Found ${dataSources.length} active data sources for ${resourceType}`,
      );

      // 2. 获取并发配置
      const rule = await this.prisma.collectionRule.findFirst({
        where: { resourceType },
      });
      const maxConcurrent = rule?.maxConcurrent || 3;
      const timeout = rule?.timeout || 300;

      // 3. 分块并发执行
      const chunks = this.chunkArray(dataSources, maxConcurrent);

      for (const chunk of chunks) {
        const tasks = await Promise.all(
          chunk.map(async (source) => {
            try {
              const task = await this.executeSourceCollection(source, timeout);
              return task?.id;
            } catch (error) {
              this.logger.error(
                `Failed to create task for source ${source.name}: ${getErrorMessage(error)}`,
              );
              return null;
            }
          }),
        );

        taskIds.push(...tasks.filter((id): id is string => id !== null));
      }

      // 4. 更新最后执行时间
      await this.prisma.collectionRule.updateMany({
        where: { resourceType },
        data: { lastExecutedAt: new Date() },
      });

      this.logger.log(
        `Scheduled collection completed for ${resourceType}: ${taskIds.length} tasks created`,
      );

      return {
        resourceType,
        success: true,
        message: `Created ${taskIds.length} collection tasks for ${resourceType}`,
        taskIds,
      };
    } catch (error) {
      this.logger.error(
        `Scheduled collection failed for ${resourceType}: ${getErrorMessage(error)}`,
      );
      return {
        resourceType,
        success: false,
        message: getErrorMessage(error),
      };
    } finally {
      this.runningResourceTypes.delete(resourceType);
    }
  }

  /**
   * 执行单个数据源的采集
   */
  private async executeSourceCollection(
    source: { id: string; name: string; crawlerConfig: unknown },
    timeout: number,
  ) {
    // 创建采集任务
    const task = await this.collectionTaskService.create({
      name: `Scheduled: ${source.name}`,
      type: "SCHEDULED",
      sourceId: source.id,
      sourceConfig: (source.crawlerConfig || {}) as Record<string, unknown>,
      timeout,
    });

    // 异步执行（不阻塞）
    this.collectionTaskService.execute(task.id).catch((err) => {
      this.logger.error(
        `Task ${task.id} execution failed: ${getErrorMessage(err)}`,
      );
    });

    return task;
  }

  /**
   * 获取调度器状态
   */
  async getStatus(): Promise<SchedulerStatus> {
    const rules = await this.prisma.collectionRule.findMany({
      where: { isActive: true },
    });

    // 一次查询获取所有资源类型的活跃数据源数量 (避免 N+1 查询)
    const resourceTypes = rules.map((r) => r.resourceType as ResourceType);
    const sourceCounts = await this.prisma.dataSource.groupBy({
      by: ["category"],
      where: {
        status: "ACTIVE",
        category: { in: resourceTypes },
      },
      _count: true,
    });

    const countMap = new Map(
      sourceCounts.map((item) => [item.category, item._count]),
    );

    const schedulers: SchedulerInfo[] = rules.map((rule) => ({
      resourceType: rule.resourceType,
      isRunning: this.runningResourceTypes.has(rule.resourceType),
      cronExpression:
        rule.cronExpression || this.getDefaultCronExpression(rule.resourceType),
      maxConcurrent: rule.maxConcurrent,
      timeout: rule.timeout,
      lastRun: rule.lastExecutedAt || undefined,
      nextRun: rule.nextScheduledAt || undefined,
      activeSourceCount: countMap.get(rule.resourceType as ResourceType) || 0,
    }));

    return {
      enabled: this.config.enabled,
      defaultInterval: this.config.defaultInterval,
      timezone: this.config.timezone,
      schedulers,
      activeExecutions: this.runningResourceTypes.size,
    };
  }

  /**
   * 触发所有类型的采集
   */
  async triggerAll(): Promise<TriggerResult[]> {
    const rules = await this.prisma.collectionRule.findMany({
      where: { isActive: true },
    });

    const results: TriggerResult[] = [];

    for (const rule of rules) {
      const result = await this.executeCollectionForResourceType(
        rule.resourceType,
      );
      results.push(result);
    }

    return results;
  }

  /**
   * 更新调度器配置
   */
  async updateConfig(dto: UpdateSchedulerConfigDto): Promise<SchedulerStatus> {
    if (dto.enabled !== undefined) {
      this.config.enabled = dto.enabled;

      // Persist to DB
      await this.settingsService.set(
        "scheduler.enabled",
        dto.enabled.toString(),
        {
          category: "scheduler",
          description: "Data collection scheduler enabled",
        },
      );

      if (dto.enabled && this.cronJobs.size === 0) {
        await this.initializeSchedulers();
      } else if (!dto.enabled && this.cronJobs.size > 0) {
        await this.stopAllSchedulers();
      }
    }

    if (dto.defaultInterval) {
      this.config.defaultInterval = dto.defaultInterval;

      // Persist to DB
      await this.settingsService.set(
        "scheduler.default_interval",
        dto.defaultInterval,
        { category: "scheduler", description: "Default collection interval" },
      );

      // 同步更新所有 CollectionRule 的 cron 表达式
      const newCron = INTERVAL_TO_CRON[dto.defaultInterval] || "0 */12 * * *";
      await this.prisma.collectionRule.updateMany({
        where: { isActive: true },
        data: { cronExpression: newCron },
      });
      this.logger.log(`Updated all collection rules to cron: ${newCron}`);

      // 重启所有 cron jobs 使新表达式生效
      await this.restartSchedulers();
    }

    this.logger.log(
      `Scheduler config updated: enabled=${this.config.enabled}, interval=${this.config.defaultInterval}`,
    );

    return this.getStatus();
  }

  /**
   * 重启调度器（更新 cron 表达式后使用）
   */
  async restartSchedulers(): Promise<void> {
    await this.stopAllSchedulers();
    if (this.config.enabled) {
      await this.initializeSchedulers();
    }
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
