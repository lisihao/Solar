import { Test, TestingModule } from "@nestjs/testing";
import {
  CollectionTaskService,
  CreateCollectionTaskDto,
} from "../collection-task.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ArxivService } from "../../crawlers/arxiv.service";
import { GithubService } from "../../crawlers/github.service";
import { HackernewsService } from "../../crawlers/hackernews.service";
import { RssService } from "../../crawlers/rss.service";
import { WebScraperService } from "../../crawlers/web-scraper.service";
import { NotFoundException } from "@nestjs/common";
import { CollectionTaskStatus, CollectionTaskType } from "@prisma/client";

describe("CollectionTaskService", () => {
  let service: CollectionTaskService;
  let prismaService: jest.Mocked<PrismaService>;
  let hackernewsService: jest.Mocked<HackernewsService>;
  let rssService: jest.Mocked<RssService>;
  let githubService: jest.Mocked<GithubService>;

  const mockDataSource = {
    id: "source-123",
    name: "HackerNews",
    type: "HACKERNEWS",
    baseUrl: "https://news.ycombinator.com",
    apiEndpoint: "/api",
    category: "tech",
    crawlerConfig: {},
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockTask = {
    id: "task-123",
    name: "Test Collection Task",
    description: "A test task",
    type: CollectionTaskType.SCHEDULED,
    sourceId: "source-123",
    source: mockDataSource,
    sourceConfig: { maxResults: 10 },
    schedule: "0 */6 * * *",
    priority: 5,
    maxConcurrency: 5,
    timeout: 300,
    retryCount: 3,
    deduplicationRules: {},
    status: CollectionTaskStatus.PENDING,
    progress: 0,
    currentStep: null,
    totalItems: 0,
    processedItems: 0,
    successItems: 0,
    failedItems: 0,
    duplicateItems: 0,
    skippedItems: 0,
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    nextRunAt: null,
    errorMessage: null,
    errorStack: null,
    warnings: null,
    resultSummary: null,
    logs: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: "user-123",
  };

  beforeEach(async () => {
    const mockPrismaService = {
      collectionTask: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      dataSource: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const mockArxivService = {
      fetchArxivPapers: jest.fn(),
    };

    const mockGithubService = {
      fetchTrendingRepos: jest.fn(),
    };

    const mockHackernewsService = {
      fetchTopStories: jest.fn(),
    };

    const mockRssService = {
      fetchRssFeed: jest.fn(),
    };

    const mockWebScraperService = {
      scrapeWebPage: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CollectionTaskService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ArxivService, useValue: mockArxivService },
        { provide: GithubService, useValue: mockGithubService },
        { provide: HackernewsService, useValue: mockHackernewsService },
        { provide: RssService, useValue: mockRssService },
        { provide: WebScraperService, useValue: mockWebScraperService },
      ],
    }).compile();

    service = module.get<CollectionTaskService>(CollectionTaskService);
    prismaService = module.get(PrismaService);
    hackernewsService = module.get(HackernewsService);
    rssService = module.get(RssService);
    githubService = module.get(GithubService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("create", () => {
    it("should create a new collection task", async () => {
      // Arrange
      const createDto: CreateCollectionTaskDto = {
        name: "New Task",
        description: "Task description",
        type: CollectionTaskType.MANUAL,
        sourceId: "source-123",
        sourceConfig: { maxResults: 20 },
        priority: 7,
      };
      (prismaService.collectionTask.create as jest.Mock).mockResolvedValue({
        ...mockTask,
        ...createDto,
        id: "new-task-id",
      });

      // Act
      const result = await service.create(createDto);

      // Assert
      expect(prismaService.collectionTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: createDto.name,
          description: createDto.description,
          type: createDto.type,
          sourceId: createDto.sourceId,
          sourceConfig: createDto.sourceConfig,
          priority: createDto.priority,
          status: "PENDING",
          progress: 0,
        }),
        include: { source: true },
      });
      expect(result.id).toBe("new-task-id");
    });

    it("should use default values for optional fields", async () => {
      // Arrange
      const createDto: CreateCollectionTaskDto = {
        name: "Minimal Task",
        type: CollectionTaskType.MANUAL,
        sourceId: "source-123",
        sourceConfig: {},
      };
      (prismaService.collectionTask.create as jest.Mock).mockResolvedValue({
        ...mockTask,
        ...createDto,
      });

      // Act
      await service.create(createDto);

      // Assert
      expect(prismaService.collectionTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          priority: 5,
          maxConcurrency: 5,
          timeout: 300,
          retryCount: 3,
        }),
        include: { source: true },
      });
    });
  });

  describe("findAll", () => {
    it("should return all tasks without filters", async () => {
      // Arrange
      (prismaService.collectionTask.findMany as jest.Mock).mockResolvedValue([
        mockTask,
      ]);

      // Act
      const result = await service.findAll();

      // Assert
      expect(prismaService.collectionTask.findMany).toHaveBeenCalledWith({
        where: {},
        include: { source: true },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        take: 100,
      });
      expect(result).toHaveLength(1);
    });

    it("should filter tasks by status", async () => {
      // Arrange
      (prismaService.collectionTask.findMany as jest.Mock).mockResolvedValue([
        mockTask,
      ]);

      // Act
      await service.findAll({ status: CollectionTaskStatus.RUNNING });

      // Assert
      expect(prismaService.collectionTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: CollectionTaskStatus.RUNNING },
        }),
      );
    });

    it("should filter tasks by type", async () => {
      // Arrange
      (prismaService.collectionTask.findMany as jest.Mock).mockResolvedValue([
        mockTask,
      ]);

      // Act
      await service.findAll({ type: CollectionTaskType.SCHEDULED });

      // Assert
      expect(prismaService.collectionTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { type: CollectionTaskType.SCHEDULED },
        }),
      );
    });

    it("should filter tasks by sourceId", async () => {
      // Arrange
      (prismaService.collectionTask.findMany as jest.Mock).mockResolvedValue([
        mockTask,
      ]);

      // Act
      await service.findAll({ sourceId: "source-123" });

      // Assert
      expect(prismaService.collectionTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sourceId: "source-123" },
        }),
      );
    });

    it("should respect limit parameter", async () => {
      // Arrange
      (prismaService.collectionTask.findMany as jest.Mock).mockResolvedValue([
        mockTask,
      ]);

      // Act
      await service.findAll({ limit: 50 });

      // Assert
      expect(prismaService.collectionTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
        }),
      );
    });
  });

  describe("findOne", () => {
    it("should return a task with related data", async () => {
      // Arrange
      const taskWithRelations = {
        ...mockTask,
        resources: [],
        deduplicationRecords: [],
      };
      (prismaService.collectionTask.findUnique as jest.Mock).mockResolvedValue(
        taskWithRelations,
      );

      // Act
      const result = await service.findOne("task-123");

      // Assert
      expect(prismaService.collectionTask.findUnique).toHaveBeenCalledWith({
        where: { id: "task-123" },
        include: {
          source: true,
          resources: { take: 10, orderBy: { createdAt: "desc" } },
          deduplicationRecords: { take: 10, orderBy: { createdAt: "desc" } },
        },
      });
      expect(result.id).toBe("task-123");
    });

    it("should throw NotFoundException if task not found", async () => {
      // Arrange
      (prismaService.collectionTask.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      // Act & Assert
      await expect(service.findOne("nonexistent-id")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("update", () => {
    it("should update an existing task", async () => {
      // Arrange
      const taskWithRelations = {
        ...mockTask,
        resources: [],
        deduplicationRecords: [],
      };
      (prismaService.collectionTask.findUnique as jest.Mock).mockResolvedValue(
        taskWithRelations,
      );
      (prismaService.collectionTask.update as jest.Mock).mockResolvedValue({
        ...mockTask,
        name: "Updated Task Name",
        priority: 8,
      });

      // Act
      const result = await service.update("task-123", {
        name: "Updated Task Name",
        priority: 8,
      });

      // Assert
      expect(prismaService.collectionTask.update).toHaveBeenCalledWith({
        where: { id: "task-123" },
        data: expect.objectContaining({
          name: "Updated Task Name",
          priority: 8,
        }),
        include: { source: true },
      });
      expect(result.name).toBe("Updated Task Name");
    });

    it("should throw NotFoundException if task not found", async () => {
      // Arrange
      (prismaService.collectionTask.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      // Act & Assert
      await expect(
        service.update("nonexistent-id", { name: "New Name" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("remove", () => {
    it("should delete an existing task", async () => {
      // Arrange
      const taskWithRelations = {
        ...mockTask,
        resources: [],
        deduplicationRecords: [],
      };
      (prismaService.collectionTask.findUnique as jest.Mock).mockResolvedValue(
        taskWithRelations,
      );
      (prismaService.collectionTask.delete as jest.Mock).mockResolvedValue(
        mockTask,
      );

      // Act
      await service.remove("task-123");

      // Assert
      expect(prismaService.collectionTask.delete).toHaveBeenCalledWith({
        where: { id: "task-123" },
      });
    });

    it("should throw NotFoundException if task not found", async () => {
      // Arrange
      (prismaService.collectionTask.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      // Act & Assert
      await expect(service.remove("nonexistent-id")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("execute", () => {
    beforeEach(() => {
      // Setup common mocks for execute tests
      const taskWithRelations = {
        ...mockTask,
        resources: [],
        deduplicationRecords: [],
      };
      (prismaService.collectionTask.findUnique as jest.Mock).mockResolvedValue(
        taskWithRelations,
      );
      (prismaService.collectionTask.update as jest.Mock).mockResolvedValue(
        mockTask,
      );
      (prismaService.dataSource.findUnique as jest.Mock).mockResolvedValue(
        mockDataSource,
      );
    });

    it("should execute HACKERNEWS collection successfully", async () => {
      // Arrange
      (hackernewsService.fetchTopStories as jest.Mock).mockResolvedValue(10);

      // Act
      await service.execute("task-123");

      // Assert
      expect(prismaService.collectionTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-123" },
          data: expect.objectContaining({
            status: "RUNNING",
            startedAt: expect.any(Date),
          }),
        }),
      );
      expect(hackernewsService.fetchTopStories).toHaveBeenCalledWith(10);
    });

    it("should execute RSS collection successfully", async () => {
      // Arrange
      const rssDataSource = {
        ...mockDataSource,
        type: "RSS",
        baseUrl: "https://example.com/feed",
      };
      (prismaService.dataSource.findUnique as jest.Mock).mockResolvedValue(
        rssDataSource,
      );
      (rssService.fetchRssFeed as jest.Mock).mockResolvedValue({
        success: 15,
        duplicates: 2,
      });

      // Act
      await service.execute("task-123");

      // Assert - 4th parameter is undefined for non-YouTube sources (no filterOptions)
      expect(rssService.fetchRssFeed).toHaveBeenCalledWith(
        "https://example.com/feed",
        10,
        "tech",
        undefined,
      );
    });

    it("should execute GITHUB collection successfully", async () => {
      // Arrange
      const githubDataSource = { ...mockDataSource, type: "GITHUB" };
      const taskConfig = {
        ...mockTask,
        sourceConfig: { language: "python", since: "weekly" },
      };
      const taskWithRelations = {
        ...taskConfig,
        resources: [],
        deduplicationRecords: [],
      };
      (prismaService.collectionTask.findUnique as jest.Mock).mockResolvedValue(
        taskWithRelations,
      );
      (prismaService.dataSource.findUnique as jest.Mock).mockResolvedValue(
        githubDataSource,
      );
      (githubService.fetchTrendingRepos as jest.Mock).mockResolvedValue(25);

      // Act
      await service.execute("task-123");

      // Assert
      expect(githubService.fetchTrendingRepos).toHaveBeenCalledWith(
        "python",
        "weekly",
      );
    });

    it("should handle unsupported source type gracefully", async () => {
      // Arrange
      const unsupportedDataSource = {
        ...mockDataSource,
        type: "UNSUPPORTED_TYPE",
      };
      (prismaService.dataSource.findUnique as jest.Mock).mockResolvedValue(
        unsupportedDataSource,
      );

      // Act - execute handles errors internally and marks task as failed
      await service.execute("task-123");

      // Assert - task should be marked as failed
      expect(prismaService.collectionTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "FAILED",
          }),
        }),
      );
    });

    it("should mark task as failed on error", async () => {
      // Arrange
      (hackernewsService.fetchTopStories as jest.Mock).mockRejectedValue(
        new Error("Network error"),
      );

      // Act
      await service.execute("task-123");

      // Assert
      expect(prismaService.collectionTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "FAILED",
            errorMessage: expect.stringContaining("Network error"),
          }),
        }),
      );
    });

    it("should update task progress during execution", async () => {
      // Arrange
      (hackernewsService.fetchTopStories as jest.Mock).mockResolvedValue(10);

      // Act
      await service.execute("task-123");

      // Assert - Check that progress was updated (at least initial RUNNING status)
      expect(prismaService.collectionTask.update).toHaveBeenCalled();
      // First call should set status to RUNNING
      expect(prismaService.collectionTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "RUNNING",
          }),
        }),
      );
    });
  });
});
