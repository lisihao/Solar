import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Res,
  Logger,
  NotFoundException,
  BadRequestException,
  UseInterceptors,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Response } from "express";
import { DiscussionOrchestratorService } from "./discussion-orchestrator.service";
import { IterativeResearchService } from "../iteration";
import {
  StartDeepResearchDto,
  PlanApprovalRequest,
  PlanApprovalResponse,
} from "./types";
import { ApprovePlanDto } from "./dto/plan-approval.dto";
import { BillingContextInterceptor } from "../interceptors/billing-context.interceptor";
import { SSE_CONFIG } from "../config/research.config";

/**
 * 深度研究 API 控制器
 * 提供 SSE 流式端点
 *
 * 使用 IterativeResearchService 统一入口:
 * - mode='single' (默认): 直接委托给 DiscussionOrchestratorService
 * - mode='iterative': 运行自迭代外层循环
 */
@ApiTags("Research - Discussion")
@Controller("ai-studio/projects/:projectId/deep-research")
@UseInterceptors(BillingContextInterceptor)
export class DiscussionController {
  private readonly logger = new Logger(DiscussionController.name);

  constructor(
    private readonly discussionOrchestrator: DiscussionOrchestratorService,
    private readonly iterativeResearch: IterativeResearchService,
  ) {}

  /**
   * 启动深度研究（SSE 流式响应）
   * 使用 POST 方法支持请求体
   */
  @Post("stream")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async startResearchStream(
    @Param("projectId") projectId: string,
    @Body() dto: StartDeepResearchDto,
    @Res() res: Response,
  ): Promise<void> {
    this.logger.log(
      `Starting deep research stream for project ${projectId}: "${dto.query.slice(0, 50)}..."`,
    );

    // 设置 SSE 响应头
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Track connection state to avoid writing to closed connections
    let connectionOpen = true;

    const safeWrite = (data: string): boolean => {
      if (!connectionOpen) return false;
      try {
        res.write(data);
        return true;
      } catch {
        connectionOpen = false;
        return false;
      }
    };

    // SSE keepalive heartbeat to prevent proxy idle timeouts
    // (Railway/Cloudflare proxies may close idle SSE connections after ~60s)
    const heartbeat = setInterval(() => {
      safeWrite(":heartbeat\n\n");
    }, SSE_CONFIG.HEARTBEAT_INTERVAL_MS);

    // Route through IterativeResearchService when available:
    // 'single' delegates to orchestrator, 'iterative' runs the self-iterating outer loop.
    const mode = dto.mode ?? "single";
    this.logger.log(`Research mode: ${mode}`);

    const observable = this.iterativeResearch.startResearch(projectId, {
      query: dto.query,
      mode,
      options: dto.options,
      iterationOptions: dto.iterationOptions,
      isFollowUp: dto.isFollowUp,
      previousContext: dto.previousContext,
    });

    const subscription = observable.subscribe({
      next: (event) => {
        const eventData = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
        safeWrite(eventData);
      },
      error: (error) => {
        this.logger.error(`Research stream error: ${error}`);
        const errorEvent = `event: error\ndata: ${JSON.stringify({ code: "STREAM_ERROR", message: "An error occurred during research", recoverable: false })}\n\n`;
        safeWrite(errorEvent);
        clearInterval(heartbeat);
        clearTimeout(timeout);
        if (connectionOpen) {
          connectionOpen = false;
          res.end();
        }
      },
      complete: () => {
        this.logger.log(`Research stream completed for project ${projectId}`);
        clearInterval(heartbeat);
        clearTimeout(timeout);
        if (connectionOpen) {
          connectionOpen = false;
          res.end();
        }
      },
    });

    // Hard timeout on the entire stream (research typically takes 10–20 min; 30 min is a safety net)
    const timeout = setTimeout(() => {
      this.logger.warn(
        `Research stream timeout after ${SSE_CONFIG.STREAM_TIMEOUT_MS / 60_000} minutes`,
      );
      clearInterval(heartbeat);
      subscription.unsubscribe();
      if (connectionOpen) {
        connectionOpen = false;
        res.end();
      }
    }, SSE_CONFIG.STREAM_TIMEOUT_MS);

    // 客户端断开连接时清理 — 但 NOT unsubscribe，研究继续在后台运行。
    // P0-1 fix: 之前 subscription.unsubscribe() 会终止后端 Observable，
    // 导致第二轮迭代时 SSE 断线（Railway/Cloudflare ~60s idle timeout）就终止整个研究。
    // 现在只标记连接关闭 + 清理 heartbeat，让后端研究独立于 SSE 连接生命周期。
    // 注意: 保留 30 分钟 timeout 作为安全网 — 防止研究挂死（LLM 调用卡住等）
    // 导致 subscription 永远泄漏。
    res.on("close", () => {
      this.logger.log(
        `Client disconnected from research stream (research continues in background)`,
      );
      connectionOpen = false;
      clearInterval(heartbeat);
      // DO NOT clearTimeout(timeout) — keep the 30-minute safety net active.
      // If the research hangs (e.g. LLM call never returns), the timeout will
      // force-unsubscribe and clean up the subscription.
      // DO NOT call subscription.unsubscribe() — let the research Observable run to completion.
      // The Subject buffers events; the controller just stops writing to the closed response.
    });
  }

