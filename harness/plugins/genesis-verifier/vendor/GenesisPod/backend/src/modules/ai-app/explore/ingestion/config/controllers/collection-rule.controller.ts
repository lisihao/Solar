import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CollectionRuleService } from "../services/collection-rule.service";
import { ResourceType } from "@prisma/client";

/**
 * Collection Rule Controller
 * 提供采集规则管理的API端点
 */
@ApiTags("Data Management - Rules")
@Controller("data-management/rules")
export class CollectionRuleController {
  private readonly logger = new Logger(CollectionRuleController.name);

  constructor(private readonly ruleService: CollectionRuleService) {}

  /**
   * 获取所有采集规则
   * GET /api/v1/data-management/rules
   */
  @Get()
  async getAllRules() {
    try {
      const rules = await this.ruleService.getAllRules();
      return {
        data: rules,
        total: rules.length,
      };
    } catch (error) {
      this.logger.error(`Error fetching rules: ${error}`);
      throw new BadRequestException("Failed to fetch collection rules");
    }
  }

  /**
   * 获取所有活跃的采集规则
   * GET /api/v1/data-management/rules/active
   */
  @Get("active")
  async getActiveRules() {
    try {
      const rules = await this.ruleService.getActiveRules();
      return {
        data: rules,
        total: rules.length,
      };
    } catch (error) {
      this.logger.error(`Error fetching active rules: ${error}`);
      throw new BadRequestException("Failed to fetch active rules");
    }
  }

  /**
   * 获取特定资源类型的采集规则
   * GET /api/v1/data-management/rules/:resourceType
   */
  @Get(":resourceType")
  async getRule(@Param("resourceType") resourceType: string) {
    try {
      const rule = await this.ruleService.getRule(resourceType as ResourceType);

      if (!rule) {
        throw new NotFoundException(`Rule not found for ${resourceType}`);
      }

      return rule;
    } catch (error) {
      this.logger.error(`Error fetching rule: ${error}`);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException("Failed to fetch collection rule");
    }
  }

  /**
   * 创建采集规则
   * POST /api/v1/data-management/rules
   */
  @Post()
  async createRule(
    @Body()
    body: {
      resourceType: ResourceType;
      cronExpression?: string;
      maxConcurrent?: number;
      timeout?: number;
      filters?: Record<string, unknown>;
      deduplicationStrategy?: string;
      minimumQualityScore?: number;
      priority?: number;
      description?: string;
    },
  ) {
    try {
      if (!body.resourceType) {
        throw new BadRequestException("Missing required field: resourceType");
      }

      const rule = await this.ruleService.createRule(body);
      return rule;
    } catch (error) {
      this.logger.error(`Error creating rule: ${error}`);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException("Failed to create collection rule");
    }
  }

  /**
   * 更新采集规则
   * PUT /api/v1/data-management/rules/:resourceType
   */
  @Put(":resourceType")
  async updateRule(
    @Param("resourceType") resourceType: string,
    @Body()
    body: {
      cronExpression?: string;
      maxConcurrent?: number;
      timeout?: number;
      filters?: Record<string, unknown>;
      deduplicationStrategy?: string;
      minimumQualityScore?: number;
      priority?: number;
      description?: string;
      isActive?: boolean;
    },
  ) {
    try {
      const rule = await this.ruleService.updateRule(
        resourceType as ResourceType,
        body,
      );

      return rule;
    } catch (error) {
      this.logger.error(`Error updating rule: ${error}`);
      throw new BadRequestException("Failed to update collection rule");
    }
  }

  /**
   * 删除采集规则
   * DELETE /api/v1/data-management/rules/:resourceType
   */
  @Delete(":resourceType")
  async deleteRule(@Param("resourceType") resourceType: string) {
    try {
      await this.ruleService.deleteRule(resourceType as ResourceType);
      return {
        message: `Rule for ${resourceType} deleted successfully`,
      };
    } catch (error) {
      this.logger.error(`Error deleting rule: ${error}`);
      throw new BadRequestException("Failed to delete collection rule");
    }
  }

  /**
   * 启用采集规则
   * POST /api/v1/data-management/rules/:resourceType/enable
   */
  @Post(":resourceType/enable")
  async enableRule(@Param("resourceType") resourceType: string) {
    try {
      const rule = await this.ruleService.enableRule(
        resourceType as ResourceType,
      );
      return {
        data: rule,
        message: `Rule for ${resourceType} enabled successfully`,
      };
    } catch (error) {
      this.logger.error(`Error enabling rule: ${error}`);
      throw new BadRequestException("Failed to enable collection rule");
    }
  }

  /**
   * 禁用采集规则
   * POST /api/v1/data-management/rules/:resourceType/disable
   */
  @Post(":resourceType/disable")
  async disableRule(@Param("resourceType") resourceType: string) {
    try {
      const rule = await this.ruleService.disableRule(
        resourceType as ResourceType,
      );
      return {
        data: rule,
        message: `Rule for ${resourceType} disabled successfully`,
      };
    } catch (error) {
      this.logger.error(`Error disabling rule: ${error}`);
      throw new BadRequestException("Failed to disable collection rule");
    }
  }

  /**
   * 初始化默认采集规则
   * POST /api/v1/data-management/rules/init/defaults
   */
  @Post("init/defaults")
  async initializeDefaults() {
    try {
      await this.ruleService.initializeDefaultRules();
      return {
        message: "Default collection rules initialized successfully",
      };
    } catch (error) {
      this.logger.error(`Error initializing defaults: ${error}`);
      throw new BadRequestException(
        "Failed to initialize default collection rules",
      );
    }
  }
}
