import { Test, TestingModule } from "@nestjs/testing";
import {
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from "@nestjs/common";
import { BlogCollectionController } from "../blog-collection.controller";
import { BlogCollectionService } from "../blog-collection.service";
import { BlogSchedulerService } from "../blog-scheduler.service";
import type {
  BlogSource,
  CollectionTask,
  SchedulerConfig,
} from "../blog-collection.types";

const mockSource: BlogSource = {
  id: "src-1",
  name: "techcrunch",
  displayName: "TechCrunch",
  category: "enterprise",
  blogUrl: "https://techcrunch.com",
  isActive: true,
};

const mockTask: CollectionTask = {
  id: "task-1",
  sourceId: "src-1",
  sourceName: "TechCrunch",
  status: "in_progress",
  postsCollected: 5,
  postsSaved: 5,
  retryCount: 0,
  startTime: new Date(),
};

const mockSchedulerStatus = {
  enabled: true,
  tasks: [mockTask],
  lastRun: new Date("2026-01-01T10:00:00Z"),
  nextRun: new Date("2026-01-01T11:00:00Z"),
  cronExpression: "0 * * * *",
  maxConcurrent: 3,
  activeTasks: 1,
};

const mockStats = {
  totalPosts: 200,
  totalSources: 5,
  activeTasks: 1,
  collectionStatus: "active" as const,
  averageCollectionDuration: 30,
};

describe("BlogCollectionController", () => {
  let controller: BlogCollectionController;
  let blogCollectionService: jest.Mocked<BlogCollectionService>;
  let blogSchedulerService: jest.Mocked<BlogSchedulerService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BlogCollectionController],
      providers: [
        {
          provide: BlogCollectionService,
          useValue: {
            getActiveSources: jest.fn(),
            getCollectionStats: jest.fn(),
          },
        },
        {
          provide: BlogSchedulerService,
          useValue: {
            triggerCollection: jest.fn(),
            getSchedulerStatus: jest.fn(),
            updateConfig: jest.fn(),
            getActiveTasks: jest.fn(),
            getTaskDetail: jest.fn(),
          },
        },
      ],
    })
      .setLogger({
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
      } as unknown as Logger)
      .compile();

    controller = module.get(BlogCollectionController);
    blogCollectionService = module.get(BlogCollectionService);
    blogSchedulerService = module.get(BlogSchedulerService);
  });

  // =========================================================
  // GET /blog/sources
  // =========================================================

  describe("getSources", () => {
    it("returns active sources from the service", async () => {
      blogCollectionService.getActiveSources.mockResolvedValue([mockSource]);

      const result = await controller.getSources();

      expect(result).toEqual([mockSource]);
    });

    it("returns empty array when no sources are active", async () => {
      blogCollectionService.getActiveSources.mockResolvedValue([]);

      const result = await controller.getSources();

      expect(result).toEqual([]);
    });

    it("throws InternalServerErrorException on service error", async () => {
      blogCollectionService.getActiveSources.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(controller.getSources()).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // =========================================================
  // POST /blog/collect
  // =========================================================

  describe("triggerCollection", () => {
    it("triggers collection for a specific source and returns the task", async () => {
      blogSchedulerService.triggerCollection.mockResolvedValue(mockTask);

      const result = await controller.triggerCollection({ sourceId: "src-1" });

      expect(result).toEqual(mockTask);
      expect(blogSchedulerService.triggerCollection).toHaveBeenCalledWith(
        "src-1",
      );
    });

    it("triggers global collection when no sourceId is provided", async () => {
      blogSchedulerService.triggerCollection.mockResolvedValue(mockTask);

      await controller.triggerCollection({});

      expect(blogSchedulerService.triggerCollection).toHaveBeenCalledWith(
        undefined,
      );
    });

    it("throws InternalServerErrorException on service error", async () => {
      blogSchedulerService.triggerCollection.mockRejectedValue(
        new Error("scheduler busy"),
      );

      await expect(controller.triggerCollection({})).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // =========================================================
  // GET /blog/stats
  // =========================================================

  describe("getStats", () => {
    it("merges collection stats with scheduler status", async () => {
      blogCollectionService.getCollectionStats.mockResolvedValue(mockStats);
      blogSchedulerService.getSchedulerStatus.mockReturnValue(
        mockSchedulerStatus,
      );

      const result = await controller.getStats();

      expect(result).toMatchObject({
        totalPosts: 200,
        collectionStatus: "active",
        activeTasks: 1,
        lastCollectionTime: mockSchedulerStatus.lastRun,
        nextCollectionTime: mockSchedulerStatus.nextRun,
      });
    });

    it("sets collectionStatus to inactive when scheduler is disabled", async () => {
      blogCollectionService.getCollectionStats.mockResolvedValue(mockStats);
      blogSchedulerService.getSchedulerStatus.mockReturnValue({
        ...mockSchedulerStatus,
        enabled: false,
      });

      const result = await controller.getStats();

      expect(result.collectionStatus).toBe("inactive");
    });

    it("throws InternalServerErrorException on service error", async () => {
      blogCollectionService.getCollectionStats.mockRejectedValue(
        new Error("DB error"),
      );
      blogSchedulerService.getSchedulerStatus.mockReturnValue(
        mockSchedulerStatus,
      );

      await expect(controller.getStats()).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // =========================================================
  // GET /blog/scheduler/status
  // =========================================================

  describe("getSchedulerStatus", () => {
    it("returns the scheduler status object", async () => {
      blogSchedulerService.getSchedulerStatus.mockReturnValue(
        mockSchedulerStatus,
      );

      const result = await controller.getSchedulerStatus();

      expect(result).toEqual(mockSchedulerStatus);
    });

    it("throws InternalServerErrorException when getSchedulerStatus throws", async () => {
      blogSchedulerService.getSchedulerStatus.mockImplementation(() => {
        throw new Error("internal error");
      });

      await expect(controller.getSchedulerStatus()).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // =========================================================
  // PUT /blog/scheduler/config
  // =========================================================

  describe("updateSchedulerConfig", () => {
    it("passes config to service and returns updated config", async () => {
      const updatedConfig: SchedulerConfig = {
        enabled: true,
        cronExpression: "0 */2 * * *",
        maxConcurrent: 5,
        activeTasks: 0,
      };
      blogSchedulerService.updateConfig.mockResolvedValue(updatedConfig);

      const result = await controller.updateSchedulerConfig({
        cronExpression: "0 */2 * * *",
        maxConcurrent: 5,
      });

      expect(result).toEqual(updatedConfig);
      expect(blogSchedulerService.updateConfig).toHaveBeenCalledWith({
        cronExpression: "0 */2 * * *",
        maxConcurrent: 5,
      });
    });

    it("throws InternalServerErrorException on service error", async () => {
      blogSchedulerService.updateConfig.mockRejectedValue(
        new Error("invalid cron"),
      );

      await expect(
        controller.updateSchedulerConfig({ cronExpression: "bad-cron" }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // =========================================================
  // GET /blog/tasks
  // =========================================================

  describe("getActiveTasks", () => {
    it("returns list of active tasks", async () => {
      blogSchedulerService.getActiveTasks.mockReturnValue([mockTask]);

      const result = await controller.getActiveTasks();

      expect(result).toEqual([mockTask]);
    });

    it("throws InternalServerErrorException when service throws", async () => {
      blogSchedulerService.getActiveTasks.mockImplementation(() => {
        throw new Error("queue error");
      });

      await expect(controller.getActiveTasks()).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // =========================================================
  // GET /blog/tasks/:taskId
  // =========================================================

  describe("getTaskDetail", () => {
    it("returns task details for a valid taskId", async () => {
      blogSchedulerService.getTaskDetail.mockReturnValue(mockTask);

      const result = await controller.getTaskDetail("task-1");

      expect(result).toEqual(mockTask);
      expect(blogSchedulerService.getTaskDetail).toHaveBeenCalledWith("task-1");
    });

    it("throws NotFoundException when task does not exist", async () => {
      blogSchedulerService.getTaskDetail.mockReturnValue(null);

      await expect(controller.getTaskDetail("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws InternalServerErrorException on unexpected error", async () => {
      blogSchedulerService.getTaskDetail.mockImplementation(() => {
        throw new Error("queue corrupted");
      });

      await expect(controller.getTaskDetail("task-1")).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // =========================================================
  // GET /blog/posts
  // =========================================================

  describe("getPosts", () => {
    it("returns paginated posts response with defaults", async () => {
      const result = await controller.getPosts(1, 20);

      expect(result).toEqual({ posts: [], total: 0, page: 1, limit: 20 });
    });

    it("returns response with custom page and limit", async () => {
      const result = await controller.getPosts(3, 10);

      expect(result).toMatchObject({ page: 3, limit: 10 });
    });
  });

  // =========================================================
  // GET /blog/search
  // =========================================================

  describe("searchPosts", () => {
    it("returns search results for a valid query", async () => {
      const result = await controller.searchPosts("kubernetes");

      expect(result).toEqual({ results: [], total: 0 });
    });

    it("throws BadRequestException when query is empty", async () => {
      await expect(
        controller.searchPosts(undefined as unknown as string),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================
  // POST /blog/posts/:postId/save
  // =========================================================

  describe("savePost", () => {
    it("returns success message", async () => {
      const result = await controller.savePost();

      expect(result).toEqual({ message: "Post saved successfully" });
    });
  });

  // =========================================================
  // GET /blog/saved
  // =========================================================

  describe("getSavedPosts", () => {
    it("returns empty saved posts list", async () => {
      const result = await controller.getSavedPosts();

      expect(result).toEqual({ posts: [], total: 0 });
    });
  });

  // =========================================================
  // POST /blog/scheduler/start
  // =========================================================

  describe("startScheduler", () => {
    it("enables the scheduler and returns updated config", async () => {
      const enabledConfig: SchedulerConfig = {
        enabled: true,
        cronExpression: "0 * * * *",
        maxConcurrent: 3,
        activeTasks: 0,
      };
      blogSchedulerService.updateConfig.mockResolvedValue(enabledConfig);

      const result = await controller.startScheduler();

      expect(result).toEqual(enabledConfig);
      expect(blogSchedulerService.updateConfig).toHaveBeenCalledWith({
        enabled: true,
      });
    });

    it("throws InternalServerErrorException on service error", async () => {
      blogSchedulerService.updateConfig.mockRejectedValue(
        new Error("scheduler error"),
      );

      await expect(controller.startScheduler()).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // =========================================================
  // POST /blog/scheduler/stop
  // =========================================================

  describe("stopScheduler", () => {
    it("disables the scheduler and returns updated config", async () => {
      const disabledConfig: SchedulerConfig = {
        enabled: false,
        cronExpression: "0 * * * *",
        maxConcurrent: 3,
        activeTasks: 0,
      };
      blogSchedulerService.updateConfig.mockResolvedValue(disabledConfig);

      const result = await controller.stopScheduler();

      expect(result).toEqual(disabledConfig);
      expect(blogSchedulerService.updateConfig).toHaveBeenCalledWith({
        enabled: false,
      });
    });

    it("throws InternalServerErrorException on service error", async () => {
      blogSchedulerService.updateConfig.mockRejectedValue(
        new Error("scheduler error"),
      );

      await expect(controller.stopScheduler()).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
