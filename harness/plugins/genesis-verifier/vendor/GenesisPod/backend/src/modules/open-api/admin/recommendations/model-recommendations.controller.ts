import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AIModelType } from "@prisma/client";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import { ModelRecommendationsService } from "../../../ai-engine/facade";

interface AuthedReq {
  user: { id: string; email: string };
}

/**
 * 管理员：推荐矩阵 CRUD。
 *
 * （原本还有 POST /admin/ai-models/auto-configure；因为它基于现有 AIModel 的老 key
 *  猜 provider，且正则过松会引入 specialty 变体，已下线。用户端一键仍然保留，
 *  那边 Personal Key 很明确、风险可控。矩阵编辑页也保留，供管理员维护 user 侧规则。）
 *
 * 路径：
 *   GET    /admin/model-recommendations
 *   POST   /admin/model-recommendations
 *   PATCH  /admin/model-recommendations/:id
 *   DELETE /admin/model-recommendations/:id
 *   POST   /admin/model-recommendations/seed       (补齐缺失的默认条目)
 *   POST   /admin/model-recommendations/reset      (完全重置为硬编码默认)
 */
@ApiTags("Admin - Model Recommendations")
@Controller()
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminModelRecommendationsController {
  constructor(private readonly recommendations: ModelRecommendationsService) {}

  // ============ Recommendations CRUD ============

  @Get("admin/model-recommendations")
  @ApiOperation({
    summary: "获取推荐矩阵（DB 优先 + 硬编码 fallback 合并）",
  })
  async listAll() {
    return {
      items: await this.recommendations.listAll(),
    };
  }

  @Get("admin/model-recommendations/db")
  @ApiOperation({
    summary: "获取 DB 原始行（编辑用，不含 fallback）",
  })
  async listDb() {
    return {
      items: await this.recommendations.listDbRows(),
    };
  }

  @Post("admin/model-recommendations")
  @ApiOperation({ summary: "新增一条 (provider, modelType) 推荐" })
  async create(
    @Req() req: AuthedReq,
    @Body()
    body: {
      provider: string;
      modelType: AIModelType;
      patterns: string[];
      priority?: number;
      note?: string;
    },
  ) {
    if (!body.provider) throw new BadRequestException("provider is required");
    if (!body.modelType) throw new BadRequestException("modelType is required");
    return this.recommendations.create(body, req.user.id);
  }

  @Patch("admin/model-recommendations/:id")
  @ApiOperation({ summary: "更新指定推荐（只改 patterns / priority / note）" })
  async update(
    @Req() req: AuthedReq,
    @Param("id") id: string,
    @Body()
    body: {
      patterns?: string[];
      priority?: number;
      note?: string | null;
    },
  ) {
    return this.recommendations.update(id, body, req.user.id);
  }

  @Delete("admin/model-recommendations/:id")
  @ApiOperation({ summary: "删除指定推荐（可用于恢复 fallback 默认）" })
  async remove(@Param("id") id: string) {
    await this.recommendations.remove(id);
    return { success: true };
  }

  @Post("admin/model-recommendations/seed")
  @ApiOperation({
    summary: "补齐：只插入缺失的默认条目，不覆盖现有",
  })
  async seedMissing(@Req() req: AuthedReq) {
    return this.recommendations.seedMissingDefaults(req.user.id);
  }

  @Post("admin/model-recommendations/reset")
  @ApiOperation({
    summary: "完全重置为硬编码默认（危险：会清空管理员编辑过的 patterns）",
  })
  async reset(@Req() req: AuthedReq) {
    return this.recommendations.resetToDefaults(req.user.id);
  }
}
