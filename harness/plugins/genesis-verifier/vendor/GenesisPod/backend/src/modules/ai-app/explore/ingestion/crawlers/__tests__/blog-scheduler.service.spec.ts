import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BlogSchedulerService } from "../blog-scheduler.service";
import { BlogCollectionService } from "../blog-collection.service";
import { CollectionTask } from "../blog-collection.types";

// ============================================================================
// Helpers
// ============================================================================

function makeCollectionServiceMock() {
  return {
    getActiveSources: jest.fn().mockResolvedValue([]),
    collectFromSource: jest.fn(),
  };
}

function makeConfigServiceMock(overrides: Record<string, unknown> = {}) {
  return {
    get: jest.fn().mockImplementation((key: string, defaultVal: unknown) => {
      const config: Record<string, unknown> = {
        BLOG_COLLECTION_ENABLED: false,
        BLOG_COLLECTION_CRON: "0 */6 * * *",
        BLOG_COLLECTION_MAX_CONCURRENT: 3,
        ...overrides,
      };
      return key in config ? config[key] : defaultVal;
    }),
  };
}

function makeTask(
  id: string,
  status: CollectionTask["status"] = "completed",
  endTime?: Date,
): CollectionTask {
  return {
    id,
    sourceId: `src-${id}`,
    sourceName: `Source ${id}`,
    status,
    postsCollected: 5,
    postsSaved: 3,
    retryCount: 0,
    endTime: endTime ?? new Date(),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("BlogSchedulerService", () => {
  let service: BlogSchedulerService;
  let collectionService: ReturnType<typeof makeCollectionServiceMock>;
  let configService: ReturnType<typeof makeConfigServiceMock>;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();

    collectionService = makeCollectionServiceMock();
    configService = makeConfigServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlogSchedulerService,
        { provide: ConfigService, useValue: configService },
        { provide: BlogCollectionService, useValue: collectionService },
      ],
    }).compile();

    service = module.get<BlogSchedulerService>(BlogSchedulerService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // onModuleInit / onModuleDestroy
  // --------------------------------------------------------------------------

  describe("onModuleInit", () => {
    it("does not start scheduler when BLOG_COLLECTION_ENABLED is false", async () => {
      const startSpy = jest.spyOn(service, "startScheduler");

      await service.onModuleInit();

      expect(startSpy).not.toHaveBeenCalled();
    });

    it("starts scheduler when BLOG_COLLECTION_ENABLED is true", async () => {
      configService = makeConfigServiceMock({ BLOG_COLLECTION_ENABLED: true });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          BlogSchedulerService,
          { provide: ConfigService, useValue: configService },
          { provide: BlogCollectionService, useValue: collectionService },
        ],
      }).compile();
      const enabledService =
        module.get<BlogSchedulerService>(BlogSchedulerService);

      const startSpy = jest
        .spyOn(enabledService, "startScheduler")
        .mockResolvedValue(undefined);

      await enabledService.onModuleInit();

      expect(startSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("onModuleDestroy", () => {
    it("calls stopScheduler on module destroy", async () => {
      const stopSpy = jest
        .spyOn(service, "stopScheduler")
        .mockResolvedValue(undefined);

      await service.onModuleDestroy();

      expect(stopSpy).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // startScheduler / stopScheduler
  // --------------------------------------------------------------------------

  describe("startScheduler", () => {
    it("handles missing node-cron gracefully (logs warning and returns)", async () => {
      // node-cron may or may not be installed; if it is, schedule is called.
      // We test that the method does NOT throw regardless.
      await expect(service.startScheduler()).resolves.not.toThrow();
    });
  });

  describe("stopScheduler", () => {
    it("does nothing when cronJob is null (scheduler never started)", async () => {
      await expect(service.stopScheduler()).resolves.not.toThrow();
    });

    it("stops and destroys an active cronJob", async () => {
      const mockStop = jest.fn();
      const mockDestroy = jest.fn();
      // Inject a fake cronJob directly
      (service as unknown as Record<string, unknown>)["cronJob"] = {
        stop: mockStop,
        destroy: mockDestroy,
      };

      await service.stopScheduler();

      expect(mockStop).toHaveBeenCalledTimes(1);
      expect(mockDestroy).toHaveBeenCalledTimes(1);
      expect(
        (service as unknown as Record<string, unknown>)["cronJob"],
      ).toBeNull();
    });

    it("sets enabled to false after stopping", async () => {
      (service as unknown as Record<string, unknown>)["cronJob"] = {
        stop: jest.fn(),
        destroy: jest.fn(),
      };

      await service.stopScheduler();

      const status = service.getSchedulerStatus();
      expect(status.enabled).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // triggerCollection
  // --------------------------------------------------------------------------

  describe("triggerCollection", () => {
    it("collects from a specific source when sourceId is provided", async () => {
      const task = makeTask("t-1");
      collectionService.collectFromSource.mockResolvedValue(task);

      const result = await service.triggerCollection("src-1");

      expect(collectionService.collectFromSource).toHaveBeenCalledWith("src-1");
      expect(result).toEqual(task);
    });

    it("stores the task in activeTasks after specific source collection", async () => {
      const task = makeTask("t-1");
      collectionService.collectFromSource.mockResolvedValue(task);

      await service.triggerCollection("src-1");

      expect(service.getTaskDetail("t-1")).toEqual(task);
    });

    it("triggers full collection cycle when no sourceId is provided", async () => {
      collectionService.getActiveSources.mockResolvedValue([
        { id: "src-1", name: "Source 1" },
        { id: "src-2", name: "Source 2" },
      ]);
      collectionService.collectFromSource.mockResolvedValue(makeTask("t-1"));

      const result = await service.triggerCollection();

      expect(collectionService.getActiveSources).toHaveBeenCalled();
      // result should be a CollectionTask object (the last active task or default)
      expect(result).toBeDefined();
      expect(typeof result.id).toBe("string");
    });

    it("returns empty-default task when no activeTasks after full cycle", async () => {
      collectionService.getActiveSources.mockResolvedValue([]);

      const result = await service.triggerCollection();

      expect(result.status).toBe("completed");
      expect(result.postsCollected).toBe(0);
    });

    it("re-throws when collectFromSource throws", async () => {
      collectionService.collectFromSource.mockRejectedValue(
        new Error("network failure"),
      );

      await expect(service.triggerCollection("src-1")).rejects.toThrow(
        "network failure",
      );
    });
  });

  // --------------------------------------------------------------------------
  // updateConfig
  // --------------------------------------------------------------------------

  describe("updateConfig", () => {
    it("updates maxConcurrent without restarting scheduler", async () => {
      const result = await service.updateConfig({ maxConcurrent: 5 });

      expect(result.maxConcurrent).toBe(5);
    });

    it("restarts scheduler when cronExpression is updated and scheduler is enabled", async () => {
      // Enable the scheduler in config state directly
      (service as unknown as Record<string, unknown>)["schedulerConfig"] = {
        ...(service as unknown as Record<string, unknown>)["schedulerConfig"],
        enabled: true,
      };

      const stopSpy = jest
        .spyOn(service, "stopScheduler")
        .mockResolvedValue(undefined);
      const startSpy = jest
        .spyOn(service, "startScheduler")
        .mockResolvedValue(undefined);

      await service.updateConfig({ cronExpression: "0 */12 * * *" });

      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(startSpy).toHaveBeenCalledTimes(1);
    });

    it("does not restart scheduler when cronExpression changes but scheduler is disabled", async () => {
      const stopSpy = jest.spyOn(service, "stopScheduler");
      const startSpy = jest.spyOn(service, "startScheduler");

      await service.updateConfig({ cronExpression: "0 */12 * * *" });

      expect(stopSpy).not.toHaveBeenCalled();
      expect(startSpy).not.toHaveBeenCalled();
    });

    it("starts scheduler when enabled is set to true and no cronJob running", async () => {
      const startSpy = jest
        .spyOn(service, "startScheduler")
        .mockResolvedValue(undefined);

      await service.updateConfig({ enabled: true });

      expect(startSpy).toHaveBeenCalledTimes(1);
    });

    it("stops scheduler when enabled is set to false and cronJob exists", async () => {
      // Inject a fake cronJob
      (service as unknown as Record<string, unknown>)["cronJob"] = {
        stop: jest.fn(),
        destroy: jest.fn(),
      };
      const stopSpy = jest
        .spyOn(service, "stopScheduler")
        .mockResolvedValue(undefined);

      await service.updateConfig({ enabled: false });

      expect(stopSpy).toHaveBeenCalledTimes(1);
    });

    it("returns updated config", async () => {
      const result = await service.updateConfig({ maxConcurrent: 10 });

      expect(result).toMatchObject({ maxConcurrent: 10 });
    });
  });

  // --------------------------------------------------------------------------
  // getSchedulerStatus
  // --------------------------------------------------------------------------

  describe("getSchedulerStatus", () => {
    it("returns scheduler config with tasks array", () => {
      const status = service.getSchedulerStatus();

      expect(status).toMatchObject({
        enabled: false,
        cronExpression: "0 */6 * * *",
        maxConcurrent: 3,
        tasks: expect.any(Array),
      });
    });

    it("returns at most 10 recent tasks", () => {
      // Add 15 tasks to activeTasks
      const map = (
        service as unknown as Record<string, Map<string, CollectionTask>>
      )["activeTasks"];
      for (let i = 0; i < 15; i++) {
        map.set(`t-${i}`, makeTask(`t-${i}`));
      }

      const status = service.getSchedulerStatus();

      expect(status.tasks.length).toBeLessThanOrEqual(10);
    });
  });

  // --------------------------------------------------------------------------
  // getActiveTasks / getTaskDetail
  // --------------------------------------------------------------------------

  describe("getActiveTasks", () => {
    it("returns all active tasks", () => {
      const map = (
        service as unknown as Record<string, Map<string, CollectionTask>>
      )["activeTasks"];
      map.set("t-1", makeTask("t-1"));
      map.set("t-2", makeTask("t-2"));

      const tasks = service.getActiveTasks();

      expect(tasks).toHaveLength(2);
    });

    it("returns empty array when no tasks", () => {
      expect(service.getActiveTasks()).toEqual([]);
    });
  });

  describe("getTaskDetail", () => {
    it("returns task by id", () => {
      const task = makeTask("t-42");
      (service as unknown as Record<string, Map<string, CollectionTask>>)[
        "activeTasks"
      ].set("t-42", task);

      expect(service.getTaskDetail("t-42")).toEqual(task);
    });

    it("returns null when task id not found", () => {
      expect(service.getTaskDetail("nonexistent")).toBeNull();
    });
  });
});
