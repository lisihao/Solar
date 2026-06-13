/**
 * Unavailable Quota Provider
 * 用于不支持 API 配额查询的 Provider
 *
 * 包括: Google/Gemini, xAI/Grok, DeepSeek
 */

import { Injectable } from "@nestjs/common";
import { BaseQuotaProvider } from "./base-quota.provider";
import { QuotaFetchResult } from "../quota.types";

/**
 * Google/Gemini Quota Provider
 * Google Cloud 不提供直接的 API 配额查询
 */
@Injectable()
export class GoogleQuotaProvider extends BaseQuotaProvider {
  readonly provider = "google";
  readonly supportsApiQuery = false;

  async fetchQuota(_apiKey: string): Promise<QuotaFetchResult> {
    return {
      success: true,
      quota: this.createUnavailableQuota(
        "请在 Google Cloud Console 查看 API 配额",
      ),
    };
  }
}

/**
 * xAI/Grok Quota Provider
 * xAI 不提供直接的配额查询 API
 */
@Injectable()
export class XAIQuotaProvider extends BaseQuotaProvider {
  readonly provider = "xai";
  readonly supportsApiQuery = false;

  async fetchQuota(_apiKey: string): Promise<QuotaFetchResult> {
    return {
      success: true,
      quota: this.createUnavailableQuota("请在 xAI Console 查看 API 用量"),
    };
  }
}

/**
 * Cohere Quota Provider
 * Cohere 有 Dashboard，但公开 API 配额查询需要确认
 */
@Injectable()
export class CohereQuotaProvider extends BaseQuotaProvider {
  readonly provider = "cohere";
  readonly supportsApiQuery = false;

  async fetchQuota(_apiKey: string): Promise<QuotaFetchResult> {
    return {
      success: true,
      quota: this.createUnavailableQuota("请在 Cohere Dashboard 查看 API 配额"),
    };
  }
}

/**
 * DeepSeek Quota Provider
 * DeepSeek 不提供公开的配额查询 API
 */
@Injectable()
export class DeepSeekQuotaProvider extends BaseQuotaProvider {
  readonly provider = "deepseek";
  readonly supportsApiQuery = false;

  async fetchQuota(_apiKey: string): Promise<QuotaFetchResult> {
    return {
      success: true,
      quota: this.createUnavailableQuota(
        "请在 DeepSeek Platform 查看 API 配额",
      ),
    };
  }
}

/**
 * Groq Quota Provider
 * Groq 暂不提供公开的配额查询 API
 */
@Injectable()
export class GroqQuotaProvider extends BaseQuotaProvider {
  readonly provider = "groq";
  readonly supportsApiQuery = false;

  async fetchQuota(_apiKey: string): Promise<QuotaFetchResult> {
    return {
      success: true,
      quota: this.createUnavailableQuota("请在 Groq Console 查看 API 用量"),
    };
  }
}

/**
 * OpenRouter Quota Provider
 * OpenRouter 暂不提供公开的配额查询 API
 */
@Injectable()
export class OpenRouterQuotaProvider extends BaseQuotaProvider {
  readonly provider = "openrouter";
  readonly supportsApiQuery = false;

  async fetchQuota(_apiKey: string): Promise<QuotaFetchResult> {
    return {
      success: true,
      quota: this.createUnavailableQuota(
        "请在 OpenRouter Dashboard 查看 API 用量",
      ),
    };
  }
}

/**
 * MiniMax Quota Provider
 * MiniMax 暂不提供公开的配额查询 API
 */
@Injectable()
export class MiniMaxQuotaProvider extends BaseQuotaProvider {
  readonly provider = "minimax";
  readonly supportsApiQuery = false;

  async fetchQuota(_apiKey: string): Promise<QuotaFetchResult> {
    return {
      success: true,
      quota: this.createUnavailableQuota("请在 MiniMax 控制台查看 API 配额"),
    };
  }
}
