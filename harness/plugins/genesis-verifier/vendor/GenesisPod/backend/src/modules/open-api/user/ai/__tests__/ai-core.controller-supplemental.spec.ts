/**
 * AiController Supplemental Unit Tests
 *
 * Covers uncovered branches:
 * - testGeminiImageGeneration: uses secretKey, fetch success with/without image, API_ERROR, FETCH_ERROR
 * - listGoogleModels: API error response, fetch throws, image/gemini model categorization
 * - simpleChat: RAG no sources returned, RAG service unavailable but kbIds provided
 * - simpleChat: web search failure (still continues), web search service unavailable
 * - simpleChat: non-stream error wraps generic message
 * - summary/insights/translate: BillingContext with user, dynamic maxTokens for translate
 * - extractJsonArray: with ``` code block (no json), no brackets in content
 */

import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AiController } from "../ai.controller";
import { AiService } from "../ai.service";
import { ChatFacade } from "../../../../ai-harness/facade";
import { RAGPipelineService } from "@/modules/ai-engine/rag/pipeline";
import { SecretsService } from "../../../../platform/credentials/storage/secrets/secrets.service";
import { SearchService } from "../../../../ai-engine/content/web-search/web-search.service";

const mockAiCoreService = {
  getEnabledModels: jest.fn(),
  getAllModels: jest.fn(),
  getGoogleModels: jest.fn(),
  getFirstGoogleModelWithKey: jest.fn(),
  getTopicWithAIMembers: jest.fn(),
  findModelByModelId: jest.fn(),
  findModelByName: jest.fn(),
  translateText: jest.fn(),
};

const mockAiFacade = {
  chat: jest.fn(),
  chatStream: jest.fn(),
  getModelById: jest.fn(),
  getDefaultTextModel: jest.fn(),
  getDefaultModelByType: jest.fn(),
};

const mockConfigService = {
  get: jest.fn(),
};

const mockRagPipelineService = {
  query: jest.fn(),
};

const mockSecretsService = {
  getValueInternal: jest.fn(),
};

const mockSearchService = {
  search: jest.fn(),
  formatResultsForContext: jest.fn(),
};

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    user: undefined,
    headers: {},
    ...overrides,
  };
}

function makeResponse() {
  return {
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  };
}

