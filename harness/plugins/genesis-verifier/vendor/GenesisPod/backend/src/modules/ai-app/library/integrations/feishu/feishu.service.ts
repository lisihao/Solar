/**
 * Feishu Service
 * Handles message receiving and sending via Feishu Bot
 */

import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  ChatMessage,
  TaskProfile,
} from "@/modules/ai-harness/facade";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { FeishuAuthService } from "./feishu-auth.service";
import { FeishuDataSourceService } from "./feishu-data-source.service";
import { UrlFetchService } from "../../rag/services/url-fetch.service";
import { APP_CONFIG } from "../../../../../common/config/app.config";

const FEISHU_API_BASE = "https://open.feishu.cn/open-apis";

/**
 * Feishu event header
 */
interface FeishuEventHeader {
  event_id: string;
  event_type: string;
  create_time: string;
  token: string;
  app_id: string;
  tenant_key: string;
}

/**
 * Feishu message event payload
 */
interface FeishuMessageEvent {
  sender: {
    sender_id: {
      open_id: string;
      user_id?: string;
      union_id?: string;
    };
    sender_type: string;
    tenant_key: string;
  };
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    create_time: string;
    chat_id: string;
    chat_type: string; // "p2p" | "group"
    message_type: string; // "text" | "post" | "image" | ...
    content: string; // JSON string
    mentions?: Array<{
      key: string;
      id: {
        open_id: string;
        user_id?: string;
        union_id?: string;
      };
      name: string;
      tenant_key: string;
    }>;
  };
}

@Injectable()
export class FeishuService implements OnModuleDestroy {
  private readonly logger = new Logger(FeishuService.name);
  private cleanupInterval: ReturnType<typeof setInterval>;

  // AI trigger prefixes
  private readonly AI_TRIGGER_PREFIXES = [
    "@AI",
    "@ai",
    "@助手",
    `@${APP_CONFIG.brand.name}`,
    `@${APP_CONFIG.brand.name.toLowerCase()}`,
    "/ai",
    "/分析",
    "/总结",
    "/翻译",
  ];

  // Processed event IDs to prevent duplicate processing
  private readonly processedEvents = new Map<string, number>();
  private readonly EVENT_DEDUP_TTL = 300000; // 5 minutes

  constructor(
    private httpService: HttpService,
    private prisma: PrismaService,
    private chatFacade: ChatFacade,
    private feishuAuth: FeishuAuthService,
    private feishuDataSource: FeishuDataSourceService,
    private urlFetchService: UrlFetchService,
  ) {
    // Periodically clean up processed events
    this.cleanupInterval = setInterval(
      () => this.cleanupProcessedEvents(),
      60000,
    ).unref();
  }

  onModuleDestroy() {
    clearInterval(this.cleanupInterval);
  }

  /**
   * Handle incoming Feishu event
   */
  async handleEvent(
    eventType: string,
    event: Record<string, unknown>,
    header: FeishuEventHeader,
  ): Promise<void> {
    // Dedup check
    if (this.processedEvents.has(header.event_id)) {
      this.logger.log(`Skipping duplicate event: ${header.event_id}`);
      return;
    }
    this.processedEvents.set(header.event_id, Date.now());

    this.logger.log(
      `Processing event: type=${eventType}, id=${header.event_id}`,
    );

    switch (eventType) {
      case "im.message.receive_v1":
        await this.handleMessageEvent(event as unknown as FeishuMessageEvent);
        break;
      default:
        this.logger.log(`Unhandled event type: ${eventType}`);
    }
  }

