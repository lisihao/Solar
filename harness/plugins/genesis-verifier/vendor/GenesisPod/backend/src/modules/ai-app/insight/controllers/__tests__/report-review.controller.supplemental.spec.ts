/**
 * ReportReviewController - Supplemental Tests
 *
 * Covers uncovered lines (UnauthorizedException branches):
 * lines 101, 131, 161, 190, 218, 272, 302, 337, 369
 */

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
    assignTask: jest.fn().mockResolvedValue({ id: "rt-1" }),
    completeTask: jest.fn().mockResolvedValue({ id: "rt-1" }),
    getTaskStats: jest.fn().mockResolvedValue({ total: 0, completed: 0 }),
    canPublishReport: jest.fn().mockResolvedValue({ canPublish: false }),
  } as unknown as jest.Mocked<ReviewWorkflowService>;
}

function noUserReq() {
  return { user: { id: undefined } };
}

describe("ReportReviewController (supplemental - UnauthorizedException branches)", () => {
  let controller: ReportReviewController;
  let mockTopicService: jest.Mocked<TopicInsightsService>;
  let mockReviewWorkflowService: jest.Mocked<ReviewWorkflowService>;

  beforeEach(() => {
    mockTopicService = createMockTopicService();
    mockReviewWorkflowService = createMockReviewWorkflowService();
    controller = new ReportReviewController(
      mockTopicService as unknown as TopicInsightsService,
      mockReviewWorkflowService as unknown as ReviewWorkflowService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("createAnnotation: should throw UnauthorizedException when user missing", async () => {
    await expect(
      controller.createAnnotation(noUserReq() as never, "topic-1", "report-1", {
        content: "note",
      } as never),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("updateAnnotation: should throw UnauthorizedException when user missing", async () => {
    await expect(
      controller.updateAnnotation(
        noUserReq() as never,
        "topic-1",
        "report-1",
        "ann-1",
        { content: "updated" } as never,
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("deleteAnnotation: should throw UnauthorizedException when user missing", async () => {
    await expect(
      controller.deleteAnnotation(
        noUserReq() as never,
        "topic-1",
        "report-1",
        "ann-1",
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("resolveAnnotation: should throw UnauthorizedException when user missing", async () => {
    await expect(
      controller.resolveAnnotation(
        noUserReq() as never,
        "topic-1",
        "report-1",
        "ann-1",
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("resolveAllAnnotations: should throw UnauthorizedException when user missing", async () => {
    await expect(
      controller.resolveAllAnnotations(
        noUserReq() as never,
        "topic-1",
        "report-1",
        { annotationIds: ["ann-1"] },
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("createReviewTasks: should throw UnauthorizedException when user missing", async () => {
    await expect(
      controller.createReviewTasks(noUserReq() as never, "topic-1", "report-1"),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("assignReviewTask: should throw UnauthorizedException when user missing", async () => {
    await expect(
      controller.assignReviewTask(
        noUserReq() as never,
        "topic-1",
        "report-1",
        "rt-1",
        { assigneeId: "u2", assigneeName: "User 2" } as never,
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("completeReviewTask: should throw UnauthorizedException when user missing", async () => {
    await expect(
      controller.completeReviewTask(
        noUserReq() as never,
        "topic-1",
        "report-1",
        "rt-1",
        { approved: true } as never,
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("getReviewTaskStats: should throw UnauthorizedException when user missing", async () => {
    await expect(
      controller.getReviewTaskStats(
        noUserReq() as never,
        "topic-1",
        "report-1",
      ),
    ).rejects.toThrow(UnauthorizedException);
  });
});
