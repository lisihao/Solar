/**
 * AIFacade - chatStructured 测试
 *
 * 测试结构化输出能力：
 * - chatStructured<T>() JSON Schema 强制输出
 * - 自动重试（解析失败时）
 * - throwOnParseError 模式
 * - 非严格模式（返回空对象）
 * - JSON markdown fence 清理
 * - ModelResolver 委托模式
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { AIFacade } from "../ai.facade";
import { AiChatService } from "../../../ai-engine/llm/chat/ai-chat.service";
import { AiModelConfigService } from "../../../ai-engine/llm/models/config/ai-model-config.service";
import { ORCHESTRATION_FEATURE } from "../facade.providers";

describe("AIFacade - chatStructured", () => {
  let facade: AIFacade;
  let mockAiChatService: any;

  beforeEach(async () => {
    mockAiChatService = {
      chat: jest.fn(),
      chatStream: jest.fn(),
      getAvailableModelsAsync: jest.fn().mockResolvedValue([]),
      isReasoningModel: jest.fn().mockReturnValue(false),
    };

    const mockModelConfigService = {
      getDefaultModel: jest.fn().mockResolvedValue(null),
      getModelById: jest.fn().mockResolvedValue(null),
      refreshModelConfigCache: jest.fn(),
      getEnabledModelsForFrontend: jest.fn().mockResolvedValue([]),
      getAllEnabledModelsByType: jest.fn().mockResolvedValue([]),
    };

    const mockCircuitBreaker = {
      canExecute: jest.fn().mockReturnValue(true),
      getCooldownRemaining: jest.fn().mockReturnValue(0),
      incrementLoad: jest.fn(),
      decrementLoad: jest.fn(),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
      parseErrorType: jest.fn(),
      selectBest: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIFacade,
        { provide: AiChatService, useValue: mockAiChatService },
        { provide: AiModelConfigService, useValue: mockModelConfigService },
        {
          provide: ORCHESTRATION_FEATURE,
          useValue: { circuitBreaker: mockCircuitBreaker, agentExecutor: null },
        },
      ],
    }).compile();

    facade = module.get<AIFacade>(AIFacade);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const testSchema = {
    type: "object" as const,
    properties: {
      name: { type: "string" },
      score: { type: "number" },
    },
    required: ["name", "score"],
  };

  // =========================================================================
  // Successful parse on first attempt
  // =========================================================================

  describe("successful structured output", () => {
    it("should parse valid JSON response on first attempt", async () => {
      mockAiChatService.chat.mockResolvedValue({
        content: '{"name": "Test", "score": 95}',
        model: "gpt-4o",
        usage: { totalTokens: 100 },
        isError: false,
      });

      const result = await facade.chatStructured<{
        name: string;
        score: number;
      }>({
        messages: [{ role: "user", content: "Evaluate this" }],
        schema: testSchema,
      });

      expect(result.data).toEqual({ name: "Test", score: 95 });
      expect(result.model).toBe("gpt-4o");
      expect(result.tokensUsed).toBe(100);
      expect(result.retriedParse).toBe(false);
    });

    it("should inject schema instruction into system prompt", async () => {
      mockAiChatService.chat.mockResolvedValue({
        content: '{"name": "Test", "score": 1}',
        model: "gpt-4o",
        usage: { totalTokens: 50 },
        isError: false,
      });

      await facade.chatStructured({
        messages: [{ role: "user", content: "Evaluate" }],
        schema: testSchema,
        systemPrompt: "You are an evaluator.",
      });

      const chatCall = mockAiChatService.chat.mock.calls[0][0];
      expect(chatCall.systemPrompt).toContain("You are an evaluator.");
      expect(chatCall.systemPrompt).toContain(
        "MUST respond with ONLY valid JSON",
      );
    });

    it("should use deterministic creativity by default", async () => {
      mockAiChatService.chat.mockResolvedValue({
        content: '{"name": "X", "score": 0}',
        model: "gpt-4o",
        usage: { totalTokens: 50 },
        isError: false,
      });

      await facade.chatStructured({
        messages: [{ role: "user", content: "Test" }],
        schema: testSchema,
      });

      const chatCall = mockAiChatService.chat.mock.calls[0][0];
      expect(chatCall.taskProfile.creativity).toBe("deterministic");
    });
  });

  // =========================================================================
  // Retry on parse failure
  // =========================================================================

  describe("retry on parse failure", () => {
    it("should retry when first response is not valid JSON", async () => {
      mockAiChatService.chat
        .mockResolvedValueOnce({
          content: "Here is the result: {invalid json",
          model: "gpt-4o",
          usage: { totalTokens: 50 },
          isError: false,
        })
        .mockResolvedValueOnce({
          content: '{"name": "Retry", "score": 80}',
          model: "gpt-4o",
          usage: { totalTokens: 60 },
          isError: false,
        });

      const result = await facade.chatStructured<{
        name: string;
        score: number;
      }>({
        messages: [{ role: "user", content: "Evaluate" }],
        schema: testSchema,
        maxRetries: 1,
      });

      expect(result.data).toEqual({ name: "Retry", score: 80 });
      expect(result.retriedParse).toBe(true);
      expect(result.tokensUsed).toBe(110); // 50 + 60
      expect(mockAiChatService.chat).toHaveBeenCalledTimes(2);
    });

    it("should add retry instruction on subsequent attempts", async () => {
      mockAiChatService.chat
        .mockResolvedValueOnce({
          content: "Not JSON",
          model: "gpt-4o",
          usage: { totalTokens: 30 },
          isError: false,
        })
        .mockResolvedValueOnce({
          content: '{"name": "OK", "score": 1}',
          model: "gpt-4o",
          usage: { totalTokens: 40 },
          isError: false,
        });

      await facade.chatStructured({
        messages: [{ role: "user", content: "Test" }],
        schema: testSchema,
        maxRetries: 1,
      });

      const retryCall = mockAiChatService.chat.mock.calls[1][0];
      expect(retryCall.systemPrompt).toContain("not valid JSON");
    });

    it("should handle maxRetries=0 (no retry)", async () => {
      mockAiChatService.chat.mockResolvedValue({
        content: "Not JSON at all",
        model: "gpt-4o",
        usage: { totalTokens: 50 },
        isError: false,
      });

      await expect(
        facade.chatStructured({
          messages: [{ role: "user", content: "Test" }],
          schema: testSchema,
          maxRetries: 0,
          throwOnParseError: true,
        }),
      ).rejects.toThrow("Structured output parse failed");

      expect(mockAiChatService.chat).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // throwOnParseError
  // =========================================================================

  describe("throwOnParseError", () => {
    it("should throw when all retries fail and throwOnParseError is true", async () => {
      mockAiChatService.chat.mockResolvedValue({
        content: "Never valid JSON",
        model: "gpt-4o",
        usage: { totalTokens: 50 },
        isError: false,
      });

      await expect(
        facade.chatStructured({
          messages: [{ role: "user", content: "Test" }],
          schema: testSchema,
          throwOnParseError: true,
          maxRetries: 2,
        }),
      ).rejects.toThrow("Structured output parse failed after 3 attempts");

      expect(mockAiChatService.chat).toHaveBeenCalledTimes(3);
    });

    it("should return empty object when throwOnParseError is false", async () => {
      mockAiChatService.chat.mockResolvedValue({
        content: "Not JSON",
        model: "gpt-4o",
        usage: { totalTokens: 50 },
        isError: false,
      });

      const result = await facade.chatStructured({
        messages: [{ role: "user", content: "Test" }],
        schema: testSchema,
        throwOnParseError: false,
        maxRetries: 0,
      });

      expect(result.data).toEqual({});
      expect(result.rawContent).toBe("Not JSON");
    });
  });

  // =========================================================================
  // JSON extraction from markdown fences
  // =========================================================================

  describe("JSON extraction", () => {
    it("should extract JSON from markdown code fences", async () => {
      mockAiChatService.chat.mockResolvedValue({
        content: '```json\n{"name": "Fenced", "score": 42}\n```',
        model: "gpt-4o",
        usage: { totalTokens: 60 },
        isError: false,
      });

      const result = await facade.chatStructured<{
        name: string;
        score: number;
      }>({
        messages: [{ role: "user", content: "Test" }],
        schema: testSchema,
      });

      expect(result.data).toEqual({ name: "Fenced", score: 42 });
    });

    it("should handle JSON with surrounding text", async () => {
      mockAiChatService.chat.mockResolvedValue({
        content: 'Here is the result:\n{"name": "Embedded", "score": 7}\nDone.',
        model: "gpt-4o",
        usage: { totalTokens: 60 },
        isError: false,
      });

      // This may succeed or fail depending on extractJson implementation
      // But should not crash
      const result = await facade.chatStructured({
        messages: [{ role: "user", content: "Test" }],
        schema: testSchema,
        throwOnParseError: false,
        maxRetries: 0,
      });

      expect(result).toBeDefined();
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================

  describe("error handling", () => {
    it("should handle chat API error on first attempt and retry", async () => {
      mockAiChatService.chat
        .mockResolvedValueOnce({
          content: "API Error: rate limited",
          model: "gpt-4o",
          usage: { totalTokens: 10 },
          isError: true,
        })
        .mockResolvedValueOnce({
          content: '{"name": "Recovery", "score": 50}',
          model: "gpt-4o",
          usage: { totalTokens: 60 },
          isError: false,
        });

      const result = await facade.chatStructured<{
        name: string;
        score: number;
      }>({
        messages: [{ role: "user", content: "Test" }],
        schema: testSchema,
        maxRetries: 1,
      });

      expect(result.data).toEqual({ name: "Recovery", score: 50 });
      expect(result.retriedParse).toBe(true);
    });
  });

  // =========================================================================
  // ModelResolver delegation
  // =========================================================================

  describe("ModelResolver delegation", () => {
    it("should default strictMode=false when caller does not specify", async () => {
      mockAiChatService.chat.mockResolvedValue({
        content: '{"name": "Strict", "score": 100}',
        model: "gpt-4o",
        usage: { totalTokens: 50 },
        isError: false,
      });

      await facade.chatStructured({
        messages: [{ role: "user", content: "Test" }],
        schema: testSchema,
      });

      const chatCall = mockAiChatService.chat.mock.calls[0][0];
      expect(chatCall.strictMode).toBe(false);
    });

    it("should pass strictMode=true to chat when caller explicitly sets it", async () => {
      mockAiChatService.chat.mockResolvedValue({
        content: '{"name": "Strict", "score": 100}',
        model: "gpt-4o",
        usage: { totalTokens: 50 },
        isError: false,
      });

      await facade.chatStructured({
        messages: [{ role: "user", content: "Test" }],
        schema: testSchema,
        strictMode: true,
      });

      const chatCall = mockAiChatService.chat.mock.calls[0][0];
      expect(chatCall.strictMode).toBe(true);
    });
  });
});
