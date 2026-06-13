/**
 * Agent Communication Tool
 * Agent 通信工具 - Agent 间消息传递
 *
 * 功能:
 * - send: 发送消息给其他 Agent
 * - receive: 接收消息
 * - broadcast: 广播消息
 * - reply: 回复消息
 * - getStatus: 获取消息状态
 *
 * 特点:
 * - 异步消息队列
 * - 消息优先级
 * - 消息追踪
 * - 确认机制
 */

import { Injectable, Logger, OnModuleInit, Optional } from "@nestjs/common";
import { BaseTool } from "../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../abstractions/tool.interface";

import { CacheService } from "@/common/cache/cache.service";

import { randomUUID } from "crypto";

const CACHE_PREFIX_MSG = "agent-comm:msg:";
const CACHE_PREFIX_INBOX = "agent-comm:inbox:";
const CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const KNOWN_AGENT_IDS = [
  "docs",
  "designer",
  "coder",
  "researcher",
  "writer",
  "critic",
  "coordinator",
];

// ============================================================================
// Types
// ============================================================================

/**
 * 消息类型
 */
export enum MessageType {
  REQUEST = "REQUEST",
  RESPONSE = "RESPONSE",
  NOTIFICATION = "NOTIFICATION",
  BROADCAST = "BROADCAST",
}

/**
 * 消息优先级
 */
export enum MessagePriority {
  LOW = "LOW",
  NORMAL = "NORMAL",
  HIGH = "HIGH",
  URGENT = "URGENT",
}

/**
 * 消息状态
 */
export enum MessageStatus {
  PENDING = "PENDING",
  SENT = "SENT",
  DELIVERED = "DELIVERED",
  READ = "READ",
  REPLIED = "REPLIED",
  FAILED = "FAILED",
}

/**
 * 消息
 */
export interface Message {
  /**
   * 消息 ID
   */
  id: string;

  /**
   * 发送者 Agent
   */
  from: string;

  /**
   * 接收者 Agent（BROADCAST 时为空）
   */
  to?: string;

  /**
   * 消息类型
   */
  type: MessageType;

  /**
   * 消息优先级
   */
  priority: MessagePriority;

  /**
   * 消息主题
   */
  subject: string;

  /**
   * 消息内容
   */
  content: string;

  /**
   * 消息数据（结构化数据）
   */
  data?: Record<string, unknown>;

  /**
   * 相关消息 ID（用于回复）
   */
  replyTo?: string;

  /**
   * 消息状态
   */
  status: MessageStatus;

  /**
   * 创建时间
   */
  createdAt: Date;

  /**
   * 发送时间
   */
  sentAt?: Date;

  /**
   * 送达时间
   */
  deliveredAt?: Date;

  /**
   * 读取时间
   */
  readAt?: Date;

  /**
   * 回复时间
   */
  repliedAt?: Date;

  /**
   * 元数据
   */
  metadata?: Record<string, unknown>;
}

/**
 * 操作类型
 */
export enum CommunicationOperation {
  SEND = "send",
  RECEIVE = "receive",
  BROADCAST = "broadcast",
  REPLY = "reply",
  GET_STATUS = "get_status",
  LIST_INBOX = "list_inbox",
  MARK_READ = "mark_read",
}

/**
 * Agent 通信工具输入
 */
export interface AgentCommunicationInput {
  /**
   * 操作类型
   */
  operation: CommunicationOperation;

  /**
   * 当前 Agent（发送者）
   */
  fromAgent: string;

  /**
   * 目标 Agent（接收者，用于 send, reply）
   */
  toAgent?: string;

  /**
   * 消息内容（用于 send, broadcast, reply）
   */
  message?: {
    subject: string;
    content: string;
    type?: MessageType;
    priority?: MessagePriority;
    data?: Record<string, unknown>;
  };

  /**
   * 消息 ID（用于 reply, get_status, mark_read）
   */
  messageId?: string;

  /**
   * 过滤器（用于 receive, list_inbox）
   */
  filter?: {
    type?: MessageType;
    priority?: MessagePriority;
    status?: MessageStatus;
    unreadOnly?: boolean;
    limit?: number;
  };
}

/**
 * Agent 通信工具输出
 */
export interface AgentCommunicationOutput {
  /**
   * 操作是否成功
   */
  success: boolean;

