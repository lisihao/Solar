// Break the ai-harness/facade import chain (transitively imports @nestjs/cache-manager)
jest.mock("@/modules/ai-harness/facade", () => ({}));
jest.mock("@/modules/ai-harness/facade", () => ({}));

import { UnauthorizedException } from "@nestjs/common";
import { ReportReviewController } from "../report-review.controller";
import type { TopicInsightsService } from "../../topic-insights.service";
import type { ReviewWorkflowService } from "../../services";

function createMockTopicService() {
  return {
    getReportAnnotations: jest.fn().mockResolvedValue([]),
    createAnnotation: jest.fn().mockResolvedValue({ id: "ann-1" }),
    updateAnnotation: jest.fn().mockResolvedValue({ id: "ann-1" }),
    deleteAnnotation: jest.fn().mockResolvedValue({ deleted: true }),
    resolveAnnotation: jest
      .fn()
      .mockResolvedValue({ id: "ann-1", status: "RESOLVED" }),
    resolveAllAnnotations: jest.fn().mockResolvedValue({ resolved: 3 }),
  } as unknown as jest.Mocked<TopicInsightsService>;
}

function createMockReviewWorkflowService() {
  return {
    getReviewTasks: jest.fn().mockResolvedValue([]),
    createReviewTasksForReport: jest.fn().mockResolvedValue([{ id: "rt-1" }]),
    assignTask: jest
      .fn()
      .mockResolvedValue({ id: "rt-1", assigneeId: "user-2" }),
    completeTask: jest.fn().mockResolvedValue({ id: "rt-1", approved: true }),
    getTaskStats: jest.fn().mockResolvedValue({ total: 5, completed: 3 }),
    canPublishReport: jest.fn().mockResolvedValue({ canPublish: true }),
  } as unknown as jest.Mocked<ReviewWorkflowService>;
}

function createMockRequest(userId?: string) {
  return { user: { id: userId } };
}

