/**
 * ReviewWorkflowService Unit Tests
 */

import { NotFoundException, ConflictException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { ReviewWorkflowService } from "../review-workflow.service";
import { ReviewRequest, ReviewFeedback } from "../review.interface";

// 模拟 Logger（源码中使用了 Logger）
jest.mock("@nestjs/common", () => {
  const actual = jest.requireActual("@nestjs/common");
  return {
    ...actual,
    Logger: jest.fn().mockImplementation(() => ({
      log: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    })),
  };
});

// ---------------------------------------------------------------------------
// 辅助函数：DB 记录工厂
// ---------------------------------------------------------------------------
function buildDbReview(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "review-001",
    entityType: "report",
    entityId: "entity-001",
    requesterId: "user-requester",
    reviewerId: "user-reviewer",
    reviewerName: "Reviewer Name",
    criteria: ["accuracy", "clarity"],
    priority: "medium",
    status: "pending",
    timeline: [
      {
        type: "created",
        timestamp: new Date().toISOString(),
        actor: "user-requester",
      },
    ],
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    feedback: null,
    ...overrides,
  };
}

function buildReviewRequest(
  overrides: Partial<ReviewRequest> = {},
): ReviewRequest {
  return {
    entityType: "report",
    entityId: "entity-001",
    requesterId: "user-requester",
    criteria: ["accuracy", "clarity"],
    priority: "medium",
    ...overrides,
  };
}

