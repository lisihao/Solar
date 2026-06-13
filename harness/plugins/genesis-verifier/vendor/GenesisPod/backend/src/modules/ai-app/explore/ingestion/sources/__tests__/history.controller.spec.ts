import { Test, TestingModule } from "@nestjs/testing";
import { HistoryController } from "../history.controller";
import { HistoryService } from "../history.service";

describe("HistoryController", () => {
  let controller: HistoryController;
  let historyService: jest.Mocked<HistoryService>;

  const mockHistoryRecord = {
    id: "hist-1",
    taskId: "task-1",
    status: "COMPLETED",
    startedAt: new Date("2024-01-01"),
    completedAt: new Date("2024-01-01"),
  };

  const mockHistoryResult = {
    records: [mockHistoryRecord],
    total: 1,
  };

  const mockStats = {
    total: 100,
    completed: 85,
    failed: 10,
    pending: 5,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HistoryController],
      providers: [
        {
          provide: HistoryService,
          useValue: {
            getHistory: jest.fn().mockResolvedValue(mockHistoryResult),
            getStats: jest.fn().mockResolvedValue(mockStats),
            getTaskHistory: jest.fn().mockResolvedValue(mockHistoryRecord),
            deleteHistory: jest.fn().mockResolvedValue(undefined),
            cleanOldHistory: jest.fn().mockResolvedValue(15),
          },
        },
      ],
    }).compile();

    controller = module.get<HistoryController>(HistoryController);
    historyService = module.get(HistoryService);
  });

  describe("getHistory", () => {
    it("should return history records with default parameters", async () => {
      const result = await controller.getHistory();
      expect(historyService.getHistory).toHaveBeenCalledWith({
        status: undefined,
        sourceId: undefined,
        startDate: undefined,
        endDate: undefined,
        limit: undefined,
        offset: undefined,
      });
      expect(result).toEqual({
        data: mockHistoryResult.records,
        total: mockHistoryResult.total,
      });
    });

    it("should parse and pass all query params to service", async () => {
      const result = await controller.getHistory(
        "COMPLETED" as unknown as import("@prisma/client").CollectionTaskStatus,
        "source-1",
        "2024-01-01",
        "2024-12-31",
        "50",
        "10",
      );

      expect(historyService.getHistory).toHaveBeenCalledWith({
        status: "COMPLETED",
        sourceId: "source-1",
        startDate: new Date("2024-01-01"),
        endDate: new Date("2024-12-31"),
        limit: 50,
        offset: 10,
      });
      expect(result).toEqual({
        data: mockHistoryResult.records,
        total: mockHistoryResult.total,
      });
    });
  });

  describe("getStats", () => {
    it("should return history stats with default week period", async () => {
      const result = await controller.getStats();
      expect(historyService.getStats).toHaveBeenCalledWith("week");
      expect(result).toBe(mockStats);
    });

    it("should pass period to service", async () => {
      const result = await controller.getStats("month");
      expect(historyService.getStats).toHaveBeenCalledWith("month");
      expect(result).toBe(mockStats);
    });
  });

  describe("getTaskHistory", () => {
    it("should return history for a specific task", async () => {
      const result = await controller.getTaskHistory("task-1");
      expect(historyService.getTaskHistory).toHaveBeenCalledWith("task-1");
      expect(result).toBe(mockHistoryRecord);
    });
  });

  describe("deleteHistory", () => {
    it("should delete a history record", async () => {
      await controller.deleteHistory("hist-1");
      expect(historyService.deleteHistory).toHaveBeenCalledWith("hist-1");
    });
  });

  describe("cleanOldHistory", () => {
    it("should clean old history with default 30 days", async () => {
      const result = await controller.cleanOldHistory();
      expect(historyService.cleanOldHistory).toHaveBeenCalledWith(30);
      expect(result).toEqual({
        message: "Cleaned 15 old records",
        cleaned: 15,
      });
    });

    it("should pass custom days to service", async () => {
      const result = await controller.cleanOldHistory("7");
      expect(historyService.cleanOldHistory).toHaveBeenCalledWith(7);
      expect(result).toEqual({
        message: "Cleaned 15 old records",
        cleaned: 15,
      });
    });
  });
});
