import { Controller, Get, Post, Put, Param, Query, Body } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { QualityService } from "./quality.service";

@ApiTags("Data Collection - Quality")
@Controller("data-collection/quality")
export class QualityController {
  constructor(private readonly qualityService: QualityService) {}

  /**
   * 获取质量问题列表
   * GET /data-collection/quality/issues
   */
  @Get("issues")
  async getIssues(
    @Query("severity") severity?: string,
    @Query("reviewStatus") reviewStatus?: string,
    @Query("limit") limit?: string,
  ) {
    const issues = await this.qualityService.getIssues({
      severity,
      reviewStatus,
      limit: limit ? parseInt(limit) : undefined,
    });
    return {
      data: issues,
      total: issues.length,
    };
  }

  /**
   * 获取质量统计
   * GET /data-collection/quality/stats
   */
  @Get("stats")
  async getStats() {
    const stats = await this.qualityService.getStats();
    return stats;
  }

  /**
   * 评估单个资源质量
   * POST /data-collection/quality/assess/:resourceId
   */
  @Post("assess/:resourceId")
  async assessQuality(@Param("resourceId") resourceId: string) {
    const result = await this.qualityService.assessResourceQuality(resourceId);
    return result;
  }

  /**
   * 批量评估质量
   * POST /data-collection/quality/batch-assess?limit=100
   */
  @Post("batch-assess")
  async batchAssess(@Query("limit") limit?: string) {
    const assessed = await this.qualityService.batchAssessQuality(
      limit ? parseInt(limit) : 100,
    );
    return {
      message: `Assessed ${assessed} resources`,
      assessed,
    };
  }

  /**
   * 更新审核状态
   * PUT /data-collection/quality/review/:resourceId
   */
  @Put("review/:resourceId")
  async updateReview(
    @Param("resourceId") resourceId: string,
    @Body() body: { status: string; note?: string },
  ) {
    await this.qualityService.updateReviewStatus(
      resourceId,
      body.status,
      body.note,
    );
    return {
      message: "Review status updated",
    };
  }
}
