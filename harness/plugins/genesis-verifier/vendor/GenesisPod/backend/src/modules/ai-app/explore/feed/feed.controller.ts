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
import { FeedService } from "./feed.service";
import { Public } from "../../../../common/decorators/public.decorator";

/**
 * Feed 流控制器
 */
@ApiTags("Feed")
@Public()
@Controller("feed")
export class FeedController {
  private readonly logger = new Logger(FeedController.name);

  constructor(private feedService: FeedService) {}

  /**
   * 获取 Feed 流
   * GET /api/v1/feed?skip=0&take=20&type=PAPER&category=AI&sortBy=trendingScore
   */
  @Get()
  async getFeed(
    @Query("skip", new DefaultValuePipe(0), ParseIntPipe) skip: number,
    @Query("take", new DefaultValuePipe(20), ParseIntPipe) take: number,
    @Query("type") type?: string,
    @Query("category") category?: string,
    @Query("minQualityScore") minQualityScore?: number,
    @Query("sortBy") sortBy?: "publishedAt" | "qualityScore" | "trendingScore",
  ) {
    this.logger.log(`Fetching feed (skip: ${skip}, take: ${take})`);

    return this.feedService.getFeed({
      skip,
      take,
      type,
      category,
      minQualityScore,
      sortBy,
    });
  }

  /**
   * 搜索资源
   * GET /api/v1/feed/search?q=machine+learning&skip=0&take=20
   */
  @Get("search")
  async search(
    @Query("q") query: string,
    @Query("skip", new DefaultValuePipe(0), ParseIntPipe) skip: number,
    @Query("take", new DefaultValuePipe(20), ParseIntPipe) take: number,
    @Query("type") type?: string,
    @Query("category") category?: string,
  ) {
    this.logger.log(`Searching for: "${query}"`);

    return this.feedService.search({
      query,
      skip,
      take,
      type,
      category,
    });
  }

  /**
   * 获取热门资源
   * GET /api/v1/feed/trending?take=10
   */
  @Get("trending")
  async getTrending(
    @Query("take", new DefaultValuePipe(10), ParseIntPipe) take: number,
  ) {
    this.logger.log(`Fetching top ${take} trending resources`);

    return this.feedService.getTrending(take);
  }

  /**
   * 获取相关资源
   * GET /api/v1/feed/related/:id?take=5
   */
  @Get("related/:id")
  async getRelated(
    @Param("id") id: string,
    @Query("take", new DefaultValuePipe(5), ParseIntPipe) take: number,
  ) {
    this.logger.log(`Fetching related resources for ${id}`);

    return this.feedService.getRelated(id, take);
  }
}
