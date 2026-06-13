import {
  Controller,
  Get,
  Query,
  Param,
  Logger,
  ParseIntPipe,
  DefaultValuePipe,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RecommendationsService } from "./recommendations.service.postgres";
import { Public } from "../../../../common/decorators/public.decorator";

/**
 * 推荐系统控制器
 */
@ApiTags("Recommendations")
@Public()
@Controller("recommendations")
export class RecommendationsController {
  private readonly logger = new Logger(RecommendationsController.name);

  constructor(private recommendationsService: RecommendationsService) {}

  /**
   * 获取个性化推荐
   * GET /api/v1/recommendations/personalized?userId=xxx&limit=10
   */
  @Get("personalized")
  async getPersonalized(
    @Query("userId") userId?: string,
    @Query("limit", new DefaultValuePipe(10), ParseIntPipe) limit?: number,
  ) {
    this.logger.log(
      `Fetching personalized recommendations (userId: ${userId || "anonymous"})`,
    );
    return this.recommendationsService.getPersonalizedRecommendations(
      userId,
      limit,
    );
  }

  /**
   * 基于内容的推荐
   * GET /api/v1/recommendations/content/:id?limit=10
   */
  @Get("content/:id")
  async getContentBased(
    @Param("id") id: string,
    @Query("limit", new DefaultValuePipe(10), ParseIntPipe) limit?: number,
  ) {
    this.logger.log(
      `Fetching content-based recommendations for resource ${id}`,
    );
    return this.recommendationsService.getContentBasedRecommendations(
      id,
      limit,
    );
  }

  /**
   * 基于知识图谱的推荐
   * GET /api/v1/recommendations/graph/:id?limit=10
   */
  @Get("graph/:id")
  async getGraphBased(
    @Param("id") id: string,
    @Query("limit", new DefaultValuePipe(10), ParseIntPipe) limit?: number,
  ) {
    this.logger.log(`Fetching graph-based recommendations for resource ${id}`);
    return this.recommendationsService.getGraphBasedRecommendations(id, limit);
  }

  /**
   * 混合推荐
   * GET /api/v1/recommendations/hybrid/:id?userId=xxx&limit=10
   */
  @Get("hybrid/:id")
  async getHybrid(
    @Param("id") id: string,
    @Query("userId") userId?: string,
    @Query("limit", new DefaultValuePipe(10), ParseIntPipe) limit?: number,
  ) {
    this.logger.log(`Fetching hybrid recommendations for resource ${id}`);
    return this.recommendationsService.getHybridRecommendations(
      id,
      userId,
      limit,
    );
  }

  /**
   * 冷启动推荐（新用户）
   * GET /api/v1/recommendations/cold-start?limit=10
   */
  @Get("cold-start")
  async getColdStart(
    @Query("limit", new DefaultValuePipe(10), ParseIntPipe) limit?: number,
  ) {
    this.logger.log("Fetching cold-start recommendations");
    return this.recommendationsService.getColdStartRecommendations(limit);
  }

  /**
   * 按类别推荐
   * GET /api/v1/recommendations/category/:category?limit=10
   */
  @Get("category/:category")
  async getByCategory(
    @Param("category") category: string,
    @Query("limit", new DefaultValuePipe(10), ParseIntPipe) limit?: number,
  ) {
    this.logger.log(`Fetching recommendations for category ${category}`);
    return this.recommendationsService.getRecommendationsByCategory(
      category,
      limit,
    );
  }

  /**
   * 探索发现
   * GET /api/v1/recommendations/explore?limit=10
   */
  @Get("explore")
  async getExplore(
    @Query("limit", new DefaultValuePipe(10), ParseIntPipe) limit?: number,
  ) {
    this.logger.log("Fetching explore recommendations");
    return this.recommendationsService.getExploreRecommendations(limit);
  }
}
