import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { AuditService } from "../../../common/audit";
import {
  TopicType,
  TopicRole,
  MessageContentType,
  Prisma,
} from "@prisma/client";
import {
  CreateTopicDto,
  UpdateTopicDto,
  AddMemberDto,
  AddMembersDto,
  UpdateMemberDto,
  AddAIMemberDto,
  UpdateAIMemberDto,
  SendMessageDto,
  AddResourceDto,
  GenerateSummaryDto,
  ForwardMessagesDto,
  BookmarkMessageDto,
} from "./dto";
import { ChatFacade } from "@/modules/ai-harness/facade";
import type { ChatMessage } from "@/modules/ai-harness/facade";
import {
  MissionContext,
  MissionExecutorService,
} from "@/modules/ai-harness/facade";
import { LruMap } from "@/common/utils/lru-map";
import {
  UrlParserService,
  ParsedUrl,
  AiResponseService,
  TopicMembershipService,
  TopicPublicService,
  TopicForwardBookmarkService,
  TopicEventEmitterService,
} from "./services";
import { BillingContext } from "../../platform/facade";

@Injectable()
export class AiTeamsService {
  private readonly logger = new Logger(AiTeamsService.name);
  private readonly kernelProcessIds = new LruMap<string, string>(500);

  constructor(
    private prisma: PrismaService,
    private chatFacade: ChatFacade,
    private urlParserService: UrlParserService,
    private aiResponseService: AiResponseService,
    private membershipService: TopicMembershipService,
    private publicService: TopicPublicService,
    private forwardBookmarkService: TopicForwardBookmarkService,
    @Optional() private auditService: AuditService,
    @Optional() private topicEventEmitter: TopicEventEmitterService,
    @Optional() private readonly missionExecutor?: MissionExecutorService,
  ) {}

  // ==================== Topic CRUD ====================

  async createTopic(userId: string, dto: CreateTopicDto) {
    const { memberIds, aiMembers, ...topicData } = dto;

    this.logger.log(
      `Creating topic for user ${userId}: ${JSON.stringify(dto)}`,
    );

    try {
      const topicId = await this.prisma.$transaction(async (tx) => {
        // 创建Topic
        const topic = await tx.topic.create({
          data: {
            ...topicData,
            createdById: userId,
            // 创建者自动成为Owner
            members: {
              create: {
                userId,
                role: TopicRole.OWNER,
              },
            },
          },
        });

        this.logger.log(`Topic created with id: ${topic.id}`);

        // 添加初始成员
        if (memberIds && memberIds.length > 0) {
          await tx.topicMember.createMany({
            data: memberIds
              .filter((id) => id !== userId) // 排除创建者
              .map((id) => ({
                topicId: topic.id,
                userId: id,
                role: TopicRole.MEMBER,
              })),
            skipDuplicates: true,
          });
        }

        // 添加初始AI成员
        if (aiMembers && aiMembers.length > 0) {
          await tx.topicAIMember.createMany({
            data: aiMembers.map((ai) => ({
              topicId: topic.id,
              aiModel: ai.aiModel,
              displayName: ai.displayName,
              roleDescription: ai.roleDescription,
              systemPrompt: ai.systemPrompt,
              addedById: userId,
            })),
          });
        }

        return topic.id;
      });

      this.logger.log(`Transaction committed, fetching topic ${topicId}`);

      // 记录审计日志
      if (this.auditService) {
        await this.auditService.logTopicCreate(userId, topicId, dto.name);
      }

      // 触发 Webhook 事件
      if (this.topicEventEmitter) {
        this.topicEventEmitter.emitTopicEvent("topic.created", {
          topicId,
          userId,
          name: dto.name,
          type: dto.type,
        });
      }

      // 返回完整的Topic信息
      return this.getTopicById(topicId, userId);
    } catch (error) {
      this.logger.error(`Failed to create topic: ${error}`);
      throw error;
    }
  }

