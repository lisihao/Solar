import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Query,
  Param,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { BlogCollectionService } from "./blog-collection.service";
import { BlogSchedulerService } from "./blog-scheduler.service";
import { SchedulerConfig } from "./blog-collection.types";

/**
 * Blog Collection Controller
 * 提供博客采集相关的API端点
 */
@ApiTags("Data Collection - Blog")
@Controller("blog")
export class BlogCollectionController {
  private readonly logger = new Logger(BlogCollectionController.name);

  constructor(
    private readonly blogCollectionService: BlogCollectionService,
    private readonly blogSchedulerService: BlogSchedulerService,
  ) {}

  /**
   * 获取所有可用的采集源
   * GET /api/v1/blog/sources
   */
  @Get("sources")
  async getSources() {
    try {
      const sources = await this.blogCollectionService.getActiveSources();
      return sources;
    } catch (error) {
      this.logger.error(`Error fetching sources: ${error}`);
      throw new InternalServerErrorException("Failed to fetch sources");
    }
  }

  /**
   * 手动触发采集
   * POST /api/v1/blog/collect
   * Body: { sourceId?: string }
   */
  @Post("collect")
  async triggerCollection(@Body() body: { sourceId?: string }) {
    try {
      const task = await this.blogSchedulerService.triggerCollection(
        body.sourceId,
      );
      return task;
    } catch (error) {
      this.logger.error(`Error triggering collection: ${error}`);
      throw new InternalServerErrorException("Failed to trigger collection");
    }
  }

  /**
   * 获取统计信息
   * GET /api/v1/blog/stats
   */
  @Get("stats")
  async getStats() {
    try {
      const stats = await this.blogCollectionService.getCollectionStats();
      const schedulerStatus = this.blogSchedulerService.getSchedulerStatus();

      return {
        ...stats,
        collectionStatus: schedulerStatus.enabled ? "active" : "inactive",
        activeTasks: schedulerStatus.tasks.length,
        lastCollectionTime: schedulerStatus.lastRun,
        nextCollectionTime: schedulerStatus.nextRun,
      };
    } catch (error) {
      this.logger.error(`Error fetching stats: ${error}`);
      throw new InternalServerErrorException("Failed to fetch stats");
    }
  }

  /**
   * 获取调度器状态
   * GET /api/v1/blog/scheduler/status
   */
  @Get("scheduler/status")
  async getSchedulerStatus() {
    try {
      const status = this.blogSchedulerService.getSchedulerStatus();
      return status;
    } catch (error) {
      this.logger.error(`Error fetching scheduler status: ${error}`);
      throw new InternalServerErrorException(
        "Failed to fetch scheduler status",
      );
    }
  }

  /**
   * 更新调度器配置
   * PUT /api/v1/blog/scheduler/config
   */
  @Put("scheduler/config")
  async updateSchedulerConfig(@Body() config: Partial<SchedulerConfig>) {
    try {
      const updated = await this.blogSchedulerService.updateConfig(config);
      return updated;
    } catch (error) {
      this.logger.error(`Error updating scheduler config: ${error}`);
      throw new InternalServerErrorException(
        "Failed to update scheduler config",
      );
    }
  }

  /**
   * 获取活跃任务列表
   * GET /api/v1/blog/tasks
   */
  @Get("tasks")
  async getActiveTasks() {
    try {
      const tasks = this.blogSchedulerService.getActiveTasks();
      return tasks;
    } catch (error) {
      this.logger.error(`Error fetching active tasks: ${error}`);
      throw new InternalServerErrorException("Failed to fetch active tasks");
    }
  }

  /**
   * 获取任务详情
   * GET /api/v1/blog/tasks/:taskId
   */
  @Get("tasks/:taskId")
  async getTaskDetail(@Param("taskId") taskId: string) {
    try {
      const task = this.blogSchedulerService.getTaskDetail(taskId);
      if (!task) {
        throw new NotFoundException("Task not found");
      }
      return task;
    } catch (error) {
      this.logger.error(`Error fetching task detail: ${error}`);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException("Failed to fetch task detail");
    }
  }

  /**
   * 获取采集的文章列表（分页）
   * GET /api/v1/blog/posts
   * Query: { page?: number, limit?: number, sourceId?: string, category?: string }
   */
  @Get("posts")
  async getPosts(
    @Query("page") page: number = 1,
    @Query("limit") limit: number = 20,
  ) {
    try {
      // TODO: 实现从数据库分页查询
      // 这里返回示例数据
      return {
        posts: [],
        total: 0,
        page,
        limit,
      };
    } catch (error) {
      this.logger.error(`Error fetching posts: ${error}`);
      throw new InternalServerErrorException("Failed to fetch posts");
    }
  }

  /**
   * 搜索采集的文章
   * GET /api/v1/blog/search
   * Query: { q: string, sourceId?: string }
   */
  @Get("search")
  async searchPosts(@Query("q") query: string) {
    try {
      if (!query) {
        throw new BadRequestException("Query parameter is required");
      }

      // TODO: 实现全文搜索
      return {
        results: [],
        total: 0,
      };
    } catch (error) {
      this.logger.error(`Error searching posts: ${error}`);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException("Failed to search posts");
    }
  }

  /**
   * 保存文章到用户收藏
   * POST /api/v1/blog/posts/:postId/save
   */
  @Post("posts/:postId/save")
  async savePost() {
    try {
      // TODO: 实现保存逻辑
      return {
        message: "Post saved successfully",
      };
    } catch (error) {
      this.logger.error(`Error saving post: ${error}`);
      throw new InternalServerErrorException("Failed to save post");
    }
  }

  /**
   * 获取用户保存的文章
   * GET /api/v1/blog/saved
   */
  @Get("saved")
  async getSavedPosts() {
    try {
      // TODO: 实现获取用户保存文章的逻辑
      return {
        posts: [],
        total: 0,
      };
    } catch (error) {
      this.logger.error(`Error fetching saved posts: ${error}`);
      throw new InternalServerErrorException("Failed to fetch saved posts");
    }
  }

  /**
   * 启动调度器
   * POST /api/v1/blog/scheduler/start
   */
  @Post("scheduler/start")
  async startScheduler() {
    try {
      const status = await this.blogSchedulerService.updateConfig({
        enabled: true,
      });
      return status;
    } catch (error) {
      this.logger.error(`Error starting scheduler: ${error}`);
      throw new InternalServerErrorException("Failed to start scheduler");
    }
  }

  /**
   * 停止调度器
   * POST /api/v1/blog/scheduler/stop
   */
  @Post("scheduler/stop")
  async stopScheduler() {
    try {
      const status = await this.blogSchedulerService.updateConfig({
        enabled: false,
      });
      return status;
    } catch (error) {
      this.logger.error(`Error stopping scheduler: ${error}`);
      throw new InternalServerErrorException("Failed to stop scheduler");
    }
  }
}
