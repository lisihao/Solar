/**
 * FunctionCallingLLMAdapter — extended coverage tests
 *
 * 2026-05-12 PR-1 重写：原 getApiKeyFromEnv / model.apiKey fallback 分支已删除，
 * apiKey 现统一走 BYOK KeyResolver（PERSONAL → ASSIGNED → throw）+ no-userId SYSTEM
 * Secret 兜底；本文件覆盖：
 *  - systemMessage 提取为 systemPrompt
 *  - chat() catch 块重抛
 *  - getDefaultModelConfig 走 anyModel fallback
 *  - getAIMemberConfig aiMember 未找到
 *  - getAIMemberConfig 按 name 二次查找
 *  - BYOK KeyResolver 解析路径（含 NoAvailableKeyError）
 *  - SYSTEM Secret 兜底路径（无 userId 时）
 *  - getDefaultEndpoint 未知 provider 返回 ""
 *  - parseOpenAI / parseAnthropic (tool_use) / parseGoogle 响应格式
 */

import { Test, TestingModule } from "@nestjs/testing";
import { FunctionCallingLLMAdapter } from "../function-calling-llm.adapter";
import { AiChatService } from "../../chat/ai-chat.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SecretsService } from "@/modules/platform/facade";
import { KeyResolverService } from "@/modules/platform/credentials/resolution/key-resolver/key-resolver.service";
import { NoAvailableKeyError } from "@/modules/platform/credentials/resolution/key-resolver/key-resolver.errors";

