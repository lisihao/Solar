/**
 * AI Error Classifier
 *
 * 统一的 AI 错误分类和处理
 *
 * 设计原则：
 * 1. 区分可重试错误 vs 永久错误
 * 2. 提供统一的错误类型
 * 3. 保留原始错误信息
 * 4. 可通过 DI 注入（符合 DIP 原则）
 */

import { Injectable } from "@nestjs/common";
import axios from "axios";

/**
 * AI 错误类型枚举
 */
export enum AIErrorType {
  // 可重试的错误
  RATE_LIMIT = "RATE_LIMIT", // 429 - 请求过于频繁
  TIMEOUT = "TIMEOUT", // 请求超时
  TEMPORARY_UNAVAILABLE = "TEMPORARY_UNAVAILABLE", // 503 - 服务暂时不可用
  NETWORK_ERROR = "NETWORK_ERROR", // 网络错误

  // 不可重试的错误
  INVALID_API_KEY = "INVALID_API_KEY", // 401 - API Key 无效
  INVALID_MODEL = "INVALID_MODEL", // 404 - 模型不存在
  INVALID_REQUEST = "INVALID_REQUEST", // 400 - 请求参数错误
  INVALID_RESPONSE = "INVALID_RESPONSE", // 响应格式错误
  QUOTA_EXCEEDED = "QUOTA_EXCEEDED", // 402/429 - 配额耗尽
  CONTENT_FILTERED = "CONTENT_FILTERED", // 内容被过滤
  CONTEXT_TOO_LONG = "CONTEXT_TOO_LONG", // 上下文过长

  // 系统错误
  UNKNOWN = "UNKNOWN", // 未知错误

  // ★ 全覆盖审计修 (2026-05-06): fallback chain 为空时的精细化错误类型，
  //   让调用方（前端/监控）能区分"无 key 配置"、"无模型配置"、"API 全挂"
  NO_API_KEY = "NO_API_KEY", // 无有效 API Key（用户未配置 BYOK / Secret 失效）
  NO_MODEL = "NO_MODEL", // 无可用模型配置（数据库无启用模型）
  API_UNAVAILABLE = "API_UNAVAILABLE", // 所有 provider 均不可用（全链路 down）
}

/**
 * AI 错误类
 */
export class AIError extends Error {
  constructor(
    public readonly type: AIErrorType,
    message: string,
    public readonly statusCode?: number,
    public readonly originalError?: Error,
    public readonly provider?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AIError";
  }

  /**
   * 判断错误是否可重试
   */
  isRetryable(): boolean {
    return [
      AIErrorType.RATE_LIMIT,
      AIErrorType.TIMEOUT,
      AIErrorType.TEMPORARY_UNAVAILABLE,
      AIErrorType.NETWORK_ERROR,
    ].includes(this.type);
  }

  /**
   * 获取建议的重试延迟 (毫秒)
   */
  getRetryDelay(): number {
    switch (this.type) {
      case AIErrorType.RATE_LIMIT:
        return 5000; // 5秒后重试
      case AIErrorType.TIMEOUT:
        return 1000; // 1秒后重试
      case AIErrorType.TEMPORARY_UNAVAILABLE:
        return 10000; // 10秒后重试
      case AIErrorType.NETWORK_ERROR:
        return 2000; // 2秒后重试
      default:
        return 0;
    }
  }

  /**
   * 获取用户友好的错误消息
   */
  getUserMessage(): string {
    switch (this.type) {
      case AIErrorType.RATE_LIMIT:
        return "AI 服务请求过于频繁，请稍后重试";
      case AIErrorType.TIMEOUT:
        return "AI 服务响应超时，请重试";
      case AIErrorType.TEMPORARY_UNAVAILABLE:
        return "AI 服务暂时不可用，请稍后重试";
      case AIErrorType.NETWORK_ERROR:
        return "网络连接错误，请检查网络后重试";
      case AIErrorType.INVALID_API_KEY:
        return "AI 模型配置错误，请联系管理员";
      case AIErrorType.INVALID_MODEL:
        return "指定的 AI 模型不可用";
      case AIErrorType.INVALID_REQUEST:
        return "请求参数错误";
      case AIErrorType.QUOTA_EXCEEDED:
        return "AI 服务配额已用完，请联系管理员";
      case AIErrorType.CONTENT_FILTERED:
        return "内容被安全策略过滤，请修改后重试";
      case AIErrorType.CONTEXT_TOO_LONG:
        return "输入内容过长，请缩短后重试";
      default:
        return "AI 服务出现错误，请重试";
    }
  }

