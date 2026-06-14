/**
 * Message Push Tool
 * 消息推送工具 - 支持多平台消息发送 (Slack, Discord, Email, Webhook)
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../abstractions/tool.interface";
import axios from "axios";
import * as nodemailer from "nodemailer";

// ============================================================================
// Types
// ============================================================================

/**
 * 消息平台类型
 */
export type MessagePlatform =
  | "slack"
  | "discord"
  | "email"
  | "webhook"
  | "feishu";

/**
 * 消息格式类型
 */
export type MessageFormat = "plain" | "markdown" | "html" | "rich";

/**
 * 消息附件
 */
export interface MessageAttachment {
  /**
   * 附件名称
   */
  name: string;

  /**
   * 附件 URL 或 Base64 数据
   */
  url: string;

  /**
   * MIME 类型
   */
  mimeType?: string;

  /**
   * 文件大小（字节）
   */
  size?: number;
}

/**
 * Slack 特定配置
 */
export interface SlackConfig {
  /**
   * Webhook URL 或 Channel ID
   */
  channel: string;

  /**
   * Bot Token (如果使用 API)
   */
  token?: string;

  /**
   * 用户名显示
   */
  username?: string;

  /**
   * 图标 Emoji
   */
  iconEmoji?: string;

  /**
   * 是否发送为 thread
   */
  threadTs?: string;
}

/**
 * Discord 特定配置
 */
export interface DiscordConfig {
  /**
   * Webhook URL
   */
  webhookUrl: string;

  /**
   * Bot 用户名
   */
  username?: string;

  /**
   * 头像 URL
   */
  avatarUrl?: string;

  /**
   * 是否使用 TTS
   */
  tts?: boolean;
}

/**
 * Email 特定配置
 */
export interface EmailConfig {
  /**
   * 收件人邮箱列表
   */
  to: string[];

  /**
   * 抄送列表
   */
  cc?: string[];

  /**
   * 密送列表
   */
  bcc?: string[];

  /**
   * 邮件主题
   */
  subject: string;

  /**
   * 发件人名称
   */
  fromName?: string;

  /**
   * 回复地址
   */
  replyTo?: string;
}

/**
 * Webhook 特定配置
 */
export interface WebhookConfig {
  /**
   * Webhook URL
   */
  url: string;

  /**
   * HTTP 方法
   */
  method?: "POST" | "PUT" | "PATCH";

  /**
   * 自定义 Headers
   */
  headers?: Record<string, string>;

  /**
   * 认证类型
   */
  auth?: {
    type: "bearer" | "basic" | "api-key";
    token: string;
  };

  /**
   * Webhook 签名 secret（用于 X-Webhook-Secret header）
   */
  secret?: string;
}

/**
 * Feishu 特定配置
 */
export interface FeishuConfig {
  /**
   * 接收方 ID（open_id / chat_id）或飞书机器人 Webhook URL
   */
  receiveId: string;

  /**
   * 接收方 ID 类型
   */
  receiveIdType?: "open_id" | "chat_id";
}

/**
 * 消息推送输入
 */
export interface MessagePushInput {
  /**
   * 目标平台
   */
  platform: MessagePlatform;

  /**
   * 消息内容
   */
  message: string;

  /**
   * 消息格式
   */
  format?: MessageFormat;

  /**
   * 消息标题（部分平台支持）
   */
  title?: string;

  /**
   * 附件列表
   */
  attachments?: MessageAttachment[];

  /**
   * 平台特定配置
   */
  config:
    | SlackConfig
    | DiscordConfig
    | EmailConfig
    | WebhookConfig
    | FeishuConfig;

  /**
   * 优先级
   */
  priority?: "low" | "normal" | "high" | "urgent";

  /**
   * 是否需要回执
   */
  requireReceipt?: boolean;
}

/**
 * 投递状态
 */
export type DeliveryStatus =
  | "sent"
  | "delivered"
  | "failed"
  | "pending"
  | "throttled";

/**
 * 消息推送输出
 */
export interface MessagePushOutput {
  /**
   * 是否成功发送
   */
  success: boolean;

