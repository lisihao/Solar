import { Module, forwardRef } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PrismaModule } from "../../../../common/prisma/prisma.module";
import { NotificationModule } from "../notification.module";
import { NotificationDispatcher } from "./notification-dispatcher.service";
import { DispatcherQuotaService } from "./dispatcher-quota.service";
import { SiteChannel } from "./channels/site-channel.adapter";
import { EmailChannel } from "./channels/email-channel.adapter";
import { ChannelResolver } from "./preferences/channel-resolver";
import { NotificationPreferenceService } from "./preferences/notification-preference.service";
import { RadarMissionCompletePreset } from "./presets/radar-mission-complete.preset";
import { FeedbackStatusUpdatePreset } from "./presets/feedback-status-update.preset";
import { MissionCompletionPreset } from "./presets/mission-completion.preset";
import { MissionFailedPreset } from "./presets/mission-failed.preset";
import { RadarDailyBriefingEmailPreset } from "./presets/radar-daily-briefing-email.preset";
import { RadarWeeklyBriefingEmailPreset } from "./presets/radar-weekly-briefing-email.preset";
import { UnsubscribeTokenService } from "./preferences/unsubscribe-token.service";
// UnsubscribeController（notifications/unsubscribe，公开退订）已上提到
// open-api/public（System HTTP → L4）；UnsubscribeTokenService 留 L1 platform 并导出。

/**
 * NotificationDispatcherModule（PR-DR1a）
 *
 * 来源：daily-briefing-redesign-2026-05-18.md §8.6
 *
 * 依赖：
 * - PrismaModule —— NotificationPreferenceService 读 NotificationPreference 表
 * - NotificationModule —— SiteChannel 注入 NotificationService（既有，复用）
 *
 * 暴露：
 * - NotificationDispatcher —— 唯一对外入口（caller 通过 dispatch() 触发）
 * - NotificationPreferenceService —— 偏好 service（caller 自检 quietHours 等场景）
 *
 * 后续 PR 扩展（不需要改本文件）：
 * - PR-DR1b: EmailChannel 在 EmailModule 内 providers + provide: 'EMAIL_CHANNEL'
 * - PR-DR3:  WechatChannel 在 SocialModule 内 providers + provide: 'WECHAT_CHANNEL'
 *   只要被 NestJS 容器扫描到且 token 匹配，dispatcher constructor @Optional() 自动注入
 */
@Module({
  imports: [
    PrismaModule,
    forwardRef(() => NotificationModule),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>("JWT_SECRET"),
        signOptions: { expiresIn: "7d" },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    NotificationDispatcher,
    DispatcherQuotaService,
    SiteChannel,
    EmailChannel,
    // 用 token 注入避免 dispatcher constructor 强依赖 EmailChannel class
    // （PR-DR1a 占位 @Optional() @Inject('EMAIL_CHANNEL') 现在真接到）
    { provide: "EMAIL_CHANNEL", useExisting: EmailChannel },
    ChannelResolver,
    NotificationPreferenceService,
    UnsubscribeTokenService,
    RadarMissionCompletePreset,
    FeedbackStatusUpdatePreset,
    MissionCompletionPreset,
    MissionFailedPreset,
    RadarDailyBriefingEmailPreset,
    RadarWeeklyBriefingEmailPreset,
  ],
  exports: [
    NotificationDispatcher,
    NotificationPreferenceService,
    UnsubscribeTokenService,
    RadarMissionCompletePreset,
    FeedbackStatusUpdatePreset,
    MissionCompletionPreset,
    MissionFailedPreset,
    RadarDailyBriefingEmailPreset,
    RadarWeeklyBriefingEmailPreset,
  ],
})
export class NotificationDispatcherModule {}
