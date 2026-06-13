import { Injectable, Logger } from "@nestjs/common";
import {
  AIErrorClassifier,
  AIError,
  AIErrorType,
} from "../abstractions/error-classifier";

/**
 * AI Chat Retry Service
 * 职责：API 调用重试、错误分类、降级处理
 */
@Injectable()
export class AiChatRetryService {
  private readonly logger = new Logger(AiChatRetryService.name);
  private readonly errorClassifier = new AIErrorClassifier();

  // Retry configuration
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAYS = [1000, 2000, 4000]; // ms

  /**
   * Sleep 工具方法
   */
  async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 分类错误并决定是否可重试
   */
  classifyError(error: unknown): {
    isRetriable: boolean;
    category: string;
    message: string;
  } {
    const err = error as Record<string, unknown>;
    const errorMessage = (err?.message as string) || String(error);

    // 使用 AIErrorClassifier 分类错误
    const aiError: AIError = this.errorClassifier.classify(error);

    return {
      isRetriable: aiError.isRetryable(),
      category: aiError.type,
      message: aiError.message || errorMessage,
    };
  }

  /**
   * 带重试的执行函数
   * @param fn 要执行的异步函数
   * @param options 重试选项
   */
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    options: {
      maxRetries?: number;
      retryDelays?: number[];
      onRetry?: (attempt: number, error: unknown) => void;
      context?: string;
    } = {},
  ): Promise<T> {
    const maxRetries = options.maxRetries ?? this.MAX_RETRIES;
    const retryDelays = options.retryDelays ?? this.RETRY_DELAYS;
    const context = options.context || "API call";

    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        // 最后一次尝试，不再重试
        if (attempt >= maxRetries) {
          break;
        }

        // 分类错误
        const classification = this.classifyError(error);

        // 如果错误不可重试，直接抛出
        if (!classification.isRetriable) {
          this.logger.warn(
            `[executeWithRetry] ${context} failed with non-retriable error: ${classification.category}`,
          );
          throw error;
        }

        // 记录重试
        const delay =
          retryDelays[attempt] || retryDelays[retryDelays.length - 1];
        this.logger.warn(
          `[executeWithRetry] ${context} attempt ${attempt + 1}/${maxRetries} failed (${classification.category}), retrying in ${delay}ms...`,
        );

        // 调用回调
        if (options.onRetry) {
          options.onRetry(attempt, error);
        }

        // 等待后重试
        await this.sleep(delay);
      }
    }

    // 所有重试都失败了
    this.logger.error(
      `[executeWithRetry] ${context} failed after ${maxRetries} retries`,
    );
    throw lastError;
  }

  /**
   * 构建错误响应（用于非严格模式）
   */
  buildErrorResponse(
    error: unknown,
    model: string,
  ): {
    content: string;
    tokensUsed: number;
    model: string;
    isError: boolean;
  } {
    const classification = this.classifyError(error);

    let errorMessage = `AI 服务调用失败 (${model})`;

    if (classification.category === "RATE_LIMIT") {
      errorMessage = `API 调用频率限制，请稍后重试`;
    } else if (classification.category === "TIMEOUT") {
      errorMessage = `API 调用超时，请重试或使用更小的输入`;
    } else if (classification.category === "INVALID_REQUEST") {
      errorMessage = `请求参数错误: ${classification.message}`;
    } else if (classification.category === "INVALID_API_KEY") {
      errorMessage = `API Key 未配置或无效`;
    } else if (classification.message) {
      errorMessage = `${errorMessage}: ${classification.message}`;
    }

    return {
      content: errorMessage,
      tokensUsed: 0,
      model,
      isError: true,
    };
  }

  /**
   * 指数退避重试（含 provider 上下文）
   * 替代各服务中重复的私有 withRetry 方法，统一策略：
   * - 延迟 = baseRetryDelay * 2^(attempt-1) + random(0~500ms) jitter
   * - 不可重试错误立即抛出
   */
  async withExponentialBackoff<T>(
    operation: () => Promise<T>,
    operationName: string,
    provider?: string,
    opts?: {
      /**
       * ★ 2026-06-02 BYOK throttle resilience：把 401/INVALID_API_KEY 当**瞬时节流**退避重试。
       * 仅当调用方确认这把 key 近期成功过（lastSuccessAt 新鲜）时传 true —— 此时 401 几乎必然是
       * provider 在并发/速率压力下的假性鉴权失败（如 new-api 网关「无效的令牌」），而非真无效 key。
       * 不传 / false 时保持原行为：INVALID_API_KEY 立即失败、不重试。
       */
      retryTransient401?: boolean;
    },
  ): Promise<T> {
    const maxRetries = this.MAX_RETRIES;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const aiError: AIError = this.errorClassifier.classify(error, provider);
        lastError = aiError;

        // ★ 瞬时节流 401：key 近期健康时，把"非重试"的 INVALID_API_KEY 当作可退避重试。
        const isTransient401 =
          !!opts?.retryTransient401 &&
          aiError.type === AIErrorType.INVALID_API_KEY;

        this.logger.warn(
          `[${operationName}] Attempt ${attempt}/${maxRetries} failed: ${aiError.message} (type: ${aiError.type}${isTransient401 ? ", treated as transient throttle" : ""})`,
        );

        if ((aiError.isRetryable() || isTransient401) && attempt < maxRetries) {
          // 节流类用固定 base（3s）退避，给 provider 速率窗口恢复时间。
          const baseDelay = isTransient401
            ? 3000
            : aiError.getRetryDelay() || 1000;
          const delay =
            baseDelay * Math.pow(2, attempt - 1) + Math.random() * 500;
          this.logger.debug(
            `[${operationName}] Retrying in ${Math.round(delay)}ms...`,
          );
          await this.sleep(delay);
          continue;
        }

        this.logger.error(
          `[${operationName}] ${aiError.isRetryable() || isTransient401 ? "Max retries exceeded" : "Non-retryable error"}: ${aiError.message}`,
        );
        throw aiError;
      }
    }

    throw lastError || new Error(`${operationName} failed after all retries`);
  }

  /**
   * 处理 API 错误（根据严格模式决定抛出异常还是返回错误响应）
   */
  handleApiError(
    error: unknown,
    model: string,
    strictMode: boolean = false,
  ): {
    content: string;
    tokensUsed: number;
    model: string;
    isError: boolean;
  } {
    const classification = this.classifyError(error);

    this.logger.error(
      `[handleApiError] ${model} API call failed: ${classification.category} - ${classification.message}`,
    );

    // 严格模式下直接抛出异常
    if (strictMode) {
      throw error;
    }

    // 非严格模式返回错误响应
    return this.buildErrorResponse(error, model);
  }
}