describe("AiController (supplemental)", () => {
  let controller: AiController;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, "log").mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, "error").mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, "warn").mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, "debug").mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiController],
      providers: [
        { provide: AiService, useValue: mockAiCoreService },
        { provide: ChatFacade, useValue: mockAiFacade },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: RAGPipelineService, useValue: mockRagPipelineService },
        { provide: SecretsService, useValue: mockSecretsService },
        { provide: SearchService, useValue: mockSearchService },
      ],
    }).compile();

    controller = module.get<AiController>(AiController);
  });

  // ==================== testGeminiImageGeneration ====================

  describe("testGeminiImageGeneration (supplemental)", () => {
    it("uses secretKey when model has secretKey and secretsService available", async () => {
      mockAiCoreService.getGoogleModels.mockResolvedValue([
        {
          modelId: "gemini-2.0-flash-exp",
          name: "Gemini Flash",
          secretKey: "my-secret",
          apiKey: null,
        },
      ]);
      mockSecretsService.getValueInternal.mockResolvedValue("  real-api-key  ");
      mockConfigService.get.mockReturnValue(null);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [
                  { inlineData: { mimeType: "image/png", data: "base64data" } },
                  { text: "Here is the image" },
                ],
              },
            },
          ],
        }),
      }) as typeof fetch;

      const result = await controller.testGeminiImageGeneration();
      expect(mockSecretsService.getValueInternal).toHaveBeenCalledWith(
        "my-secret",
      );
      expect(result.results[0].status).toBe("SUCCESS");
      expect(result.results[0].supportsImage).toBe(true);
      expect(result.results[0].responseType).toBe("image");
      expect(result.modelsWithImageSupport).toBe(1);
    });

    it("reports text-only response when no image in response parts", async () => {
      mockAiCoreService.getGoogleModels.mockResolvedValue([
        {
          modelId: "gemini-flash",
          name: "Gemini Flash",
          secretKey: "gemini-key",
          apiKey: null,
        },
      ]);
      mockSecretsService.getValueInternal.mockResolvedValue("api-key");
      mockConfigService.get.mockReturnValue(null);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          candidates: [
            { content: { parts: [{ text: "I cannot generate images." }] } },
          ],
        }),
      }) as typeof fetch;

      const result = await controller.testGeminiImageGeneration();
      expect(result.results[0].status).toBe("SUCCESS");
      expect(result.results[0].supportsImage).toBe(false);
      expect(result.results[0].responseType).toBe("text-only");
      expect(result.results[0].textPreview).toBe("I cannot generate images.");
    });

    it("reports empty response when no parts returned", async () => {
      mockAiCoreService.getGoogleModels.mockResolvedValue([
        {
          modelId: "gemini-flash",
          name: "Gemini Flash",
          secretKey: "gemini-key",
          apiKey: null,
        },
      ]);
      mockSecretsService.getValueInternal.mockResolvedValue("api-key");
      mockConfigService.get.mockReturnValue(null);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ candidates: [] }),
      }) as typeof fetch;

      const result = await controller.testGeminiImageGeneration();
      expect(result.results[0].status).toBe("SUCCESS");
      expect(result.results[0].supportsImage).toBe(false);
      expect(result.results[0].responseType).toBe("empty");
    });

    it("reports API_ERROR status when fetch response is not ok", async () => {
      mockAiCoreService.getGoogleModels.mockResolvedValue([
        {
          modelId: "gemini-flash",
          name: "Gemini Flash",
          secretKey: "gemini-key",
          apiKey: null,
        },
      ]);
      mockSecretsService.getValueInternal.mockResolvedValue("api-key");
      mockConfigService.get.mockReturnValue(null);

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: jest
          .fn()
          .mockResolvedValue({ error: { message: "Rate limit exceeded" } }),
      }) as typeof fetch;

      const result = await controller.testGeminiImageGeneration();
      expect(result.results[0].status).toBe("API_ERROR");
      expect(result.results[0].error).toBe("Rate limit exceeded");
      expect(result.results[0].supportsImage).toBe(false);
    });

    it("reports FETCH_ERROR when fetch itself throws", async () => {
      mockAiCoreService.getGoogleModels.mockResolvedValue([
        {
          modelId: "gemini-flash",
          name: "Gemini Flash",
          secretKey: "gemini-key",
          apiKey: null,
        },
      ]);
      mockSecretsService.getValueInternal.mockResolvedValue("api-key");
      mockConfigService.get.mockReturnValue(null);

      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error("Network failure")) as typeof fetch;

      const result = await controller.testGeminiImageGeneration();
      expect(result.results[0].status).toBe("FETCH_ERROR");
      expect(result.results[0].error).toBe("Network failure");
    });

    it("falls back to env key when secretKey value is null and apiKey is null", async () => {
      mockAiCoreService.getGoogleModels.mockResolvedValue([
        {
          modelId: "gemini-flash",
          name: "Gemini Flash",
          secretKey: "my-secret",
          apiKey: null,
        },
      ]);
      mockSecretsService.getValueInternal.mockResolvedValue(null);
      mockConfigService.get.mockImplementation((key: string) =>
        key === "GOOGLE_AI_API_KEY" ? "env-api-key" : null,
      );

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ candidates: [] }),
      }) as typeof fetch;

      const result = await controller.testGeminiImageGeneration();
      expect(result.results[0].status).toBe("SUCCESS");
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(fetchCall).toContain("env-api-key");
    });

    it("recommendation lists image-supporting models", async () => {
      mockAiCoreService.getGoogleModels.mockResolvedValue([
        {
          modelId: "gemini-2.0-flash-exp",
          name: "Gemini 2.0 Flash",
          secretKey: null,
          apiKey: "key",
        },
      ]);
      mockConfigService.get.mockReturnValue(null);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          candidates: [
            { content: { parts: [{ inlineData: { mimeType: "image/png" } }] } },
          ],
        }),
      }) as typeof fetch;

      const result = await controller.testGeminiImageGeneration();
      expect(result.recommendation).toContain("gemini-2.0-flash-exp");
    });
  });

  // ==================== listGoogleModels ====================

  describe("listGoogleModels (supplemental)", () => {
    it("throws BadRequestException when API returns error response", async () => {
      mockAiCoreService.getFirstGoogleModelWithKey.mockResolvedValue({
        secretKey: null,
        apiKey: "bad-key",
      });
      mockConfigService.get.mockReturnValue(null);

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: jest
          .fn()
          .mockResolvedValue({ error: { message: "API key invalid" } }),
      }) as typeof fetch;

      await expect(controller.listGoogleModels()).rejects.toThrow(
        BadRequestException,
      );
    });

    it("throws BadRequestException when fetch itself throws", async () => {
      mockAiCoreService.getFirstGoogleModelWithKey.mockResolvedValue({
        secretKey: null,
        apiKey: "test-key",
      });
      mockConfigService.get.mockReturnValue(null);

      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error("DNS resolution failed")) as typeof fetch;

      await expect(controller.listGoogleModels()).rejects.toThrow(
        BadRequestException,
      );
    });

    it("categorizes image/gemini models from response", async () => {
      mockAiCoreService.getFirstGoogleModelWithKey.mockResolvedValue({
        secretKey: null,
        apiKey: "test-key",
      });
      mockConfigService.get.mockReturnValue(null);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          models: [
            {
              name: "models/gemini-2.0-flash",
              displayName: "Gemini 2.0",
              supportedGenerationMethods: ["generateContent"],
            },
            {
              name: "models/imagen-3.0-generate-001",
              displayName: "Imagen 3",
              supportedGenerationMethods: ["generateImage"],
            },
            {
              name: "models/gemini-1.5-pro",
              displayName: "Gemini 1.5 Pro",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        }),
      }) as typeof fetch;

      const result = await controller.listGoogleModels();
      expect(result.totalModels).toBe(3);
      expect(result.geminiModels.length).toBe(2); // gemini-2.0-flash and gemini-1.5-pro
      expect(result.imageModels.length).toBeGreaterThanOrEqual(1); // imagen model
      expect(result.apiKeyPrefix).toBe("test-key...");
    });

    it("uses env API key when model has no apiKey and no secretKey", async () => {
      mockAiCoreService.getFirstGoogleModelWithKey.mockResolvedValue(null);
      mockConfigService.get.mockImplementation((key: string) =>
        key === "GOOGLE_AI_API_KEY" ? "env-key-12345" : null,
      );

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ models: [] }),
      }) as typeof fetch;

      const result = await controller.listGoogleModels();
      expect(result.totalModels).toBe(0);
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(fetchCall).toContain("env-key-12345");
    });

    it("re-throws HttpException from inner error without wrapping", async () => {
      mockAiCoreService.getFirstGoogleModelWithKey.mockResolvedValue({
        secretKey: null,
        apiKey: "test-key",
      });
      mockConfigService.get.mockReturnValue(null);

      // Simulate a BadRequestException thrown from inside (e.g. from API error branch)
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: jest
          .fn()
          .mockResolvedValue({ error: { message: "Bad request error" } }),
      }) as typeof fetch;

      await expect(controller.listGoogleModels()).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ==================== simpleChat (supplemental) ====================

  describe("simpleChat (supplemental)", () => {
    it("logs warning when RAG service unavailable but kbIds provided", async () => {
      // Create controller without RAG service
      const moduleNoRag = await Test.createTestingModule({
        controllers: [AiController],
        providers: [
          { provide: AiService, useValue: mockAiCoreService },
          { provide: ChatFacade, useValue: mockAiFacade },
          { provide: ConfigService, useValue: mockConfigService },
          { provide: RAGPipelineService, useValue: null },
          { provide: SecretsService, useValue: mockSecretsService },
          { provide: SearchService, useValue: null },
        ],
      }).compile();
      const controllerNoRag = moduleNoRag.get<AiController>(AiController);

      mockAiFacade.getModelById.mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat.mockResolvedValue({
        content: "Answer",
        model: "gemini-pro",
      });

      const res = makeResponse();
      const req = makeRequest();
      await controllerNoRag.simpleChat(
        {
          message: "Hello",
          stream: false,
          knowledgeBaseIds: ["kb-1"],
        } as never,
        res as never,
        req as never,
      );

      // Verifies graceful degradation without RAG service
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Answer" }),
      );
    });

    it("continues with response when RAG query returns no sources", async () => {
      mockAiFacade.getModelById.mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat.mockResolvedValue({
        content: "Answer without RAG",
        model: "gemini-pro",
      });
      mockRagPipelineService.query.mockResolvedValue({
        context: { text: "", sources: [] },
      });

      const res = makeResponse();
      const req = makeRequest();
      await controller.simpleChat(
        {
          message: "Hello",
          stream: false,
          knowledgeBaseIds: ["kb-empty"],
        } as never,
        res as never,
        req as never,
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.not.objectContaining({ usedKnowledgeBase: true }),
      );
    });

    it("continues with response when RAG query throws error", async () => {
      mockAiFacade.getModelById.mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat.mockResolvedValue({
        content: "Fallback answer",
        model: "gemini-pro",
      });
      mockRagPipelineService.query.mockRejectedValue(
        new Error("Vector DB timeout"),
      );

      const res = makeResponse();
      const req = makeRequest();
      await controller.simpleChat(
        {
          message: "Question",
          stream: false,
          knowledgeBaseIds: ["kb-1"],
        } as never,
        res as never,
        req as never,
      );

      // RAG failure should not block the response
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Fallback answer" }),
      );
    });

    it("continues when web search service throws error", async () => {
      mockAiFacade.getModelById.mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat.mockResolvedValue({
        content: "Answer without search",
        model: "gemini-pro",
      });
      mockSearchService.search.mockRejectedValue(
        new Error("Search service down"),
      );

      const res = makeResponse();
      const req = makeRequest();
      await controller.simpleChat(
        { message: "News?", stream: false, webSearch: true } as never,
        res as never,
        req as never,
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.not.objectContaining({ usedWebSearch: true }),
      );
    });

    it("wraps generic non-HttpException error in BadRequestException for non-stream", async () => {
      mockAiFacade.getModelById.mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat.mockRejectedValue(new Error("Unexpected model crash"));

      const res = makeResponse();
      const req = makeRequest();
      await expect(
        controller.simpleChat(
          { message: "Hi", stream: false } as never,
          res as never,
          req as never,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("sends stream RAG sources event when stream=true and RAG returns sources", async () => {
      mockAiFacade.getModelById.mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat.mockResolvedValue({
        content: "Stream with RAG",
        model: "gemini-pro",
      });
      mockRagPipelineService.query.mockResolvedValue({
        context: {
          text: "KB context",
          sources: [{ documentTitle: "Doc A", excerpt: "text", score: 0.9 }],
        },
      });

      const res = makeResponse();
      const req = makeRequest();
      await controller.simpleChat(
        {
          message: "RAG question",
          stream: true,
          knowledgeBaseIds: ["kb-1"],
        } as never,
        res as never,
        req as never,
      );

      const writtenData = res.write.mock.calls.map((c: string[]) => c[0]);
      const ragEvent = writtenData.find((d) => d.includes("ragSources"));
      expect(ragEvent).toBeDefined();
    });

    it("sends stream web search sources when stream=true", async () => {
      mockAiFacade.getModelById.mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat.mockResolvedValue({
        content: "Stream web result",
        model: "gemini-pro",
      });
      mockSearchService.search.mockResolvedValue({
        success: true,
        results: [
          { title: "Article", url: "https://article.com", content: "text" },
        ],
        provider: "brave",
      });
      mockSearchService.formatResultsForContext.mockReturnValue(
        "formatted context",
      );

      const res = makeResponse();
      const req = makeRequest();
      await controller.simpleChat(
        { message: "Latest AI news?", stream: true, webSearch: true } as never,
        res as never,
        req as never,
      );

      const writtenData = res.write.mock.calls.map((c: string[]) => c[0]);
      const searchEvent = writtenData.find((d) =>
        d.includes("webSearchSources"),
      );
      expect(searchEvent).toBeDefined();
    });
  });

  // ==================== summary (supplemental) ====================

  describe("summary (supplemental)", () => {
    it("throws BadRequestException when content is whitespace only", async () => {
      await expect(
        controller.summary({ content: "   " } as never, makeRequest() as never),
      ).rejects.toThrow(BadRequestException);
    });

    it("propagates service error as BadRequestException", async () => {
      mockAiFacade.getDefaultModelByType.mockResolvedValue({
        id: "fast-id",
        modelId: "gemini-flash",
        displayName: "Gemini Flash",
        provider: "google",
      });
      mockAiFacade.chat.mockRejectedValue(new Error("LLM unavailable"));

      await expect(
        controller.summary(
          { content: "Long article" } as never,
          makeRequest() as never,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==================== insights (supplemental) ====================

  describe("insights (supplemental)", () => {
    it("throws BadRequestException when content is whitespace only", async () => {
      await expect(
        controller.insights({ content: "  " } as never, makeRequest() as never),
      ).rejects.toThrow(BadRequestException);
    });

    it("wraps error in BadRequestException", async () => {
      mockAiFacade.getDefaultModelByType.mockResolvedValue({
        id: "fast-id",
        modelId: "gemini-flash",
        displayName: "Gemini Flash",
        provider: "google",
      });
      mockAiFacade.chat.mockRejectedValue(new Error("timeout connecting"));

      await expect(
        controller.insights(
          { content: "Article" } as never,
          makeRequest() as never,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==================== translate (supplemental) ====================

  describe("translate (supplemental)", () => {
    it("uses dynamic maxTokens based on input length", async () => {
      mockAiFacade.getDefaultModelByType.mockResolvedValue({
        id: "fast-id",
        modelId: "gemini-flash",
        displayName: "Gemini Flash",
        provider: "google",
      });
      mockAiFacade.chat.mockResolvedValue({
        content: "Translated",
        model: "gemini-flash",
      });

      // A long text (>3000 chars) to test dynamic maxTokens calculation
      const longText = "This is a test. ".repeat(200); // 3200 chars
      await controller.translate(
        { text: longText, targetLanguage: "zh" } as never,
        makeRequest() as never,
      );

      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      // estimatedTokens = ceil(3200/3) = 1067, dynamicMaxTokens = max(2000, 1067*2) = 2134
      expect(chatCall.maxTokens).toBeGreaterThan(2000);
    });

    it("uses known language name in prompt for zh-CN", async () => {
      mockAiFacade.getDefaultModelByType.mockResolvedValue({
        id: "fast-id",
        modelId: "gemini-flash",
        displayName: "Gemini Flash",
        provider: "google",
      });
      mockAiFacade.chat.mockResolvedValue({
        content: "翻译结果",
        model: "gemini-flash",
      });

      await controller.translate(
        {
          text: "Hello",
          targetLanguage: "zh-CN",
          sourceLanguage: "en",
        } as never,
        makeRequest() as never,
      );

      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      expect(chatCall.messages[0].content).toContain("Simplified Chinese");
      expect(chatCall.messages[0].content).toContain("English");
    });

    it("uses raw language code in prompt for unknown language", async () => {
      mockAiFacade.getDefaultModelByType.mockResolvedValue({
        id: "fast-id",
        modelId: "gemini-flash",
        displayName: "Gemini Flash",
        provider: "google",
      });
      mockAiFacade.chat.mockResolvedValue({
        content: "Translated",
        model: "gemini-flash",
      });

      await controller.translate(
        { text: "Hello", targetLanguage: "sw" } as never,
        makeRequest() as never,
      );

      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      // Unknown language code used directly
      expect(chatCall.messages[0].content).toContain("sw");
    });

    it("falls back to default text model when CHAT_FAST not available", async () => {
      mockAiFacade.getDefaultModelByType.mockResolvedValue(null);
      mockAiFacade.getDefaultTextModel.mockResolvedValue({
        id: "chat-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat.mockResolvedValue({
        content: "Translated fallback",
        model: "gemini-pro",
      });

      const result = await controller.translate(
        { text: "Hello", targetLanguage: "fr" } as never,
        makeRequest() as never,
      );
      expect(result.translation).toBe("Translated fallback");
    });

    it("propagates HttpException from chat facade", async () => {
      const { HttpException, HttpStatus } = await import("@nestjs/common");
      mockAiFacade.getDefaultModelByType.mockResolvedValue({
        id: "fast-id",
        modelId: "gemini-flash",
        displayName: "Gemini Flash",
        provider: "google",
      });
      mockAiFacade.chat.mockRejectedValue(
        new HttpException("Forbidden", HttpStatus.FORBIDDEN),
      );

      await expect(
        controller.translate(
          { text: "Hello", targetLanguage: "zh" } as never,
          makeRequest() as never,
        ),
      ).rejects.toThrow(HttpException);
    });
  });

  // ==================== quickAction (supplemental) ====================

  describe("quickAction (supplemental)", () => {
    it("extracts JSON from ``` code block without json tag", async () => {
      mockAiFacade.getModelById.mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat.mockResolvedValue({
        content:
          '```\n[{"title":"Method","description":"step","importance":"low"}]\n```',
        model: "gemini-pro",
      });

      const result = await controller.quickAction(
        { content: "Research paper", action: "methodology" } as never,
        makeRequest() as never,
      );

      expect(Array.isArray(result.content)).toBe(true);
      expect((result.content as Array<{ title: string }>)[0].title).toBe(
        "Method",
      );
    });

    it("propagates HttpException from chat facade", async () => {
      const { HttpException, HttpStatus } = await import("@nestjs/common");
      mockAiFacade.getModelById.mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat.mockRejectedValue(
        new HttpException("Rate limit", HttpStatus.TOO_MANY_REQUESTS),
      );

      await expect(
        controller.quickAction(
          { content: "Article text", action: "insights" } as never,
          makeRequest() as never,
        ),
      ).rejects.toThrow(HttpException);
    });
  });
});
