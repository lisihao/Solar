/**
 * Security Audit Logger
 *
 * ★ Security: 安全事件审计日志
 *
 * 用于记录安全相关事件：
 * - 认证事件（登录、登出、token验证）
 * - 授权事件（权限检查、访问拒绝）
 * - 安全威胁（prompt injection、异常行为）
 * - 速率限制事件
 */

import { Logger } from "@nestjs/common";

/**
 * 安全事件类型
 */
export enum SecurityEventType {
  // 认证事件
  AUTH_SUCCESS = "AUTH_SUCCESS",
  AUTH_FAILURE = "AUTH_FAILURE",
  TOKEN_INVALID = "TOKEN_INVALID",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",

  // 授权事件
  ACCESS_GRANTED = "ACCESS_GRANTED",
  ACCESS_DENIED = "ACCESS_DENIED",
  PERMISSION_CHECK = "PERMISSION_CHECK",

  // 安全威胁
  PROMPT_INJECTION_DETECTED = "PROMPT_INJECTION_DETECTED",
  SUSPICIOUS_INPUT = "SUSPICIOUS_INPUT",
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",

  // 敏感操作
  SENSITIVE_DATA_ACCESS = "SENSITIVE_DATA_ACCESS",
  CONFIG_CHANGE = "CONFIG_CHANGE",
}

/**
 * 安全事件严重级别
 */
export enum SecuritySeverity {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
  CRITICAL = "CRITICAL",
}

/**
 * 安全事件日志条目
 */
export interface SecurityLogEntry {
  timestamp: string;
  eventType: SecurityEventType;
  severity: SecuritySeverity;
  userId?: string;
  topicId?: string;
  clientIp?: string;
  userAgent?: string;
  action: string;
  outcome: "SUCCESS" | "FAILURE" | "BLOCKED";
  details?: Record<string, unknown>;
  detectedPatterns?: string[];
}

/**
 * Security Audit Logger
 *
 * 使用示例:
 * ```typescript
 * const securityLogger = new SecurityAuditLogger('WebSocketGateway');
 *
 * securityLogger.logAuthEvent({
 *   eventType: SecurityEventType.AUTH_SUCCESS,
 *   userId: 'user-123',
 *   action: 'WebSocket connection',
 *   outcome: 'SUCCESS',
 * });
 *
 * securityLogger.logPromptInjection({
 *   userId: 'user-123',
 *   topicId: 'topic-456',
 *   detectedPatterns: ['Instruction override attempt'],
 *   originalInput: 'Ignore previous instructions...',
 * });
 * ```
 */
export class SecurityAuditLogger {
  private readonly logger: Logger;
  private readonly context: string;

  constructor(context: string) {
    this.context = context;
    this.logger = new Logger(`Security:${context}`);
  }

  /**
   * 创建日志条目
   */
  private createEntry(
    eventType: SecurityEventType,
    severity: SecuritySeverity,
    action: string,
    outcome: "SUCCESS" | "FAILURE" | "BLOCKED",
    options?: {
      userId?: string;
      topicId?: string;
      clientIp?: string;
      userAgent?: string;
      details?: Record<string, unknown>;
      detectedPatterns?: string[];
    },
  ): SecurityLogEntry {
    return {
      timestamp: new Date().toISOString(),
      eventType,
      severity,
      action,
      outcome,
      ...options,
    };
  }

  /**
   * 输出日志
   */
  private output(entry: SecurityLogEntry): void {
    const message = `[${entry.eventType}] ${entry.action} - ${entry.outcome}`;
    const metadata = JSON.stringify({
      ...entry,
      context: this.context,
    });

    // CRITICAL 保留 error（系统真正被攻击/破坏）
    // HIGH / MEDIUM 降级为 warn（包括 prompt injection 拦截——研究场景误报率高，
    // 每次 ERROR 级扰乱真正的异常信号；关键信息仍通过 metadata 完整保留）
    switch (entry.severity) {
      case SecuritySeverity.CRITICAL:
        this.logger.error(`${message} | ${metadata}`);
        break;
      case SecuritySeverity.HIGH:
      case SecuritySeverity.MEDIUM:
        this.logger.warn(`${message} | ${metadata}`);
        break;
      default:
        // LOW (e.g. ACCESS_GRANTED / AUTH_SUCCESS) → debug only. These fire on
        // every successful read; the insight topic page polls mission /
        // agent-activities / team-messages / health every few seconds, so
        // logging each grant at LOG level floods prod with audit noise. The
        // full audit entry is preserved in the message; surface it at debug.
        this.logger.debug(`${message} | ${metadata}`);
    }
  }

