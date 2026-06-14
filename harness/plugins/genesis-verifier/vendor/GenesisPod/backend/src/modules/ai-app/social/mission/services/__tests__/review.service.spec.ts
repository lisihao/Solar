import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { ReviewService } from "../review.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { SocialReviewStatus, SocialContentStatus } from "../../types";

describe("ReviewService", () => {
  let service: ReviewService;
  let mockPrisma: {
    socialContent: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };

  const mockDraftContent = {
    id: "content-1",
    userId: "user-1",
    title: "Test Content",
    content: "Content body here",
    status: SocialContentStatus.DRAFT,
    reviewStatus: SocialReviewStatus.PENDING,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPendingContent = {
    ...mockDraftContent,
    status: SocialContentStatus.PENDING,
  };

  const mockRejectedContent = {
    ...mockDraftContent,
    status: SocialContentStatus.DRAFT,
    reviewStatus: SocialReviewStatus.REJECTED,
  };

  beforeEach(async () => {
    mockPrisma = {
      socialContent: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ReviewService>(ReviewService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== getPendingReviewContents ====================

  it("should return pending review contents for a user", async () => {
    const pendingContents = [
      mockDraftContent,
      { ...mockDraftContent, id: "content-2" },
    ];
    mockPrisma.socialContent.findMany.mockResolvedValue(pendingContents);

    const result = await service.getPendingReviewContents("user-1");

    expect(result).toHaveLength(2);
    expect(mockPrisma.socialContent.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        reviewStatus: SocialReviewStatus.PENDING,
      },
      orderBy: { createdAt: "desc" },
      include: {
        connection: {
          select: {
            accountName: true,
            platformType: true,
          },
        },
      },
    });
  });

  it("should return empty array when no pending contents exist", async () => {
    mockPrisma.socialContent.findMany.mockResolvedValue([]);

    const result = await service.getPendingReviewContents("user-1");

    expect(result).toHaveLength(0);
  });

  it("should filter by user ID when getting pending contents", async () => {
    mockPrisma.socialContent.findMany.mockResolvedValue([]);

    await service.getPendingReviewContents("specific-user");

    const callArgs = mockPrisma.socialContent.findMany.mock.calls[0][0];
    expect(callArgs.where.userId).toBe("specific-user");
  });

  // ==================== approveContent ====================

  it("should approve content that is in DRAFT status and change it to PENDING", async () => {
    mockPrisma.socialContent.findUnique.mockResolvedValue(mockDraftContent);
    const approvedContent = {
      ...mockDraftContent,
      reviewStatus: SocialReviewStatus.APPROVED,
      status: SocialContentStatus.PENDING,
      reviewedById: "admin-1",
      reviewedAt: new Date(),
      reviewNote: "Looks good",
    };
    mockPrisma.socialContent.update.mockResolvedValue(approvedContent);

    const result = await service.approveContent(
      "admin-1",
      "content-1",
      "Looks good",
    );

    expect(result.reviewStatus).toBe(SocialReviewStatus.APPROVED);
    expect(result.status).toBe(SocialContentStatus.PENDING);
    expect(mockPrisma.socialContent.update).toHaveBeenCalledWith({
      where: { id: "content-1" },
      data: expect.objectContaining({
        reviewStatus: SocialReviewStatus.APPROVED,
        reviewedById: "admin-1",
        reviewNote: "Looks good",
        status: SocialContentStatus.PENDING, // DRAFT -> PENDING on approval
      }),
    });
  });

  it("should keep status as PENDING when approving already-PENDING content", async () => {
    mockPrisma.socialContent.findUnique.mockResolvedValue(mockPendingContent);
    const approvedContent = {
      ...mockPendingContent,
      reviewStatus: SocialReviewStatus.APPROVED,
    };
    mockPrisma.socialContent.update.mockResolvedValue(approvedContent);

    await service.approveContent("admin-1", "content-1");

    const updateCall = mockPrisma.socialContent.update.mock.calls[0][0];
    // When status is PENDING, it remains PENDING (not changed)
    expect(updateCall.data.status).toBe(SocialContentStatus.PENDING);
  });

  it("should throw NotFoundException when approving non-existent content", async () => {
    mockPrisma.socialContent.findUnique.mockResolvedValue(null);

    await expect(
      service.approveContent("admin-1", "non-existent"),
    ).rejects.toThrow(NotFoundException);
  });

  it("should set reviewedAt to current date on approval", async () => {
    const beforeTime = new Date();
    mockPrisma.socialContent.findUnique.mockResolvedValue(mockDraftContent);
    mockPrisma.socialContent.update.mockResolvedValue({
      ...mockDraftContent,
      reviewStatus: SocialReviewStatus.APPROVED,
    });

    await service.approveContent("admin-1", "content-1");

    const updateCall = mockPrisma.socialContent.update.mock.calls[0][0];
    expect(updateCall.data.reviewedAt).toBeInstanceOf(Date);
    expect(updateCall.data.reviewedAt.getTime()).toBeGreaterThanOrEqual(
      beforeTime.getTime(),
    );
  });

  it("should approve without note when note is not provided", async () => {
    mockPrisma.socialContent.findUnique.mockResolvedValue(mockDraftContent);
    mockPrisma.socialContent.update.mockResolvedValue({
      ...mockDraftContent,
      reviewStatus: SocialReviewStatus.APPROVED,
    });

    await service.approveContent("admin-1", "content-1");

    const updateCall = mockPrisma.socialContent.update.mock.calls[0][0];
    expect(updateCall.data.reviewNote).toBeUndefined();
  });

  // ==================== rejectContent ====================

  it("should reject content and set status back to DRAFT", async () => {
    mockPrisma.socialContent.findUnique.mockResolvedValue(mockPendingContent);
    const rejectedContent = {
      ...mockPendingContent,
      reviewStatus: SocialReviewStatus.REJECTED,
      status: SocialContentStatus.DRAFT,
      reviewedById: "admin-1",
      reviewNote: "Content violates guidelines",
    };
    mockPrisma.socialContent.update.mockResolvedValue(rejectedContent);

    const result = await service.rejectContent(
      "admin-1",
      "content-1",
      "Content violates guidelines",
    );

    expect(result.reviewStatus).toBe(SocialReviewStatus.REJECTED);
    expect(result.status).toBe(SocialContentStatus.DRAFT);
    expect(mockPrisma.socialContent.update).toHaveBeenCalledWith({
      where: { id: "content-1" },
      data: expect.objectContaining({
        reviewStatus: SocialReviewStatus.REJECTED,
        reviewedById: "admin-1",
        reviewNote: "Content violates guidelines",
        status: SocialContentStatus.DRAFT,
      }),
    });
  });

  it("should throw NotFoundException when rejecting non-existent content", async () => {
    mockPrisma.socialContent.findUnique.mockResolvedValue(null);

    await expect(
      service.rejectContent("admin-1", "non-existent", "Rejection reason"),
    ).rejects.toThrow(NotFoundException);
  });

  it("should include rejection note in update", async () => {
    mockPrisma.socialContent.findUnique.mockResolvedValue(mockDraftContent);
    mockPrisma.socialContent.update.mockResolvedValue({
      ...mockDraftContent,
      reviewStatus: SocialReviewStatus.REJECTED,
    });

    await service.rejectContent(
      "admin-1",
      "content-1",
      "Specific rejection reason",
    );

    const updateCall = mockPrisma.socialContent.update.mock.calls[0][0];
    expect(updateCall.data.reviewNote).toBe("Specific rejection reason");
  });

  it("should set reviewedAt to current date on rejection", async () => {
    const beforeTime = new Date();
    mockPrisma.socialContent.findUnique.mockResolvedValue(mockPendingContent);
    mockPrisma.socialContent.update.mockResolvedValue({
      ...mockPendingContent,
      reviewStatus: SocialReviewStatus.REJECTED,
    });

    await service.rejectContent("admin-1", "content-1", "Reason");

    const updateCall = mockPrisma.socialContent.update.mock.calls[0][0];
    expect(updateCall.data.reviewedAt).toBeInstanceOf(Date);
    expect(updateCall.data.reviewedAt.getTime()).toBeGreaterThanOrEqual(
      beforeTime.getTime(),
    );
  });

  // ==================== resubmitForReview ====================

  it("should resubmit rejected content for review", async () => {
    mockPrisma.socialContent.findFirst.mockResolvedValue(mockRejectedContent);
    const resubmittedContent = {
      ...mockRejectedContent,
      reviewStatus: SocialReviewStatus.PENDING,
      reviewedById: null,
      reviewedAt: null,
      reviewNote: null,
    };
    mockPrisma.socialContent.update.mockResolvedValue(resubmittedContent);

    const result = await service.resubmitForReview("user-1", "content-1");

    expect(result.reviewStatus).toBe(SocialReviewStatus.PENDING);
    expect(result.reviewedById).toBeNull();
    expect(result.reviewedAt).toBeNull();
    expect(result.reviewNote).toBeNull();
  });

  it("should throw NotFoundException when content not found for resubmit", async () => {
    mockPrisma.socialContent.findFirst.mockResolvedValue(null);

    await expect(
      service.resubmitForReview("user-1", "non-existent"),
    ).rejects.toThrow(NotFoundException);
  });

  it("should throw error when trying to resubmit non-rejected content", async () => {
    const pendingContent = {
      ...mockDraftContent,
      reviewStatus: SocialReviewStatus.PENDING,
    };
    mockPrisma.socialContent.findFirst.mockResolvedValue(pendingContent);

    await expect(
      service.resubmitForReview("user-1", "content-1"),
    ).rejects.toThrow("只有被拒绝的内容可以重新提交审核");
  });

  it("should throw error when trying to resubmit approved content", async () => {
    const approvedContent = {
      ...mockDraftContent,
      reviewStatus: SocialReviewStatus.APPROVED,
    };
    mockPrisma.socialContent.findFirst.mockResolvedValue(approvedContent);

    await expect(
      service.resubmitForReview("user-1", "content-1"),
    ).rejects.toThrow("只有被拒绝的内容可以重新提交审核");
  });

  it("should clear reviewer info on resubmit", async () => {
    mockPrisma.socialContent.findFirst.mockResolvedValue({
      ...mockRejectedContent,
      reviewedById: "admin-1",
      reviewedAt: new Date(),
      reviewNote: "Previous rejection note",
    });
    mockPrisma.socialContent.update.mockResolvedValue(mockRejectedContent);

    await service.resubmitForReview("user-1", "content-1");

    const updateCall = mockPrisma.socialContent.update.mock.calls[0][0];
    expect(updateCall.data.reviewedById).toBeNull();
    expect(updateCall.data.reviewedAt).toBeNull();
    expect(updateCall.data.reviewNote).toBeNull();
    expect(updateCall.data.reviewStatus).toBe(SocialReviewStatus.PENDING);
  });

  it("should query content by both contentId and userId for resubmit", async () => {
    mockPrisma.socialContent.findFirst.mockResolvedValue(null);

    try {
      await service.resubmitForReview("user-1", "content-1");
    } catch {
      // Expected to throw NotFoundException
    }

    expect(mockPrisma.socialContent.findFirst).toHaveBeenCalledWith({
      where: {
        id: "content-1",
        userId: "user-1",
      },
    });
  });

  // ==================== approval changes status based on current status ====================

  it("should not change PUBLISHED status when approving published content", async () => {
    const publishedContent = {
      ...mockDraftContent,
      status: SocialContentStatus.PUBLISHED,
    };
    mockPrisma.socialContent.findUnique.mockResolvedValue(publishedContent);
    mockPrisma.socialContent.update.mockResolvedValue({
      ...publishedContent,
      reviewStatus: SocialReviewStatus.APPROVED,
    });

    await service.approveContent("admin-1", "content-1");

    const updateCall = mockPrisma.socialContent.update.mock.calls[0][0];
    // PUBLISHED is not DRAFT, so it keeps its status
    expect(updateCall.data.status).toBe(SocialContentStatus.PUBLISHED);
  });

  it("should not change SCHEDULED status when approving scheduled content", async () => {
    const scheduledContent = {
      ...mockDraftContent,
      status: SocialContentStatus.SCHEDULED,
    };
    mockPrisma.socialContent.findUnique.mockResolvedValue(scheduledContent);
    mockPrisma.socialContent.update.mockResolvedValue({
      ...scheduledContent,
      reviewStatus: SocialReviewStatus.APPROVED,
    });

    await service.approveContent("admin-1", "content-1");

    const updateCall = mockPrisma.socialContent.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe(SocialContentStatus.SCHEDULED);
  });
});
