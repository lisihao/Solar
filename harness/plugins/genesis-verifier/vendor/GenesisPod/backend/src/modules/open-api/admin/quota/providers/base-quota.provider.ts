/**
 * Base Quota Provider
 * 配额查询提供者的抽象基类
 */

import { Logger } from "@nestjs/common";
import {
  ProviderQuota,
  QuotaFetchResult,
  QuotaStatus,
  QuotaDataSource,
  QuotaType,
  QuotaUnit,
  QuotaPeriod,
} from "../quota.types";

/**
 * 配额查询提供者接口
 */
export interface IQuotaProvider {
  /** Provider 标识 */
  readonly provider: string;
  /** 是否支持 API 查询 */
  readonly supportsApiQuery: boolean;
  /** 获取配额信息 */
  fetchQuota(apiKey: string): Promise<QuotaFetchResult>;
}

/**
 * 配额查询提供者基类
 */
export abstract class BaseQuotaProvider implements IQuotaProvider {
  protected readonly logger: Logger;

  abstract readonly provider: string;
  abstract readonly supportsApiQuery: boolean;

  constructor() {
    this.logger = new Logger(this.constructor.name);
  }

  /**
   * 获取配额信息
   */
  abstract fetchQuota(apiKey: string): Promise<QuotaFetchResult>;

  /**
   * 获取 Provider 显示名称
   */
  getDisplayName(): string {
    const names: Record<string, string> = {
      openai: "OpenAI",
      anthropic: "Anthropic (Claude)",
      google: "Google (Gemini)",
      xai: "xAI (Grok)",
      cohere: "Cohere",
      deepseek: "DeepSeek",
    };
    return names[this.provider] || this.provider;
  }

  /**
   * 获取 Provider 图标 URL
   */
  getIconUrl(): string {
    const icons: Record<string, string> = {
      openai: "/icons/ai/openai.svg",
      anthropic: "/icons/ai/claude.svg",
      google: "/icons/ai/gemini.svg",
      xai: "/icons/ai/grok.svg",
      deepseek: "/icons/ai/deepseek.svg",
      meta: "/icons/ai/meta.svg",
      mistral: "/icons/ai/mistral.svg",
      qwen: "/icons/ai/qwen.svg",
      doubao: "/icons/ai/doubao.svg",
      zhipu: "/icons/ai/zhipu.svg",
      kimi: "/icons/ai/kimi.svg",
    };
    return icons[this.provider] || "/icons/ai/default.svg";
  }

  /**
   * 获取官方控制台 URL
   */
  getConsoleUrl(): string {
    const urls: Record<string, string> = {
      openai: "https://platform.openai.com/usage",
      anthropic: "https://console.anthropic.com/settings/usage",
      google: "https://console.cloud.google.com/apis/dashboard",
      xai: "https://console.x.ai/",
      cohere: "https://dashboard.cohere.com/",
      deepseek: "https://platform.deepseek.com/",
    };
    return urls[this.provider] || "";
  }

  /**
   * 根据使用率计算状态
   */
  protected calculateStatus(usagePercentage: number | null): QuotaStatus {
    if (usagePercentage === null) {
      return QuotaStatus.UNAVAILABLE;
    }
    if (usagePercentage >= 80) {
      return QuotaStatus.CRITICAL;
    }
    if (usagePercentage >= 60) {
      return QuotaStatus.WARNING;
    }
    return QuotaStatus.NORMAL;
  }

  /**
   * 获取状态消息
   */
  protected getStatusMessage(status: QuotaStatus): string {
    const messages: Record<QuotaStatus, string> = {
      [QuotaStatus.NORMAL]: "配额充足",
      [QuotaStatus.WARNING]: "配额即将耗尽，请关注",
      [QuotaStatus.CRITICAL]: "配额紧张，请及时补充",
      [QuotaStatus.UNAVAILABLE]: "暂不支持自动查询",
      [QuotaStatus.ERROR]: "查询失败",
    };
    return messages[status];
  }

  /**
   * 创建不可用状态的配额信息
   */
  protected createUnavailableQuota(message?: string): ProviderQuota {
    return {
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
      status: QuotaStatus.UNAVAILABLE,
      statusMessage: message || "暂不支持自动配额查询，请前往官方控制台查看",
      lastUpdated: new Date(),
      dataSource: QuotaDataSource.UNAVAILABLE,
      consoleUrl: this.getConsoleUrl(),
    };
  }

  /**
   * 创建错误状态的配额信息
   */
  protected createErrorQuota(errorMessage: string): ProviderQuota {
    return {
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
      status: QuotaStatus.ERROR,
      statusMessage: `查询失败: ${errorMessage}`,
      lastUpdated: new Date(),
      dataSource: QuotaDataSource.UNAVAILABLE,
      consoleUrl: this.getConsoleUrl(),
    };
  }
}
