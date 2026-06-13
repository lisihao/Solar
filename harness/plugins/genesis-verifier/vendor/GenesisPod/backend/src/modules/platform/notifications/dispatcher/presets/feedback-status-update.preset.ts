import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { NotificationDispatcher } from "../notification-dispatcher.service";
import { buildAppUrl, buildBrandSubject, escapeHtml } from "./preset-shared";

/**
 * FeedbackStatusUpdatePreset —— PR-DR1b F3 整改：替代旧
 * EmailNotificationPresetsService.sendFeedbackStatusUpdate
 *
 * 与旧 service 区别:
 * - userId 为入口（dispatcher 走偏好矩阵 + capabilities）
 * - 走 dispatcher.dispatch 而非直 EmailService（用户可关闭 FEEDBACK_STATUS_CHANGED.email）
 * - HTML 模板仍内嵌（同旧 service；PR-DR2 + Handlebars 后再下沉到 .hbs）
 *
 * 来源：daily-briefing-redesign-2026-05-18.md §11.1b F3
 */
@Injectable()
export class FeedbackStatusUpdatePreset {
  private readonly log = new Logger(FeedbackStatusUpdatePreset.name);

  constructor(
    private readonly dispatcher: NotificationDispatcher,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * @param userEmail 用户邮箱（用于查找 userId；找不到时 swallow + log warn）
   */
  async notify(params: {
    id: string;
    title: string;
    type: string;
    oldStatus: string;
    newStatus: string;
    userEmail: string;
    adminNotes?: string;
  }): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: params.userEmail },
      select: { id: true },
    });
    if (!user) {
      this.log.warn(
        `feedback status update: user not found for email=${params.userEmail.replace(/(.{2}).*@/, "$1***@")} feedbackId=${params.id}`,
      );
      return;
    }
    const html = this.renderHtml(params);
    await this.dispatcher.dispatch(user.id, {
      type: "FEEDBACK_STATUS_CHANGED",
      title: buildBrandSubject(`Feedback Status Updated: ${params.title}`),
      message: `Your feedback "${params.title}" status changed from ${params.oldStatus} to ${params.newStatus}`,
      link: buildAppUrl(this.config, `/feedback/${params.id}`),
      emailContext: { html },
      metadata: {
        feedbackId: params.id,
        oldStatus: params.oldStatus,
        newStatus: params.newStatus,
      },
    });
  }

  private renderHtml(p: {
    id: string;
    title: string;
    type: string;
    oldStatus: string;
    newStatus: string;
    adminNotes?: string;
  }): string {
    const statusColors: Record<string, string> = {
      PENDING: "#f59e0b",
      ACCEPTED: "#3b82f6",
      IN_PROGRESS: "#8b5cf6",
      RESOLVED: "#22c55e",
      REJECTED: "#dc2626",
    };
    const newColor = statusColors[p.newStatus] ?? "#6b7280";
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:30px;border-radius:10px 10px 0 0;text-align:center">
    <h1 style="color:white;margin:0">Feedback Updated</h1>
  </div>
  <div style="background:#f8fafc;padding:30px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px">
    <h2 style="color:#1e293b;margin:0 0 15px">${escapeHtml(p.title)}</h2>
    <p>Status changed: <strong>${escapeHtml(p.oldStatus)}</strong> → <strong style="color:${newColor}">${escapeHtml(p.newStatus)}</strong></p>
    ${p.adminNotes ? `<div style="background:white;padding:15px;border-left:4px solid ${newColor};margin:20px 0"><p style="margin:0;white-space:pre-wrap">${escapeHtml(p.adminNotes)}</p></div>` : ""}
    <p style="margin-top:20px;font-size:12px;color:#94a3b8">Feedback ID: ${escapeHtml(p.id)}</p>
  </div>
</body></html>`;
  }
}