  /**
   * 投递状态
   */
  status: DeliveryStatus;

  /**
   * 消息 ID（平台返回）
   */
  messageId?: string;

  /**
   * 投递时间
   */
  deliveredAt: Date;

  /**
   * 投递 URL（如果可访问）
   */
  messageUrl?: string;

  /**
   * 错误信息
   */
  error?: string;

  /**
   * 平台响应元数据
   */
  metadata?: {
    /**
     * 平台
     */
    platform: MessagePlatform;

    /**
     * 重试次数
     */
    retryCount?: number;

    /**
     * 响应代码
     */
    statusCode?: number;

    /**
     * 投递延迟（毫秒）
     */
    latency?: number;
  };
}

// ============================================================================
// Tool Implementation
// ============================================================================

/**
 * 消息推送工具
 *
 * 支持多平台消息发送，包括：
 * - Slack: 使用 Webhook 或 Bot API
 * - Discord: 使用 Webhook
 * - Email: 通过 SMTP 发送
 * - Webhook: 自定义 HTTP 回调
 *
 * @example
 * ```typescript
 * // 发送 Slack 消息
 * {
 *   platform: "slack",
 *   message: "部署完成！✅",
 *   format: "markdown",
 *   config: {
 *     channel: "#deployments",
 *     username: "DeployBot",
 *     iconEmoji: ":rocket:"
 *   }
 * }
 *
 * // 发送带附件的 Discord 消息
 * {
 *   platform: "discord",
 *   title: "生成报告",
 *   message: "本周数据分析报告已生成",
 *   format: "rich",
 *   attachments: [{
 *     name: "report.pdf",
 *     url: "https://example.com/report.pdf"
 *   }],
 *   config: {
 *     webhookUrl: "https://discord.com/api/webhooks/..."
 *   }
 * }
 * ```
 */
@Injectable()
export class MessagePushTool extends BaseTool<
  MessagePushInput,
  MessagePushOutput