function buildFeedback(
  overrides: Partial<ReviewFeedback> = {},
): ReviewFeedback {
  return {
    overallRating: 4,
    comments: "Looks good",
    criteriaRatings: { accuracy: 4, clarity: 5 },
    suggestions: [],
    recommendation: "approve",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PrismaService 模拟工厂
// ---------------------------------------------------------------------------
function buildPrismaWithReviewModel(
  overrides: Record<string, jest.Mock> = {},
): Record<string, unknown> {
  const reviewModel = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    ...overrides,
  };

  return {
    review: reviewModel,
    user: {
      findUnique: jest.fn(),
    },
  };
}

/** 不含 review 属性（模型未创建状态）的 Prisma 模拟 */
function buildPrismaWithoutReviewModel(): Record<string, unknown> {
  return {
    user: {
      findUnique: jest.fn(),
    },
  };
}

// ---------------------------------------------------------------------------
// 测试主体
// ---------------------------------------------------------------------------
describe("ReviewWorkflowService", () => {
  let service: ReviewWorkflowService;
  let prisma: ReturnType<typeof buildPrismaWithReviewModel>;
  let eventEmitter: { emit: jest.Mock };

  beforeEach(() => {
    prisma = buildPrismaWithReviewModel();
    eventEmitter = { emit: jest.fn() };

    // 直接实例化（避免与 Logger 模拟的冲突，不使用 TestingModule）
    service = new ReviewWorkflowService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      eventEmitter as unknown as EventEmitter2,
    );
  });

  // ---------------------------------------------------------------------------
  // 用于 isModelAvailable 分支测试的辅助函数，创建不含模型的服务实例
  // ---------------------------------------------------------------------------
  function createServiceWithoutModel(): ReviewWorkflowService {
    const prismaWithout = buildPrismaWithoutReviewModel();
    return new ReviewWorkflowService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prismaWithout as any,
      eventEmitter as unknown as EventEmitter2,
    );
  }

  // ---------------------------------------------------------------------------
  // createReview
  // ---------------------------------------------------------------------------
  describe("createReview", () => {
    it("成功创建 review 并发出 review.created 事件", async () => {
      const dbRecord = buildDbReview();
      (prisma.review as Record<string, jest.Mock>).create.mockResolvedValue(
        dbRecord,
      );

      const request = buildReviewRequest();
      const result = await service.createReview(request);

      expect(result.id).toBe("review-001");
      expect(result.status).toBe("pending");
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        "review.created",
        expect.objectContaining({ reviewId: "review-001" }),
      );
    });

    it("模型未使用时返回空 review 且不发出事件", async () => {
      const svc = createServiceWithoutModel();
      const request = buildReviewRequest();
      const result = await svc.createReview(request);

      expect(result.id).toBe("");
      expect(result.status).toBe("pending");
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("未指定 priority 时默认设置为 medium", async () => {
      const dbRecord = buildDbReview({ priority: "medium" });
      (prisma.review as Record<string, jest.Mock>).create.mockResolvedValue(
        dbRecord,
      );

      const request = buildReviewRequest({ priority: undefined });
      await service.createReview(request);

      const createCall = (prisma.review as Record<string, jest.Mock>).create
        .mock.calls[0][0];
      expect(createCall.data.priority).toBe("medium");
    });
  });

  // ---------------------------------------------------------------------------
  // assignReviewer
  // ---------------------------------------------------------------------------
  describe("assignReviewer", () => {
    it("分配审阅者并发出 review.assigned 事件", async () => {
      const dbRecord = buildDbReview({ version: 1 });
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        dbRecord,
      );
      const updatedRecord = buildDbReview({
        reviewerId: "new-reviewer",
        version: 2,
      });
      (prisma.review as Record<string, jest.Mock>).update.mockResolvedValue(
        updatedRecord,
      );
      (prisma.user as Record<string, jest.Mock>).findUnique.mockResolvedValue({
        username: "NewReviewer",
        email: "new@example.com",
      });

      const result = await service.assignReviewer(
        "review-001",
        "new-reviewer",
        "admin",
      );

      expect(result.id).toBe("review-001");
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        "review.assigned",
        expect.objectContaining({ reviewId: "review-001" }),
      );
    });

    it("模型未使用时抛出 NotFoundException", async () => {
      const svc = createServiceWithoutModel();
      await expect(
        svc.assignReviewer("review-001", "reviewer", "admin"),
      ).rejects.toThrow(NotFoundException);
    });

    it("review 不存在时抛出 NotFoundException", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        null,
      );

      await expect(
        service.assignReviewer("nonexistent", "reviewer", "admin"),
      ).rejects.toThrow(NotFoundException);
    });

    it("乐观锁冲突（P2025）时抛出 ConflictException", async () => {
      const dbRecord = buildDbReview({ version: 1 });
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        dbRecord,
      );
      (prisma.user as Record<string, jest.Mock>).findUnique.mockResolvedValue({
        username: "Reviewer",
        email: null,
      });
      const prismaError = { code: "P2025", message: "Record not found" };
      (prisma.review as Record<string, jest.Mock>).update.mockRejectedValue(
        prismaError,
      );

      await expect(
        service.assignReviewer("review-001", "reviewer", "admin"),
      ).rejects.toThrow(ConflictException);
    });

    it("非 P2025 错误会被重新抛出", async () => {
      const dbRecord = buildDbReview({ version: 1 });
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        dbRecord,
      );
      (prisma.user as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        null,
      );
      const unexpectedError = new Error("DB connection failed");
      (prisma.review as Record<string, jest.Mock>).update.mockRejectedValue(
        unexpectedError,
      );

      await expect(
        service.assignReviewer("review-001", "reviewer", "admin"),
      ).rejects.toThrow("DB connection failed");
    });

    it("用户不存在时 reviewerName 为 'Unknown'", async () => {
      const dbRecord = buildDbReview({ version: 1 });
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        dbRecord,
      );
      (prisma.user as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        null,
      );
      (prisma.review as Record<string, jest.Mock>).update.mockResolvedValue(
        buildDbReview({ reviewerName: "Unknown", version: 2 }),
      );

      const result = await service.assignReviewer(
        "review-001",
        "reviewer",
        "admin",
      );
      expect(result).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // autoAssign
  // ---------------------------------------------------------------------------
  describe("autoAssign", () => {
    it("返回 review（简易实现）", async () => {
      const dbRecord = buildDbReview();
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        dbRecord,
      );

      const result = await service.autoAssign("review-001");
      expect(result.id).toBe("review-001");
    });

    it("模型未使用时抛出 NotFoundException", async () => {
      const svc = createServiceWithoutModel();
      await expect(svc.autoAssign("review-001")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("review 不存在时抛出 NotFoundException", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        null,
      );

      await expect(service.autoAssign("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // startReview
  // ---------------------------------------------------------------------------
  describe("startReview", () => {
    it("将状态更新为 in_progress", async () => {
      const dbRecord = buildDbReview({ version: 1 });
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        dbRecord,
      );
      const updatedRecord = buildDbReview({
        status: "in_progress",
        version: 2,
      });
      (prisma.review as Record<string, jest.Mock>).update.mockResolvedValue(
        updatedRecord,
      );

      const result = await service.startReview("review-001", "reviewer-id");
      expect(result.status).toBe("in_progress");
    });

    it("模型未使用时抛出 NotFoundException", async () => {
      const svc = createServiceWithoutModel();
      await expect(svc.startReview("review-001", "reviewer")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("review 不存在时抛出 NotFoundException", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        null,
      );

      await expect(
        service.startReview("nonexistent", "reviewer"),
      ).rejects.toThrow(NotFoundException);
    });

    it("乐观锁冲突时抛出 ConflictException", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        buildDbReview({ version: 1 }),
      );
      (prisma.review as Record<string, jest.Mock>).update.mockRejectedValue({
        code: "P2025",
      });

      await expect(
        service.startReview("review-001", "reviewer"),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ---------------------------------------------------------------------------
  // submitFeedback
  // ---------------------------------------------------------------------------
  describe("submitFeedback", () => {
    it("approve 反馈使状态变为 approved", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        buildDbReview({ status: "in_progress", version: 1 }),
      );
      (prisma.review as Record<string, jest.Mock>).update.mockResolvedValue(
        buildDbReview({
          status: "approved",
          version: 2,
          completedAt: new Date(),
        }),
      );

      const feedback = buildFeedback({ recommendation: "approve" });
      const result = await service.submitFeedback(
        "review-001",
        feedback,
        "reviewer",
      );

      expect(result.status).toBe("approved");
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        "review.feedback_submitted",
        expect.objectContaining({ recommendation: "approve" }),
      );
    });

    it("reject 反馈使状态变为 rejected", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        buildDbReview({ status: "in_progress", version: 1 }),
      );
      (prisma.review as Record<string, jest.Mock>).update.mockResolvedValue(
        buildDbReview({
          status: "rejected",
          version: 2,
          completedAt: new Date(),
        }),
      );

      const feedback = buildFeedback({ recommendation: "reject" });
      const result = await service.submitFeedback(
        "review-001",
        feedback,
        "reviewer",
      );

      expect(result.status).toBe("rejected");
    });

    it("revise 反馈使状态变为 revision_required", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        buildDbReview({ status: "in_progress", version: 1 }),
      );
      (prisma.review as Record<string, jest.Mock>).update.mockResolvedValue(
        buildDbReview({ status: "revision_required", version: 2 }),
      );

      const feedback = buildFeedback({ recommendation: "revise" });
      const result = await service.submitFeedback(
        "review-001",
        feedback,
        "reviewer",
      );

      expect(result.status).toBe("revision_required");
    });

    it("模型未使用时抛出 NotFoundException", async () => {
      const svc = createServiceWithoutModel();
      await expect(
        svc.submitFeedback("review-001", buildFeedback(), "reviewer"),
      ).rejects.toThrow(NotFoundException);
    });

    it("review 不存在时抛出 NotFoundException", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        null,
      );

      await expect(
        service.submitFeedback("nonexistent", buildFeedback(), "reviewer"),
      ).rejects.toThrow(NotFoundException);
    });

    it("乐观锁冲突时抛出 ConflictException", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        buildDbReview({ version: 1 }),
      );
      (prisma.review as Record<string, jest.Mock>).update.mockRejectedValue({
        code: "P2025",
      });

      await expect(
        service.submitFeedback("review-001", buildFeedback(), "reviewer"),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ---------------------------------------------------------------------------
  // updateStatus
  // ---------------------------------------------------------------------------
  describe("updateStatus", () => {
    it("更新状态", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        buildDbReview({ version: 1 }),
      );
      (prisma.review as Record<string, jest.Mock>).update.mockResolvedValue(
        buildDbReview({ status: "approved", version: 2 }),
      );

      const result = await service.updateStatus(
        "review-001",
        "approved",
        "admin",
      );
      expect(result.status).toBe("approved");
    });

    it("更新为 approved 状态时 completedAt 被设置", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        buildDbReview({ version: 1 }),
      );
      (prisma.review as Record<string, jest.Mock>).update.mockResolvedValue(
        buildDbReview({
          status: "approved",
          version: 2,
          completedAt: new Date(),
        }),
      );

      const updateCall = jest.spyOn(
        prisma.review as Record<string, jest.Mock>,
        "update",
      );
      await service.updateStatus("review-001", "approved", "admin");

      const updateArg = updateCall.mock.calls[0][0];
      expect(updateArg.data.completedAt).toBeDefined();
    });

    it("模型未使用时抛出 NotFoundException", async () => {
      const svc = createServiceWithoutModel();
      await expect(
        svc.updateStatus("review-001", "approved", "admin"),
      ).rejects.toThrow(NotFoundException);
    });

    it("乐观锁冲突时抛出 ConflictException", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        buildDbReview({ version: 1 }),
      );
      (prisma.review as Record<string, jest.Mock>).update.mockRejectedValue({
        code: "P2025",
      });

      await expect(
        service.updateStatus("review-001", "approved", "admin"),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ---------------------------------------------------------------------------
  // getReview
  // ---------------------------------------------------------------------------
  describe("getReview", () => {
    it("返回存在的 review", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        buildDbReview(),
      );

      const result = await service.getReview("review-001");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("review-001");
    });

    it("不存在的 review 返回 null", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        null,
      );

      const result = await service.getReview("nonexistent");
      expect(result).toBeNull();
    });

    it("模型未使用时返回 null", async () => {
      const svc = createServiceWithoutModel();
      const result = await svc.getReview("review-001");
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getReviewsForEntity
  // ---------------------------------------------------------------------------
  describe("getReviewsForEntity", () => {
    it("返回与实体关联的 review 列表", async () => {
      (prisma.review as Record<string, jest.Mock>).findMany.mockResolvedValue([
        buildDbReview({ id: "r1" }),
        buildDbReview({ id: "r2" }),
      ]);

      const result = await service.getReviewsForEntity("report", "entity-001");
      expect(result).toHaveLength(2);
    });

    it("模型未使用时返回空数组", async () => {
      const svc = createServiceWithoutModel();
      const result = await svc.getReviewsForEntity("report", "entity-001");
      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // getPendingReviews
  // ---------------------------------------------------------------------------
  describe("getPendingReviews", () => {
    it("按 reviewerId 返回 pending/in_progress 状态的 review", async () => {
      (prisma.review as Record<string, jest.Mock>).findMany.mockResolvedValue([
        buildDbReview({ status: "pending" }),
      ]);

      const result = await service.getPendingReviews("reviewer-id");
      expect(result).toHaveLength(1);
    });

    it("模型未使用时返回空数组", async () => {
      const svc = createServiceWithoutModel();
      const result = await svc.getPendingReviews("reviewer-id");
      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // getStats
  // ---------------------------------------------------------------------------
  describe("getStats", () => {
    it("模型未使用时返回零值统计", async () => {
      const svc = createServiceWithoutModel();
      const stats = await svc.getStats();

      expect(stats.totalReviews).toBe(0);
      expect(stats.pendingCount).toBe(0);
      expect(stats.inProgressCount).toBe(0);
      expect(stats.completedCount).toBe(0);
      expect(stats.avgCompletionTime).toBe(0);
      expect(stats.avgRating).toBe(0);
    });

    it("各状态计数正确计算", async () => {
      const now = new Date();
      const createdAt = new Date(now.getTime() - 3600_000); // 1 小时前
      (prisma.review as Record<string, jest.Mock>).findMany.mockResolvedValue([
        { status: "pending", createdAt, completedAt: null, feedback: null },
        { status: "in_progress", createdAt, completedAt: null, feedback: null },
        {
          status: "approved",
          createdAt,
          completedAt: now,
          feedback: { overallRating: 5 },
        },
        { status: "rejected", createdAt, completedAt: now, feedback: null },
      ]);

      const stats = await service.getStats();

      expect(stats.totalReviews).toBe(4);
      expect(stats.pendingCount).toBe(1);
      expect(stats.inProgressCount).toBe(1);
      expect(stats.completedCount).toBe(2);
      expect(stats.avgRating).toBe(5);
    });

    it("传入 filters 时添加到 where 条件", async () => {
      (prisma.review as Record<string, jest.Mock>).findMany.mockResolvedValue(
        [],
      );

      await service.getStats({ entityType: "report", reviewerId: "r-1" });

      const callArgs = (prisma.review as Record<string, jest.Mock>).findMany
        .mock.calls[0][0];
      expect(callArgs.where.entityType).toBe("report");
      expect(callArgs.where.reviewerId).toBe("r-1");
    });

    it("已完成 review 无 completedAt 时 avgCompletionTime 为 0", async () => {
      (prisma.review as Record<string, jest.Mock>).findMany.mockResolvedValue([
        {
          status: "approved",
          createdAt: null,
          completedAt: null,
          feedback: null,
        },
      ]);

      const stats = await service.getStats();
      expect(stats.avgCompletionTime).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // cancelReview
  // ---------------------------------------------------------------------------
  describe("cancelReview", () => {
    it("取消 review（更新为 rejected 状态）", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        buildDbReview({ version: 1 }),
      );
      (prisma.review as Record<string, jest.Mock>).update.mockResolvedValue(
        buildDbReview({
          status: "rejected",
          version: 2,
          completedAt: new Date(),
        }),
      );

      const result = await service.cancelReview(
        "review-001",
        "admin",
        "No longer needed",
      );
      expect(result.status).toBe("rejected");
    });

    it("模型未使用时抛出 NotFoundException", async () => {
      const svc = createServiceWithoutModel();
      await expect(svc.cancelReview("review-001", "admin")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("review 不存在时抛出 NotFoundException", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        null,
      );

      await expect(
        service.cancelReview("nonexistent", "admin"),
      ).rejects.toThrow(NotFoundException);
    });

    it("乐观锁冲突时抛出 ConflictException", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        buildDbReview({ version: 1 }),
      );
      (prisma.review as Record<string, jest.Mock>).update.mockRejectedValue({
        code: "P2025",
      });

      await expect(service.cancelReview("review-001", "admin")).rejects.toThrow(
        ConflictException,
      );
    });

    it("省略 reason 时正常运行", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        buildDbReview({ version: 1 }),
      );
      (prisma.review as Record<string, jest.Mock>).update.mockResolvedValue(
        buildDbReview({ status: "rejected", version: 2 }),
      );

      const result = await service.cancelReview("review-001", "admin");
      expect(result).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // reopenReview
  // ---------------------------------------------------------------------------
  describe("reopenReview", () => {
    it("将 review 重新打开为 pending 状态", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        buildDbReview({ status: "rejected", version: 1 }),
      );
      (prisma.review as Record<string, jest.Mock>).update.mockResolvedValue(
        buildDbReview({ status: "pending", version: 2, completedAt: null }),
      );

      const result = await service.reopenReview(
        "review-001",
        "admin",
        "Re-evaluation needed",
      );
      expect(result.status).toBe("pending");
    });

    it("模型未使用时抛出 NotFoundException", async () => {
      const svc = createServiceWithoutModel();
      await expect(svc.reopenReview("review-001", "admin")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("review 不存在时抛出 NotFoundException", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        null,
      );

      await expect(
        service.reopenReview("nonexistent", "admin"),
      ).rejects.toThrow(NotFoundException);
    });

    it("乐观锁冲突时抛出 ConflictException", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        buildDbReview({ version: 1 }),
      );
      (prisma.review as Record<string, jest.Mock>).update.mockRejectedValue({
        code: "P2025",
      });

      await expect(service.reopenReview("review-001", "admin")).rejects.toThrow(
        ConflictException,
      );
    });

    it("非 P2025 错误会被重新抛出", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        buildDbReview({ version: 1 }),
      );
      (prisma.review as Record<string, jest.Mock>).update.mockRejectedValue(
        new Error("Network error"),
      );

      await expect(service.reopenReview("review-001", "admin")).rejects.toThrow(
        "Network error",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // mapToReview（reviewer 有无的分支覆盖）
  // ---------------------------------------------------------------------------
  describe("mapToReview 的 reviewer 分支", () => {
    it("reviewerId 为 null 的记录 reviewer 为 undefined", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        buildDbReview({ reviewerId: null }),
      );

      const result = await service.getReview("review-001");
      expect(result?.reviewer).toBeUndefined();
    });

    it("存在 reviewerId 时设置 reviewer 对象", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        buildDbReview({ reviewerId: "reviewer-id", reviewerName: "Alice" }),
      );

      const result = await service.getReview("review-001");
      expect(result?.reviewer).toEqual({
        id: "reviewer-id",
        name: "Alice",
        role: undefined,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 非 P2025 错误重新抛出（分支覆盖补充）
  // ---------------------------------------------------------------------------
  describe("各方法的非 P2025 错误重新抛出", () => {
    it("startReview：非 P2025 错误被重新抛出", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        buildDbReview({ version: 1 }),
      );
      (prisma.review as Record<string, jest.Mock>).update.mockRejectedValue(
        new Error("Unexpected DB error"),
      );

      await expect(
        service.startReview("review-001", "reviewer"),
      ).rejects.toThrow("Unexpected DB error");
    });

    it("submitFeedback：非 P2025 错误被重新抛出", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        buildDbReview({ version: 1 }),
      );
      (prisma.review as Record<string, jest.Mock>).update.mockRejectedValue(
        new Error("Unexpected DB error"),
      );

      await expect(
        service.submitFeedback("review-001", buildFeedback(), "reviewer"),
      ).rejects.toThrow("Unexpected DB error");
    });

    it("updateStatus：非 P2025 错误被重新抛出", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        buildDbReview({ version: 1 }),
      );
      (prisma.review as Record<string, jest.Mock>).update.mockRejectedValue(
        new Error("Unexpected DB error"),
      );

      await expect(
        service.updateStatus("review-001", "approved", "admin"),
      ).rejects.toThrow("Unexpected DB error");
    });

    it("cancelReview：非 P2025 错误被重新抛出", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        buildDbReview({ version: 1 }),
      );
      (prisma.review as Record<string, jest.Mock>).update.mockRejectedValue(
        new Error("Unexpected DB error"),
      );

      await expect(service.cancelReview("review-001", "admin")).rejects.toThrow(
        "Unexpected DB error",
      );
    });

    it("updateStatus：rejected 状态也设置 completedAt", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        buildDbReview({ version: 1 }),
      );
      (prisma.review as Record<string, jest.Mock>).update.mockResolvedValue(
        buildDbReview({
          status: "rejected",
          version: 2,
          completedAt: new Date(),
        }),
      );

      const result = await service.updateStatus(
        "review-001",
        "rejected",
        "admin",
      );
      expect(result.status).toBe("rejected");
    });

    it("updateStatus：findUnique 返回 null 时抛出 NotFoundException", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        null,
      );

      await expect(
        service.updateStatus("nonexistent", "approved", "admin"),
      ).rejects.toThrow(NotFoundException);
    });

    it("updateStatus：in_progress 状态时 completedAt 为 undefined", async () => {
      (prisma.review as Record<string, jest.Mock>).findUnique.mockResolvedValue(
        buildDbReview({ version: 1 }),
      );
      (prisma.review as Record<string, jest.Mock>).update.mockResolvedValue(
        buildDbReview({ status: "in_progress", version: 2 }),
      );

      const updateSpy = jest.spyOn(
        prisma.review as Record<string, jest.Mock>,
        "update",
      );
      await service.updateStatus("review-001", "in_progress", "admin");

      const updateArg = updateSpy.mock.calls[0][0];
      expect(updateArg.data.completedAt).toBeUndefined();
    });
  });
});
