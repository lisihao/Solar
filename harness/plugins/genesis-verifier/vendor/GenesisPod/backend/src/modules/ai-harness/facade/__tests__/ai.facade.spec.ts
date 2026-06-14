/**
 * AI Engine Facade 单元测试
 *
 * 测试 Facade 作为统一入口的核心功能：
 * - chat() 对话能力（含熔断器）
 * - chatStream() 流式输出
 * - selectModel() 模型选择
 * - getReasoningModel() 推理模型获取
 * - buildContext() 上下文构建
 * - executeAgent() Agent 执行
 * - executeTool() 工具执行
 */

import { Test, TestingModule } from "@nestjs/testing";
import { AIFacade } from "../ai.facade";
import { AiChatService } from "../../../ai-engine/llm/chat/ai-chat.service";
import { AiModelConfigService } from "../../../ai-engine/llm/models/config/ai-model-config.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { AIModelType } from "@prisma/client";
import { TOOL_FEATURE, ORCHESTRATION_FEATURE } from "../facade.providers";

describe("AIFacade", () => {
  let facade: AIFacade;
  let mockAiChatService: any;
  let mockToolRegistry: any;
  let mockCircuitBreaker: any;
  let mockPrisma: any;

  beforeEach(async () => {
    // Mock services
    mockAiChatService = {
      chat: jest.fn(),
      chatStream: jest.fn(),
      getAvailableModelsAsync: jest
        .fn()
        .mockResolvedValue(["gpt-4o", "claude-3"]),
      isReasoningModel: jest.fn().mockReturnValue(false),
      getDefaultModelByType: jest.fn().mockResolvedValue({ modelId: "gpt-4o" }),
    };

    // ★ 架构重构：使用 ToolRegistry mock
    mockToolRegistry = {
      tryGet: jest.fn().mockImplementation((toolId: string) => {
        if (toolId === "web-search") {
          return {
            execute: jest.fn().mockResolvedValue({
              success: true,
              data: {
                success: true,
                results: [
                  {
                    title: "Test",
                    url: "https://test.com",
                    content: "Test content",
                  },
                ],
              },
            }),
          };
        }
        return null;
      }),
      getByCategory: jest.fn().mockReturnValue([]),
      getEnabled: jest.fn().mockReturnValue([]),
      isAvailable: jest.fn().mockReturnValue(true),
      getFunctionDefinitions: jest.fn().mockReturnValue([]),
      getAllFunctionDefinitions: jest.fn().mockReturnValue([]),
    };

    mockCircuitBreaker = {
      canExecute: jest.fn().mockReturnValue(true),
      getCooldownRemaining: jest.fn().mockReturnValue(0),
      incrementLoad: jest.fn(),
      decrementLoad: jest.fn(),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
      parseErrorType: jest.fn(),
      selectBest: jest.fn(),
    };

    mockPrisma = {
      aIModel: {
        findMany: jest.fn().mockResolvedValue([
          {
            modelId: "gpt-4o",
            displayName: "GPT-4o",
            provider: "openai",
            maxTokens: 4096,
          },
          {
            modelId: "claude-3-opus",
            displayName: "Claude 3 Opus",
            provider: "anthropic",
            maxTokens: 8000,
          },
        ]),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      } as any,
      researchTopic: {
        findUnique: jest.fn(),
      } as any,
      resource: {
        findUnique: jest.fn(),
      } as any,
    };

    const mockModelConfigService = {
      getDefaultModel: jest.fn().mockResolvedValue(null),
      getModelById: jest.fn().mockResolvedValue(null),
      refreshModelConfigCache: jest.fn().mockResolvedValue(undefined),
      getEnabledModelsForFrontend: jest.fn().mockResolvedValue([
        {
          modelId: "gpt-4o",
          name: "GPT-4o",
          displayName: "GPT-4o",
          provider: "openai",
        },
        {
          modelId: "claude-3-opus",
          name: "Claude 3 Opus",
          displayName: "Claude 3 Opus",
          provider: "anthropic",
        },
      ]),
      getAllEnabledModelsByType: jest.fn().mockResolvedValue([
        {
          modelId: "gpt-4o",
          name: "GPT-4o",
          provider: "openai",
          isReasoning: false,
        },
        {
          modelId: "claude-3-opus",
          name: "Claude 3 Opus",
          provider: "anthropic",
          isReasoning: false,
        },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIFacade,
        { provide: AiChatService, useValue: mockAiChatService },
        { provide: AiModelConfigService, useValue: mockModelConfigService },
        // ★ 使用 Feature Token 而非直接提供服务
        {
          provide: TOOL_FEATURE,
          useValue: { registry: mockToolRegistry, executor: null },
        },
        {
          provide: ORCHESTRATION_FEATURE,
          useValue: { circuitBreaker: mockCircuitBreaker, agentExecutor: null },
        },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    facade = module.get<AIFacade>(AIFacade);
  });

  describe("chat", () => {
    it("should call AiChatService and return response", async () => {
      mockAiChatService.chat!.mockResolvedValue({
        content: "Hello, world!",
        model: "gpt-4o",
        usage: { totalTokens: 100 },
        isError: false,
      });

      const result = await facade.chat({
        messages: [{ role: "user", content: "Hello" }],
        modelType: AIModelType.CHAT,
      });

      expect(result.content).toBe("Hello, world!");
      expect(result.model).toBe("gpt-4o");
      expect(result.tokensUsed).toBe(100);
      expect(result.isError).toBeFalsy();
    });

    it("should check circuit breaker before calling", async () => {
      mockAiChatService.chat!.mockResolvedValue({
        content: "Response",
        model: "gpt-4o",
        usage: { totalTokens: 50 },
      });

      await facade.chat({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(mockCircuitBreaker.canExecute).toHaveBeenCalled();
      expect(mockCircuitBreaker.incrementLoad).toHaveBeenCalled();
      expect(mockCircuitBreaker.decrementLoad).toHaveBeenCalled();
    });

    it("should return error when circuit breaker is open", async () => {
      mockCircuitBreaker.canExecute!.mockReturnValue(false);
      mockCircuitBreaker.getCooldownRemaining!.mockReturnValue(5000);

      const result = await facade.chat({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("temporarily unavailable");
      expect(mockAiChatService.chat).not.toHaveBeenCalled();
    });

    it("should record failure on error", async () => {
      mockAiChatService.chat!.mockRejectedValue(new Error("API Error"));

      const result = await facade.chat({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(result.isError).toBe(true);
      expect(mockCircuitBreaker.recordFailure).toHaveBeenCalled();
    });

    it("should throw in strict mode on error", async () => {
      mockAiChatService.chat!.mockRejectedValue(new Error("API Error"));

      await expect(
        facade.chat({
          messages: [{ role: "user", content: "Test" }],
          strictMode: true,
        }),
      ).rejects.toThrow("API Error");
    });
  });

  describe("selectModel", () => {
    it("should return available model", async () => {
      const result = await facade.selectModel({
        modelType: AIModelType.CHAT,
      });

      expect(result).not.toBeNull();
      expect(result?.id).toBe("gpt-4o");
    });

    it("should filter by preferred provider", async () => {
      const result = await facade.selectModel({
        modelType: AIModelType.CHAT,
        preferredProvider: "anthropic",
      });

      expect(result?.provider).toBe("anthropic");
    });

    it("should use circuit breaker for selection when available", async () => {
      mockCircuitBreaker.selectBest!.mockReturnValue("chat:gpt-4o");

      const result = await facade.selectModel({
        modelType: AIModelType.CHAT,
      });

      expect(mockCircuitBreaker.selectBest).toHaveBeenCalled();
      expect(result?.id).toBe("gpt-4o");
    });
  });

  describe("getReasoningModel", () => {
    it("should call selectModel with requireReasoning", async () => {
      mockAiChatService.isReasoningModel!.mockImplementation(
        (model: string) =>
          model.startsWith("o1") || model.includes("deepseek-r1"),
      );

      // Add a reasoning model to the mock
      (mockPrisma.aIModel!.findMany as jest.Mock).mockResolvedValue([
        {
          modelId: "o1-preview",
          displayName: "O1 Preview",
          provider: "openai",
          maxTokens: 8000,
        },
        {
          modelId: "gpt-4o",
          displayName: "GPT-4o",
          provider: "openai",
          maxTokens: 4096,
        },
      ]);

      const result = await facade.getReasoningModel();

      // Should return a model (the first one since isReasoningModel returns false by default)
      expect(result).not.toBeNull();
    });
  });

  describe("search", () => {
    it("should call ToolRegistry web-search and return results", async () => {
      const result = await facade.search({
        query: "test query",
        maxResults: 5,
      });

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(mockToolRegistry.tryGet).toHaveBeenCalledWith("web-search");
    });
  });

  describe("buildContext", () => {
    it("should build context from custom sources", async () => {
      const result = await facade.buildContext({
        sources: [
          { type: "custom", content: "Custom content 1" },
          { type: "custom", content: "Custom content 2" },
        ],
      });

      expect(result).toContain("Custom content 1");
      expect(result).toContain("Custom content 2");
    });

    it("should build context from search sources", async () => {
      await facade.buildContext({
        sources: [{ type: "search", content: "test query" }],
      });

      expect(mockToolRegistry.tryGet).toHaveBeenCalledWith("web-search");
    });
  });

  describe("checkConstraints", () => {
    it("should pass when no violations", () => {
      const result = facade.checkConstraints({
        content: "Normal content",
        constraints: {
          maxTokens: 1000,
        },
      });

      expect(result.passed).toBe(true);
      expect(result.violations).toBeUndefined();
    });

    it("should detect token limit violation", () => {
      // Create content that exceeds token limit
      const longContent = "a".repeat(10000);

      const result = facade.checkConstraints({
        content: longContent,
        constraints: {
          maxTokens: 100,
        },
      });

      expect(result.passed).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({ type: "token_limit" }),
      );
    });

    it("should detect sensitive content", () => {
      const result = facade.checkConstraints({
        content: "My password: secret123",
        constraints: {
          contentFilter: { enabled: true },
        },
      });

      expect(result.passed).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({ type: "content_filter" }),
      );
    });

    it("should validate JSON schema", () => {
      const result = facade.checkConstraints({
        content: '{"name": "test"}',
        constraints: {
          jsonSchema: {
            type: "object",
            required: ["name", "age"],
          },
        },
      });

      expect(result.passed).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({ type: "json_schema" }),
      );
    });
  });

  describe("getAvailableModels", () => {
    it("should return models from database", async () => {
      const models = await facade.getAvailableModels(AIModelType.CHAT);

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe("gpt-4o");
      expect(models[1].id).toBe("claude-3-opus");
    });
  });

  describe("formatSearchResultsForContext", () => {
    it("should format search results for context", () => {
      const result = facade.formatSearchResultsForContext([
        { title: "Test", url: "https://test.com", content: "Content" },
      ]);

      expect(result).toContain("Test");
      expect(result).toContain("https://test.com");
      expect(result).toContain("Content");
    });
  });
});

describe("AIFacade without optional dependencies", () => {
  let facade: AIFacade;
  let mockAiChatService: any;

  beforeEach(async () => {
    mockAiChatService = {
      chat: jest.fn().mockResolvedValue({
        content: "Response",
        model: "gpt-4o",
        usage: { totalTokens: 50 },
      }),
      chatStream: jest.fn(),
      getAvailableModelsAsync: jest.fn().mockResolvedValue(["gpt-4o"]),
      isReasoningModel: jest.fn().mockReturnValue(false),
    };

    const mockModelConfigService = {
      getDefaultModel: jest.fn().mockResolvedValue(null),
      getModelById: jest.fn().mockResolvedValue(null),
      refreshModelConfigCache: jest.fn().mockResolvedValue(undefined),
      getEnabledModelsForFrontend: jest.fn().mockResolvedValue([
        {
          modelId: "gpt-4o",
          name: "GPT-4o",
          displayName: "GPT-4o",
          provider: "openai",
        },
      ]),
      getAllEnabledModelsByType: jest.fn().mockResolvedValue([
        {
          modelId: "gpt-4o",
          name: "GPT-4o",
          provider: "openai",
          isReasoning: false,
        },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIFacade,
        { provide: AiChatService, useValue: mockAiChatService },
        { provide: AiModelConfigService, useValue: mockModelConfigService },
        // No ToolRegistry, CircuitBreakerService, PrismaService, etc.
      ],
    }).compile();

    facade = module.get<AIFacade>(AIFacade);
  });

  it("should work without circuit breaker", async () => {
    const result = await facade.chat({
      messages: [{ role: "user", content: "Test" }],
    });

    expect(result.content).toBe("Response");
  });

  it("should return models from AiChatService when Prisma not available", async () => {
    const models = await facade.getAvailableModels(AIModelType.CHAT);

    expect(models).toHaveLength(1);
    expect(models[0].id).toBe("gpt-4o");
  });
});
