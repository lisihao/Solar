import {
  Controller,
  Get,
  Post,
  Body,
  Res,
  Param,
  Req,
  BadRequestException,
  HttpException,
  Logger,
  Optional,
  NotFoundException,
  UseGuards,
} from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { Response, Request } from "express";
import { AiService } from "./ai.service";
import { ChatFacade } from "../../../ai-harness/facade";
import { RAGPipelineService, SearchService } from "@/modules/ai-engine/facade";
import { SecretsService, BillingContext } from "../../../platform/facade";
import { ApiTags } from "@nestjs/swagger";
import { OptionalJwtAuthGuard } from "../../../../common/guards/optional-jwt-auth.guard";
import { Public } from "../../../../common/decorators/public.decorator";
import { RequestContext } from "../../../../common/context/request-context";

interface TranslateSingleRequest {
  text: string;
  targetLang?: string;
  sourceLang?: string;
}

interface SimpleChatRequest {
  message: string;
  messages?: { role: "user" | "assistant" | "system"; content: string }[]; // Multi-turn context
  context?: string;
  model?: string;
  stream?: boolean;
  knowledgeBaseIds?: string[]; // RAG knowledge base IDs
  webSearch?: boolean; // Enable web search for real-time information
}

interface QuickActionRequest {
  content: string;
  action: "summary" | "insights" | "methodology";
  model?: string;
}

interface SummaryRequest {
  content: string;
  max_length?: number;
  language?: string;
}

interface InsightsRequest {
  content: string;
  language?: string;
}

