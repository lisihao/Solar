/**
 * Tests for ReviewService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { ReviewService } from "../mission/services/review.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { SocialReviewStatus, SocialContentStatus } from "../mission/types";

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

  const userId = "user-123";
  const reviewerId = "reviewer-456";
  const contentId = "content-789";

  const mockContent = {
    id: contentId,
    userId,
    title: "Test Content",
    content: "Test content body",
    status: SocialContentStatus.DRAFT,
    reviewStatus: SocialReviewStatus.PENDING,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUpdatedContent = {
    ...mockContent,
    reviewedById: reviewerId,
    reviewedAt: new Date(),
  };

  beforeEach(async () => {
    mockPrisma = {
      socialContent: {
        findMany: jest.fn().mockResolvedValue([mockContent]),
        findUnique: jest.fn().mockResolvedValue(mockContent),
        findFirst: jest.fn().mockResolvedValue(mockContent),
        update: jest.fn().mockResolvedValue(mockUpdatedContent),
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

  describe("getPendingReviewContents", () => {
    it("should return pending review contents for user", async () => {
      const result = await service.getPendingReviewContents(userId);

      expect(result).toHaveLength(1);
      expect(mockPrisma.socialContent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId,
            reviewStatus: SocialReviewStatus.PENDING,
          },
          orderBy: { createdAt: "desc" },
        }),
      );
    });

    it("should include connection info in result", async () => {
      await service.getPendingReviewContents(userId);

      const findManyCall = mockPrisma.socialContent.findMany.mock.calls[0][0];
      expect(findManyCall.include).toBeDefined();
      expect(findManyCall.include.connection).toBeDefined();
    });

    it("should return empty array when no pending contents", async () => {
      mockPrisma.socialContent.findMany.mockResolvedValue([]);

      const result = await service.getPendingReviewContents(userId);
      expect(result).toHaveLength(0);
    });
  });

  describe("approveContent", () => {
    it("should approve a draft content and set status to PENDING", async () => {
      const draftContent = {
        ...mockContent,
        status: SocialContentStatus.DRAFT,
      };
      mockPrisma.socialContent.findUnique.mockResolvedValue(draftContent);

      await service.approveContent(reviewerId, contentId, "Looks good");

      expect(mockPrisma.socialContent.update).toHaveBeenCalledWith({
        where: { id: contentId },
        data: expect.objectContaining({
          reviewStatus: SocialReviewStatus.APPROVED,
          reviewedById: reviewerId,
          reviewedAt: expect.any(Date),
          reviewNote: "Looks good",
          status: SocialContentStatus.PENDING, // DRAFT -> PENDING
        }),
      });
    });

    it("should keep status unchanged when content is not DRAFT", async () => {
      const pendingContent = {
        ...mockContent,
        status: SocialContentStatus.PENDING,
      };
      mockPrisma.socialContent.findUnique.mockResolvedValue(pendingContent);

      await service.approveContent(reviewerId, contentId);

      expect(mockPrisma.socialContent.update).toHaveBeenCalledWith({
        where: { id: contentId },
        data: expect.objectContaining({
          status: SocialContentStatus.PENDING, // Already PENDING, stays PENDING
        }),
      });
    });

    it("should approve without a note", async () => {
      await service.approveContent(reviewerId, contentId);

      expect(mockPrisma.socialContent.update).toHaveBeenCalledWith({
        where: { id: contentId },
        data: expect.objectContaining({
          reviewNote: undefined,
        }),
      });
    });

    it("should throw NotFoundException when content not found", async () => {
      mockPrisma.socialContent.findUnique.mockResolvedValue(null);

      await expect(
        service.approveContent(reviewerId, contentId),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException with correct message", async () => {
      mockPrisma.socialContent.findUnique.mockResolvedValue(null);

      await expect(
        service.approveContent(reviewerId, contentId),
      ).rejects.toThrow("内容不存在");
    });
  });

  describe("rejectContent", () => {
    it("should reject content with a note and set status to DRAFT", async () => {
      await service.rejectContent(reviewerId, contentId, "Needs improvement");

      expect(mockPrisma.socialContent.update).toHaveBeenCalledWith({
        where: { id: contentId },
        data: expect.objectContaining({
          reviewStatus: SocialReviewStatus.REJECTED,
          reviewedById: reviewerId,
          reviewedAt: expect.any(Date),
          reviewNote: "Needs improvement",
          status: SocialContentStatus.DRAFT, // Always goes back to DRAFT
        }),
      });
    });

    it("should throw NotFoundException when content not found", async () => {
      mockPrisma.socialContent.findUnique.mockResolvedValue(null);

      await expect(
        service.rejectContent(reviewerId, contentId, "Rejected"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should set status back to DRAFT regardless of current status", async () => {
      const publishingContent = {
        ...mockContent,
        status: SocialContentStatus.PUBLISHING,
      };
      mockPrisma.socialContent.findUnique.mockResolvedValue(publishingContent);

      await service.rejectContent(reviewerId, contentId, "Not appropriate");

      expect(mockPrisma.socialContent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SocialContentStatus.DRAFT,
          }),
        }),
      );
    });
  });

  describe("resubmitForReview", () => {
    it("should resubmit a rejected content for review", async () => {
      const rejectedContent = {
        ...mockContent,
        reviewStatus: SocialReviewStatus.REJECTED,
      };
      mockPrisma.socialContent.findFirst.mockResolvedValue(rejectedContent);

      await service.resubmitForReview(userId, contentId);

      expect(mockPrisma.socialContent.update).toHaveBeenCalledWith({
        where: { id: contentId },
        data: {
          reviewStatus: SocialReviewStatus.PENDING,
          reviewedById: null,
          reviewedAt: null,
          reviewNote: null,
        },
      });
    });

    it("should throw NotFoundException when content not found for user", async () => {
      mockPrisma.socialContent.findFirst.mockResolvedValue(null);

      await expect(
        service.resubmitForReview(userId, contentId),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw error when content is not in REJECTED state", async () => {
      const pendingContent = {
        ...mockContent,
        reviewStatus: SocialReviewStatus.PENDING,
      };
      mockPrisma.socialContent.findFirst.mockResolvedValue(pendingContent);

      await expect(
        service.resubmitForReview(userId, contentId),
      ).rejects.toThrow("只有被拒绝的内容可以重新提交审核");
    });

    it("should throw error when content is approved (not rejected)", async () => {
      const approvedContent = {
        ...mockContent,
        reviewStatus: SocialReviewStatus.APPROVED,
      };
      mockPrisma.socialContent.findFirst.mockResolvedValue(approvedContent);

      await expect(
        service.resubmitForReview(userId, contentId),
      ).rejects.toThrow("只有被拒绝的内容可以重新提交审核");
    });
  });
});
