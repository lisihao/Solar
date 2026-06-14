import { NotificationType } from "@prisma/client";

/**
 * NotificationDispatcher 公共能力接口集（PR-DR1a）
 *
 * 设计来源：docs/architecture/ai-app/radar/daily-briefing-redesign-2026-05-18.md
 *   §7.2 NotificationDispatcher 公共能力
 *   §7.2.2 INotificationChannel + ChannelCapabilities
 *
 * 关键设计原则：
 * 1. 单 channel 失败不阻塞其他（dispatcher 走 Promise.allSettled）
 * 2. capabilities 声明 channel 元数据（绑定要求 / 全局配置要求 / 限频）
 * 3. excludeChannels 走产品决策（如 RADAR_TIER3_INSTANT 不发 email），
 *    forceChannels 仅在系统级强制场景使用（R3 安全整改：用户偏好 + 矩阵不能被
 *    forceChannels 绕过 → 默认走 channel-resolver 的 channelSubscriptions 矩阵）
 */

/** 4 个 channel 类型（webpush Phase 2 不实现） */
export type NotificationChannel = "site" | "email" | "wechat" | "webpush";

/**
 * Channel 能力声明 —— dispatcher 决定 caller 能否用该 channel
 *
 * R1 arch P0-2 整改：原 INotificationChannel 缺这个抽象，dispatcher 无法
 * 在不绑定的用户下提前 reject wechat（要么强发失败要么静默吞）。
 */
export interface ChannelCapabilities {
  /** 需 user 主动绑定（如 WeChat OpenID）才能用 */
  requiresUserBinding: boolean;
  /** 需全局配置（如 SMTP/Resend provider key） */
  requiresGlobalConfig: boolean;
  /**
   * 该 channel 每用户每日推送上限（防 spam / 平台限频）
   * - site: 200
   * - email: 50
   * - wechat: 5（微信订阅消息硬限）
   * - webpush: 100
   */
  dailyQuotaPerUser: number;
}

/** Channel adapter 实现接口 */
export interface INotificationChannel {
  readonly type: NotificationChannel;
  /** 单 channel 发送；失败 throw（dispatcher 捕获不阻塞其他 channel） */
  send(userId: string, payload: DispatchPayload): Promise<void>;
  /** 用户该 channel 是否可用（如 wechat 未绑定 → false） */
  isAvailable(userId: string): Promise<boolean>;
  /** 能力声明 */
  getCapabilities(): ChannelCapabilities;
}

/**
 * Dispatch 业务负载
 *
 * type 决定 caller 走"按类型偏好分发"还是显式渠道；其他字段按 channel 需要消费：
 * - site: title + message + link
 * - email: title + message + emailContext（Handlebars 数据）
 * - wechat: wechatTemplate（templateId + data）
 */
export interface DispatchPayload {
  type: NotificationType;
  title: string;
  message: string;
  /** 站内通知用：跳转 URL */
  link?: string;
  /** Email 渲染用：模板数据（PR-DR1b EmailChannel 消费） */
  emailContext?: Record<string, unknown>;
  /** 微信订阅消息：模板 id + data（PR-DR3 WechatChannel 消费） */
  wechatTemplate?: { templateId: string; data: Record<string, string> };
  /** metadata 写入 NotificationCenter */
  metadata?: Record<string, unknown>;
  /** 站内通知优先级（tier3 即时推用 high） */
  priority?: "high" | "normal";
}

/**
 * Dispatch 选项
 *
 * R3 security 整改：默认走 channel-resolver 按 channelSubscriptions 决定 channel；
 * forceChannels 仅在系统级强制场景（如审计追责通知）使用，业务不推荐。
 * excludeChannels 是产品决策的反向门（如 tier3 不发 email 避 spam）。
 */
export interface DispatchOptions {
  /** caller 强制走某些 channel（绕过用户矩阵 — 仅系统级使用） */
  forceChannels?: NotificationChannel[];
  /** caller 强制屏蔽某些 channel（产品决策） */
  excludeChannels?: NotificationChannel[];
}

/** Dispatch 单个 channel 的结果 */
export interface DispatchChannelResult {
  channel: NotificationChannel;
  status: "sent" | "skipped" | "failed";
  reason?: string;
  error?: string;
}

/** Dispatch 总结果 */
export interface DispatchResult {
  userId: string;
  type: NotificationType;
  results: DispatchChannelResult[];
  /** 至少一个 channel sent */
  delivered: boolean;
}
