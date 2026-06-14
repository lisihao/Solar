import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Res,
  Logger,
  BadRequestException,
} from "@nestjs/common";
import { Response } from "express";
import { Throttle } from "@nestjs/throttler";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { AiAskService } from "./ai-ask.service";
import { CreateSessionDto, UpdateSessionDto, SendMessageDto } from "./dto";

@ApiTags("AI Ask")
@Controller("ask/sessions")
@UseGuards(JwtAuthGuard)
export class AiAskController {
  private readonly logger = new Logger(AiAskController.name);
  private static readonly SSE_HEARTBEAT_MS = 15000;

  constructor(private readonly aiAskService: AiAskService) {}

  /**
   * 创建新会话
   * POST /api/v1/ask/sessions
   */
  @Post()
  @ApiOperation({ summary: "创建新会话" })
  @ApiResponse({ status: 201, description: "创建成功" })
  @ApiResponse({ status: 401, description: "未授权" })
  async createSession(
    @Request() req: { user: { id: string } },
    @Body() dto: CreateSessionDto,
  ) {
    this.logger.log(`Creating session for user ${req.user.id}`);
    return this.aiAskService.createSession(req.user.id, dto);
  }

  /**
   * 获取会话列表
   * GET /api/v1/ask/sessions?page=1&limit=20
   */
  @Get()
  @ApiOperation({ summary: "获取会话列表" })
  @ApiResponse({ status: 200, description: "成功" })
  @ApiResponse({ status: 401, description: "未授权" })
  async getSessions(
    @Request() req: { user: { id: string } },
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || "1", 10) || 1);
    const limitNum = Math.min(
      200,
      Math.max(1, parseInt(limit || "50", 10) || 50),
    );
    return this.aiAskService.getSessions(req.user.id, pageNum, limitNum);
  }

  /**
   * 搜索会话
   * GET /api/v1/ask/sessions/search?q=keyword
   */
  @Get("search")
  @ApiOperation({ summary: "搜索会话" })
  @ApiResponse({ status: 200, description: "成功" })
  @ApiResponse({ status: 401, description: "未授权" })
  async searchSessions(
    @Request() req: { user: { id: string } },
    @Query("q") query: string,
    @Query("limit") limit?: string,
  ) {
    if (!query || query.trim().length === 0) {
      return [];
    }
    const limitNum = parseInt(limit || "20", 10);
    return this.aiAskService.searchSessions(req.user.id, query, limitNum);
  }

  /**
   * 获取单个会话详情（含消息）
   * GET /api/v1/ask/sessions/:id
   */
  @Get(":id")
  @ApiOperation({ summary: "获取会话详情" })
  @ApiResponse({ status: 200, description: "成功" })
  @ApiResponse({ status: 401, description: "未授权" })
  @ApiResponse({ status: 404, description: "未找到" })
  async getSession(
    @Request() req: { user: { id: string } },
    @Param("id") id: string,
  ) {
    return this.aiAskService.getSession(id, req.user.id);
  }

  /**
   * 更新会话
   * PATCH /api/v1/ask/sessions/:id
   */
  @Patch(":id")
  @ApiOperation({ summary: "更新会话" })
  @ApiResponse({ status: 200, description: "成功" })
  @ApiResponse({ status: 401, description: "未授权" })
  @ApiResponse({ status: 404, description: "未找到" })
  async updateSession(
    @Request() req: { user: { id: string } },
    @Param("id") id: string,
    @Body() dto: UpdateSessionDto,
  ) {
    return this.aiAskService.updateSession(id, req.user.id, dto);
  }

  /**
   * 删除会话
   * DELETE /api/v1/ask/sessions/:id
   */
  @Delete(":id")
  @ApiOperation({ summary: "删除会话" })
  @ApiResponse({ status: 200, description: "成功" })
  @ApiResponse({ status: 401, description: "未授权" })
  @ApiResponse({ status: 404, description: "未找到" })
  async deleteSession(
    @Request() req: { user: { id: string } },
    @Param("id") id: string,
  ) {
    return this.aiAskService.deleteSession(id, req.user.id);
  }

  /**
   * 发送消息
   * POST /api/v1/ask/sessions/:sessionId/messages
   */
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post(":sessionId/messages")
  @ApiOperation({ summary: "发送消息" })
  @ApiResponse({ status: 201, description: "创建成功" })
  @ApiResponse({ status: 401, description: "未授权" })
  @ApiResponse({ status: 404, description: "未找到" })
  async sendMessage(
    @Request() req: { user: { id: string } },
    @Param("sessionId") sessionId: string,
    @Body() dto: SendMessageDto,
  ) {
    // Additional validation for knowledgeBaseIds array length
    if (dto.knowledgeBaseIds && dto.knowledgeBaseIds.length > 10) {
      throw new BadRequestException(
        "Invalid knowledgeBaseIds: must be an array of at most 10 IDs",
      );
    }
    return this.aiAskService.sendMessage(sessionId, req.user.id, dto);
  }

  /**
   * 流式发送消息（SSE）
   * POST /api/v1/ask/sessions/:sessionId/messages/stream
   *
   * 2026-05-10 §4：sendMessage 同步阻塞导致用户白屏 5-30s。新流式端点 yield
   * SSE 事件：status / sources / chunk / done / error。前端用 fetch + ReadableStream
   * 消费，逐字渲染。
   */
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post(":sessionId/messages/stream")
  @ApiOperation({ summary: "流式发送消息（SSE）" })
  async streamMessage(
    @Request() req: { user: { id: string } },
    @Param("sessionId") sessionId: string,
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ) {
    if (dto.knowledgeBaseIds && dto.knowledgeBaseIds.length > 10) {
      throw new BadRequestException(
        "Invalid knowledgeBaseIds: must be an array of at most 10 IDs",
      );
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // nginx 关闭 buffer
    res.flushHeaders();

    let connectionOpen = true;
    res.on("close", () => {
      connectionOpen = false;
    });

    const writeEvent = (event: unknown) => {
      if (!connectionOpen) return false;
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        return true;
      } catch {
        connectionOpen = false;
        return false;
      }
    };

    const heartbeat = setInterval(() => {
      if (!connectionOpen) return;
      try {
        res.write(":heartbeat\n\n");
      } catch {
        connectionOpen = false;
      }
    }, AiAskController.SSE_HEARTBEAT_MS);

    try {
      for await (const event of this.aiAskService.sendMessageStream(
        sessionId,
        req.user.id,
        dto,
      )) {
        if (!writeEvent(event)) break;
        if (event.type === "done" || event.type === "error") {
          break;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[streamMessage] Stream failed: ${msg}`);
      writeEvent({ type: "error", message: msg });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }

  /**
   * 获取会话消息
   * GET /api/v1/ask/sessions/:sessionId/messages?limit=50&before=timestamp
   */
  @Get(":sessionId/messages")
  @ApiOperation({ summary: "获取会话消息" })
  @ApiResponse({ status: 200, description: "成功" })
  @ApiResponse({ status: 401, description: "未授权" })
  @ApiResponse({ status: 404, description: "未找到" })
  async getMessages(
    @Request() req: { user: { id: string } },
    @Param("sessionId") sessionId: string,
    @Query("limit") limit?: string,
    @Query("before") before?: string,
  ) {
    const limitNum = parseInt(limit || "50", 10);
    const beforeDate = before ? new Date(before) : undefined;
    return this.aiAskService.getMessages(
      sessionId,
      req.user.id,
      limitNum,
      beforeDate,
    );
  }

  /**
   * 重新生成消息
   * POST /api/v1/ask/sessions/:sessionId/messages/:messageId/regenerate
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post(":sessionId/messages/:messageId/regenerate")
  @ApiOperation({ summary: "重新生成消息" })
  @ApiResponse({ status: 201, description: "创建成功" })
  @ApiResponse({ status: 401, description: "未授权" })
  @ApiResponse({ status: 404, description: "未找到" })
  async regenerateMessage(
    @Request() req: { user: { id: string } },
    @Param("sessionId") sessionId: string,
    @Param("messageId") messageId: string,
  ) {
    return this.aiAskService.regenerateMessage(
      sessionId,
      messageId,
      req.user.id,
    );
  }
}
