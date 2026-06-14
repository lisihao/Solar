import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { DataCollectionSchedulerService } from "../data-collection-scheduler.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { SettingsService } from "../../../../../platform/settings/settings.service";
import { CollectionTaskService } from "../../sources/collection-task.service";

// Mock node-cron dynamic import
jest.mock(
  "node-cron",
  () => ({
    schedule: jest.fn().mockReturnValue({
      stop: jest.fn(),
      start: jest.fn(),
      destroy: jest.fn(),
    }),
  }),
  { virtual: true },
);

describe("DataCollectionSchedulerService", () => {
  let service: DataCollectionSchedulerService;
  let prismaService: any;
  let settingsService: any;
  let collectionTaskService: any;
  let _configService: any;

  const mockRule = {
    id: "rule-123",
    resourceType: "PAPER",
    isActive: true,
    cronExpression: "0 0 * * 0",
    maxConcurrent: 3,
    timeout: 300,
    lastExecutedAt: null,
    nextScheduledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockDataSource = {
    id: "source-123",
    name: "arXiv Papers",
    type: "ARXIV",
    category: "PAPER",
    status: "ACTIVE",
    crawlerConfig: { maxResults: 10 },
    baseUrl: "https://arxiv.org",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockTask = {
    id: "task-123",
    name: "Scheduled: arXiv Papers",
    type: "SCHEDULED",
    sourceId: "source-123",
    status: "PENDING",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockPrismaService = {
      collectionRule: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      dataSource: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };

    const mockSettingsService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };

    const mockCollectionTaskService = {
      create: jest.fn().mockResolvedValue(mockTask),
      execute: jest.fn().mockResolvedValue(undefined),
    };

    const mockConfigService = {
      get: jest
        .fn()
        .mockImplementation((key: string, defaultValue?: unknown) => {
          if (key === "DATA_COLLECTION_ENABLED") return false;
          if (key === "DATA_COLLECTION_INTERVAL") return "12h";
          if (key === "DATA_COLLECTION_TIMEZONE") return "Asia/Shanghai";
          return defaultValue;
        }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataCollectionSchedulerService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: CollectionTaskService, useValue: mockCollectionTaskService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<DataCollectionSchedulerService>(
      DataCollectionSchedulerService,
    );
    prismaService = module.get(PrismaService);
    settingsService = module.get(SettingsService);
    collectionTaskService = module.get(CollectionTaskService);
    _configService = module.get(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== onModuleInit ====================

  describe("onModuleInit", () => {
    it("should load config from DB during initialization", async () => {
      settingsService.get.mockResolvedValue(null);

      await service.onModuleInit();

      expect(settingsService.get).toHaveBeenCalledWith("scheduler.enabled");
      expect(settingsService.get).toHaveBeenCalledWith(
        "scheduler.default_interval",
      );
    });

    it("should override env config with DB config when available", async () => {
      settingsService.get.mockImplementation((key: string) => {
        if (key === "scheduler.enabled") return "true";
        if (key === "scheduler.default_interval") return "6h";
        return null;
      });

      // Should not throw
      await service.onModuleInit();

      expect(settingsService.get).toHaveBeenCalled();
    });

    it("should not initialize schedulers when disabled", async () => {
      settingsService.get.mockResolvedValue(null); // DB says null, use env default (false)

      await service.onModuleInit();

      // Scheduler is disabled, so collectionRule.findMany should not be called for scheduling
      expect(collectionTaskService.create).not.toHaveBeenCalled();
    });

    it("should handle DB config load failure gracefully", async () => {
      settingsService.get.mockRejectedValue(new Error("DB unavailable"));

      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });

  // ==================== onModuleDestroy ====================

  describe("onModuleDestroy", () => {
    it("should stop all schedulers on destroy", async () => {
      await service.onModuleDestroy();

      // Even if no jobs are running, should not throw
      expect(prismaService.collectionRule.findMany).not.toHaveBeenCalled();
    });
  });

  // ==================== executeCollectionForResourceType ====================

  describe("executeCollectionForResourceType", () => {
    beforeEach(() => {
      prismaService.dataSource.findMany.mockResolvedValue([mockDataSource]);
      prismaService.collectionRule.findFirst.mockResolvedValue(mockRule);
      prismaService.collectionRule.updateMany.mockResolvedValue({ count: 1 });
      collectionTaskService.create.mockResolvedValue(mockTask);
      collectionTaskService.execute.mockResolvedValue(undefined);
    });

    it("should execute collection for a resource type", async () => {
      const result = await service.executeCollectionForResourceType("PAPER");

      expect(result.resourceType).toBe("PAPER");
      expect(result.success).toBe(true);
      expect(result.taskIds).toBeDefined();
    });

    it("should return early when collection is already running", async () => {
      // Start first execution (keep it pending)
      const firstExecution = service.executeCollectionForResourceType("PAPER");

      // Immediately try a second execution
      const result = await service.executeCollectionForResourceType("PAPER");

      // Second call should be rejected (already running)
      expect(result.success).toBe(false);
      expect(result.message).toContain("already running");

      await firstExecution;
    });

    it("should return success with empty taskIds when no active data sources", async () => {
      prismaService.dataSource.findMany.mockResolvedValue([]);

      const result = await service.executeCollectionForResourceType("BLOG");

      expect(result.success).toBe(true);
      expect(result.taskIds).toEqual([]);
      expect(result.message).toContain("No active data sources");
    });

    it("should create collection tasks for each active data source", async () => {
      const result = await service.executeCollectionForResourceType("PAPER");

      expect(collectionTaskService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.stringContaining("arXiv Papers"),
          type: "SCHEDULED",
          sourceId: "source-123",
        }),
      );
      expect(result.taskIds).toContain("task-123");
    });

    it("should update lastExecutedAt after successful collection", async () => {
      await service.executeCollectionForResourceType("PAPER");

      expect(prismaService.collectionRule.updateMany).toHaveBeenCalledWith({
        where: { resourceType: "PAPER" },
        data: { lastExecutedAt: expect.any(Date) },
      });
    });

    it("should handle task creation failure gracefully", async () => {
      collectionTaskService.create.mockRejectedValue(
        new Error("Task creation failed"),
      );

      const result = await service.executeCollectionForResourceType("PAPER");

      // Task creation failed, but overall collection returns success (empty taskIds)
      expect(result.success).toBe(true);
      expect(result.taskIds).toHaveLength(0);
    });

    it("should use maxConcurrent from rule when available", async () => {
      const ruleWithConcurrency = { ...mockRule, maxConcurrent: 5 };
      prismaService.collectionRule.findFirst.mockResolvedValue(
        ruleWithConcurrency,
      );

      const manyDataSources = Array.from({ length: 10 }, (_, i) => ({
        ...mockDataSource,
        id: `source-${i}`,
        name: `Source ${i}`,
      }));
      prismaService.dataSource.findMany.mockResolvedValue(manyDataSources);

      const result = await service.executeCollectionForResourceType("PAPER");

      // Should process all 10 sources in chunks of 5
      expect(collectionTaskService.create).toHaveBeenCalledTimes(10);
      expect(result.taskIds).toHaveLength(10);
    });

    it("should return failure when data source lookup throws", async () => {
      prismaService.dataSource.findMany.mockRejectedValue(
        new Error("DB connection failed"),
      );

      const result = await service.executeCollectionForResourceType("NEWS");

      expect(result.success).toBe(false);
      expect(result.message).toContain("DB connection failed");
    });

    it("should remove resource type from running set after completion", async () => {
      await service.executeCollectionForResourceType("PAPER");

      // After completion, should be able to run again
      const secondResult =
        await service.executeCollectionForResourceType("PAPER");

      expect(secondResult.message).not.toContain("already running");
    });
  });

  // ==================== getStatus ====================

  describe("getStatus", () => {
    it("should return scheduler status with active rules", async () => {
      prismaService.collectionRule.findMany.mockResolvedValue([mockRule]);
      prismaService.dataSource.groupBy.mockResolvedValue([
        { category: "PAPER", _count: 5 },
      ]);

      const status = await service.getStatus();

      expect(status).toMatchObject({
        enabled: false,
        defaultInterval: "12h",
        timezone: "Asia/Shanghai",
        schedulers: expect.any(Array),
        activeExecutions: expect.any(Number),
      });
      expect(status.schedulers).toHaveLength(1);
    });

    it("should return empty schedulers when no active rules", async () => {
      prismaService.collectionRule.findMany.mockResolvedValue([]);
      prismaService.dataSource.groupBy.mockResolvedValue([]);

      const status = await service.getStatus();

      expect(status.schedulers).toHaveLength(0);
      expect(status.activeExecutions).toBe(0);
    });

    it("should include activeSourceCount from groupBy query", async () => {
      prismaService.collectionRule.findMany.mockResolvedValue([mockRule]);
      prismaService.dataSource.groupBy.mockResolvedValue([
        { category: "PAPER", _count: 7 },
      ]);

      const status = await service.getStatus();

      expect(status.schedulers[0].activeSourceCount).toBe(7);
    });

    it("should show 0 activeSourceCount when no data sources", async () => {
      prismaService.collectionRule.findMany.mockResolvedValue([mockRule]);
      prismaService.dataSource.groupBy.mockResolvedValue([]);

      const status = await service.getStatus();

      expect(status.schedulers[0].activeSourceCount).toBe(0);
    });
  });

  // ==================== triggerAll ====================

  describe("triggerAll", () => {
    it("should trigger collection for all active rules", async () => {
      const rules = [
        { ...mockRule, resourceType: "PAPER" },
        { ...mockRule, id: "rule-456", resourceType: "NEWS" },
      ];
      prismaService.collectionRule.findMany.mockResolvedValue(rules);
      prismaService.dataSource.findMany.mockResolvedValue([]);
      prismaService.collectionRule.findFirst.mockResolvedValue(null);

      const results = await service.triggerAll();

      expect(results).toHaveLength(2);
      expect(results[0].resourceType).toBe("PAPER");
      expect(results[1].resourceType).toBe("NEWS");
    });

    it("should return empty array when no active rules", async () => {
      prismaService.collectionRule.findMany.mockResolvedValue([]);

      const results = await service.triggerAll();

      expect(results).toEqual([]);
    });

    it("should return results for each resource type", async () => {
      prismaService.collectionRule.findMany.mockResolvedValue([mockRule]);
      prismaService.dataSource.findMany.mockResolvedValue([mockDataSource]);
      prismaService.collectionRule.findFirst.mockResolvedValue(mockRule);
      prismaService.collectionRule.updateMany.mockResolvedValue({ count: 1 });

      const results = await service.triggerAll();

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
    });
  });

  // ==================== updateConfig ====================

  describe("updateConfig", () => {
    beforeEach(() => {
      prismaService.collectionRule.findMany.mockResolvedValue([]);
      prismaService.dataSource.groupBy.mockResolvedValue([]);
      prismaService.collectionRule.updateMany.mockResolvedValue({ count: 0 });
    });

    it("should update enabled setting", async () => {
      await service.updateConfig({ enabled: true });

      expect(settingsService.set).toHaveBeenCalledWith(
        "scheduler.enabled",
        "true",
        expect.objectContaining({ category: "scheduler" }),
      );
    });

    it("should update defaultInterval setting", async () => {
      prismaService.collectionRule.updateMany.mockResolvedValue({ count: 2 });

      await service.updateConfig({ defaultInterval: "6h" });

      expect(settingsService.set).toHaveBeenCalledWith(
        "scheduler.default_interval",
        "6h",
        expect.objectContaining({ category: "scheduler" }),
      );
    });

    it("should update CollectionRule cron expressions when interval changes", async () => {
      await service.updateConfig({ defaultInterval: "24h" });

      expect(prismaService.collectionRule.updateMany).toHaveBeenCalledWith({
        where: { isActive: true },
        data: { cronExpression: "0 0 * * *" }, // INTERVAL_TO_CRON["24h"]
      });
    });

    it("should use fallback cron for unknown interval", async () => {
      await service.updateConfig({
        defaultInterval: "48h" as "6h" | "12h" | "24h",
      });

      expect(prismaService.collectionRule.updateMany).toHaveBeenCalledWith({
        where: { isActive: true },
        data: { cronExpression: "0 */12 * * *" }, // fallback
      });
    });

    it("should return current status after update", async () => {
      const status = await service.updateConfig({ enabled: false });

      expect(status).toHaveProperty("enabled");
      expect(status).toHaveProperty("schedulers");
    });
  });

  // ==================== stopAllSchedulers ====================

  describe("stopAllSchedulers", () => {
    it("should stop all active cron jobs", async () => {
      await service.stopAllSchedulers();

      // With no jobs running, should complete without error
      expect(prismaService.collectionRule.findMany).not.toHaveBeenCalled();
    });
  });

  // ==================== Default cron expressions ====================

  describe("default cron expressions", () => {
    it("should return correct cron for 6h interval", async () => {
      await service.updateConfig({ defaultInterval: "6h" });

      expect(prismaService.collectionRule.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { cronExpression: "0 */6 * * *" },
        }),
      );
    });

    it("should return correct cron for 12h interval", async () => {
      await service.updateConfig({ defaultInterval: "12h" });

      expect(prismaService.collectionRule.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { cronExpression: "0 */12 * * *" },
        }),
      );
    });

    it("should return correct cron for 24h interval", async () => {
      await service.updateConfig({ defaultInterval: "24h" });

      expect(prismaService.collectionRule.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { cronExpression: "0 0 * * *" },
        }),
      );
    });
  });

  // ==================== Chunk array utility ====================

  describe("collection chunking", () => {
    it("should process data sources in chunks based on maxConcurrent", async () => {
      const ruleWithSmallConcurrency = { ...mockRule, maxConcurrent: 2 };
      prismaService.collectionRule.findFirst.mockResolvedValue(
        ruleWithSmallConcurrency,
      );

      const fiveDataSources = Array.from({ length: 5 }, (_, i) => ({
        ...mockDataSource,
        id: `source-${i}`,
        name: `Source ${i}`,
      }));
      prismaService.dataSource.findMany.mockResolvedValue(fiveDataSources);
      prismaService.collectionRule.updateMany.mockResolvedValue({ count: 1 });

      // Tasks
      collectionTaskService.create
        .mockResolvedValueOnce({ id: "task-0" })
        .mockResolvedValueOnce({ id: "task-1" })
        .mockResolvedValueOnce({ id: "task-2" })
        .mockResolvedValueOnce({ id: "task-3" })
        .mockResolvedValueOnce({ id: "task-4" });

      const result = await service.executeCollectionForResourceType("PAPER");

      expect(result.taskIds).toHaveLength(5);
    });
  });
});
