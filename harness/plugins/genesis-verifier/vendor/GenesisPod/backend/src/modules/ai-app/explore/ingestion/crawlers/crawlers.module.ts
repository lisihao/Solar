import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
// Crawler services
import { CrawlerController } from "./crawler.controller";
import { ArxivService } from "./arxiv.service";
import { GithubService } from "./github.service";
import { HackernewsService } from "./hackernews.service";
import { HackernewsCommentsService } from "./hackernews-comments.service";
import { RssService } from "./rss.service";
import { WebScraperService } from "./web-scraper.service";
import { DeduplicationService } from "./deduplication.service";
// Blog collection services
import { BlogCollectionController } from "./blog-collection.controller";
import { BlogCollectionService } from "./blog-collection.service";
import { BlogSchedulerService } from "./blog-scheduler.service";
// Dependencies
import { ResourcesModule } from "../../../explore/resources/resources.module";
import { RawDataModule } from "@/modules/ai-app/explore/rawdata/rawdata.module";

/**
 * Crawlers Module (数据爬虫模块)
 *
 * 整合所有数据采集能力：
 * - 通用爬虫: HackerNews, GitHub, ArXiv, RSS, Web
 * - 博客采集: 定时采集博客源
 */
@Module({
  imports: [ResourcesModule, ConfigModule, RawDataModule],
  controllers: [CrawlerController, BlogCollectionController],
  providers: [
    // Crawler services
    ArxivService,
    GithubService,
    HackernewsService,
    HackernewsCommentsService,
    RssService,
    WebScraperService,
    DeduplicationService,
    // Blog collection services
    BlogCollectionService,
    BlogSchedulerService,
  ],
  exports: [
    // Crawler services
    ArxivService,
    GithubService,
    HackernewsService,
    HackernewsCommentsService,
    RssService,
    WebScraperService,
    DeduplicationService,
    // Blog collection services
    BlogCollectionService,
    BlogSchedulerService,
  ],
})
export class CrawlersModule {}
