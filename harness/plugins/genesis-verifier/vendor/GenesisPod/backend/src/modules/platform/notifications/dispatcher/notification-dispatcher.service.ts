import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  DispatchChannelResult,
  DispatchOptions,
  DispatchPayload,
  DispatchResult,
  INotificationChannel,
  NotificationChannel,
} from "./abstractions/notification-channel";
import { SiteChannel } from "./channels/site-channel.adapter";
import { ChannelResolver } from "./preferences/channel-resolver";
import { NotificationPreferenceService } from "./preferences/notification-preference.service";
import { DispatcherQuotaService } from "./dispatcher-quota.service";

/**
 * NotificationDispatcher 公共能力（PR-DR1a 框架版）
 *
 * 来源：docs/architecture/ai-app/radar/daily-briefing-redesign-2026-05-18.md
 *   §7.2 主入口 / §8.6 模块结构
 *
 * 行为：
 * 1. 读用户偏好（channelSubscriptions 矩阵 + quietHours）
 * 2. ChannelResolver 决定走哪些 channel
 * 3. Promise.allSettled fan-out 到各 channel（单 channel 失败不阻塞）
 * 4. 返回 DispatchResult 结构化每路结果（caller 可决定是否再 retry）
 *
 * 反模式守护：
 * - **不** 把"用户关了 channel"当 error（resolver 直接不返回该 channel，
 *   send() 不调用，DispatchChannelResult.status='skipped' reason='disabled-by-preference'）
 * - **不** 因偏好读失败而阻塞通知（pref=null → 走默认策略，feedback_fallback_must_be_self_consistent）
 *
 * PR-DR1a 实装 channel：仅 SiteChannel。
 *   - EmailChannel 在 PR-DR1b 注入；WechatChannel 在 PR-DR3 注入；
 *   - 注入靠 @Optional() + register() 暴露式扩展点，避免 PR-DR1a 文件被反复修改
 *
 * R2 security P2-2 整改：dailyQuotaPerUser 真正 enforce（DispatcherQuotaService）
 *   - Redis INCR + EXPIRE 24h 限频，超额 channel-level skip，不影响其他 channel
 *   - dispatchMany concurrency option：caller 用 BullMQ 控并发（K3 决策），
 *     dispatcher 若内置 throttle 会双源，DR2 sweepDaily 仍靠 caller 控
 */
@Injectable()
export class NotificationDispatcher {
  private readonly log = new Logger(NotificationDispatcher.name);
  private readonly channels = new Map<
    NotificationChannel,
    INotificationChannel
  >();

  constructor(
    siteChannel: SiteChannel,
    private readonly preferenceService: NotificationPreferenceService,
    private readonly channelResolver: ChannelResolver,
    private readonly quotaService: DispatcherQuotaService,
    private readonly prisma: PrismaService,
    @Optional() @Inject("EMAIL_CHANNEL") emailChannel?: INotificationChannel,
    @Optional() @Inject("WECHAT_CHANNEL") wechatChannel?: INotificationChannel,
    @Optional()
    @Inject("WEBPUSH_CHANNEL")
    webpushChannel?: INotificationChannel,
  ) {
    this.register(siteChannel);
    if (emailChannel) this.register(emailChannel);
    if (wechatChannel) this.register(wechatChannel);
    if (webpushChannel) this.register(webpushChannel);
  }

  /**
   * 显式注册 channel（测试 + 后续 PR EmailChannel/WechatChannel 注入用）
   *
   * R1 pm P2 整改：同 type 重复注册时 warn（避免静默覆盖 — DR1b 若误注两个
   * EMAIL_CHANNEL 会让 capabilities 不可预期；warn 暴露问题）
   */
  register(channel: INotificationChannel): void {
    if (this.channels.has(channel.type)) {
      this.log.warn(
        `register(${channel.type}): overwriting existing channel — caller must ensure only one provider per type`,
      );
    }
    this.channels.set(channel.type, channel);
    this.log.log(`Registered channel: ${channel.type}`);
  }

  /** 当前已注册 channel 列表（测试 + observability 用） */
  getRegisteredChannels(): NotificationChannel[] {
    return Array.from(this.channels.keys());
  }