  /**
   * 转换为 JSON
   */
  toJSON(): Record<string, unknown> {
    return {
      type: this.type,
      message: this.message,
      statusCode: this.statusCode,
      provider: this.provider,
      retryable: this.isRetryable(),
      retryDelay: this.getRetryDelay(),
      userMessage: this.getUserMessage(),
    };
  }
}

/**
 * AI 错误分类器
 *
 * 可通过依赖注入使用，便于测试和替换
 */
@Injectable()
export class AIErrorClassifier {
  /**
   * 分类错误
   */
  classify(error: unknown, provider?: string): AIError {
    // 已经是 AIError
    if (error instanceof AIError) {
      return error;
    }

    // Axios 错误
    if (axios.isAxiosError(error)) {
      return this.classifyAxiosError(error, provider);
    }

    // 普通 Error
    if (error instanceof Error) {
      return this.classifyGenericError(error, provider);
    }

    // 未知类型
    return new AIError(
      AIErrorType.UNKNOWN,
      String(error),
      undefined,
      new Error(String(error)),
      provider,
    );
  }

  /**
   * 分类 Axios 错误
   */
  private classifyAxiosError(
    error: import("axios").AxiosError,
    provider?: string,
  ): AIError {
    const status = error.response?.status;
    const data = error.response?.data as Record<string, unknown> | undefined;
    // 2026-05-13: provider 错误 body 形态差异大，逐种尝试提取真实 message
    //   - OpenAI: {error: {message, type, code}}
    //   - xAI/Grok: {code, error: "INVALID_MODEL", message?, detail?} 或 {error: "..."}
    //   - Anthropic: {error: {type, message}}
    //   - Cohere/Voyage: {message}
    //   - 兜底 axios "Request failed with status code N"（无信息量）
    const errFromObj =
      typeof data?.error === "object" && data?.error !== null
        ? ((data.error as Record<string, unknown>).message as
            | string
            | undefined)
        : undefined;
    const errFromStr = typeof data?.error === "string" ? data.error : undefined;
    const errorMessage =
      errFromObj ||
      errFromStr ||
      (typeof data?.message === "string" ? data.message : undefined) ||
      (typeof data?.detail === "string" ? data.detail : undefined) ||
      error.message;

    // 根据状态码分类
    switch (status) {
      case 400:
        // 检查是否是上下文过长
        if (
          String(errorMessage).includes("context_length") ||
          String(errorMessage).includes("too long") ||
          String(errorMessage).includes("maximum context")
        ) {
          return new AIError(
            AIErrorType.CONTEXT_TOO_LONG,
            String(errorMessage),
            status,
            error,
            provider,
            data,
          );
        }
        return new AIError(
          AIErrorType.INVALID_REQUEST,
          String(errorMessage),
          status,
          error,
          provider,
          data,
        );

      case 401:
        return new AIError(
          AIErrorType.INVALID_API_KEY,
          "Invalid API key",
          status,
          error,
          provider,
          data,
        );

      case 402:
        return new AIError(
          AIErrorType.QUOTA_EXCEEDED,
          "Payment required - quota exceeded",
          status,
          error,
          provider,
          data,
        );

      case 403:
        // 可能是内容过滤
        if (
          String(errorMessage).includes("content") ||
          String(errorMessage).includes("safety") ||
          String(errorMessage).includes("policy")
        ) {
          return new AIError(
            AIErrorType.CONTENT_FILTERED,
            String(errorMessage),
            status,
            error,
            provider,
            data,
          );
        }
        // 账单/额度耗尽（xAI 等用 403 表示欠费 / 超月度上限）—— 不可重试。
        // 必须排在下面的限流判定**之前**：欠费消息含 "spending limit" 会误命中
        // "limit" → 被当限流重试 3 次空转 ~16s。识别 credit/spending/billing/
        // purchase/insufficient/payment/quota → QUOTA_EXCEEDED（isRetryable=false），
        // 立即失败让上层换模型。
        if (
          /credit|spending\s+limit|billing|purchase\s+more|insufficient|payment/i.test(
            String(errorMessage),
          )
        ) {
          return new AIError(
            AIErrorType.QUOTA_EXCEEDED,
            String(errorMessage),
            status,
            error,
            provider,
            data,
          );
        }
        // 速率限制（xAI 等 provider 用 403 而非 429 表示限流；含软配额限流 "quota"）
        if (
          String(errorMessage).includes("rate") ||
          String(errorMessage).includes("limit") ||
          String(errorMessage).includes("too many") ||
          String(errorMessage).includes("quota")
        ) {
          return new AIError(
            AIErrorType.RATE_LIMIT,
            String(errorMessage),
            status,
            error,
            provider,
            data,
          );
        }
        // 其他 403：访问被拒 — 立即切换模型，避免重试浪费 rate limit 配额
        return new AIError(
          AIErrorType.INVALID_API_KEY,
          `Access denied (HTTP 403): ${String(errorMessage)}`,
          status,
          error,
          provider,
          data,
        );

      case 404:
        // ★ 2026-04-30 fix: 之前 hardcoded "Model not found" 会吞掉 OpenAI 的真实
        // error message（含具体哪个 modelId / "does not have access" 等定位线索），
        // 让 debug 时只能瞎猜。改用真实 errorMessage（与其他 case 一致）。
        return new AIError(
          AIErrorType.INVALID_MODEL,
          String(errorMessage),
          status,
          error,
          provider,
          data,
        );

      case 429:
        // 检查是否是配额耗尽
        if (
          String(errorMessage).includes("quota") ||
          String(errorMessage).includes("exceeded")
        ) {
          return new AIError(
            AIErrorType.QUOTA_EXCEEDED,
            String(errorMessage),
            status,
            error,
            provider,
            data,
          );
        }
        return new AIError(
          AIErrorType.RATE_LIMIT,
          "Rate limit exceeded",
          status,
          error,
          provider,
          data,
        );

      case 500:
      case 502:
      case 503:
      case 504:
        return new AIError(
          AIErrorType.TEMPORARY_UNAVAILABLE,
          "Service temporarily unavailable",
          status,
          error,
          provider,
          data,
        );

      default:
        break;
    }

    // 检查网络错误
    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
      return new AIError(
        AIErrorType.TIMEOUT,
        "Request timeout",
        undefined,
        error,
        provider,
      );
    }

