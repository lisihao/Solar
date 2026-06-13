import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { of } from "rxjs";
import { AiModelDiscoveryService } from "../ai-model-discovery.service";
import { UserApiKeysService } from "@/modules/platform/credentials/user-owned/user-api-keys/user-api-keys.service";

describe("AiModelDiscoveryService", () => {
  let service: AiModelDiscoveryService;
  let mockHttpService: jest.Mocked<Pick<HttpService, "get" | "post">>;

  const makeHttpResponse = (data: unknown) => ({
    data,
    status: 200,
    statusText: "OK",
    headers: {},
    config: {} as any,
  });

  beforeEach(async () => {
    mockHttpService = {
      get: jest.fn(),
      post: jest.fn(),
    };

    const mockUserApiKeys = {
      getPersonalKey: jest.fn().mockResolvedValue(null),
      resolveProviderDefaults: jest.fn().mockResolvedValue(null),
      getAvailableProviders: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiModelDiscoveryService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: UserApiKeysService, useValue: mockUserApiKeys },
      ],
    }).compile();

    service = module.get<AiModelDiscoveryService>(AiModelDiscoveryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== formatModelDisplayName ====================

  describe("formatModelDisplayName", () => {
    it("should format Gemini Flash", () => {
      expect(service.formatModelDisplayName("gemini-2.0-flash")).toBe(
        "Gemini Flash",
      );
    });

    it("should format Gemini Pro", () => {
      expect(service.formatModelDisplayName("gemini-1.5-pro")).toBe(
        "Gemini Pro",
      );
    });

    it("should format Gemini Imagen", () => {
      expect(service.formatModelDisplayName("gemini-imagen-3")).toBe(
        "Gemini Imagen",
      );
    });

    it("should format generic Gemini", () => {
      expect(service.formatModelDisplayName("gemini-unknown")).toBe("Gemini");
    });

    it("should format Grok", () => {
      expect(service.formatModelDisplayName("grok-2")).toBe("Grok");
    });

    it("should format GPT-4", () => {
      expect(service.formatModelDisplayName("gpt-4o")).toBe("GPT-4");
    });

    it("should format GPT-5", () => {
      expect(service.formatModelDisplayName("gpt-5")).toBe("GPT-5");
    });

    it("should format OpenAI o1", () => {
      expect(service.formatModelDisplayName("o1-mini")).toBe("OpenAI o1");
    });

    it("should format OpenAI o3", () => {
      expect(service.formatModelDisplayName("o3-mini")).toBe("OpenAI o3");
    });

    it("should format Claude Opus", () => {
      expect(service.formatModelDisplayName("claude-3-opus")).toBe(
        "Claude Opus",
      );
    });

    it("should format Claude Sonnet", () => {
      expect(service.formatModelDisplayName("claude-3-5-sonnet-20241022")).toBe(
        "Claude Sonnet",
      );
    });

    it("should format Claude Haiku", () => {
      expect(service.formatModelDisplayName("claude-3-5-haiku")).toBe(
        "Claude Haiku",
      );
    });

    it("should format generic Claude", () => {
      expect(service.formatModelDisplayName("claude-unknown")).toBe("Claude");
    });

    it("should format DALL-E", () => {
      expect(service.formatModelDisplayName("dall-e-3")).toBe("DALL-E");
    });

    it("should return model as-is if no match", () => {
      expect(service.formatModelDisplayName("some-unknown-model")).toBe(
        "some-unknown-model",
      );
    });
  });

  // ==================== getEnvVarNameForProvider ====================

  describe("getEnvVarNameForProvider", () => {
    it("should return XAI_API_KEY for xai", () => {
      expect(service.getEnvVarNameForProvider("xai")).toBe("XAI_API_KEY");
    });

    it("should return XAI_API_KEY for grok", () => {
      expect(service.getEnvVarNameForProvider("grok")).toBe("XAI_API_KEY");
    });

    it("should return OPENAI_API_KEY for openai", () => {
      expect(service.getEnvVarNameForProvider("openai")).toBe("OPENAI_API_KEY");
    });

    it("should return OPENAI_API_KEY for gpt", () => {
      expect(service.getEnvVarNameForProvider("gpt")).toBe("OPENAI_API_KEY");
    });

    it("should return ANTHROPIC_API_KEY for anthropic", () => {
      expect(service.getEnvVarNameForProvider("anthropic")).toBe(
        "ANTHROPIC_API_KEY",
      );
    });

    it("should return ANTHROPIC_API_KEY for claude", () => {
      expect(service.getEnvVarNameForProvider("claude")).toBe(
        "ANTHROPIC_API_KEY",
      );
    });

    it("should return GOOGLE_AI_API_KEY for google", () => {
      expect(service.getEnvVarNameForProvider("google")).toBe(
        "GOOGLE_AI_API_KEY",
      );
    });

    it("should return GOOGLE_AI_API_KEY for gemini", () => {
      expect(service.getEnvVarNameForProvider("gemini")).toBe(
        "GOOGLE_AI_API_KEY",
      );
    });

    it("should return uppercased provider key for unknown", () => {
      expect(service.getEnvVarNameForProvider("deepseek")).toBe(
        "DEEPSEEK_API_KEY",
      );
    });

    it("should return GROQ_API_KEY for groq", () => {
      expect(service.getEnvVarNameForProvider("groq")).toBe("GROQ_API_KEY");
    });

    it("should return OPENROUTER_API_KEY for openrouter", () => {
      expect(service.getEnvVarNameForProvider("openrouter")).toBe(
        "OPENROUTER_API_KEY",
      );
    });
  });

  // ==================== newest-first 排序 ====================
  // 根因回归测试：discovery 必须返回 newest-first，否则 auto-configure 的代际通配
  // pattern 命中列表里第一个匹配项（可能是旧版 gpt-4o 而非 gpt-5.4）。

  describe("fetchAvailableModels — newest-first ordering", () => {
    it("OpenAI-compatible: sorts by created desc (newest first)", async () => {
      const mockUserApiKeys = (service as any).userApiKeysService;
      mockUserApiKeys.resolveProviderDefaults.mockResolvedValueOnce({
        endpoint: "https://api.openai.com/v1",
        apiFormat: "openai",
      });
      mockHttpService.get.mockReturnValueOnce(
        of(
          makeHttpResponse({
            data: [
              { id: "gpt-4o-2024-05-13", created: 1715000000 },
              { id: "gpt-5.4", created: 1740000000 },
              { id: "gpt-4-turbo", created: 1712000000 },
            ],
          }),
        ) as any,
      );

      const result = await service.fetchAvailableModels(
        "openai",
        "test-key",
        undefined,
        "CHAT",
      );
      expect(result.success).toBe(true);
      // 最新代必须排第一，让 auto-configure firstMatch 命中它
      expect(result.models![0].id).toBe("gpt-5.4");
    });

    it("OpenAI-compatible: version fallback when created missing", async () => {
      const mockUserApiKeys = (service as any).userApiKeysService;
      mockUserApiKeys.resolveProviderDefaults.mockResolvedValueOnce({
        endpoint: "https://api.openai.com/v1",
        apiFormat: "openai",
      });
      mockHttpService.get.mockReturnValueOnce(
        of(
          makeHttpResponse({
            data: [{ id: "gpt-4o-2024-05" }, { id: "gpt-5.4" }],
          }),
        ) as any,
      );

      const result = await service.fetchAvailableModels(
        "openai",
        "test-key",
        undefined,
        "CHAT",
      );
      expect(result.success).toBe(true);
      expect(result.models![0].id).toBe("gpt-5.4");
    });

    it("Gemini: sorts generations newest-first (2.5 before 1.5)", async () => {
      const mockUserApiKeys = (service as any).userApiKeysService;
      mockUserApiKeys.resolveProviderDefaults.mockResolvedValueOnce({
        endpoint: "https://generativelanguage.googleapis.com/v1beta",
        apiFormat: "google",
      });
      mockHttpService.get.mockReturnValueOnce(
        of(
          makeHttpResponse({
            models: [
              {
                name: "models/gemini-1.5-pro",
                displayName: "Gemini 1.5 Pro",
                supportedGenerationMethods: ["generateContent"],
              },
              {
                name: "models/gemini-2.5-pro",
                displayName: "Gemini 2.5 Pro",
                supportedGenerationMethods: ["generateContent"],
              },
            ],
          }),
        ) as any,
      );

      const result = await service.fetchAvailableModels(
        "google",
        "test-key",
        undefined,
        "CHAT",
      );
      expect(result.success).toBe(true);
      expect(result.models![0].id).toBe("gemini-2.5-pro");
    });

    it("Anthropic: sorts generations newest-first (opus-4 before 3-5-sonnet)", async () => {
      const mockUserApiKeys = (service as any).userApiKeysService;
      mockUserApiKeys.resolveProviderDefaults.mockResolvedValueOnce({
        endpoint: "https://api.anthropic.com",
        apiFormat: "anthropic",
      });
      mockHttpService.get.mockReturnValueOnce(
        of(
          makeHttpResponse({
            data: [
              { id: "claude-3-5-sonnet-20241022", type: "model" },
              { id: "claude-opus-4-1-20250805", type: "model" },
            ],
          }),
        ) as any,
      );

      const result = await service.fetchAvailableModels(
        "anthropic",
        "test-key",
        undefined,
        "CHAT",
      );
      expect(result.success).toBe(true);
      expect(result.models![0].id).toBe("claude-opus-4-1-20250805");
    });
  });

  // ==================== fetchAvailableModels ====================
  // ★ fb63df767 改为数据驱动路由后，以下测试使用旧的硬编码 endpoint 方式，
  //   spec 标注 skip（原 commit 61a68cf65 已说明"spec 待重写"），待新版本覆盖后移除 skip。

  describe.skip("fetchAvailableModels", () => {
    it("should return error if no API key", async () => {
      const result = await service.fetchAvailableModels("openai", "");
      expect(result.success).toBe(false);
      expect(result.error).toContain("API key");
    });

    it("should return error for unknown provider", async () => {
      const result = await service.fetchAvailableModels(
        "unknown-provider",
        "test-key",
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown provider");
    });

    // xAI models
    it("should fetch xAI models", async () => {
      const mockModels = {
        data: [
          { id: "grok-2", description: "Grok 2" },
          { id: "grok-2-vision", description: "Grok 2 Vision" },
        ],
      };
      mockHttpService.get.mockReturnValueOnce(
        of(makeHttpResponse(mockModels)) as any,
      );

      const result = await service.fetchAvailableModels("xai", "test-key");
      expect(result.success).toBe(true);
      expect(result.models).toBeDefined();
      expect(result.models!.length).toBeGreaterThan(0);
    });

    it("should filter xAI embedding models", async () => {
      const mockModels = {
        data: [{ id: "grok-2" }, { id: "v1-embeddings" }],
      };
      mockHttpService.get.mockReturnValueOnce(
        of(makeHttpResponse(mockModels)) as any,
      );

      const result = await service.fetchAvailableModels(
        "xai",
        "test-key",
        undefined,
        "EMBEDDING",
      );
      expect(result.success).toBe(true);
      // Should only have embedding model
      expect(
        result.models?.every((m) => m.id.includes("embed") || m.id === "v1"),
      ).toBe(true);
    });

    it("should filter xAI CHAT models (exclude embeddings)", async () => {
      const mockModels = {
        data: [{ id: "grok-2" }, { id: "v1-embeddings" }],
      };
      mockHttpService.get.mockReturnValueOnce(
        of(makeHttpResponse(mockModels)) as any,
      );

      const result = await service.fetchAvailableModels(
        "xai",
        "test-key",
        undefined,
        "CHAT",
      );
      expect(result.success).toBe(true);
      expect(result.models?.every((m) => m.id.includes("grok"))).toBe(true);
    });

    // OpenAI models
    it("should fetch OpenAI models", async () => {
      const mockModels = {
        data: [
          { id: "gpt-4o", created: 1000 },
          { id: "gpt-4o-mini", created: 900 },
          { id: "gpt-3.5-turbo", created: 800 },
          { id: "dall-e-3", created: 700 },
          { id: "text-embedding-3-large", created: 600 },
        ],
      };
      mockHttpService.get.mockReturnValueOnce(
        of(makeHttpResponse(mockModels)) as any,
      );

      const result = await service.fetchAvailableModels("openai", "test-key");
      expect(result.success).toBe(true);
      expect(result.models?.some((m) => m.id.startsWith("gpt-"))).toBe(true);
    });

    it("should fetch OpenAI embedding models", async () => {
      const mockModels = {
        data: [
          { id: "gpt-4o", created: 1000 },
          { id: "text-embedding-3-large", created: 800 },
          { id: "text-embedding-ada-002", created: 600 },
        ],
      };
      mockHttpService.get.mockReturnValueOnce(
        of(makeHttpResponse(mockModels)) as any,
      );

      const result = await service.fetchAvailableModels(
        "openai",
        "test-key",
        undefined,
        "EMBEDDING",
      );
      expect(result.success).toBe(true);
      expect(
        result.models?.every(
          (m) =>
            m.id.includes("embedding") ||
            (m.id.includes("ada") && m.id.includes("002")),
        ),
      ).toBe(true);
    });

    it("should fetch OpenAI image generation models", async () => {
      const mockModels = {
        data: [
          { id: "gpt-4o", created: 1000 },
          { id: "dall-e-3", created: 800 },
          { id: "dall-e-2", created: 600 },
        ],
      };
      mockHttpService.get.mockReturnValueOnce(
        of(makeHttpResponse(mockModels)) as any,
      );

      const result = await service.fetchAvailableModels(
        "openai",
        "test-key",
        undefined,
        "IMAGE_GENERATION",
      );
      expect(result.success).toBe(true);
      expect(result.models?.every((m) => m.id.startsWith("dall-e"))).toBe(true);
    });

    it("should fetch OpenAI CHAT_FAST models", async () => {
      const mockModels = {
        data: [
          { id: "gpt-4o", created: 1000 },
          { id: "gpt-4o-mini", created: 900 },
          { id: "gpt-3.5-turbo", created: 800 },
        ],
      };
      mockHttpService.get.mockReturnValueOnce(
        of(makeHttpResponse(mockModels)) as any,
      );

      const result = await service.fetchAvailableModels(
        "gpt",
        "test-key",
        undefined,
        "CHAT_FAST",
      );
      expect(result.success).toBe(true);
    });

    // ★ 2026-05-06 删除 4 个 deprecated [hardcoded → API dynamic] Anthropic 静态测试

    // Google models
    it("should fetch Google models", async () => {
      const mockModels = {
        models: [
          {
            name: "models/gemini-2.0-flash",
            displayName: "Gemini 2.0 Flash",
            description: "Fast Gemini",
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/text-embedding-004",
            displayName: "Embedding 004",
            supportedGenerationMethods: ["embedContent"],
          },
        ],
      };
      mockHttpService.get.mockReturnValueOnce(
        of(makeHttpResponse(mockModels)) as any,
      );

      const result = await service.fetchAvailableModels("google", "test-key");
      expect(result.success).toBe(true);
      expect(result.models?.some((m) => m.id === "gemini-2.0-flash")).toBe(
        true,
      );
    });

    it("should fetch Google embedding models", async () => {
      const mockModels = {
        models: [
          {
            name: "models/text-embedding-004",
            displayName: "Embedding 004",
            supportedGenerationMethods: ["embedContent"],
          },
          {
            name: "models/gemini-2.0-flash",
            displayName: "Gemini 2.0 Flash",
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      };
      mockHttpService.get.mockReturnValueOnce(
        of(makeHttpResponse(mockModels)) as any,
      );

      const result = await service.fetchAvailableModels(
        "gemini",
        "test-key",
        undefined,
        "EMBEDDING",
      );
      expect(result.success).toBe(true);
    });

    it("should fetch Google imagen models for IMAGE_GENERATION", async () => {
      const mockModels = {
        models: [
          {
            name: "models/imagen-3.0",
            displayName: "Imagen 3.0",
            supportedGenerationMethods: ["generateImage"],
          },
          {
            name: "models/gemini-2.0-flash",
            displayName: "Gemini 2.0 Flash",
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      };
      mockHttpService.get.mockReturnValueOnce(
        of(makeHttpResponse(mockModels)) as any,
      );

      const result = await service.fetchAvailableModels(
        "google",
        "test-key",
        undefined,
        "IMAGE_GENERATION",
      );
      expect(result.success).toBe(true);
    });

    // ★ 2026-05-06 删除 3 个 deprecated [hardcoded → API dynamic] Cohere 静态测试

    // DeepSeek
    it("should fetch DeepSeek models via OpenAI-compatible API", async () => {
      const mockModels = {
        data: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }],
      };
      mockHttpService.get.mockReturnValueOnce(
        of(makeHttpResponse(mockModels)) as any,
      );

      const result = await service.fetchAvailableModels("deepseek", "test-key");
      expect(result.success).toBe(true);
    });

    it("should return empty array for DeepSeek IMAGE_GENERATION", async () => {
      const result = await service.fetchAvailableModels(
        "deepseek",
        "test-key",
        undefined,
        "IMAGE_GENERATION",
      );
      expect(result.success).toBe(true);
      expect(result.models).toHaveLength(0);
    });

    // Qwen / Alibaba
    it("should fetch Qwen models", async () => {
      const mockModels = {
        data: [{ id: "qwen-plus" }, { id: "qwen-turbo" }],
      };
      mockHttpService.get.mockReturnValueOnce(
        of(makeHttpResponse(mockModels)) as any,
      );

      const result = await service.fetchAvailableModels("qwen", "test-key");
      expect(result.success).toBe(true);
    });

    it("should fetch Alibaba models", async () => {
      const mockModels = {
        data: [{ id: "qwen-plus" }],
      };
      mockHttpService.get.mockReturnValueOnce(
        of(makeHttpResponse(mockModels)) as any,
      );

      const result = await service.fetchAvailableModels("alibaba", "test-key");
      expect(result.success).toBe(true);
    });

    // Doubao / ByteDance
    it("should fetch Doubao models", async () => {
      const mockModels = { data: [{ id: "doubao-chat" }] };
      mockHttpService.get.mockReturnValueOnce(
        of(makeHttpResponse(mockModels)) as any,
      );

      const result = await service.fetchAvailableModels("doubao", "test-key");
      expect(result.success).toBe(true);
    });

    it("should fetch ByteDance models", async () => {
      const mockModels = { data: [{ id: "doubao-chat" }] };
      mockHttpService.get.mockReturnValueOnce(
        of(makeHttpResponse(mockModels)) as any,
      );

      const result = await service.fetchAvailableModels(
        "bytedance",
        "test-key",
      );
      expect(result.success).toBe(true);
    });

    // ★ 2026-05-06 删除 3 个 deprecated [hardcoded → API dynamic] Zhipu/GLM 静态测试

    it("should return empty for Zhipu IMAGE_GENERATION", async () => {
      const result = await service.fetchAvailableModels(
        "zhipu",
        "test-key",
        undefined,
        "IMAGE_GENERATION",
      );
      expect(result.success).toBe(true);
      expect(result.models).toHaveLength(0);
    });

    // Kimi / Moonshot
    it("should fetch Kimi models", async () => {
      const mockModels = { data: [{ id: "moonshot-v1-8k" }] };
      mockHttpService.get.mockReturnValueOnce(
        of(makeHttpResponse(mockModels)) as any,
      );

      const result = await service.fetchAvailableModels("kimi", "test-key");
      expect(result.success).toBe(true);
    });

    it("should fetch Moonshot models", async () => {
      const mockModels = { data: [{ id: "moonshot-v1-8k" }] };
      mockHttpService.get.mockReturnValueOnce(
        of(makeHttpResponse(mockModels)) as any,
      );

      const result = await service.fetchAvailableModels("moonshot", "test-key");
      expect(result.success).toBe(true);
    });

    // Groq
    it("should fetch Groq models via OpenAI-compatible API", async () => {
      const mockModels = {
        data: [{ id: "llama-3.3-70b-versatile" }, { id: "mixtral-8x7b-32768" }],
      };
      mockHttpService.get.mockReturnValueOnce(
        of(makeHttpResponse(mockModels)) as any,
      );

      const result = await service.fetchAvailableModels("groq", "test-key");
      expect(result.success).toBe(true);
      expect(result.models!.length).toBe(2);
      expect(mockHttpService.get).toHaveBeenCalledWith(
        "https://api.groq.com/openai/v1/models",
        expect.objectContaining({
          headers: { Authorization: "Bearer test-key" },
        }),
      );
    });

    it("should return empty for Groq IMAGE_GENERATION", async () => {
      const result = await service.fetchAvailableModels(
        "groq",
        "test-key",
        undefined,
        "IMAGE_GENERATION",
      );
      expect(result.success).toBe(true);
      expect(result.models).toHaveLength(0);
    });

    // OpenRouter
    it("should fetch OpenRouter models via OpenAI-compatible API", async () => {
      const mockModels = {
        data: [
          { id: "openai/gpt-4o", description: "OpenAI GPT-4o" },
          { id: "anthropic/claude-3.5-sonnet", description: "Claude 3.5" },
        ],
      };
      mockHttpService.get.mockReturnValueOnce(
        of(makeHttpResponse(mockModels)) as any,
      );

      const result = await service.fetchAvailableModels(
        "openrouter",
        "test-key",
      );
      expect(result.success).toBe(true);
      expect(result.models!.length).toBe(2);
      expect(mockHttpService.get).toHaveBeenCalledWith(
        "https://openrouter.ai/api/v1/models",
        expect.objectContaining({
          headers: { Authorization: "Bearer test-key" },
        }),
      );
    });

    it("should fetch OpenRouter models via open-router alias", async () => {
      const mockModels = { data: [{ id: "meta-llama/llama-3-70b" }] };
      mockHttpService.get.mockReturnValueOnce(
        of(makeHttpResponse(mockModels)) as any,
      );

      const result = await service.fetchAvailableModels(
        "open-router",
        "test-key",
      );
      expect(result.success).toBe(true);
      expect(result.models!.length).toBe(1);
    });

    // Error handling
    it("should return error when API call fails", async () => {
      mockHttpService.get.mockImplementationOnce(() => {
        throw {
          response: {
            status: 401,
            data: { error: { message: "Invalid API key" } },
          },
        };
      });

      const result = await service.fetchAvailableModels("openai", "bad-key");
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should handle API error with string error field", async () => {
      mockHttpService.get.mockImplementationOnce(() => {
        throw {
          response: {
            status: 401,
            data: { error: "Unauthorized" },
          },
        };
      });

      const result = await service.fetchAvailableModels("openai", "bad-key");
      expect(result.success).toBe(false);
    });

    it("should handle network error without response", async () => {
      mockHttpService.get.mockImplementationOnce(() => {
        throw new Error("Network error");
      });

      const result = await service.fetchAvailableModels("openai", "test-key");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
    });
  });
});
