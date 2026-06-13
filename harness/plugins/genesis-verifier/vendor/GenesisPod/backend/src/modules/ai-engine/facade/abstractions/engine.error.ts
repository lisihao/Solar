/**
 * AI Engine - Base Error
 * 基础错误类
 */

import { JsonObject, JsonValue } from "./common.types";
import { CommonErrorCode, getErrorCodeMeta } from "./error-codes.constants";

/**
 * 引擎错误基类
 */
export class EngineError extends Error {
  /**
   * 错误码
   */
  readonly code: string;

  /**
   * 错误详情
   */
  readonly details?: JsonObject;

  /**
   * 原始错误
   */
  readonly cause?: Error;

  /**
   * 是否可重试
   */
  readonly retryable: boolean;

  /**
   * HTTP 状态码
   */
  readonly httpStatus: number;

  /**
   * 用户友好消息
   */
  readonly userMessage: string;

  /**
   * 错误时间戳
   */
  readonly timestamp: Date;

  constructor(
    message: string,
    code: string = CommonErrorCode.UNKNOWN,
    options?: {
      details?: JsonObject;
      cause?: Error;
      retryable?: boolean;
      httpStatus?: number;
      userMessage?: string;
    },
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = options?.details;
    this.cause = options?.cause;
    this.timestamp = new Date();

    // 从错误码元数据获取默认值
    const meta = getErrorCodeMeta(code);
    this.retryable = options?.retryable ?? meta?.retryable ?? false;
    this.httpStatus = options?.httpStatus ?? meta?.httpStatus ?? 500;
    this.userMessage = options?.userMessage ?? meta?.userMessage ?? message;

    // 保持原型链
    Object.setPrototypeOf(this, new.target.prototype);

    // 捕获堆栈
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * 从普通 Error 创建 EngineError
   */
  static fromError(
    error: unknown,
    code: string = CommonErrorCode.UNKNOWN,
    details?: JsonObject,
  ): EngineError {
    if (error instanceof EngineError) {
      return error;
    }

    if (error instanceof Error) {
      return new EngineError(error.message, code, {
        cause: error,
        details,
      });
    }

    return new EngineError(
      typeof error === "string" ? error : "Unknown error",
      code,
      { details },
    );
  }

  /**
   * 转换为 JSON
   */
  toJSON(): Record<string, JsonValue> {
    const result: Record<string, JsonValue> = {
      name: this.name,
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      retryable: this.retryable,
      httpStatus: this.httpStatus,
      timestamp: this.timestamp.toISOString(),
    };
    if (this.details) {
      result.details = this.details as JsonValue;
    }
    if (this.stack) {
      result.stack = this.stack;
    }
    if (this.cause) {
      result.cause = {
        name: this.cause.name,
        message: this.cause.message,
      };
    }
    return result;
  }

  /**
   * 转换为用户友好的响应
   */
  toResponse(): {
    error: {
      code: string;
      message: string;
      details?: JsonObject;
    };
  } {
    return {
      error: {
        code: this.code,
        message: this.userMessage,
        details: this.details,
      },
    };
  }

  /**
   * 获取完整的错误信息（用于日志）
   */
  getFullMessage(): string {
    let msg = `[${this.code}] ${this.message}`;
    if (this.cause) {
      msg += ` | Caused by: ${this.cause.message}`;
    }
    if (this.details) {
      msg += ` | Details: ${JSON.stringify(this.details)}`;
    }
    return msg;
  }
}

/**
 * 验证错误
 */
export class ValidationError extends EngineError {
  /**
   * 验证错误列表
   */
  readonly validationErrors: ValidationErrorItem[];

  constructor(errors: ValidationErrorItem[], message?: string) {
    super(
      message ||
        `Validation failed: ${errors.map((e) => e.message).join(", ")}`,
      CommonErrorCode.VALIDATION_FAILED,
      {
        details: {
          errors: errors.map((e) => ({
            path: e.path,
            message: e.message,
            type: e.type,
          })),
        },
        retryable: false,
        httpStatus: 400,
      },
    );
    this.validationErrors = errors;
  }
}

/**
 * 验证错误项
 */
export interface ValidationErrorItem {
  /**
   * 字段路径
   */
  path: string;

  /**
   * 错误消息
   */
  message: string;

  /**
   * 错误类型
   */
  type: string;

  /**
   * 实际值
   */
  value?: unknown;
}

/**
 * 超时错误
 */
export class TimeoutError extends EngineError {
  /**
   * 超时时间（毫秒）
   */
  readonly timeout: number;

  constructor(timeout: number, message?: string) {
    super(
      message || `Operation timed out after ${timeout}ms`,
      CommonErrorCode.TIMEOUT,
      {
        details: { timeout },
        retryable: true,
      },
    );
    this.timeout = timeout;
  }
}

/**
 * 取消错误
 */
export class CancelledError extends EngineError {
  constructor(message?: string) {
    super(message || "Operation was cancelled", CommonErrorCode.CANCELLED, {
      retryable: false,
      httpStatus: 499, // Client Closed Request
    });
  }
}

/**
 * 未找到错误
 */
export class NotFoundError extends EngineError {
  /**
   * 资源类型
   */
  readonly resourceType: string;

  /**
   * 资源 ID
   */
  readonly resourceId: string;

  constructor(resourceType: string, resourceId: string, message?: string) {
    super(
      message || `${resourceType} '${resourceId}' not found`,
      CommonErrorCode.NOT_FOUND,
      {
        details: { resourceType, resourceId },
        retryable: false,
        httpStatus: 404,
      },
    );
    this.resourceType = resourceType;
    this.resourceId = resourceId;
  }
}

/**
 * 重试耗尽错误
 */
export class RetryExhaustedError extends EngineError {
  /**
   * 尝试次数
   */
  readonly attempts: number;

  /**
   * 最后一个错误
   */
  readonly lastError?: Error;

  constructor(attempts: number, lastError?: Error, message?: string) {
    super(
      message || `Retry exhausted after ${attempts} attempts`,
      CommonErrorCode.RETRY_EXHAUSTED,
      {
        details: { attempts },
        cause: lastError,
        retryable: false,
      },
    );
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

/**
 * 前置条件错误
 */
export class PreconditionError extends EngineError {
  /**
   * 不满足的条件
   */
  readonly conditions: string[];

  constructor(conditions: string | string[], message?: string) {
    const conditionList = Array.isArray(conditions) ? conditions : [conditions];
    super(
      message || `Precondition failed: ${conditionList.join(", ")}`,
      CommonErrorCode.PRECONDITION_FAILED,
      {
        details: { conditions: conditionList },
        retryable: false,
        httpStatus: 412,
      },
    );
    this.conditions = conditionList;
  }
}

/**
 * 依赖错误
 */
export class DependencyError extends EngineError {
  /**
   * 缺失的依赖
   */
  readonly missingDependencies: string[];

  constructor(dependencies: string[], message?: string) {
    super(
      message || `Missing dependencies: ${dependencies.join(", ")}`,
      CommonErrorCode.DEPENDENCY_MISSING,
      {
        details: { dependencies },
        retryable: false,
      },
    );
    this.missingDependencies = dependencies;
  }
}

/**
 * 速率限制错误
 */
export class RateLimitError extends EngineError {
  /**
   * 重试延迟（毫秒）
   */
  readonly retryAfter?: number;

  constructor(retryAfter?: number, message?: string) {
    super(message || "Rate limit exceeded", CommonErrorCode.RATE_LIMITED, {
      details: retryAfter ? { retryAfter } : undefined,
      retryable: true,
      httpStatus: 429,
    });
    this.retryAfter = retryAfter;
  }
}

