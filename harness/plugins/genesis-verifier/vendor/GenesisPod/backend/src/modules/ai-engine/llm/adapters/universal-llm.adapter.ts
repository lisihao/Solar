/**
 * AI Engine - Universal LLM Adapter
 * 实现 ILLMAdapter 接口，用于 LLMFactory
 *
 * 这个适配器通过 AiChatService 调用 LLM，支持所有 Provider：
 * - OpenAI (GPT-4o, GPT-4-turbo, etc.)
 * - Google (Gemini Flash, Gemini Pro, etc.)
 * - Anthropic (Claude)
 * - xAI (Grok)
 * - DeepSeek
 *
 * 模型选择从数据库配置读取，支持 Skills 通过 LLMFactory.getAdapter() 获取
 */

import { Injectable, Logger } from "@nestjs/common";
import { AiChatService } from "../chat/ai-chat.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { AiModelConfigService } from "../models/config/ai-model-config.service";
import {
  ILLMAdapter,
  LLMRequestOptions,
  LLMResponse,
  LLMModelConfig,
  LLMStreamChunk,
} from "../abstractions/llm-adapter.interface";

/**
 * 通用 LLM 适配器
 * 实现完整的 ILLMAdapter 接口，供 Skills 使用
 * 支持所有通过管理员在数据库配置的 AI 模型（完全动态，无硬编码）
 */
@Injectable()
export class UniversalLLMAdapter implements ILLMAdapter {
  private readonly logger = new Logger("UniversalLLMAdapter");

  // 使用 "universal" 作为 ID，支持所有 provider
  readonly id = "universal";
  readonly name = "Universal LLM Adapter (Dynamic from Database)";

  // 从数据库动态加载的支持模型列表（缓存）
  private _supportedModels: string[] = [];
  private _defaultModel: string = "";
  private _modelConfigs: Map<string, LLMModelConfig> = new Map();
  private _cacheTime: number = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟缓存
  private refreshPromise: Promise<void> | null = null; // 防止并发刷新

  // ILLMAdapter 接口要求的只读属性（通过 getter 实现动态读取）
  get supportedModels(): string[] {
    // 触发异步刷新（不等待），返回当前缓存
    // 注意：getter 不能是 async，但在实际调用点（如 chat()）会等待刷新
    void this.refreshModelsIfNeeded().catch((err) =>
      this.logger.warn(`Failed to refresh models in getter: ${err}`),
    );
    return this._supportedModels.length > 0 ? this._supportedModels : ["*"]; // 返回 "*" 表示支持所有模型
  }

  get defaultModel(): string {
    // 触发异步刷新（不等待），返回当前缓存
    void this.refreshModelsIfNeeded().catch((err) =>
      this.logger.warn(`Failed to refresh models in getter: ${err}`),
    );
    return this._defaultModel; // 完全从数据库读取，不硬编码任何回退值
  }

  constructor(
    private readonly aiChatService: AiChatService,
    private readonly prisma: PrismaService,
    private readonly aiModelConfig: AiModelConfigService,
  ) {
    void this.initializeFromDatabase();
  }

  /**
   * 从数据库初始化可用模型列表
   */
  private async initializeFromDatabase(): Promise<void> {
    try {
      await this.loadModelsFromDatabase();
      this.logger.log(
        `Universal LLM Adapter initialized with ${this._supportedModels.length} models from database`,
      );
      this.logger.log(`  Default model: ${this._defaultModel}`);
      this.logger.log(
        `  Supported: ${this._supportedModels.slice(0, 5).join(", ")}${this._supportedModels.length > 5 ? "..." : ""}`,
      );
    } catch (error) {
      this.logger.warn(`Failed to initialize from database: ${error}`);
    }
  }

  /**
   * 从数据库加载模型列表和配置（严禁硬编码！）
   */
  private async loadModelsFromDatabase(): Promise<void> {
    // 获取所有启用的 CHAT 类型模型
    const chatModels = await this.prisma.aIModel.findMany({
      where: {
        modelType: "CHAT",
        isEnabled: true,
      },
      select: {
        modelId: true,
        displayName: true,
        isDefault: true,
        maxTokens: true,
        modelType: true,
      },
      orderBy: [{ isDefault: "desc" }, { displayName: "asc" }],
    });

    this._supportedModels = chatModels.map((m) => m.modelId);
    this._cacheTime = Date.now();

    // 缓存模型配置
    this._modelConfigs.clear();
    for (const model of chatModels) {
      this._modelConfigs.set(model.modelId, {
        id: model.modelId,
        name: model.displayName,
        maxTokens: model.maxTokens || 4096,
        contextWindow: 128000,
        supportsTools: true,
        supportsVision: model.modelType === "MULTIMODAL",
        supportsStreaming: true,
      });
    }

    // 找到默认模型
    const defaultModel = chatModels.find((m) => m.isDefault);
    this._defaultModel = defaultModel?.modelId || chatModels[0]?.modelId || "";

    this.logger.debug(
      `[loadModelsFromDatabase] Loaded ${chatModels.length} chat models, default: ${this._defaultModel}`,
    );
  }

