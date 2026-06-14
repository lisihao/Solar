import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CollectionConfigurationService } from "../services/collection-configuration.service";
import { ResourceType } from "@prisma/client";

/**
 * Collection Configuration Controller
 * 提供采集配置管理API端点
 */
@ApiTags("Data Management - Collection Config")
@Controller("data-management/collection-configurations")
export class CollectionConfigurationController {
  private readonly logger = new Logger(CollectionConfigurationController.name);

  constructor(
    private readonly collectionConfigService: CollectionConfigurationService,
  ) {}

  /**
   * 创建采集配置
   * POST /api/v1/data-management/collection-configurations
   */
  @Post()
  async createConfig(
    @Body()
    body: {
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
    },
  ) {
    try {
      if (!body.resourceType || !body.name) {
        throw new BadRequestException(
          "Missing required fields: resourceType, name",
        );
      }

      const config = await this.collectionConfigService.createConfig(body);

      return config;
    } catch (error) {
      this.logger.error(`Error creating config: ${error}`);
      throw error;
    }
  }

  /**
   * 获取特定资源类型的所有配置
   * GET /api/v1/data-management/collection-configurations?resourceType=PAPER
   */
  @Get()
  async getConfigs(@Query("resourceType") resourceType?: ResourceType) {
    try {
      let configs;

      if (resourceType) {
        configs =
          await this.collectionConfigService.getConfigsByResourceType(
            resourceType,
          );
      } else {
        configs = await this.collectionConfigService.getActiveConfigs();
      }

      return configs;
    } catch (error) {
      this.logger.error(`Error fetching configs: ${error}`);
      throw error;
    }
  }

  /**
   * 获取特定配置
   * GET /api/v1/data-management/collection-configurations/:configId
   */
  @Get(":configId")
  async getConfig(@Param("configId") configId: string) {
    try {
      const config = await this.collectionConfigService.getConfig(configId);

      if (!config) {
        throw new NotFoundException("Collection configuration not found");
      }

      return config;
    } catch (error) {
      this.logger.error(`Error fetching config: ${error}`);
      throw error;
    }
  }

  /**
   * 更新采集配置
   * PUT /api/v1/data-management/collection-configurations/:configId
   */
  @Put(":configId")
  async updateConfig(
    @Param("configId") configId: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      keywords?: string[];
      excludeKeywords?: string[];
      urlPatterns?: string[];
      cronExpression?: string;
      maxConcurrent?: number;
      timeout?: number;
      isActive?: boolean;
    },
  ) {
    try {
      const config = await this.collectionConfigService.updateConfig(
        configId,
        body,
      );

      return config;
    } catch (error) {
      this.logger.error(`Error updating config: ${error}`);
      throw error;
    }
  }

  /**
   * 删除采集配置
   * DELETE /api/v1/data-management/collection-configurations/:configId
   */
  @Delete(":configId")
  async deleteConfig(@Param("configId") configId: string) {
    try {
      await this.collectionConfigService.deleteConfig(configId);

      return { message: "Collection configuration deleted successfully" };
    } catch (error) {
      this.logger.error(`Error deleting config: ${error}`);
      throw error;
    }
  }

  /**
   * 启用配置
   * POST /api/v1/data-management/collection-configurations/:configId/enable
   */
  @Post(":configId/enable")
  async enableConfig(@Param("configId") configId: string) {
    try {
      const config = await this.collectionConfigService.enableConfig(configId);

      return config;
    } catch (error) {
      this.logger.error(`Error enabling config: ${error}`);
      throw error;
    }
  }

  /**
   * 禁用配置
   * POST /api/v1/data-management/collection-configurations/:configId/disable
   */
  @Post(":configId/disable")
  async disableConfig(@Param("configId") configId: string) {
    try {
      const config = await this.collectionConfigService.disableConfig(configId);

      return config;
    } catch (error) {
      this.logger.error(`Error disabling config: ${error}`);
      throw error;
    }
  }

  /**
   * 验证URL和内容是否匹配配置
   * POST /api/v1/data-management/collection-configurations/:configId/validate
   */
  @Post(":configId/validate")
  async validateContent(
    @Param("configId") configId: string,
    @Body()
    body: {
      url: string;
      content: string;
    },
  ) {
    try {
      const config = await this.collectionConfigService.getConfig(configId);

      if (!config) {
        throw new NotFoundException("Collection configuration not found");
      }

      const urlPatterns = (config.urlPatterns as string[]) || [];
      const keywords = (config.keywords as string[]) || [];
      const excludeKeywords = (config.excludeKeywords as string[]) || [];

      const urlMatches = this.collectionConfigService.matchesUrlPatterns(
        body.url,
        urlPatterns,
      );
      const contentMatches = this.collectionConfigService.matchesKeywords(
        body.content,
        keywords,
        excludeKeywords,
      );

      return {
        urlMatches,
        contentMatches,
        overallMatch: urlMatches && contentMatches,
      };
    } catch (error) {
      this.logger.error(`Error validating content: ${error}`);
      throw error;
    }
  }
}
