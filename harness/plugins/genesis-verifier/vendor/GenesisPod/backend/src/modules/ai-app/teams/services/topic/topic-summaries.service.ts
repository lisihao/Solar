import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { TopicRole, Prisma } from "@prisma/client";
import { GenerateSummaryDto } from "../../dto";
import { ChatFacade, ChatMessage } from "@/modules/ai-harness/facade";
import { TopicCrudService } from "./topic-crud.service";

@Injectable()
export class TopicSummariesService {
  private readonly logger = new Logger(TopicSummariesService.name);

  constructor(
    private prisma: PrismaService,
    private chatFacade: ChatFacade,
    private topicCrudService: TopicCrudService,
  ) {}

  async getSummaries(topicId: string, userId: string) {
    await this.topicCrudService.checkTopicMembership(topicId, userId);

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
    await this.topicCrudService.checkTopicMembership(topicId, userId);

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

    this.logger.log(`Generating summary for topic ${topicId} using ${aiModel}`);
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
  }

  async deleteSummary(topicId: string, userId: string, summaryId: string) {
    const summary = await this.prisma.topicSummary.findFirst({
      where: { id: summaryId, topicId },
    });

    if (!summary) {
      throw new NotFoundException("Summary not found");
    }

    if (summary.createdById !== userId) {
      await this.topicCrudService.checkTopicPermission(topicId, userId, [
        TopicRole.OWNER,
        TopicRole.ADMIN,
      ]);
    }

    return this.prisma.topicSummary.delete({
      where: { id: summaryId },
    });
  }
}
