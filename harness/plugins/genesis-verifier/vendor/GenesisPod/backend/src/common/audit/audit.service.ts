/**
 * AuditService - 审计日志服务
 *
 * 记录系统中的关键操作，用于：
 * - 安全审计
 * - 合规性检查
 * - 故障排查
 * - 用户行为分析
 *
 * 设计原则：
 * - 异步写入，不阻塞业务流程
 * - 结构化日志格式
 * - 支持多种存储后端（当前使用 Logger）
 */

import { Injectable, Logger, SetMetadata } from "@nestjs/common";

// ============================================================================
// Types & Constants
// ============================================================================

/**
 * 审计操作类型
 */
export enum AuditAction {
  // 用户操作
  USER_LOGIN = "USER_LOGIN",
  USER_LOGOUT = "USER_LOGOUT",
  USER_REGISTER = "USER_REGISTER",

  // 话题操作
  TOPIC_CREATE = "TOPIC_CREATE",
  TOPIC_DELETE = "TOPIC_DELETE",
  TOPIC_UPDATE = "TOPIC_UPDATE",

  // 成员操作
  MEMBER_ADD = "MEMBER_ADD",
  MEMBER_REMOVE = "MEMBER_REMOVE",
  MEMBER_UPDATE = "MEMBER_UPDATE",

  // 消息操作
  MESSAGE_SEND = "MESSAGE_SEND",
  MESSAGE_DELETE = "MESSAGE_DELETE",

  // AI 操作
  AI_RESPONSE_GENERATE = "AI_RESPONSE_GENERATE",
  AI_RESPONSE_ERROR = "AI_RESPONSE_ERROR",

  // 任务操作
  MISSION_CREATE = "MISSION_CREATE",
  MISSION_COMPLETE = "MISSION_COMPLETE",
  MISSION_CANCEL = "MISSION_CANCEL",

  // 投票操作
  VOTE_CREATE = "VOTE_CREATE",
  VOTE_CAST = "VOTE_CAST",
  VOTE_CLOSE = "VOTE_CLOSE",

  // 辩论操作
  DEBATE_START = "DEBATE_START",
  DEBATE_END = "DEBATE_END",

  // 系统操作
  SYSTEM_CONFIG_CHANGE = "SYSTEM_CONFIG_CHANGE",
  SYSTEM_ERROR = "SYSTEM_ERROR",

  // 自定义
  CUSTOM = "CUSTOM",
}

/**
 * 审计日志条目
 */
export interface AuditEntry {
  /** 操作类型 */
  action: AuditAction;
  /** 操作者 ID（可选，系统操作可能没有） */
  userId?: string;
  /** 操作者 IP */
  ipAddress?: string;
  /** 资源类型 */
  resourceType?: string;
  /** 资源 ID */
  resourceId?: string;
  /** 操作详情 */
  details?: Record<string, unknown>;
  /** 操作结果 */
  result?: "SUCCESS" | "FAILURE" | "PARTIAL";
  /** 错误信息（失败时） */
  errorMessage?: string;
  /** 时间戳（可选，默认当前时间） */
  timestamp?: Date;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 审计装饰器元数据 Key
 */
export const AUDIT_KEY = "audit_action";

/**
 * 存储的审计日志（用于查询）
 */
interface StoredAuditLog extends AuditEntry {
  id: string;
  timestamp: Date;
}

// ============================================================================
// Decorator
// ============================================================================

/**
 * @Audit 装饰器
 *
 * 自动记录方法调用的审计日志
 *
 * @example
 * ```typescript
 * @Audit(AuditAction.MISSION_CREATE)
 * async createMission(dto: CreateMissionDto) {}
 *
 * @Audit(AuditAction.VOTE_CAST, { logArgs: true })
 * async castVote(proposalId: string, vote: string) {}
 * ```
 */
export function Audit(
  action: AuditAction,
  options?: { logArgs?: boolean; logResult?: boolean },
) {
  return SetMetadata(AUDIT_KEY, { action, ...options });
}

// ============================================================================
// Service Implementation
// ============================================================================

@Injectable()
export class AuditService {
  private readonly logger = new Logger("Audit");

  /**
   * 内存存储审计日志（生产环境应使用数据库）
   * 仅保留最近 1000 条
   */
  private readonly auditLogs: StoredAuditLog[] = [];
  private readonly maxLogs = 1000;

  /**
   * 记录审计日志
   */
  async log(entry: AuditEntry): Promise<void> {
    const timestamp = entry.timestamp || new Date();
    const logEntry: StoredAuditLog = {
      id: this.generateId(),
      ...entry,
      timestamp,
    };

    // 存储日志
    this.auditLogs.push(logEntry);

    // 保持日志数量在限制内
    if (this.auditLogs.length > this.maxLogs) {
      this.auditLogs.shift();
    }

    // 输出到 Logger
    const logMessage = this.formatLogMessage(logEntry);
    const logLevel = entry.result === "FAILURE" ? "warn" : "log";

    this.logger[logLevel](logMessage);
  }

  /**
   * 记录成功操作
   */
  async logSuccess(
    action: AuditAction,
    options: Omit<AuditEntry, "action" | "result">,
  ): Promise<void> {
    await this.log({
      action,
      result: "SUCCESS",
      ...options,
    });
  }

  /**
   * 记录失败操作
   */
  async logFailure(
    action: AuditAction,
    errorMessage: string,
    options: Omit<AuditEntry, "action" | "result" | "errorMessage">,
  ): Promise<void> {
    await this.log({
      action,
      result: "FAILURE",
      errorMessage,
      ...options,
    });
  }

  // =========================================================================
  // Convenience Methods for AI Teams
  // =========================================================================

