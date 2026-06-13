import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ResourceType } from "@prisma/client";
import { getErrorMessage } from "../../../../../../common/utils/error.utils";

interface CreateCollectionConfigDto {
  resourceType: ResourceType;
  name: string;
  description?: string;
  keywords?: string[];
  excludeKeywords?: string[];
  urlPatterns?: string[];
  cronExpression?: string;
  maxConcurrent?: number;
  timeout?: number;
  isActive?: boolean;
}

interface UpdateCollectionConfigDto {
  name?: string;
  description?: string;
  keywords?: string[];
  excludeKeywords?: string[];
  urlPatterns?: string[];
  cronExpression?: string;
  maxConcurrent?: number;
  timeout?: number;
  isActive?: boolean;
}

/**
 * Collection Configuration Service
 * 管理采集配置、关键词、URL模式等
 */
@Injectable()
export class CollectionConfigurationService {
  private readonly logger = new Logger(CollectionConfigurationService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 创建采集配置
   */
  async createConfig(dto: CreateCollectionConfigDto) {
    try {
      const config = await this.prisma.collectionConfiguration.create({
        data: {
          resourceType: dto.resourceType,
          name: dto.name,
          description: dto.description,
          keywords: dto.keywords || [],
          excludeKeywords: dto.excludeKeywords || [],
          urlPatterns: dto.urlPatterns || [],
          cronExpression: dto.cronExpression || "0 */6 * * *",
          maxConcurrent: dto.maxConcurrent || 3,
          timeout: dto.timeout || 300,
          isActive: dto.isActive !== false,
        },
      });

      this.logger.log(
        `Created collection configuration: ${config.id} for ${dto.resourceType}`,
      );
      return config;
    } catch (error) {
      this.logger.error(
        `Failed to create collection config: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 获取特定资源类型的所有配置
   */
  async getConfigsByResourceType(resourceType: ResourceType) {
    try {
      const configs = await this.prisma.collectionConfiguration.findMany({
        where: { resourceType },
        orderBy: { createdAt: "desc" },
      });

      return configs;
    } catch (error) {
      this.logger.error(
        `Failed to get configs for ${resourceType}: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 获取特定配置
   */
  async getConfig(id: string) {
    try {
      const config = await this.prisma.collectionConfiguration.findUnique({
        where: { id },
      });

      if (!config) {
        this.logger.warn(`Collection config not found: ${id}`);
        return null;
      }

      return config;
    } catch (error) {
      this.logger.error(
        `Failed to get collection config: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 获取所有激活的配置
   */
  async getActiveConfigs() {
    try {
      const configs = await this.prisma.collectionConfiguration.findMany({
        where: { isActive: true },
        orderBy: [{ resourceType: "asc" }, { createdAt: "desc" }],
      });

      return configs;
    } catch (error) {
      this.logger.error(
        `Failed to get active configs: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 更新采集配置
   */
  async updateConfig(id: string, dto: UpdateCollectionConfigDto) {
    try {
      const config = await this.prisma.collectionConfiguration.update({
        where: { id },
        data: {
          ...(dto.name && { name: dto.name }),
          ...(dto.description !== undefined && {
            description: dto.description,
          }),
          ...(dto.keywords && { keywords: dto.keywords }),
          ...(dto.excludeKeywords && { excludeKeywords: dto.excludeKeywords }),
          ...(dto.urlPatterns && { urlPatterns: dto.urlPatterns }),
          ...(dto.cronExpression && { cronExpression: dto.cronExpression }),
          ...(dto.maxConcurrent && { maxConcurrent: dto.maxConcurrent }),
          ...(dto.timeout && { timeout: dto.timeout }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
          updatedAt: new Date(),
        },
      });

      this.logger.log(`Updated collection configuration: ${id}`);
      return config;
    } catch (error) {
      this.logger.error(
        `Failed to update collection config: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 删除采集配置
   */
  async deleteConfig(id: string) {
    try {
      await this.prisma.collectionConfiguration.delete({
        where: { id },
      });

      this.logger.log(`Deleted collection configuration: ${id}`);
    } catch (error) {
      this.logger.error(
        `Failed to delete collection config: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 启用配置
   */
  async enableConfig(id: string) {
    return this.updateConfig(id, { isActive: true });
  }

  /**
   * 禁用配置
   */
  async disableConfig(id: string) {
    return this.updateConfig(id, { isActive: false });
  }

  /**
   * 更新最后采集时间和统计
   */
  async updateCollectionStats(id: string, collectedCount: number) {
    try {
      const config = await this.prisma.collectionConfiguration.update({
        where: { id },
        data: {
          lastCollectedAt: new Date(),
          totalCollected: {
            increment: collectedCount,
          },
        },
      });

      return config;
    } catch (error) {
      this.logger.error(
        `Failed to update collection stats: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * 验证URL是否匹配配置中的URL模式
   */
  matchesUrlPatterns(url: string, patterns: string[]): boolean {
    if (!patterns || patterns.length === 0) {
      return true; // 如果没有设置模式，则匹配所有URL
    }

    return patterns.some((pattern) => this.matchesPattern(url, pattern));
  }

  /**
   * 检查内容是否包含关键词或排除关键词
   */
  matchesKeywords(
    content: string,
    keywords: string[],
    excludeKeywords: string[],
  ): boolean {
    const lowerContent = content.toLowerCase();

    // 检查排除关键词 - 如果包含任何排除关键词，则不匹配
    if (excludeKeywords && excludeKeywords.length > 0) {
      for (const keyword of excludeKeywords) {
        if (lowerContent.includes(keyword.toLowerCase())) {
          return false;
        }
      }
    }

    // 检查包含关键词 - 如果有设置关键词，则必须包含至少一个
    if (keywords && keywords.length > 0) {
      return keywords.some((keyword) =>
        lowerContent.includes(keyword.toLowerCase()),
      );
    }

    return true;
  }

  /**
   * 匹配URL模式（支持*通配符）
   */
  private matchesPattern(url: string, pattern: string): boolean {
    // 精确匹配
    if (url === pattern) {
      return true;
    }

    // 通配符匹配
    if (pattern.includes("*")) {
      const regexPattern = pattern
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*");

      try {
        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(url);
      } catch (error) {
        this.logger.warn(`Invalid URL pattern: ${pattern}`);
        return false;
      }
    }

    return false;
  }
}
