/**
 * AI Engine - AiChatService LLM Adapter
 * 将 AiChatService 封装为 ISimpleLLMAdapter 接口
 *
 * 用途：
 * - 为 Skills 提供 LLM 调用能力
 * - 复用 AiChatService 已有的 API 调用逻辑
 * - 从数据库获取配置的默认 AI 模型
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AiChatService } from "../chat/ai-chat.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { AIModelType } from "@prisma/client";
import { TaskProfile } from "../types";

/**
 * 简化版 LLM 适配器接口（用于 BaseSkill）
 * 这是 Skills 实际使用的接口，比 ILLMAdapter 更简单
 */
export interface ISimpleLLMAdapter {
  chat(options: {
    messages: Array<{ role: string; content: string }>;
    model?: string;
    /**
     * @deprecated 请使用 taskProfile.creativity 代替直接传 temperature。
     * 直接传 temperature 会绕过项目 AI 调用规范（见 CLAUDE.md AI 开发指南）。
     * 此字段保留仅为兼容历史调用，新代码请勿使用。
     */
    temperature?: number;
    maxTokens?: number;
    taskProfile?: TaskProfile;
    responseFormat?: string;
  }): Promise<{ content: string; tokensUsed?: number }>;
}

/**
 * AiChatService LLM 适配器
 *
 * 将 AiChatService 包装成 ISimpleLLMAdapter 接口，
 * 使 Skills 可以通过标准接口调用 LLM。
 *
 * 模型选择优先级：
 * 1. 调用时指定的 model 参数
 * 2. 数据库中配置的默认 CHAT 模型
 * 3. 环境变量 DEFAULT_AI_MODEL
 *
 * ❌ 不再做硬编码字面量 fallback。拿不到 modelId 时返回空字符串，
 *    调用方 / 下游 resolver 必须显式报错，而不是把一个 DB 里不存在的
 *    名字（如 "gemini"）偷偷传给下游引发"模型未配置"错误。
 */
@Injectable()
export class AiChatLLMAdapter implements ISimpleLLMAdapter {
  private readonly logger = new Logger(AiChatLLMAdapter.name);

  readonly id = "ai-chat";
  readonly name = "AiChatService Adapter";

  // 缓存从数据库获取的默认模型
  private cachedDefaultModel: string | null = null;
  private cacheTime: number = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟缓存

  /** 进行中的 DB 查询 Promise（防并发启动时重复查询） */
  private pendingModelFetch: Promise<string | null> | null = null;

  constructor(
    private readonly aiChatService: AiChatService,
    private readonly configService: ConfigService,
    @Optional() private readonly prisma?: PrismaService,
  ) {
    void this.initializeDefaultModel();
  }

  /**
   * 初始化时获取默认模型
   */
  private async initializeDefaultModel(): Promise<void> {
    try {
      const model = await this.getDefaultModelFromDb();
      if (model) {
        this.logger.log(`AiChatLLMAdapter initialized with DB model: ${model}`);
      } else {
        this.logger.log(
          `AiChatLLMAdapter initialized with fallback model: ${this.getFallbackModel()}`,
        );
      }
    } catch (error) {
      this.logger.warn(`Failed to initialize default model: ${error}`);
    }
  }

  /**
   * 从数据库获取默认 CHAT 模型
   *
   * 并发安全：共享同一个 in-flight Promise，防止启动时多个并发 chat() 调用
   * 各自发起独立 DB 查询。缓存 TTL 为 5 分钟；如需立即刷新调用 clearCache()。
   */
  private getDefaultModelFromDb(): Promise<string | null> {
    if (!this.prisma) {
      return Promise.resolve(null);
    }

    // 缓存命中：直接返回
    const now = Date.now();
    if (this.cachedDefaultModel && now - this.cacheTime < this.CACHE_TTL_MS) {
      return Promise.resolve(this.cachedDefaultModel);
    }

    // 复用进行中的查询 Promise，防止并发时多次 DB round-trip
    if (this.pendingModelFetch) {
      return this.pendingModelFetch;
    }

    this.pendingModelFetch = this._fetchDefaultModelFromDb().finally(() => {
      this.pendingModelFetch = null;
    });
    return this.pendingModelFetch;
  }