  /**
   * 记录话题创建
   */
  async logTopicCreate(
    userId: string,
    topicId: string,
    title: string,
  ): Promise<void> {
    await this.logSuccess(AuditAction.TOPIC_CREATE, {
      userId,
      resourceType: "Topic",
      resourceId: topicId,
      details: { title },
    });
  }

  /**
   * 记录 AI 成员添加
   */
  async logMemberAdd(
    userId: string,
    topicId: string,
    memberId: string,
    memberName: string,
  ): Promise<void> {
    await this.logSuccess(AuditAction.MEMBER_ADD, {
      userId,
      resourceType: "TopicAIMember",
      resourceId: memberId,
      details: { topicId, memberName },
    });
  }

  /**
   * 记录消息发送
   */
  async logMessageSend(
    userId: string,
    topicId: string,
    messageId: string,
    isAI: boolean,
  ): Promise<void> {
    await this.logSuccess(AuditAction.MESSAGE_SEND, {
      userId,
      resourceType: "TopicMessage",
      resourceId: messageId,
      details: { topicId, isAI },
    });
  }

  /**
   * 记录 AI 响应生成
   */
  async logAIResponseGenerate(
    topicId: string,
    memberId: string,
    messageId: string,
    model: string,
    tokensUsed: number,
  ): Promise<void> {
    await this.logSuccess(AuditAction.AI_RESPONSE_GENERATE, {
      resourceType: "AIResponse",
      resourceId: messageId,
      details: { topicId, memberId, model, tokensUsed },
    });
  }

  /**
   * 记录 AI 响应错误
   */
  async logAIResponseError(
    topicId: string,
    memberId: string,
    error: string,
    model: string,
  ): Promise<void> {
    await this.logFailure(AuditAction.AI_RESPONSE_ERROR, error, {
      resourceType: "AIResponse",
      details: { topicId, memberId, model },
    });
  }

  /**
   * 记录投票创建
   */
  async logVoteCreate(
    initiatorId: string,
    topicId: string,
    proposalId: string,
    title: string,
  ): Promise<void> {
    await this.logSuccess(AuditAction.VOTE_CREATE, {
      userId: initiatorId,
      resourceType: "VoteProposal",
      resourceId: proposalId,
      details: { topicId, title },
    });
  }

  /**
   * 记录投票
   */
  async logVoteCast(
    voterId: string,
    proposalId: string,
    vote: string,
  ): Promise<void> {
    await this.logSuccess(AuditAction.VOTE_CAST, {
      userId: voterId,
      resourceType: "VoteRecord",
      resourceId: proposalId,
      details: { vote },
    });
  }

  /**
   * 记录任务创建
   */
  async logMissionCreate(
    userId: string,
    topicId: string,
    missionId: string,
    objective: string,
  ): Promise<void> {
    await this.logSuccess(AuditAction.MISSION_CREATE, {
      userId,
      resourceType: "Mission",
      resourceId: missionId,
      details: { topicId, objective },
    });
  }

  /**
   * 记录任务完成
   */
  async logMissionComplete(missionId: string, duration: number): Promise<void> {
    await this.logSuccess(AuditAction.MISSION_COMPLETE, {
      resourceType: "Mission",
      resourceId: missionId,
      details: { duration },
    });
  }

  // =========================================================================
  // Query Methods
  // =========================================================================

  /**
   * 查询审计日志
   */
  query(options: {
    action?: AuditAction;
    userId?: string;
    resourceType?: string;
    resourceId?: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  }): StoredAuditLog[] {
    let result = [...this.auditLogs];

    if (options.action) {
      result = result.filter((log) => log.action === options.action);
    }

    if (options.userId) {
      result = result.filter((log) => log.userId === options.userId);
    }

    if (options.resourceType) {
      result = result.filter(
        (log) => log.resourceType === options.resourceType,
      );
    }

    if (options.resourceId) {
      result = result.filter((log) => log.resourceId === options.resourceId);
    }

    if (options.startTime) {
      result = result.filter((log) => log.timestamp >= options.startTime!);
    }

    if (options.endTime) {
      result = result.filter((log) => log.timestamp <= options.endTime!);
    }

    // 按时间倒序
    result.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // 限制数量
    if (options.limit) {
      result = result.slice(0, options.limit);
    }

    return result;
  }

  /**
   * 获取最近的审计日志
   */
  getRecent(limit = 50): StoredAuditLog[] {
    return [...this.auditLogs]
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * 获取用户的操作历史
   */
  getUserHistory(userId: string, limit = 50): StoredAuditLog[] {
    return this.query({ userId, limit });
  }

  /**
   * 获取资源的操作历史
   */
  getResourceHistory(
    resourceType: string,
    resourceId: string,
    limit = 50,
  ): StoredAuditLog[] {
    return this.query({ resourceType, resourceId, limit });
  }

  /**
   * 清除所有日志（仅用于测试）
   */
  clear(): void {
    this.auditLogs.length = 0;
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * 格式化日志消息
   */
  private formatLogMessage(entry: StoredAuditLog): string {
    const parts: string[] = [`[${entry.action}]`, entry.result || "UNKNOWN"];

    if (entry.userId) {
      parts.push(`user=${entry.userId}`);
    }

    if (entry.resourceType && entry.resourceId) {
      parts.push(`${entry.resourceType}=${entry.resourceId}`);
    }

    if (entry.errorMessage) {
      parts.push(`error="${entry.errorMessage}"`);
    }

    if (entry.details && Object.keys(entry.details).length > 0) {
      parts.push(`details=${JSON.stringify(entry.details)}`);
    }

    return parts.join(" ");
  }
}