  /**
   * 主入口
   *
   * 失败语义：
   * - 单 channel 抛 → DispatchChannelResult.status='failed' + error 字段；其他 channel 继续
   * - 偏好读失败 → pref=null → 走默认策略
   * - 全部 channel skip → delivered=false（caller 可 log warn）
   */
  async dispatch(
    userId: string,
    payload: DispatchPayload,
    options?: DispatchOptions,
  ): Promise<DispatchResult> {
    // PR-DR2 P0-10 (X8 PM 评审整改) — per-topic 退订 gate
    // payload.metadata.topicId 存在 → 查 RadarTopicSubscription，
    // status='unsubscribed' 则整体跳过（所有 channel）
    const topicId = (payload.metadata as { topicId?: string })?.topicId;
    if (topicId && this.isRadarType(payload.type)) {
      const isUnsubscribed = await this.checkPerTopicUnsubscribe(
        userId,
        topicId,
      );
      if (isUnsubscribed) {
        this.log.debug(
          `dispatch skipped per-topic unsubscribe: user=${userId} topic=${topicId} type=${payload.type}`,
        );
        return {
          userId,
          type: payload.type,
          results: [],
          delivered: false,
        };
      }
    }

    const preference = await this.preferenceService.get(userId);
    const targets = await this.channelResolver.resolve(
      userId,
      payload.type,
      this.channels,
      preference,
      options,
    );

    if (targets.length === 0) {
      this.log.debug(
        `dispatch skipped: user=${userId} type=${payload.type} reason=no-targets`,
      );
      return {
        userId,
        type: payload.type,
        results: [],
        delivered: false,
      };
    }

    const results = await Promise.all(
      targets.map((ch) => this.sendSafe(ch, userId, payload)),
    );

    const delivered = results.some((r) => r.status === "sent");
    if (!delivered) {
      this.log.warn(
        `dispatch nothing delivered: user=${userId} type=${payload.type} results=${JSON.stringify(results)}`,
      );
    }
    return { userId, type: payload.type, results, delivered };
  }

  /**
   * 批量 dispatch（同 payload 给多个 userId）
   *
   * 实现：纯 fan-out（无 worker pool）。后续 PR-DR2 sweepDailyBriefing 风暴场景如需限流，
   * caller 侧用 BullMQ queue 控制并发（K3 决策），dispatcher 不内置 throttle 避免双源。
   */
  async dispatchMany(
    userIds: string[],
    payload: DispatchPayload,
    options?: DispatchOptions,
  ): Promise<DispatchResult[]> {
    return Promise.all(
      userIds.map((uid) => this.dispatch(uid, payload, options)),
    );
  }

  /**
   * PR-DR2 P0-10 helper：判断该 type 是否为 radar 通知（per-topic 退订只对 radar 系生效）
   */
  private isRadarType(type: string): boolean {
    return type.startsWith("RADAR_");
  }

  /**
   * PR-DR2 P0-10 helper：查询用户对该 topic 是否退订
   * 注：直接 Prisma 查 RadarTopicSubscription（共享 schema 表，非 ai-app 内部 service），
   * 不违反 platform→ai-app 反向依赖（无 import）
   */
  private async checkPerTopicUnsubscribe(
    userId: string,
    topicId: string,
  ): Promise<boolean> {
    try {
      const sub = await this.prisma.radarTopicSubscription.findUnique({
        where: { userId_topicId: { userId, topicId } },
        select: { status: true },
      });
      return sub?.status === "unsubscribed";
    } catch (err) {
      this.log.warn(
        `checkPerTopicUnsubscribe failed (fail-open): ${(err as Error).message}`,
      );
      return false;
    }
  }

  private async sendSafe(
    channel: NotificationChannel,
    userId: string,
    payload: DispatchPayload,
  ): Promise<DispatchChannelResult> {
    const adapter = this.channels.get(channel);
    if (!adapter) {
      return { channel, status: "skipped", reason: "channel-not-registered" };
    }
    // R2 security P2-2: dailyQuotaPerUser enforce（Redis INCR + EXPIRE 24h，fail-open）
    const cap = adapter.getCapabilities();
    const quota = await this.quotaService.check(
      userId,
      channel,
      cap.dailyQuotaPerUser,
    );
    if (!quota.allowed) {
      return { channel, status: "skipped", reason: "quota-exceeded" };
    }
    try {
      await adapter.send(userId, payload);
      return { channel, status: "sent" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 原始错误（可能含 SMTP/API 凭证）只进日志（log 仅 admin 可见）
      this.log.warn(
        `channel=${channel} send failed user=${userId} type=${payload.type}: ${msg}`,
      );
      // 返回给 caller 的 error 仅含结构化标识 — R1 security P1 整改：
      // 防止凭证经 DispatchResult 序列化到前端（如进度 WS / API 响应）
      return { channel, status: "failed", error: `${channel}-send-error` };
    }
  }
}
