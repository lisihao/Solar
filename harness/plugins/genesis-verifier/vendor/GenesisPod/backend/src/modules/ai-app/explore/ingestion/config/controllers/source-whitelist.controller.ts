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
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { SourceWhitelistService } from "../services/source-whitelist.service";
import { ResourceType } from "@prisma/client";

/**
 * Source Whitelist Controller
 * 提供源白名单管理的API端点
 */
@ApiTags("Data Management - Whitelist")
@Controller("data-management/whitelists")
export class SourceWhitelistController {
  private readonly logger = new Logger(SourceWhitelistController.name);

  constructor(private readonly whitelistService: SourceWhitelistService) {}

  /**
   * 获取所有白名单
   * GET /api/v1/data-management/whitelists
   */
  @Get()
  async getAllWhitelists() {
    try {
      const whitelists = await this.whitelistService.getAllWhitelists();
      return {
        data: whitelists,
        total: whitelists.length,
      };
    } catch (error) {
      this.logger.error(`Error fetching whitelists: ${error}`);
      throw new InternalServerErrorException("Failed to fetch whitelists");
    }
  }

  /**
   * 获取特定资源类型的白名单
   * GET /api/v1/data-management/whitelists/:resourceType
   */
  @Get(":resourceType")
  async getWhitelist(@Param("resourceType") resourceType: string) {
    try {
      const whitelist = await this.whitelistService.getWhitelist(
        resourceType as ResourceType,
      );

      if (!whitelist) {
        throw new NotFoundException(`Whitelist not found for ${resourceType}`);
      }

      return whitelist;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error fetching whitelist: ${error}`);
      throw new InternalServerErrorException("Failed to fetch whitelist");
    }
  }

  /**
   * 创建白名单
   * POST /api/v1/data-management/whitelists
   * Body: { resourceType: ResourceType, allowedDomains: string[], description?: string }
   */
  @Post()
  async createWhitelist(
    @Body()
    body: {
      resourceType: ResourceType;
      allowedDomains: string[];
      description?: string;
    },
  ) {
    try {
      if (!body.resourceType || !body.allowedDomains) {
        throw new BadRequestException(
          "Missing required fields: resourceType and allowedDomains",
        );
      }

      const whitelist = await this.whitelistService.createWhitelist(body);
      return whitelist;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Error creating whitelist: ${error}`);
      throw new InternalServerErrorException("Failed to create whitelist");
    }
  }

  /**
   * 更新白名单
   * PUT /api/v1/data-management/whitelists/:resourceType
   * Body: { allowedDomains?: string[], description?: string, isActive?: boolean }
   */
  @Put(":resourceType")
  async updateWhitelist(
    @Param("resourceType") resourceType: string,
    @Body()
    body: {
      allowedDomains?: string[];
      description?: string;
      isActive?: boolean;
    },
  ) {
    try {
      const whitelist = await this.whitelistService.updateWhitelist(
        resourceType as ResourceType,
        body,
      );

      return whitelist;
    } catch (error) {
      this.logger.error(`Error updating whitelist: ${error}`);
      throw new InternalServerErrorException("Failed to update whitelist");
    }
  }

  /**
   * 删除白名单
   * DELETE /api/v1/data-management/whitelists/:resourceType
   */
  @Delete(":resourceType")
  async deleteWhitelist(@Param("resourceType") resourceType: string) {
    try {
      await this.whitelistService.deleteWhitelist(resourceType as ResourceType);
      return {
        message: `Whitelist for ${resourceType} deleted successfully`,
      };
    } catch (error) {
      this.logger.error(`Error deleting whitelist: ${error}`);
      throw new InternalServerErrorException("Failed to delete whitelist");
    }
  }

  /**
   * 验证单个URL是否在白名单中
   * GET /api/v1/data-management/whitelists/:resourceType/validate
   * Query: { url: string }
   */
  @Get(":resourceType/validate")
  async validateUrl(
    @Param("resourceType") resourceType: string,
    @Query("url") url: string,
  ) {
    try {
      if (!url) {
        throw new BadRequestException("Missing required query parameter: url");
      }

      const result = await this.whitelistService.validateUrl(
        resourceType as ResourceType,
        url,
      );

      return result;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Error validating URL: ${error}`);
      throw new InternalServerErrorException("Failed to validate URL");
    }
  }

  /**
   * 批量验证URL
   * POST /api/v1/data-management/whitelists/:resourceType/validate-batch
   * Body: { urls: string[] }
   */
  @Post(":resourceType/validate-batch")
  async validateUrls(
    @Param("resourceType") resourceType: string,
    @Body() body: { urls: string[] },
  ) {
    try {
      if (!body.urls || !Array.isArray(body.urls)) {
        throw new BadRequestException("Missing required field: urls (array)");
      }

      const results = await this.whitelistService.validateUrls(
        resourceType as ResourceType,
        body.urls,
      );

      return {
        data: results,
        total: results.length,
        validCount: results.filter((r) => r.isValid).length,
        invalidCount: results.filter((r) => !r.isValid).length,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Error validating URLs: ${error}`);
      throw new InternalServerErrorException("Failed to validate URLs");
    }
  }

  /**
   * 添加允许的域名
   * POST /api/v1/data-management/whitelists/:resourceType/domains
   * Body: { domain: string }
   */
  @Post(":resourceType/domains")
  async addAllowedDomain(
    @Param("resourceType") resourceType: string,
    @Body() body: { domain: string },
  ) {
    try {
      if (!body.domain) {
        throw new BadRequestException("Missing required field: domain");
      }

      const whitelist = await this.whitelistService.addAllowedDomain(
        resourceType as ResourceType,
        body.domain,
      );

      return whitelist;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Error adding domain: ${error}`);
      throw new InternalServerErrorException("Failed to add domain");
    }
  }

  /**
   * 移除允许的域名
   * DELETE /api/v1/data-management/whitelists/:resourceType/domains/:domain
   */
  @Delete(":resourceType/domains/:domain")
  async removeAllowedDomain(
    @Param("resourceType") resourceType: string,
    @Param("domain") domain: string,
  ) {
    try {
      const whitelist = await this.whitelistService.removeAllowedDomain(
        resourceType as ResourceType,
        domain,
      );

      return whitelist;
    } catch (error) {
      this.logger.error(`Error removing domain: ${error}`);
      throw new InternalServerErrorException("Failed to remove domain");
    }
  }

  /**
   * 初始化默认白名单
   * POST /api/v1/data-management/whitelists/init/defaults
   */
  @Post("init/defaults")
  async initializeDefaults() {
    try {
      await this.whitelistService.initializeDefaultWhitelists();
      return {
        message: "Default whitelists initialized successfully",
      };
    } catch (error) {
      this.logger.error(`Error initializing defaults: ${error}`);
      throw new InternalServerErrorException(
        "Failed to initialize default whitelists",
      );
    }
  }
}
