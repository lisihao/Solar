import { Injectable, LoggerService } from "@nestjs/common";
import { RequestContext } from "../context/request-context";

/**
 * 日志级别
 */
export enum LogLevelEnum {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

/**
 * 结构化日志条目
 */
export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: string;
  requestId?: string;
  traceId?: string;
  userId?: string;
  duration?: number;
  metadata?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/**
 * 结构化日志器
 *
 * 提供 JSON 格式的结构化日志输出，便于日志聚合和分析
 *
 * 使用示例:
 * ```typescript
 * const logger = new StructuredLogger('MyService');
 * logger.log('Processing request', { userId: '123', action: 'create' });
 * logger.error('Failed to process', error, { requestId: 'abc' });
 * ```
 */
@Injectable()
export class StructuredLogger implements LoggerService {
  private context?: string;
  private isProduction: boolean;

  constructor(context?: string) {
    this.context = context;
    this.isProduction = process.env.NODE_ENV === "production";
  }

  /**
   * 设置日志上下文
   */
  setContext(context: string): void {
    this.context = context;
  }

  /**
   * 创建日志条目
   */
  private createLogEntry(
    level: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    if (this.context) {
      entry.context = this.context;
    }

    // 自动从 RequestContext 获取追踪信息
    const reqContext = RequestContext.getLogContext();
    if (reqContext.requestId) entry.requestId = reqContext.requestId;
    if (reqContext.traceId) entry.traceId = reqContext.traceId;
    if (reqContext.userId) entry.userId = reqContext.userId;

    if (metadata) {
      // 提取特殊字段（覆盖自动获取的值）
      const { requestId, userId, duration, error, ...rest } = metadata;

      if (requestId) entry.requestId = String(requestId);
      if (userId) entry.userId = String(userId);
      if (typeof duration === "number") entry.duration = duration;

      if (error instanceof Error) {
        entry.error = {
          name: error.name,
          message: error.message,
          stack: this.isProduction ? undefined : error.stack,
        };
      }

      // 其余元数据
      if (Object.keys(rest).length > 0) {
        entry.metadata = rest;
      }
    }

    return entry;
  }

  /**
   * 输出日志
   */
  private output(entry: LogEntry): void {
    const json = JSON.stringify(entry);

    switch (entry.level) {
      case LogLevelEnum.ERROR:
        console.error(json);
        break;
      case LogLevelEnum.WARN:
        console.warn(json);
        break;
      case LogLevelEnum.DEBUG:
        if (!this.isProduction) {
          // eslint-disable-next-line no-console
          console.debug(json);
        }
        break;
      default:
        // eslint-disable-next-line no-console
        console.log(json);
    }
  }

  /**
   * 日志方法
   */
  log(message: string, metadata?: Record<string, unknown>): void {
    const entry = this.createLogEntry(LogLevelEnum.INFO, message, metadata);
    this.output(entry);
  }

  debug(message: string, metadata?: Record<string, unknown>): void {
    if (!this.isProduction) {
      const entry = this.createLogEntry(LogLevelEnum.DEBUG, message, metadata);
      this.output(entry);
    }
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    const entry = this.createLogEntry(LogLevelEnum.WARN, message, metadata);
    this.output(entry);
  }

  error(
    message: string,
    error?: Error | unknown,
    metadata?: Record<string, unknown>,
  ): void {
    const errorObj = error instanceof Error ? error : undefined;
    const entry = this.createLogEntry(LogLevelEnum.ERROR, message, {
      ...metadata,
      error: errorObj,
    });
    this.output(entry);
  }

  /**
   * NestJS LoggerService 接口方法
   */
  verbose(message: string, context?: string): void {
    this.debug(message, context ? { context } : undefined);
  }

  fatal(message: string, context?: string): void {
    this.error(message, undefined, context ? { context } : undefined);
  }
}

/**
 * 创建带上下文的日志器
 */
export function createLogger(context: string): StructuredLogger {
  return new StructuredLogger(context);
}

/**
 * 请求日志中间件辅助函数
 *
 * 用于记录 HTTP 请求日志
 */
export function logRequest(
  logger: StructuredLogger,
  method: string,
  path: string,
  statusCode: number,
  duration: number,
  metadata?: Record<string, unknown>,
): void {
  const logLevel =
    statusCode >= 500
      ? LogLevelEnum.ERROR
      : statusCode >= 400
        ? LogLevelEnum.WARN
        : LogLevelEnum.INFO;

  const logMethod =
    logLevel === LogLevelEnum.ERROR
      ? "error"
      : logLevel === LogLevelEnum.WARN
        ? "warn"
        : "log";
  logger[logMethod](`${method} ${path} ${statusCode}`, {
    ...metadata,
    method,
    path,
    statusCode,
    duration,
  });
}

/**
 * 操作日志辅助函数
 *
 * 用于记录业务操作日志
 */
export function logOperation(
  logger: StructuredLogger,
  operation: string,
  success: boolean,
  metadata?: Record<string, unknown>,
): void {
  if (success) {
    logger.log(`Operation completed: ${operation}`, metadata);
  } else {
    logger.warn(`Operation failed: ${operation}`, metadata);
  }
}

/**
 * 性能日志辅助函数
 *
 * 用于记录操作耗时
 */
export function logPerformance(
  logger: StructuredLogger,
  operation: string,
  duration: number,
  threshold: number = 1000,
  metadata?: Record<string, unknown>,
): void {
  if (duration > threshold) {
    logger.warn(`Slow operation: ${operation}`, {
      ...metadata,
      duration,
      threshold,
    });
  } else {
    logger.debug(`Performance: ${operation}`, {
      ...metadata,
      duration,
    });
  }
}