    if (
      error.code === "ECONNREFUSED" ||
      error.code === "ENOTFOUND" ||
      error.code === "ENETUNREACH" ||
      error.code === "ECONNRESET" ||
      error.code === "EPIPE" ||
      error.code === "ETIMEDOUT" ||
      error.message?.toLowerCase().includes("socket hang up") ||
      error.message?.toLowerCase().includes("network socket disconnected")
    ) {
      return new AIError(
        AIErrorType.NETWORK_ERROR,
        "Network error: " +
          (error.code || error.message || "connection failed"),
        undefined,
        error,
        provider,
      );
    }

    // 默认未知错误
    return new AIError(
      AIErrorType.UNKNOWN,
      String(errorMessage),
      status,
      error,
      provider,
      data,
    );
  }

  /**
   * 分类通用错误
   */
  private classifyGenericError(error: Error, provider?: string): AIError {
    const message = error.message.toLowerCase();

    // 超时
    if (message.includes("timeout") || message.includes("timed out")) {
      return new AIError(
        AIErrorType.TIMEOUT,
        error.message,
        undefined,
        error,
        provider,
      );
    }

    // 网络错误
    if (
      message.includes("network") ||
      message.includes("connection") ||
      message.includes("econnrefused") ||
      message.includes("econnreset") ||
      message.includes("epipe") ||
      message.includes("etimedout") ||
      message.includes("socket hang up") ||
      message.includes("socket disconnected") ||
      message.includes("read econnreset") ||
      message.includes("write econnreset")
    ) {
      return new AIError(
        AIErrorType.NETWORK_ERROR,
        error.message,
        undefined,
        error,
        provider,
      );
    }

    // API Key 错误
    if (
      message.includes("api key") ||
      message.includes("apikey") ||
      message.includes("unauthorized") ||
      message.includes("authentication")
    ) {
      return new AIError(
        AIErrorType.INVALID_API_KEY,
        error.message,
        undefined,
        error,
        provider,
      );
    }

    // 内容过滤
    if (
      message.includes("content filter") ||
      message.includes("safety") ||
      message.includes("blocked")
    ) {
      return new AIError(
        AIErrorType.CONTENT_FILTERED,
        error.message,
        undefined,
        error,
        provider,
      );
    }

    // 默认未知
    return new AIError(
      AIErrorType.UNKNOWN,
      error.message,
      undefined,
      error,
      provider,
    );
  }
}
