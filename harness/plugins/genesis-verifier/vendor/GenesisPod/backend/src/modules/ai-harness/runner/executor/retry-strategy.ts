/**
 * AI Engine - Retry Strategy
 * 工具执行重试策略 - 指数退避、降级处理
 */

import { Logger } from "@nestjs/common";
import { ToolId } from "@/modules/ai-harness/agents/abstractions/agent.types";

// ============================================================================
// Types
// ============================================================================

/**
 * 工具错误类型
 */
export enum ToolErrorType {
  // 可重试错误
  RATE_LIMIT = "RATE_LIMIT",
  TIMEOUT = "TIMEOUT",
  NETWORK_ERROR = "NETWORK_ERROR",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",

  // 需要降级/替代的错误
  QUOTA_EXCEEDED = "QUOTA_EXCEEDED",
  FEATURE_NOT_SUPPORTED = "FEATURE_NOT_SUPPORTED",

  // 不可恢复错误
  INVALID_INPUT = "INVALID_INPUT",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND",
  UNKNOWN = "UNKNOWN",
}

/**
 * 工具错误
 */
export interface RetryToolError {
  type: ToolErrorType;
  toolId: ToolId;
  message: string;
  originalError?: Error;
  retryable: boolean;
}

/**
 * 重试配置
 */
export interface RetryStrategyConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
}

/**
 * 重试结果
 */
export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: RetryToolError;
  attempts: number;
  totalDuration: number;
}

// ============================================================================
// Retry Strategy
// ============================================================================

/**
 * 重试策略
 */
export class RetryStrategy {
  private readonly logger = new Logger(RetryStrategy.name);
  private readonly config: RetryStrategyConfig;

  static readonly DEFAULT_CONFIG: RetryStrategyConfig = {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    jitter: true,
  };

  constructor(config?: Partial<RetryStrategyConfig>) {
    this.config = { ...RetryStrategy.DEFAULT_CONFIG, ...config };
  }

  /**
   * 执行带重试的操作
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    toolId: ToolId,
    operationName?: string,
  ): Promise<RetryResult<T>> {
    const startTime = Date.now();
    let lastError: RetryToolError | undefined;
    let attempts = 0;

    while (attempts <= this.config.maxRetries) {
      attempts++;

      try {
        const result = await operation();
        return {
          success: true,
          data: result,
          attempts,
          totalDuration: Date.now() - startTime,
        };
      } catch (error) {
        const toolError = this.classifyError(error, toolId);
        lastError = toolError;

        this.logger.warn(
          `[${operationName || toolId}] Attempt ${attempts} failed: ${toolError.message}`,
        );

        if (!this.shouldRetry(toolError, attempts)) {
          break;
        }

        const delay = this.getDelay(attempts);
        this.logger.log(
          `[${operationName || toolId}] Retrying in ${delay}ms...`,
        );

        await this.sleep(delay);
      }
    }

    return {
      success: false,
      error: lastError,
      attempts,
      totalDuration: Date.now() - startTime,
    };
  }

  shouldRetry(error: RetryToolError, attempt: number): boolean {
    if (attempt > this.config.maxRetries) {
      return false;
    }
    return error.retryable;
  }

  getDelay(attempt: number): number {
    let delay =
      this.config.initialDelay *
      Math.pow(this.config.backoffMultiplier, attempt - 1);

    delay = Math.min(delay, this.config.maxDelay);

    if (this.config.jitter) {
      const jitterFactor = 0.75 + Math.random() * 0.5;
      delay = Math.floor(delay * jitterFactor);
    }

    return delay;
  }

  classifyError(error: unknown, toolId: ToolId): RetryToolError {
    const err = error instanceof Error ? error : new Error(String(error));
    const message = err.message.toLowerCase();
    const status = (error as { status?: number })?.status;

    let errorType = ToolErrorType.UNKNOWN;
    let retryable = false;

    // 优先检查 HTTP 状态码（跨 provider 一致）
    if (status === 429) {
      errorType = ToolErrorType.RATE_LIMIT;
      retryable = true;
    } else if (status === 503) {
      errorType = ToolErrorType.SERVICE_UNAVAILABLE;
      retryable = true;
    } else if (status === 408 || status === 504) {
      errorType = ToolErrorType.TIMEOUT;
      retryable = true;
    } else if (status !== undefined && status >= 500) {
      errorType = ToolErrorType.SERVICE_UNAVAILABLE;
      retryable = true;
    } else if (status === 400) {
      errorType = ToolErrorType.INVALID_INPUT;
      retryable = false;
    } else if (status === 401 || status === 403) {
      errorType = ToolErrorType.PERMISSION_DENIED;
      retryable = false;
    } else if (status === 404) {
      errorType = ToolErrorType.RESOURCE_NOT_FOUND;
      retryable = false;
    } else if (status === 402) {
      errorType = ToolErrorType.QUOTA_EXCEEDED;
      retryable = false;
    } else if (message.includes("rate limit") || message.includes("429")) {
      // 字符串匹配降级为 fallback
      errorType = ToolErrorType.RATE_LIMIT;
      retryable = true;
    } else if (message.includes("timeout") || message.includes("timed out")) {
      errorType = ToolErrorType.TIMEOUT;
      retryable = true;
    } else if (
      message.includes("network") ||
      message.includes("econnrefused") ||
      message.includes("enotfound")
    ) {
      errorType = ToolErrorType.NETWORK_ERROR;
      retryable = true;
    } else if (
      message.includes("503") ||
      message.includes("service unavailable")
    ) {
      errorType = ToolErrorType.SERVICE_UNAVAILABLE;
      retryable = true;
    } else if (
      message.includes("quota") ||
      message.includes("limit exceeded")
    ) {
      errorType = ToolErrorType.QUOTA_EXCEEDED;
      retryable = false;
    } else if (
      message.includes("invalid") ||
      message.includes("validation") ||
      message.includes("400")
    ) {
      errorType = ToolErrorType.INVALID_INPUT;
      retryable = false;
    } else if (
      message.includes("permission") ||
      message.includes("unauthorized") ||
      message.includes("403")
    ) {
      errorType = ToolErrorType.PERMISSION_DENIED;
      retryable = false;
    } else if (message.includes("not found") || message.includes("404")) {
      errorType = ToolErrorType.RESOURCE_NOT_FOUND;
      retryable = false;
    }

    return {
      type: errorType,
      toolId,
      message: err.message,
      originalError: err,
      retryable,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * 重试装饰器选项
 */
export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
}

/**
 * 创建重试装饰器
 */
export function WithRetry(options?: RetryOptions) {
  return function (
    _target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    const strategy = new RetryStrategy(options);

    descriptor.value = async function (...args: unknown[]) {
      const result = await strategy.executeWithRetry(
        () => originalMethod.apply(this, args),
        "unknown",
        propertyKey,
      );

      if (!result.success) {
        throw result.error?.originalError || new Error(result.error?.message);
      }

      return result.data;
    };

    return descriptor;
  };
}
