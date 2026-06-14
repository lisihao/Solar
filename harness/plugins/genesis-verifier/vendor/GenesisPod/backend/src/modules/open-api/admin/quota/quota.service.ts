/**
 * Quota Service
 * API 配额聚合服务
 *
 * 负责：
 * - 聚合各 Provider 的配额信息
 * - 缓存配额数据到数据库
 * - 提供统一的配额查询接口
 */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { SecretsService } from "../../../platform/credentials/storage/secrets/secrets.service";
import {
  ProviderQuota,
  QuotaStatus,
  QuotaDataSource,
  QuotaType,
  QuotaUnit,
  QuotaPeriod,
} from "./quota.types";
import {
  IQuotaProvider,
  OpenAIQuotaProvider,
  AnthropicQuotaProvider,
  GoogleQuotaProvider,
  XAIQuotaProvider,
  CohereQuotaProvider,
  DeepSeekQuotaProvider,
  GroqQuotaProvider,
  OpenRouterQuotaProvider,
  MiniMaxQuotaProvider,
} from "./providers";

@Injectable()
export class QuotaService implements OnModuleInit {
  private readonly logger = new Logger(QuotaService.name);
  private providers: Map<string, IQuotaProvider> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly secretsService: SecretsService,
    private readonly openaiProvider: OpenAIQuotaProvider,
    private readonly anthropicProvider: AnthropicQuotaProvider,
    private readonly googleProvider: GoogleQuotaProvider,
    private readonly xaiProvider: XAIQuotaProvider,
    private readonly cohereProvider: CohereQuotaProvider,
    private readonly deepseekProvider: DeepSeekQuotaProvider,
    private readonly groqProvider: GroqQuotaProvider,
    private readonly openrouterProvider: OpenRouterQuotaProvider,
    private readonly minimaxProvider: MiniMaxQuotaProvider,
  ) {}

  async onModuleInit() {
    // 注册所有 Provider
    this.registerProvider(this.openaiProvider);
    this.registerProvider(this.anthropicProvider);
    this.registerProvider(this.googleProvider);
    this.registerProvider(this.xaiProvider);
    this.registerProvider(this.cohereProvider);
    this.registerProvider(this.deepseekProvider);
    this.registerProvider(this.groqProvider);
    this.registerProvider(this.openrouterProvider);
    this.registerProvider(this.minimaxProvider);

    this.logger.log(
      `[onModuleInit] Registered ${this.providers.size} quota providers`,
    );

    // 初始化时刷新配额数据（异步，不阻塞启动）
    this.refreshAllQuotas().catch((err) =>
      this.logger.warn(`[onModuleInit] Initial quota refresh failed: ${err}`),
    );
  }

  /**
   * 注册配额查询 Provider
   */
  private registerProvider(provider: IQuotaProvider) {
    this.providers.set(provider.provider, provider);
  }

  /**
   * 获取所有 Provider 的配额信息
   */
  async getAllQuotas(): Promise<ProviderQuota[]> {
    const quotas: ProviderQuota[] = [];

    // 获取有 API Key 配置的 Provider 列表
    const configuredProviders = await this.getConfiguredProviders();

    for (const providerName of configuredProviders) {
      try {
        // 先从缓存获取
        const cached = await this.getCachedQuota(providerName);
        if (cached) {
          quotas.push(cached);
        } else {
          // 如果缓存不存在，返回不可用状态
          quotas.push(this.createUnavailableQuota(providerName));
        }
      } catch (error) {
        this.logger.warn(
          `[getAllQuotas] Failed to get quota for ${providerName}: ${error}`,
        );
        quotas.push(this.createErrorQuota(providerName, String(error)));
      }
    }

    return quotas;
  }

  /**
   * 刷新单个 Provider 的配额
   */
  async refreshProviderQuota(providerName: string): Promise<ProviderQuota> {
    const provider = this.providers.get(providerName.toLowerCase());
    if (!provider) {
      return this.createUnavailableQuota(providerName);
    }

    // 获取该 Provider 的 API Key
    const apiKey = await this.getApiKeyForProvider(providerName);
    if (!apiKey) {
      this.logger.warn(
        `[refreshProviderQuota] No API Key found for ${providerName}`,
      );
      return this.createUnavailableQuota(providerName);
    }

    // 调用 Provider 获取配额
    const result = await provider.fetchQuota(apiKey);

    if (result.success && result.quota) {
      // 保存到缓存
      await this.saveQuotaToCache(providerName, result.quota, result.rawData);
      return result.quota as ProviderQuota;
    } else {
      // 返回错误状态
      const errorQuota = this.createErrorQuota(
        providerName,
        result.error || "Unknown error",
      );
      await this.saveQuotaToCache(providerName, errorQuota);
      return errorQuota;
    }
  }

  /**
   * 刷新所有 Provider 的配额（并行执行提升性能）
   */
  async refreshAllQuotas(): Promise<ProviderQuota[]> {
    const configuredProviders = await this.getConfiguredProviders();

    // 并行刷新所有 Provider
    const quotaPromises = configuredProviders.map(async (providerName) => {
      try {
        return await this.refreshProviderQuota(providerName);
      } catch (error) {
        this.logger.warn(
          `[refreshAllQuotas] Failed to refresh ${providerName}: ${error}`,
        );
        return this.createErrorQuota(providerName, String(error));
      }
    });

    return Promise.all(quotaPromises);
  }

  /**
   * 定时刷新配额
   * 注意：如需定时刷新，请在应用层使用 setInterval 或 @nestjs/schedule 模块
   */
  async scheduledQuotaRefresh() {
    this.logger.log("[scheduledQuotaRefresh] Starting scheduled quota refresh");
    await this.refreshAllQuotas();
    this.logger.log(
      "[scheduledQuotaRefresh] Completed scheduled quota refresh",
    );
  }

  /**
   * 获取最后一次全局更新时间
   */
  async getLastGlobalUpdate(): Promise<Date | null> {
    const latest = await this.prisma.providerQuotaCache.findFirst({
      orderBy: { lastUpdated: "desc" },
      select: { lastUpdated: true },
    });
    return latest?.lastUpdated || null;
  }

  // ==================== 私有方法 ====================

  /**
   * 获取已配置 API Key 的 Provider 列表
   */
  private async getConfiguredProviders(): Promise<string[]> {
    // 从 AIModel 表中获取所有启用的 Provider
    const models = await this.prisma.aIModel.findMany({
      where: { isEnabled: true },
      select: { provider: true },
      distinct: ["provider"],
    });

    // 标准化 Provider 名称
    const providers = new Set<string>();
    for (const model of models) {
      const normalized = this.normalizeProviderName(model.provider);
      providers.add(normalized);
    }

    return Array.from(providers);
  }

  /**
   * 标准化 Provider 名称
   */
  private normalizeProviderName(provider: string): string {
    const lower = provider.toLowerCase();
    if (lower.includes("openai") || lower.includes("gpt")) return "openai";
    if (lower.includes("anthropic") || lower.includes("claude"))
      return "anthropic";
    if (lower.includes("google") || lower.includes("gemini")) return "google";
    if (lower.includes("xai") || lower.includes("grok")) return "xai";
    if (lower.includes("cohere")) return "cohere";
    if (lower.includes("deepseek")) return "deepseek";
    if (lower.includes("groq")) return "groq";
    if (lower.includes("openrouter") || lower.includes("open-router"))
      return "openrouter";
    if (lower.includes("minimax")) return "minimax";
    return lower;
  }

  /**
   * 获取 Provider 的 API Key
   */
  private async getApiKeyForProvider(
    providerName: string,
  ): Promise<string | null> {
    // 从数据库获取该 Provider 的第一个启用模型的 API Key
    const model = await this.prisma.aIModel.findFirst({
      where: {
        isEnabled: true,
        OR: [
          { provider: { contains: providerName, mode: "insensitive" } },
          { modelId: { contains: providerName, mode: "insensitive" } },
        ],
      },
      select: {
        apiKey: true,
        secretKey: true,
      },
    });

    if (!model) return null;

    // 优先使用 Secret Manager
    if (model.secretKey) {
      const secretValue = await this.secretsService.getValueInternal(
        model.secretKey,
      );
      if (secretValue) return secretValue.trim();
    }

    return model.apiKey?.trim() || null;
  }

  /**
   * 从缓存获取配额信息
   */
  private async getCachedQuota(
    providerName: string,
  ): Promise<ProviderQuota | null> {
    const cached = await this.prisma.providerQuotaCache.findUnique({
      where: { provider: providerName.toLowerCase() },
    });

    if (!cached) return null;

    // 转换为 ProviderQuota
    return {
      provider: cached.provider,
      providerDisplayName: this.getProviderDisplayName(cached.provider),
      providerIcon: this.getProviderIcon(cached.provider),
      quotaType: cached.quotaType as QuotaType,
      usage: Number(cached.usage),
      limit: cached.quotaLimit ? Number(cached.quotaLimit) : null,
      remaining: cached.remaining ? Number(cached.remaining) : null,
      usagePercentage: cached.usagePercentage,
      unit: cached.unit as QuotaUnit,
      period: cached.period as QuotaPeriod,
      status: cached.status as QuotaStatus,
      statusMessage: cached.statusMessage || "",
      lastUpdated: cached.lastUpdated,
      dataSource: cached.dataSource as QuotaDataSource,
      consoleUrl:
        cached.consoleUrl || this.getProviderConsoleUrl(cached.provider),
    };
  }

  /**
   * 保存配额到缓存
   */
  private async saveQuotaToCache(
    providerName: string,
    quota: Partial<ProviderQuota>,
    rawData?: unknown,
  ): Promise<void> {
    const normalized = providerName.toLowerCase();

    await this.prisma.providerQuotaCache.upsert({
      where: { provider: normalized },
      create: {
        provider: normalized,
        quotaType: quota.quotaType || QuotaType.TOKENS,
        usage: BigInt(quota.usage || 0),
        quotaLimit: quota.limit ? BigInt(quota.limit) : null,
        remaining: quota.remaining ? BigInt(quota.remaining) : null,
        usagePercentage: quota.usagePercentage ?? null,
        unit: quota.unit || QuotaUnit.TOKENS,
        period: quota.period || QuotaPeriod.MONTHLY,
        status: quota.status || QuotaStatus.UNAVAILABLE,
        statusMessage: quota.statusMessage,
        dataSource: quota.dataSource || QuotaDataSource.UNAVAILABLE,
        consoleUrl: quota.consoleUrl || this.getProviderConsoleUrl(normalized),
        rawData: rawData ? JSON.parse(JSON.stringify(rawData)) : null,
      },
      update: {
        quotaType: quota.quotaType || QuotaType.TOKENS,
        usage: BigInt(quota.usage || 0),
        quotaLimit: quota.limit ? BigInt(quota.limit) : null,
        remaining: quota.remaining ? BigInt(quota.remaining) : null,
        usagePercentage: quota.usagePercentage ?? null,
        unit: quota.unit || QuotaUnit.TOKENS,
        period: quota.period || QuotaPeriod.MONTHLY,
        status: quota.status || QuotaStatus.UNAVAILABLE,
        statusMessage: quota.statusMessage,
        dataSource: quota.dataSource || QuotaDataSource.UNAVAILABLE,
        consoleUrl: quota.consoleUrl || this.getProviderConsoleUrl(normalized),
        rawData: rawData ? JSON.parse(JSON.stringify(rawData)) : null,
      },
    });
  }

  /**
   * 创建不可用状态的配额
   */
  private createUnavailableQuota(providerName: string): ProviderQuota {
    return {
      provider: providerName.toLowerCase(),
      providerDisplayName: this.getProviderDisplayName(providerName),
      providerIcon: this.getProviderIcon(providerName),
      quotaType: QuotaType.TOKENS,
      usage: 0,
      limit: null,
      remaining: null,
      usagePercentage: null,
      unit: QuotaUnit.TOKENS,
      period: QuotaPeriod.MONTHLY,
      status: QuotaStatus.UNAVAILABLE,
      statusMessage: "暂不支持自动配额查询，请前往官方控制台查看",
      lastUpdated: new Date(),
      dataSource: QuotaDataSource.UNAVAILABLE,
      consoleUrl: this.getProviderConsoleUrl(providerName),
    };
  }

  /**
   * 创建错误状态的配额
   */
  private createErrorQuota(
    providerName: string,
    errorMessage: string,
  ): ProviderQuota {
    return {
      provider: providerName.toLowerCase(),
      providerDisplayName: this.getProviderDisplayName(providerName),
      providerIcon: this.getProviderIcon(providerName),
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
      consoleUrl: this.getProviderConsoleUrl(providerName),
    };
  }

  // ==================== 辅助方法 ====================

  private getProviderDisplayName(provider: string): string {
    const names: Record<string, string> = {
      openai: "OpenAI",
      anthropic: "Anthropic (Claude)",
      google: "Google (Gemini)",
      xai: "xAI (Grok)",
      cohere: "Cohere",
      deepseek: "DeepSeek",
      groq: "Groq",
      openrouter: "OpenRouter",
      minimax: "MiniMax",
    };
    return names[provider.toLowerCase()] || provider;
  }

  private getProviderIcon(provider: string): string {
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
      groq: "/icons/ai/groq.svg",
      openrouter: "/icons/ai/openrouter.svg",
      minimax: "/icons/ai/minimax.svg",
    };
    return icons[provider.toLowerCase()] || "/icons/ai/default.svg";
  }

  private getProviderConsoleUrl(provider: string): string {
    const urls: Record<string, string> = {
      openai: "https://platform.openai.com/usage",
      anthropic: "https://console.anthropic.com/settings/usage",
      google: "https://console.cloud.google.com/apis/dashboard",
      xai: "https://console.x.ai/",
      cohere: "https://dashboard.cohere.com/",
      deepseek: "https://platform.deepseek.com/",
      groq: "https://console.groq.com/settings/billing",
      openrouter: "https://openrouter.ai/settings/credits",
      minimax: "https://platform.minimaxi.com/",
    };
    return urls[provider.toLowerCase()] || "";
  }
}
