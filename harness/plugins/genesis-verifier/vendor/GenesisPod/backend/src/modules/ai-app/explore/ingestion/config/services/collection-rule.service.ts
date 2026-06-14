import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { Prisma, ResourceType } from "@prisma/client";
import { getErrorMessage } from "../../../../../../common/utils/error.utils";

interface CreateCollectionRuleDto {
  resourceType: ResourceType;
  cronExpression?: string;
  maxConcurrent?: number;
  timeout?: number;
  filters?: Record<string, unknown>;
  deduplicationStrategy?: string;
  minimumQualityScore?: number;
  priority?: number;
  description?: string;
}

interface UpdateCollectionRuleDto {
  cronExpression?: string;
  maxConcurrent?: number;
  timeout?: number;
  filters?: Record<string, unknown>;
  deduplicationStrategy?: string;
  minimumQualityScore?: number;
  priority?: number;
  description?: string;
  isActive?: boolean;
}

/**
 * Collection Rule Service
 * 负责管理数据采集规则、调度和策略
 */
@Injectable()
export class CollectionRuleService {
  private readonly logger = new Logger(CollectionRuleService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 创建采集规则
   */
  async createRule(dto: CreateCollectionRuleDto) {
    try {
      // 检查是否已存在该资源类型的规则
      const existing = await this.prisma.collectionRule.findFirst({
        where: { resourceType: dto.resourceType },
      });

      if (existing) {
        this.logger.warn(
          `Collection rule for ${dto.resourceType} already exists, updating instead`,
        );
        return this.updateRule(dto.resourceType, {
          ...dto,
          cronExpression: dto.cronExpression,
          maxConcurrent: dto.maxConcurrent,
          timeout: dto.timeout,
          filters: dto.filters,
          deduplicationStrategy: dto.deduplicationStrategy,
          minimumQualityScore: dto.minimumQualityScore,
          priority: dto.priority,
          description: dto.description,
        });
      }

      const rule = await this.prisma.collectionRule.create({
        data: {
          resourceType: dto.resourceType,
          cronExpression: dto.cronExpression || "0 */6 * * *",
          maxConcurrent: dto.maxConcurrent || 3,
          timeout: dto.timeout || 300,
          filters: dto.filters as Prisma.InputJsonValue | undefined,
          deduplicationStrategy: dto.deduplicationStrategy || "CONTENT_HASH",
          minimumQualityScore: dto.minimumQualityScore || 0.5,
          priority: dto.priority || 0,
          description: dto.description,
          isActive: true,
        },
      });

      this.logger.log(
        `Created collection rule for ${dto.resourceType}: cron=${rule.cronExpression}`,
      );
      return rule;
    } catch (error) {
      this.logger.error(
        `Failed to create collection rule: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 获取特定资源类型的采集规则
   */
  async getRule(resourceType: ResourceType) {
    try {
      const rule = await this.prisma.collectionRule.findFirst({
        where: { resourceType },
        include: {
          importTasks: {
            take: 10,
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (!rule) {
        this.logger.warn(`Collection rule not found for ${resourceType}`);
        return null;
      }

      return rule;
    } catch (error) {
      this.logger.error(
        `Failed to get collection rule: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 获取所有采集规则
   */
  async getAllRules() {
    try {
      const rules = await this.prisma.collectionRule.findMany({
        include: {
          importTasks: {
            take: 5,
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      });

      return rules;
    } catch (error) {
      this.logger.error(`Failed to get all rules: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * 获取活跃的采集规则
   */
  async getActiveRules() {
    try {
      const rules = await this.prisma.collectionRule.findMany({
        where: { isActive: true },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      });

      return rules;
    } catch (error) {
      this.logger.error(
        `Failed to get active rules: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 更新采集规则
   */
  async updateRule(resourceType: ResourceType, dto: UpdateCollectionRuleDto) {
    try {
      const rule = await this.prisma.collectionRule.updateMany({
        where: { resourceType },
        data: {
          ...(dto.cronExpression && { cronExpression: dto.cronExpression }),
          ...(dto.maxConcurrent && { maxConcurrent: dto.maxConcurrent }),
          ...(dto.timeout && { timeout: dto.timeout }),
          ...(dto.filters !== undefined && {
            filters: dto.filters as Prisma.InputJsonValue,
          }),
          ...(dto.deduplicationStrategy && {
            deduplicationStrategy: dto.deduplicationStrategy,
          }),
          ...(dto.minimumQualityScore !== undefined && {
            minimumQualityScore: dto.minimumQualityScore,
          }),
          ...(dto.priority !== undefined && { priority: dto.priority }),
          ...(dto.description !== undefined && {
            description: dto.description,
          }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
          updatedAt: new Date(),
        },
      });

      this.logger.log(`Updated collection rule for ${resourceType}`);
      return rule;
    } catch (error) {
      this.logger.error(
        `Failed to update collection rule: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 删除采集规则
   */
  async deleteRule(resourceType: ResourceType) {
    try {
      await this.prisma.collectionRule.deleteMany({
        where: { resourceType },
      });

      this.logger.log(`Deleted collection rule for ${resourceType}`);
    } catch (error) {
      this.logger.error(
        `Failed to delete collection rule: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 启用采集规则
   */
  async enableRule(resourceType: ResourceType) {
    return this.updateRule(resourceType, { isActive: true });
  }

  /**
   * 禁用采集规则
   */
  async disableRule(resourceType: ResourceType) {
    return this.updateRule(resourceType, { isActive: false });
  }

  /**
   * 更新规则的下一次执行时间
   */
  async updateNextScheduledTime(
    resourceType: ResourceType,
    nextScheduledAt: Date,
  ) {
    try {
      const rule = await this.prisma.collectionRule.updateMany({
        where: { resourceType },
        data: {
          nextScheduledAt,
        },
      });

      return rule;
    } catch (error) {
      this.logger.error(
        `Failed to update next scheduled time: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 更新规则的最后执行时间
   */
  async updateLastExecutedTime(
    resourceType: ResourceType,
    lastExecutedAt: Date,
  ) {
    try {
      const rule = await this.prisma.collectionRule.updateMany({
        where: { resourceType },
        data: {
          lastExecutedAt,
        },
      });

      return rule;
    } catch (error) {
      this.logger.error(
        `Failed to update last executed time: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 获取过滤条件
   */
  getFilters(resourceType: ResourceType) {
    // 返回预定义的过滤条件，可以被规则覆盖
    const defaultFilters: Record<string, Record<string, unknown>> = {
      PAPER: {
        minCitations: 0,
        keywords: [],
        excludeKeywords: [],
      },
      BLOG: {
        keywords: [],
        excludeKeywords: [],
        domains: [],
      },
      NEWS: {
        keywords: [],
        excludeKeywords: [],
        sources: [],
      },
      YOUTUBE_VIDEO: {
        minDuration: 0,
        maxDuration: 36000,
        keywords: [],
      },
      RSS: {
        keywords: [],
        excludeKeywords: [],
        domains: [],
      },
      REPORT: {
        reportTypes: [],
        industries: [],
        yearRange: { min: 2020, max: new Date().getFullYear() },
      },
      EVENT: {
        eventTypes: [],
        locations: [],
        dateRange: { start: new Date(), end: null },
      },
      PROJECT: {
        minStars: 0,
        languages: [],
        topics: [],
      },
    };

    return defaultFilters[resourceType] || {};
  }

  /**
   * 初始化默认采集规则
   */
  async initializeDefaultRules() {
    try {
      const defaults: CreateCollectionRuleDto[] = [
        {
          resourceType: "PAPER" as ResourceType,
          cronExpression: "0 0 * * 0", // 每周一凌晨0点
          maxConcurrent: 2,
          timeout: 600,
          deduplicationStrategy: "CONTENT_HASH",
          minimumQualityScore: 0.6,
          priority: 2,
          description: "Academic papers collection rule",
        },
        {
          resourceType: "BLOG" as ResourceType,
          cronExpression: "0 */6 * * *", // 每6小时
          maxConcurrent: 3,
          timeout: 300,
          deduplicationStrategy: "CONTENT_HASH",
          minimumQualityScore: 0.6,
          priority: 2,
          description: "Tech research blogs collection rule",
        },
        {
          resourceType: "NEWS" as ResourceType,
          cronExpression: "0 */6 * * *", // 每6小时
          maxConcurrent: 5,
          timeout: 300,
          deduplicationStrategy: "CONTENT_HASH",
          minimumQualityScore: 0.7,
          priority: 3,
          description: "Tech news collection rule",
        },
        {
          resourceType: "YOUTUBE_VIDEO" as ResourceType,
          cronExpression: "0 0 * * *", // 每天凌晨
          maxConcurrent: 2,
          timeout: 400,
          deduplicationStrategy: "URL_ONLY",
          minimumQualityScore: 0.5,
          priority: 1,
          description: "YouTube videos collection rule",
        },
        {
          resourceType: "REPORT" as ResourceType,
          cronExpression: "0 0 1 * *", // 每月1号凌晨
          maxConcurrent: 2,
          timeout: 600,
          deduplicationStrategy: "CONTENT_HASH",
          minimumQualityScore: 0.8,
          priority: 2,
          description: "Industry reports collection rule",
        },
        {
          resourceType: "POLICY" as ResourceType,
          cronExpression: "0 0 * * *", // 每天凌晨
          maxConcurrent: 3,
          timeout: 300,
          deduplicationStrategy: "CONTENT_HASH",
          minimumQualityScore: 0.7,
          priority: 2,
          description: "US tech policy collection rule",
        },
      ];

      for (const defaultRule of defaults) {
        try {
          const existing = await this.prisma.collectionRule.findFirst({
            where: { resourceType: defaultRule.resourceType },
          });

          if (!existing) {
            await this.createRule(defaultRule);
            this.logger.log(
              `Initialized default collection rule for ${defaultRule.resourceType}`,
            );
          }
        } catch (error) {
          this.logger.warn(
            `Failed to initialize default rule for ${defaultRule.resourceType}: ${getErrorMessage(error)}`,
          );
        }
      }

      this.logger.log("Default collection rules initialization completed");
    } catch (error) {
      this.logger.error(
        `Failed to initialize default rules: ${getErrorMessage(error)}`,
      );
    }
  }
}
