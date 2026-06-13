import {
  Controller,
  Post,
  Get,
  Query,
  Logger,
  BadRequestException,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ArxivService } from "./arxiv.service";
import { GithubService } from "./github.service";
import { HackernewsService } from "./hackernews.service";

/**
 * 数据采集器控制器
 */
@ApiTags("Data Collection - Crawler")
@Controller("crawler")
export class CrawlerController {
  private readonly logger = new Logger(CrawlerController.name);

  constructor(
    private arxivService: ArxivService,
    private githubService: GithubService,
    private hackernewsService: HackernewsService,
  ) {}

  /**
   * 采集 arXiv 最新论文
   */
  @Post("arxiv/latest")
  async fetchArxivLatest(
    @Query("max") max?: string,
    @Query("category") category?: string,
  ) {
    const maxResults = max ? parseInt(max, 10) : 10;

    this.logger.log(
      `Triggering arXiv latest papers fetch (max: ${maxResults})`,
    );

    const count = await this.arxivService.fetchLatestPapers(
      maxResults,
      category,
    );

    return {
      source: "arxiv",
      action: "fetch_latest",
      processed: count,
      maxResults,
      category: category || "all",
    };
  }

  /**
   * 搜索 arXiv 论文
   */
  @Post("arxiv/search")
  async searchArxiv(@Query("q") query: string, @Query("max") max?: string) {
    if (!query) {
      throw new BadRequestException('Query parameter "q" is required');
    }

    const maxResults = max ? parseInt(max, 10) : 10;
    const count = await this.arxivService.searchPapers(query, maxResults);

    return {
      source: "arxiv",
      action: "search",
      query,
      processed: count,
    };
  }

  /**
   * 采集 GitHub 趋势项目
   */
  @Post("github/trending")
  async fetchGithubTrending(
    @Query("language") language?: string,
    @Query("since") since?: "daily" | "weekly" | "monthly",
  ) {
    this.logger.log(
      `Triggering GitHub trending fetch (language: ${language || "all"})`,
    );

    const count = await this.githubService.fetchTrendingRepos(
      language,
      since || "daily",
    );

    return {
      source: "github",
      action: "fetch_trending",
      processed: count,
      language: language || "all",
      since: since || "daily",
    };
  }

  /**
   * 搜索 GitHub 项目
   */
  @Post("github/search")
  async searchGithub(@Query("q") query: string, @Query("max") max?: string) {
    if (!query) {
      throw new BadRequestException('Query parameter "q" is required');
    }

    const maxResults = max ? parseInt(max, 10) : 10;
    const count = await this.githubService.searchRepositories(
      query,
      maxResults,
    );

    return {
      source: "github",
      action: "search",
      query,
      processed: count,
    };
  }

  /**
   * 采集 HackerNews 热门故事
   */
  @Post("hackernews/top")
  async fetchHNTop(@Query("max") max?: string) {
    const maxResults = max ? parseInt(max, 10) : 30;

    this.logger.log(
      `Triggering HackerNews top stories fetch (max: ${maxResults})`,
    );

    const count = await this.hackernewsService.fetchTopStories(maxResults);

    return {
      source: "hackernews",
      action: "fetch_top",
      processed: count,
    };
  }

  /**
   * 采集 HackerNews 最新故事
   */
  @Post("hackernews/new")
  async fetchHNNew(@Query("max") max?: string) {
    const maxResults = max ? parseInt(max, 10) : 30;
    const count = await this.hackernewsService.fetchNewStories(maxResults);

    return {
      source: "hackernews",
      action: "fetch_new",
      processed: count,
    };
  }

  /**
   * 采集 HackerNews 最佳故事
   */
  @Post("hackernews/best")
  async fetchHNBest(@Query("max") max?: string) {
    const maxResults = max ? parseInt(max, 10) : 30;
    const count = await this.hackernewsService.fetchBestStories(maxResults);

    return {
      source: "hackernews",
      action: "fetch_best",
      processed: count,
    };
  }

  /**
   * 一键采集所有数据源
   */
  @Post("fetch-all")
  async fetchAll() {
    this.logger.log("Triggering fetch for all data sources");

    const results = await Promise.allSettled([
      this.arxivService.fetchLatestPapers(10, "cs.AI"),
      this.githubService.fetchTrendingRepos("typescript", "daily"),
      this.hackernewsService.fetchTopStories(20),
    ]);

    return {
      action: "fetch_all",
      results: results.map((r, index) => ({
        source: ["arxiv", "github", "hackernews"][index],
        status: r.status,
        processed: r.status === "fulfilled" ? r.value : 0,
        error: r.status === "rejected" ? r.reason.message : null,
      })),
    };
  }

  /**
   * 健康检查
   */
  @Get("health")
  health() {
    return {
      status: "ok",
      service: "Crawler",
      sources: ["arxiv", "github", "hackernews"],
    };
  }
}