describe("ReportReviewController", () => {
  let controller: ReportReviewController;
  let mockTopicService: jest.Mocked<TopicInsightsService>;
  let mockReviewWorkflowService: jest.Mocked<ReviewWorkflowService>;
  let mockReq: ReturnType<typeof createMockRequest>;

  beforeEach(() => {
    mockTopicService = createMockTopicService();
    mockReviewWorkflowService = createMockReviewWorkflowService();
    controller = new ReportReviewController(
      mockTopicService as unknown as TopicInsightsService,
      mockReviewWorkflowService as unknown as ReviewWorkflowService,
    );
    mockReq = createMockRequest("user-review");
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getReportAnnotations", () => {
    it("should get annotations for report", async () => {
      const result = await controller.getReportAnnotations(
        mockReq as never,
        "topic-1",
        "report-1",
        "OPEN",
      );
      expect(mockTopicService.getReportAnnotations).toHaveBeenCalledWith(
        "user-review",
        "topic-1",
        "report-1",
        "OPEN",
      );
      expect(result).toEqual([]);
    });

    it("should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.getReportAnnotations(
          reqNoUser as never,
          "topic-1",
          "report-1",
        ),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("createAnnotation", () => {
    it("should create annotation", async () => {
      const dto = { content: "This needs more data", position: 100 } as never;
      const result = await controller.createAnnotation(
        mockReq as never,
        "topic-1",
        "report-1",
        dto,
      );
      expect(mockTopicService.createAnnotation).toHaveBeenCalledWith(
        "user-review",
        "topic-1",
        "report-1",
        dto,
      );
      expect(result).toEqual({ id: "ann-1" });
    });
  });

  describe("updateAnnotation", () => {
    it("should update annotation", async () => {
      const dto = { content: "Updated comment", status: "RESOLVED" } as never;
      await controller.updateAnnotation(
        mockReq as never,
        "topic-1",
        "report-1",
        "ann-1",
        dto,
      );
      expect(mockTopicService.updateAnnotation).toHaveBeenCalledWith(
        "user-review",
        "topic-1",
        "report-1",
        "ann-1",
        dto,
      );
    });
  });

  describe("deleteAnnotation", () => {
    it("should delete annotation", async () => {
      await controller.deleteAnnotation(
        mockReq as never,
        "topic-1",
        "report-1",
        "ann-1",
      );
      expect(mockTopicService.deleteAnnotation).toHaveBeenCalledWith(
        "user-review",
        "topic-1",
        "report-1",
        "ann-1",
      );
    });
  });

  describe("resolveAnnotation", () => {
    it("should resolve annotation", async () => {
      const result = await controller.resolveAnnotation(
        mockReq as never,
        "topic-1",
        "report-1",
        "ann-1",
      );
      expect(mockTopicService.resolveAnnotation).toHaveBeenCalledWith(
        "user-review",
        "topic-1",
        "report-1",
        "ann-1",
      );
      expect(result).toEqual({ id: "ann-1", status: "RESOLVED" });
    });
  });

  describe("resolveAllAnnotations", () => {
    it("should resolve all specified annotations", async () => {
      const dto = { annotationIds: ["ann-1", "ann-2"] };
      await controller.resolveAllAnnotations(
        mockReq as never,
        "topic-1",
        "report-1",
        dto,
      );
      expect(mockTopicService.resolveAllAnnotations).toHaveBeenCalledWith(
        "user-review",
        "topic-1",
        "report-1",
        ["ann-1", "ann-2"],
      );
    });

    it("should resolve all annotations when no ids provided", async () => {
      await controller.resolveAllAnnotations(
        mockReq as never,
        "topic-1",
        "report-1",
        {},
      );
      expect(mockTopicService.resolveAllAnnotations).toHaveBeenCalledWith(
        "user-review",
        "topic-1",
        "report-1",
        undefined,
      );
    });
  });

  describe("getReviewTasks", () => {
    it("should get review tasks for report", async () => {
      const result = await controller.getReviewTasks(
        mockReq as never,
        "topic-1",
        "report-1",
      );
      expect(mockReviewWorkflowService.getReviewTasks).toHaveBeenCalledWith(
        "report-1",
      );
      expect(result).toEqual([]);
    });

    it("should throw UnauthorizedException when user missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.getReviewTasks(reqNoUser as never, "topic-1", "report-1"),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("createReviewTasks", () => {
    it("should create review tasks for report", async () => {
      const _result = await controller.createReviewTasks(
        mockReq as never,
        "topic-1",
        "report-1",
      );
      expect(
        mockReviewWorkflowService.createReviewTasksForReport,
      ).toHaveBeenCalledWith("report-1", "user-review");
    });
  });

  describe("assignReviewTask", () => {
    it("should assign review task to user", async () => {
      const dto = {
        assigneeId: "user-2",
        assigneeName: "Reviewer Name",
        dueAt: "2026-03-01T10:00:00Z",
      } as never;
      const _result = await controller.assignReviewTask(
        mockReq as never,
        "topic-1",
        "report-1",
        "rt-1",
        dto,
      );
      expect(mockReviewWorkflowService.assignTask).toHaveBeenCalledWith(
        {
          taskId: "rt-1",
          assigneeId: "user-2",
          assigneeName: "Reviewer Name",
          dueAt: expect.any(Date),
        },
        "user-review",
      );
    });

    it("should handle assignment without dueAt", async () => {
      const dto = { assigneeId: "user-2", assigneeName: "User 2" } as never;
      await controller.assignReviewTask(
        mockReq as never,
        "topic-1",
        "report-1",
        "rt-1",
        dto,
      );
      expect(mockReviewWorkflowService.assignTask).toHaveBeenCalledWith(
        expect.objectContaining({ dueAt: undefined }),
        "user-review",
      );
    });
  });

  describe("completeReviewTask", () => {
    it("should complete review task with approval", async () => {
      const dto = {
        approved: true,
        comments: "Looks good!",
        score: 90,
      } as never;
      const _result = await controller.completeReviewTask(
        mockReq as never,
        "topic-1",
        "report-1",
        "rt-1",
        dto,
      );
      expect(mockReviewWorkflowService.completeTask).toHaveBeenCalledWith(
        {
          taskId: "rt-1",
          approved: true,
          comments: "Looks good!",
          score: 90,
        },
        "user-review",
      );
    });

    it("should complete review task with rejection", async () => {
      const dto = {
        approved: false,
        comments: "Needs revision",
        score: 40,
      } as never;
      await controller.completeReviewTask(
        mockReq as never,
        "topic-1",
        "report-1",
        "rt-1",
        dto,
      );
      expect(mockReviewWorkflowService.completeTask).toHaveBeenCalledWith(
        expect.objectContaining({ approved: false }),
        "user-review",
      );
    });
  });

  describe("getReviewTaskStats", () => {
    it("should get review task statistics", async () => {
      const result = await controller.getReviewTaskStats(
        mockReq as never,
        "topic-1",
        "report-1",
      );
      expect(mockReviewWorkflowService.getTaskStats).toHaveBeenCalledWith(
        "report-1",
      );
      expect(result).toEqual({ total: 5, completed: 3 });
    });
  });

  describe("canPublishReport", () => {
    it("should check if report can be published", async () => {
      const result = await controller.canPublishReport(
        mockReq as never,
        "topic-1",
        "report-1",
      );
      expect(mockReviewWorkflowService.canPublishReport).toHaveBeenCalledWith(
        "report-1",
      );
      expect(result).toEqual({ canPublish: true });
    });

    it("should throw UnauthorizedException when user missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.canPublishReport(reqNoUser as never, "topic-1", "report-1"),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