  /**
   * 操作类型
   */
  operation: CommunicationOperation;

  /**
   * 单个消息（用于 send, reply, get_status, mark_read）
   */
  message?: Message;

  /**
   * 消息列表（用于 receive, list_inbox, broadcast）
   */
  messages?: Message[];

  /**
   * 错误信息
   */
  error?: string;

  /**
   * 元数据
   */
  metadata?: {
    totalCount?: number;
    unreadCount?: number;
    deliveryTime?: number;
  };
}

// ============================================================================
// Tool Implementation
// ============================================================================

/**
 * Agent 通信工具
 *
 * 用于 Agent 之间的消息传递，支持：
 * - 点对点消息
 * - 广播消息
 * - 消息回复
 * - 消息追踪
 *
 * @example
 * ```typescript
 * // 发送消息
 * {
 *   operation: "send",
 *   fromAgent: "DOCS",
 *   toAgent: "DESIGNER",
 *   message: {
 *     subject: "需要设计封面图",
 *     content: "文档已完成，请为文档设计一个封面图",
 *     priority: "HIGH",
 *     data: { documentId: "doc-123" }
 *   }
 * }
 *
 * // 接收消息
 * {
 *   operation: "receive",
 *   fromAgent: "DESIGNER",
 *   filter: { unreadOnly: true, limit: 10 }
 * }
 *
 * // 回复消息
 * {
 *   operation: "reply",
 *   fromAgent: "DESIGNER",
 *   toAgent: "DOCS",
 *   messageId: "msg-123",
 *   message: {
 *     subject: "Re: 需要设计封面图",
 *     content: "封面图已完成",
 *     data: { imageUrl: "https://..." }
 *   }
 * }
 * ```
 */