  /**
   * POST 启动深度研究
   * 适用于不使用 SSE 的场景，返回 session ID
   */
  @Post("start")
  async startResearch(
    @Param("projectId") projectId: string,
    @Body() dto: StartDeepResearchDto,
  ) {
    this.logger.log(
      `Starting deep research for project ${projectId}: "${dto.query.slice(0, 50)}..."`,
    );

    // 创建会话并启动后台处理
    const sessionId = `dr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 启动研究（后台运行）
    this.discussionOrchestrator.startResearch(projectId, dto).subscribe({
      next: (event) => {
        this.logger.debug(`Research event: ${event.type}`);
      },
      error: (error) => {
        this.logger.error(`Research error: ${error}`);
      },
      complete: () => {
        this.logger.log(`Research completed for project ${projectId}`);
      },
    });

    return {
      sessionId,
      message: "深度研究已启动",
    };
  }

  /**
   * 生成研究计划（带审批流）
   * 生成计划后暂停，返回计划等待用户审批后再执行
   */
  @Post("plan")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: "生成研究计划",
    description: "生成研究计划，等待用户审批后再执行",
  })
  @ApiResponse({ status: 201, description: "计划生成成功，等待审批" })
  async generatePlan(
    @Param("projectId") projectId: string,
    @Body() dto: StartDeepResearchDto,
  ): Promise<PlanApprovalRequest> {
    this.logger.log(
      `Generating research plan for project ${projectId}: "${dto.query.slice(0, 50)}..."`,
    );

    try {
      return await this.discussionOrchestrator.generatePlanOnly(projectId, dto);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "计划生成失败",
      );
    }
  }

  /**
   * 审批研究计划
   * 批准后立即开始执行，拒绝则取消会话
   */
  @Post("plan/:sessionId/approve")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: "审批研究计划",
    description: "审批或拒绝研究计划，批准后开始执行",
  })
  @ApiResponse({ status: 201, description: "审批处理成功" })
  async approvePlan(
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Body() dto: ApprovePlanDto,
  ): Promise<{ sessionId: string; status: string }> {
    this.logger.log(
      `Processing plan approval for session ${sessionId} (project ${projectId}): approved=${dto.approved}`,
    );

    const approval: PlanApprovalResponse = {
      approved: dto.approved,
      modifiedPlan: dto.modifiedPlan,
      feedback: dto.feedback,
    };

    try {
      return await this.discussionOrchestrator.approvePlan(sessionId, approval);
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        throw new NotFoundException(error.message);
      }
      throw new BadRequestException(
        error instanceof Error ? error.message : "审批处理失败",
      );
    }
  }

  /**
   * 获取研究会话详情
   */
  @Get("sessions/:sessionId")
  async getSession(
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
  ) {
    this.logger.log(`Getting session ${sessionId} for project ${projectId}`);

    const session = await this.discussionOrchestrator.getSession(sessionId);

    if (!session) {
      throw new NotFoundException("Session not found");
    }

    return session;
  }

  /**
   * 获取项目的研究会话列表
   */
  @Get("sessions")
  async getProjectSessions(@Param("projectId") projectId: string) {
    this.logger.log(`Getting sessions for project ${projectId}`);

    const sessions =
      await this.discussionOrchestrator.getProjectSessions(projectId);

    return sessions;
  }

  /**
   * 删除单个研究会话
   */
  @Delete("sessions/:sessionId")
  async deleteSession(
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
  ) {
    this.logger.log(`Deleting session ${sessionId} for project ${projectId}`);

    try {
      await this.discussionOrchestrator.deleteSession(sessionId);
      return {
        message: "研究会话已删除",
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "删除失败",
      );
    }
  }

  /**
   * 提交用户反馈（迭代研究暂停期间）
   */
  @Post("feedback")
  submitFeedback(
    @Param("projectId") projectId: string,
    @Body() body: { feedback: string },
  ) {
    if (!body.feedback?.trim()) {
      throw new BadRequestException("Feedback cannot be empty");
    }
    const accepted = this.iterativeResearch.submitFeedback(
      projectId,
      body.feedback.trim(),
    );
    return { accepted };
  }

  /**
   * 跳过当前研究阶段
   */
  @Post("skip-phase")
  skipPhase(@Param("projectId") projectId: string) {
    const skipped = this.discussionOrchestrator.requestSkipPhase(projectId);
    return { skipped };
  }

  /**
   * 延长反馈等待时间
   */
  @Post("extend-feedback")
  extendFeedbackTimeout(
    @Param("projectId") projectId: string,
    @Body() body: { additionalMs?: number },
  ) {
    const additionalMs = Math.min(body.additionalMs || 120_000, 600_000);
    const extended = this.iterativeResearch.extendFeedbackTimeout(
      projectId,
      additionalMs,
    );
    return { extended, additionalMs };
  }

  /**
   * 批量删除研究会话
   */
  @Delete("sessions")
  async deleteSessions(
    @Param("projectId") projectId: string,
    @Body() body: { sessionIds: string[] },
  ) {
    this.logger.log(
      `Deleting ${body.sessionIds.length} sessions for project ${projectId}`,
    );

    try {
      const result = await this.discussionOrchestrator.deleteSessions(
        body.sessionIds,
      );
      return {
        deleted: result.count,
        message: `已删除 ${result.count} 个研究会话`,
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "批量删除失败",
      );
    }
  }
}
