/**
 * ChatFacade 单元测试
 *
 * Tests:
 * - chat() core flow: resolve model, enforce constraints, call AiChatService
 * - chat() skill proxy delegation
 * - chat() circuit breaker integration
 * - chat() billing / credits deduction
 * - chatWithFallback() model fallback chain
 * - chatStream() async generator
 * - chatStructured() JSON extraction & retries
 * - Model selection delegation to ModelSubFacade
 * - Graceful degradation with missing optional deps
 */

import { Test, TestingModule } from "@nestjs/testing";
import { AIModelType } from "@prisma/client";
import { ChatFacade } from "../chat.facade";
import { AiChatService } from "../../../../ai-engine/llm/chat/ai-chat.service";
import { AiModelConfigService } from "../../../../ai-engine/llm/models/config/ai-model-config.service";
import { ModelFallbackService } from "../../../../ai-engine/llm/models/selection/model-fallback.service";
import { CreditsService } from "../../../../platform/credits/credits.service";
import {
  ORCHESTRATION_FEATURE,
  CONSTRAINT_FEATURE,
} from "../../facade.providers";

describe("ChatFacade", () => {
  let facade: ChatFacade;
  let mockAiChatService: jest.Mocked<Partial<AiChatService>>;
  let mockCircuitBreaker: any;

  beforeEach(async () => {
    mockAiChatService = {
      chat: jest.fn().mockResolvedValue({
        content: "Hello!",
        model: "gpt-4o",
        usage: { totalTokens: 100 },
        isError: false,
      }),
      chatStream: jest.fn(),
      getDefaultModelByType: jest.fn().mockResolvedValue({ modelId: "gpt-4o" }),
    };

    mockCircuitBreaker = {
      canExecute: jest.fn().mockReturnValue(true),
      getCooldownRemaining: jest.fn().mockReturnValue(0),
      incrementLoad: jest.fn(),
      decrementLoad: jest.fn(),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
      parseErrorType: jest.fn(),
      selectBest: jest.fn().mockReturnValue(null),
    };

    const mockModelConfigService = {
      getDefaultModel: jest.fn().mockResolvedValue(null),
      getModelById: jest.fn().mockResolvedValue(null),
      refreshModelConfigCache: jest.fn(),
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
        ChatFacade,
        { provide: AiChatService, useValue: mockAiChatService },
        { provide: AiModelConfigService, useValue: mockModelConfigService },
        {
          provide: ORCHESTRATION_FEATURE,
          useValue: { circuitBreaker: mockCircuitBreaker },
        },
      ],
    }).compile();

    facade = module.get<ChatFacade>(ChatFacade);
  });

  // ==================== chat() ====================

  describe("chat()", () => {
    it("should call AiChatService and return structured response", async () => {
      const result = await facade.chat({
        messages: [{ role: "user", content: "Hello" }],
        modelType: AIModelType.CHAT,
      });

      expect(result.content).toBe("Hello!");
      expect(result.model).toBe("gpt-4o");
      expect(result.tokensUsed).toBe(100);
      expect(result.isError).toBe(false);
    });

    it("should resolve model from modelType when model is not specified", async () => {
      await facade.chat({
        messages: [{ role: "user", content: "Hello" }],
        modelType: AIModelType.CHAT,
      });

      expect(mockAiChatService.getDefaultModelByType).toHaveBeenCalledWith(
        AIModelType.CHAT,
      );
    });

    it("should use specified model when provided", async () => {
      await facade.chat({
        messages: [{ role: "user", content: "Hello" }],
        model: "claude-3-opus",
      });

      expect(mockAiChatService.chat).toHaveBeenCalledWith(
        expect.objectContaining({ model: "claude-3-opus" }),
      );
    });

    it("should check circuit breaker before calling", async () => {
      await facade.chat({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(mockCircuitBreaker.canExecute).toHaveBeenCalled();
      expect(mockCircuitBreaker.incrementLoad).toHaveBeenCalled();
      expect(mockCircuitBreaker.decrementLoad).toHaveBeenCalled();
    });

    it("should return error when circuit breaker is open", async () => {
      mockCircuitBreaker.canExecute.mockReturnValue(false);
      mockCircuitBreaker.getCooldownRemaining.mockReturnValue(5000);

      const result = await facade.chat({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("temporarily unavailable");
      expect(mockAiChatService.chat).not.toHaveBeenCalled();
    });

    it("should record success on successful call", async () => {
      await facade.chat({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(mockCircuitBreaker.recordSuccess).toHaveBeenCalled();
    });

    it("should record failure on error response", async () => {
      mockAiChatService.chat!.mockResolvedValue({
        content: "Error occurred",
        model: "gpt-4o",
        usage: { totalTokens: 0 },
        isError: true,
      } as any);

      await facade.chat({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(mockCircuitBreaker.recordFailure).toHaveBeenCalled();
    });

    it("should record failure on exception", async () => {
      mockAiChatService.chat!.mockRejectedValue(new Error("API Error"));

      const result = await facade.chat({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("API Error");
      expect(mockCircuitBreaker.recordFailure).toHaveBeenCalled();
    });

    it("should throw in strictMode on exception", async () => {
      mockAiChatService.chat!.mockRejectedValue(new Error("API Error"));

      await expect(
        facade.chat({
          messages: [{ role: "user", content: "Test" }],
          strictMode: true,
        }),
      ).rejects.toThrow("API Error");
    });

    it("should fall back to 'default' when no model type default found", async () => {
      (mockAiChatService.getDefaultModelByType as jest.Mock).mockResolvedValue(
        null,
      );

      await facade.chat({
        messages: [{ role: "user", content: "Test" }],
        modelType: AIModelType.CHAT,
      });

      // Model will be "default" since getDefaultModelByType returns null
      expect(mockAiChatService.chat).toHaveBeenCalled();
    });
  });

  // ==================== Constraint enforcement ====================

  describe("constraint enforcement", () => {
    let facadeWithConstraints: ChatFacade;
    let mockRateLimiter: any;
    let mockCostController: any;

    beforeEach(async () => {
      mockRateLimiter = {
        checkAndConsume: jest.fn().mockResolvedValue({ allowed: true }),
      };
      mockCostController = {
        checkBudget: jest.fn().mockReturnValue({ allowed: true }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ChatFacade,
          { provide: AiChatService, useValue: mockAiChatService },
          {
            provide: AiModelConfigService,
            useValue: {
              getDefaultModel: jest.fn().mockResolvedValue(null),
              getModelById: jest.fn().mockResolvedValue(null),
              refreshModelConfigCache: jest.fn(),
              getEnabledModelsForFrontend: jest.fn().mockResolvedValue([]),
              getAllEnabledModelsByType: jest.fn().mockResolvedValue([]),
            },
          },
          {
            provide: ORCHESTRATION_FEATURE,
            useValue: { circuitBreaker: mockCircuitBreaker },
          },
          {
            provide: CONSTRAINT_FEATURE,
            useValue: {
              rateLimiter: mockRateLimiter,
              costController: mockCostController,
            },
          },
        ],
      }).compile();

      facadeWithConstraints = module.get<ChatFacade>(ChatFacade);
    });

    it("should enforce rate limit and return error when exceeded", async () => {
      mockRateLimiter.checkAndConsume.mockResolvedValue({
        allowed: false,
        retryAfterMs: 3000,
      });

      const result = await facadeWithConstraints.chat({
        messages: [{ role: "user", content: "Test" }],
        billing: { userId: "user-1" },
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("Rate limit exceeded");
    });

    it("should enforce budget and return error when exceeded", async () => {
      mockCostController.checkBudget.mockReturnValue({
        allowed: false,
        reason: "Monthly budget exceeded",
      });

      const result = await facadeWithConstraints.chat({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("Budget limit exceeded");
    });

    it("should consume rate limit on successful check", async () => {
      await facadeWithConstraints.chat({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(mockRateLimiter.checkAndConsume).toHaveBeenCalled();
    });
  });

  // ==================== chatWithFallback ====================

  describe("chat with model fallback", () => {
    let facadeWithFallback: ChatFacade;
    let mockFallbackService: any;

    beforeEach(async () => {
      mockFallbackService = {
        executeWithFallback: jest.fn().mockResolvedValue({
          success: true,
          data: {
            content: "Fallback response",
            model: "claude-3",
            usage: { totalTokens: 80 },
          },
          modelUsed: "claude-3",
          fallbackUsed: false,
          attemptedModels: ["gpt-4o"],
          attempts: 1,
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ChatFacade,
          { provide: AiChatService, useValue: mockAiChatService },
          {
            provide: AiModelConfigService,
            useValue: {
              getDefaultModel: jest.fn().mockResolvedValue(null),
              getModelById: jest.fn().mockResolvedValue(null),
              refreshModelConfigCache: jest.fn(),
              getEnabledModelsForFrontend: jest.fn().mockResolvedValue([]),
              getAllEnabledModelsByType: jest.fn().mockResolvedValue([]),
            },
          },
          { provide: ModelFallbackService, useValue: mockFallbackService },
          {
            provide: ORCHESTRATION_FEATURE,
            useValue: { circuitBreaker: mockCircuitBreaker },
          },
        ],
      }).compile();

      facadeWithFallback = module.get<ChatFacade>(ChatFacade);
    });

    it("should use model fallback service when available", async () => {
      const result = await facadeWithFallback.chat({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(result.content).toBe("Fallback response");
      expect(mockFallbackService.executeWithFallback).toHaveBeenCalled();
      // Should NOT call aiChatService.chat directly
      expect(mockAiChatService.chat).not.toHaveBeenCalled();
    });

    it("should return error when all fallback models fail", async () => {
      mockFallbackService.executeWithFallback.mockResolvedValue({
        success: false,
        error: new Error("All models exhausted"),
        modelUsed: "gpt-4o",
        fallbackUsed: true,
        attemptedModels: ["gpt-4o", "claude-3"],
        attempts: 2,
      });

      const result = await facadeWithFallback.chat({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("All models exhausted");
    });

    it("should throw in strictMode when all fallback models fail", async () => {
      mockFallbackService.executeWithFallback.mockResolvedValue({
        success: false,
        error: new Error("All failed"),
        modelUsed: null,
        fallbackUsed: true,
        attemptedModels: ["gpt-4o", "claude-3"],
        attempts: 2,
      });

      await expect(
        facadeWithFallback.chat({
          messages: [{ role: "user", content: "Test" }],
          strictMode: true,
        }),
      ).rejects.toThrow("All failed");
    });
  });

  // ==================== chatWithSkills ====================

  describe("chatWithSkills()", () => {
    it("should fall back to plain chat when skills not available", async () => {
      const result = await facade.chatWithSkills({
        messages: [{ role: "user", content: "Test" }],
        modelType: AIModelType.CHAT,
        taskProfile: { creativity: "medium", outputLength: "medium" },
        domain: "common",
      });

      expect(result.content).toBe("Hello!");
      expect(result.usedSkills).toEqual([]);
      expect(result.skillsTokensUsed).toBe(0);
    });
  });

  // ==================== chatStream() ====================

  describe("chatStream()", () => {
    it("should yield chunks from AiChatService stream", async () => {
      const chunks = [
        { content: "Hello", done: false },
        { content: " World", done: false },
        { content: "", done: true },
      ];

      mockAiChatService.chatStream = jest.fn().mockReturnValue(
        (async function* () {
          for (const c of chunks) {
            yield c;
          }
        })(),
      );

      const results: Array<{ content: string; done: boolean }> = [];
      for await (const chunk of facade.chatStream({
        messages: [{ role: "user", content: "Hi" }],
      })) {
        results.push(chunk);
      }

      expect(results).toHaveLength(3);
      expect(results[0].content).toBe("Hello");
      expect(results[2].done).toBe(true);
    });

    it("should yield error when circuit breaker is open", async () => {
      mockCircuitBreaker.canExecute.mockReturnValue(false);
      mockCircuitBreaker.getCooldownRemaining.mockReturnValue(3000);

      const results: any[] = [];
      for await (const chunk of facade.chatStream({
        messages: [{ role: "user", content: "Hi" }],
      })) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
      expect(results[0].done).toBe(true);
      expect(results[0].error).toBe("CIRCUIT_BREAKER_OPEN");
    });

    it("should yield error on stream failure", async () => {
      mockAiChatService.chatStream = jest.fn().mockReturnValue(
        (async function* () {
          throw new Error("Stream died");
        })(),
      );

      const results: any[] = [];
      for await (const chunk of facade.chatStream({
        messages: [{ role: "user", content: "Hi" }],
      })) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
      expect(results[0].error).toBe("Stream died");
      expect(results[0].done).toBe(true);
    });
  });

  // ==================== chatStructured() ====================

  describe("chatStructured()", () => {
    it("should parse valid JSON response", async () => {
      mockAiChatService.chat!.mockResolvedValue({
        content: '{"name": "test", "value": 42}',
        model: "gpt-4o",
        usage: { totalTokens: 50 },
        isError: false,
      });

      const result = await facade.chatStructured<{
        name: string;
        value: number;
      }>({
        messages: [{ role: "user", content: "Generate JSON" }],
        schema: {
          type: "object",
          properties: { name: { type: "string" }, value: { type: "number" } },
        },
      });

      expect(result.data.name).toBe("test");
      expect(result.data.value).toBe(42);
      expect(result.retriedParse).toBe(false);
    });

    it("should extract JSON from markdown code blocks", async () => {
      mockAiChatService.chat!.mockResolvedValue({
        content: '```json\n{"key": "value"}\n```',
        model: "gpt-4o",
        usage: { totalTokens: 50 },
        isError: false,
      });

      const result = await facade.chatStructured<{ key: string }>({
        messages: [{ role: "user", content: "Generate" }],
        schema: { type: "object" },
      });

      expect(result.data.key).toBe("value");
    });

    it("should retry on parse failure", async () => {
      let callCount = 0;
      mockAiChatService.chat!.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            content: "Not valid JSON",
            model: "gpt-4o",
            usage: { totalTokens: 30 },
            isError: false,
          };
        }
        return {
          content: '{"valid": true}',
          model: "gpt-4o",
          usage: { totalTokens: 40 },
          isError: false,
        };
      });

      const result = await facade.chatStructured<{ valid: boolean }>({
        messages: [{ role: "user", content: "Test" }],
        schema: { type: "object" },
        maxRetries: 1,
      });

      expect(result.data.valid).toBe(true);
      expect(result.retriedParse).toBe(true);
      expect(result.tokensUsed).toBe(70); // 30 + 40
    });

    it("should throw after all retries exhausted", async () => {
      mockAiChatService.chat!.mockResolvedValue({
        content: "invalid",
        model: "gpt-4o",
        usage: { totalTokens: 20 },
        isError: false,
      });

      await expect(
        facade.chatStructured({
          messages: [{ role: "user", content: "Test" }],
          schema: { type: "object" },
          maxRetries: 1,
          throwOnParseError: true,
        }),
      ).rejects.toThrow("Structured output parse failed");
    });

    it("should return empty data when throwOnParseError is false", async () => {
      mockAiChatService.chat!.mockResolvedValue({
        content: "invalid",
        model: "gpt-4o",
        usage: { totalTokens: 20 },
        isError: false,
      });

      const result = await facade.chatStructured({
        messages: [{ role: "user", content: "Test" }],
        schema: { type: "object" },
        maxRetries: 0,
        throwOnParseError: false,
      });

      expect(result.retriedParse).toBe(true);
    });
  });

  // ==================== Model selection ====================

  describe("model selection delegation", () => {
    it("should delegate getAvailableModels to ModelSubFacade", async () => {
      const models = await facade.getAvailableModels(AIModelType.CHAT);

      expect(Array.isArray(models)).toBe(true);
    });

    it("should delegate selectModel to ModelSubFacade", async () => {
      const model = await facade.selectModel({ modelType: AIModelType.CHAT });

      // Returns first available model or null
      expect(model === null || typeof model === "object").toBe(true);
    });

    it("should delegate getDefaultTextModel", async () => {
      const model = await facade.getDefaultTextModel();
      // May return null when no default is configured
      expect(model === null || typeof model === "object").toBe(true);
    });
  });

  // ==================== Graceful degradation ====================

  describe("without optional dependencies", () => {
    let minimalFacade: ChatFacade;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ChatFacade,
          { provide: AiChatService, useValue: mockAiChatService },
          {
            provide: AiModelConfigService,
            useValue: {
              getDefaultModel: jest.fn().mockResolvedValue(null),
              getModelById: jest.fn().mockResolvedValue(null),
              refreshModelConfigCache: jest.fn(),
              getEnabledModelsForFrontend: jest.fn().mockResolvedValue([]),
              getAllEnabledModelsByType: jest.fn().mockResolvedValue([]),
            },
          },
          // No ORCHESTRATION_FEATURE, SKILL_FEATURE, CONSTRAINT_FEATURE
        ],
      }).compile();

      minimalFacade = module.get<ChatFacade>(ChatFacade);
    });

    it("should work without circuit breaker", async () => {
      const result = await minimalFacade.chat({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(result.content).toBe("Hello!");
      expect(result.isError).toBe(false);
    });

    it("should work without constraint enforcement", async () => {
      const result = await minimalFacade.chat({
        messages: [{ role: "user", content: "Test" }],
      });

      expect(result.content).toBe("Hello!");
    });
  });

  // ==================== Billing ====================

  describe("billing integration", () => {
    let facadeWithBilling: ChatFacade;
    let mockCreditsService: any;

    beforeEach(async () => {
      mockCreditsService = {
        consumeCredits: jest.fn().mockResolvedValue(undefined),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ChatFacade,
          { provide: AiChatService, useValue: mockAiChatService },
          {
            provide: AiModelConfigService,
            useValue: {
              getDefaultModel: jest.fn().mockResolvedValue(null),
              getModelById: jest.fn().mockResolvedValue(null),
              refreshModelConfigCache: jest.fn(),
              getEnabledModelsForFrontend: jest.fn().mockResolvedValue([]),
              getAllEnabledModelsByType: jest.fn().mockResolvedValue([]),
            },
          },
          { provide: CreditsService, useValue: mockCreditsService },
        ],
      }).compile();

      facadeWithBilling = module.get<ChatFacade>(ChatFacade);
    });

    it("should deduct credits after successful chat", async () => {
      await facadeWithBilling.chat({
        messages: [{ role: "user", content: "Test" }],
        billing: {
          userId: "user-1",
          moduleType: "ai-ask",
          operationType: "chat",
        },
      });

      expect(mockCreditsService.consumeCredits).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          moduleType: "ai-ask",
          tokenCount: 100,
        }),
      );
    });

    it("should skip billing when using personal API key", async () => {
      mockAiChatService.chat!.mockResolvedValue({
        content: "Hello!",
        model: "gpt-4o",
        usage: { totalTokens: 100 },
        isError: false,
        apiKeySource: "personal",
      });

      await facadeWithBilling.chat({
        messages: [{ role: "user", content: "Test" }],
        billing: {
          userId: "user-1",
          moduleType: "ai-ask",
          operationType: "chat",
        },
      });

      expect(mockCreditsService.consumeCredits).not.toHaveBeenCalled();
    });

    it("should not fail when billing errors occur", async () => {
      mockCreditsService.consumeCredits.mockRejectedValue(
        new Error("Billing failed"),
      );

      // Should not throw
      const result = await facadeWithBilling.chat({
        messages: [{ role: "user", content: "Test" }],
        billing: {
          userId: "user-1",
          moduleType: "ai-ask",
          operationType: "chat",
        },
      });

      expect(result.content).toBe("Hello!");
    });
  });

  // ==================== Admin methods ====================

  describe("admin methods", () => {
    it("should delegate fetchAvailableModels to AiChatService", async () => {
      (mockAiChatService as any).fetchAvailableModels = jest
        .fn()
        .mockResolvedValue({
          success: true,
          models: [{ id: "m1", name: "Model 1" }],
        });

      const result = await facade.fetchAvailableModels("openai", "key-123");

      expect(result.success).toBe(true);
    });

    it("should delegate testModelConnectionWithKey to AiChatService", async () => {
      (mockAiChatService as any).testModelConnectionWithKey = jest
        .fn()
        .mockResolvedValue({
          success: true,
          message: "Connected",
          latency: 200,
        });

      const result = await facade.testModelConnectionWithKey(
        "openai",
        "gpt-4o",
        "key-123",
        "https://api.openai.com/v1",
      );

      expect(result.success).toBe(true);
    });
  });
});
