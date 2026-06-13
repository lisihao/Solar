/**
 * AI Engine - Error Detection Utilities
 * AI 引擎错误检测工具函数
 *
 * 从 AI Teams 下沉的通用错误检测能力
 * 提供字符串式错误分类，适用于 AI API 调用场景
 */

import { Logger } from "@nestjs/common";

const logger = new Logger("ErrorDetectionUtils");

/**
 * 错误检测重试配置接口
 */
export interface ErrorDetectionRetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryablePatterns: RegExp[];
  nonRetryablePatterns: RegExp[];
}

/**
 * 默认重试配置
 */
export const DEFAULT_RETRY_CONFIG: ErrorDetectionRetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  retryablePatterns: [
    /timeout/i,
    /ETIMEDOUT/,
    /ECONNRESET/,
    /ECONNREFUSED/,
    /network/i,
    /503/,
    /502/,
    /temporarily unavailable/i,
    /overloaded/i,
    /too many requests/i,
    /rate.?limit/i,
    /429/,
  ],
  nonRetryablePatterns: [
    /context.*(too large|overflow|exceed)/i,
    /token.*(limit|exceed|max)/i,
    /invalid.*(api.?key|request|model)/i,
    /authentication/i,
    /authorization/i,
    /forbidden/i,
    /model.*not.*available/i,
    /content.*policy/i,
    /400/,
    /401/,
    /403/,
    /404/,
  ],
};

/**
 * 检查错误是否可重试
 *
 * 可重试：网络超时、5xx 错误、连接问题、速率限制
 * 不可重试：上下文过大、认证错误、无效请求（4xx）
 *
 * @param errorMsg 错误消息
 * @param config 可选的自定义配置
 * @returns 是否可重试
 */
export function isRetryableError(
  errorMsg: string,
  config: ErrorDetectionRetryConfig = DEFAULT_RETRY_CONFIG,
): boolean {
  // 先检查不可重试的错误（优先级更高）
  for (const pattern of config.nonRetryablePatterns) {
    if (pattern.test(errorMsg)) {
      logger.debug(
        `[isRetryableError] Non-retryable error detected: ${errorMsg}`,
      );
      return false;
    }
  }

  // 检查可重试的错误
  for (const pattern of config.retryablePatterns) {
    if (pattern.test(errorMsg)) {
      logger.debug(`[isRetryableError] Retryable error detected: ${errorMsg}`);
      return true;
    }
  }

  // 默认：重试（大多数未知错误是临时性的）
  return true;
}

/**
 * 检查是否是 Rate Limit 错误
 * Rate Limit 错误需要特殊处理：不重试，但可以切换 Agent
 *
 * @param errorMsg 错误消息
 * @returns 是否为速率限制错误
 */
export function isRateLimitError(errorMsg: string): boolean {
  const rateLimitPatterns = [
    /rate.?limit/i,
    /too many requests/i,
    /429/,
    /quota/i,
  ];
  return rateLimitPatterns.some((pattern) => pattern.test(errorMsg));
}

/**
 * 检查是否是永久性错误（不能通过切换 Agent 解决）
 * 如：上下文过大、认证错误、无效请求等
 *
 * @param errorMsg 错误消息
 * @returns 是否为永久性错误
 */
export function isPermanentError(errorMsg: string): boolean {
  const permanentPatterns = [
    /context.*(too large|overflow|exceed)/i,
    /token.*(limit|exceed|max)/i,
    /invalid.*(request|api.?key|model)/i,
    /authentication/i,
    /authorization/i,
    /forbidden/i,
    /not found/i,
    /model.*not.*available/i,
    /content.*policy/i,
    /403/,
    /401/,
    /404/,
  ];
  return permanentPatterns.some((pattern) => pattern.test(errorMsg));
}

/**
 * 检查内容是否包含 API 错误信息
 * 用于识别那些虽然请求成功但内容实际上是错误的情况
 *
 * @param content 响应内容
 * @returns 是否包含错误信息
 */
export function isApiErrorContent(content: string): boolean {
  if (!content) return false;

  const errorPatterns = [
    /API Error[:：]/i,
    /Rate limit exceeded/i,
    /Please check your API key/i,
    /请检查.*API/,
    /Provider[:：]\s*\w+\s*Model[:：]/i,
    /\[修订失败\]/,
    /\[任务执行失败\]/,
    /ECONNREFUSED/,
    /ETIMEDOUT/,
    /500 Internal Server Error/i,
    /503 Service Unavailable/i,
    /quota exceeded/i,
    /insufficient.*quota/i,
  ];

  for (const pattern of errorPatterns) {
    if (pattern.test(content)) {
      logger.debug(
        `[isApiErrorContent] API error pattern detected: ${pattern}`,
      );
      return true;
    }
  }

  // 检查内容是否过短且不像正常内容（API错误通常很短）
  const trimmedContent = content.trim();
  if (
    trimmedContent.length < 100 &&
    (trimmedContent.includes("Error") || trimmedContent.includes("错误"))
  ) {
    return true;
  }

  return false;
}

/**
 * 解析错误类型（用于熔断器记录）
 *
 * @param errorMsg 错误消息
 * @returns 错误类型字符串
 */
export function parseErrorType(
  errorMsg: string,
): "rate_limit" | "timeout" | "auth" | "context_overflow" | "unknown" {
  const lower = errorMsg.toLowerCase();

  if (isRateLimitError(errorMsg)) {
    return "rate_limit";
  }
  if (lower.includes("timeout") || lower.includes("etimedout")) {
    return "timeout";
  }
  if (
    lower.includes("authentication") ||
    lower.includes("authorization") ||
    lower.includes("401") ||
    lower.includes("403")
  ) {
    return "auth";
  }
  if (
    lower.includes("context") ||
    lower.includes("token limit") ||
    lower.includes("too large")
  ) {
    return "context_overflow";
  }

  return "unknown";
}

/**
 * 计算指数退避延迟
 *
 * @param attempt 当前尝试次数（从 0 开始）
 * @param config 重试配置
 * @returns 延迟毫秒数
 */
export function calculateBackoffDelay(
  attempt: number,
  config: ErrorDetectionRetryConfig = DEFAULT_RETRY_CONFIG,
): number {
  const delay = Math.min(
    config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt),
    config.maxDelayMs,
  );
  // 添加 10% 的随机抖动
  const jitter = delay * 0.1 * Math.random();
  return Math.floor(delay + jitter);
}

/**
 * 睡眠指定毫秒数
 *
 * @param ms 毫秒数
 * @returns Promise
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 带重试的异步操作执行器
 *
 * @param operation 要执行的操作
 * @param options 选项
 * @returns 操作结果
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options?: {
    maxRetries?: number;
    onRetry?: (attempt: number, error: Error) => void;
    shouldRetry?: (error: Error) => boolean;
  },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? DEFAULT_RETRY_CONFIG.maxRetries;
  const shouldRetry =
    options?.shouldRetry ?? ((e) => isRetryableError(e.message));

  let lastError: Error = new Error("Unknown error");

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries && shouldRetry(lastError)) {
        const delay = calculateBackoffDelay(attempt);
        logger.warn(
          `[withRetry] Attempt ${attempt + 1}/${maxRetries + 1} failed: ${lastError.message}. Retrying in ${delay}ms...`,
        );
        options?.onRetry?.(attempt, lastError);
        await sleep(delay);
      } else {
        break;
      }
    }
  }

  throw lastError;
}
