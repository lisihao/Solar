/**
 * AI Engine - LLM Factory
 * LLM 适配器工厂
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  ILLMAdapter,
  LLM_PROVIDERS,
  LLMProvider,
  LLMModel,
} from "../abstractions/llm-adapter.interface";

/**
 * LLM 工厂配置
 */
export interface LLMFactoryConfig {
  /**
   * 默认提供商
   */
  defaultProvider?: LLMProvider;

  /**
   * 默认模型
   */
  defaultModel?: LLMModel;

  /**
   * 提供商配置
   */
  providers?: Record<LLMProvider, ProviderConfig>;
}

/**
 * 提供商配置
 */
export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  enabled?: boolean;
  models?: string[];
}

/**
 * LLM 适配器工厂
 * 管理和创建 LLM 适配器实例
 */
@Injectable()
export class LLMFactory {
  private readonly logger = new Logger(LLMFactory.name);
  private readonly adapters = new Map<string, ILLMAdapter>();
  private readonly providerConfigs = new Map<LLMProvider, ProviderConfig>();
  private defaultProvider: LLMProvider = LLM_PROVIDERS.OPENAI;
  private _defaultModel: LLMModel | null = null; // 从数据库动态获取，严禁硬编码

  constructor() {}

  /**
   * 初始化工厂
   */
  initialize(config: LLMFactoryConfig): void {
    if (config.defaultProvider) {
      this.defaultProvider = config.defaultProvider;
    }
    if (config.defaultModel) {
      this._defaultModel = config.defaultModel;
    }
    if (config.providers) {
      for (const [provider, providerConfig] of Object.entries(
        config.providers,
      )) {
        this.providerConfigs.set(provider as LLMProvider, providerConfig);
      }
    }
  }

  /**
   * 注册适配器
   */
  registerAdapter(adapter: ILLMAdapter): void {
    this.adapters.set(adapter.id, adapter);
    this.logger.log(`Registered LLM adapter: ${adapter.id}`);
  }

  /**
   * 获取适配器
   * 如果指定了 providerId，返回对应适配器
   * 否则尝试默认 provider，如果没有则返回第一个可用适配器
   */
  getAdapter(providerId?: string): ILLMAdapter | undefined {
    // 1. 如果指定了 providerId，直接查找
    if (providerId) {
      return this.adapters.get(providerId);
    }

    // 2. 尝试默认 provider
    const defaultAdapter = this.adapters.get(this.defaultProvider);
    if (defaultAdapter) {
      return defaultAdapter;
    }

    // 3. 如果默认 provider 不可用，返回第一个可用的适配器
    // 这对于使用 UniversalLLMAdapter 的场景非常重要
    const firstAdapter = this.adapters.values().next().value;
    if (firstAdapter) {
      this.logger.debug(
        `Default provider "${this.defaultProvider}" not found, using "${firstAdapter.id}"`,
      );
      return firstAdapter;
    }

    this.logger.warn(`No LLM adapter available`);
    return undefined;
  }

  /**
   * 获取支持特定模型的适配器
   */
  getAdapterForModel(model: string): ILLMAdapter | undefined {
    for (const adapter of this.adapters.values()) {
      if (adapter.supportsModel(model)) {
        return adapter;
      }
    }
    return undefined;
  }

  /**
   * 获取所有已注册的适配器
   */
  getAllAdapters(): ILLMAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * 获取所有支持的模型
   */
  getSupportedModels(): string[] {
    const models: string[] = [];
    for (const adapter of this.adapters.values()) {
      models.push(...adapter.supportedModels);
    }
    return [...new Set(models)];
  }

  /**
   * 获取默认模型
   * 优先从配置获取，然后从适配器获取，严禁硬编码
   */
  getDefaultModel(): LLMModel {
    // 如果已配置默认模型，直接返回
    if (this._defaultModel) {
      return this._defaultModel;
    }

    // 尝试从已注册的适配器获取默认模型
    const adapter = this.getAdapter();
    if (adapter?.defaultModel) {
      return adapter.defaultModel;
    }

    // 严禁硬编码！如果没有配置模型，抛出错误
    throw new Error(
      "No default AI model configured. Please configure a model in Admin Console or call initialize() with defaultModel.",
    );
  }

  /**
   * 设置默认模型
   */
  setDefaultModel(model: LLMModel): void {
    this._defaultModel = model;
  }

  /**
   * 获取提供商配置
   */
  getProviderConfig(provider: LLMProvider): ProviderConfig | undefined {
    return this.providerConfigs.get(provider);
  }

  /**
   * 检查提供商是否可用
   */
  isProviderAvailable(provider: LLMProvider): boolean {
    const config = this.providerConfigs.get(provider);
    if (!config) return false;
    return config.enabled !== false && !!config.apiKey;
  }

  /**
   * 获取可用提供商列表
   */
  getAvailableProviders(): LLMProvider[] {
    const available: LLMProvider[] = [];
    for (const provider of Object.values(LLM_PROVIDERS)) {
      if (this.isProviderAvailable(provider)) {
        available.push(provider);
      }
    }
    return available;
  }
}
