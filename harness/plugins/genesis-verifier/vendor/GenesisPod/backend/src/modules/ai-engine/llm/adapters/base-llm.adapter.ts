/**
 * AI Engine - Base LLM Adapter
 * LLM 适配器基类
 */

import { Logger } from "@nestjs/common";
import {
  ILLMAdapter,
  LLMRequestOptions,
  LLMResponse,
  LLMStreamChunk,
  LLMModelConfig,
} from "../abstractions/llm-adapter.interface";

/**
 * LLM 适配器基类
 */
export abstract class BaseLLMAdapter implements ILLMAdapter {
  /**
   * 适配器 ID
   */
  abstract readonly id: string;

  /**
   * 适配器名称
   */
  abstract readonly name: string;

  /**
   * 支持的模型
   */
  abstract readonly supportedModels: string[];

  /**
   * 默认模型
   */
  abstract readonly defaultModel: string;

  /**
   * 模型配置映射
   */
  protected abstract readonly modelConfigs: Map<string, LLMModelConfig>;

  /**
   * 日志记录器
   */
  protected readonly logger: Logger;

  /**
   * 请求统计
   */
  private stats = {
    totalRequests: 0,
    successCount: 0,
    failureCount: 0,
    totalTokensUsed: 0,
  };

  constructor() {
    this.logger = new Logger(this.constructor.name);
  }

  /**
   * 聊天完成（子类实现）
   */
  abstract chat(options: LLMRequestOptions): Promise<LLMResponse>;

  /**
   * 流式聊天完成（子类可选实现）
   */
  async *chatStream?(
    _options: LLMRequestOptions,
  ): AsyncGenerator<LLMStreamChunk, void> {
    // 默认实现：不支持流式
    throw new Error("Streaming not supported by this adapter");
  }

  /**
   * 检查模型是否支持
   */
  supportsModel(model: string): boolean {
    return this.supportedModels.includes(model);
  }

  /**
   * 获取模型配置
   */
  getModelConfig(model: string): LLMModelConfig | undefined {
    return this.modelConfigs.get(model);
  }

  /**
   * 计算 token 数（简单估算）
   */
  countTokens(text: string): number {
    // 简单估算：中文每字约 2 token，英文每 4 字符约 1 token
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars * 2 + otherChars / 4);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * 记录请求成功
   */
  protected recordSuccess(tokensUsed?: number): void {
    this.stats.totalRequests++;
    this.stats.successCount++;
    if (tokensUsed) {
      this.stats.totalTokensUsed += tokensUsed;
    }
  }

  /**
   * 记录请求失败
   */
  protected recordFailure(): void {
    this.stats.totalRequests++;
    this.stats.failureCount++;
  }

  /**
   * 处理请求选项
   */
  protected processOptions(options: LLMRequestOptions): LLMRequestOptions {
    return {
      ...options,
      model: options.model || this.defaultModel,
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 4096,
    };
  }
}

/**
 * 创建简单 LLM 适配器的工厂函数
 */
export function createLLMAdapter(options: {
  id: string;
  name: string;
  supportedModels: string[];
  defaultModel: string;
  chat: (options: LLMRequestOptions) => Promise<LLMResponse>;
}): ILLMAdapter {
  return {
    id: options.id,
    name: options.name,
    supportedModels: options.supportedModels,
    defaultModel: options.defaultModel,
    chat: options.chat,
    supportsModel: (model: string) => options.supportedModels.includes(model),
    getModelConfig: () => undefined,
  };
}
