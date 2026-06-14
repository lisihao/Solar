import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Res,
  Logger,
} from "@nestjs/common";
import { Response } from "express";
import { Throttle } from "@nestjs/throttler";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { OrganizeChatService } from "./organize-chat.service";
import { OrganizeChatDto } from "./dto/organize-chat.dto";

@ApiTags("Organize Chat")
@Controller("library/organize-chat")
@UseGuards(JwtAuthGuard)
export class OrganizeChatController {
  private readonly logger = new Logger(OrganizeChatController.name);

  constructor(private readonly service: OrganizeChatService) {}

  /** 对话整理流式（SSE）— POST /api/v1/library/organize-chat/stream */
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post("stream")
  @ApiOperation({ summary: "对话式整理（SSE 流式）" })
  async stream(
    @Request() req: { user: { id: string } },
    @Body() dto: OrganizeChatDto,
    @Res() res: Response,
  ) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const write = (event: unknown) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      for await (const event of this.service.streamOrganize(req.user.id, dto)) {
        write(event);
        if (event.type === "done" || event.type === "error") break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[organize-chat] stream failed: ${message}`);
      write({ type: "error", message });
    } finally {
      res.end();
    }
  }

  /** 代理掐断后对账：取最近消息恢复结果（同 ai-ask reconcile 范式）*/
  @Get("sessions/:sessionId/messages")
  @ApiOperation({ summary: "取整理会话最近消息（代理兜底对账）" })
  async recentMessages(
    @Request() req: { user: { id: string } },
    @Param("sessionId") sessionId: string,
    @Query("limit") limit?: string,
  ) {
    const n = limit ? Math.min(parseInt(limit, 10) || 6, 20) : 6;
    return this.service.getRecentMessages(req.user.id, sessionId, n);
  }
}
