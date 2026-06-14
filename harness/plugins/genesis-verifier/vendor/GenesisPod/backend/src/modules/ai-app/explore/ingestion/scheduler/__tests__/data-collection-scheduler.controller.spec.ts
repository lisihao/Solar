jest.mock(
  "@nestjs/cache-manager",
  () => ({
    CACHE_MANAGER: "CACHE_MANAGER",
    CacheModule: {
      registerAsync: jest.fn().mockReturnValue({ module: class {} }),
    },
  }),
  { virtual: true },
);

import { Test, TestingModule } from "@nestjs/testing";
import { DataCollectionSchedulerController } from "../data-collection-scheduler.controller";
import { DataCollectionSchedulerService } from "../data-collection-scheduler.service";
import {
  SchedulerStatus,
  TriggerResult,
  UpdateSchedulerConfigDto,
} from "../data-collection-scheduler.types";

describe("DataCollectionSchedulerController", () => {
  let controller: DataCollectionSchedulerController;
  let schedulerService: jest.Mocked<DataCollectionSchedulerService>;

  const mockStatus: SchedulerStatus = {
    isRunning: true,
    lastRun: new Date(),
    nextRun: new Date(),
    config: { intervalMinutes: 30 },
  } as unknown as SchedulerStatus;

  const mockTriggerResult: TriggerResult = {
    resourceType: "RSS",
    triggered: true,
    tasksCreated: 5,
  } as unknown as TriggerResult;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DataCollectionSchedulerController],
      providers: [
        {
          provide: DataCollectionSchedulerService,
          useValue: {
            getStatus: jest.fn().mockResolvedValue(mockStatus),
            executeCollectionForResourceType: jest
              .fn()
              .mockResolvedValue(mockTriggerResult),
            triggerAll: jest.fn().mockResolvedValue([mockTriggerResult]),
            updateConfig: jest.fn().mockResolvedValue(mockStatus),
            restartSchedulers: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    controller = module.get<DataCollectionSchedulerController>(
      DataCollectionSchedulerController,
    );
    schedulerService = module.get(DataCollectionSchedulerService);
  });

  describe("getStatus", () => {
    it("should return scheduler status", async () => {
      const result = await controller.getStatus();
      expect(schedulerService.getStatus).toHaveBeenCalled();
      expect(result).toBe(mockStatus);
    });
  });

  describe("triggerByType", () => {
    it("should trigger collection for a specific resource type", async () => {
      const result = await controller.triggerByType("RSS");
      expect(
        schedulerService.executeCollectionForResourceType,
      ).toHaveBeenCalledWith("RSS");
      expect(result).toBe(mockTriggerResult);
    });

    it("should handle different resource types", async () => {
      const webResult: TriggerResult = {
        resourceType: "WEB",
        triggered: true,
        tasksCreated: 3,
      } as unknown as TriggerResult;

      schedulerService.executeCollectionForResourceType.mockResolvedValue(
        webResult,
      );

      const result = await controller.triggerByType("WEB");
      expect(
        schedulerService.executeCollectionForResourceType,
      ).toHaveBeenCalledWith("WEB");
      expect(result).toBe(webResult);
    });
  });

  describe("triggerAll", () => {
    it("should trigger collection for all resource types", async () => {
      const result = await controller.triggerAll();
      expect(schedulerService.triggerAll).toHaveBeenCalled();
      expect(result).toEqual([mockTriggerResult]);
    });
  });

  describe("updateConfig", () => {
    it("should update scheduler config and return updated status", async () => {
      const dto: UpdateSchedulerConfigDto = {
        intervalMinutes: 60,
      } as unknown as UpdateSchedulerConfigDto;

      const result = await controller.updateConfig(dto);
      expect(schedulerService.updateConfig).toHaveBeenCalledWith(dto);
      expect(result).toBe(mockStatus);
    });
  });

  describe("restart", () => {
    it("should restart all schedulers and return success message", async () => {
      const result = await controller.restart();
      expect(schedulerService.restartSchedulers).toHaveBeenCalled();
      expect(result).toEqual({ message: "Schedulers restarted successfully" });
    });
  });
});