  /** 实际执行 DB 查询（仅由 getDefaultModelFromDb 调用） */
  private async _fetchDefaultModelFromDb(): Promise<string | null> {
    const now = Date.now();
    try {
      // 查找系统默认的 CHAT 模型
      const defaultModel = await this.prisma!.aIModel.findFirst({
        where: {
          modelType: AIModelType.CHAT,
          isDefault: true,
          isEnabled: true,
        },
        select: {
          modelId: true,
          displayName: true,
        },
      });

      if (defaultModel) {
        this.cachedDefaultModel = defaultModel.modelId;
        this.cacheTime = now;
        this.logger.debug(
          `[getDefaultModelFromDb] Using model: ${defaultModel.displayName} (${defaultModel.modelId})`,
        );
        return defaultModel.modelId;
      }

      // Fallback: 任意启用的 CHAT 模型
      const anyModel = await this.prisma!.aIModel.findFirst({
        where: {
          modelType: AIModelType.CHAT,
          isEnabled: true,
        },
        select: {
          modelId: true,
          displayName: true,
        },
      });

      if (anyModel) {
        this.cachedDefaultModel = anyModel.modelId;
        this.cacheTime = now;
        this.logger.debug(
          `[getDefaultModelFromDb] Using fallback model: ${anyModel.displayName} (${anyModel.modelId})`,
        );
        return anyModel.modelId;
      }
    } catch (error) {
      this.logger.warn(`Failed to query default model: ${error}`);
    }

    return null;
  }

  /**
   * Fallback modelId — operators only. Empty string signals "no fallback"
   * and force callers up the stack to surface a clear error instead of
   * transparently routing to a hard-coded modelId that may not exist in DB.
   */
  private getFallbackModel(): string {
    return this.configService.get<string>("DEFAULT_AI_MODEL", "");
  }

  /**
   * 获取默认模型
   * 优先级：数据库配置 > 环境变量 > 硬编码
   */
  async getDefaultModel(): Promise<string> {
    const dbModel = await this.getDefaultModelFromDb();
    return dbModel || this.getFallbackModel();
  }

  /**
   * 简化版 chat 方法（实现 ISimpleLLMAdapter）
   * 这是 Skills 通过 callLLM() 实际调用的方法
   */
  async chat(options: {
    messages: Array<{ role: string; content: string }>;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    taskProfile?: TaskProfile;
    responseFormat?: string;
  }): Promise<{ content: string; tokensUsed?: number }> {
    // 模型选择优先级：参数 > 数据库配置 > 环境变量 > 硬编码
    const model = options.model || (await this.getDefaultModel());
    const messages = options.messages.map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    }));

    this.logger.debug(`[chat] Using model: ${model}`);

    try {
      const result = await this.aiChatService.generateChatCompletion({
        model,
        messages,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        taskProfile: options.taskProfile,
        responseFormat: options.responseFormat,
      });

      return {
        content: result.content,
        tokensUsed: result.tokensUsed,
      };
    } catch (error) {
      this.logger.error(`LLM call failed: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * 估算 token 数（CJK 感知）
   * 中文字符约 2 token/字，英文约 1 token/4 字符。
   */
  countTokens(text: string): number {
    if (!text) return 0;
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars * 2 + otherChars / 4);
  }

  /**
   * 清除模型缓存（用于配置更新后立即生效）
   *
   * 缓存 TTL 为 5 分钟，正常情况下无需手动调用。
   * 以下场景需要主动调用：
   * - 管理员在后台更改了默认 AI 模型配置
   * - 单元测试之间需要隔离模型配置
   */
  clearCache(): void {
    this.cachedDefaultModel = null;
    this.cacheTime = 0;
    // 同时取消进行中的查询，确保下次调用发起全新 DB 请求
    this.pendingModelFetch = null;
    this.logger.debug("Model cache cleared");
  }
}