> {
  private readonly logger = new Logger(MessagePushTool.name);

  readonly id = "message-push";
  readonly sideEffect = "destructive" as const;
  readonly category: ToolCategory = "integration";
  readonly tags = ["integration", "notification", "push", "messaging", "slack", "feishu"];
  readonly name = "消息推送";
  readonly description =
    "向多个平台发送消息通知，支持 Slack、Discord、Email 和自定义 Webhook。可发送纯文本、Markdown、HTML 或富文本格式，支持附件和多种投递选项。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      platform: {
        type: "string",
        description: "目标平台：slack、discord、email、webhook 或 feishu",
        enum: ["slack", "discord", "email", "webhook", "feishu"],
      },
      message: {
        type: "string",
        description: "消息内容，支持不同格式",
      },
      format: {
        type: "string",
        description: "消息格式",
        enum: ["plain", "markdown", "html", "rich"],
        default: "markdown",
      },
      title: {
        type: "string",
        description: "消息标题（部分平台支持，如 Discord、Email）",
      },
      attachments: {
        type: "array",
        description: "附件列表",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "附件名称" },
            url: { type: "string", description: "附件 URL" },
            mimeType: { type: "string", description: "MIME 类型" },
            size: { type: "number", description: "文件大小（字节）" },
          },
          required: ["name", "url"],
        },
      },
      config: {
        type: "object",
        description: "平台特定配置（根据 platform 选择对应配置）",
      },
      priority: {
        type: "string",
        description: "消息优先级",
        enum: ["low", "normal", "high", "urgent"],
        default: "normal",
      },
      requireReceipt: {
        type: "boolean",
        description: "是否需要投递回执",
        default: false,
      },
    },
    required: ["platform", "message", "config"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: {
        type: "boolean",
        description: "是否成功发送",
      },
      status: {
        type: "string",
        description: "投递状态",
        enum: ["sent", "delivered", "failed", "pending", "throttled"],
      },
      messageId: {
        type: "string",
        description: "平台返回的消息 ID",
      },
      deliveredAt: {
        type: "string",
        description: "投递时间",
      },
      messageUrl: {
        type: "string",
        description: "消息访问 URL",
      },
      error: {
        type: "string",
        description: "错误信息（如果失败）",
      },
      metadata: {
        type: "object",
        description: "平台响应元数据",
      },
    },
  };

  constructor() {
    super();
    // defaultTimeout set in class property // 30 秒超时
  }

  /**
   * 验证输入
   */
  validateInput(input: MessagePushInput) {
    // 验证平台
    const validPlatforms: MessagePlatform[] = [
      "slack",
      "discord",
      "email",
      "webhook",
      "feishu",
    ];
    if (!validPlatforms.includes(input.platform)) {
      this.logger.warn(`Invalid platform: ${input.platform}`);
      return false;
    }

    // 验证消息内容
    if (!input.message || input.message.trim().length === 0) {
      this.logger.warn("Message content is required");
      return false;
    }

    // 验证消息长度（不同平台有不同限制）
    const maxLengths: Record<MessagePlatform, number> = {
      slack: 40000,
      discord: 2000,
      email: 100000,
      webhook: 50000,
      feishu: 30000,
    };
    if (input.message.length > maxLengths[input.platform]) {
      this.logger.warn(
        `Message too long for ${input.platform}: ${input.message.length} > ${maxLengths[input.platform]}`,
      );
      return false;
    }

    // 验证配置
    if (!input.config) {
      this.logger.warn("Platform config is required");
      return false;
    }

    // 平台特定验证
    switch (input.platform) {
      case "slack":
        return this.validateSlackConfig(input.config as SlackConfig);
      case "discord":
        return this.validateDiscordConfig(input.config as DiscordConfig);
      case "email":
        return this.validateEmailConfig(input.config as EmailConfig);
      case "webhook":
        return this.validateWebhookConfig(input.config as WebhookConfig);
      case "feishu":
        return this.validateFeishuConfig(input.config as FeishuConfig);
      default:
        return false;
    }
  }

  /**
   * 执行消息推送
   */
  protected async doExecute(
    input: MessagePushInput,
    context: ToolContext,
  ): Promise<MessagePushOutput> {
    const startTime = Date.now();

    this.logger.log(
      `Sending message to ${input.platform} [task: ${context.executionId}]`,
    );

    try {
      let result: MessagePushOutput;

      // 根据平台调用相应的发送方法
      switch (input.platform) {
        case "slack":
          result = await this.sendToSlack(input, context);
          break;
        case "discord":
          result = await this.sendToDiscord(input, context);
          break;
        case "email":
          result = await this.sendToEmail(input, context);
          break;
        case "webhook":
          result = await this.sendToWebhook(input, context);
          break;
        case "feishu":
          result = await this.sendToFeishu(input, context);
          break;
        default:
          throw new Error(`Unsupported platform: ${input.platform}`);
      }

      // 添加延迟元数据
      if (result.metadata) {
        result.metadata.latency = Date.now() - startTime;
      }

      this.logger.log(
        `Message ${result.status} on ${input.platform}: ${result.messageId || "no-id"}`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to send message to ${input.platform}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );

      return {
        success: false,
        status: "failed",
        deliveredAt: new Date(),
        error: error instanceof Error ? error.message : "Unknown error",
        metadata: {
          platform: input.platform,
          latency: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * 发送到 Slack
   */
  private async sendToSlack(
    input: MessagePushInput,
    _context: ToolContext,
  ): Promise<MessagePushOutput> {
    const config = input.config as SlackConfig;

    this.logger.debug(`Sending to Slack channel: ${config.channel}`);

    if (config.channel.startsWith("http")) {
      // Incoming Webhook URL - post directly
      const payload: Record<string, unknown> = {
        text: input.message,
        ...(config.username ? { username: config.username } : {}),
        ...(config.iconEmoji ? { icon_emoji: config.iconEmoji } : {}),
      };
      const response = await axios.post(config.channel, payload, {
        timeout: 10000,
      });
      if (response.status !== 200 || response.data !== "ok") {
        throw new Error(
          `Slack webhook error: ${JSON.stringify(response.data)}`,
        );
      }
    } else {
      // Slack Bot API
      const token = config.token;
      if (!token) {
        throw new Error("Slack token required for channel messaging");
      }
      const payload: Record<string, unknown> = {
        channel: config.channel,
        text: input.message,
        ...(config.username ? { username: config.username } : {}),
        ...(config.threadTs ? { thread_ts: config.threadTs } : {}),
      };
      const response = await axios.post(
        "https://slack.com/api/chat.postMessage",
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );
      if (!response.data.ok) {
        throw new Error(`Slack API error: ${response.data.error}`);
      }

      return {
        success: true,
        status: "delivered",
        messageId: response.data.ts
          ? `slack-${response.data.ts}`
          : `slack-${Date.now()}`,
        deliveredAt: new Date(),
        messageUrl: response.data.message?.permalink,
        metadata: {
          platform: "slack",
          statusCode: response.status,
        },
      };
    }

    return {
      success: true,
      status: "delivered",
      messageId: `slack-${Date.now()}`,
      deliveredAt: new Date(),
      metadata: {
        platform: "slack",
        statusCode: 200,
      },
    };
  }

  /**
   * 发送到 Discord
   */
  private async sendToDiscord(
    input: MessagePushInput,
    _context: ToolContext,
  ): Promise<MessagePushOutput> {
    const config = input.config as DiscordConfig;

    this.logger.debug(`Sending to Discord webhook: ${config.webhookUrl}`);

    const payload: Record<string, unknown> = {
      content: input.message,
      ...(config.username ? { username: config.username } : {}),
      ...(config.avatarUrl ? { avatar_url: config.avatarUrl } : {}),
      ...(config.tts !== undefined ? { tts: config.tts } : {}),
    };

    const response = await axios.post(config.webhookUrl, payload, {
      timeout: 10000,
    });

    if (response.status !== 204 && response.status !== 200) {
      throw new Error(`Discord webhook error: HTTP ${response.status}`);
    }

    return {
      success: true,
      status: "delivered",
      messageId: `discord-${Date.now()}`,
      deliveredAt: new Date(),
      metadata: {
        platform: "discord",
        statusCode: response.status,
      },
    };
  }

  /**
   * 发送邮件
   */
  private async sendToEmail(
    input: MessagePushInput,
    _context: ToolContext,
  ): Promise<MessagePushOutput> {
    const config = input.config as EmailConfig;

    this.logger.debug(`Sending email to: ${config.to.join(", ")}`);

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: false,
      auth: process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS || "",
          }
        : undefined,
      connectionTimeout: 10000,
    });

    const fromAddress =
      process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@example.com";
    const from = config.fromName
      ? `${config.fromName} <${fromAddress}>`
      : fromAddress;

    const isHtml = input.format === "html";
    await transporter.sendMail({
      from,
      to: config.to.join(", "),
      ...(config.cc && config.cc.length > 0
        ? { cc: config.cc.join(", ") }
        : {}),
      ...(config.bcc && config.bcc.length > 0
        ? { bcc: config.bcc.join(", ") }
        : {}),
      subject: config.subject || input.message.substring(0, 78),
      ...(config.replyTo ? { replyTo: config.replyTo } : {}),
      ...(isHtml ? { html: input.message } : { text: input.message }),
    });

    return {
      success: true,
      status: "sent",
      messageId: `email-${Date.now()}`,
      deliveredAt: new Date(),
      metadata: {
        platform: "email",
        statusCode: 250, // SMTP success code
      },
    };
  }

  /**
   * 发送到自定义 Webhook
   */
  private async sendToWebhook(
    input: MessagePushInput,
    _context: ToolContext,
  ): Promise<MessagePushOutput> {
    const config = input.config as WebhookConfig;

    this.logger.debug(`Sending to webhook: ${config.url}`);

    const payload: Record<string, unknown> = {
      message: input.message,
      timestamp: new Date().toISOString(),
      ...(input.title ? { title: input.title } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(config.headers || {}),
    };

    // Apply auth header
    if (config.auth) {
      switch (config.auth.type) {
        case "bearer":
          headers["Authorization"] = `Bearer ${config.auth.token}`;
          break;
        case "basic":
          headers["Authorization"] =
            `Basic ${Buffer.from(config.auth.token).toString("base64")}`;
          break;
        case "api-key":
          headers["X-API-Key"] = config.auth.token;
          break;
      }
    }

    // Apply secret header if configured
    if (config.secret) {
      headers["X-Webhook-Secret"] = config.secret;
    }

    const method = config.method || "POST";
    const response = await axios.request({
      method,
      url: config.url,
      data: payload,
      headers,
      timeout: 15000,
      validateStatus: () => true, // Let us handle status ourselves
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Webhook error: HTTP ${response.status}`);
    }

    return {
      success: true,
      status: "delivered",
      messageId: `webhook-${Date.now()}`,
      deliveredAt: new Date(),
      metadata: {
        platform: "webhook",
        statusCode: response.status,
      },
    };
  }

  /**
   * 验证 Slack 配置
   */
  private validateSlackConfig(config: SlackConfig): boolean {
    if (!config.channel || config.channel.trim().length === 0) {
      this.logger.warn("Slack channel is required");
      return false;
    }
    return true;
  }

  /**
   * 验证 Discord 配置
   */
  private validateDiscordConfig(config: DiscordConfig): boolean {
    if (!config.webhookUrl || !config.webhookUrl.startsWith("https://")) {
      this.logger.warn("Valid Discord webhook URL is required");
      return false;
    }
    return true;
  }

  /**
   * 验证 Email 配置
   */
  private validateEmailConfig(config: EmailConfig): boolean {
    if (!config.to || config.to.length === 0) {
      this.logger.warn("At least one recipient is required");
      return false;
    }

    // 简单的邮箱格式验证
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = config.to.filter((email) => !emailRegex.test(email));
    if (invalidEmails.length > 0) {
      this.logger.warn(`Invalid email addresses: ${invalidEmails.join(", ")}`);
      return false;
    }

    if (!config.subject || config.subject.trim().length === 0) {
      this.logger.warn("Email subject is required");
      return false;
    }

    return true;
  }

  /**
   * 验证 Webhook 配置
   */
  private validateWebhookConfig(config: WebhookConfig): boolean {
    if (!config.url || !config.url.startsWith("http")) {
      this.logger.warn("Valid webhook URL is required");
      return false;
    }
    return true;
  }

  /**
   * 验证 Feishu 配置
   */
  private validateFeishuConfig(config: FeishuConfig): boolean {
    if (!config.receiveId || config.receiveId.trim().length === 0) {
      this.logger.warn("Feishu receiveId is required");
      return false;
    }
    return true;
  }

  /**
   * 发送到飞书
   * receiveId 可以是飞书机器人 Webhook URL（以 http 开头）
   * 或 open_id/chat_id（需要配合飞书 Bot Token，当前不支持）
   */
  private async sendToFeishu(
    input: MessagePushInput,
    _context: ToolContext,
  ): Promise<MessagePushOutput> {
    const config = input.config as FeishuConfig;

    this.logger.debug(
      `Sending to Feishu: receiveId=${config.receiveId}, type=${config.receiveIdType || "open_id"}`,
    );

    if (!config.receiveId.startsWith("http")) {
      throw new Error(
        "Feishu receiveId must be a webhook URL (starting with http). " +
          "Direct open_id/chat_id messaging requires a Feishu Bot Token which is not configured.",
      );
    }

    // Feishu Bot Webhook
    const payload = {
      msg_type: "text",
      content: { text: input.message },
    };

    const response = await axios.post(config.receiveId, payload, {
      timeout: 10000,
    });

    // Feishu webhook returns StatusCode=0 or code=0 on success
    if (response.data?.StatusCode !== 0 && response.data?.code !== 0) {
      throw new Error(`Feishu webhook error: ${JSON.stringify(response.data)}`);
    }

    return {
      success: true,
      status: "delivered",
      messageId: `feishu-${Date.now()}`,
      deliveredAt: new Date(),
      metadata: {
        platform: "feishu",
        statusCode: response.status,
      },
    };
  }
}
