/**
 * OpenAI Quota Provider
 * 通过 OpenAI Usage API 获取配额信息
 *
 * API 文档: https://platform.openai.com/docs/api-reference/usage
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
} from "../quota.types";

interface OpenAIUsageResponse {
  data: Array<{
    aggregation_timestamp: number;
    n_requests: number;
    operation: string;
    snapshot_id: string;
    n_context_tokens_total: number;
    n_generated_tokens_total: number;
    email?: string;
    api_key_id?: string;
    api_key_name?: string;
    api_key_redacted?: string;
    api_key_type?: string;
    project_id?: string;
    project_name?: string;
    user_id?: string;
    batch?: boolean;
  }>;
  has_more: boolean;
  next_page?: string;
}

@Injectable()
export class OpenAIQuotaProvider extends BaseQuotaProvider {
  readonly provider = "openai";
  readonly supportsApiQuery = true;

  // 缓存权限检查结果，避免重复警告
  private permissionDenied = false;

  /**
   * 获取 OpenAI 配额信息
   * 使用 Usage API 获取 token 使用量
   */
  async fetchQuota(apiKey: string): Promise<QuotaFetchResult> {
    if (!apiKey) {
      return {
        success: false,
        error: "API Key not provided",
      };
    }

    // 如果已知没有权限，直接返回，避免重复请求和日志
    if (this.permissionDenied) {
      return {
        success: false,
        error: "API Key 没有 api.usage.read 权限，需要在 OpenAI 控制台配置",
      };
    }

    try {
      // 计算本月开始时间
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startTimestamp = Math.floor(startOfMonth.getTime() / 1000);

      // 调用 OpenAI Usage API
      const response = await fetch(
        `https://api.openai.com/v1/organization/usage/completions?start_time=${startTimestamp}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        // 如果是 401/403，可能是 API Key 没有权限访问 organization usage
        if (response.status === 401 || response.status === 403) {
          // 标记权限被拒绝，后续请求直接跳过
          this.permissionDenied = true;
          // 只在首次出现时记录日志
          this.logger.warn(
            `[fetchQuota] OpenAI API Key 缺少 api.usage.read 权限，配额查询已禁用。` +
              `如需启用，请在 OpenAI 控制台为 API Key 添加此权限。`,
          );
          return {
            success: false,
            error: "API Key 没有 api.usage.read 权限",
          };
        }

        const errorText = await response.text();
        this.logger.warn(
          `[fetchQuota] OpenAI API error: ${response.status} - ${errorText}`,
        );

        return {
          success: false,
          error: `API 请求失败: ${response.status}`,
        };
      }

      const data: OpenAIUsageResponse = await response.json();

      // 聚合使用量
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalRequests = 0;

      for (const item of data.data) {
        totalInputTokens += item.n_context_tokens_total || 0;
        totalOutputTokens += item.n_generated_tokens_total || 0;
        totalRequests += item.n_requests || 0;
      }

      const totalTokens = totalInputTokens + totalOutputTokens;

      // OpenAI 不直接返回配额限制，需要从 billing 信息获取
      // 这里我们只返回使用量，不设置限制
      const usagePercentage = null; // 无法计算使用率
      const status = this.calculateStatus(usagePercentage);

      const quota: ProviderQuota = {
        provider: this.provider,
        providerDisplayName: this.getDisplayName(),
        providerIcon: this.getIconUrl(),
        quotaType: QuotaType.TOKENS,
        usage: totalTokens,
        limit: null, // OpenAI 不返回配额限制
        remaining: null,
        usagePercentage: null,
        unit: QuotaUnit.TOKENS,
        period: QuotaPeriod.MONTHLY,
        status,
        statusMessage: `本月已使用 ${this.formatNumber(totalTokens)} tokens (${totalRequests} 请求)`,
        lastUpdated: new Date(),
        dataSource: QuotaDataSource.API,
        consoleUrl: this.getConsoleUrl(),
      };

      return {
        success: true,
        quota,
        rawData: data,
      };
    } catch (error) {
      this.logger.error(`[fetchQuota] OpenAI quota fetch failed:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * 格式化数字（添加千位分隔符）
   */
  private formatNumber(num: number): string {
    return num.toLocaleString("en-US");
  }
}