  /**
   * 记录认证事件
   */
  logAuthEvent(options: {
    eventType:
      | SecurityEventType.AUTH_SUCCESS
      | SecurityEventType.AUTH_FAILURE
      | SecurityEventType.TOKEN_INVALID
      | SecurityEventType.TOKEN_EXPIRED;
    userId?: string;
    clientIp?: string;
    action: string;
    outcome: "SUCCESS" | "FAILURE";
    details?: Record<string, unknown>;
  }): void {
    const severity =
      options.outcome === "SUCCESS"
        ? SecuritySeverity.LOW
        : SecuritySeverity.MEDIUM;

    const entry = this.createEntry(
      options.eventType,
      severity,
      options.action,
      options.outcome,
      {
        userId: options.userId,
        clientIp: options.clientIp,
        details: options.details,
      },
    );

    this.output(entry);
  }

  /**
   * 记录权限检查事件
   */
  logAccessControl(options: {
    userId: string;
    topicId: string;
    requiredRole: string;
    hasAccess: boolean;
    action: string;
  }): void {
    const eventType = options.hasAccess
      ? SecurityEventType.ACCESS_GRANTED
      : SecurityEventType.ACCESS_DENIED;

    const severity = options.hasAccess
      ? SecuritySeverity.LOW
      : SecuritySeverity.MEDIUM;

    const entry = this.createEntry(
      eventType,
      severity,
      options.action,
      options.hasAccess ? "SUCCESS" : "BLOCKED",
      {
        userId: options.userId,
        topicId: options.topicId,
        details: { requiredRole: options.requiredRole },
      },
    );

    this.output(entry);
  }

  /**
   * 记录 Prompt Injection 检测
   */
  logPromptInjection(options: {
    userId?: string;
    topicId?: string;
    detectedPatterns: string[];
    inputPreview?: string; // 截取的输入预览（不记录完整输入）
  }): void {
    const entry = this.createEntry(
      SecurityEventType.PROMPT_INJECTION_DETECTED,
      SecuritySeverity.HIGH,
      "Prompt injection attempt detected",
      "BLOCKED",
      {
        userId: options.userId,
        topicId: options.topicId,
        detectedPatterns: options.detectedPatterns,
        details: {
          patternCount: options.detectedPatterns.length,
          inputPreview: options.inputPreview?.substring(0, 100), // 只记录前100字符
        },
      },
    );

    this.output(entry);
  }

  /**
   * 记录速率限制事件
   */
  logRateLimit(options: {
    userId?: string;
    clientIp?: string;
    endpoint: string;
    limit: number;
    current: number;
  }): void {
    const entry = this.createEntry(
      SecurityEventType.RATE_LIMIT_EXCEEDED,
      SecuritySeverity.MEDIUM,
      `Rate limit exceeded for ${options.endpoint}`,
      "BLOCKED",
      {
        userId: options.userId,
        clientIp: options.clientIp,
        details: {
          endpoint: options.endpoint,
          limit: options.limit,
          current: options.current,
        },
      },
    );

    this.output(entry);
  }

  /**
   * 记录敏感操作
   */
  logSensitiveOperation(options: {
    userId: string;
    topicId?: string;
    operation: string;
    outcome: "SUCCESS" | "FAILURE";
    details?: Record<string, unknown>;
  }): void {
    const entry = this.createEntry(
      SecurityEventType.SENSITIVE_DATA_ACCESS,
      SecuritySeverity.MEDIUM,
      options.operation,
      options.outcome,
      {
        userId: options.userId,
        topicId: options.topicId,
        details: options.details,
      },
    );

    this.output(entry);
  }
}

/**
 * 创建安全审计日志器
 */
export function createSecurityLogger(context: string): SecurityAuditLogger {
  return new SecurityAuditLogger(context);
}
