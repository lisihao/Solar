import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  MessageContentType,
  TopicType,
  Prisma,
  MergeMode,
} from "@prisma/client";
import { ForwardMessagesDto, BookmarkMessageDto } from "../../dto";

/**
 * Service responsible for message forwarding and bookmarking
 * Extracted from AiTeamsService to reduce file size and improve maintainability
 */
@Injectable()
export class TopicForwardBookmarkService {
  constructor(private prisma: PrismaService) {}

  // ==================== Message Forward ====================

  /**
   * 转发消息到其他Topic或用户
   */
  async forwardMessages(
    topicId: string,
    userId: string,
    dto: ForwardMessagesDto,
  ) {
    await this.checkTopicMembership(topicId, userId);

    // 验证所有消息都存在于当前Topic
    const messages = await this.prisma.topicMessage.findMany({
      where: {
        id: { in: dto.messageIds },
        topicId,
        deletedAt: null,
      },
      include: {
        sender: { select: { username: true, fullName: true } },
        aiMember: { select: { displayName: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    if (messages.length !== dto.messageIds.length) {
      throw new BadRequestException("Some messages not found or deleted");
    }

    // 验证目标Topic（如果转发到Topic）
    if (dto.targetType === "TOPIC" && dto.targetTopicId) {
      await this.checkTopicMembership(dto.targetTopicId, userId);
    }

    // 根据合并模式处理消息
    let forwardedContent: string;
    const mergeMode = dto.mergeMode || "SEPARATE";

    if (mergeMode === "MERGED") {
      // 合并所有消息为一条
      forwardedContent = messages
        .map((m) => {
          const sender =
            m.sender?.fullName ||
            m.sender?.username ||
            m.aiMember?.displayName ||
            "Unknown";
          return `**${sender}**: ${m.content}`;
        })
        .join("\n\n---\n\n");

      if (dto.forwardNote) {
        forwardedContent = `📤 *转发备注: ${dto.forwardNote}*\n\n---\n\n${forwardedContent}`;
      }
    } else if (mergeMode === "SUMMARY") {
      // AI生成摘要（简化版，实际可调用AI服务）
      const contentPreview = messages
        .slice(0, 5)
        .map((m) => m.content.substring(0, 100))
        .join(" | ");
      forwardedContent = `📋 **转发摘要** (${messages.length}条消息)\n\n${contentPreview}...\n\n${dto.forwardNote ? `备注: ${dto.forwardNote}` : ""}`;
    } else {
      // SEPARATE - 但我们创建一个转发记录，实际消息分别发送
      forwardedContent = messages[0].content;
    }

    // 创建转发记录
    const forwardRecord = await this.prisma.topicMessageForward.create({
      data: {
        originalMessageIds: dto.messageIds,
        sourceTopicId: topicId,
        targetType: dto.targetType,
        targetTopicId: dto.targetTopicId,
        targetUserId: dto.targetUserId,
        mergeMode: mergeMode as MergeMode,
        forwardNote: dto.forwardNote,
        forwardedById: userId,
      },
    });

    // 如果是转发到Topic，创建新消息
    if (dto.targetType === "TOPIC" && dto.targetTopicId) {
      if (mergeMode === "SEPARATE") {
        // 分别发送每条消息
        for (const msg of messages) {
          const sender =
            msg.sender?.fullName ||
            msg.sender?.username ||
            msg.aiMember?.displayName ||
            "Unknown";
          await this.prisma.topicMessage.create({
            data: {
              topicId: dto.targetTopicId,
              senderId: userId,
              content: `📤 *转发自 ${sender}*:\n\n${msg.content}`,
              contentType: MessageContentType.TEXT,
            },
          });
        }
      } else {
        // 发送合并后的消息
        const newMessage = await this.prisma.topicMessage.create({
          data: {
            topicId: dto.targetTopicId,
            senderId: userId,
            content: forwardedContent,
            contentType: MessageContentType.TEXT,
          },
        });

        // 更新转发记录
        await this.prisma.topicMessageForward.update({
          where: { id: forwardRecord.id },
          data: { forwardedMessageId: newMessage.id },
        });
      }

      // 更新目标Topic的updatedAt
      await this.prisma.topic.update({
        where: { id: dto.targetTopicId },
        data: { updatedAt: new Date() },
      });
    }

    return {
      success: true,
      forwardId: forwardRecord.id,
      messageCount: messages.length,
      targetType: dto.targetType,
      mergeMode,
    };
  }

  // ==================== Message Bookmark ====================

  /**
   * 收藏消息
   */
  async bookmarkMessage(
    topicId: string,
    userId: string,
    messageId: string,
    dto: BookmarkMessageDto,
  ) {
    await this.checkTopicMembership(topicId, userId);

    // 验证消息存在
    const message = await this.prisma.topicMessage.findFirst({
      where: { id: messageId, topicId, deletedAt: null },
    });

    if (!message) {
      throw new NotFoundException("Message not found");
    }

    // 创建或更新收藏
    return this.prisma.topicMessageBookmark.upsert({
      where: {
        messageId_userId: { messageId, userId },
      },
      update: {
        category: dto.category,
        note: dto.note,
        tags: dto.tags || [],
      },
      create: {
        messageId,
        userId,
        category: dto.category,
        note: dto.note,
        tags: dto.tags || [],
      },
    });
  }

  /**
   * 取消收藏
   */
  async unbookmarkMessage(topicId: string, userId: string, messageId: string) {
    await this.checkTopicMembership(topicId, userId);

    return this.prisma.topicMessageBookmark.deleteMany({
      where: { messageId, userId },
    });
  }

  /**
   * 获取用户的收藏消息
   */
  async getBookmarks(userId: string, options?: { category?: string }) {
    const where: Prisma.TopicMessageBookmarkWhereInput = { userId };

    if (options?.category) {
      where.category = options.category;
    }

    const bookmarks = await this.prisma.topicMessageBookmark.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    // 获取关联的消息详情
    const messageIds = bookmarks.map((b) => b.messageId);
    const messages = await this.prisma.topicMessage.findMany({
      where: { id: { in: messageIds } },
      include: {
        sender: { select: { id: true, username: true, fullName: true } },
        aiMember: { select: { id: true, displayName: true } },
        topic: { select: { id: true, name: true } },
      },
    });

    const messageMap = new Map(messages.map((m) => [m.id, m]));

    return bookmarks.map((b) => ({
      ...b,
      message: messageMap.get(b.messageId),
    }));
  }

  /**
   * 获取收藏分类列表
   */
  async getBookmarkCategories(userId: string) {
    const bookmarks = await this.prisma.topicMessageBookmark.findMany({
      where: { userId, category: { not: null } },
      select: { category: true },
      distinct: ["category"],
    });

    return bookmarks.map((b) => b.category).filter(Boolean);
  }

  // ==================== Helper Methods ====================

  private async checkTopicMembership(topicId: string, userId: string) {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      include: {
        members: {
          where: { userId },
        },
      },
    });

    if (!topic) {
      throw new NotFoundException("Topic not found");
    }

    if (topic.members.length === 0 && topic.type === TopicType.PRIVATE) {
      throw new BadRequestException("You are not a member of this topic");
    }

    return topic.members[0];
  }
}
