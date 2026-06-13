import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { AppendChatMessageDto } from "./dto/append-message.dto";

export interface YoutubeAiChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  modelId: string | null;
  createdAt: Date;
}

@Injectable()
export class YoutubeAiChatService {
  private readonly logger = new Logger(YoutubeAiChatService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listMessages(
    userId: string,
    videoId: string,
  ): Promise<YoutubeAiChatMessage[]> {
    const rows = await this.prisma.youTubeAiChatMessage.findMany({
      where: { userId, videoId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        role: true,
        content: true,
        modelId: true,
        createdAt: true,
      },
    });

    return rows.map((row) => ({
      id: row.id,
      role: row.role === "assistant" ? "assistant" : "user",
      content: row.content,
      modelId: row.modelId,
      createdAt: row.createdAt,
    }));
  }

  async appendMessage(
    userId: string,
    dto: AppendChatMessageDto,
  ): Promise<YoutubeAiChatMessage> {
    const created = await this.prisma.youTubeAiChatMessage.create({
      data: {
        userId,
        videoId: dto.videoId,
        role: dto.role,
        content: dto.content,
        modelId: dto.modelId ?? null,
      },
      select: {
        id: true,
        role: true,
        content: true,
        modelId: true,
        createdAt: true,
      },
    });

    return {
      id: created.id,
      role: created.role === "assistant" ? "assistant" : "user",
      content: created.content,
      modelId: created.modelId,
      createdAt: created.createdAt,
    };
  }

  async clearMessages(userId: string, videoId: string): Promise<number> {
    const result = await this.prisma.youTubeAiChatMessage.deleteMany({
      where: { userId, videoId },
    });
    this.logger.log(
      `Cleared ${result.count} chat messages for user=${userId} video=${videoId}`,
    );
    return result.count;
  }
}
