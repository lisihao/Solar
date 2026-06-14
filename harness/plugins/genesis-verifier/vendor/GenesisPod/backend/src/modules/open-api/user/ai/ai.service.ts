import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { ChatFacade } from "../../../ai-harness/facade";
import { AiModelConfigService } from "../../../ai-engine/facade";
import { AIModelType } from "@prisma/client";

/**
 * AI Core Service
 * ★ 职责：提供 Controller 层需要的业务逻辑
 * ★ 原则：所有模型查询委托给 AiModelConfigService，不直接访问数据库
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService, // 仅用于非模型相关的查询（如 Topic）
    private readonly aiFacade: ChatFacade,
    private readonly modelConfigService: AiModelConfigService,
  ) {}

  /**
   * 获取已启用的 AI 模型列表（公共 API）
   * ★ 委托给 AiModelConfigService
   */
  async getEnabledModels(userId?: string) {
    return this.modelConfigService.getEnabledModelsForFrontend(
      undefined,
      userId,
    );
  }

  /**
   * 翻译文本
   * ★ 使用 AIFacade.chat()
   */
  async translateText(
    text: string,
    sourceLang: string,
    targetLang: string,
  ): Promise<string> {
    this.logger.log(`Translating text from ${sourceLang} to ${targetLang}`);

    try {
      // ★ 使用 AIFacade 获取 CHAT_FAST tier 模型
      const fastModel = await this.aiFacade.getDefaultModelByType(
        AIModelType.CHAT_FAST,
      );
      const modelConfig =
        fastModel || (await this.aiFacade.getDefaultTextModel());

      if (!modelConfig) {
        throw new ServiceUnavailableException(
          "No AI model available for translation",
        );
      }

      this.logger.log(
        `[Translation] Using model: ${modelConfig.displayName} (${modelConfig.modelId}) - Tier: CHAT_FAST`,
      );

      const targetLangName = this.getLanguageName(targetLang);
      const prompt = `Translate the following text to ${targetLangName}. Only output the translated text, nothing else:\n\n${text}`;

      // Calculate dynamic maxTokens based on input length
      const estimatedTokens = Math.ceil(text.length / 3);
      const dynamicMaxTokens = Math.max(2000, estimatedTokens * 2);

      this.logger.log(
        `[Translation] Text length: ${text.length}, estimated tokens: ${estimatedTokens}, using maxTokens: ${dynamicMaxTokens}`,
      );

      // ★ 使用 AIFacade.chat()
      const result = await this.aiFacade.chat({
        messages: [{ role: "user", content: prompt }],
        model: modelConfig.modelId,
        maxTokens: dynamicMaxTokens, // Keep: dynamically calculated based on input length
        taskProfile: {
          creativity: "low",
          outputLength: "medium",
        },
      });

      return result.content;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Translation error: ${errorMessage}`);

      throw new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: "Translation service is currently unavailable",
          error: "SERVICE_UNAVAILABLE",
          originalText: text,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private getLanguageName(code: string): string {
    const langMap: Record<string, string> = {
      en: "English",
      "zh-CN": "Simplified Chinese",
      zh: "Chinese",
      ja: "Japanese",
      ko: "Korean",
      fr: "French",
      de: "German",
      es: "Spanish",
      it: "Italian",
      pt: "Portuguese",
      ru: "Russian",
    };
    return langMap[code] || code;
  }

  /**
   * 获取所有 AI 模型（诊断用）
   * ★ 委托给 AiModelConfigService
   */
  async getAllModels() {
    return this.modelConfigService.getAllModelsForDiagnostics();
  }

  /**
   * 获取 Google/Gemini 模型列表
   * ★ 委托给 AiModelConfigService
   */
  async getGoogleModels() {
    return this.modelConfigService.getModelsByProvider("gemini");
  }

  /**
   * 获取第一个可用的 Google 模型（带 API Key）
   * ★ 委托给 AiModelConfigService
   */
  async getFirstGoogleModelWithKey() {
    return this.modelConfigService.getFirstModelByProvider("gemini");
  }

  /**
   * 获取 Topic 的 AI 成员配置
   * ★ 这是 Topic 相关的查询，不是模型查询，保留直接访问
   */
  async getTopicWithAIMembers(topicId: string) {
    return this.prisma.topic.findUnique({
      where: { id: topicId },
      include: {
        aiMembers: true,
      },
    });
  }

  /**
   * 根据 modelId 查找启用的 AI 模型
   * ★ 委托给 AiModelConfigService
   */
  async findModelByModelId(modelId: string) {
    return this.modelConfigService.getModelById(modelId);
  }

  /**
   * 根据 name 查找启用的 AI 模型
   * ★ 委托给 AiModelConfigService
   */
  async findModelByName(name: string) {
    return this.modelConfigService.getModelById(name);
  }
}
