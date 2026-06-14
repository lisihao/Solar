import { Test, TestingModule } from "@nestjs/testing";
import { ImportTaskProcessorService } from "../import-task-processor.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";
import { ImportTaskStatus } from "@prisma/client";

jest.mock("../../../../../../../common/prisma/prisma.service");

describe("ImportTaskProcessorService", () => {
  let service: ImportTaskProcessorService;
  let mockPrisma: {
    importTask: {
      findMany: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    resource: {
      findFirst: jest.Mock;
      create: jest.Mock;
    };
  };

  const mockPendingTask = {
    id: "task-1",
    sourceUrl: "https://arxiv.org/abs/1234",
    resourceType: "PAPER",
    status: ImportTaskStatus.PENDING,
    metadata: {
      title: "Deep Learning Research",
      abstract: "An abstract about deep learning",
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPendingTask2 = {
    id: "task-2",
    sourceUrl: "https://arxiv.org/abs/5678",
    resourceType: "PAPER",
    status: ImportTaskStatus.PENDING,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma = {
      importTask: {
        findMany: jest.fn().mockResolvedValue([mockPendingTask]),
        update: jest.fn().mockResolvedValue({
          ...mockPendingTask,
          status: ImportTaskStatus.SUCCESS,
        }),
        count: jest.fn().mockResolvedValue(0),
      },
      resource: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockResolvedValue({ id: "resource-1", title: "Test" }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportTaskProcessorService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ImportTaskProcessorService>(
      ImportTaskProcessorService,
    );
  });

  // =========================================================================
  // processPendingTasks
  // =========================================================================

  describe("processPendingTasks", () => {
    it("should return zero counts when no pending tasks", async () => {
      mockPrisma.importTask.findMany.mockResolvedValue([]);

      const result = await service.processPendingTasks();

      expect(result).toEqual({
        processed: 0,
        succeeded: 0,
        failed: 0,
        errors: [],
      });
    });

    it("should process pending tasks and return success count", async () => {
      const result = await service.processPendingTasks();

      expect(result.processed).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it("should create new resource when resource does not exist", async () => {
      mockPrisma.resource.findFirst.mockResolvedValue(null);

      await service.processPendingTasks();

      expect(mockPrisma.resource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "PAPER",
            title: "Deep Learning Research",
            abstract: "An abstract about deep learning",
            sourceUrl: "https://arxiv.org/abs/1234",
          }),
        }),
      );
    });

    it("should link existing resource when resource already exists", async () => {
      const existingResource = {
        id: "existing-resource-1",
        title: "Existing Resource",
        sourceUrl: "https://arxiv.org/abs/1234",
      };
      mockPrisma.resource.findFirst.mockResolvedValue(existingResource);

      await service.processPendingTasks();

      // Should NOT create new resource
      expect(mockPrisma.resource.create).not.toHaveBeenCalled();

      // Should update task with existing resource ID
      expect(mockPrisma.importTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resourceId: "existing-resource-1",
            status: ImportTaskStatus.SUCCESS,
          }),
        }),
      );
    });

    it("should use sourceUrl as title when metadata has no title", async () => {
      mockPrisma.importTask.findMany.mockResolvedValue([mockPendingTask2]);

      await service.processPendingTasks();

      expect(mockPrisma.resource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: mockPendingTask2.sourceUrl, // fallback to URL
          }),
        }),
      );
    });

    it("should handle null metadata gracefully", async () => {
      mockPrisma.importTask.findMany.mockResolvedValue([
        { ...mockPendingTask, metadata: null },
      ]);

      await service.processPendingTasks();

      expect(mockPrisma.resource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: mockPendingTask.sourceUrl,
            abstract: null,
          }),
        }),
      );
    });

    it("should handle array metadata gracefully", async () => {
      mockPrisma.importTask.findMany.mockResolvedValue([
        { ...mockPendingTask, metadata: ["array", "value"] },
      ]);

      await service.processPendingTasks();

      // Array metadata should be treated as empty object
      expect(mockPrisma.resource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: mockPendingTask.sourceUrl,
          }),
        }),
      );
    });

    it("should mark task as PROCESSING at start", async () => {
      await service.processPendingTasks();

      // First update should set to PROCESSING
      const firstUpdateCall = mockPrisma.importTask.update.mock.calls[0][0];
      expect(firstUpdateCall.data.status).toBe(ImportTaskStatus.PROCESSING);
      expect(firstUpdateCall.data.startedAt).toBeDefined();
    });

    it("should mark task as SUCCESS on completion", async () => {
      await service.processPendingTasks();

      // Find the SUCCESS update call
      const successCall = mockPrisma.importTask.update.mock.calls.find(
        (call) => call[0].data.status === ImportTaskStatus.SUCCESS,
      );
      expect(successCall).toBeDefined();
      expect(successCall[0].data.completedAt).toBeDefined();
      expect(successCall[0].data.itemsProcessed).toBe(1);
      expect(successCall[0].data.itemsSaved).toBe(1);
    });

    it("should handle task processing failure and mark as FAILED", async () => {
      // Make resource creation fail
      mockPrisma.resource.create.mockRejectedValue(
        new Error("DB constraint violation"),
      );

      const result = await service.processPendingTasks();

      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].taskId).toBe("task-1");
      expect(result.errors[0].error).toBeDefined();

      // Should update task to FAILED
      const failedCall = mockPrisma.importTask.update.mock.calls.find(
        (call) => call[0].data.status === ImportTaskStatus.FAILED,
      );
      expect(failedCall).toBeDefined();
      expect(failedCall[0].data.errorMessage).toBeDefined();
    });

    it("should continue processing other tasks when one fails", async () => {
      mockPrisma.importTask.findMany.mockResolvedValue([
        mockPendingTask,
        mockPendingTask2,
      ]);

      let callCount = 0;
      mockPrisma.resource.create.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error("First task fails");
        return { id: "resource-2" };
      });

      const result = await service.processPendingTasks();

      expect(result.processed).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.succeeded).toBe(1);
    });

    it("should handle update failure gracefully", async () => {
      // Make resource creation fail AND status update fail
      mockPrisma.resource.create.mockRejectedValue(new Error("Resource error"));
      mockPrisma.importTask.update.mockImplementation(async (args) => {
        if (args.data.status === ImportTaskStatus.FAILED) {
          throw new Error("Status update also failed");
        }
        return { ...mockPendingTask, status: ImportTaskStatus.PROCESSING };
      });

      // Should not throw even when both fail
      const result = await service.processPendingTasks();
      expect(result.failed).toBe(1);
    });

    it("should throw when query fails completely", async () => {
      mockPrisma.importTask.findMany.mockRejectedValue(
        new Error("DB connection lost"),
      );

      await expect(service.processPendingTasks()).rejects.toThrow(
        "DB connection lost",
      );
    });

    it("should throw when task lacks sourceUrl", async () => {
      mockPrisma.importTask.findMany.mockResolvedValue([
        { ...mockPendingTask, sourceUrl: "" },
      ]);

      const result = await service.processPendingTasks();
      expect(result.failed).toBe(1);
      expect(result.errors[0].error).toContain("Invalid task data");
    });

    it("should throw when task lacks resourceType", async () => {
      mockPrisma.importTask.findMany.mockResolvedValue([
        { ...mockPendingTask, resourceType: null },
      ]);

      const result = await service.processPendingTasks();
      expect(result.failed).toBe(1);
      expect(result.errors[0].error).toContain("Invalid task data");
    });

    it("should respect the limit parameter", async () => {
      await service.processPendingTasks(10);

      expect(mockPrisma.importTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          where: { status: ImportTaskStatus.PENDING },
          orderBy: { createdAt: "asc" },
        }),
      );
    });
  });

  // =========================================================================
  // getTaskStats
  // =========================================================================

  describe("getTaskStats", () => {
    it("should return correct counts for each status", async () => {
      mockPrisma.importTask.count
        .mockResolvedValueOnce(5) // pending
        .mockResolvedValueOnce(2) // processing
        .mockResolvedValueOnce(100) // success
        .mockResolvedValueOnce(10) // failed
        .mockResolvedValueOnce(117); // total

      const result = await service.getTaskStats();

      expect(result.pending).toBe(5);
      expect(result.processing).toBe(2);
      expect(result.success).toBe(100);
      expect(result.failed).toBe(10);
      expect(result.total).toBe(117);
    });

    it("should query each status separately", async () => {
      mockPrisma.importTask.count.mockResolvedValue(0);

      await service.getTaskStats();

      expect(mockPrisma.importTask.count).toHaveBeenCalledWith({
        where: { status: ImportTaskStatus.PENDING },
      });
      expect(mockPrisma.importTask.count).toHaveBeenCalledWith({
        where: { status: ImportTaskStatus.PROCESSING },
      });
      expect(mockPrisma.importTask.count).toHaveBeenCalledWith({
        where: { status: ImportTaskStatus.SUCCESS },
      });
      expect(mockPrisma.importTask.count).toHaveBeenCalledWith({
        where: { status: ImportTaskStatus.FAILED },
      });
      // Total query (no filter)
      expect(mockPrisma.importTask.count).toHaveBeenCalledWith();
    });

    it("should return zeros when no tasks", async () => {
      mockPrisma.importTask.count.mockResolvedValue(0);

      const result = await service.getTaskStats();

      expect(result.pending).toBe(0);
      expect(result.processing).toBe(0);
      expect(result.success).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.total).toBe(0);
    });
  });

  // =========================================================================
  // Metadata handling edge cases
  // =========================================================================

  describe("metadata handling", () => {
    it("should use description when abstract is not present", async () => {
      mockPrisma.importTask.findMany.mockResolvedValue([
        {
          ...mockPendingTask,
          metadata: { title: "Test Title", description: "A description" },
        },
      ]);

      await service.processPendingTasks();

      expect(mockPrisma.resource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            abstract: "A description",
          }),
        }),
      );
    });

    it("should set abstract to null when neither abstract nor description present", async () => {
      mockPrisma.importTask.findMany.mockResolvedValue([
        {
          ...mockPendingTask,
          metadata: { title: "Test Title" }, // No abstract or description
        },
      ]);

      await service.processPendingTasks();

      expect(mockPrisma.resource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            abstract: null,
          }),
        }),
      );
    });
  });
});
