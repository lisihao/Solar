import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { CreateCommentDto, UpdateCommentDto } from "./dto";

/**
 * 评论服务
 *
 * 核心功能：
 * 1. 评论的CRUD
 * 2. 嵌套回复支持
 * 3. 点赞功能
 * 4. 软删除
 */
@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 创建评论
   */
  async createComment(userId: string, dto: CreateCommentDto) {
    // 如果是回复，验证父评论存在
    if (dto.parentId) {
      const parentComment = await this.prisma.comment.findUnique({
        where: { id: dto.parentId },
      });

      if (!parentComment) {
        throw new NotFoundException("Parent comment not found");
      }

      if (parentComment.isDeleted) {
        throw new ForbiddenException("Cannot reply to deleted comment");
      }
    }

    const comment = await this.prisma.comment.create({
      data: {
        userId,
        resourceId: dto.resourceId || null,
        source: dto.source || null,
        content: dto.content,
        parentId: dto.parentId,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });

    // 如果是回复，更新父评论的回复数
    if (dto.parentId) {
      await this.prisma.comment.update({
        where: { id: dto.parentId },
        data: {
          replyCount: {
            increment: 1,
          },
        },
      });
    }

    const identifier = dto.source || dto.resourceId || "unknown";
    this.logger.log(`Comment created for ${identifier} by user ${userId}`);

    return comment;
  }

  /**
   * 获取资源的评论（树形结构）
   */
  async getResourceComments(resourceId: string) {
    // 获取所有顶层评论（没有parent的）
    const topLevelComments = await this.prisma.comment.findMany({
      where: {
        resourceId,
        parentId: null,
        isDeleted: false,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
        replies: {
          where: {
            isDeleted: false,
          },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                fullName: true,
                avatarUrl: true,
              },
            },
            replies: {
              where: {
                isDeleted: false,
              },
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    fullName: true,
                    avatarUrl: true,
                  },
                },
              },
              orderBy: {
                createdAt: "asc",
              },
            },
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return topLevelComments;
  }

  /**
   * 获取 source 的评论（树形结构）
   * 用于 YouTube 视频等非 Resource 的评论
   */
  async getSourceComments(source: string) {
    const topLevelComments = await this.prisma.comment.findMany({
      where: {
        source,
        parentId: null,
        isDeleted: false,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
        replies: {
          where: {
            isDeleted: false,
          },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                fullName: true,
                avatarUrl: true,
              },
            },
            replies: {
              where: {
                isDeleted: false,
              },
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    fullName: true,
                    avatarUrl: true,
                  },
                },
              },
              orderBy: {
                createdAt: "asc",
              },
            },
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return topLevelComments;
  }

  /**
   * 获取 source 的评论统计
   */
  async getSourceCommentStats(source: string) {
    const total = await this.prisma.comment.count({
      where: {
        source,
        isDeleted: false,
      },
    });

    const topLevel = await this.prisma.comment.count({
      where: {
        source,
        parentId: null,
        isDeleted: false,
      },
    });

    return {
      total,
      topLevel,
      replies: total - topLevel,
    };
  }

  /**
   * 获取单个评论
   */
  async getComment(commentId: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
        parent: {
          select: {
            id: true,
            content: true,
            user: {
              select: {
                username: true,
              },
            },
          },
        },
        replies: {
          where: {
            isDeleted: false,
          },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                fullName: true,
                avatarUrl: true,
              },
            },
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    if (!comment) {
      throw new NotFoundException("Comment not found");
    }

    return comment;
  }

  /**
   * 更新评论
   */
  async updateComment(
    commentId: string,
    userId: string,
    dto: UpdateCommentDto,
  ) {
    // 验证所有权
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      throw new NotFoundException("Comment not found");
    }

    if (comment.userId !== userId) {
      throw new ForbiddenException("You can only update your own comments");
    }

    if (comment.isDeleted) {
      throw new ForbiddenException("Cannot update deleted comment");
    }

    const updated = await this.prisma.comment.update({
      where: { id: commentId },
      data: {
        content: dto.content,
        isEdited: true,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });

    this.logger.log(`Comment ${commentId} updated by user ${userId}`);

    return updated;
  }

  /**
   * 删除评论（软删除）
   */
  async deleteComment(commentId: string, userId: string) {
    // 验证所有权
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      throw new NotFoundException("Comment not found");
    }

    if (comment.userId !== userId) {
      throw new ForbiddenException("You can only delete your own comments");
    }

    // 软删除
    await this.prisma.comment.update({
      where: { id: commentId },
      data: {
        isDeleted: true,
        content: "[This comment has been deleted]",
      },
    });

    // 如果是回复，更新父评论的回复数
    if (comment.parentId) {
      await this.prisma.comment.update({
        where: { id: comment.parentId },
        data: {
          replyCount: {
            decrement: 1,
          },
        },
      });
    }

    this.logger.log(`Comment ${commentId} deleted by user ${userId}`);

    return { success: true };
  }

  /**
   * 点赞评论
   */
  async upvoteComment(commentId: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      throw new NotFoundException("Comment not found");
    }

    if (comment.isDeleted) {
      throw new ForbiddenException("Cannot upvote deleted comment");
    }

    const updated = await this.prisma.comment.update({
      where: { id: commentId },
      data: {
        upvoteCount: {
          increment: 1,
        },
      },
    });

    this.logger.log(`Comment ${commentId} upvoted`);

    return updated;
  }

  /**
   * 获取评论统计
   */
  async getCommentStats(resourceId: string) {
    const total = await this.prisma.comment.count({
      where: {
        resourceId,
        isDeleted: false,
      },
    });

    const topLevel = await this.prisma.comment.count({
      where: {
        resourceId,
        parentId: null,
        isDeleted: false,
      },
    });

    return {
      total,
      topLevel,
      replies: total - topLevel,
    };
  }
}