@ApiTags("AI Core")
@Controller("ai")
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(
    private readonly aiCoreService: AiService,
    private readonly aiFacade: ChatFacade,
    private readonly configService: ConfigService,
    private readonly ragPipelineService: RAGPipelineService,
    @Optional() private readonly secretsService?: SecretsService,
    @Optional() private readonly searchService?: SearchService,
  ) {}

  /**
   * 获取已启用的 AI 模型列表（公共 API，无需认证）
   * GET /api/v1/ai/models
   */
  @Get("models")
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  async getEnabledModels(@Req() req: Request) {
    const userId = (req as unknown as { user?: { id?: string } }).user?.id;
    this.logger.log(
      `Fetching enabled AI models${userId ? ` for user ${userId}` : ""}`,
    );
    return this.aiCoreService.getEnabledModels(userId);
  }

  /**
   * 诊断 AI 模型配置（公共 API，用于调试）
   * GET /api/v1/ai/diagnose
   */
  @Get("diagnose")
  async diagnoseModels() {
    this.logger.log("Diagnosing AI model configuration");

    // Get all models from database
    const allModels = await this.aiCoreService.getAllModels();

    // Check environment variables
    const envVars = {
      GOOGLE_AI_API_KEY: !!this.configService.get<string>("GOOGLE_AI_API_KEY"),
      OPENAI_API_KEY: !!this.configService.get<string>("OPENAI_API_KEY"),
      ANTHROPIC_API_KEY: !!this.configService.get<string>("ANTHROPIC_API_KEY"),
      DEEPSEEK_API_KEY: !!this.configService.get<string>("DEEPSEEK_API_KEY"),
    };

    // Build diagnosis report
    // ★ 使用 AiModelConfigService 返回的安全格式（不暴露 API Key 明文）
    const modelsReport = allModels.map((m) => ({
      id: m.id,
      name: m.name,
      modelId: m.modelId,
      provider: m.provider,
      modelType: m.modelType,
      isEnabled: m.isEnabled,
      isDefault: m.isDefault,
      hasApiKey: m.hasApiKey,
      hasSecretKey: m.hasSecretKey,
      hasApiEndpoint: !!m.apiEndpoint,
    }));

    return {
      timestamp: new Date().toISOString(),
      totalModels: allModels.length,
      enabledModels: allModels.filter((m) => m.isEnabled).length,
      modelsWithApiKey: allModels.filter((m) => m.hasApiKey).length,
      modelsWithSecretKey: allModels.filter((m) => m.hasSecretKey).length,
      environmentVariables: envVars,
      models: modelsReport,
      recommendation:
        modelsReport.filter((m) => m.isEnabled && m.hasApiKey).length === 0
          ? "No enabled models have API keys configured. Please add API keys to your models in the admin panel."
          : "Configuration looks OK. Check if the modelId matches exactly.",
    };
  }

  /**
   * 测试 Gemini 模型图片生成能力（公共 API）
   * GET /api/v1/ai/test-gemini-image
   */
  @Get("test-gemini-image")
  async testGeminiImageGeneration() {
    this.logger.log("Testing Gemini image generation models");

    // Get all Google/Gemini models
    const geminiModels = await this.aiCoreService.getGoogleModels();

    if (geminiModels.length === 0) {
      throw new NotFoundException(
        "No Gemini models found in database. Add a Gemini model in the admin panel with provider=google",
      );
    }

    const results: Array<{
      modelId: string;
      name: string;
      status: string;
      error?: string;
      supportsImage?: boolean;
      responseType?: string;
      textPreview?: string | null;
    }> = [];

    for (const model of geminiModels) {
      // ★ 从 Secret Manager 获取 API Key（不回退到明文 apiKey）
      let apiKey: string | null = null;
      if (model.secretKey && this.secretsService) {
        const secretValue = await this.secretsService.getValueInternal(
          model.secretKey,
        );
        if (secretValue) {
          apiKey = secretValue.trim();
        }
      }
      if (!apiKey) {
        apiKey = this.configService.get<string>("GOOGLE_AI_API_KEY") || null;
      }

      if (!apiKey) {
        results.push({
          modelId: model.modelId,
          name: model.name,
          status: "NO_API_KEY",
          error: "No API key configured for this model",
        });
        continue;
      }

      try {
        // Test with image generation request
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.modelId}:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: "Generate a simple red circle image" }],
              },
            ],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
              maxOutputTokens: 256,
            },
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          results.push({
            modelId: model.modelId,
            name: model.name,
            status: "API_ERROR",
            error: data.error?.message || `HTTP ${response.status}`,
            supportsImage: false,
          });
          continue;
        }

        // Check if response contains image
        const parts = data.candidates?.[0]?.content?.parts || [];
        const hasImage = parts.some((p: unknown) =>
          (
            p as { inlineData?: { mimeType?: string } }
          ).inlineData?.mimeType?.startsWith("image/"),
        );
        const hasText = parts.some(
          (p: unknown) => !!(p as { text?: string }).text,
        );

        results.push({
          modelId: model.modelId,
          name: model.name,
          status: "SUCCESS",
          supportsImage: hasImage,
          responseType: hasImage ? "image" : hasText ? "text-only" : "empty",
          textPreview: hasText
            ? (
                parts.find((p: unknown) => !!(p as { text?: string }).text) as
                  | { text?: string }
                  | undefined
              )?.text?.substring(0, 100)
            : null,
        });
      } catch (error: unknown) {
        results.push({
          modelId: model.modelId,
          name: model.name,
          status: "FETCH_ERROR",
          error: error instanceof Error ? error.message : String(error),
          supportsImage: false,
        });
      }
    }

    const imageModels = results.filter((r) => r.supportsImage);

    return {
      timestamp: new Date().toISOString(),
      totalTested: results.length,
      modelsWithImageSupport: imageModels.length,
      results,
      recommendation:
        imageModels.length > 0
          ? `Use one of these models for image generation: ${imageModels.map((r) => r.modelId).join(", ")}`
          : "No models support image generation. Try using gemini-2.0-flash-exp or imagen-3 models.",
    };
  }

  /**
   * 列出 Google AI 可用模型（公共 API）
   * GET /api/v1/ai/list-google-models
   */
  @Get("list-google-models")
  async listGoogleModels() {
    this.logger.log("Listing available Google AI models");

    // Try to get API key from database or environment
    // ★ 支持 secretKey 或 apiKey
    const googleModel = await this.aiCoreService.getFirstGoogleModelWithKey();

    // ★ 优先从 Secret Manager 获取 API Key
    let apiKey: string | null = null;
    if (googleModel?.secretKey && this.secretsService) {
      const secretValue = await this.secretsService.getValueInternal(
        googleModel.secretKey,
      );
      if (secretValue) {
        apiKey = secretValue.trim();
      }
    }
    // 回退到直接存储的 apiKey 或环境变量
    if (!apiKey) {
      apiKey =
        googleModel?.apiKey?.trim() ||
        this.configService.get<string>("GOOGLE_AI_API_KEY") ||
        null;
    }

    if (!apiKey) {
      throw new BadRequestException(
        "No Google AI API key found. Configure GOOGLE_AI_API_KEY environment variable or add a Google model with API key in admin panel",
      );
    }

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      );

      if (!response.ok) {
        const error = await response.json();
        const errorMessage = error.error?.message || `HTTP ${response.status}`;
        throw new BadRequestException(
          `Google AI API error: ${errorMessage} (API key prefix: ${apiKey.substring(0, 10)}...)`,
        );
      }

      const data = await response.json();
      const models = data.models || [];

      // Filter and categorize models
      const imageModels = models.filter(
        (m: unknown) =>
          (
            m as { name?: string; supportedGenerationMethods?: string[] }
          ).name?.includes("imagen") ||
          (
            m as { name?: string; supportedGenerationMethods?: string[] }
          ).supportedGenerationMethods?.includes("generateImage"),
      );

      const geminiModels = models.filter((m: unknown) =>
        (m as { name?: string }).name?.includes("gemini"),
      );

      const modelsWithImageGen = models.filter((m: unknown) =>
        (
          m as { supportedGenerationMethods?: string[] }
        ).supportedGenerationMethods?.includes("generateContent"),
      );

      return {
        timestamp: new Date().toISOString(),
        totalModels: models.length,
        apiKeyPrefix: apiKey.substring(0, 10) + "...",
        imageModels: imageModels.map((m: unknown) => ({
          name: (m as { name?: string }).name,
          displayName: (m as { displayName?: string }).displayName,
          methods: (m as { supportedGenerationMethods?: string[] })
            .supportedGenerationMethods,
        })),
        geminiModels: geminiModels.map((m: unknown) => ({
          name: (m as { name?: string }).name?.replace("models/", ""),
          displayName: (m as { displayName?: string }).displayName,
          methods: (m as { supportedGenerationMethods?: string[] })
            .supportedGenerationMethods,
        })),
        modelsWithImageGeneration: modelsWithImageGen
          .filter(
            (m: unknown) =>
              (m as { name?: string }).name?.includes("2.0") ||
              (m as { name?: string }).name?.includes("2.5") ||
              (m as { name?: string }).name?.includes("imagen"),
          )
          .map((m: unknown) => ({
            name: (m as { name?: string }).name?.replace("models/", ""),
            displayName: (m as { displayName?: string }).displayName,
          })),
        recommendation:
          "For image generation, use gemini-2.0-flash-exp or imagen-3.0-generate-001",
      };
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException(
        `Failed to fetch Google models: ${error instanceof Error ? error.message : String(error)} (API key prefix: ${apiKey.substring(0, 10)}...)`,
      );
    }
  }

  /**
   * 检查 Topic 的 AI 成员配置（公共 API，用于调试）
   * GET /api/v1/ai/check-topic-ai/:topicId
   */
  @Get("check-topic-ai/:topicId")
  async checkTopicAI(@Param("topicId") topicId: string) {
    this.logger.log(`Checking AI members for topic ${topicId}`);

    const topic = await this.aiCoreService.getTopicWithAIMembers(topicId);

    if (!topic) {
      throw new NotFoundException(`Topic not found: ${topicId}`);
    }

    // Check each AI member's model lookup
    const results: Array<{
      aiMemberId: string;
      displayName: string;
      storedAiModel: string;
      foundByModelId: {
        id: string;
        name: string;
        modelId: string;
        hasApiKey: boolean;
      } | null;
      foundByName: {
        id: string;
        name: string;
        modelId: string;
        hasApiKey: boolean;
      } | null;
      willWork: boolean;
      problem: string | null;
    }> = [];
    for (const ai of topic.aiMembers) {
      // Try to find by modelId
      const byModelId = await this.aiCoreService.findModelByModelId(ai.aiModel);

      // Try to find by name
      const byName = await this.aiCoreService.findModelByName(ai.aiModel);

      results.push({
        aiMemberId: ai.id,
        displayName: ai.displayName,
        storedAiModel: ai.aiModel,
        foundByModelId: byModelId
          ? {
              id: byModelId.id,
              name: byModelId.name,
              modelId: byModelId.modelId,
              hasApiKey: !!byModelId.apiKey,
            }
          : null,
        foundByName: byName
          ? {
              id: byName.id,
              name: byName.name,
              modelId: byName.modelId,
              hasApiKey: !!byName.apiKey,
            }
          : null,
        willWork: !!(byModelId?.apiKey || byName?.apiKey),
        problem:
          !byModelId && !byName
            ? "Model not found in database"
            : !(byModelId?.apiKey || byName?.apiKey)
              ? "Model found but no API key"
              : null,
      });
    }

    return {
      topicId,
      topicName: topic.name,
      aiMemberCount: topic.aiMembers.length,
      results,
      recommendation: results.some((r) => !r.willWork)
        ? "Some AI members won't work. Re-add them from the settings to use the correct modelId."
        : "All AI members configured correctly.",
    };
  }

  /**
   * 简单聊天接口（支持流式响应）
   * POST /api/v1/ai/simple-chat
   */
  @Post("simple-chat")
  @UseGuards(OptionalJwtAuthGuard)
  async simpleChat(
    @Body() body: SimpleChatRequest,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    const {
      message,
      messages: contextMessages,
      context,
      model = "",
      stream = true,
      knowledgeBaseIds,
      webSearch = false,
    } = body;

    this.logger.log(
      `Simple chat request: model=${model}, stream=${stream}, message_len=${message?.length || 0}, context_messages=${contextMessages?.length || 0}, kbIds=${knowledgeBaseIds?.join(",") || "none"}, webSearch=${webSearch}`,
    );

    // Log RAG service availability (use log level to ensure visibility in production)
    this.logger.log(
      `[simple-chat] RAG service available: ${!!this.ragPipelineService}, KB IDs provided: ${knowledgeBaseIds?.length || 0}`,
    );

    if (!message || message.trim().length === 0) {
      throw new BadRequestException("Message is required");
    }

    if (message.length > 50000) {
      throw new BadRequestException(
        "Message exceeds maximum length (50000 characters)",
      );
    }

    // Wrap in BillingContext for correct credit tracking
    const userId =
      (req as unknown as { user?: { id?: string } }).user?.id ||
      RequestContext.getUserId();
    const operationType = knowledgeBaseIds?.length ? "rag-chat" : "chat";

    const executeChat = async () => {
      try {
        // RAG: Query knowledge bases if IDs are provided
        let ragContext = "";
        let ragSources: Array<{
          documentTitle: string;
          excerpt: string;
          score: number;
        }> = [];

        // Check why RAG might not run
        if (knowledgeBaseIds && knowledgeBaseIds.length > 0) {
          if (!this.ragPipelineService) {
            this.logger.warn(
              `[simple-chat] RAG pipeline service not available! KB IDs were provided but RAG won't run.`,
            );
          }
        }

        if (
          knowledgeBaseIds &&
          knowledgeBaseIds.length > 0 &&
          this.ragPipelineService
        ) {
          try {
            this.logger.log(
              `[simple-chat] Performing RAG query for KBs: ${knowledgeBaseIds.join(", ")}`,
            );
            const ragResponse = await this.ragPipelineService.query({
              query: message,
              knowledgeBaseIds,
              options: {
                topK: 5,
                useHyde: false,
                useRerank: false,
                // When useRerank=false, scores are RRF scores (max ~0.016)
                // So we need a much lower threshold than when using rerank scores (0-1)
                minScore: 0.001,
              },
            });

            // Debug: Log full RAG response
            this.logger.log(
              `[simple-chat] RAG response: hasContext=${!!ragResponse.context}, sourcesCount=${ragResponse.context?.sources?.length || 0}, contextTextLength=${ragResponse.context?.text?.length || 0}`,
            );

            if (ragResponse.context && ragResponse.context.sources.length > 0) {
              ragContext = ragResponse.context.text;
              ragSources = ragResponse.context.sources.map((s) => ({
                documentTitle: s.documentTitle,
                excerpt: s.excerpt,
                score: s.score,
              }));
              this.logger.log(
                `[simple-chat] RAG context added (${ragResponse.context.sources.length} sources): ${ragSources.map((s) => s.documentTitle).join(", ")}`,
              );
            } else {
              this.logger.log(
                `[simple-chat] RAG query returned no results above threshold`,
              );
            }
          } catch (ragError) {
            this.logger.warn(`[simple-chat] RAG query failed: ${ragError}`);
            // RAG failure should not block the normal response
          }
        }

        // Web Search: Search for real-time information if enabled
        let webSearchContext = "";
        let webSearchSources: Array<{ title: string; url: string }> = [];

        if (webSearch && this.searchService) {
          try {
            this.logger.log(
              `[simple-chat] Performing web search for: "${message.substring(0, 100)}..."`,
            );
            const searchResponse = await this.searchService.search(message, 5);

            if (searchResponse.success && searchResponse.results.length > 0) {
              webSearchContext = this.searchService.formatResultsForContext(
                searchResponse.results,
              );
              webSearchSources = searchResponse.results.map((r) => ({
                title: r.title,
                url: r.url,
              }));
              this.logger.log(
                `[simple-chat] Web search returned ${searchResponse.results.length} results (provider: ${searchResponse.provider})`,
              );
            } else {
              this.logger.log(`[simple-chat] Web search returned no results`);
            }
          } catch (searchError) {
            this.logger.warn(`[simple-chat] Web search failed: ${searchError}`);
            // Web search failure should not block the normal response
          }
        } else if (webSearch && !this.searchService) {
          this.logger.warn(
            `[simple-chat] Web search requested but SearchService not available`,
          );
        }

        // ★ 使用 AIFacade 统一获取模型（与 AI Ask 一致）
        let targetModelId = model;
        const facadeModel = await this.aiFacade.getModelById(model);

        if (!facadeModel) {
          // Fallback to default CHAT model
          const defaultModel = await this.aiFacade.getDefaultTextModel();
          if (!defaultModel) {
            this.logger.warn(
              `Model ${model} not found and no default available`,
            );
            throw new BadRequestException(`Model ${model} is not available`);
          }
          this.logger.warn(
            `[simple-chat] Model "${model}" not found, using default: ${defaultModel.modelId}`,
          );
          targetModelId = defaultModel.modelId;
        } else {
          targetModelId = facadeModel.modelId;
        }

        this.logger.log(
          `[simple-chat] Using model: ${targetModelId} (provider: ${facadeModel?.provider || "default"})`,
        );

        // Build messages array - support multi-turn context
        let chatMessages: {
          role: "user" | "assistant" | "system";
          content: string;
        }[];

        if (contextMessages && contextMessages.length > 0) {
          // Use provided messages array (already includes current message)
          chatMessages = contextMessages;
        } else if (context) {
          // Legacy context string support
          chatMessages = [
            {
              role: "user",
              content: `Context:\n${context}\n\nUser Question:\n${message}`,
            },
          ];
        } else {
          // Single message
          chatMessages = [{ role: "user", content: message }];
        }

        // Add RAG context as system message if available
        if (ragContext && ragSources.length > 0) {
          chatMessages = [
            {
              role: "system",
              content: `你是一个基于知识库回答问题的助手。以下是从用户知识库中检索到的相关内容。

## 知识库参考内容
${ragContext}

## 回答要求
1. 优先使用知识库中的内容来回答问题
2. 如果使用了知识库内容，请在回答中明确提及来源（如"根据文档XXX..."）
3. 如果知识库内容不足以回答问题，可以结合通用知识补充，但要说明
4. 保持回答准确、专业、有帮助`,
            },
            ...chatMessages,
          ];
        }

        // Add Web Search context as system message if available
        if (webSearchContext && webSearchSources.length > 0) {
          const currentDate = new Date().toLocaleDateString("zh-CN", {
            year: "numeric",
            month: "long",
            day: "numeric",
            weekday: "long",
          });
          chatMessages = [
            {
              role: "system",
              content: `你是一个能够访问最新网络信息的AI助手。

## 重要提示
今天的日期是：${currentDate}
以下是通过网络搜索获取的最新信息，请优先使用这些信息来回答用户的问题。

${webSearchContext}

## 回答要求
1. 优先使用搜索结果中的最新信息来回答问题
2. 如果引用了搜索结果，请说明信息来源
3. 对于时间敏感的问题（如"今天是几号"），请使用上面提供的当前日期
4. 保持回答准确、及时、有帮助`,
            },
            ...chatMessages,
          ];
        }

        if (stream) {
          // Set up SSE headers
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");
          res.flushHeaders();

          // ★ 使用 AIFacade.chat()，它会自动处理模型查找和 API Key
          try {
            const result = await this.aiFacade.chat({
              messages: chatMessages,
              model: targetModelId,
              taskProfile: {
                creativity: "medium",
                outputLength: "medium",
              },
            });

            // Send as SSE chunks
            const chunkSize = 50;
            const content = result.content;
            for (let i = 0; i < content.length; i += chunkSize) {
              const chunk = content.slice(i, i + chunkSize);
              res.write(
                `data: ${JSON.stringify({ content: chunk, model: result.model })}\n\n`,
              );
            }
            // Send RAG sources if available
            if (ragSources.length > 0) {
              res.write(
                `data: ${JSON.stringify({ ragSources, usedKnowledgeBase: true })}\n\n`,
              );
            }
            // Send web search sources if available
            if (webSearchSources.length > 0) {
              res.write(
                `data: ${JSON.stringify({ webSearchSources, usedWebSearch: true })}\n\n`,
              );
            }
            res.write("data: [DONE]\n\n");
            res.end();
          } catch (error) {
            this.logger.error(`Stream chat error: ${error}`);
            const safeMsg =
              error instanceof Error && error.message.includes("timeout")
                ? "Request timed out"
                : "Failed to generate response";
            res.write(`data: ${JSON.stringify({ error: safeMsg })}\n\n`);
            res.end();
          }
        } else {
          // ★ 使用 AIFacade.chat()，它会自动处理模型查找和 API Key
          const result = await this.aiFacade.chat({
            messages: chatMessages,
            model: targetModelId,
            taskProfile: {
              creativity: "medium",
              outputLength: "medium",
            },
          });

          res.json({
            content: result.content,
            model: result.model,
            // Include RAG sources if knowledge bases were used
            ...(ragSources.length > 0 && {
              usedKnowledgeBase: true,
              ragSources,
            }),
            // Include web search sources if web search was used
            ...(webSearchSources.length > 0 && {
              usedWebSearch: true,
              webSearchSources,
            }),
          });
        }
      } catch (error) {
        if (error instanceof HttpException) {
          throw error;
        }
        const rawMsg = error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Simple chat error: ${rawMsg}`);
        // Avoid exposing internal error details to the client
        const safeMsg =
          rawMsg.includes("timeout") || rawMsg.includes("rate limit")
            ? rawMsg
            : "Chat request failed. Please try again.";
        throw new BadRequestException(safeMsg);
      }
    }; // end executeChat

    if (userId) {
      return BillingContext.run(
        { userId, moduleType: "ai-ask", operationType },
        executeChat,
      );
    }
    return executeChat();
  }

  /**
   * 快捷操作接口（摘要、洞察、方法论）
   * POST /api/v1/ai/quick-action
   */
  @Post("quick-action")
  @UseGuards(OptionalJwtAuthGuard)
  async quickAction(@Body() body: QuickActionRequest, @Req() req: Request) {
    const { content, action, model = "" } = body;

    this.logger.log(`Quick action: ${action}, model=${model}`);

    if (!content || content.trim().length === 0) {
      throw new BadRequestException("Content is required");
    }

    const userId =
      (req as unknown as { user?: { id?: string } }).user?.id ||
      RequestContext.getUserId();

    const executeQuickAction = async () => {
      try {
        // ★ 使用 AIFacade 统一获取模型（与 AI Ask 一致）
        let targetModelId = model;
        const facadeModel = await this.aiFacade.getModelById(model);

        if (!facadeModel) {
          const defaultModel = await this.aiFacade.getDefaultTextModel();
          if (!defaultModel) {
            throw new BadRequestException(`Model ${model} is not available`);
          }
          this.logger.warn(
            `[quick-action] Model "${model}" not found, using default: ${defaultModel.modelId}`,
          );
          targetModelId = defaultModel.modelId;
        } else {
          targetModelId = facadeModel.modelId;
        }

        let prompt: string;

        if (action === "methodology") {
          prompt = `You are a JSON-only API. Analyze the research methodology or technical methods in the following content.

Content:
${content}

Requirements:
1. Extract 3-5 main methods or techniques
2. Each method must have exactly these fields: title, description, importance
3. importance must be one of: high, medium, low
4. All titles and descriptions must be written in Simplified Chinese
5. Output ONLY a valid JSON array, nothing else

Output format:
[{"title":"方法名称","description":"方法的关键步骤与核心要点","importance":"high"}]

JSON output:`;
        } else if (action === "summary") {
          prompt = `请为以下内容生成一个结构化的摘要：

${content}

要求：
- 核心观点（2-3个要点）
- 主要发现或结论
- 实际应用价值
- 使用清晰的标题和列表格式`;
        } else {
          // insights
          prompt = `You are a JSON-only API. Extract key insights from the following content.

Content:
${content}

Requirements:
1. Extract 3-5 key insights
2. Each insight must have exactly these fields: title, description, importance
3. importance must be one of: high, medium, low
4. Output ONLY a valid JSON array, nothing else

Output format:
[{"title":"Core Finding","description":"Research reveals significant breakthrough","importance":"high"}]

JSON output:`;
        }

        // ★ 使用 AIFacade.chat()，它会自动处理模型查找和 API Key
        const result = await this.aiFacade.chat({
          messages: [{ role: "user", content: prompt }],
          model: targetModelId,
          taskProfile: {
            creativity: "medium",
            outputLength: "short",
          },
        });

        // Try to parse JSON for methodology and insights
        let finalContent:
          | string
          | Array<{ title: string; description: string; importance: string }> =
          result.content;
        if (action === "methodology" || action === "insights") {
          finalContent = this.extractJsonArray(result.content);
        }

        return {
          content: finalContent,
          action,
          model: result.model,
        };
      } catch (error) {
        if (error instanceof HttpException) {
          throw error;
        }
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Quick action error: ${errorMessage}`);
        throw new BadRequestException(`Quick action failed: ${errorMessage}`);
      }
    }; // end executeQuickAction

    if (userId) {
      return BillingContext.run(
        { userId, moduleType: "ai-ask", operationType: "chat" },
        executeQuickAction,
      );
    }
    return executeQuickAction();
  }

  /**
   * 摘要接口
   * POST /api/v1/ai/summary
   * 使用 CHAT_FAST tier 进行快速摘要生成
   */
  @Post("summary")
  @UseGuards(OptionalJwtAuthGuard)
  async summary(@Body() body: SummaryRequest, @Req() req: Request) {
    const { content, language = "zh" } = body;

    if (!content || content.trim().length === 0) {
      throw new BadRequestException("Content is required");
    }

    const userId =
      (req as unknown as { user?: { id?: string } }).user?.id ||
      RequestContext.getUserId();

    const executeSummary = async () => {
      try {
        // ★ 使用 AIFacade 获取 CHAT_FAST tier 模型
        const fastModel = await this.aiFacade.getDefaultModelByType(
          AIModelType.CHAT_FAST,
        );
        // 如果没有 CHAT_FAST，fallback 到默认 CHAT
        const modelConfig =
          fastModel || (await this.aiFacade.getDefaultTextModel());
        if (!modelConfig) {
          throw new BadRequestException("No AI model available for summary");
        }

        this.logger.log(
          `[Summary] Using model: ${modelConfig.displayName} (${modelConfig.modelId}) - Tier: CHAT_FAST`,
        );

        const prompt =
          language === "zh"
            ? `请为以下内容生成简洁的摘要：\n\n${content}\n\n要求：简明扼要，突出重点。`
            : `Please generate a concise summary of the following content:\n\n${content}`;

        // ★ 使用 AIFacade.chat()
        const result = await this.aiFacade.chat({
          messages: [{ role: "user", content: prompt }],
          model: modelConfig.modelId,
          taskProfile: {
            creativity: "low",
            outputLength: "short",
          },
        });

        return {
          summary: result.content,
          model: result.model,
          model_used: modelConfig.modelId,
          tier: "CHAT_FAST",
        };
      } catch (error) {
        if (error instanceof HttpException) {
          throw error;
        }
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Summary error: ${errorMessage}`);
        throw new BadRequestException(`Summary failed: ${errorMessage}`);
      }
    }; // end executeSummary

    if (userId) {
      return BillingContext.run(
        { userId, moduleType: "explore", operationType: "summary" },
        executeSummary,
      );
    }
    return executeSummary();
  }

  /**
   * 洞察接口
   * POST /api/v1/ai/insights
   * 使用 CHAT_FAST tier 进行结构化信息提取
   */
  @Post("insights")
  @UseGuards(OptionalJwtAuthGuard)
  async insights(@Body() body: InsightsRequest, @Req() req: Request) {
    const { content, language = "zh" } = body;

    if (!content || content.trim().length === 0) {
      throw new BadRequestException("Content is required");
    }

    const userId =
      (req as unknown as { user?: { id?: string } }).user?.id ||
      RequestContext.getUserId();

    const executeInsights = async () => {
      try {
        // ★ 使用 AIFacade 获取 CHAT_FAST tier 模型
        const fastModel = await this.aiFacade.getDefaultModelByType(
          AIModelType.CHAT_FAST,
        );
        const modelConfig =
          fastModel || (await this.aiFacade.getDefaultTextModel());
        if (!modelConfig) {
          throw new BadRequestException("No AI model available for insights");
        }

        this.logger.log(
          `[Insights] Using model: ${modelConfig.displayName} (${modelConfig.modelId}) - Tier: CHAT_FAST`,
        );

        const prompt = `You are a JSON-only API. Extract key insights from the following content.

Content:
${content}

Requirements:
1. Extract 3-5 key insights
2. Each insight must have exactly these fields: title, description, importance
3. importance must be one of: high, medium, low
4. ${language === "zh" ? "All output must be in Simplified Chinese" : "Output in English"}
5. Output ONLY a valid JSON array, nothing else

JSON output:`;

        // ★ 使用 AIFacade.chat()
        const result = await this.aiFacade.chat({
          messages: [{ role: "user", content: prompt }],
          model: modelConfig.modelId,
          taskProfile: {
            creativity: "deterministic",
            outputLength: "short",
          },
        });

        const jsonContent = this.extractJsonArray(result.content);

        return {
          insights: jsonContent,
          model: result.model,
          model_used: modelConfig.modelId,
          tier: "CHAT_FAST",
        };
      } catch (error) {
        if (error instanceof HttpException) {
          throw error;
        }
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Insights error: ${errorMessage}`);
        throw new BadRequestException(`Insights failed: ${errorMessage}`);
      }
    }; // end executeInsights

    if (userId) {
      return BillingContext.run(
        { userId, moduleType: "explore", operationType: "insights" },
        executeInsights,
      );
    }
    return executeInsights();
  }

  /**
   * 通用翻译接口（用于文本选择工具栏等场景）
   * POST /api/v1/ai/translate
   */
  @Post("translate")
  @UseGuards(OptionalJwtAuthGuard)
  async translate(
    @Body()
    body: {
      text: string;
      targetLanguage: string;
      sourceLanguage?: string;
    },
    @Req() req: Request,
  ) {
    this.logger.log(
      `Translation request: ${body.text?.substring(0, 50)}... -> ${body.targetLanguage}`,
    );

    if (!body.text || body.text.trim().length === 0) {
      throw new BadRequestException("Text is required for translation");
    }

    if (!body.targetLanguage) {
      throw new BadRequestException("Target language is required");
    }

    // Map language codes to full names for better translation
    const languageNames: Record<string, string> = {
      zh: "Simplified Chinese",
      en: "English",
      ja: "Japanese",
      ko: "Korean",
      fr: "French",
      de: "German",
      es: "Spanish",
      pt: "Portuguese",
      ru: "Russian",
      ar: "Arabic",
      "zh-CN": "Simplified Chinese",
      "zh-TW": "Traditional Chinese",
    };

    const targetLangName =
      languageNames[body.targetLanguage] || body.targetLanguage;
    const sourceLangName = body.sourceLanguage
      ? languageNames[body.sourceLanguage] || body.sourceLanguage
      : "auto-detect";

    const userId =
      (req as unknown as { user?: { id?: string } }).user?.id ||
      RequestContext.getUserId();

    const executeTranslate = async () => {
      try {
        // ★ 使用 AIFacade 获取 CHAT_FAST tier 模型
        const fastModel = await this.aiFacade.getDefaultModelByType(
          AIModelType.CHAT_FAST,
        );
        const modelConfig =
          fastModel || (await this.aiFacade.getDefaultTextModel());
        if (!modelConfig) {
          throw new BadRequestException(
            "No AI model available for translation",
          );
        }

        this.logger.log(
          `[Translate] Using model: ${modelConfig.displayName} (${modelConfig.modelId})`,
        );

        const prompt = `You are a professional translator. Translate the following text to ${targetLangName}.
${sourceLangName !== "auto-detect" ? `The source language is ${sourceLangName}.` : ""}

Important rules:
1. Provide ONLY the translation, no explanations or notes
2. Preserve the original formatting (paragraphs, line breaks)
3. Keep technical terms accurate
4. Maintain the tone and style of the original

Text to translate:
${body.text}

Translation:`;

        // Calculate dynamic maxTokens based on input length
        const estimatedTokens = Math.ceil(body.text.length / 3);
        const dynamicMaxTokens = Math.max(2000, estimatedTokens * 2);

        this.logger.log(
          `[Translate] Text length: ${body.text.length}, using maxTokens: ${dynamicMaxTokens}`,
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

        return {
          translation: result.content.trim(),
          translatedText: result.content.trim(), // Alias for compatibility
          sourceLanguage: body.sourceLanguage || "auto",
          targetLanguage: body.targetLanguage,
          model: result.model,
        };
      } catch (error) {
        if (error instanceof HttpException) {
          throw error;
        }
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Translation error: ${errorMessage}`);
        throw new BadRequestException(`Translation failed: ${errorMessage}`);
      }
    }; // end executeTranslate

    if (userId) {
      return BillingContext.run(
        { userId, moduleType: "explore", operationType: "translate" },
        executeTranslate,
      );
    }
    return executeTranslate();
  }

  @Post("translate-single")
  @UseGuards(OptionalJwtAuthGuard)
  async translateSingle(
    @Body() body: TranslateSingleRequest,
    @Req() req: Request,
  ) {
    this.logger.log(
      `Received translation request for text: ${body.text?.substring(0, 50)}...`,
    );

    if (!body.text || body.text.trim().length === 0) {
      throw new BadRequestException("Text is required for translation");
    }

    const targetLang = body.targetLang || "zh-CN";
    const sourceLang = body.sourceLang || "en";
    const userId =
      (req as unknown as { user?: { id?: string } }).user?.id ||
      RequestContext.getUserId();

    const executeTranslateSingle = async () => {
      try {
        const translation = await this.aiCoreService.translateText(
          body.text,
          sourceLang,
          targetLang,
        );

        return {
          original: body.text,
          translation,
          sourceLang,
          targetLang,
        };
      } catch (error) {
        // 保留原始HTTP异常的状态码
        if (error instanceof HttpException) {
          this.logger.error(`Translation failed: ${error.message}`);
          throw error; // 直接抛出，保留状态码（429, 503等）
        }

        // 其他未知错误作为500处理
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Unexpected translation error: ${errorMessage}`);
        throw new BadRequestException(`Translation failed: ${errorMessage}`);
      }
    }; // end executeTranslateSingle

    if (userId) {
      return BillingContext.run(
        { userId, moduleType: "explore", operationType: "translate" },
        executeTranslateSingle,
      );
    }
    return executeTranslateSingle();
  }

  /**
   * Helper: Extract JSON array from AI response and parse it
   */
  private extractJsonArray(
    content: string,
  ): Array<{ title: string; description: string; importance: string }> {
    try {
      let jsonContent = content.trim();

      // Remove markdown code blocks
      if (jsonContent.includes("```json")) {
        jsonContent = jsonContent.split("```json")[1].split("```")[0].trim();
      } else if (jsonContent.includes("```")) {
        jsonContent = jsonContent.split("```")[1].split("```")[0].trim();
      }

      // Find JSON array boundaries
      const startIdx = jsonContent.indexOf("[");
      const endIdx = jsonContent.lastIndexOf("]");

      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        jsonContent = jsonContent.slice(startIdx, endIdx + 1);
        // Parse and return JSON array
        const parsed = JSON.parse(jsonContent);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (e) {
      this.logger.warn(`Failed to extract JSON: ${e}`);
    }
    // Return empty array on failure
    return [];
  }
}
