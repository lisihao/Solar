import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_CONFIG } from "../../../../common/config/app.config";
import { EmailService } from "../email.service";

export interface FeedbackEmailNotification {
  id: string;
  type: string;
  title: string;
  description: string;
  userEmail?: string;
  pageUrl?: string;
  userAgent?: string;
  attachments?: Array<{ filename: string; content: Buffer }>;
}

export interface MissionCompletionEmailNotification {
  to: string;
  missionId: string;
  missionTitle: string;
  reportUrl: string;
  summary?: string;
  completedAt: Date;
}

export interface FeedbackStatusEmailNotification {
  id: string;
  title: string;
  type: string;
  oldStatus: string;
  newStatus: string;
  userEmail: string;
  adminNotes?: string;
}

/**
 * EmailNotificationPresetsService
 *
 * **PR-DR1b F3 部分迁移完成**：
 * - `sendFeedbackStatusUpdate` → 迁至 FeedbackStatusUpdatePreset（走 dispatcher）
 * - `sendMissionCompletionNotification` → 迁至 MissionCompletionPreset（走 dispatcher）
 * - `sendFeedbackNotification`（admin 通知）保留在此 —— admin 告警绕 user 偏好是设计选择
 *
 * 本类已 @deprecated 用户面方法，仅保留 admin/system 直发场景。
 * 后续模块若需用户面 email，走 NotificationDispatcher.dispatch（forceChannels=['email']）
 * 或新增专属 Preset 服务（参见 dispatcher/presets/*.preset.ts 模式）。
 */
