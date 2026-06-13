import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { ReviewWorkflowService } from "../review-workflow.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ReviewTaskStatus } from "@prisma/client";

const mockPrisma = {
  topicReport: {
    findUnique: jest.fn(),
  },
  reviewTask: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
};

const mockReport = {
  id: "report-1",
  topicId: "topic-1",
  version: 1,
  dimensionAnalyses: [
    {
      dimensionId: "dim-1",
      dimension: { id: "dim-1", name: "Market Analysis", sortOrder: 1 },
    },
    {
      dimensionId: "dim-2",
      dimension: { id: "dim-2", name: "Competitor Analysis", sortOrder: 2 },
    },
  ],
};

describe("ReviewWorkflowService", () => {
  let service: ReviewWorkflowService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewWorkflowService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ReviewWorkflowService>(ReviewWorkflowService);
    jest.clearAllMocks();
  });

  describe("createReviewTasksForReport", () => {
    it("should create tasks for executive summary and all dimensions", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(mockReport);
      mockPrisma.reviewTask.create
        .mockResolvedValueOnce({ id: "task-0", sectionName: "执行摘要" })
        .mockResolvedValueOnce({ id: "task-1", sectionName: "Market Analysis" })
        .mockResolvedValueOnce({
          id: "task-2",
          sectionName: "Competitor Analysis",
        });

      const result = await service.createReviewTasksForReport(
        "report-1",
        "user-1",
      );

      expect(result.created).toBe(3);
      expect(result.tasks[0].sectionName).toBe("执行摘要");
      expect(mockPrisma.reviewTask.create).toHaveBeenCalledTimes(3);
    });

    it("should throw NotFoundException when report not found", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(null);

      await expect(
        service.createReviewTasksForReport("bad-report", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should create tasks with PENDING status", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue({
        ...mockReport,
        dimensionAnalyses: [],
      });
      mockPrisma.reviewTask.create.mockResolvedValue({
        id: "task-0",
        sectionName: "执行摘要",
      });

      await service.createReviewTasksForReport("report-1", "user-1");

      expect(mockPrisma.reviewTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ReviewTaskStatus.PENDING }),
        }),
      );
    });
  });

  describe("getReviewTasks", () => {
    it("should return tasks ordered by sectionOrder", async () => {
      const mockTasks = [
        { id: "t1", sectionOrder: 0, sectionName: "Summary", assignee: null },
        { id: "t2", sectionOrder: 1, sectionName: "Market", assignee: null },
      ];
      mockPrisma.reviewTask.findMany.mockResolvedValue(mockTasks);

      const result = await service.getReviewTasks("report-1");

      expect(result).toHaveLength(2);
      expect(mockPrisma.reviewTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { reportId: "report-1" } }),
      );
    });
  });

  describe("assignTask", () => {
    it("should update task to IN_PROGRESS with assignee info", async () => {
      const updatedTask = {
        id: "t1",
        status: ReviewTaskStatus.IN_PROGRESS,
        assigneeId: "user-2",
      };
      mockPrisma.reviewTask.update.mockResolvedValue(updatedTask);

      const result = await service.assignTask(
        { taskId: "t1", assigneeId: "user-2", assigneeName: "Jane Doe" },
        "user-1",
      );

      expect(result.status).toBe(ReviewTaskStatus.IN_PROGRESS);
      expect(mockPrisma.reviewTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ReviewTaskStatus.IN_PROGRESS,
            assigneeId: "user-2",
          }),
        }),
      );
    });
  });

  describe("assignTasksBatch", () => {
    it("should assign multiple tasks in parallel", async () => {
      mockPrisma.reviewTask.update.mockResolvedValue({
        id: "t1",
        status: ReviewTaskStatus.IN_PROGRESS,
      });

      const result = await service.assignTasksBatch(
        [
          { taskId: "t1", assigneeId: "u1", assigneeName: "User 1" },
          { taskId: "t2", assigneeId: "u2", assigneeName: "User 2" },
        ],
        "admin-1",
      );

      expect(result.assigned).toBe(2);
      expect(mockPrisma.reviewTask.update).toHaveBeenCalledTimes(2);
    });
  });

  describe("startTask", () => {
    it("should set status to IN_PROGRESS for assigned task", async () => {
      mockPrisma.reviewTask.findUnique.mockResolvedValue({
        id: "t1",
        assigneeId: "user-1",
        status: ReviewTaskStatus.PENDING,
      });
      mockPrisma.reviewTask.update.mockResolvedValue({
        id: "t1",
        status: ReviewTaskStatus.IN_PROGRESS,
      });

      const result = await service.startTask("t1", "user-1");

      expect(mockPrisma.reviewTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ReviewTaskStatus.IN_PROGRESS,
          }),
        }),
      );
      expect(result.status).toBe(ReviewTaskStatus.IN_PROGRESS);
    });

    it("should auto-assign and start for unassigned task", async () => {
      mockPrisma.reviewTask.findUnique.mockResolvedValue({
        id: "t1",
        assigneeId: null,
        status: ReviewTaskStatus.PENDING,
      });
      mockPrisma.user.findUnique.mockResolvedValue({ fullName: "John Doe" });
      mockPrisma.reviewTask.update.mockResolvedValue({
        id: "t1",
        status: ReviewTaskStatus.IN_PROGRESS,
      });

      await service.startTask("t1", "user-1");

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "user-1" } }),
      );
      expect(mockPrisma.reviewTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assigneeId: "user-1",
            assigneeName: "John Doe",
          }),
        }),
      );
    });

    it("should throw NotFoundException when task not found", async () => {
      mockPrisma.reviewTask.findUnique.mockResolvedValue(null);

      await expect(service.startTask("bad-task", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("completeTask", () => {
    it("should set COMPLETED status with approval info", async () => {
      mockPrisma.reviewTask.findUnique.mockResolvedValue({
        id: "t1",
        status: ReviewTaskStatus.IN_PROGRESS,
      });
      mockPrisma.reviewTask.update.mockResolvedValue({
        id: "t1",
        status: ReviewTaskStatus.COMPLETED,
        approved: true,
        score: 90,
      });

      const result = await service.completeTask(
        { taskId: "t1", approved: true, score: 90, comments: "Excellent work" },
        "user-1",
      );

      expect(result.status).toBe(ReviewTaskStatus.COMPLETED);
      expect(mockPrisma.reviewTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ReviewTaskStatus.COMPLETED,
            approved: true,
            score: 90,
          }),
        }),
      );
    });

    it("should throw NotFoundException for missing task", async () => {
      mockPrisma.reviewTask.findUnique.mockResolvedValue(null);

      await expect(
        service.completeTask({ taskId: "bad", approved: true }, "user-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("skipTask", () => {
    it("should set status to SKIPPED with reason", async () => {
      mockPrisma.reviewTask.update.mockResolvedValue({
        id: "t1",
        status: ReviewTaskStatus.SKIPPED,
      });

      await service.skipTask("t1", "Not relevant");

      expect(mockPrisma.reviewTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ReviewTaskStatus.SKIPPED,
            comments: "Not relevant",
          }),
        }),
      );
    });
  });

  describe("getTaskStats", () => {
    it("should calculate stats correctly", async () => {
      mockPrisma.reviewTask.findMany.mockResolvedValue([
        { status: ReviewTaskStatus.PENDING, approved: null, score: null },
        { status: ReviewTaskStatus.IN_PROGRESS, approved: null, score: null },
        { status: ReviewTaskStatus.COMPLETED, approved: true, score: 85 },
        { status: ReviewTaskStatus.COMPLETED, approved: false, score: 40 },
        { status: ReviewTaskStatus.SKIPPED, approved: null, score: null },
      ]);

      const stats = await service.getTaskStats("report-1");

      expect(stats.total).toBe(5);
      expect(stats.pending).toBe(1);
      expect(stats.inProgress).toBe(1);
      expect(stats.completed).toBe(2);
      expect(stats.approved).toBe(1);
      expect(stats.rejected).toBe(1);
      expect(stats.averageScore).toBe(63); // Math.round((85+40)/2)
    });

    it("should return null averageScore when no tasks have scores", async () => {
      mockPrisma.reviewTask.findMany.mockResolvedValue([
        { status: ReviewTaskStatus.PENDING, approved: null, score: null },
      ]);

      const stats = await service.getTaskStats("report-1");

      expect(stats.averageScore).toBeNull();
    });
  });

  describe("canPublishReport", () => {
    it("should return canPublish false when pending tasks exist", async () => {
      mockPrisma.reviewTask.findMany.mockResolvedValue([
        { status: ReviewTaskStatus.PENDING, approved: null, score: null },
        { status: ReviewTaskStatus.COMPLETED, approved: true, score: 90 },
      ]);

      const result = await service.canPublishReport("report-1");

      expect(result.canPublish).toBe(false);
      expect(result.pendingTasks).toBe(1);
    });

    it("should return canPublish false when rejected tasks exist", async () => {
      mockPrisma.reviewTask.findMany.mockResolvedValue([
        { status: ReviewTaskStatus.COMPLETED, approved: false, score: 30 },
        { status: ReviewTaskStatus.COMPLETED, approved: true, score: 90 },
      ]);

      const result = await service.canPublishReport("report-1");

      expect(result.canPublish).toBe(false);
      expect(result.rejectedTasks).toBe(1);
    });

    it("should return canPublish true when all tasks approved", async () => {
      mockPrisma.reviewTask.findMany.mockResolvedValue([
        { status: ReviewTaskStatus.COMPLETED, approved: true, score: 85 },
        { status: ReviewTaskStatus.COMPLETED, approved: true, score: 90 },
      ]);

      const result = await service.canPublishReport("report-1");

      expect(result.canPublish).toBe(true);
    });
  });

  describe("resetReviewProcess", () => {
    it("should reset all tasks to PENDING with cleared data", async () => {
      mockPrisma.reviewTask.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.resetReviewProcess("report-1");

      expect(result).toEqual({ reset: true });
      expect(mockPrisma.reviewTask.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ReviewTaskStatus.PENDING,
            assigneeId: null,
            approved: null,
            score: null,
          }),
        }),
      );
    });
  });
});
