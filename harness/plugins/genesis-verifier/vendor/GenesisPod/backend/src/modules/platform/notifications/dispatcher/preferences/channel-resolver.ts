import { Injectable, Logger } from "@nestjs/common";
import { NotificationType, NotificationPreference } from "@prisma/client";
import {
  DispatchOptions,
  INotificationChannel,
  NotificationChannel,
} from "../abstractions/notification-channel";

/**
 * ChannelResolver —— 决定该 dispatch 走哪些 channel
 *
 * 来源：daily-briefing-redesign-2026-05-18.md §7.2 + R3 security 整改：
 *   1. forceChannels 优先（系统级强制，绕用户偏好）
 *   2. 否则 channel.isAvailable() 过滤（如 wechat 未绑定 → 跳过）
 *   3. 用户 channelSubscriptions[type] 矩阵决定 site/email/wechat 个别 boolean
 *   4. excludeChannels 反向屏蔽（产品决策，如 tier3 不发 email）
 *
 * 矩阵默认策略（preference.channelSubscriptions 没设该 type 时）：
 *   - RADAR_TIER3_INSTANT: site + wechat（产品默认即时推走两渠道，不走 email）
 *   - RADAR_DAILY / RADAR_WEEKLY: email + site
 *   - 其他业务通知: site（保守默认）
 */
@Injectable()
export class ChannelResolver {
  private readonly log = new Logger(ChannelResolver.name);

  /**
   * 解析最终目标 channel 集合
   *
   * @param userId 用户 ID
   * @param type 通知类型
   * @param channels 注册到 dispatcher 的所有 channel adapter
   * @param preference 用户偏好（可能为 null，按默认走）
   * @param options dispatch 选项
   */
  async resolve(
    userId: string,
    type: NotificationType,
    channels: Map<NotificationChannel, INotificationChannel>,
    preference: NotificationPreference | null,
    options?: DispatchOptions,
  ): Promise<NotificationChannel[]> {
    const exclude = new Set(options?.excludeChannels ?? []);

    // 1) forceChannels 优先：系统级强制（仅在 capabilities + isAvailable 通过时落地）
    if (options?.forceChannels?.length) {
      const force = options.forceChannels.filter((c) => !exclude.has(c));
      const usable = await this.filterAvailable(userId, force, channels);
      this.log.debug(
        `[force] user=${userId} type=${type} resolved=${usable.join(",")}`,
      );
      return usable;
    }

    // 2) 矩阵：channelSubscriptions[type] || 默认策略
    const matrix = this.resolveMatrix(type, preference);

    // 3) 应用 exclude
    const candidates = matrix.filter((c) => !exclude.has(c));

    // 4) 过滤 isAvailable
    const usable = await this.filterAvailable(userId, candidates, channels);
    this.log.debug(
      `[matrix] user=${userId} type=${type} matrix=${matrix.join(",")} → usable=${usable.join(",")}`,
    );
    return usable;
  }

  /** 读用户矩阵 channelSubscriptions[type]，缺失走默认策略 */
  resolveMatrix(
    type: NotificationType,
    preference: NotificationPreference | null,
  ): NotificationChannel[] {
    const subs = (preference?.channelSubscriptions ?? {}) as Record<
      string,
      Partial<Record<NotificationChannel, boolean>>
    >;
    const typeSubs = subs[type];

    if (typeSubs && typeof typeSubs === "object") {
      const explicit: NotificationChannel[] = [];
      if (typeSubs.site) explicit.push("site");
      if (typeSubs.email) explicit.push("email");
      if (typeSubs.wechat) explicit.push("wechat");
      if (typeSubs.webpush) explicit.push("webpush");
      return explicit;
    }

    // 默认策略（用户没显式设置该 type 时）
    return ChannelResolver.defaultForType(type);
  }

  /**
   * 默认策略：未设置时按通知类型回退
   *
   * 设计原则：业务侧偏好"安全 + 不打扰"，倾向 site 兜底；
   * 邮件类业务（RADAR_DAILY / RADAR_WEEKLY / 老 preset 通知）默认 email + site；
   * 即时高优先级（tier3）默认 site + wechat（DR3 真启用前 wechat 不可用会跳）。
   */
  static defaultForType(type: NotificationType): NotificationChannel[] {
    switch (type) {
      case "RADAR_DAILY":
      case "RADAR_WEEKLY":
        return ["email", "site"];
      case "RADAR_TIER3_INSTANT":
        return ["site", "wechat"];
      case "RADAR_SOURCE_AUTO_DISABLED":
        return ["email", "site"];
      case "RADAR_MISSION_COMPLETE":
      case "MISSION_COMPLETED":
      case "RESEARCH_COMPLETED":
      case "WRITING_COMPLETED":
      case "OFFICE_COMPLETED":
        return ["site"]; // 任务完成走站内（密度高，避免邮件 spam）
      case "MISSION_FAILED":
        // 失败低频 + 高重要性：必须 email，确保用户关了 UI 也知道（e2e P0-#5 的核心）
        return ["email", "site"];
      case "FEEDBACK_REPLIED":
      case "FEEDBACK_STATUS_CHANGED":
        return ["email", "site"];
      case "KEY_REQUEST_SUBMITTED":
      case "KEY_REQUEST_APPROVED":
      case "KEY_REQUEST_REJECTED":
      case "KEY_GRANTED":
        return ["email", "site"];
      default:
        return ["site"];
    }
  }

  private async filterAvailable(
    userId: string,
    target: NotificationChannel[],
    channels: Map<NotificationChannel, INotificationChannel>,
  ): Promise<NotificationChannel[]> {
    const out: NotificationChannel[] = [];
    for (const ch of target) {
      const adapter = channels.get(ch);
      if (!adapter) continue; // 未注册的 channel（如 PR-DR1a 未实装 email/wechat）静默跳
      try {
        if (await adapter.isAvailable(userId)) out.push(ch);
      } catch (err) {
        this.log.warn(
          `isAvailable(${ch}, ${userId}) throw, treat as unavailable: ${(err as Error).message}`,
        );
      }
    }
    return out;
  }
}