@Injectable()
export class EmailNotificationPresetsService {
  private readonly logger = new Logger(EmailNotificationPresetsService.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  async sendFeedbackNotification(
    feedback: FeedbackEmailNotification,
  ): Promise<boolean> {
    const adminEmail = this.emailService.getAdminEmail();
    this.logger.log(
      `Sending feedback notification for: ${feedback.id} (Email enabled: ${this.emailService.isEnabled()}, Admin email: ${adminEmail ? "configured" : "NOT configured"})`,
    );

    if (!adminEmail) {
      this.logger.warn(
        "Cannot send feedback notification: Admin email is not configured",
      );
      return false;
    }

    const typeColors: Record<string, string> = {
      BUG: "#dc2626",
      FEATURE: "#f59e0b",
      IMPROVEMENT: "#3b82f6",
      OTHER: "#6b7280",
    };

    const typeLabels: Record<string, string> = {
      BUG: "Bug Report",
      FEATURE: "Feature Request",
      IMPROVEMENT: "Improvement",
      OTHER: "Other Feedback",
    };

    const appUrl = this.configService.get("APP_URL", "http://localhost:3000");
    const html = `<!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">New Feedback Received</h1>
        </div>
        <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 10px 10px;">
          <div style="margin-bottom: 20px;">
            <span style="display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; color: white; background-color: ${typeColors[feedback.type] || "#6b7280"};">
              ${typeLabels[feedback.type] || feedback.type}
            </span>
          </div>
          <h2 style="color: #1e293b; margin: 0 0 15px 0; font-size: 20px;">${feedback.title}</h2>
          <div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 20px;">
            <p style="margin: 0; white-space: pre-wrap;">${feedback.description}</p>
          </div>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 8px 0; color: #64748b; width: 120px;">Feedback ID:</td>
              <td style="padding: 8px 0; color: #1e293b; font-family: monospace;">${feedback.id}</td>
            </tr>
            ${
              feedback.userEmail
                ? `<tr>
              <td style="padding: 8px 0; color: #64748b;">User Email:</td>
              <td style="padding: 8px 0;"><a href="mailto:${feedback.userEmail}" style="color: #3b82f6;">${feedback.userEmail}</a></td>
            </tr>`
                : ""
            }
            ${
              feedback.pageUrl
                ? `<tr>
              <td style="padding: 8px 0; color: #64748b;">Page URL:</td>
              <td style="padding: 8px 0;"><a href="${feedback.pageUrl}" style="color: #3b82f6; word-break: break-all;">${feedback.pageUrl}</a></td>
            </tr>`
                : ""
            }
            ${
              feedback.attachments && feedback.attachments.length > 0
                ? `<tr>
              <td style="padding: 8px 0; color: #64748b;">Attachments:</td>
              <td style="padding: 8px 0;">${feedback.attachments.length} file(s) attached</td>
            </tr>`
                : ""
            }
          </table>
          <div style="margin-top: 25px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center;">
            <a href="${appUrl}/admin/feedback"
               style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 6px; font-weight: 600;">
              View in Dashboard
            </a>
          </div>
        </div>
        <div style="text-align: center; padding: 20px; color: #94a3b8; font-size: 12px;">
          <p style="margin: 0;">This is an automated notification from ${APP_CONFIG.brand.name}</p>
        </div>
      </body>
      </html>`;

    const text = `New Feedback Received

Type: ${typeLabels[feedback.type] || feedback.type}
Title: ${feedback.title}

Description:
${feedback.description}

Feedback ID: ${feedback.id}
${feedback.userEmail ? `User Email: ${feedback.userEmail}` : ""}
${feedback.pageUrl ? `Page URL: ${feedback.pageUrl}` : ""}
${feedback.attachments?.length ? `Attachments: ${feedback.attachments.length} file(s)` : ""}

---
${APP_CONFIG.brand.name} Feedback Notification`;

    return this.emailService.sendEmail({
      to: adminEmail,
      subject: `[${APP_CONFIG.brand.name}] New ${typeLabels[feedback.type] || "Feedback"}: ${feedback.title}`,
      html,
      text,
      replyTo: feedback.userEmail,
      attachments: feedback.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
      })),
    });
  }

  /**
   * @deprecated PR-DR1b F3 — 使用 MissionCompletionPreset.notify（走 dispatcher）
   * 此方法仍可工作但 *不* 尊重 user channelSubscriptions 偏好。新 caller 一律走 preset。
   */
  async sendMissionCompletionNotification(
    options: MissionCompletionEmailNotification,
  ): Promise<boolean> {
    this.logger.log(
      `Sending mission completion notification to ${options.to} for mission: ${options.missionTitle}`,
    );

    const appUrl = this.configService.get("APP_URL", "http://localhost:3000");
    const html = `<!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Mission Complete</h1>
        </div>
        <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 10px 10px;">
          <div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 20px;">
            <h2 style="color: #1e293b; margin: 0 0 10px 0; font-size: 20px;">${options.missionTitle}</h2>
            <p style="margin: 0; color: #64748b; font-size: 14px;">Completed at: ${options.completedAt.toLocaleString("en-CA")}</p>
          </div>
          ${
            options.summary
              ? `<div style="background: #f0fdf4; padding: 20px; border-radius: 8px; border-left: 4px solid #22c55e; margin-bottom: 20px;">
            <h3 style="color: #166534; margin: 0 0 10px 0; font-size: 14px;">Mission summary</h3>
            <p style="margin: 0; color: #15803d; white-space: pre-wrap;">${options.summary.slice(0, 500)}${options.summary.length > 500 ? "..." : ""}</p>
          </div>`
              : ""
          }
          <div style="text-align: center; margin-top: 25px;">
            <a href="${options.reportUrl}"
               style="display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
              Open report
            </a>
          </div>
          <p style="text-align: center; color: #64748b; margin-top: 20px; font-size: 14px;">
            Direct link: <a href="${options.reportUrl}" style="color: #22c55e; word-break: break-all;">${options.reportUrl}</a>
          </p>
        </div>
        <div style="text-align: center; padding: 20px; color: #94a3b8; font-size: 12px;">
          <p style="margin: 0;">This message was sent automatically by ${APP_CONFIG.brand.name}</p>
          <p style="margin: 5px 0 0 0;"><a href="${appUrl}" style="color: #94a3b8;">${APP_CONFIG.brand.fullName}</a></p>
        </div>
      </body>
      </html>`;

    const text = `Mission Complete

Mission: ${options.missionTitle}
Completed at: ${options.completedAt.toLocaleString("en-CA")}
${options.summary ? `\nSummary:\n${options.summary.slice(0, 500)}${options.summary.length > 500 ? "..." : ""}\n` : ""}
Open report: ${options.reportUrl}

---
This message was sent automatically by ${APP_CONFIG.brand.name}`;

    return this.emailService.sendEmail({
      to: options.to,
      subject: `[${APP_CONFIG.brand.name}] Mission complete: ${options.missionTitle}`,
      html,
      text,
    });
  }

  /**
   * @deprecated PR-DR1b F3 — 使用 FeedbackStatusUpdatePreset.notify（走 dispatcher）
   * 此方法仍可工作但 *不* 尊重 user channelSubscriptions 偏好。新 caller 一律走 preset。
   */
  async sendFeedbackStatusUpdate(
    feedback: FeedbackStatusEmailNotification,
  ): Promise<boolean> {
    this.logger.log(
      `Sending feedback status update to ${feedback.userEmail}: ${feedback.oldStatus} -> ${feedback.newStatus}`,
    );

    const statusLabels: Record<string, string> = {
      PENDING: "Pending Review",
      REVIEWED: "Reviewed",
      IN_PROGRESS: "In Progress",
      RESOLVED: "Resolved",
      CLOSED: "Closed",
    };

    const statusColors: Record<string, string> = {
      PENDING: "#eab308",
      REVIEWED: "#3b82f6",
      IN_PROGRESS: "#a855f7",
      RESOLVED: "#22c55e",
      CLOSED: "#6b7280",
    };

    const statusMessages: Record<string, string> = {
      PENDING: "Your feedback is in the queue for review.",
      REVIEWED: "Our team has reviewed your feedback.",
      IN_PROGRESS: "We are actively working on addressing your feedback.",
      RESOLVED:
        "Great news! Your feedback has been addressed. Thank you for helping us improve!",
      CLOSED: "This feedback has been closed.",
    };

    const appUrl = this.configService.get("APP_URL", "http://localhost:3000");
    const html = `<!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, ${statusColors[feedback.newStatus] || "#667eea"} 0%, ${statusColors[feedback.newStatus] || "#764ba2"} 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Feedback Status Update</h1>
        </div>
        <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 10px 10px;">
          <div style="margin-bottom: 20px; text-align: center;">
            <span style="display: inline-block; padding: 8px 20px; border-radius: 20px; font-size: 14px; font-weight: 600; color: white; background-color: ${statusColors[feedback.newStatus] || "#6b7280"};">
              ${statusLabels[feedback.newStatus] || feedback.newStatus}
            </span>
          </div>
          <p style="text-align: center; color: #64748b; margin-bottom: 20px;">
            ${statusMessages[feedback.newStatus] || "Your feedback status has been updated."}
          </p>
          <div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 20px;">
            <h2 style="color: #1e293b; margin: 0 0 10px 0; font-size: 18px;">${feedback.title}</h2>
            <p style="margin: 0; color: #64748b; font-size: 14px;">Feedback ID: <span style="font-family: monospace;">${feedback.id}</span></p>
          </div>
          ${
            feedback.adminNotes
              ? `<div style="background: #eff6ff; padding: 20px; border-radius: 8px; border-left: 4px solid #3b82f6; margin-bottom: 20px;">
            <h3 style="color: #1e40af; margin: 0 0 10px 0; font-size: 14px;">Response from our team</h3>
            <p style="margin: 0; color: #1e3a8a; white-space: pre-wrap;">${feedback.adminNotes}</p>
          </div>`
              : ""
          }
          <div style="text-align: center; margin-top: 25px;">
            <a href="${appUrl}/feedback/history"
               style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 6px; font-weight: 600;">
              View My Feedback
            </a>
          </div>
        </div>
        <div style="text-align: center; padding: 20px; color: #94a3b8; font-size: 12px;">
          <p style="margin: 0;">Thank you for helping us improve ${APP_CONFIG.brand.name}.</p>
        </div>
      </body>
      </html>`;

    const text = `Feedback Status Update

Your feedback "${feedback.title}" has been updated to: ${statusLabels[feedback.newStatus] || feedback.newStatus}

${statusMessages[feedback.newStatus] || ""}

Feedback ID: ${feedback.id}
${feedback.adminNotes ? `\nResponse from our team:\n${feedback.adminNotes}` : ""}

View your feedback history at: ${appUrl}/feedback/history

---
Thank you for helping us improve ${APP_CONFIG.brand.name}.`;

    return this.emailService.sendEmail({
      to: feedback.userEmail,
      subject: `[${APP_CONFIG.brand.name}] Your feedback is now ${statusLabels[feedback.newStatus] || feedback.newStatus}`,
      html,
      text,
    });
  }
}