  async getTopics(
    userId: string,
    options?: { type?: TopicType; search?: string },
  ) {
    const where: Prisma.TopicWhereInput = {
      members: {
        some: { userId },
      },
      archivedAt: null,
      // Exclude planning topics — they share the same Topic table but belong to AI Planning module
      // Use OR to handle nullable metadata: include topics with null metadata OR metadata without planningMode=true
      OR: [
        { metadata: { equals: Prisma.DbNull } },
        {
          NOT: {
            metadata: {
              path: ["planningMode"],
              equals: true,
            },
          },
        },
      ],
    };

    if (options?.type) {
      where.type = options.type;
    }

    if (options?.search) {
      where.OR = [
        { name: { contains: options.search, mode: "insensitive" } },
        { description: { contains: options.search, mode: "insensitive" } },
      ];
    }

    const topics = await this.prisma.topic.findMany({
      where,
      include: {
        createdBy: {
          select: { id: true, username: true, fullName: true, avatarUrl: true },
        },
        members: {
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
        },
        aiMembers: {
          select: {
            id: true,
            aiModel: true,
            displayName: true,
            avatar: true,
            roleDescription: true,
          },
        },
        _count: {
          select: {
            messages: true,
            resources: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    // 批量计算未读消息数
    const topicIds = topics.map((t) => t.id);
    let unreadCounts: Array<{ topic_id: string; unread_count: bigint }> = [];

    // 只有当有topics时才执行查询，避免空数组导致SQL错误
    if (topicIds.length > 0) {
      // 使用 Prisma.join 和类型转换来避免 text/uuid 类型不匹配错误
      unreadCounts = await this.prisma.$queryRaw<
        Array<{ topic_id: string; unread_count: bigint }>
      >`
        SELECT
          tm.topic_id,
          COUNT(*) as unread_count
        FROM topic_messages tm
        LEFT JOIN topic_members tmem ON tm.topic_id = tmem.topic_id AND tmem.user_id = ${userId}::text
        WHERE tm.topic_id::text IN (${Prisma.join(topicIds)})
          AND tm.deleted_at IS NULL
          AND (
            tmem.last_read_at IS NULL
            OR tm.created_at > tmem.last_read_at
          )
        GROUP BY tm.topic_id
      `;
    }

    const unreadMap = new Map<string, number>();
    unreadCounts.forEach((row) => {
      unreadMap.set(row.topic_id, Number(row.unread_count));
    });

    const topicsWithUnread = topics.map((topic) => {
      const membership = topic.members.find((m) => m.userId === userId);
      let unreadCount = 0;

      if (membership?.lastReadAt) {
        unreadCount = unreadMap.get(topic.id) || 0;
      } else {
        unreadCount = topic._count.messages;
      }

      return {
        ...topic,
        unreadCount,
        memberCount: topic.members.length,
        aiMemberCount: topic.aiMembers.length,
      };
    });

    return topicsWithUnread;
  }

  async getTopicById(topicId: string, userId: string) {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      include: {
        createdBy: {
          select: { id: true, username: true, fullName: true, avatarUrl: true },
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                fullName: true,
                avatarUrl: true,
                email: true,
              },
            },
          },
          orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
        },
        aiMembers: {
          orderBy: { createdAt: "asc" },
        },
        _count: {
          select: {
            messages: true,
            resources: true,
          },
        },
      },
    });

    if (!topic) {
      throw new NotFoundException("Topic not found");
    }

    // 检查用户是否是成员
    const membership = topic.members.find((m) => m.userId === userId);
    if (!membership && topic.type === TopicType.PRIVATE) {
      throw new ForbiddenException("You are not a member of this topic");
    }

    return {
      ...topic,
      currentUserRole: membership?.role,
      memberCount: topic.members.length,
      aiMemberCount: topic.aiMembers.length,
    };
  }

