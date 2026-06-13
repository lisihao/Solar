import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseGuards,
  Logger,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import { CacheService, CachePrefix } from "../../../../common/cache";

/**
 * 缓存管理控制器
 * 提供缓存监控和管理功能
 * 统一路由前缀: /admin/cache
 */
@ApiTags("Admin - Cache")
@Controller("admin/cache")
@UseGuards(JwtAuthGuard, AdminGuard)
export class CacheController {
  private readonly logger = new Logger(CacheController.name);

  constructor(private readonly cacheService: CacheService) {}

  @Get("status")
  @ApiOperation({ summary: "获取缓存状态" })
  @ApiResponse({ status: 200, description: "返回缓存状态信息" })
  async getCacheStatus() {
    return {
      timestamp: new Date().toISOString(),
      cacheType: process.env.REDIS_URL ? "redis" : "memory",
      prefixes: Object.values(CachePrefix),
      note: "Use DELETE endpoints to clear specific cache prefixes",
    };
  }

  @Delete("ai-models")
  @ApiOperation({ summary: "清除 AI 模型缓存" })
  @ApiResponse({ status: 200, description: "AI 模型缓存已清除" })
  async clearAIModelCache() {
    this.logger.log("Admin: Clearing AI model cache");
    await this.cacheService.invalidateAIModelCache();
    return { success: true, message: "AI model cache cleared" };
  }

  @Delete("users/:userId")
  @ApiOperation({ summary: "清除指定用户缓存" })
  @ApiResponse({ status: 200, description: "用户缓存已清除" })
  async clearUserCache(@Param("userId") userId: string) {
    this.logger.log(`Admin: Clearing cache for user ${userId}`);
    await this.cacheService.invalidateUserCache(userId);
    return { success: true, message: `User ${userId} cache cleared` };
  }

  @Delete("prefix/:prefix")
  @ApiOperation({ summary: "按前缀清除缓存" })
  @ApiResponse({ status: 200, description: "指定前缀的缓存已清除" })
  async clearCacheByPrefix(@Param("prefix") prefix: string) {
    this.logger.log(`Admin: Clearing cache with prefix ${prefix}`);
    await this.cacheService.delByPrefix(prefix);
    return { success: true, message: `Cache with prefix ${prefix} cleared` };
  }

  @Post("warmup")
  @ApiOperation({ summary: "预热缓存" })
  @ApiResponse({ status: 200, description: "缓存预热完成" })
  async warmupCache() {
    this.logger.log("Admin: Cache warmup requested");
    // TODO: 实现缓存预热逻辑（如预加载常用模型配置）
    return {
      success: true,
      message: "Cache warmup completed",
      note: "Warmup logic not yet implemented",
    };
  }
}