  /**
   * Handle message received event
   */
  private async handleMessageEvent(event: FeishuMessageEvent): Promise<void> {
    const { sender, message } = event;
    const senderOpenId = sender.sender_id.open_id;
    const messageType = message.message_type;
    const chatId = message.chat_id;

    this.logger.log(
      `Message from ${senderOpenId}: type=${messageType}, chat=${chatId}`,
    );

    // Skip bot messages
    if (sender.sender_type === "app") {
      return;
    }

    switch (messageType) {
      case "text":
        await this.handleTextMessage(senderOpenId, chatId, message);
        break;
      case "post":
        await this.handlePostMessage(senderOpenId, chatId, message);
        break;
      default:
        this.logger.log(`Unsupported message type: ${messageType}`);
        await this.sendTextMessage(
          senderOpenId,
          `暂不支持 ${messageType} 类型的消息。\n\n支持的消息类型：\n- 文本消息（@AI 开头触发分析）\n- 富文本消息`,
        );
    }
  }

  /**
   * Handle text message
   */
  private async handleTextMessage(
    senderOpenId: string,
    _chatId: string,
    message: FeishuMessageEvent["message"],
  ): Promise<void> {
    let content: string;
    try {
      const parsed = JSON.parse(message.content);
      content = (parsed.text || "").trim();
    } catch {
      this.logger.warn("Failed to parse message content");
      return;
    }

    // Remove @mentions from text (Feishu adds @_user_1 placeholders)
    content = content.replace(/@_user_\d+/g, "").trim();

    this.logger.log(
      `Text from ${senderOpenId}: ${content.substring(0, 50)}...`,
    );

    // Check if message contains a URL
    const urlMatch = content.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      await this.handleUrlImport(senderOpenId, urlMatch[0]);
      return;
    }

    // Check for AI trigger prefix
    const aiTrigger = this.AI_TRIGGER_PREFIXES.find((prefix) =>
      content.startsWith(prefix),
    );

    // In group chats, also trigger on @mentions
    const isMentioned = message.mentions && message.mentions.length > 0;

