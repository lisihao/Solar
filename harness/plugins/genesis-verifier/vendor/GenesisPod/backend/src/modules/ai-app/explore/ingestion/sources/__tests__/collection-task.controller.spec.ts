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
import { CollectionTaskController } from "../collection-task.controller";
import {
  CollectionTaskService,
  CreateCollectionTaskDto,
  UpdateCollectionTaskDto,
} from "../collection-task.service";

describe("CollectionTaskController", () => {
  let controller: CollectionTaskController;
  let taskService: jest.Mocked<CollectionTaskService>;

  const mockTask = {
    id: "task-1",
    status: "PENDING",
    type: "RSS",
    sourceId: "source-1",
    createdAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CollectionTaskController],
      providers: [
        {
          provide: CollectionTaskService,
          useValue: {
            create: jest.fn().mockResolvedValue(mockTask),
            findAll: jest.fn().mockResolvedValue([mockTask]),
            getRunningTasks: jest.fn().mockResolvedValue([mockTask]),
            getPendingTasks: jest.fn().mockResolvedValue([mockTask]),
            findOne: jest.fn().mockResolvedValue(mockTask),
            update: jest.fn().mockResolvedValue(mockTask),
            remove: jest.fn().mockResolvedValue(undefined),
            execute: jest.fn().mockResolvedValue(undefined),
            pause: jest
              .fn()
              .mockResolvedValue({ ...mockTask, status: "PAUSED" }),
            resume: jest
              .fn()
              .mockResolvedValue({ ...mockTask, status: "RUNNING" }),
            cancel: jest
              .fn()
              .mockResolvedValue({ ...mockTask, status: "CANCELLED" }),
          },
        },
      ],
    }).compile();

    controller = module.get<CollectionTaskController>(CollectionTaskController);
    taskService = module.get(CollectionTaskService);
  });

  describe("create", () => {
    it("should create a task and return it", async () => {
      const dto: CreateCollectionTaskDto = {
        type: "RSS",
        sourceId: "source-1",
      } as unknown as CreateCollectionTaskDto;

      const result = await controller.create(dto);
      expect(taskService.create).toHaveBeenCalledWith(dto);
      expect(result).toBe(mockTask);
    });
  });

  describe("findAll", () => {
    it("should return all tasks with metadata", async () => {
      const result = await controller.findAll();
      expect(taskService.findAll).toHaveBeenCalledWith({
        status: undefined,
        type: undefined,
        sourceId: undefined,
        limit: undefined,
      });
      expect(result).toEqual({ data: [mockTask], total: 1 });
    });

    it("should pass filters and parsed limit to service", async () => {
      taskService.findAll.mockResolvedValue([]);
      const result = await controller.findAll(
        "PENDING" as unknown as import("@prisma/client").CollectionTaskStatus,
        "RSS" as unknown as import("@prisma/client").CollectionTaskType,
        "source-2",
        "10",
      );
      expect(taskService.findAll).toHaveBeenCalledWith({
        status: "PENDING",
        type: "RSS",
        sourceId: "source-2",
        limit: 10,
      });
      expect(result).toEqual({ data: [], total: 0 });
    });
  });

  describe("getRunning", () => {
    it("should return running tasks", async () => {
      const result = await controller.getRunning();
      expect(taskService.getRunningTasks).toHaveBeenCalled();
      expect(result).toEqual({ data: [mockTask], total: 1 });
    });
  });

  describe("getPending", () => {
    it("should return pending tasks", async () => {
      const result = await controller.getPending();
      expect(taskService.getPendingTasks).toHaveBeenCalled();
      expect(result).toEqual({ data: [mockTask], total: 1 });
    });
  });

  describe("findOne", () => {
    it("should return a single task by id", async () => {
      const result = await controller.findOne("task-1");
      expect(taskService.findOne).toHaveBeenCalledWith("task-1");
      expect(result).toBe(mockTask);
    });
  });

  describe("update", () => {
    it("should update a task and return it", async () => {
      const dto: UpdateCollectionTaskDto = {
        status: "COMPLETED",
      } as unknown as UpdateCollectionTaskDto;

      const result = await controller.update("task-1", dto);
      expect(taskService.update).toHaveBeenCalledWith("task-1", dto);
      expect(result).toBe(mockTask);
    });
  });

  describe("remove", () => {
    it("should remove a task", async () => {
      await controller.remove("task-1");
      expect(taskService.remove).toHaveBeenCalledWith("task-1");
    });
  });

  describe("execute", () => {
    it("should start task execution asynchronously and return message", async () => {
      jest.useFakeTimers({ legacyFakeTimers: true });

      const result = await controller.execute("task-1");

      expect(taskService.findOne).toHaveBeenCalledWith("task-1");
      expect(result).toEqual({ message: "Task execution started" });

      jest.runAllImmediates();
      expect(taskService.execute).toHaveBeenCalledWith("task-1");

      jest.useRealTimers();
    });

    it("should log error when execute fails in background", async () => {
      jest.useFakeTimers({ legacyFakeTimers: true });

      taskService.execute.mockRejectedValue(new Error("exec failed"));

      await controller.execute("task-1");

      jest.runAllImmediates();

      // Allow promise microtasks to settle
      await Promise.resolve();

      jest.useRealTimers();
    });
  });

  describe("pause", () => {
    it("should pause a task and return updated task", async () => {
      const result = await controller.pause("task-1");
      expect(taskService.pause).toHaveBeenCalledWith("task-1");
      expect(result).toEqual({ ...mockTask, status: "PAUSED" });
    });
  });

  describe("resume", () => {
    it("should resume a task and return updated task", async () => {
      const result = await controller.resume("task-1");
      expect(taskService.resume).toHaveBeenCalledWith("task-1");
      expect(result).toEqual({ ...mockTask, status: "RUNNING" });
    });
  });

  describe("cancel", () => {
    it("should cancel a task and return updated task", async () => {
      const result = await controller.cancel("task-1");
      expect(taskService.cancel).toHaveBeenCalledWith("task-1");
      expect(result).toEqual({ ...mockTask, status: "CANCELLED" });
    });
  });
});
