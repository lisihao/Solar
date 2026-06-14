/**
 * Anthropic Quota Provider
 * 通过 Anthropic API 获取配额信息
 *
 * 注意: Anthropic 的公开 API 不提供直接的配额查询端点
 * 需要通过 rate limit headers 或 Console API 获取
 */

import { Injectable } from "@nestjs/common";
import { BaseQuotaProvider } from "./base-quota.provider";
import {
  QuotaFetchResult,
  ProviderQuota,
  QuotaType,
  QuotaUnit,
  QuotaPeriod,
  QuotaDataSource,
  QuotaStatus,
} from "../quota.types";

/** Minimal model for Anthropic quota check (cheapest available) */
const ANTHROPIC_VALIDATION_MODEL = "claude-3-haiku-20240307";

@Injectable()
export class AnthropicQuotaProvider extends BaseQuotaProvider {
  readonly provider = "anthropic";
  readonly supportsApiQuery = true; // 部分支持

  /**
   * 获取 Anthropic 配额信息
   * Anthropic 不提供直接的配额 API，但可以通过发送一个测试请求获取 rate limit headers
   */
  async fetchQuota(apiKey: string): Promise<QuotaFetchResult> {
    if (!apiKey) {
      return {
        success: false,
        error: "API Key not provided",
      };
    }

    try {
      // 发送一个最小的请求来获取 rate limit headers
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: ANTHROPIC_VALIDATION_MODEL,
          max_tokens: 1,
          messages: [{ role: "user", content: "Hi" }],
        }),
      });

      // 从响应头中提取 rate limit 信息
      const rateLimitRequestsRemaining = response.headers.get(
        "anthropic-ratelimit-requests-remaining",
      );
      const rateLimitRequestsLimit = response.headers.get(
        "anthropic-ratelimit-requests-limit",
      );
      const rateLimitTokensRemaining = response.headers.get(
        "anthropic-ratelimit-tokens-remaining",
      );
      const rateLimitTokensLimit = response.headers.get(
        "anthropic-ratelimit-tokens-limit",
      );

      this.logger.debug(
        `[fetchQuota] Anthropic rate limits - Requests: ${rateLimitRequestsRemaining}/${rateLimitRequestsLimit}, Tokens: ${rateLimitTokensRemaining}/${rateLimitTokensLimit}`,
      );

      // 如果获取到了 rate limit 信息
      if (rateLimitTokensLimit && rateLimitTokensRemaining) {
        const limit = parseInt(rateLimitTokensLimit, 10);
        const remaining = parseInt(rateLimitTokensRemaining, 10);
        const usage = limit - remaining;
        const usagePercentage = limit > 0 ? (usage / limit) * 100 : null;
        const status = this.calculateStatus(usagePercentage);

        const quota: ProviderQuota = {
          provider: this.provider,
          providerDisplayName: this.getDisplayName(),
          providerIcon: this.getIconUrl(),
          quotaType: QuotaType.TOKENS,
          usage,
          limit,
          remaining,
          usagePercentage,
          unit: QuotaUnit.TOKENS,
          period: QuotaPeriod.DAILY, // Anthropic rate limits 是按分钟/日计算的
          status,
          statusMessage: this.getStatusMessage(status),
          lastUpdated: new Date(),
          dataSource: QuotaDataSource.API,
          consoleUrl: this.getConsoleUrl(),
        };

        return {
          success: true,
          quota,
          rawData: {
            rateLimitRequestsRemaining,
            rateLimitRequestsLimit,
            rateLimitTokensRemaining,
            rateLimitTokensLimit,
          },
        };
      }

      // 如果没有获取到 rate limit 信息，返回部分可用状态
      const quota: ProviderQuota = {
        provider: this.provider,
        providerDisplayName: this.getDisplayName(),
        providerIcon: this.getIconUrl(),
        quotaType: QuotaType.TOKENS,
        usage: 0,
        limit: null,
        remaining: null,
        usagePercentage: null,
        unit: QuotaUnit.TOKENS,
        period: QuotaPeriod.MONTHLY,
        status: QuotaStatus.NORMAL,
        statusMessage: "API Key 有效，请在 Console 查看详细用量",
        lastUpdated: new Date(),
        dataSource: QuotaDataSource.ESTIMATED,
        consoleUrl: this.getConsoleUrl(),
      };

      return {
        success: true,
        quota,
      };
    } catch (error) {
      this.logger.error(`[fetchQuota] Anthropic quota fetch failed:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}
