import { Test, TestingModule } from "@nestjs/testing";
import { MonitorController } from "../monitor.controller";
import { MonitorService } from "../monitor.service";

describe("MonitorController", () => {
  let controller: MonitorController;
  let monitorService: jest.Mocked<MonitorService>;

  const mockTasks = [
    { id: "task-1", status: "RUNNING", sourceId: "src-1" },
    { id: "task-2", status: "RUNNING", sourceId: "src-2" },
  ];

  const mockMetrics = {
    cpuUsage: 45.2,
    memoryUsage: 1024,
    activeTasks: 2,
    queuedTasks: 5,
  };

  const mockTaskDetail = {
    id: "task-1",
    status: "RUNNING",
    progress: 65,
    logs: ["Step 1 done", "Step 2 in progress"],
  };

  const mockLogs = [
    { taskId: "task-1", message: "Processing...", timestamp: new Date() },
  ];

  const mockPerformance = {
    avgDuration: 45.3,
    successRate: 0.95,
    errorRate: 0.05,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MonitorController],
      providers: [
        {
          provide: MonitorService,
          useValue: {
            getRunningTasks: jest.fn().mockResolvedValue(mockTasks),
            getSystemMetrics: jest.fn().mockResolvedValue(mockMetrics),
            getTaskDetail: jest.fn().mockResolvedValue(mockTaskDetail),
            getRecentLogs: jest.fn().mockResolvedValue(mockLogs),
            getPerformanceMetrics: jest.fn().mockResolvedValue(mockPerformance),
          },
        },
      ],
    }).compile();

    controller = module.get<MonitorController>(MonitorController);
    monitorService = module.get(MonitorService);
  });

  describe("getRunningTasks", () => {
    it("should return all running tasks", async () => {
      const result = await controller.getRunningTasks();
      expect(monitorService.getRunningTasks).toHaveBeenCalled();
      expect(result).toBe(mockTasks);
    });
  });

  describe("getRunningTasksAlias", () => {
    it("should return same result as getRunningTasks", async () => {
      const result = await controller.getRunningTasksAlias();
      expect(monitorService.getRunningTasks).toHaveBeenCalled();
      expect(result).toBe(mockTasks);
    });
  });

  describe("getMetrics", () => {
    it("should return system metrics", async () => {
      const result = await controller.getMetrics();
      expect(monitorService.getSystemMetrics).toHaveBeenCalled();
      expect(result).toBe(mockMetrics);
    });
  });

  describe("getTaskDetail", () => {
    it("should return task detail by id", async () => {
      const result = await controller.getTaskDetail("task-1");
      expect(monitorService.getTaskDetail).toHaveBeenCalledWith("task-1");
      expect(result).toBe(mockTaskDetail);
    });
  });

  describe("getLogs", () => {
    it("should return all logs when no taskId provided", async () => {
      const result = await controller.getLogs();
      expect(monitorService.getRecentLogs).toHaveBeenCalledWith(undefined);
      expect(result).toBe(mockLogs);
    });

    it("should pass taskId filter to service", async () => {
      const result = await controller.getLogs("task-1");
      expect(monitorService.getRecentLogs).toHaveBeenCalledWith("task-1");
      expect(result).toBe(mockLogs);
    });
  });

  describe("getPerformance", () => {
    it("should return performance metrics with default 1 hour", async () => {
      const result = await controller.getPerformance();
      expect(monitorService.getPerformanceMetrics).toHaveBeenCalledWith(1);
      expect(result).toBe(mockPerformance);
    });

    it("should parse hours from query string", async () => {
      const result = await controller.getPerformance("24");
      expect(monitorService.getPerformanceMetrics).toHaveBeenCalledWith(24);
      expect(result).toBe(mockPerformance);
    });
  });
});
