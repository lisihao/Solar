import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Request,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AppendChatMessageDto } from "./dto/append-message.dto";
import { YoutubeAiChatService } from "./youtube-ai-chat.service";

interface AuthenticatedRequest {
  user: { id: string; email: string };
}

/**
 * YouTube 视频页 AI Chat 历史
 *
 * 维度：user × videoId — 同一用户在同一视频内的对话持续追加；
 * 切换视频或切换用户即另起一段（互不可见）。
 */
@ApiTags("YouTube AI Chat")
@Controller("youtube/ai-chat")
@UseGuards(JwtAuthGuard)
export class YoutubeAiChatController {
  constructor(private readonly service: YoutubeAiChatService) {}

  @Get()
  async list(
    @Request() req: AuthenticatedRequest,
    @Query("videoId") videoId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException("User not authenticated");
    if (!videoId?.trim()) {
      return { messages: [] };
    }
    const messages = await this.service.listMessages(userId, videoId.trim());
    return { messages };
  }

  @Post()
  async append(
    @Request() req: AuthenticatedRequest,
    @Body() dto: AppendChatMessageDto,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException("User not authenticated");
    const message = await this.service.appendMessage(userId, dto);
    return { message };
  }

  @Delete(":videoId")
  async clear(
    @Request() req: AuthenticatedRequest,
    @Param("videoId") videoId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException("User not authenticated");
    const cleared = await this.service.clearMessages(userId, videoId.trim());
    return { cleared };
  }
}