@Injectable()
export class AgentCommunicationTool
  extends BaseTool<AgentCommunicationInput, AgentCommunicationOutput>
  implements OnModuleInit
{
  private readonly logger = new Logger(AgentCommunicationTool.name);

  readonly id = "agent-communication";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "collaboration";
  readonly tags = ["collaboration", "agent", "messaging", "communication"];
  readonly name = "Agent 通信";
  readonly description =
    "Agent 之间的消息传递工具。支持发送消息、接收消息、广播、回复、状态追踪等功能，适用于 Agent 协作场景。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        description: "操作类型",
        enum: Object.values(CommunicationOperation),
      },
      fromAgent: {
        type: "string",
        description: "发送者 Agent",
      },
      toAgent: {
        type: "string",
        description: "接收者 Agent（用于 send, reply 操作）",
      },
      message: {
        type: "object",
        description: "消息内容（用于 send, broadcast, reply 操作）",
        properties: {
          subject: {
            type: "string",
            description: "消息主题",
          },
          content: {
            type: "string",
            description: "消息内容",
          },
          type: {
            type: "string",
            description: "消息类型",
            enum: Object.values(MessageType),
            default: MessageType.REQUEST,
          },
          priority: {
            type: "string",
            description: "消息优先级",
            enum: Object.values(MessagePriority),
            default: MessagePriority.NORMAL,
          },
          data: {
            type: "object",
            description: "结构化数据",
          },
        },
        required: ["subject", "content"],
      },
      messageId: {
        type: "string",
        description: "消息 ID（用于 reply, get_status, mark_read 操作）",
      },
      filter: {
        type: "object",
        description: "过滤选项（用于 receive, list_inbox 操作）",
        properties: {
          type: {
            type: "string",
            description: "按消息类型过滤",
            enum: Object.values(MessageType),
          },
          priority: {
            type: "string",
            description: "按优先级过滤",
            enum: Object.values(MessagePriority),
          },
          status: {
            type: "string",
            description: "按状态过滤",
            enum: Object.values(MessageStatus),
          },
          unreadOnly: {
            type: "boolean",
            description: "仅显示未读消息",
            default: false,
          },
          limit: {
            type: "number",
            description: "返回结果数量限制",
            default: 20,
          },
        },
      },
    },
    required: ["operation", "fromAgent"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: {
        type: "boolean",
        description: "操作是否成功",
      },
      operation: {
        type: "string",
        description: "执行的操作类型",
      },
      message: {
        type: "object",
        description: "单个消息",
      },
      messages: {
        type: "array",
        description: "消息列表",
        items: {
          type: "object",
        },
      },
      error: {
        type: "string",
        description: "错误信息",
      },
    },
  };

  // In-memory storage (L1 cache)
  private messages: Map<string, Message> = new Map();
  private inboxes: Map<string, string[]> = new Map(); // Agent -> messageIds

  constructor(@Optional() private readonly cacheService?: CacheService) {
    super();
    // defaultTimeout set in class property // 5 秒超时

    // 初始化收件箱
  }

  async onModuleInit(): Promise<void> {
    await this.loadFromRedis();
  }

  // ==================== Redis 持久化 ====================

  private async loadFromRedis(): Promise<void> {
    if (!this.cacheService) return;
    try {
      // 1. Restore inboxes first (source of truth for which messages exist)
      //    合并策略：将 Redis 中的 messageId 列表与启动窗口期内已写入内存的合并，
      //    防止 onModuleInit 并发运行期间发送的消息因覆盖而丢失。
      for (const agentId of KNOWN_AGENT_IDS) {
        const inbox = await this.cacheService.get<string[]>(
          `${CACHE_PREFIX_INBOX}${agentId}`,
        );
        if (inbox) {
          const existing = this.inboxes.get(agentId) || [];
          // 去重合并：Redis 历史 + 启动窗口期新增
          const merged = Array.from(new Set([...inbox, ...existing]));
          this.inboxes.set(agentId, merged);
          // 将合并结果写回 Redis，确保下次重启时不再丢失启动窗口期消息
          if (merged.length > inbox.length) {
            this.saveInboxToCache(agentId);
          }
        }
      }

      // 2. Collect all unique messageIds from inboxes, then load messages
      //    No separate index needed — avoids read-modify-write race condition.
      const allMessageIds = new Set<string>();
      for (const ids of this.inboxes.values()) {
        ids.forEach((id) => allMessageIds.add(id));
      }

      let loaded = 0;
      for (const messageId of allMessageIds) {
        const msg = await this.cacheService.get<Message>(
          `${CACHE_PREFIX_MSG}${messageId}`,
        );
        if (msg) {
          // Restore Date objects (Redis serializes to strings)
          msg.createdAt = new Date(msg.createdAt);
          if (msg.sentAt) msg.sentAt = new Date(msg.sentAt);
          if (msg.deliveredAt) msg.deliveredAt = new Date(msg.deliveredAt);
          if (msg.readAt) msg.readAt = new Date(msg.readAt);
          if (msg.repliedAt) msg.repliedAt = new Date(msg.repliedAt);
          this.messages.set(messageId, msg);
          loaded++;
        }
      }

      if (loaded > 0)
        this.logger.log(`[AgentComm] Restored ${loaded} messages from Redis`);
    } catch (error) {
      this.logger.warn(`[AgentComm] Failed to load from Redis: ${error}`);
    }
  }

  private saveMessageToCache(message: Message): void {
    if (!this.cacheService) return;
    this.cacheService
      .set(`${CACHE_PREFIX_MSG}${message.id}`, message, CACHE_TTL_SECONDS)
      .catch((err) =>
        this.logger.warn(
          `[AgentComm] Redis save failed for ${message.id}: ${err}`,
        ),
      );
  }

  private saveInboxToCache(agentId: string): void {
    if (!this.cacheService) return;
    const inbox = this.inboxes.get(agentId) || [];
    this.cacheService
      .set(`${CACHE_PREFIX_INBOX}${agentId}`, inbox, CACHE_TTL_SECONDS)
      .catch((err) =>
        this.logger.warn(
          `[AgentComm] Redis inbox save failed for ${agentId}: ${err}`,
        ),
      );
  }

  /**
   * 验证输入
   */
  validateInput(input: AgentCommunicationInput) {
    // 验证操作类型
    if (!Object.values(CommunicationOperation).includes(input.operation)) {
      return false;
    }

    // Skip specific agent ID validation in engine layer to avoid harness dependency
    if (!input.fromAgent) {
      return false;
    }

    // 验证各操作所需参数
    switch (input.operation) {
      case CommunicationOperation.SEND:
        return (
          !!input.toAgent &&
          !!input.message?.subject &&
          !!input.message?.content
        );

      case CommunicationOperation.BROADCAST:
        return !!input.message?.subject && !!input.message?.content;

      case CommunicationOperation.REPLY:
        return (
          !!input.toAgent &&
          !!input.messageId &&
          !!input.message?.subject &&
          !!input.message?.content
        );

      case CommunicationOperation.GET_STATUS:
      case CommunicationOperation.MARK_READ:
        return !!input.messageId;

      case CommunicationOperation.RECEIVE:
      case CommunicationOperation.LIST_INBOX:
        return true;

      default:
        return false;
    }
  }

  /**
   * 执行 Agent 通信操作
   */
  protected async doExecute(
    input: AgentCommunicationInput,
    context: ToolContext,
  ): Promise<AgentCommunicationOutput> {
    try {
      switch (input.operation) {
        case CommunicationOperation.SEND:
          return await this.sendMessage(
            input.fromAgent,
            input.toAgent!,
            input.message,
            context,
          );

        case CommunicationOperation.RECEIVE:
          return await this.receiveMessages(input.fromAgent, input.filter);

        case CommunicationOperation.BROADCAST:
          return await this.broadcastMessage(
            input.fromAgent,
            input.message,
            context,
          );

        case CommunicationOperation.REPLY:
          return await this.replyMessage(
            input.fromAgent,
            input.toAgent!,
            input.messageId!,
            input.message,
            context,
          );

        case CommunicationOperation.GET_STATUS:
          return await this.getMessageStatus(input.messageId!);

        case CommunicationOperation.LIST_INBOX:
          return await this.listInbox(input.fromAgent, input.filter);

        case CommunicationOperation.MARK_READ:
          return await this.markAsRead(input.messageId!);

        default:
          return {
            success: false,
            operation: input.operation,
            error: `Unknown operation: ${input.operation}`,
          };
      }
    } catch (error) {
      this.logger.error(
        `Agent communication operation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );

      return {
        success: false,
        operation: input.operation,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * 发送消息
   */
  private async sendMessage(
    from: string,
    to: string,
    messageData: AgentCommunicationInput["message"],
    _context: ToolContext,
  ): Promise<AgentCommunicationOutput> {
    const now = new Date();
    const messageId = randomUUID();

    const message: Message = {
      id: messageId,
      from,
      to,
      type: messageData!.type || MessageType.REQUEST,
      priority: messageData!.priority || MessagePriority.NORMAL,
      subject: messageData!.subject,
      content: messageData!.content,
      data: messageData!.data,
      status: MessageStatus.SENT,
      createdAt: now,
      sentAt: now,
      deliveredAt: now, // 立即送达（简化版）
    };

    this.messages.set(messageId, message);

    // 添加到收件箱
    if (!this.inboxes.has(to)) this.inboxes.set(to, []);
    const inbox = this.inboxes.get(to);
    if (inbox) {
      inbox.push(messageId);
      // 按优先级排序（消息体不存在时 priority 降级为 NORMAL）
      inbox.sort((a, b) => {
        const msgA = this.messages.get(a);
        const msgB = this.messages.get(b);
        return (
          this.getPriorityValue(msgB?.priority ?? MessagePriority.NORMAL) -
          this.getPriorityValue(msgA?.priority ?? MessagePriority.NORMAL)
        );
      });
    }

    // 更新状态为已送达
    message.status = MessageStatus.DELIVERED;

    // 持久化到 Redis（fire-and-forget）
    this.saveMessageToCache(message);
    this.saveInboxToCache(to);

    this.logger.log(
      `Message sent from ${from} to ${to}: ${message.subject} [${messageId}]`,
    );

    return {
      success: true,
      operation: CommunicationOperation.SEND,
      message,
    };
  }

  /**
   * 接收消息
   */
  private async receiveMessages(
    agent: string,
    filter?: AgentCommunicationInput["filter"],
  ): Promise<AgentCommunicationOutput> {
    const inbox = this.inboxes.get(agent) || [];
    let messages = inbox
      .map((id) => this.messages.get(id)!)
      .filter((msg) => msg !== undefined);

    // 应用过滤器
    if (filter?.type) {
      messages = messages.filter((msg) => msg.type === filter.type);
    }

    if (filter?.priority) {
      messages = messages.filter((msg) => msg.priority === filter.priority);
    }

    if (filter?.status) {
      messages = messages.filter((msg) => msg.status === filter.status);
    }

    if (filter?.unreadOnly) {
      messages = messages.filter(
        (msg) =>
          msg.status !== MessageStatus.READ &&
          msg.status !== MessageStatus.REPLIED,
      );
    }

    // 限制数量
    const limit = filter?.limit || 20;
    messages = messages.slice(0, limit);

    const unreadCount = inbox.filter((id) => {
      const msg = this.messages.get(id);
      return (
        msg &&
        msg.status !== MessageStatus.READ &&
        msg.status !== MessageStatus.REPLIED
      );
    }).length;

    return {
      success: true,
      operation: CommunicationOperation.RECEIVE,
      messages,
      metadata: {
        totalCount: inbox.length,
        unreadCount,
      },
    };
  }

  /**
   * 广播消息
   */
  private async broadcastMessage(
    from: string,
    messageData: AgentCommunicationInput["message"],
    context: ToolContext,
  ): Promise<AgentCommunicationOutput> {
    const messages: Message[] = [];

    // 发送给所有其他 Agent
    for (const agentId of KNOWN_AGENT_IDS) {
      if (agentId !== from) {
        const result = await this.sendMessage(
          from,
          agentId,
          {
            ...messageData!,
            type: MessageType.BROADCAST,
          },
          context,
        );

        if (result.message) {
          messages.push(result.message);
        }
      }
    }

    this.logger.log(
      `Broadcast message from ${from}: ${messageData!.subject} (${messages.length} recipients)`,
    );

    return {
      success: true,
      operation: CommunicationOperation.BROADCAST,
      messages,
      metadata: {
        totalCount: messages.length,
      },
    };
  }

  /**
   * 回复消息
   */
  private async replyMessage(
    from: string,
    to: string,
    replyToId: string,
    messageData: AgentCommunicationInput["message"],
    context: ToolContext,
  ): Promise<AgentCommunicationOutput> {
    const originalMessage = this.messages.get(replyToId);

    if (!originalMessage) {
      return {
        success: false,
        operation: CommunicationOperation.REPLY,
        error: `Original message not found: ${replyToId}`,
      };
    }

    // 发送回复
    const result = await this.sendMessage(
      from,
      to,
      {
        ...messageData!,
        type: MessageType.RESPONSE,
      },
      context,
    );

    if (result.success && result.message) {
      result.message.replyTo = replyToId;

      // 持久化 reply 消息（含 replyTo 字段）
      this.saveMessageToCache(result.message);

      // 更新原消息状态
      originalMessage.status = MessageStatus.REPLIED;
      originalMessage.repliedAt = new Date();
      this.saveMessageToCache(originalMessage);

      this.logger.log(`Reply sent to message [${replyToId}]`);
    }

    return result;
  }

  /**
   * 获取消息状态
   */
  private async getMessageStatus(
    messageId: string,
  ): Promise<AgentCommunicationOutput> {
    const message = this.messages.get(messageId);

    if (!message) {
      return {
        success: false,
        operation: CommunicationOperation.GET_STATUS,
        error: `Message not found: ${messageId}`,
      };
    }

    return {
      success: true,
      operation: CommunicationOperation.GET_STATUS,
      message,
    };
  }

  /**
   * 列出收件箱
   */
  private async listInbox(
    agent: string,
    filter?: AgentCommunicationInput["filter"],
  ): Promise<AgentCommunicationOutput> {
    return this.receiveMessages(agent, filter);
  }

  /**
   * 标记为已读
   */
  private async markAsRead(
    messageId: string,
  ): Promise<AgentCommunicationOutput> {
    const message = this.messages.get(messageId);

    if (!message) {
      return {
        success: false,
        operation: CommunicationOperation.MARK_READ,
        error: `Message not found: ${messageId}`,
      };
    }

    if (message.status === MessageStatus.DELIVERED) {
      message.status = MessageStatus.READ;
      message.readAt = new Date();
      this.saveMessageToCache(message);
    }

    return {
      success: true,
      operation: CommunicationOperation.MARK_READ,
      message,
    };
  }

  /**
   * 获取优先级数值（用于排序）
   */
  private getPriorityValue(priority: MessagePriority): number {
    const priorityMap = {
      [MessagePriority.LOW]: 1,
      [MessagePriority.NORMAL]: 2,
      [MessagePriority.HIGH]: 3,
      [MessagePriority.URGENT]: 4,
    };
    return priorityMap[priority] || 2;
  }
}