  /**
   * 如果缓存过期则刷新模型列表（同步等待，防止返回过期数据）
   */
  private async refreshModelsIfNeeded(): Promise<void> {
    const now = Date.now();
    if (now - this._cacheTime > this.CACHE_TTL_MS) {
      // 如果已有刷新任务在进行，等待其完成
      if (this.refreshPromise) {
        await this.refreshPromise;
        return;
      }

      // 启动刷新任务并等待完成
      this.refreshPromise = this.loadModelsFromDatabase().finally(() => {
        this.refreshPromise = null;
      });

      await this.refreshPromise;
    }
  }

  /**
   * 执行 Chat Completion
   *
   * ★ 统一通过 aiChatService.chat() 调用，支持：
   * - TaskProfile 语义化参数映射
   * - modelType 动态模型选择
   * - 完整的参数解析优先级链
   */
  async chat(options: LLMRequestOptions): Promise<LLMResponse> {
    // 确保缓存是最新的（同步等待刷新完成）
    await this.refreshModelsIfNeeded();

    const model = options.model || (await this.getDefaultModelFromDb());

    this.logger.debug(
      `[chat] Calling with model: ${model}, messages: ${options.messages.length}, taskProfile: ${JSON.stringify(options.taskProfile)}`,
    );

    try {
      // 转换消息格式
      const messages = options.messages.map((m) => ({
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      }));

      // ★ 统一调用 aiChatService.chat()
      // 这是 AI Engine 的统一入口，支持 TaskProfile 语义化参数映射
      const result = await this.aiChatService.chat({
        model,
        messages,
        // ★ 传递 TaskProfile，让 AI Engine 处理参数映射
        taskProfile: options.taskProfile,
        // 直接参数（优先级高于 TaskProfile）
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        responseFormat: options.responseFormat === "json" ? "json" : undefined,
      });

      // 构建响应
      return {
        id: `chatcmpl-${Date.now()}`,
        content: result.content,
        finishReason: "stop",
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: result.usage?.totalTokens || 0,
        },
        model: result.model,
        createdAt: new Date(),
      };
    } catch (error) {
      this.logger.error(`[chat] Failed: ${error}`);
      throw error;
    }
  }

  /**
   * 流式 Chat Completion (可选)
   */
  async *chatStream?(
    options: LLMRequestOptions,
  ): AsyncGenerator<LLMStreamChunk, void> {
    // 暂不实现流式，使用非流式
    const response = await this.chat(options);
    yield {
      id: response.id,
      delta: { content: response.content || "" },
      finishReason: response.finishReason,
      usage: response.usage,
    };
  }

  /**
   * 计算 token 数 (估算)
   */
  countTokens?(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * 检查是否支持指定模型
   * 支持所有主流 AI 模型
   */
  supportsModel(model: string): boolean {
    const lower = model.toLowerCase();
    // ★ 启发式覆盖主流 provider；o-series（o1/o3/o4/o5...）一律 /^o\d/，
    //   不再每次出新型号就改代码。
    return (
      lower.includes("gpt") ||
      /^o\d/.test(lower) || // OpenAI o-series (o1/o3/o4/...)
      lower.includes("gemini") ||
      lower.includes("claude") ||
      lower.includes("grok") ||
      lower.includes("deepseek") ||
      this.supportedModels.includes(model)
    );
  }

  /**
   * 获取模型配置（从缓存读取，缓存由 loadModelsFromDatabase 定期刷新）
   * 严禁硬编码模型配置！所有配置都从数据库动态加载
   */
  async getModelConfig(model: string): Promise<LLMModelConfig | undefined> {
    // 确保缓存是最新的（同步等待刷新完成）
    await this.refreshModelsIfNeeded();

    // 从缓存读取
    const config = this._modelConfigs.get(model);
    if (!config) {
      this.logger.debug(
        `[getModelConfig] Model "${model}" not found in cache, available: ${Array.from(this._modelConfigs.keys()).join(", ")}`,
      );
    }
    return config;
  }

  /**
   * 从数据库获取默认模型
   *
   * 2026-05-12 严格 BYOK 单源：走 pickBYOKModelForUser
   *   - 有 userId → 用户 BYOK 配置的 CHAT 模型；用户没配 → 返回 fallback
   *   - 无 userId（cron / 适配器初始化）→ admin AIModel 兜底
   */
  private async getDefaultModelFromDb(): Promise<string> {
    try {
      const picked = await this.aiModelConfig.pickBYOKModelForUser("CHAT");
      if (picked) return picked.modelId;
      return this.defaultModel;
    } catch (error) {
      this.logger.warn(`Failed to get default model from DB: ${error}`);
      return this.defaultModel;
    }
  }
}