  async updateTopic(topicId: string, userId: string, dto: UpdateTopicDto) {
    await this.checkTopicPermission(topicId, userId, [
      TopicRole.OWNER,
      TopicRole.ADMIN,
    ]);

    const result = await this.prisma.topic.update({
      where: { id: topicId },
      data: dto,
      include: {
        createdBy: {
          select: { id: true, username: true, fullName: true, avatarUrl: true },
        },
      },
    });

    // 触发 Webhook 事件
    if (this.topicEventEmitter) {
      this.topicEventEmitter.emitTopicEvent("topic.updated", {
        topicId,
        userId,
        changes: dto,
      });
    }

    return result;
  }

  async archiveTopic(topicId: string, userId: string) {
    await this.checkTopicPermission(topicId, userId, [TopicRole.OWNER]);

    const result = await this.prisma.topic.update({
      where: { id: topicId },
      data: {
        type: TopicType.ARCHIVED,
        archivedAt: new Date(),
      },
    });

    // 触发 Webhook 事件
    if (this.topicEventEmitter) {
      this.topicEventEmitter.emitTopicEvent("topic.archived", {
        topicId,
        userId,
      });
    }

    return result;
  }

  async deleteTopic(topicId: string, userId: string) {
    await this.checkTopicPermission(topicId, userId, [TopicRole.OWNER]);

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.missionLog.deleteMany({
        where: { mission: { topicId } },
      });

      await tx.agentTask.deleteMany({
        where: { mission: { topicId } },
      });

      await tx.teamMission.deleteMany({
        where: { topicId },
      });

      await tx.topicMessageReaction.deleteMany({
        where: { message: { topicId } },
      });

      await tx.topicMessageMention.deleteMany({
        where: { message: { topicId } },
      });

      await tx.topicMessageAttachment.deleteMany({
        where: { message: { topicId } },
      });

      const messageIds = await tx.topicMessage.findMany({
        where: { topicId },
        select: { id: true },
      });
      if (messageIds.length > 0) {
        await tx.topicMessageBookmark.deleteMany({
          where: { messageId: { in: messageIds.map((m) => m.id) } },
        });
      }

      await tx.topicMessageForward.deleteMany({
        where: {
          OR: [{ sourceTopicId: topicId }, { targetTopicId: topicId }],
        },
      });

      await tx.topicSummary.deleteMany({
        where: { topicId },
      });

      await tx.topicResource.deleteMany({
        where: { topicId },
      });

      await tx.topicMessage.deleteMany({
        where: { topicId },
      });

      await tx.topicAIMember.deleteMany({
        where: { topicId },
      });

      await tx.topicMember.deleteMany({
        where: { topicId },
      });

      return tx.topic.delete({
        where: { id: topicId },
      });
    });

    // 触发 Webhook 事件
    if (this.topicEventEmitter) {
      this.topicEventEmitter.emitTopicEvent("topic.deleted", {
        topicId,
        userId,
      });
    }

    return result;
  }

  // ==================== Member Management (Delegated) ====================

  async addMember(topicId: string, userId: string, dto: AddMemberDto) {
    return this.membershipService.addMember(topicId, userId, dto);
  }

  async addMemberByEmail(
    topicId: string,
    userId: string,
    email: string,
    role?: TopicRole,
  ) {
    return this.membershipService.addMemberByEmail(
      topicId,
      userId,
      email,
      role,
    );
  }

  async addMembers(topicId: string, userId: string, dto: AddMembersDto) {
    return this.membershipService.addMembers(topicId, userId, dto);
  }

  async updateMember(
    topicId: string,
    userId: string,
    memberId: string,
    dto: UpdateMemberDto,
  ) {
    return this.membershipService.updateMember(topicId, userId, memberId, dto);
  }

  async removeMember(topicId: string, userId: string, memberId: string) {
    return this.membershipService.removeMember(topicId, userId, memberId);
  }

  async leaveTopic(topicId: string, userId: string) {
    return this.membershipService.leaveTopic(topicId, userId);
  }

  // ==================== AI Member Management (Delegated) ====================

  async addAIMember(topicId: string, userId: string, dto: AddAIMemberDto) {
    const result = await this.membershipService.addAIMember(
      topicId,
      userId,
      dto,
    );

    // 记录审计日志
    if (this.auditService && result) {
      await this.auditService.logMemberAdd(
        userId,
        topicId,
        result.id,
        dto.displayName,
      );
    }

    return result;
  }

  async updateAIMember(
    topicId: string,
    userId: string,
    aiMemberId: string,
    dto: UpdateAIMemberDto,
  ) {
    return this.membershipService.updateAIMember(
      topicId,
      userId,
      aiMemberId,
      dto,
    );
  }

  async removeAIMember(topicId: string, userId: string, aiMemberId: string) {
    return this.membershipService.removeAIMember(topicId, userId, aiMemberId);
  }

  async updateAIMemberTeamRole(
    topicId: string,
    userId: string,
    aiMemberId: string,
    dto: {
      agentName?: string;
      agentIdentity?: string;
      isLeader?: boolean;
      expertiseAreas?: string[];
      workStyle?: string;
    },
  ) {
    return this.membershipService.updateAIMemberTeamRole(
      topicId,
      userId,
      aiMemberId,
      dto,
    );
  }

  async setupDebateAIs(
    topicId: string,
    userId: string,
    redAiModel: string,
    blueAiModel: string,
    debateTopic?: string,
  ) {
    return this.membershipService.setupDebateAIs(
      topicId,
      userId,
      redAiModel,
      blueAiModel,
      debateTopic,
    );
  }

  // ==================== Messages ====================

  async getMessages(
    topicId: string,
    userId: string,
    options?: { cursor?: string; limit?: number; before?: Date },
  ) {
    await this.checkTopicMembership(topicId, userId);

    const limit = options?.limit || 50;
    const where: Prisma.TopicMessageWhereInput = {
      topicId,
      deletedAt: null,
    };

    if (options?.cursor) {
      where.id = { lt: options.cursor };
    }

    if (options?.before) {
      where.createdAt = { lt: options.before };
    }

    const messages = await this.prisma.topicMessage.findMany({
      where,
      include: {
        sender: {
          select: { id: true, username: true, fullName: true, avatarUrl: true },
        },
        aiMember: {
          select: {
            id: true,
            aiModel: true,
            displayName: true,
            avatar: true,
            roleDescription: true,
          },
        },
        mentions: {
          include: {
            user: {
              select: { id: true, username: true, fullName: true },
            },
            aiMember: {
              select: { id: true, displayName: true },
            },
          },
        },
        attachments: true,
        reactions: {
          include: {
            user: {
              select: { id: true, username: true },
            },
          },
        },
        replyTo: {
          select: {
            id: true,
            content: true,
            sender: {
              select: { id: true, username: true, fullName: true },
            },
            aiMember: {
              select: { id: true, displayName: true },
            },
          },
        },
        _count: {
          select: { replies: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    });

    const hasMore = messages.length > limit;
    if (hasMore) {
      messages.pop();
    }

    return {
      messages: messages.reverse(),
      hasMore,
      nextCursor: hasMore ? messages[0]?.id : null,
    };
  }

  async sendMessage(topicId: string, userId: string, dto: SendMessageDto) {
    await this.checkTopicMembership(topicId, userId);

    // 检测并解析消息中的 URL
    let parsedUrls: ParsedUrl[] = [];
    try {
      const { parsedUrls: urls } =
        await this.urlParserService.detectAndParseUrls(dto.content);
      parsedUrls = urls;
      if (urls.length > 0) {
        this.logger.log(
          `Detected and parsed ${urls.length} URLs in message for topic ${topicId}`,
        );
      }
    } catch (error) {
      this.logger.warn(`Failed to parse URLs in message: ${error}`);
    }

    const message = await this.prisma.$transaction(async (tx) => {
      const msg = await tx.topicMessage.create({
        data: {
          topicId,
          senderId: userId,
          content: dto.content,
          contentType: dto.contentType || MessageContentType.TEXT,
          replyToId: dto.replyToId,
          parsedUrls:
            parsedUrls.length > 0
              ? (parsedUrls as unknown as Prisma.InputJsonValue)
              : undefined,
        },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              fullName: true,
              avatarUrl: true,
            },
          },
        },
      });

      // 创建mentions
      if (dto.mentions && dto.mentions.length > 0) {
        await tx.topicMessageMention.createMany({
          data: dto.mentions.map((m) => ({
            messageId: msg.id,
            userId: m.userId,
            aiMemberId: m.aiMemberId,
            mentionType: m.mentionType,
          })),
        });
      }

      // 创建attachments
      if (dto.attachments && dto.attachments.length > 0) {
        await tx.topicMessageAttachment.createMany({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- linkPreview JSON shape varies
          data: dto.attachments.map((a) => ({
            messageId: msg.id,
            type: a.type,
            name: a.name,
            url: a.url,
            size: a.size,
            mimeType: a.mimeType,
            resourceId: a.resourceId,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON field type mismatch
            linkPreview: a.linkPreview as any,
          })),
        });
      }

      // 更新Topic的updatedAt
      await tx.topic.update({
        where: { id: topicId },
        data: { updatedAt: new Date() },
      });

      return msg;
    });

    // 记录审计日志
    if (this.auditService) {
      await this.auditService.logMessageSend(
        userId,
        topicId,
        message.id,
        false,
      );
    }

    // 触发 Webhook 事件
    if (this.topicEventEmitter) {
      this.topicEventEmitter.emitTopicEvent("message.created", {
        topicId,
        messageId: message.id,
        senderId: userId,
        content: dto.content.slice(0, 200), // 限制长度
      });
    }

    // 返回完整消息
    return this.prisma.topicMessage.findUnique({
      where: { id: message.id },
      include: {
        sender: {
          select: { id: true, username: true, fullName: true, avatarUrl: true },
        },
        aiMember: {
          select: {
            id: true,
            aiModel: true,
            displayName: true,
            avatar: true,
            roleDescription: true,
          },
        },
        mentions: {
          include: {
            user: { select: { id: true, username: true, fullName: true } },
            aiMember: { select: { id: true, displayName: true } },
          },
        },
        attachments: true,
        reactions: true,
        replyTo: {
          select: {
            id: true,
            content: true,
            sender: { select: { id: true, username: true, fullName: true } },
            aiMember: { select: { id: true, displayName: true } },
          },
        },
      },
    });
  }

  async deleteMessage(topicId: string, userId: string, messageId: string) {
    const message = await this.prisma.topicMessage.findFirst({
      where: { id: messageId, topicId },
    });

    if (!message) {
      throw new NotFoundException("Message not found");
    }

    if (message.senderId !== userId) {
      await this.checkTopicPermission(topicId, userId, [
        TopicRole.OWNER,
        TopicRole.ADMIN,
      ]);
    }

    return this.prisma.topicMessage.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    });
  }

  async addReaction(
    topicId: string,
    userId: string,
    messageId: string,
    emoji: string,
  ) {
    await this.checkTopicMembership(topicId, userId);

    const message = await this.prisma.topicMessage.findFirst({
      where: { id: messageId, topicId, deletedAt: null },
    });

    if (!message) {
      throw new NotFoundException("Message not found");
    }

    return this.prisma.topicMessageReaction.upsert({
      where: {
        messageId_userId_emoji: { messageId, userId, emoji },
      },
      update: {},
      create: {
        messageId,
        userId,
        emoji,
      },
    });
  }

  async removeReaction(
    topicId: string,
    userId: string,
    messageId: string,
    emoji: string,
  ) {
    await this.checkTopicMembership(topicId, userId);

    return this.prisma.topicMessageReaction.deleteMany({
      where: { messageId, userId, emoji },
    });
  }

  async markAsRead(topicId: string, userId: string, messageId?: string) {
    const membership = await this.prisma.topicMember.findUnique({
      where: {
        topicId_userId: { topicId, userId },
      },
    });

    if (!membership) {
      throw new NotFoundException("Not a member");
    }

    let lastReadAt = new Date();

    if (messageId) {
      const message = await this.prisma.topicMessage.findUnique({
        where: { id: messageId },
        select: { createdAt: true },
      });
      if (message) {
        lastReadAt = message.createdAt;
      }
    }

    return this.prisma.topicMember.update({
      where: { id: membership.id },
      data: { lastReadAt },
    });
  }

  // ==================== Resources ====================

  async getResources(topicId: string, userId: string) {
    await this.checkTopicMembership(topicId, userId);

    return this.prisma.topicResource.findMany({
      where: { topicId },
      include: {
        addedBy: {
          select: { id: true, username: true, fullName: true },
        },
        resource: {
          select: { id: true, title: true, type: true, sourceUrl: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async addResource(topicId: string, userId: string, dto: AddResourceDto) {
    await this.checkTopicMembership(topicId, userId);

    return this.prisma.topicResource.create({
      data: {
        topicId,
        addedById: userId,
        ...dto,
      },
      include: {
        addedBy: {
          select: { id: true, username: true, fullName: true },
        },
      },
    });
  }

  async removeResource(topicId: string, userId: string, resourceId: string) {
    const resource = await this.prisma.topicResource.findFirst({
      where: { id: resourceId, topicId },
    });

    if (!resource) {
      throw new NotFoundException("Resource not found");
    }

    if (resource.addedById !== userId) {
      await this.checkTopicPermission(topicId, userId, [
        TopicRole.OWNER,
        TopicRole.ADMIN,
      ]);
    }

    return this.prisma.topicResource.delete({
      where: { id: resourceId },
    });
  }

  // ==================== Summaries ====================

  async getSummaries(topicId: string, userId: string) {
    await this.checkTopicMembership(topicId, userId);

    return this.prisma.topicSummary.findMany({
      where: { topicId },
      include: {
        createdBy: {
          select: { id: true, username: true, fullName: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async generateSummary(
    topicId: string,
    userId: string,
    dto: GenerateSummaryDto,
  ) {
    // ★ AI Kernel: 创建进程
    let kernelProcessId: string | undefined;
    if (this.missionExecutor) {
      try {
        const kr = await this.missionExecutor.execute({
          userId,
          agentId: "ai-teams-summary",
          teamSessionId: topicId,
          input: { action: "generate-summary" },
        });
        kernelProcessId = kr.processId;
        this.kernelProcessIds.set(topicId, kernelProcessId);
      } catch {
        /* kernel optional */
      }
    }

    const runSummary = async () => {
      await this.checkTopicMembership(topicId, userId);

      const topic = await this.prisma.topic.findUnique({
        where: { id: topicId },
        include: {
          members: {
            include: {
              user: { select: { id: true, username: true, fullName: true } },
            },
          },
          aiMembers: {
            select: { id: true, displayName: true },
          },
        },
      });

      if (!topic) {
        throw new NotFoundException("Topic not found");
      }

      const where: Prisma.TopicMessageWhereInput = {
        topicId,
        deletedAt: null,
      };

      if (dto.fromMessageId) {
        const fromMsg = await this.prisma.topicMessage.findUnique({
          where: { id: dto.fromMessageId },
          select: { createdAt: true },
        });
        if (fromMsg) {
          const existing =
            typeof where.createdAt === "object" &&
            where.createdAt !== null &&
            !(where.createdAt instanceof Date)
              ? (where.createdAt as Prisma.DateTimeFilter)
              : {};
          where.createdAt = { ...existing, gte: fromMsg.createdAt };
        }
      }

      if (dto.toMessageId) {
        const toMsg = await this.prisma.topicMessage.findUnique({
          where: { id: dto.toMessageId },
          select: { createdAt: true },
        });
        if (toMsg) {
          const existing =
            typeof where.createdAt === "object" &&
            where.createdAt !== null &&
            !(where.createdAt instanceof Date)
              ? (where.createdAt as Prisma.DateTimeFilter)
              : {};
          where.createdAt = { ...existing, lte: toMsg.createdAt };
        }
      }

      const messages = await this.prisma.topicMessage.findMany({
        where,
        include: {
          sender: { select: { username: true, fullName: true } },
          aiMember: { select: { displayName: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 500,
      });

      if (messages.length === 0) {
        throw new BadRequestException("No messages to summarize");
      }

      const aiModel = dto.aiModel || "grok";
      const messagesForSummary = messages.map((m) => {
        const sender = m.sender
          ? m.sender.fullName || m.sender.username || "User"
          : m.aiMember?.displayName || "Unknown";
        return {
          sender,
          content: m.content,
          timestamp: m.createdAt.toISOString(),
        };
      });

      this.logger.log(
        `Generating summary for topic ${topicId} using ${aiModel}`,
      );
      let summaryContent: string;

      try {
        // 构建摘要提示词
        const summaryPrompt = `请为以下对话生成一份专业的讨论纪要，包含：主要议题、关键观点、结论和待办事项。

对话内容：
${messagesForSummary.map((m) => `[${m.sender}]: ${m.content}`).join("\n")}`;

        const summaryMessages: ChatMessage[] = [
          { role: "user", content: summaryPrompt },
        ];
        const result = await this.chatFacade.chat({
          messages: summaryMessages,
          model: aiModel,
          taskProfile: { creativity: "low", outputLength: "standard" },
        });
        summaryContent = result.content;
      } catch (error) {
        this.logger.error(`Failed to generate summary: ${error}`);
        summaryContent = `## 讨论纪要

### 讨论主题
${topic.name}

### 参与者
${topic.members.map((m) => m.user.fullName || m.user.username).join(", ")}
AI: ${topic.aiMembers.map((ai) => ai.displayName).join(", ")}

### 消息数量
共 ${messages.length} 条消息

### 主要内容
${messagesForSummary
  .slice(0, 10)
  .map((m) => `- **${m.sender}**: ${m.content.substring(0, 100)}...`)
  .join("\n")}

---
*生成时间: ${new Date().toISOString()}*
*使用模型: ${aiModel}*
*注意: AI服务暂时不可用，这是基础摘要*`;
      }

      return this.prisma.topicSummary.create({
        data: {
          topicId,
          title: dto.title || `${topic.name} - 讨论纪要`,
          content: summaryContent,
          fromMessageId: dto.fromMessageId,
          toMessageId: dto.toMessageId,
          generatedBy: aiModel,
          prompt: `Generated summary for ${messages.length} messages`,
          createdById: userId,
        },
        include: {
          createdBy: {
            select: { id: true, username: true, fullName: true },
          },
        },
      });
    };

    return BillingContext.run(
      {
        userId,
        moduleType: "ai-teams",
        operationType: "summary",
        referenceId: topicId,
      },
      () =>
        kernelProcessId
          ? MissionContext.run(
              { agentProcessId: kernelProcessId, userId },
              runSummary,
            )
          : runSummary(),
    );
  }

  async deleteSummary(topicId: string, userId: string, summaryId: string) {
    const summary = await this.prisma.topicSummary.findFirst({
      where: { id: summaryId, topicId },
    });

    if (!summary) {
      throw new NotFoundException("Summary not found");
    }

    if (summary.createdById !== userId) {
      await this.checkTopicPermission(topicId, userId, [
        TopicRole.OWNER,
        TopicRole.ADMIN,
      ]);
    }

    return this.prisma.topicSummary.delete({
      where: { id: summaryId },
    });
  }

  // ==================== AI Response (Delegated) ====================

  async generateAIResponse(
    topicId: string,
    userId: string,
    aiMemberId: string,
    contextMessageIds: string[],
    debateRole?: {
      role: "red" | "blue";
      opponent: { id: string; displayName: string };
      topic: string;
    } | null,
  ) {
    await this.checkTopicMembership(topicId, userId);
    return this.aiResponseService.generateAIResponse(
      topicId,
      userId,
      aiMemberId,
      contextMessageIds,
      debateRole,
    );
  }

  async createAIMessage(
    topicId: string,
    aiMemberId: string,
    content: string,
    modelUsed: string,
    tokensUsed?: number,
  ) {
    return this.aiResponseService.createAIMessage(
      topicId,
      aiMemberId,
      content,
      modelUsed,
      tokensUsed,
    );
  }

  async parseAIMentionsFromContent(
    topicId: string,
    content: string,
    excludeAiMemberId?: string,
  ): Promise<Array<{ id: string; displayName: string }>> {
    return this.aiResponseService.parseAIMentionsFromContent(
      topicId,
      content,
      excludeAiMemberId,
    );
  }

  // ==================== Forward & Bookmark (Delegated) ====================

  async forwardMessages(
    topicId: string,
    userId: string,
    dto: ForwardMessagesDto,
  ) {
    return this.forwardBookmarkService.forwardMessages(topicId, userId, dto);
  }

  async bookmarkMessage(
    topicId: string,
    userId: string,
    messageId: string,
    dto: BookmarkMessageDto,
  ) {
    return this.forwardBookmarkService.bookmarkMessage(
      topicId,
      userId,
      messageId,
      dto,
    );
  }

  async unbookmarkMessage(topicId: string, userId: string, messageId: string) {
    return this.forwardBookmarkService.unbookmarkMessage(
      topicId,
      userId,
      messageId,
    );
  }

  async getBookmarks(userId: string, options?: { category?: string }) {
    return this.forwardBookmarkService.getBookmarks(userId, options);
  }

  async getBookmarkCategories(userId: string) {
    return this.forwardBookmarkService.getBookmarkCategories(userId);
  }

  // ==================== Public Teams (Delegated) ====================

  async getPublicTopics(options?: { search?: string; limit?: number }) {
    return this.publicService.getPublicTopics(options);
  }

  async requestToJoinTopic(
    topicId: string,
    userId: string,
    requestMessage?: string,
  ) {
    return this.publicService.requestToJoinTopic(
      topicId,
      userId,
      requestMessage,
    );
  }

  async getJoinRequests(topicId: string, userId: string) {
    return this.publicService.getJoinRequests(topicId, userId);
  }

  async getMyJoinRequests(userId: string) {
    return this.publicService.getMyJoinRequests(userId);
  }

  async reviewJoinRequest(
    requestId: string,
    userId: string,
    approve: boolean,
    responseNote?: string,
  ) {
    return this.publicService.reviewJoinRequest(
      requestId,
      userId,
      approve,
      responseNote,
    );
  }

  async cancelJoinRequest(requestId: string, userId: string) {
    return this.publicService.cancelJoinRequest(requestId, userId);
  }

  // ==================== User Search ====================

  async searchUserByEmail(email: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: "insensitive",
        },
      },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        avatarUrl: true,
      },
    });

    if (!user) {
      throw new NotFoundException("User not found with this email");
    }

    return user;
  }

  async searchUsers(query: string, limit: number = 10) {
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { email: { contains: query, mode: "insensitive" } },
          { username: { contains: query, mode: "insensitive" } },
          { fullName: { contains: query, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        avatarUrl: true,
      },
      take: limit,
    });

    return users;
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
      throw new ForbiddenException("You are not a member of this topic");
    }

    return topic.members[0];
  }

  private async checkTopicPermission(
    topicId: string,
    userId: string,
    allowedRoles: TopicRole[],
  ) {
    const membership = await this.prisma.topicMember.findUnique({
      where: {
        topicId_userId: { topicId, userId },
      },
    });

    if (!membership) {
      throw new ForbiddenException("You are not a member of this topic");
    }

    if (!allowedRoles.includes(membership.role)) {
      throw new ForbiddenException(
        "You do not have permission to perform this action",
      );
    }

    return membership;
  }
}
