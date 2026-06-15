/**
 * Feedback Event Listener
 *
 * 反馈事件监听器 - 监听反馈事件并触发相应处理
 *
 * 职责：
 * 1. 监听新反馈创建事件，触发分诊
 * 2. 监听分诊完成事件，触发后续处理
 * 3. 发送通知
 */

import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { TriageAgentService } from "../triage/triage-agent.service";
import { GitHubIssueService } from "../github/github-issue.service";
// import { EmailService } from "../../email/email.service"; // TODO: Re-enable for user notifications
import {
  FeedbackEvent,
  FeedbackCreatedPayload,
  TriageCompletedPayload,
  TriageFailedPayload,
} from "./feedback-events";
import type {
  TriageInput,
  TriageDecision,
} from "../triage/triage-decision.types";
import { BillingContext } from "../../../platform/facade";

@Injectable()
export class FeedbackEventListener {
  private readonly logger = new Logger(FeedbackEventListener.name);

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly triageAgent: TriageAgentService,
    private readonly prisma: PrismaService,
    private readonly githubIssueService: GitHubIssueService,
    // TODO: Add EmailService back when implementing user notifications
  ) {}

  /**
   * 处理反馈创建事件
   */
  @OnEvent(FeedbackEvent.CREATED)
  async handleFeedbackCreated(payload: FeedbackCreatedPayload): Promise<void> {
    if (process.env.ENABLE_FEEDBACK_AUTO_TRIAGE !== "true") {
      this.logger.debug(
        `[handleFeedbackCreated] auto-triage DISABLED (default) — feedback ${payload.feedbackId} queued for manual review. Set ENABLE_FEEDBACK_AUTO_TRIAGE=true to opt in.`,
      );
      return;
    }
    this.logger.log(
      `[handleFeedbackCreated] Feedback created: ${payload.feedbackId}`,
    );

    try {
      // 构建分诊输入
      const triageInput: TriageInput = {
        feedbackId: payload.feedbackId,
        type: payload.type,
        title: payload.title,
        description: payload.description,
        attachments: payload.attachments,
        metadata: {
          userEmail: payload.userEmail,
          pageUrl: payload.pageUrl,
          userAgent: payload.userAgent,
          timestamp: payload.createdAt,
        },
      };

      // 发送分诊开始事件
      this.eventEmitter.emit(FeedbackEvent.TRIAGE_STARTED, {
        feedbackId: payload.feedbackId,
        input: triageInput,
        startedAt: new Date(),
      });

      // 执行分诊（有登录用户时记录积分消耗）
      const decision = payload.userId
        ? await BillingContext.run(
            {
              userId: payload.userId,
              moduleType: "feedback",
              operationType: "triage",
              referenceId: payload.feedbackId,
            },
            () => this.triageAgent.triage(triageInput),
          )
        : await this.triageAgent.triage(triageInput);

      // 保存分诊结果
      await this.saveTriageResult(payload.feedbackId, decision);

      // 发送分诊完成事件
      this.eventEmitter.emit(FeedbackEvent.TRIAGE_COMPLETED, {
        feedbackId: payload.feedbackId,
        decision,
        completedAt: new Date(),
      } as TriageCompletedPayload);
    } catch (error) {
      this.logger.error(
        `[handleFeedbackCreated] Triage failed for ${payload.feedbackId}`,
        error,
      );

      // 发送分诊失败事件
      this.eventEmitter.emit(FeedbackEvent.TRIAGE_FAILED, {
        feedbackId: payload.feedbackId,
        error: (error as Error).message,
        failedAt: new Date(),
      } as TriageFailedPayload);
    }
  }

  /**
   * 处理分诊完成事件
   */
  @OnEvent(FeedbackEvent.TRIAGE_COMPLETED)
  async handleTriageCompleted(payload: TriageCompletedPayload): Promise<void> {
    const { feedbackId, decision } = payload;
    this.logger.log(
      `[handleTriageCompleted] Triage completed for ${feedbackId}: action=${decision.routing.action}`,
    );

    try {
      // 根据分诊结果执行不同操作
      switch (decision.routing.action) {
        case "auto_fix":
          await this.handleAutoFix(feedbackId, decision);
          break;

        case "manual_fix":
          await this.handleManualFix(feedbackId, decision);
          break;

        case "request_info":
          await this.handleRequestInfo(feedbackId, decision);
          break;

        case "reject":
          await this.handleReject(feedbackId, decision);
          break;

        case "defer":
          await this.handleDefer(feedbackId, decision);
          break;
      }

      // 如果是 Critical 优先级，发送紧急通知
      if (decision.priority.level === "critical" && decision.validity.isValid) {
        await this.sendCriticalNotification(feedbackId, decision);
      }
    } catch (error) {
      this.logger.error(
        `[handleTriageCompleted] Post-triage handling failed for ${feedbackId}`,
        error,
      );
    }
  }

  /**
   * 处理分诊失败事件
   */
  @OnEvent(FeedbackEvent.TRIAGE_FAILED)
  async handleTriageFailed(payload: TriageFailedPayload): Promise<void> {
    this.logger.warn(
      `[handleTriageFailed] Triage failed for ${payload.feedbackId}: ${payload.error}`,
    );

    // 更新状态为需要人工处理
    await this.updateFeedbackStatus(
      payload.feedbackId,
      "PENDING",
      `自动分诊失败: ${payload.error}`,
    );
  }

  /**
   * 保存分诊结果
   */
  private async saveTriageResult(
    feedbackId: string,
    decision: TriageDecision,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE feedbacks
      SET
        analysis = ${JSON.stringify(decision)}::jsonb,
        updated_at = NOW()
      WHERE id = ${feedbackId}::uuid
    `;
  }

  /**
   * 处理自动修复
   */
  private async handleAutoFix(
    feedbackId: string,
    decision: TriageDecision,
  ): Promise<void> {
    this.logger.log(`[handleAutoFix] Starting auto-fix for ${feedbackId}`);

    // 更新状态
    await this.updateFeedbackStatus(feedbackId, "IN_PROGRESS", "自动修复中");

    // 发送修复开始事件
    this.eventEmitter.emit(FeedbackEvent.FIX_STARTED, {
      feedbackId,
      fixType: "auto",
      approach: decision.routing.autoFixPlan?.approach,
      startedAt: new Date(),
    });

    // 获取反馈详情用于创建 Issue
    const feedback = await this.getFeedbackDetails(feedbackId);

    // 创建 GitHub Issue 触发 Claude Code 自动修复
    if (this.githubIssueService.isEnabled()) {
      const result = await this.githubIssueService.createAutoFixIssue(
        feedbackId,
        decision,
        {
          userDescription: feedback?.description,
          screenshotUrls: feedback?.screenshotUrls,
          pageUrl: feedback?.pageUrl,
          errorStack: feedback?.errorStack,
        },
      );

      if (result.success) {
        this.logger.log(
          `[handleAutoFix] Created GitHub Issue #${result.issueNumber}: ${result.issueUrl}`,
        );

        // 更新反馈记录，保存 Issue URL
        await this.updateFeedbackWithIssue(feedbackId, result.issueUrl!);
      } else {
        this.logger.error(
          `[handleAutoFix] Failed to create GitHub Issue: ${result.error}`,
        );
        // 降级为人工处理
        await this.handleManualFix(feedbackId, decision);
      }
    } else {
      this.logger.warn(
        `[handleAutoFix] GitHub Issue Service not enabled, falling back to manual fix`,
      );
      // 如果 GitHub 服务未启用，降级为人工处理
      await this.handleManualFix(feedbackId, decision);
    }

    this.logger.log(
      `[handleAutoFix] Auto-fix plan: ${decision.routing.autoFixPlan?.approach}`,
    );
  }

  /**
   * 获取反馈详情
   */
  private async getFeedbackDetails(feedbackId: string): Promise<{
    description: string;
    screenshotUrls: string[];
    pageUrl?: string;
    errorStack?: string;
  } | null> {
    try {
      const result = await this.prisma.$queryRaw<
        {
          description: string;
          page_url: string | null;
          attachments: string | null;
        }[]
      >`
        SELECT description, page_url, attachments::text
        FROM feedbacks
        WHERE id = ${feedbackId}::uuid
      `;

      if (!result[0]) return null;

      const attachments = result[0].attachments
        ? JSON.parse(result[0].attachments)
        : [];
      const screenshotUrls = attachments
        .filter((a: { mimeType: string }) => a.mimeType?.startsWith("image/"))
        .map((a: { url: string }) => a.url);

      return {
        description: result[0].description,
        screenshotUrls,
        pageUrl: result[0].page_url || undefined,
      };
    } catch (error) {
      this.logger.error(`Failed to get feedback details: ${error}`);
      return null;
    }
  }

  /**
   * 更新反馈记录，保存 GitHub Issue URL
   */
  private async updateFeedbackWithIssue(
    feedbackId: string,
    issueUrl: string,
  ): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        UPDATE feedbacks
        SET
          admin_notes = COALESCE(admin_notes, '') || E'\nGitHub Issue: ' || ${issueUrl},
          updated_at = NOW()
        WHERE id = ${feedbackId}::uuid
      `;
    } catch (error) {
      this.logger.error(`Failed to update feedback with issue URL: ${error}`);
    }
  }

  /**
   * 处理人工修复
   */
  private async handleManualFix(
    feedbackId: string,
    decision: TriageDecision,
  ): Promise<void> {
    this.logger.log(`[handleManualFix] Marking for manual fix: ${feedbackId}`);

    // 更新状态
    const notes = [
      `优先级: ${decision.priority.level}`,
      `模块: ${decision.classification.affectedModule}`,
      `预估工作量: ${decision.routing.manualAssignment?.estimatedEffort || "未知"}`,
      decision.routing.reasoning,
    ].join("\n");

    await this.updateFeedbackStatus(feedbackId, "REVIEWED", notes);

    // TODO: 创建 GitHub Issue
    // TODO: 发送飞书通知给研发团队
  }

  /**
   * 处理需要更多信息
   */
  private async handleRequestInfo(
    feedbackId: string,
    decision: TriageDecision,
  ): Promise<void> {
    this.logger.log(
      `[handleRequestInfo] Requesting more info for ${feedbackId}`,
    );

    const requestedInfo = decision.routing.requestedInfo || [
      "请提供更多详细信息",
    ];
    const notes = `需要补充信息:\n${requestedInfo.map((i) => `- ${i}`).join("\n")}`;

    await this.updateFeedbackStatus(feedbackId, "PENDING", notes);

    // TODO: 发送邮件给用户请求更多信息
  }

  /**
   * 处理拒绝
   */
  private async handleReject(
    feedbackId: string,
    decision: TriageDecision,
  ): Promise<void> {
    this.logger.log(`[handleReject] Rejecting feedback: ${feedbackId}`);

    await this.updateFeedbackStatus(
      feedbackId,
      "CLOSED",
      decision.routing.rejectReason || "反馈已关闭",
    );

    // 发送关闭事件
    this.eventEmitter.emit(FeedbackEvent.CLOSED, {
      feedbackId,
      reason: decision.routing.rejectReason || "自动关闭",
    });
  }

  /**
   * 处理延期
   */
  private async handleDefer(
    feedbackId: string,
    decision: TriageDecision,
  ): Promise<void> {
    this.logger.log(`[handleDefer] Deferring feedback: ${feedbackId}`);

    await this.updateFeedbackStatus(
      feedbackId,
      "PENDING",
      `延期处理: ${decision.routing.reasoning}`,
    );
  }

  /**
   * 发送紧急通知
   */
  private async sendCriticalNotification(
    feedbackId: string,
    decision: TriageDecision,
  ): Promise<void> {
    this.logger.warn(
      `[sendCriticalNotification] Critical issue detected: ${feedbackId}`,
    );

    // TODO: 发送飞书/钉钉紧急通知
    // 目前只记录日志
    this.logger.warn(
      `CRITICAL FEEDBACK: ${feedbackId}\n` +
        `Module: ${decision.classification.affectedModule}\n` +
        `Priority Score: ${decision.priority.score}\n` +
        `Reasoning: ${decision.priority.reasoning}`,
    );
  }

  /**
   * 更新反馈状态
   */
  private async updateFeedbackStatus(
    feedbackId: string,
    status: string,
    adminNotes?: string,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE feedbacks
      SET
        status = ${status}::"FeedbackStatus",
        admin_notes = ${adminNotes || null},
        updated_at = NOW()
      WHERE id = ${feedbackId}::uuid
    `;

    // 发送状态变更事件
    this.eventEmitter.emit(FeedbackEvent.STATUS_CHANGED, {
      feedbackId,
      oldStatus: "PENDING",
      newStatus: status,
      changedBy: "system",
      reason: adminNotes,
      changedAt: new Date(),
    });
  }
}