describe("FunctionCallingLLMAdapter (extended coverage)", () => {
  let adapter: FunctionCallingLLMAdapter;
  let mockAiChatService: Record<string, jest.Mock>;
  let mockPrisma: Record<string, Record<string, jest.Mock>>;
  let mockSecretsService: Record<string, jest.Mock>;
  let mockKeyResolver: Record<string, jest.Mock>;

  const defaultChatResponse = {
    content: "Test response",
    model: "gpt-4o",
    tokensUsed: 100,
    usage: { totalTokens: 100 },
  };

  beforeEach(async () => {
    mockAiChatService = {
      chat: jest.fn().mockResolvedValue(defaultChatResponse),
    };

    mockPrisma = {
      aIModel: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      topicAIMember: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    mockSecretsService = {
      getValueInternal: jest.fn().mockResolvedValue("system-secret-value"),
    };

    mockKeyResolver = {
      resolveKey: jest.fn().mockResolvedValue({
        source: "PERSONAL",
        apiKey: "byok-personal-key",
        apiEndpoint: null,
        provider: "openai",
        userId: "u-test",
        label: "default",
        healthKeyId: "personal:u-test:openai:default",
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FunctionCallingLLMAdapter,
        { provide: AiChatService, useValue: mockAiChatService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SecretsService, useValue: mockSecretsService },
        { provide: KeyResolverService, useValue: mockKeyResolver },
      ],
    }).compile();

    adapter = module.get<FunctionCallingLLMAdapter>(FunctionCallingLLMAdapter);
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // systemMessage extracted as systemPrompt
  // =========================================================================

  describe("system message extraction", () => {
    it("extracts systemMessage content as systemPrompt", async () => {
      mockPrisma.aIModel.findFirst.mockResolvedValue({
        modelId: "gpt-4o",
        provider: "openai",
        secretKey: "OPENAI_SECRET",
        apiEndpoint: "https://api.openai.com/v1",
      });

      const messages = [
        { role: "system" as const, content: "You are a helpful assistant." },
        { role: "user" as const, content: "Hello" },
      ];

      await adapter.chat({ messages, maxTokens: 100 });

      expect(mockAiChatService.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: "You are a helpful assistant.",
        }),
      );
    });
  });

  // =========================================================================
  // catch block in chat() rethrow
  // =========================================================================

  describe("catch block in chat", () => {
    it("rethrows error when AiChatService throws", async () => {
      mockPrisma.aIModel.findFirst.mockResolvedValue({
        modelId: "gpt-4o",
        provider: "openai",
        secretKey: "OPENAI_SECRET",
        apiEndpoint: null,
      });
      mockAiChatService.chat.mockRejectedValue(new Error("upstream blew up"));

      await expect(
        adapter.chat({ messages: [{ role: "user", content: "Hi" }] }),
      ).rejects.toThrow("upstream blew up");
    });
  });

  // =========================================================================
  // anyModel fallback in getDefaultModelFromDb
  // =========================================================================

  describe("anyModel fallback in getDefaultModelFromDb", () => {
    it("uses anyModel when no isDefault model found", async () => {
      mockPrisma.aIModel.findFirst
        .mockResolvedValueOnce(null) // first call (isDefault) → no result
        .mockResolvedValueOnce({
          modelId: "fallback-model",
          provider: "openai",
          secretKey: "OPENAI_SECRET",
          apiEndpoint: null,
        });

      await adapter.chat({ messages: [{ role: "user", content: "Hi" }] });

      expect(mockAiChatService.chat).toHaveBeenCalledWith(
        expect.objectContaining({ model: "fallback-model" }),
      );
    });

    it("throws when no model configured at all", async () => {
      mockPrisma.aIModel.findFirst.mockResolvedValue(null);

      await expect(
        adapter.chat({ messages: [{ role: "user", content: "Hi" }] }),
      ).rejects.toThrow("No AI model configured");
    });
  });

  // =========================================================================
  // getAIMemberConfig
  // =========================================================================

  describe("getAIMemberConfig", () => {
    it("throws when AI member not found", async () => {
      adapter.setConfig({ aiMemberId: "member-missing" });
      mockPrisma.topicAIMember.findUnique.mockResolvedValue(null);

      await expect(
        adapter.chat({ messages: [{ role: "user", content: "Hi" }] }),
      ).rejects.toThrow("AI Member not found");
    });

    it("falls back to name-based lookup when modelId lookup fails", async () => {
      adapter.setConfig({ aiMemberId: "member-456", userId: "u-test" });
      mockPrisma.topicAIMember.findUnique.mockResolvedValue({
        aiModel: "my-custom-model",
        displayName: "Custom Agent",
      });
      mockPrisma.aIModel.findFirst
        .mockResolvedValueOnce(null) // modelId 查询无果
        .mockResolvedValueOnce({
          modelId: "my-custom-model",
          provider: "anthropic",
          secretKey: null,
          apiEndpoint: null,
        });
      mockKeyResolver.resolveKey.mockResolvedValue({
        source: "PERSONAL",
        apiKey: "claude-byok",
        apiEndpoint: null,
        provider: "anthropic",
        userId: "u-test",
        label: "default",
        healthKeyId: "personal:u-test:anthropic:default",
      });

      await adapter.chat({ messages: [{ role: "user", content: "Hi" }] });

      expect(mockPrisma.aIModel.findFirst).toHaveBeenCalledTimes(2);
      expect(mockKeyResolver.resolveKey).toHaveBeenCalledWith(
        "u-test",
        "anthropic",
      );
    });
  });

  // =========================================================================
  // BYOK 行为（KeyResolver 单源 + SYSTEM 兜底 + NoAvailableKeyError）
  // =========================================================================

  describe("BYOK resolution path", () => {
    it("uses KeyResolver when userId is provided", async () => {
      adapter.setConfig({ aiMemberId: "m-1", userId: "alice" });
      mockPrisma.topicAIMember.findUnique.mockResolvedValue({
        aiModel: "gpt-4o",
        displayName: "Agent",
      });
      mockPrisma.aIModel.findFirst.mockResolvedValue({
        modelId: "gpt-4o",
        provider: "openai",
        secretKey: "OPENAI_SECRET",
        apiEndpoint: null,
      });

      await adapter.chat({ messages: [{ role: "user", content: "Hi" }] });

      expect(mockKeyResolver.resolveKey).toHaveBeenCalledWith(
        "alice",
        "openai",
      );
      expect(mockSecretsService.getValueInternal).not.toHaveBeenCalled();
      const callArgs = mockAiChatService.chat.mock.calls[0][0];
      // 2026-05-21：BYOK 路径改为把 userId 透传给 AiChatService（由其 Standard 路径
      // 解析 key + 转发 tools），不再由本适配器把 apiKey 塞给 chat —— 后者会强制进
      // Path B（不转发 tools + 注入已废弃的 xAI Live Search search_parameters）。
      expect(callArgs.userId).toBe("alice");
      expect(callArgs.apiKey).toBeUndefined();
    });

    it("falls back to SYSTEM Secret when no userId (background cron)", async () => {
      adapter.setConfig({ aiMemberId: "m-2" }); // no userId
      mockPrisma.topicAIMember.findUnique.mockResolvedValue({
        aiModel: "gpt-4o",
        displayName: "Agent",
      });
      mockPrisma.aIModel.findFirst.mockResolvedValue({
        modelId: "gpt-4o",
        provider: "openai",
        secretKey: "OPENAI_SECRET",
        apiEndpoint: null,
      });

      await adapter.chat({ messages: [{ role: "user", content: "Hi" }] });

      expect(mockKeyResolver.resolveKey).not.toHaveBeenCalled();
      expect(mockSecretsService.getValueInternal).toHaveBeenCalledWith(
        "OPENAI_SECRET",
      );
      const callArgs = mockAiChatService.chat.mock.calls[0][0];
      expect(callArgs.apiKey).toBe("system-secret-value");
    });

    it("throws NoAvailableKeyError when user has no BYOK key", async () => {
      adapter.setConfig({ aiMemberId: "m-3", userId: "bob-no-key" });
      mockPrisma.topicAIMember.findUnique.mockResolvedValue({
        aiModel: "gpt-4o",
        displayName: "Agent",
      });
      mockPrisma.aIModel.findFirst.mockResolvedValue({
        modelId: "gpt-4o",
        provider: "openai",
        secretKey: null,
        apiEndpoint: null,
      });
      mockKeyResolver.resolveKey.mockRejectedValue(
        new NoAvailableKeyError("openai"),
      );

      await expect(
        adapter.chat({ messages: [{ role: "user", content: "Hi" }] }),
      ).rejects.toThrow(NoAvailableKeyError);
    });

    it("throws NoAvailableKeyError when no userId and no SYSTEM secret", async () => {
      adapter.setConfig({ aiMemberId: "m-4" }); // no userId
      mockPrisma.topicAIMember.findUnique.mockResolvedValue({
        aiModel: "gpt-4o",
        displayName: "Agent",
      });
      mockPrisma.aIModel.findFirst.mockResolvedValue({
        modelId: "gpt-4o",
        provider: "openai",
        secretKey: null, // no SYSTEM secret either
        apiEndpoint: null,
      });

      await expect(
        adapter.chat({ messages: [{ role: "user", content: "Hi" }] }),
      ).rejects.toThrow(NoAvailableKeyError);
    });

    it("uses explicit apiKey from config when provided (override path)", async () => {
      adapter.setConfig({
        modelId: "gpt-4o",
        provider: "openai",
        apiKey: "caller-supplied-key",
        userId: "alice",
      });

      await adapter.chat({ messages: [{ role: "user", content: "Hi" }] });

      // explicit apiKey bypasses both KeyResolver and SecretsService
      expect(mockKeyResolver.resolveKey).not.toHaveBeenCalled();
      const callArgs = mockAiChatService.chat.mock.calls[0][0];
      expect(callArgs.apiKey).toBe("caller-supplied-key");
    });
  });

  // =========================================================================
  // getDefaultEndpoint returns "" for unknown provider
  // =========================================================================

  describe("getDefaultEndpoint unknown provider", () => {
    it("uses empty endpoint for unknown provider model", async () => {
      adapter.setConfig({
        modelId: "weird-model",
        provider: "unknown-provider",
        apiKey: "test-key",
      });

      await adapter.chat({ messages: [{ role: "user", content: "Hi" }] });

      const callArgs = mockAiChatService.chat.mock.calls[0][0];
      expect(callArgs.apiEndpoint).toBe("");
    });
  });

  // =========================================================================
  // parseOpenAIResponse raw choices format
  // =========================================================================

  describe("parseOpenAIResponse raw choices format", () => {
    it("parses raw OpenAI choices format (not simplified)", async () => {
      mockAiChatService.chat.mockResolvedValue({
        choices: [
          {
            message: {
              content: "Raw OpenAI response",
              tool_calls: undefined,
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        model: "gpt-4o",
      });

      mockPrisma.aIModel.findFirst.mockResolvedValue({
        modelId: "gpt-4o",
        provider: "openai",
        secretKey: "OPENAI_SECRET",
        apiEndpoint: "https://api.openai.com/v1",
      });

      const messages = [{ role: "user" as const, content: "Hello" }];
      const result = await adapter.chat({ messages });

      expect(result.content).toBe("Raw OpenAI response");
      expect(result.finishReason).toBe("stop");
    });
  });

  // =========================================================================
  // parseAnthropicResponse tool_use block
  // =========================================================================

  describe("parseAnthropicResponse with tool_use", () => {
    it("parses tool_use blocks in Anthropic response", async () => {
      mockAiChatService.chat.mockResolvedValue({
        content: [
          { type: "text", text: "I'll help you with that." },
          {
            type: "tool_use",
            id: "tool-123",
            name: "search",
            input: { query: "test query" },
          },
        ],
        model: "claude-3-5-sonnet",
        usage: { input_tokens: 10, output_tokens: 20 },
      });

      mockPrisma.aIModel.findFirst.mockResolvedValue({
        modelId: "claude-3-5-sonnet",
        provider: "anthropic",
        secretKey: "ANTHROPIC_SECRET",
        apiEndpoint: "https://api.anthropic.com/v1",
      });

      const messages = [{ role: "user" as const, content: "Use a tool" }];
      const result = await adapter.chat({ messages });

      expect(result.content).toBe("I'll help you with that.");
      expect(result.tool_calls).toHaveLength(1);
      expect(result.tool_calls?.[0]?.function.name).toBe("search");
    });
  });

  // =========================================================================
  // parseGoogleResponse raw candidates format
  // =========================================================================

  describe("parseGoogleResponse raw candidates format", () => {
    it("parses raw Gemini candidates format (not simplified)", async () => {
      mockAiChatService.chat.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ text: "Gemini raw response" }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 20,
          totalTokenCount: 30,
        },
      });

      mockPrisma.aIModel.findFirst.mockResolvedValue({
        modelId: "gemini-pro",
        provider: "google",
        secretKey: "GOOGLE_SECRET",
        apiEndpoint: "https://generativelanguage.googleapis.com",
      });

      const messages = [{ role: "user" as const, content: "Hello Gemini" }];
      const result = await adapter.chat({ messages });

      expect(result.content).toBe("Gemini raw response");
      expect(result.usage?.totalTokens).toBe(30);
    });
  });
});
