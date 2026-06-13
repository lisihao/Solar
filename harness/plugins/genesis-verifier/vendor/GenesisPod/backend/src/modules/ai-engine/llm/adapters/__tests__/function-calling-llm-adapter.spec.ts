import { Test, TestingModule } from "@nestjs/testing";
import { FunctionCallingLLMAdapter } from "../function-calling-llm.adapter";
import { AiChatService } from "../../chat/ai-chat.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SecretsService } from "@/modules/platform/credentials/storage/secrets/secrets.service";
import { KeyResolverService } from "@/modules/platform/credentials/resolution/key-resolver/key-resolver.service";

describe("FunctionCallingLLMAdapter", () => {
  let adapter: FunctionCallingLLMAdapter;
  let mockAiChatService: any;
  let mockPrisma: any;
  let mockSecretsService: any;
  let mockKeyResolver: any;

  beforeEach(async () => {
    mockAiChatService = {
      chat: jest.fn().mockResolvedValue({
        content: "mocked AI response",
        usage: { totalTokens: 100 },
      }),
    };

    mockPrisma = {
      aIModel: {
        findFirst: jest.fn().mockResolvedValue({
          modelId: "gpt-4o",
          provider: "openai",
          secretKey: "DEFAULT_TEST_SECRET",
          apiEndpoint: "https://api.openai.com/v1",
        }),
      },
      topicAIMember: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    // 默认让 SYSTEM secret 解析到有效值，让 no-userId 路径 (background cron)
    // 不会因找不到 secret 而抛 NoAvailableKeyError
    mockSecretsService = {
      getValueInternal: jest.fn().mockResolvedValue("system-secret-value"),
    };

    // ★ 强 BYOK 单源：KeyResolver 默认返回有效 PERSONAL key 让大多数测试不关心 BYOK
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

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== setConfig / getConfig ====================

  describe("setConfig / getConfig", () => {
    it("should set and get config", () => {
      adapter.setConfig({ aiMemberId: "member-123", workspaceId: "ws-456" });
      const config = adapter.getConfig();
      expect(config?.aiMemberId).toBe("member-123");
      expect(config?.workspaceId).toBe("ws-456");
    });

    it("should return undefined config when not set", () => {
      const config = adapter.getConfig();
      expect(config).toBeUndefined();
    });
  });

  // ==================== formatTools ====================

  describe("formatTools", () => {
    it("should wrap functions in type:function format", () => {
      const functions = [
        { name: "web_search", description: "Search the web", parameters: {} },
      ];

      const tools = adapter.formatTools(functions as any);

      expect(tools).toHaveLength(1);
      expect(tools[0].type).toBe("function");
      expect(tools[0].function.name).toBe("web_search");
    });

    it("should handle empty functions list", () => {
      const tools = adapter.formatTools([]);
      expect(tools).toHaveLength(0);
    });
  });

  // ==================== parseToolCalls ====================

  describe("parseToolCalls", () => {
    it("should parse OpenAI tool_calls format", () => {
      const response = {
        content: null,
        tool_calls: [
          {
            id: "call_abc",
            type: "function" as const,
            function: {
              name: "web_search",
              arguments: '{"query": "test"}',
            },
          },
        ],
      } as any;

      const toolCalls = adapter.parseToolCalls(response);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].id).toBe("call_abc");
      expect(toolCalls[0].name).toBe("web_search");
      expect(toolCalls[0].arguments).toBe('{"query": "test"}');
    });

    it("should parse legacy function_call format", () => {
      const response = {
        content: null,
        function_call: {
          name: "get_weather",
          arguments: '{"city": "Shanghai"}',
        },
      } as any;

      const toolCalls = adapter.parseToolCalls(response);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe("get_weather");
      expect(toolCalls[0].id).toMatch(/^call_/);
    });

    it("should return empty array when no tool calls", () => {
      const response = { content: "regular text" } as any;
      const toolCalls = adapter.parseToolCalls(response);
      expect(toolCalls).toHaveLength(0);
    });

    it("should parse both tool_calls and function_call", () => {
      const response = {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function" as const,
            function: { name: "fn1", arguments: "{}" },
          },
        ],
        function_call: {
          name: "fn2",
          arguments: "{}",
        },
      } as any;

      const toolCalls = adapter.parseToolCalls(response);
      // Both should be parsed
      expect(toolCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ==================== buildToolResultMessage ====================

  describe("buildToolResultMessage", () => {
    it("should build tool result message with string result", () => {
      const message = adapter.buildToolResultMessage(
        "call_abc",
        "web_search",
        "search results here",
      );

      expect(message.role).toBe("tool");
      expect(message.content).toBe("search results here");
      expect(message.tool_call_id).toBe("call_abc");
      expect(message.name).toBe("web_search");
    });

    it("should serialize object result to JSON", () => {
      const message = adapter.buildToolResultMessage("call_abc", "get_data", {
        key: "value",
        count: 42,
      });

      expect(message.content).toBe('{"key":"value","count":42}');
    });
  });

  // ==================== chat ====================

  describe("chat", () => {
    it("should call AiChatService with messages", async () => {
      const result = await adapter.chat({
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(mockAiChatService.chat).toHaveBeenCalled();
      expect(result.content).toBe("mocked AI response");
    });

    it("should pass tools to AiChatService when provided", async () => {
      const functions = [
        { name: "test_fn", description: "Test function", parameters: {} },
      ];

      await adapter.chat({
        messages: [{ role: "user", content: "Use the tool" }],
        functions: functions as any,
      });

      const callArgs = mockAiChatService.chat.mock.calls[0][0];
      expect(callArgs.tools).toBeDefined();
      expect(callArgs.tools).toHaveLength(1);
    });

    it("should use resolved model from DB", async () => {
      await adapter.chat({
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(mockAiChatService.chat).toHaveBeenCalled();
    });

    it("should throw when DB has no models", async () => {
      mockPrisma.aIModel.findFirst.mockResolvedValue(null);

      await expect(
        adapter.chat({
          messages: [{ role: "user", content: "Hello" }],
        }),
      ).rejects.toThrow("No AI model configured");
    });

    it("should use config model when set", async () => {
      adapter.setConfig({
        modelId: "claude-3-5-sonnet-20241022",
        provider: "anthropic",
        apiKey: "claude-key",
      });

      await adapter.chat({
        messages: [{ role: "user", content: "Hello" }],
      });

      const callArgs = mockAiChatService.chat.mock.calls[0][0];
      expect(callArgs.model).toBe("claude-3-5-sonnet-20241022");
    });

    it("should pass taskProfile when provided", async () => {
      await adapter.chat({
        messages: [{ role: "user", content: "Hello" }],
        taskProfile: { creativity: "low", outputLength: "short" },
      });

      const callArgs = mockAiChatService.chat.mock.calls[0][0];
      expect(callArgs.taskProfile).toEqual({
        creativity: "low",
        outputLength: "short",
      });
    });

    it("should include tool_choice when functions provided", async () => {
      await adapter.chat({
        messages: [{ role: "user", content: "Hello" }],
        functions: [
          { name: "test", description: "test", parameters: {} } as any,
        ],
        tool_choice: "auto",
      });

      const callArgs = mockAiChatService.chat.mock.calls[0][0];
      expect(callArgs.tool_choice).toBe("auto");
    });

    it("should resolve apiKey via BYOK KeyResolver when userId provided", async () => {
      const mockMember = {
        aiModel: "gpt-4o",
        displayName: "Test Member",
      };
      mockPrisma.topicAIMember.findUnique.mockResolvedValue(mockMember);
      mockPrisma.aIModel.findFirst.mockResolvedValue({
        modelId: "gpt-4o",
        provider: "openai",
        secretKey: null,
        apiEndpoint: null,
      });

      adapter.setConfig({ aiMemberId: "member-123", userId: "u-test" });

      await adapter.chat({
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(mockKeyResolver.resolveKey).toHaveBeenCalledWith(
        "u-test",
        "openai",
      );
      const callArgs = mockAiChatService.chat.mock.calls[0][0];
      // 2026-05-21：BYOK 改为透传 userId 给 AiChatService（Standard 路径解析 key +
      // 转发 tools），不再由本适配器把 apiKey 塞给 chat（详见 adapter
      // callAiChatServiceWithTools 注释：传 apiKey 会进 Path B，不支持工具）。
      expect(callArgs.userId).toBe("u-test");
      expect(callArgs.apiKey).toBeUndefined();
    });

    it("should throw when AI member not found", async () => {
      mockPrisma.topicAIMember.findUnique.mockResolvedValue(null);
      adapter.setConfig({
        aiMemberId: "nonexistent-member",
        userId: "u-test",
      });

      await expect(
        adapter.chat({
          messages: [{ role: "user", content: "Hello" }],
        }),
      ).rejects.toThrow("AI Member not found");
    });

    it("should fall back to SYSTEM secret when no userId (background cron path)", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue("secret-key-value");

      const mockMember = { aiModel: "gpt-4o", displayName: "Test" };
      mockPrisma.topicAIMember.findUnique.mockResolvedValue(mockMember);
      mockPrisma.aIModel.findFirst.mockResolvedValue({
        modelId: "gpt-4o",
        provider: "openai",
        secretKey: "MY_SECRET",
        apiEndpoint: null,
      });

      // No userId in config → fall back to SYSTEM secret path
      adapter.setConfig({ aiMemberId: "member-123" });

      await adapter.chat({
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(mockSecretsService.getValueInternal).toHaveBeenCalledWith(
        "MY_SECRET",
      );
      expect(mockKeyResolver.resolveKey).not.toHaveBeenCalled();
    });

    it("should throw NoAvailableKeyError when user has no BYOK", async () => {
      const { NoAvailableKeyError } =
        await import("@/modules/platform/credentials/resolution/key-resolver/key-resolver.errors");
      mockKeyResolver.resolveKey.mockRejectedValue(
        new NoAvailableKeyError("openai"),
      );

      const mockMember = { aiModel: "gpt-4o", displayName: "Test" };
      mockPrisma.topicAIMember.findUnique.mockResolvedValue(mockMember);
      mockPrisma.aIModel.findFirst.mockResolvedValue({
        modelId: "gpt-4o",
        provider: "openai",
        secretKey: null,
        apiEndpoint: null,
      });

      adapter.setConfig({
        aiMemberId: "member-123",
        userId: "u-no-byok",
      });

      await expect(
        adapter.chat({
          messages: [{ role: "user", content: "Hello" }],
        }),
      ).rejects.toThrow(NoAvailableKeyError);
    });
  });

  // ==================== Response parsing ====================

  describe("response parsing (OpenAI format)", () => {
    it("should parse simplified chat response", async () => {
      mockAiChatService.chat.mockResolvedValue({
        content: "Hello World",
        tokensUsed: 50,
      });

      const result = await adapter.chat({
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(result.content).toBe("Hello World");
      expect(result.usage?.totalTokens).toBe(50);
    });

    it("should parse response with usage.totalTokens", async () => {
      mockAiChatService.chat.mockResolvedValue({
        content: "Response",
        usage: { totalTokens: 200 },
      });

      const result = await adapter.chat({
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(result.content).toBe("Response");
      expect(result.usage?.totalTokens).toBe(200);
    });

    it("should return stop as finishReason when service returns no finishReason", async () => {
      // Default mockAiChatService returns { content, usage } with no finishReason
      const result = await adapter.chat({
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(result.finishReason).toBe("stop");
    });

    it("should propagate finishReason=length from service (truncation signal)", async () => {
      // Arrange: simulate AiChatService returning finish_reason=length
      mockAiChatService.chat.mockResolvedValue({
        content: '{"partial":true,"items":[1,2',
        usage: { totalTokens: 4096 },
        finishReason: "length",
      });

      // Act
      const result = await adapter.chat({
        messages: [{ role: "user", content: "List many items" }],
      });

      // Assert: the adapter must NOT silently convert "length" → "stop"
      expect(result.finishReason).toBe("length");
    });

    it("should propagate finishReason=length for anthropic provider", async () => {
      // Arrange: configure anthropic provider
      adapter.setConfig({
        modelId: "claude-3-5-sonnet-20241022",
        provider: "anthropic",
        apiKey: "claude-key",
      });
      mockAiChatService.chat.mockResolvedValue({
        content: "partial response",
        usage: { totalTokens: 8192 },
        finishReason: "length",
        model: "claude-3-5-sonnet-20241022",
      });

      // Act
      const result = await adapter.chat({
        messages: [{ role: "user", content: "Write a long essay" }],
      });

      // Assert
      expect(result.finishReason).toBe("length");
    });

    it("should propagate finishReason=length for google provider", async () => {
      // Arrange: configure google/gemini provider
      adapter.setConfig({
        modelId: "gemini-2.0-flash",
        provider: "google",
        apiKey: "gemini-key",
      });
      mockAiChatService.chat.mockResolvedValue({
        content: "truncated output",
        usage: { totalTokens: 8192 },
        finishReason: "length",
        model: "gemini-2.0-flash",
      });

      // Act
      const result = await adapter.chat({
        messages: [{ role: "user", content: "Write a long document" }],
      });

      // Assert
      expect(result.finishReason).toBe("length");
    });
  });

  // ==================== Provider inference ====================

  describe("provider inference from model name", () => {
    it("should infer openai for gpt models", async () => {
      adapter.setConfig({
        modelId: "gpt-4o",
        apiKey: "key",
      });

      await adapter.chat({ messages: [{ role: "user", content: "hi" }] });

      const callArgs = mockAiChatService.chat.mock.calls[0][0];
      expect(callArgs.provider).toBe("openai");
    });

    it("should infer anthropic for claude models", async () => {
      adapter.setConfig({
        modelId: "claude-3-5-sonnet-20241022",
        apiKey: "key",
      });

      await adapter.chat({ messages: [{ role: "user", content: "hi" }] });

      const callArgs = mockAiChatService.chat.mock.calls[0][0];
      expect(callArgs.provider).toBe("anthropic");
    });

    it("should infer google for gemini models", async () => {
      adapter.setConfig({
        modelId: "gemini-2.0-flash",
        apiKey: "key",
      });

      await adapter.chat({ messages: [{ role: "user", content: "hi" }] });

      const callArgs = mockAiChatService.chat.mock.calls[0][0];
      expect(callArgs.provider).toBe("google");
    });

    it("should infer xai for grok models", async () => {
      adapter.setConfig({
        modelId: "grok-2",
        apiKey: "key",
      });

      await adapter.chat({ messages: [{ role: "user", content: "hi" }] });

      const callArgs = mockAiChatService.chat.mock.calls[0][0];
      expect(callArgs.provider).toBe("xai");
    });
  });
});
