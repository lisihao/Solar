/**
 * Unit tests for AiController
 */

import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, Logger, NotFoundException } from "@nestjs/common";
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
  const res = {
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  };
  return res;
}

describe("AiController", () => {
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

  describe("getEnabledModels", () => {
    it("returns enabled models from service", async () => {
      const models = [{ id: "m1", name: "GPT-4" }];
      mockAiCoreService.getEnabledModels.mockResolvedValue(models);

      const req = makeRequest({ user: { id: "user-1" } });
      const result = await controller.getEnabledModels(req as never);

      expect(mockAiCoreService.getEnabledModels).toHaveBeenCalledWith("user-1");
      expect(result).toEqual(models);
    });

    it("calls getEnabledModels without userId when user is not authenticated", async () => {
      mockAiCoreService.getEnabledModels.mockResolvedValue([]);

      const req = makeRequest();
      await controller.getEnabledModels(req as never);

      expect(mockAiCoreService.getEnabledModels).toHaveBeenCalledWith(
        undefined,
      );
    });
  });

  describe("diagnoseModels", () => {
    it("returns a diagnosis report with model stats", async () => {
      const allModels = [
        {
          id: "m1",
          name: "GPT-4",
          modelId: "gpt-4o",
          provider: "openai",
          modelType: "CHAT",
          isEnabled: true,
          isDefault: true,
          hasApiKey: true,
          hasSecretKey: false,
          apiEndpoint: null,
        },
        {
          id: "m2",
          name: "Gemini",
          modelId: "gemini-flash",
          provider: "google",
          modelType: "CHAT_FAST",
          isEnabled: false,
          isDefault: false,
          hasApiKey: false,
          hasSecretKey: false,
          apiEndpoint: null,
        },
      ];
      mockAiCoreService.getAllModels.mockResolvedValue(allModels);
      mockConfigService.get.mockReturnValue(null);

      const result = await controller.diagnoseModels();

      expect(result).toMatchObject({
        totalModels: 2,
        enabledModels: 1,
        modelsWithApiKey: 1,
        models: expect.arrayContaining([
          expect.objectContaining({ id: "m1", hasApiKey: true }),
        ]),
      });
    });

    it("returns recommendation when no enabled models have API keys", async () => {
      mockAiCoreService.getAllModels.mockResolvedValue([
        {
          id: "m1",
          name: "GPT-4",
          modelId: "gpt-4o",
          provider: "openai",
          modelType: "CHAT",
          isEnabled: true,
          isDefault: false,
          hasApiKey: false,
          hasSecretKey: false,
          apiEndpoint: null,
        },
      ]);
      mockConfigService.get.mockReturnValue(null);

      const result = await controller.diagnoseModels();

      expect(result.recommendation).toContain("No enabled models");
    });

    it("returns OK recommendation when enabled models have API keys", async () => {
      mockAiCoreService.getAllModels.mockResolvedValue([
        {
          id: "m1",
          name: "GPT-4",
          modelId: "gpt-4o",
          provider: "openai",
          modelType: "CHAT",
          isEnabled: true,
          isDefault: false,
          hasApiKey: true,
          hasSecretKey: false,
          apiEndpoint: "https://api.openai.com",
        },
      ]);
      mockConfigService.get.mockReturnValue(null);

      const result = await controller.diagnoseModels();

      expect(result.recommendation).toContain("Configuration looks OK");
    });

    it("includes environment variable availability flags", async () => {
      mockAiCoreService.getAllModels.mockResolvedValue([]);
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "OPENAI_API_KEY") return "sk-test";
        return null;
      });

      const result = await controller.diagnoseModels();

      expect(result.environmentVariables.OPENAI_API_KEY).toBe(true);
      expect(result.environmentVariables.GOOGLE_AI_API_KEY).toBe(false);
    });
  });

  describe("testGeminiImageGeneration", () => {
    it("throws NotFoundException when no Gemini models found", async () => {
      mockAiCoreService.getGoogleModels.mockResolvedValue([]);

      await expect(controller.testGeminiImageGeneration()).rejects.toThrow(
        NotFoundException,
      );
    });

    it("returns NO_API_KEY status when model has no API key", async () => {
      mockAiCoreService.getGoogleModels.mockResolvedValue([
        {
          modelId: "gemini-flash",
          name: "Gemini Flash",
          secretKey: null,
          apiKey: null,
        },
      ]);
      mockConfigService.get.mockReturnValue(null);

      const result = await controller.testGeminiImageGeneration();

      expect(result.results[0].status).toBe("NO_API_KEY");
      expect(result.totalTested).toBe(1);
      expect(result.modelsWithImageSupport).toBe(0);
    });
  });

  describe("listGoogleModels", () => {
    it("throws BadRequestException when no API key is available", async () => {
      mockAiCoreService.getFirstGoogleModelWithKey.mockResolvedValue(null);
      mockConfigService.get.mockReturnValue(null);

      await expect(controller.listGoogleModels()).rejects.toThrow(
        BadRequestException,
      );
    });

    it("uses secretKey when available", async () => {
      mockAiCoreService.getFirstGoogleModelWithKey.mockResolvedValue({
        secretKey: "my-secret",
        apiKey: null,
      });
      mockSecretsService.getValueInternal.mockResolvedValue("real-api-key");

      // Mock global fetch
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ models: [] }),
      });
      global.fetch = mockFetch as typeof fetch;

      const result = await controller.listGoogleModels();

      expect(mockSecretsService.getValueInternal).toHaveBeenCalledWith(
        "my-secret",
      );
      expect(mockFetch).toHaveBeenCalled();
      expect(result).toMatchObject({ totalModels: 0 });
    });

    it("falls back to apiKey on model when secretKey is empty", async () => {
      mockAiCoreService.getFirstGoogleModelWithKey.mockResolvedValue({
        secretKey: null,
        apiKey: "direct-api-key",
      });

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ models: [] }),
      });
      global.fetch = mockFetch as typeof fetch;

      await controller.listGoogleModels();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("direct-api-key"),
      );
    });
  });

  describe("checkTopicAI", () => {
    it("throws NotFoundException when topic does not exist", async () => {
      mockAiCoreService.getTopicWithAIMembers.mockResolvedValue(null);

      await expect(controller.checkTopicAI("nonexistent-id")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("returns topic check results for all AI members", async () => {
      const topic = {
        id: "topic-1",
        name: "My Topic",
        aiMembers: [
          { id: "ai-1", displayName: "GPT Agent", aiModel: "gpt-4o" },
        ],
      };
      mockAiCoreService.getTopicWithAIMembers.mockResolvedValue(topic);
      mockAiCoreService.findModelByModelId.mockResolvedValue({
        id: "m1",
        name: "GPT-4",
        modelId: "gpt-4o",
        apiKey: "sk-test",
      });
      mockAiCoreService.findModelByName.mockResolvedValue(null);

      const result = await controller.checkTopicAI("topic-1");

      expect(result.topicId).toBe("topic-1");
      expect(result.aiMemberCount).toBe(1);
      expect(result.results[0].willWork).toBe(true);
    });

    it("marks AI member as not working when no model found", async () => {
      const topic = {
        id: "topic-1",
        name: "Test Topic",
        aiMembers: [
          {
            id: "ai-1",
            displayName: "Unknown Agent",
            aiModel: "unknown-model",
          },
        ],
      };
      mockAiCoreService.getTopicWithAIMembers.mockResolvedValue(topic);
      mockAiCoreService.findModelByModelId.mockResolvedValue(null);
      mockAiCoreService.findModelByName.mockResolvedValue(null);

      const result = await controller.checkTopicAI("topic-1");

      expect(result.results[0].willWork).toBe(false);
      expect(result.results[0].problem).toBe("Model not found in database");
    });

    it("marks AI member as not working when model found but no API key", async () => {
      const topic = {
        id: "topic-1",
        name: "Test Topic",
        aiMembers: [{ id: "ai-1", displayName: "Agent", aiModel: "gpt-4o" }],
      };
      mockAiCoreService.getTopicWithAIMembers.mockResolvedValue(topic);
      mockAiCoreService.findModelByModelId.mockResolvedValue({
        id: "m1",
        name: "GPT-4",
        modelId: "gpt-4o",
        apiKey: null,
      });
      mockAiCoreService.findModelByName.mockResolvedValue(null);

      const result = await controller.checkTopicAI("topic-1");

      expect(result.results[0].willWork).toBe(false);
      expect(result.results[0].problem).toBe("Model found but no API key");
    });

    it("considers AI member working when found by name with API key", async () => {
      const topic = {
        id: "topic-1",
        name: "Test Topic",
        aiMembers: [
          { id: "ai-1", displayName: "Named Agent", aiModel: "GPT-4" },
        ],
      };
      mockAiCoreService.getTopicWithAIMembers.mockResolvedValue(topic);
      mockAiCoreService.findModelByModelId.mockResolvedValue(null);
      mockAiCoreService.findModelByName.mockResolvedValue({
        id: "m1",
        name: "GPT-4",
        modelId: "gpt-4o",
        apiKey: "sk-test-key",
      });

      const result = await controller.checkTopicAI("topic-1");

      expect(result.results[0].willWork).toBe(true);
      expect(result.results[0].foundByName).not.toBeNull();
      expect(result.results[0].foundByModelId).toBeNull();
    });
  });

  describe("simpleChat", () => {
    it("throws BadRequestException when message is empty", async () => {
      const body = { message: "", stream: false };
      const res = makeResponse();
      const req = makeRequest();

      await expect(
        controller.simpleChat(body as never, res as never, req as never),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when message is whitespace only", async () => {
      const body = { message: "   ", stream: false };
      const res = makeResponse();
      const req = makeRequest();

      await expect(
        controller.simpleChat(body as never, res as never, req as never),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when message exceeds 50000 characters", async () => {
      const body = { message: "x".repeat(50001), stream: false };
      const res = makeResponse();
      const req = makeRequest();

      await expect(
        controller.simpleChat(body as never, res as never, req as never),
      ).rejects.toThrow(BadRequestException);
    });

    it("returns non-stream JSON response with model from facade", async () => {
      const res = makeResponse();
      const req = makeRequest();

      mockAiFacade.getModelById = jest.fn().mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content: "Hello world",
        model: "gemini-pro",
      });

      await controller.simpleChat(
        { message: "Hi", stream: false } as never,
        res as never,
        req as never,
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Hello world" }),
      );
    });

    it("falls back to default model when specified model not found", async () => {
      const res = makeResponse();
      const req = makeRequest();

      mockAiFacade.getModelById = jest.fn().mockResolvedValue(null);
      mockAiFacade.getDefaultTextModel = jest.fn().mockResolvedValue({
        id: "db-id-default",
        modelId: "gemini-flash",
        displayName: "Gemini Flash",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content: "Default model response",
        model: "gemini-flash",
      });

      await controller.simpleChat(
        { message: "Hi", stream: false, model: "nonexistent" } as never,
        res as never,
        req as never,
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Default model response" }),
      );
    });

    it("throws BadRequestException when model not found and no default available", async () => {
      const res = makeResponse();
      const req = makeRequest();

      mockAiFacade.getModelById = jest.fn().mockResolvedValue(null);
      mockAiFacade.getDefaultTextModel = jest.fn().mockResolvedValue(null);

      await expect(
        controller.simpleChat(
          { message: "Hi", stream: false } as never,
          res as never,
          req as never,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("sends SSE stream response when stream=true", async () => {
      const res = makeResponse();
      const req = makeRequest();

      mockAiFacade.getModelById = jest.fn().mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content: "Streaming response",
        model: "gemini-pro",
      });

      await controller.simpleChat(
        { message: "Stream this", stream: true } as never,
        res as never,
        req as never,
      );

      expect(res.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "text/event-stream",
      );
      expect(res.write).toHaveBeenCalledWith("data: [DONE]\n\n");
      expect(res.end).toHaveBeenCalled();
    });

    it("writes error chunk on stream chat failure with timeout error", async () => {
      const res = makeResponse();
      const req = makeRequest();

      mockAiFacade.getModelById = jest.fn().mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat = jest
        .fn()
        .mockRejectedValue(new Error("timeout connecting to model"));

      await controller.simpleChat(
        { message: "Hello", stream: true } as never,
        res as never,
        req as never,
      );

      const writeCalls = res.write.mock.calls.map((c) => c[0] as string);
      const errorEvent = writeCalls.find((w) => w.includes('"error"'));
      expect(errorEvent).toContain("Request timed out");
      expect(res.end).toHaveBeenCalled();
    });

    it("writes generic error chunk on non-timeout stream failure", async () => {
      const res = makeResponse();
      const req = makeRequest();

      mockAiFacade.getModelById = jest.fn().mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat = jest
        .fn()
        .mockRejectedValue(new Error("unexpected server crash"));

      await controller.simpleChat(
        { message: "Hello", stream: true } as never,
        res as never,
        req as never,
      );

      const writeCalls = res.write.mock.calls.map((c) => c[0] as string);
      const errorEvent = writeCalls.find((w) => w.includes('"error"'));
      expect(errorEvent).toContain("Failed to generate response");
    });

    it("includes RAG sources in non-stream response when KB IDs provided", async () => {
      const res = makeResponse();
      const req = makeRequest();

      mockAiFacade.getModelById = jest.fn().mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content: "RAG answer",
        model: "gemini-pro",
      });
      mockRagPipelineService.query.mockResolvedValue({
        context: {
          text: "Knowledge base context",
          sources: [{ documentTitle: "Doc A", excerpt: "excerpt", score: 0.9 }],
        },
      });

      await controller.simpleChat(
        {
          message: "What does the doc say?",
          stream: false,
          knowledgeBaseIds: ["kb-1"],
        } as never,
        res as never,
        req as never,
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          usedKnowledgeBase: true,
          ragSources: expect.arrayContaining([
            expect.objectContaining({ documentTitle: "Doc A" }),
          ]),
        }),
      );
    });

    it("includes RAG sources in stream SSE when KB IDs provided", async () => {
      const res = makeResponse();
      const req = makeRequest();

      mockAiFacade.getModelById = jest.fn().mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content: "RAG stream answer",
        model: "gemini-pro",
      });
      mockRagPipelineService.query.mockResolvedValue({
        context: {
          text: "Knowledge base context",
          sources: [{ documentTitle: "Doc B", excerpt: "text", score: 0.8 }],
        },
      });

      await controller.simpleChat(
        {
          message: "KB question",
          stream: true,
          knowledgeBaseIds: ["kb-2"],
        } as never,
        res as never,
        req as never,
      );

      const writeCalls = res.write.mock.calls.map((c) => c[0] as string);
      const ragEvent = writeCalls.find((w) => w.includes("ragSources"));
      expect(ragEvent).toBeDefined();
    });

    it("includes web search sources in non-stream response", async () => {
      const res = makeResponse();
      const req = makeRequest();

      mockAiFacade.getModelById = jest.fn().mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content: "Web search answer",
        model: "gemini-pro",
      });
      mockSearchService.search.mockResolvedValue({
        success: true,
        results: [
          {
            title: "News Article",
            url: "https://news.com",
            content: "content",
          },
        ],
        provider: "brave",
      });
      mockSearchService.formatResultsForContext.mockReturnValue(
        "## Search\nNews Article",
      );

      await controller.simpleChat(
        { message: "Latest news?", stream: false, webSearch: true } as never,
        res as never,
        req as never,
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          usedWebSearch: true,
          webSearchSources: expect.arrayContaining([
            expect.objectContaining({ title: "News Article" }),
          ]),
        }),
      );
    });

    it("includes web search sources in stream SSE", async () => {
      const res = makeResponse();
      const req = makeRequest();

      mockAiFacade.getModelById = jest.fn().mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content: "Web search stream",
        model: "gemini-pro",
      });
      mockSearchService.search.mockResolvedValue({
        success: true,
        results: [{ title: "News", url: "https://news.com", content: "text" }],
        provider: "brave",
      });
      mockSearchService.formatResultsForContext.mockReturnValue("formatted");

      await controller.simpleChat(
        { message: "Latest news?", stream: true, webSearch: true } as never,
        res as never,
        req as never,
      );

      const writeCalls = res.write.mock.calls.map((c) => c[0] as string);
      const searchEvent = writeCalls.find((w) =>
        w.includes("webSearchSources"),
      );
      expect(searchEvent).toBeDefined();
    });

    it("does not include search context when search returns no results", async () => {
      const res = makeResponse();
      const req = makeRequest();

      mockAiFacade.getModelById = jest.fn().mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content: "No search",
        model: "gemini-pro",
      });
      mockSearchService.search.mockResolvedValue({
        success: true,
        results: [],
        provider: "brave",
      });

      await controller.simpleChat(
        { message: "Query", stream: false, webSearch: true } as never,
        res as never,
        req as never,
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.not.objectContaining({ usedWebSearch: true }),
      );
    });

    it("uses multi-turn context messages when provided", async () => {
      const res = makeResponse();
      const req = makeRequest();

      mockAiFacade.getModelById = jest.fn().mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content: "Multi-turn response",
        model: "gemini-pro",
      });

      const contextMessages = [
        { role: "user" as const, content: "first turn" },
        { role: "assistant" as const, content: "first response" },
        { role: "user" as const, content: "current turn" },
      ];

      await controller.simpleChat(
        {
          message: "current turn",
          messages: contextMessages,
          stream: false,
        } as never,
        res as never,
        req as never,
      );

      expect(mockAiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ content: "first turn" }),
          ]),
        }),
      );
    });

    it("uses legacy context string when provided without messages array", async () => {
      const res = makeResponse();
      const req = makeRequest();

      mockAiFacade.getModelById = jest.fn().mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content: "Context response",
        model: "gemini-pro",
      });

      await controller.simpleChat(
        {
          message: "What is this about?",
          context: "Background context here",
          stream: false,
        } as never,
        res as never,
        req as never,
      );

      expect(mockAiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            expect.objectContaining({
              content: expect.stringContaining("Background context here"),
            }),
          ],
        }),
      );
    });

    it("runs inside BillingContext when userId is provided", async () => {
      const res = makeResponse();
      const req = makeRequest({ user: { id: "user-billing" } });

      mockAiFacade.getModelById = jest.fn().mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content: "Billed response",
        model: "gemini-pro",
      });

      await controller.simpleChat(
        { message: "Hello", stream: false } as never,
        res as never,
        req as never,
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Billed response" }),
      );
    });

    it("wraps rate limit errors transparently in BadRequestException", async () => {
      const res = makeResponse();
      const req = makeRequest();

      mockAiFacade.getModelById = jest.fn().mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat = jest
        .fn()
        .mockRejectedValue(new Error("rate limit exceeded"));

      await expect(
        controller.simpleChat(
          { message: "Hi", stream: false } as never,
          res as never,
          req as never,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("quickAction", () => {
    it("throws BadRequestException when content is empty", async () => {
      await expect(
        controller.quickAction(
          { content: "", action: "summary" } as never,
          makeRequest() as never,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when content is whitespace only", async () => {
      await expect(
        controller.quickAction(
          { content: "   ", action: "summary" } as never,
          makeRequest() as never,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("returns summary content as raw string", async () => {
      mockAiFacade.getModelById = jest.fn().mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content: "Summary result",
        model: "gemini-pro",
      });

      const result = await controller.quickAction(
        { content: "Article text", action: "summary" } as never,
        makeRequest() as never,
      );

      expect(result.content).toBe("Summary result");
      expect(result.action).toBe("summary");
    });

    it("parses JSON array from insights response", async () => {
      mockAiFacade.getModelById = jest.fn().mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content:
          '[{"title":"Finding","description":"Key insight","importance":"high"}]',
        model: "gemini-pro",
      });

      const result = await controller.quickAction(
        { content: "Paper text", action: "insights" } as never,
        makeRequest() as never,
      );

      expect(Array.isArray(result.content)).toBe(true);
      expect((result.content as Array<{ title: string }>)[0].title).toBe(
        "Finding",
      );
    });

    it("parses JSON from markdown code block in methodology response", async () => {
      mockAiFacade.getModelById = jest.fn().mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content:
          '```json\n[{"title":"Method","description":"step","importance":"medium"}]\n```',
        model: "gemini-pro",
      });

      const result = await controller.quickAction(
        { content: "Research text", action: "methodology" } as never,
        makeRequest() as never,
      );

      expect(Array.isArray(result.content)).toBe(true);
      expect((result.content as Array<{ title: string }>)[0].title).toBe(
        "Method",
      );
    });

    it("returns empty array when JSON parse fails for insights", async () => {
      mockAiFacade.getModelById = jest.fn().mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content: "This is not JSON",
        model: "gemini-pro",
      });

      const result = await controller.quickAction(
        { content: "Article text", action: "insights" } as never,
        makeRequest() as never,
      );

      expect(result.content).toEqual([]);
    });

    it("falls back to default model when specified model not found", async () => {
      mockAiFacade.getModelById = jest.fn().mockResolvedValue(null);
      mockAiFacade.getDefaultTextModel = jest.fn().mockResolvedValue({
        id: "fallback-id",
        modelId: "gemini-flash",
        displayName: "Gemini Flash",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content: "Fallback summary",
        model: "gemini-flash",
      });

      const result = await controller.quickAction(
        { content: "Article", action: "summary", model: "unknown" } as never,
        makeRequest() as never,
      );

      expect(result.content).toBe("Fallback summary");
    });

    it("throws BadRequestException when no model available for quick action", async () => {
      mockAiFacade.getModelById = jest.fn().mockResolvedValue(null);
      mockAiFacade.getDefaultTextModel = jest.fn().mockResolvedValue(null);

      await expect(
        controller.quickAction(
          { content: "Text", action: "summary" } as never,
          makeRequest() as never,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("runs with BillingContext when user is authenticated", async () => {
      mockAiFacade.getModelById = jest.fn().mockResolvedValue({
        id: "db-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content: "Insights",
        model: "gemini-pro",
      });

      const result = await controller.quickAction(
        { content: "Article text", action: "summary" } as never,
        makeRequest({ user: { id: "user-quick" } }) as never,
      );

      expect(result.content).toBe("Insights");
    });
  });

  describe("summary", () => {
    it("throws BadRequestException when content is empty", async () => {
      await expect(
        controller.summary({ content: "" } as never, makeRequest() as never),
      ).rejects.toThrow(BadRequestException);
    });

    it("returns summary using CHAT_FAST model", async () => {
      mockAiFacade.getDefaultModelByType = jest.fn().mockResolvedValue({
        id: "fast-id",
        modelId: "gemini-flash",
        displayName: "Gemini Flash",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content: "Concise summary",
        model: "gemini-flash",
      });

      const result = await controller.summary(
        { content: "Long article" } as never,
        makeRequest() as never,
      );

      expect(result.summary).toBe("Concise summary");
      expect(result.tier).toBe("CHAT_FAST");
      expect(result.model_used).toBe("gemini-flash");
    });

    it("falls back to default text model when CHAT_FAST not available", async () => {
      mockAiFacade.getDefaultModelByType = jest.fn().mockResolvedValue(null);
      mockAiFacade.getDefaultTextModel = jest.fn().mockResolvedValue({
        id: "chat-id",
        modelId: "gemini-pro",
        displayName: "Gemini Pro",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content: "Fallback summary",
        model: "gemini-pro",
      });

      const result = await controller.summary(
        { content: "Long article" } as never,
        makeRequest() as never,
      );

      expect(result.summary).toBe("Fallback summary");
    });

    it("throws BadRequestException when no model is available", async () => {
      mockAiFacade.getDefaultModelByType = jest.fn().mockResolvedValue(null);
      mockAiFacade.getDefaultTextModel = jest.fn().mockResolvedValue(null);

      await expect(
        controller.summary(
          { content: "Long article" } as never,
          makeRequest() as never,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("uses Chinese prompt for zh language (default)", async () => {
      mockAiFacade.getDefaultModelByType = jest.fn().mockResolvedValue({
        id: "fast-id",
        modelId: "gemini-flash",
        displayName: "Gemini Flash",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content: "中文摘要",
        model: "gemini-flash",
      });

      await controller.summary(
        { content: "Content" } as never,
        makeRequest() as never,
      );

      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      expect(chatCall.messages[0].content).toContain("请为以下内容");
    });

    it("uses English prompt for en language", async () => {
      mockAiFacade.getDefaultModelByType = jest.fn().mockResolvedValue({
        id: "fast-id",
        modelId: "gemini-flash",
        displayName: "Gemini Flash",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content: "English summary",
        model: "gemini-flash",
      });

      await controller.summary(
        { content: "Content", language: "en" } as never,
        makeRequest() as never,
      );

      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      expect(chatCall.messages[0].content).toContain("concise summary");
    });
  });

  describe("insights", () => {
    it("throws BadRequestException when content is empty", async () => {
      await expect(
        controller.insights({ content: "" } as never, makeRequest() as never),
      ).rejects.toThrow(BadRequestException);
    });

    it("returns parsed insights array from JSON response", async () => {
      mockAiFacade.getDefaultModelByType = jest.fn().mockResolvedValue({
        id: "fast-id",
        modelId: "gemini-flash",
        displayName: "Gemini Flash",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content:
          '[{"title":"Key Insight","description":"Important finding","importance":"high"}]',
        model: "gemini-flash",
      });

      const result = await controller.insights(
        { content: "Research article" } as never,
        makeRequest() as never,
      );

      expect(Array.isArray(result.insights)).toBe(true);
      expect(result.insights[0].title).toBe("Key Insight");
      expect(result.tier).toBe("CHAT_FAST");
    });

    it("returns empty array when JSON parse fails", async () => {
      mockAiFacade.getDefaultModelByType = jest.fn().mockResolvedValue({
        id: "fast-id",
        modelId: "gemini-flash",
        displayName: "Gemini Flash",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content: "Plain text not JSON",
        model: "gemini-flash",
      });

      const result = await controller.insights(
        { content: "Article" } as never,
        makeRequest() as never,
      );

      expect(result.insights).toEqual([]);
    });

    it("throws BadRequestException when no model available", async () => {
      mockAiFacade.getDefaultModelByType = jest.fn().mockResolvedValue(null);
      mockAiFacade.getDefaultTextModel = jest.fn().mockResolvedValue(null);

      await expect(
        controller.insights(
          { content: "Article" } as never,
          makeRequest() as never,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("uses English insights prompt for non-zh language", async () => {
      mockAiFacade.getDefaultModelByType = jest.fn().mockResolvedValue({
        id: "fast-id",
        modelId: "gemini-flash",
        displayName: "Gemini Flash",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content: "[]",
        model: "gemini-flash",
      });

      await controller.insights(
        { content: "Article", language: "en" } as never,
        makeRequest() as never,
      );

      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      expect(chatCall.messages[0].content).toContain("Output in English");
    });
  });

  describe("translate", () => {
    it("throws BadRequestException when text is empty", async () => {
      await expect(
        controller.translate(
          { text: "", targetLanguage: "zh" } as never,
          makeRequest() as never,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when targetLanguage is missing", async () => {
      await expect(
        controller.translate(
          { text: "Hello", targetLanguage: "" } as never,
          makeRequest() as never,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("returns translation with aliases", async () => {
      mockAiFacade.getDefaultModelByType = jest.fn().mockResolvedValue({
        id: "fast-id",
        modelId: "gemini-flash",
        displayName: "Gemini Flash",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content: "  Bonjour le monde  ",
        model: "gemini-flash",
      });

      const result = await controller.translate(
        {
          text: "Hello world",
          targetLanguage: "fr",
          sourceLanguage: "en",
        } as never,
        makeRequest() as never,
      );

      expect(result.translation).toBe("Bonjour le monde");
      expect(result.translatedText).toBe("Bonjour le monde");
      expect(result.targetLanguage).toBe("fr");
      expect(result.sourceLanguage).toBe("en");
    });

    it("maps known language codes in the prompt", async () => {
      mockAiFacade.getDefaultModelByType = jest.fn().mockResolvedValue({
        id: "fast-id",
        modelId: "gemini-flash",
        displayName: "Gemini Flash",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content: "日本語",
        model: "gemini-flash",
      });

      await controller.translate(
        { text: "Hello", targetLanguage: "ja" } as never,
        makeRequest() as never,
      );

      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      expect(chatCall.messages[0].content).toContain("Japanese");
    });

    it("throws BadRequestException when no model available", async () => {
      mockAiFacade.getDefaultModelByType = jest.fn().mockResolvedValue(null);
      mockAiFacade.getDefaultTextModel = jest.fn().mockResolvedValue(null);

      await expect(
        controller.translate(
          { text: "Hello", targetLanguage: "fr" } as never,
          makeRequest() as never,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("sets sourceLanguage to auto when not provided", async () => {
      mockAiFacade.getDefaultModelByType = jest.fn().mockResolvedValue({
        id: "fast-id",
        modelId: "gemini-flash",
        displayName: "Gemini Flash",
        provider: "google",
      });
      mockAiFacade.chat = jest.fn().mockResolvedValue({
        content: "Translated",
        model: "gemini-flash",
      });

      const result = await controller.translate(
        { text: "Hello", targetLanguage: "zh" } as never,
        makeRequest() as never,
      );

      expect(result.sourceLanguage).toBe("auto");
    });
  });

  describe("translateSingle", () => {
    it("throws BadRequestException when text is empty", async () => {
      await expect(
        controller.translateSingle(
          { text: "" } as never,
          makeRequest() as never,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("returns translation result with all fields", async () => {
      mockAiCoreService.translateText = jest.fn().mockResolvedValue("你好世界");

      const result = await controller.translateSingle(
        { text: "Hello world", targetLang: "zh-CN", sourceLang: "en" } as never,
        makeRequest() as never,
      );

      expect(result.original).toBe("Hello world");
      expect(result.translation).toBe("你好世界");
      expect(result.targetLang).toBe("zh-CN");
      expect(result.sourceLang).toBe("en");
    });

    it("uses defaults when targetLang and sourceLang not specified", async () => {
      mockAiCoreService.translateText = jest.fn().mockResolvedValue("默认翻译");

      const result = await controller.translateSingle(
        { text: "Hello" } as never,
        makeRequest() as never,
      );

      expect(result.targetLang).toBe("zh-CN");
      expect(result.sourceLang).toBe("en");
    });

    it("propagates HttpException from translateText service", async () => {
      const { HttpException, HttpStatus } = await import("@nestjs/common");
      mockAiCoreService.translateText = jest
        .fn()
        .mockRejectedValue(
          new HttpException(
            "Service Unavailable",
            HttpStatus.SERVICE_UNAVAILABLE,
          ),
        );

      await expect(
        controller.translateSingle(
          { text: "Hello" } as never,
          makeRequest() as never,
        ),
      ).rejects.toThrow(HttpException);
    });

    it("wraps unexpected errors in BadRequestException", async () => {
      mockAiCoreService.translateText = jest
        .fn()
        .mockRejectedValue(new Error("DB connection failed"));

      await expect(
        controller.translateSingle(
          { text: "Hello" } as never,
          makeRequest() as never,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("runs inside BillingContext when user is authenticated", async () => {
      mockAiCoreService.translateText = jest
        .fn()
        .mockResolvedValue("Billed translation");

      const result = await controller.translateSingle(
        { text: "Hello", targetLang: "fr" } as never,
        makeRequest({ user: { id: "user-translate" } }) as never,
      );

      expect(result.translation).toBe("Billed translation");
    });
  });
});