    if (aiTrigger || isMentioned) {
      let query = content;
      if (aiTrigger) {
        query = content.substring(aiTrigger.length).trim();
      }

      if (!query) {
        await this.sendTextMessage(senderOpenId, this.getHelpMessage());
        return;
      }

      // Extract URL if present in query
      const urlInQuery = query.match(/https?:\/\/[^\s]+/);
      const url = urlInQuery ? urlInQuery[0] : null;

      await this.sendTextMessage(senderOpenId, "正在分析中，请稍候...");

      try {
        const aiResponse = await this.callAiAnalysis(query, url);
        await this.sendTextMessage(senderOpenId, aiResponse);
      } catch (error) {
        this.logger.error(`AI analysis failed: ${error}`);
        await this.sendTextMessage(
          senderOpenId,
          "抱歉，AI 分析过程中出现错误，请稍后再试。",
        );
      }
    } else {
      await this.sendTextMessage(senderOpenId, this.getHelpMessage());
    }
  }

  /**
   * Handle rich text (post) message
   */
  private async handlePostMessage(
    senderOpenId: string,
    _chatId: string,
    message: FeishuMessageEvent["message"],
  ): Promise<void> {
    try {
      const parsed = JSON.parse(message.content);
      // Extract text and links from post content
      const { text, urls } = this.extractFromPost(parsed);

      if (urls.length > 0) {
        // Import first URL
        await this.handleUrlImport(senderOpenId, urls[0]);
        return;
      }

      if (text) {
        await this.sendTextMessage(senderOpenId, "正在分析中，请稍候...");
        const aiResponse = await this.callAiAnalysis(text, null);
        await this.sendTextMessage(senderOpenId, aiResponse);
      }
    } catch (error) {
      this.logger.error(`Failed to process post message: ${error}`);
      await this.sendTextMessage(
        senderOpenId,
        "抱歉，无法解析此消息，请发送纯文本或链接。",
      );
    }
  }

  /**
   * Extract text and URLs from Feishu post (rich text) content
   */
  private extractFromPost(postContent: Record<string, unknown>): {
    text: string;
    urls: string[];
  } {
    const texts: string[] = [];
    const urls: string[] = [];

    // Post content structure: { zh_cn: { title, content: [[elements]] } }
    const locales = ["zh_cn", "en_us", "ja_jp"];
    for (const locale of locales) {
      const localeContent = postContent[locale] as
        | {
            title?: string;
            content?: Array<
              Array<{ tag: string; text?: string; href?: string }>
            >;
          }
        | undefined;
      if (!localeContent?.content) continue;

      if (localeContent.title) {
        texts.push(localeContent.title);
      }

      for (const paragraph of localeContent.content) {
        for (const element of paragraph) {
          if (element.tag === "text" && element.text) {
            texts.push(element.text);
          }
          if (element.tag === "a" && element.href) {
            urls.push(element.href);
            if (element.text) texts.push(element.text);
          }
        }
      }
      break; // Use first available locale
    }

    return { text: texts.join(" ").trim(), urls };
  }

  /**
   * Handle URL import to data source
   */
  private async handleUrlImport(
    senderOpenId: string,
    url: string,
  ): Promise<void> {
    this.logger.log(`Importing URL: ${url}`);
    await this.sendTextMessage(senderOpenId, "正在同步到数据源，请稍候...");

    try {
      const platformUserId = await this.getUserIdFromFeishu(senderOpenId);

      if (!platformUserId) {
        await this.sendTextMessage(
          senderOpenId,
          `无法识别您的用户身份。\n\n请在 ${APP_CONFIG.brand.name} 平台的"个人设置 → 集成"中绑定飞书账号。\n\n您的飞书 Open ID 是：\n${senderOpenId}\n\n请复制此 ID 并粘贴到绑定界面中。`,
        );
        return;
      }

      // Check if already exists
      const exists = await this.feishuDataSource.urlExists(platformUserId, url);
      if (exists) {
        await this.sendTextMessage(senderOpenId, "该内容已存在于数据源中。");
        return;
      }

      // Fetch metadata
      let metadata: { title: string; description?: string; author?: string } = {
        title: url,
      };
      try {
        const fetchResult = await this.urlFetchService.fetchUrl(url);
        metadata = {
          title: fetchResult.title || url,
          description: fetchResult.metadata.description,
          author: fetchResult.metadata.author,
        };
      } catch (fetchError) {
        this.logger.warn(`Failed to fetch metadata: ${fetchError}`);
      }

      // Save to data source via service
      const item = await this.feishuDataSource.createItem({
        userId: platformUserId,
        type: "EXTERNAL",
        title: metadata.title,
        sourceUrl: url,
        description: metadata.description,
        author: metadata.author,
        syncSource: "feishu",
        feishuOpenId: senderOpenId,
      });

      await this.sendTextMessage(
        senderOpenId,
        `已同步到数据源\n\n标题: ${item.title}\n\n您可以在 ${APP_CONFIG.brand.name} 的"数据源 → 飞书"中查看和管理同步的内容。`,
      );
    } catch (error) {
      this.logger.error(`Failed to import URL: ${error}`);
      const errorMessage = error instanceof Error ? error.message : "未知错误";
      await this.sendTextMessage(
        senderOpenId,
        `同步失败: ${errorMessage}\n\n如需帮助，请发送 /help`,
      );
    }
  }

  /**
   * Map Feishu Open ID to platform user ID
   */
  private async getUserIdFromFeishu(
    feishuOpenId: string,
  ): Promise<string | null> {
    // Method 1: Find by preferences.feishuOpenId
    const user = await this.prisma.user.findFirst({
      where: {
        preferences: {
          path: ["feishuOpenId"],
          equals: feishuOpenId,
        },
      },
      select: { id: true },
    });

    if (user) {
      return user.id;
    }

    // Method 2: Single-user mode (dev/personal use)
    const userCount = await this.prisma.user.count();
    if (userCount === 1) {
      const singleUser = await this.prisma.user.findFirst({
        select: { id: true },
      });
      return singleUser?.id || null;
    }

    return null;
  }

  /**
   * Call AI analysis
   */
  private async callAiAnalysis(
    query: string,
    url?: string | null,
  ): Promise<string> {
    const defaultModel = await this.chatFacade.getDefaultTextModel();

    if (!defaultModel) {
      throw new Error("No CHAT AI model configured");
    }

    this.logger.log(
      `[Feishu] Using model: ${defaultModel.displayName} (${defaultModel.modelId})`,
    );

    const systemPrompt = `你是 ${APP_CONFIG.brand.name} AI 助手，一个智能知识分析助手。
你的任务是帮助用户分析内容、回答问题、提取关键信息。

回复要求：
1. 使用简洁清晰的中文回复
2. 如果是分析网页内容，请提取关键观点和总结
3. 如果是问答，请给出准确、有帮助的回答
4. 适当使用 Markdown 格式使内容更易读
5. 回复长度适中，不要太冗长`;

    let userContent = query;
    if (url) {
      userContent = `${query}\n\n链接: ${url}`;
    }

    const messages: ChatMessage[] = [{ role: "user", content: userContent }];

    const taskProfile: TaskProfile = {
      creativity: "medium",
      outputLength: "short",
    };

    const result = await this.chatFacade.chat({
      model: defaultModel.modelId,
      systemPrompt,
      messages,
      taskProfile,
    });

    return result.content;
  }

  // =========================================================================
  // Message Sending
  // =========================================================================

  /**
   * Send a text message
   */
  async sendTextMessage(
    receiveId: string,
    text: string,
    receiveIdType: "open_id" | "chat_id" = "open_id",
  ): Promise<void> {
    await this.sendMessage({
      receiveId,
      receiveIdType,
      msgType: "text",
      content: JSON.stringify({ text }),
    });
  }

  /**
   * Send an interactive card message
   */
  async sendCardMessage(
    receiveId: string,
    card: Record<string, unknown>,
    receiveIdType: "open_id" | "chat_id" = "open_id",
  ): Promise<void> {
    await this.sendMessage({
      receiveId,
      receiveIdType,
      msgType: "interactive",
      content: JSON.stringify(card),
    });
  }

  /**
   * Send a message via Feishu API
   */
  async sendMessage(options: {
    receiveId: string;
    receiveIdType: "open_id" | "user_id" | "union_id" | "email" | "chat_id";
    msgType: "text" | "post" | "interactive";
    content: string;
  }): Promise<Record<string, unknown>> {
    const headers = await this.feishuAuth.getAuthHeaders();

    const url = `${FEISHU_API_BASE}/im/v1/messages?receive_id_type=${options.receiveIdType}`;

    const body = {
      receive_id: options.receiveId,
      msg_type: options.msgType,
      content: options.content,
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post(url, body, { headers }),
      );

      if (response.data.code !== 0) {
        throw new Error(`Failed to send message: ${response.data.msg}`);
      }

      this.logger.log(
        `Message sent to ${options.receiveId} (${options.receiveIdType})`,
      );
      return response.data.data || {};
    } catch (error) {
      this.logger.error(`Failed to send message: ${error}`);
      throw error;
    }
  }

  /**
   * Get help message
   */
  private getHelpMessage(): string {
    return `${APP_CONFIG.brand.name} AI 助手使用指南

**内容同步功能**
直接发送网页链接，将自动同步到您的数据源。
您可以在 ${APP_CONFIG.brand.name} 的"数据源 → 飞书"中查看和管理同步的内容。

**AI 分析功能**
- @AI + 问题：AI 将回答你的问题
- @AI + 链接：AI 将分析链接内容
- /分析 + 内容：分析指定内容
- /总结 + 内容：总结指定内容
- /翻译 + 内容：翻译指定内容

**使用示例**
- 发送任意链接：自动同步到数据源
- @AI 什么是人工智能？
- /分析 这篇文章的主要观点是什么？`;
  }

  /**
   * Clean up old processed event IDs
   */
  private cleanupProcessedEvents(): void {
    const now = Date.now();
    for (const [eventId, timestamp] of this.processedEvents) {
      if (now - timestamp > this.EVENT_DEDUP_TTL) {
        this.processedEvents.delete(eventId);
      }
    }
  }
}
