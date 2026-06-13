import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { SocialReviewStatus, SocialContentStatus } from "../types";

@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取待审核内容列表
   */
  async getPendingReviewContents(userId: string) {
    this.logger.log(`Getting pending review contents for user ${userId}`);
    return this.prisma.socialContent.findMany({
      where: {
        userId,
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
  }

  /**
   * 审核通过
   */
  async approveContent(reviewerId: string, contentId: string, note?: string) {
    const content = await this.prisma.socialContent.findUnique({
      where: { id: contentId },
    });

    if (!content) {
      throw new NotFoundException("内容不存在");
    }

    return this.prisma.socialContent.update({
      where: { id: contentId },
      data: {
        reviewStatus: SocialReviewStatus.APPROVED,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewNote: note,
        // 审核通过后，如果是待发布状态，保持状态；如果是草稿，改为待发布
        status:
          content.status === SocialContentStatus.DRAFT
            ? SocialContentStatus.PENDING
            : content.status,
      },
    });
  }

  /**
   * 审核拒绝
   */
  async rejectContent(reviewerId: string, contentId: string, note: string) {
    const content = await this.prisma.socialContent.findUnique({
      where: { id: contentId },
    });

    if (!content) {
      throw new NotFoundException("内容不存在");
    }

    return this.prisma.socialContent.update({
      where: { id: contentId },
      data: {
        reviewStatus: SocialReviewStatus.REJECTED,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewNote: note,
        // 拒绝后回到草稿状态
        status: SocialContentStatus.DRAFT,
      },
    });
  }

  /**
   * 重新提交审核
   */
  async resubmitForReview(userId: string, contentId: string) {
    const content = await this.prisma.socialContent.findFirst({
      where: { id: contentId, userId },
    });

    if (!content) {
      throw new NotFoundException("内容不存在");
    }

    if (content.reviewStatus !== SocialReviewStatus.REJECTED) {
      throw new Error("只有被拒绝的内容可以重新提交审核");
    }

    return this.prisma.socialContent.update({
      where: { id: contentId },
      data: {
        reviewStatus: SocialReviewStatus.PENDING,
        reviewedById: null,
        reviewedAt: null,
        reviewNote: null,
      },
    });
  }
}
