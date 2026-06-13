import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { of } from "rxjs";
import { AiDirectKeyService } from "../ai-direct-key.service";
import { TaskProfileMapperService } from "../../chat/task-profile-mapper.service";
import { AiModelConfigService } from "../../models/config/ai-model-config.service";
import { AiImageGenerationService } from "../../image/ai-image-generation.service";
import { AiModelDiscoveryService } from "../../models/catalog/ai-model-discovery.service";
import { AiChatPromptService } from "../../chat/ai-chat-prompt.service";
import { AiChatRetryService } from "../../chat/ai-chat-retry.service";

describe("AiDirectKeyService", () => {
  let service: AiDirectKeyService;
  let mockHttpService: any;
  let mockConfigService: any;
  let mockTaskProfileMapper: any;
  let mockModelConfigService: any;
  let mockRetryService: any;
  let mockImageGenerationService: any;
  let mockModelDiscoveryService: any;
  let mockPromptService: any;

  const makeHttpResponse = (data: unknown) => ({
    data,
    status: 200,
    statusText: "OK",
    headers: {},
    config: {} as any,
  });

  beforeEach(async () => {
    mockHttpService = { post: jest.fn(), get: jest.fn() };

    mockConfigService = { get: jest.fn().mockReturnValue(null) };

    mockTaskProfileMapper = {
      mapToParameters: jest.fn().mockReturnValue({
        maxTokens: 2048,
        temperature: 0.7,
      }),
    };

    mockModelConfigService = {
      isReasoningModel: jest.fn().mockReturnValue(false),
      getTimeoutForModel: jest.fn().mockReturnValue(120000),
      // ai-direct-key 现在调 getModelConfig 拿真实 modelConfig 给 TaskProfileMapper（修真根因：原传 null 导致 isReasoning 路径丢失）
      getModelConfig: jest.fn().mockResolvedValue(null),
    };

    // retryService wraps calls - just pass through to the underlying fn
    mockRetryService = {
      withExponentialBackoff: jest.fn(async (fn: () => Promise<unknown>) =>
        fn(),
      ),
    };

    mockImageGenerationService = {
      isImageGenerationRequest: jest.fn().mockReturnValue(false),
      callDallE3: jest.fn(),
      callImagenApi: jest.fn(),
    };

    mockModelDiscoveryService = {
      formatModelDisplayName: jest.fn().mockReturnValue("GPT-4o"),
      getEnvVarNameForProvider: jest.fn().mockReturnValue("OPENAI_API_KEY"),
    };

    mockPromptService = {
      augmentMessagesWithUrlContent: jest
        .fn()
        .mockImplementation((msgs: any[]) => Promise.resolve(msgs)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiDirectKeyService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: HttpService, useValue: mockHttpService },
        { provide: TaskProfileMapperService, useValue: mockTaskProfileMapper },
        { provide: AiModelConfigService, useValue: mockModelConfigService },
        { provide: AiChatRetryService, useValue: mockRetryService },
        {
          provide: AiImageGenerationService,
          useValue: mockImageGenerationService,
        },
        {
          provide: AiModelDiscoveryService,
          useValue: mockModelDiscoveryService,
        },
        { provide: AiChatPromptService, useValue: mockPromptService },
      ],
    }).compile();

    service = module.get<AiDirectKeyService>(AiDirectKeyService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== generateChatCompletionWithKey ====================

  describe("generateChatCompletionWithKey", () => {
    const baseOptions = {
      provider: "openai",
      modelId: "gpt-4o",
      apiKey: "test-api-key",
      messages: [{ role: "user" as const, content: "Hello" }],
    };

    it("should return error response when no API key", async () => {
      const result = await service.generateChatCompletionWithKey({
        ...baseOptions,
        apiKey: "",
      });

      expect(result.content).toContain("API Key 未配置");
      expect(result.tokensUsed).toBe(0);
    });

    it("should call OpenAI API successfully", async () => {
      const apiResponse = {
        choices: [
          { message: { content: "Hello from OpenAI" }, finish_reason: "stop" },
        ],
        usage: { total_tokens: 50 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.generateChatCompletionWithKey(baseOptions);

      expect(result.content).toBe("Hello from OpenAI");
      expect(result.tokensUsed).toBe(50);
    });

    it("should call GPT provider using OpenAI path", async () => {
      const apiResponse = {
        choices: [
          { message: { content: "GPT response" }, finish_reason: "stop" },
        ],
        usage: { total_tokens: 30 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.generateChatCompletionWithKey({
        ...baseOptions,
        provider: "gpt",
      });

      expect(result.content).toBe("GPT response");
    });

    it("reasoning 模型（DB isReasoning=true，sync isReasoningModel=false）发 max_completion_tokens 不发 max_tokens（gpt-5.4 P0 回归守护）", async () => {
      // 复现 gpt-5.4：getModelConfig(async DB) 认 reasoning，但 isReasoningModel(sync
      // 缓存/启发式) 未命中→false。修复前 tokenParamName 走 sync 判断 → max_tokens →
      // OpenAI "Unsupported parameter: max_tokens" INVALID_REQUEST 全失败 + 熔断。
      mockModelConfigService.getModelConfig.mockResolvedValueOnce({
        isReasoning: true,
        maxTokens: 16000,
        temperature: 1,
        isEnabled: true,
        isDefault: true,
      } as any);
      // isReasoningModel 保持 beforeEach 的 false —— 模拟 sync 缓存未命中
      const apiResponse = {
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { total_tokens: 10 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.generateChatCompletionWithKey({
        ...baseOptions,
        modelId: "gpt-5.4",
      });

      const body = mockHttpService.post.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(body).toHaveProperty("max_completion_tokens");
      expect(body).not.toHaveProperty("max_tokens");
    });

    it("should call xAI API successfully", async () => {
      const apiResponse = {
        choices: [
          { message: { content: "Grok response" }, finish_reason: "stop" },
        ],
        usage: { total_tokens: 30 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.generateChatCompletionWithKey({
        ...baseOptions,
        provider: "xai",
        modelId: "grok-2",
      });

      expect(result.content).toBe("Grok response");
    });

    it("should call grok provider using xAI path", async () => {
      const apiResponse = {
        choices: [
          { message: { content: "Grok response" }, finish_reason: "stop" },
        ],
        usage: { total_tokens: 30 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.generateChatCompletionWithKey({
        ...baseOptions,
        provider: "grok",
        modelId: "grok-2",
      });

      expect(result.content).toBe("Grok response");
    });

    it("should call Anthropic API successfully", async () => {
      const apiResponse = {
        content: [{ type: "text", text: "Claude response" }],
        usage: { input_tokens: 20, output_tokens: 30 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.generateChatCompletionWithKey({
        ...baseOptions,
        provider: "anthropic",
        modelId: "claude-3-5-sonnet-20241022",
      });

      expect(result.content).toBe("Claude response");
      expect(result.tokensUsed).toBe(50);
    });

    it("should call Claude provider using Anthropic path", async () => {
      const apiResponse = {
        content: [{ type: "text", text: "Claude response" }],
        usage: { input_tokens: 10, output_tokens: 20 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.generateChatCompletionWithKey({
        ...baseOptions,
        provider: "claude",
        modelId: "claude-3-5-sonnet-20241022",
      });

      expect(result.content).toBe("Claude response");
    });

    it("should call Google/Gemini API successfully", async () => {
      const apiResponse = {
        candidates: [
          {
            content: { parts: [{ text: "Gemini response" }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.generateChatCompletionWithKey({
        ...baseOptions,
        provider: "google",
        modelId: "gemini-2.0-flash",
      });

      expect(result.content).toBe("Gemini response");
      expect(result.tokensUsed).toBe(30);
    });

    it("should call gemini provider using Google path", async () => {
      const apiResponse = {
        candidates: [
          {
            content: { parts: [{ text: "Gemini response" }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.generateChatCompletionWithKey({
        ...baseOptions,
        provider: "gemini",
        modelId: "gemini-2.0-flash",
      });

      expect(result.content).toBe("Gemini response");
    });

    it("should use default provider (grok) for unknown provider", async () => {
      const apiResponse = {
        choices: [
          { message: { content: "Default response" }, finish_reason: "stop" },
        ],
        usage: { total_tokens: 20 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.generateChatCompletionWithKey({
        ...baseOptions,
        provider: "unknown-provider",
      });

      expect(result.content).toBe("Default response");
    });

    it("should use taskProfile parameters when provided", async () => {
      const apiResponse = {
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
        usage: { total_tokens: 10 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      mockTaskProfileMapper.mapToParameters.mockReturnValue({
        maxTokens: 8000,
        temperature: 0.3,
      });

      await service.generateChatCompletionWithKey({
        ...baseOptions,
        taskProfile: { creativity: "low", outputLength: "long" },
      });

      expect(mockTaskProfileMapper.mapToParameters).toHaveBeenCalled();
    });

    it("should use explicit maxTokens/temperature when provided", async () => {
      const apiResponse = {
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
        usage: { total_tokens: 10 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.generateChatCompletionWithKey({
        ...baseOptions,
        maxTokens: 6000,
        temperature: 0.5,
      });

      // Should NOT call taskProfileMapper since explicit values provided
      expect(mockTaskProfileMapper.mapToParameters).not.toHaveBeenCalled();
    });

    it("should include systemPrompt in messages", async () => {
      const apiResponse = {
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
        usage: { total_tokens: 10 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.generateChatCompletionWithKey({
        ...baseOptions,
        systemPrompt: "You are a helpful assistant",
      });

      const callArgs = mockHttpService.post.mock.calls[0];
      const body = callArgs[1];
      expect(
        body.messages.some(
          (m: any) =>
            m.role === "system" && m.content === "You are a helpful assistant",
        ),
      ).toBe(true);
    });

    it("should handle API error and return error response", async () => {
      mockRetryService.withExponentialBackoff.mockRejectedValueOnce(
        new Error("Network timeout"),
      );

      const result = await service.generateChatCompletionWithKey(baseOptions);

      // Should return an error content instead of throwing
      expect(result.content).toContain("API Error");
      expect(result.tokensUsed).toBe(0);
    });

    it("should rethrow context-related errors", async () => {
      const contextError = new Error("AI 响应被完全截断（上下文可能过大）");
      mockRetryService.withExponentialBackoff.mockRejectedValueOnce(
        contextError,
      );

      await expect(
        service.generateChatCompletionWithKey(baseOptions),
      ).rejects.toThrow("截断");
    });

    it("should rethrow token-related errors", async () => {
      const tokenError = new Error("token limit exceeded");
      mockRetryService.withExponentialBackoff.mockRejectedValueOnce(tokenError);

      await expect(
        service.generateChatCompletionWithKey(baseOptions),
      ).rejects.toThrow("token");
    });

    it("should add reasoning_effort=minimal default for any reasoning model with OpenAI", async () => {
      // 默认 minimal — 防止 OpenAI gpt-5 系列在 low effort 下仍跑 50k+ reasoning tokens
      // 把 max_completion_tokens 挤光导致 visible 输出空。caller 显式传 deep 才升 high。
      const apiResponse = {
        choices: [
          { message: { content: "reasoning response" }, finish_reason: "stop" },
        ],
        usage: { total_tokens: 100 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );
      mockModelConfigService.isReasoningModel.mockReturnValue(true);

      await service.generateChatCompletionWithKey({
        ...baseOptions,
        modelId: "o1-mini",
      });

      const callArgs = mockHttpService.post.mock.calls[0];
      const body = callArgs[1];
      expect(body).toHaveProperty("reasoning_effort", "low");
    });

    it("should downgrade minimal → low for BYOK model that does not support minimal (gpt-5.4-mini)", async () => {
      // gpt-5.4-mini BYOK variant rejects 'minimal' → safeReasoningEffort downgrades to 'low'
      const apiResponse = {
        choices: [
          {
            message: { content: "downgraded response" },
            finish_reason: "stop",
          },
        ],
        usage: { total_tokens: 100 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );
      mockModelConfigService.isReasoningModel.mockReturnValue(true);

      await service.generateChatCompletionWithKey({
        ...baseOptions,
        modelId: "gpt-5.4-mini",
        taskProfile: { reasoningDepth: "minimal" },
      });

      const callArgs = mockHttpService.post.mock.calls[0];
      const body = callArgs[1];
      expect(body).toHaveProperty("reasoning_effort", "low");
    });

    it("should keep minimal for BYOK model that supports it (gpt-5)", async () => {
      // gpt-5 (no dot-digit suffix) is on the allowlist → minimal is preserved
      const apiResponse = {
        choices: [
          { message: { content: "minimal ok" }, finish_reason: "stop" },
        ],
        usage: { total_tokens: 100 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );
      mockModelConfigService.isReasoningModel.mockReturnValue(true);

      await service.generateChatCompletionWithKey({
        ...baseOptions,
        modelId: "gpt-5",
        taskProfile: { reasoningDepth: "minimal" },
      });

      const callArgs = mockHttpService.post.mock.calls[0];
      const body = callArgs[1];
      expect(body).toHaveProperty("reasoning_effort", "minimal");
    });

    it("should not affect non-minimal depths for unsupported model (moderate → medium)", async () => {
      const apiResponse = {
        choices: [
          { message: { content: "medium effort" }, finish_reason: "stop" },
        ],
        usage: { total_tokens: 100 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );
      mockModelConfigService.isReasoningModel.mockReturnValue(true);

      await service.generateChatCompletionWithKey({
        ...baseOptions,
        modelId: "gpt-5.4",
        taskProfile: { reasoningDepth: "moderate" },
      });

      const callArgs = mockHttpService.post.mock.calls[0];
      const body = callArgs[1];
      expect(body).toHaveProperty("reasoning_effort", "medium");
    });

    it("should detect image generation request for OpenAI", async () => {
      mockImageGenerationService.isImageGenerationRequest.mockReturnValue(true);
      mockImageGenerationService.callDallE3.mockResolvedValue({
        content: "![Generated](data:image/png;base64,test)",
        model: "dall-e-3",
        tokensUsed: 0,
      });

      const result = await service.generateChatCompletionWithKey({
        ...baseOptions,
        capabilities: ["IMAGE_GENERATION"],
        messages: [{ role: "user", content: "draw a cat" }],
      });

      expect(mockImageGenerationService.callDallE3).toHaveBeenCalled();
      expect(result.content).toContain("Generated");
    });

    it("should handle Gemini blocked content", async () => {
      const apiResponse = {
        candidates: [
          {
            content: { parts: [{ text: "Some text" }] },
            safetyRatings: [
              { category: "HARM", probability: "HIGH", blocked: true },
            ],
          },
        ],
        usageMetadata: {},
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      // Should still return content (just logs a warning)
      const result = await service.generateChatCompletionWithKey({
        ...baseOptions,
        provider: "google",
        modelId: "gemini-2.0-flash",
      });

      expect(result.content).toBe("Some text");
    });

    it("should handle Gemini prompt blocked", async () => {
      const apiResponse = {
        promptFeedback: { blockReason: "SAFETY" },
        candidates: [],
        usageMetadata: {},
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.generateChatCompletionWithKey({
        ...baseOptions,
        provider: "google",
        modelId: "gemini-2.0-flash",
      });

      expect(result.content).toContain("blocked");
    });

    it("should handle Gemini MAX_TOKENS with truncated content", async () => {
      const apiResponse = {
        candidates: [
          {
            content: { parts: [{ text: "Truncated content" }] },
            finishReason: "MAX_TOKENS",
          },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 100 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.generateChatCompletionWithKey({
        ...baseOptions,
        provider: "google",
        modelId: "gemini-2.0-flash",
      });

      expect(result.content).toContain("[... 响应因长度限制被截断]");
    });

    it("should handle Gemini empty response with MAX_TOKENS", async () => {
      const apiResponse = {
        candidates: [
          {
            content: { parts: [] },
            finishReason: "MAX_TOKENS",
          },
        ],
        usageMetadata: {},
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await expect(
        service.generateChatCompletionWithKey({
          ...baseOptions,
          provider: "google",
          modelId: "gemini-2.0-flash",
        }),
      ).rejects.toThrow("截断");
    });

    it("should handle Anthropic json format warning gracefully", async () => {
      const apiResponse = {
        content: [{ type: "text", text: '{"key":"val"}' }],
        usage: { input_tokens: 10, output_tokens: 20 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.generateChatCompletionWithKey({
        ...baseOptions,
        provider: "anthropic",
        modelId: "claude-3-5-sonnet-20241022",
        responseFormat: "json",
      });

      expect(result.content).toBe('{"key":"val"}');
    });

    it("should handle OpenAI truncated response with annotation", async () => {
      const apiResponse = {
        choices: [
          {
            message: { content: "Truncated text without ending" },
            finish_reason: "length",
          },
        ],
        usage: { total_tokens: 4000 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.generateChatCompletionWithKey(baseOptions);

      expect(result.content).toContain("[... 响应因长度限制被截断]");
    });

    it("should use custom apiEndpoint when provided", async () => {
      const apiResponse = {
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
        usage: { total_tokens: 10 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.generateChatCompletionWithKey({
        ...baseOptions,
        apiEndpoint: "https://custom.endpoint.com/v1/chat/completions",
      });

      const callArgs = mockHttpService.post.mock.calls[0];
      expect(callArgs[0]).toBe(
        "https://custom.endpoint.com/v1/chat/completions",
      );
    });

    it("should augment messages with URL content", async () => {
      const augmentedMessages = [
        { role: "user" as const, content: "Hello with URL content" },
      ];
      mockPromptService.augmentMessagesWithUrlContent.mockResolvedValue(
        augmentedMessages,
      );

      const apiResponse = {
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
        usage: { total_tokens: 10 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.generateChatCompletionWithKey(baseOptions);

      expect(
        mockPromptService.augmentMessagesWithUrlContent,
      ).toHaveBeenCalled();
    });

    it("should handle OpenAI refusal in response (caught by outer handler)", async () => {
      // When callApiWithKey throws "AI 拒绝响应", the outer catch in
      // generateChatCompletionWithKey swallows it and returns an error content string
      const apiResponse = {
        choices: [
          {
            message: { content: null, refusal: "I cannot help with that" },
            finish_reason: "stop",
          },
        ],
        usage: { total_tokens: 10 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.generateChatCompletionWithKey(baseOptions);
      expect(result.content).toContain("AI 拒绝响应");
      expect(result.tokensUsed).toBe(0);
    });

    it("should handle OpenAI empty response with unknown finish reason (caught by outer handler)", async () => {
      // When callApiWithKey throws "AI 返回空响应 (原因: content_filter)", the outer
      // catch swallows it and returns an error content string
      const apiResponse = {
        choices: [
          {
            message: { content: null },
            finish_reason: "content_filter",
          },
        ],
        usage: { total_tokens: 10 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.generateChatCompletionWithKey(baseOptions);
      expect(result.content).toContain("AI 返回空响应");
      expect(result.tokensUsed).toBe(0);
    });

    it("should handle reasoning model token exhaustion (length + reasoning tokens)", async () => {
      const apiResponse = {
        choices: [
          {
            message: { content: null },
            finish_reason: "length",
          },
        ],
        usage: {
          completion_tokens: 100,
          completion_tokens_details: { reasoning_tokens: 99 }, // >= 90%
        },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );
      mockModelConfigService.isReasoningModel.mockReturnValue(true);

      await expect(
        service.generateChatCompletionWithKey({
          ...baseOptions,
          modelId: "o1-mini",
        }),
      ).rejects.toThrow("推理模型");
    });

    it("should handle OpenAI API error in response body", async () => {
      const apiResponse = {
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
        error: { message: "Some API error occurred" },
        usage: { total_tokens: 10 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      // Still returns content even with error in body
      const result = await service.generateChatCompletionWithKey(baseOptions);
      expect(result.content).toBe("OK");
    });

    it("should handle OpenAI truncated response that ends with sentence-ending punctuation", async () => {
      const apiResponse = {
        choices: [
          {
            message: { content: "This is a complete sentence." },
            finish_reason: "length",
          },
        ],
        usage: { total_tokens: 4000 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.generateChatCompletionWithKey(baseOptions);

      // Ends with period, should NOT have truncation suffix
      expect(result.content).toBe("This is a complete sentence.");
      expect(result.content).not.toContain("[... 响应因长度限制被截断]");
    });

    it("should use Imagen model directly when provider=google and model starts with imagen", async () => {
      mockImageGenerationService.isImageGenerationRequest.mockReturnValue(true);
      mockImageGenerationService.callImagenApi.mockResolvedValue({
        content: "![Imagen](data:image/png;base64,abc)",
        model: "imagen-3",
        tokensUsed: 0,
      });

      const result = await service.generateChatCompletionWithKey({
        ...baseOptions,
        provider: "google",
        modelId: "imagen-3.0-generate-001",
        capabilities: ["IMAGE_GENERATION"],
        messages: [{ role: "user", content: "draw me a sunset" }],
      });

      expect(mockImageGenerationService.callImagenApi).toHaveBeenCalledWith(
        baseOptions.apiKey,
        "imagen-3.0-generate-001",
        expect.any(String),
      );
      expect(result.content).toContain("Imagen");
    });

    it("should switch to gemini-2.0-flash-exp for image-only model without image request", async () => {
      mockImageGenerationService.isImageGenerationRequest.mockReturnValue(
        false,
      );

      const apiResponse = {
        candidates: [
          {
            content: { parts: [{ text: "Text response from fallback model" }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      const result = await service.generateChatCompletionWithKey({
        ...baseOptions,
        provider: "google",
        modelId: "gemini-image-model", // contains "image"
        capabilities: [],
      });

      // The URL should use gemini-2.0-flash-exp as fallback
      const callUrl = mockHttpService.post.mock.calls[0][0] as string;
      expect(callUrl).toContain("gemini-2.0-flash-exp");
      expect(result.content).toBe("Text response from fallback model");
    });

    it("should add google search tools when enableSearch=true and not image request", async () => {
      mockImageGenerationService.isImageGenerationRequest.mockReturnValue(
        false,
      );

      const apiResponse = {
        candidates: [
          {
            content: { parts: [{ text: "Response with search" }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {},
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.generateChatCompletionWithKey({
        ...baseOptions,
        provider: "google",
        modelId: "gemini-2.0-flash",
        enableSearch: true,
      });

      const requestBody = mockHttpService.post.mock.calls[0][1] as {
        tools?: unknown[];
      };
      expect(requestBody.tools).toBeDefined();
      expect(requestBody.tools).toHaveLength(1);
    });

    it("should not add google search tools when enableSearch=false", async () => {
      mockImageGenerationService.isImageGenerationRequest.mockReturnValue(
        false,
      );

      const apiResponse = {
        candidates: [
          {
            content: { parts: [{ text: "No search response" }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {},
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.generateChatCompletionWithKey({
        ...baseOptions,
        provider: "google",
        modelId: "gemini-2.0-flash",
        enableSearch: false,
      });

      const requestBody = mockHttpService.post.mock.calls[0][1] as {
        tools?: unknown[];
      };
      expect(requestBody.tools).toBeUndefined();
    });

    it("should add responseMimeType for json format with Gemini", async () => {
      mockImageGenerationService.isImageGenerationRequest.mockReturnValue(
        false,
      );

      const apiResponse = {
        candidates: [
          {
            content: { parts: [{ text: '{"key":"value"}' }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {},
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.generateChatCompletionWithKey({
        ...baseOptions,
        provider: "google",
        modelId: "gemini-2.0-flash",
        responseFormat: "json",
      });

      const requestBody = mockHttpService.post.mock.calls[0][1] as {
        generationConfig?: { responseMimeType?: string };
      };
      expect(requestBody.generationConfig?.responseMimeType).toBe(
        "application/json",
      );
    });

    it("should add systemInstruction when systemPrompt provided for Gemini", async () => {
      mockImageGenerationService.isImageGenerationRequest.mockReturnValue(
        false,
      );

      const apiResponse = {
        candidates: [
          {
            content: { parts: [{ text: "With system instruction" }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {},
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.generateChatCompletionWithKey({
        ...baseOptions,
        provider: "google",
        modelId: "gemini-2.0-flash",
        systemPrompt: "You are a helpful assistant",
      });

      const requestBody = mockHttpService.post.mock.calls[0][1] as {
        systemInstruction?: { parts: Array<{ text: string }> };
      };
      expect(requestBody.systemInstruction?.parts[0].text).toBe(
        "You are a helpful assistant",
      );
    });

    it("should clean base64 images from Gemini messages", async () => {
      mockImageGenerationService.isImageGenerationRequest.mockReturnValue(
        false,
      );

      const apiResponse = {
        candidates: [
          {
            content: { parts: [{ text: "Clean response" }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {},
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      await service.generateChatCompletionWithKey({
        ...baseOptions,
        provider: "google",
        modelId: "gemini-2.0-flash",
        messages: [
          {
            role: "user",
            content: "What do you see?",
          },
          {
            role: "assistant" as const,
            content:
              "I see ![Generated Image](data:image/png;base64,longbase64data) in the image",
          },
          { role: "user", content: "tell me more" },
        ],
      });

      const requestBody = mockHttpService.post.mock.calls[0][1] as {
        contents: Array<{ parts: Array<{ text: string }>; role: string }>;
      };
      // The assistant message with base64 should be cleaned
      const assistantContent = requestBody.contents.find(
        (c) => c.role === "model",
      );
      expect(assistantContent?.parts[0].text).toContain(
        "[An image was generated based on the previous request]",
      );
    });

    it("should handle Gemini image request fallback to Imagen then DALL-E 3", async () => {
      mockImageGenerationService.isImageGenerationRequest.mockReturnValue(true);

      // Gemini returns no images
      const apiResponse = {
        candidates: [
          {
            content: { parts: [{ text: "Here is the image description" }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      // Imagen fails
      mockImageGenerationService.callImagenApi.mockRejectedValue(
        new Error("Imagen unavailable"),
      );

      // DALL-E 3 succeeds
      const openaiKey = "sk-openai-fallback";
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "OPENAI_API_KEY") return openaiKey;
        return null;
      });
      mockImageGenerationService.callDallE3.mockResolvedValue({
        content: "![DALL-E](data:image/png;base64,dalle3data)",
        model: "dall-e-3",
        tokensUsed: 0,
      });

      const result = await service.generateChatCompletionWithKey({
        ...baseOptions,
        provider: "google",
        modelId: "gemini-2.0-flash",
        capabilities: ["IMAGE_GENERATION"],
        messages: [{ role: "user", content: "generate an image of a cat" }],
      });

      expect(mockImageGenerationService.callDallE3).toHaveBeenCalledWith(
        openaiKey,
        expect.any(String),
      );
      expect(result.content).toContain("DALL-E");
    });

    it("should return text fallback when all image generation fails", async () => {
      mockImageGenerationService.isImageGenerationRequest.mockReturnValue(true);

      // Gemini returns text but no images
      const apiResponse = {
        candidates: [
          {
            content: {
              parts: [
                { text: "Here is what I would draw: a beautiful sunset" },
              ],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {},
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      // Imagen fails
      mockImageGenerationService.callImagenApi.mockRejectedValue(
        new Error("Imagen failed"),
      );

      // No OpenAI key available
      mockConfigService.get.mockReturnValue(null);

      const result = await service.generateChatCompletionWithKey({
        ...baseOptions,
        provider: "google",
        modelId: "gemini-2.0-flash",
        capabilities: ["IMAGE_GENERATION"],
        messages: [{ role: "user", content: "draw a sunset" }],
      });

      // Should return text content with failure notice
      expect(result.content).toContain("图片生成失败");
    });

    it("should use context from conversation when building DALL-E prompt for OpenAI image requests", async () => {
      mockImageGenerationService.isImageGenerationRequest.mockReturnValue(true);
      mockImageGenerationService.callDallE3.mockResolvedValue({
        content: "![img](data:image/png;base64,abc)",
        model: "dall-e-3",
        tokensUsed: 0,
      });

      await service.generateChatCompletionWithKey({
        ...baseOptions,
        provider: "openai",
        modelId: "gpt-4o",
        capabilities: ["IMAGE_GENERATION"],
        messages: [
          { role: "user", content: "Let's analyze some data" },
          {
            role: "assistant" as const,
            content: "Here is the analysis: detailed results...",
            name: "Analyst",
          },
          { role: "user", content: "Now draw a chart based on the analysis" },
        ],
      });

      // DALL-E should have been called with a context-aware prompt
      const dallePromptArg = mockImageGenerationService.callDallE3.mock
        .calls[0][1] as string;
      expect(dallePromptArg).toContain("Analyst");
    });

    it("should handle Gemini inlineData with invalid base64", async () => {
      mockImageGenerationService.isImageGenerationRequest.mockReturnValue(true);

      const apiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: "   ", // whitespace = empty after clean
                  },
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10 },
      };
      mockHttpService.post.mockReturnValueOnce(
        of(makeHttpResponse(apiResponse)) as any,
      );

      // Imagen fallback also fails
      mockImageGenerationService.callImagenApi.mockRejectedValue(
        new Error("Failed"),
      );
      mockConfigService.get.mockReturnValue(null);

      // Should not throw - handles gracefully
      const result = await service.generateChatCompletionWithKey({
        ...baseOptions,
        provider: "google",
        modelId: "gemini-2.0-flash",
        capabilities: ["IMAGE_GENERATION"],
        messages: [{ role: "user", content: "draw something" }],
      });

      expect(result).toBeDefined();
    });
  });
});
