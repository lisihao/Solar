import { Inject, Injectable, Logger } from "@nestjs/common";
import { EmailService } from "../../../email/email.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { EMAIL_SUBJECT_MAX_LENGTH } from "../../../../../common/constants/locales";
import {
  ChannelCapabilities,
  DispatchPayload,
  INotificationChannel,
  NotificationChannel,
} from "../abstractions/notification-channel";

/**
 * EmailChannel —— 邮件 adapter（PR-DR1b）
 *
 * 来源：daily-briefing-redesign-2026-05-18.md §7.2.3 + §8.6
 *
 * 复用既有 EmailService.sendEmail()（M2 决策：包既有 service 不重写）
 * - dailyQuotaPerUser: 50（业界平均收件人/天 上限；超 ISP risk spam 标记）
 * - requiresGlobalConfig: true（SMTP / Resend provider 必须 Admin 配置）
 * - isAvailable: 检查 User.email 存在 + EmailService.isEnabled()
 *
 * payload 消费：
 * - subject = payload.title（caller 传"渲染后"标题；模板渲染由 caller 完成）
 * - text/html = payload.message（若 emailContext 含 `html` 字段则用 html）
 * - 高级模板渲染（Handlebars 4 层 briefing 模板）走 caller 侧的 RadarDailyBriefingEmailPreset
 *   本 adapter 仅做"邮件发送"原子操作，不感知业务模板
 *
 * 失败语义：
 * - EmailService 返回 false（未配置 / SMTP 失败）→ throw（dispatcher 捕获返 failed 脱敏）
 * - 不在 adapter 内 swallow
 */
@Injectable()
export class EmailChannel implements INotificationChannel {
  readonly type: NotificationChannel = "email";
  private readonly log = new Logger(EmailChannel.name);

  constructor(
    @Inject(EmailService) private readonly emailService: EmailService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async send(userId: string, payload: DispatchPayload): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, locale: true },
    });
    if (!user?.email) {
      // 应该已被 isAvailable 拦下，但防御
      throw new Error("user has no email address");
    }

    const ctx = payload.emailContext ?? {};
    const html = typeof ctx.html === "string" ? ctx.html : undefined;
    const text = typeof ctx.text === "string" ? ctx.text : payload.message;

    // PR-DR1b R1 security P0 整改：strip CRLF 防 SMTP header injection
    // attackers could inject Bcc:/Content-Type: via \r\n in title (user-input source)
    // EMAIL_SUBJECT_MAX_LENGTH（R2 reuse 整改）= RFC 5322 §2.1.1 上限 998 字
    const safeSubject = payload.title
      .replace(/[\r\n]+/g, " ")
      .slice(0, EMAIL_SUBJECT_MAX_LENGTH);
    const ok = await this.emailService.sendEmail({
      to: user.email,
      subject: safeSubject,
      ...(html ? { html } : { text }),
    });
    if (!ok) {
      throw new Error("email-transport-failed");
    }
    this.log.debug(
      `email-channel sent user=${userId} to=${user.email.replace(/(.{2}).*@/, "$1***@")} type=${payload.type}`,
    );
  }

  async isAvailable(userId: string): Promise<boolean> {
    if (!this.emailService.isEnabled()) return false;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return Boolean(user?.email);
  }

  getCapabilities(): ChannelCapabilities {
    return {
      requiresUserBinding: false, // email 是注册必填，已绑定
      requiresGlobalConfig: true, // SMTP / Resend 必须 admin 配置
      dailyQuotaPerUser: 50,
    };
  }
}
