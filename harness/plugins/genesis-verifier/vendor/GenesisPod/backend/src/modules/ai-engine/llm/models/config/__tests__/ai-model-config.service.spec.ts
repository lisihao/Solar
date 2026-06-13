import { Test, TestingModule } from "@nestjs/testing";
import { AiModelConfigService } from "../ai-model-config.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SecretsService } from "@/modules/platform/credentials/storage/secrets/secrets.service";
import { UserApiKeysService } from "@/modules/platform/credentials/user-owned/user-api-keys/user-api-keys.service";
import { UserModelConfigsService } from "@/modules/platform/credentials/user-owned/user-model-configs/user-model-configs.service";
import { AIModelType } from "@prisma/client";
import { RequestContext } from "@/common/context/request-context";

describe("AiModelConfigService", () => {
  let service: AiModelConfigService;
  let prismaService: jest.Mocked<PrismaService>;
  let secretsService: jest.Mocked<SecretsService>;
  let userApiKeysService: jest.Mocked<UserApiKeysService>;

  const mockChatModel = {
    id: "model-1",
    name: "gpt-4o",
    displayName: "GPT-4 Optimized",
    provider: "openai",
    modelId: "gpt-4o",
    apiEndpoint: "https://api.openai.com/v1",
    apiKey: "sk-test-key",
    secretKey: null,
    maxTokens: 4000,
    temperature: 0.7,
    isEnabled: true,
    isDefault: true,
    modelType: "CHAT" as AIModelType,
    isReasoning: false,
    apiFormat: "openai",
    supportsTemperature: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsVision: false,
    tokenParamName: "max_tokens",
    defaultTimeoutMs: 120000,
    priceInputPerMillion: 5.0,
    priceOutputPerMillion: 15.0,
    priority: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
    icon: null,
    color: null,
    description: null,
  };

  const mockReasoningModel = {
    id: "model-2",
    name: "o1-preview",
    displayName: "OpenAI O1 Preview",
    provider: "openai",
    modelId: "o1-preview",
    apiEndpoint: "https://api.openai.com/v1",
    apiKey: "sk-test-key",
    secretKey: null,
    maxTokens: 8000,
    temperature: 1.0,
    isEnabled: true,
    isDefault: false,
    modelType: "CHAT" as AIModelType,
    isReasoning: true,
    apiFormat: "openai",
    supportsTemperature: false,
    supportsStreaming: true,
    supportsFunctionCalling: false,
    supportsVision: false,
    tokenParamName: "max_completion_tokens",
    defaultTimeoutMs: 300000,
    priceInputPerMillion: 15.0,
    priceOutputPerMillion: 60.0,
    priority: 90,
    createdAt: new Date(),
    updatedAt: new Date(),
    icon: null,
    color: null,
    description: null,
  };

  const mockGeminiModel = {
    id: "model-3",
    name: "gemini",
    displayName: "Gemini 2.0 Flash",
    provider: "google",
    modelId: "gemini-2.0-flash",
    apiEndpoint: "https://generativelanguage.googleapis.com",
    apiKey: null,
    secretKey: "GEMINI_API_KEY",
    maxTokens: 8000,
    temperature: 0.7,
    isEnabled: true,
    isDefault: false,
    modelType: "CHAT" as AIModelType,
    isReasoning: false,
    apiFormat: "google",
    supportsTemperature: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsVision: true,
    tokenParamName: "max_tokens",
    defaultTimeoutMs: 120000,
    priceInputPerMillion: 0.1,
    priceOutputPerMillion: 0.4,
    priority: 80,
    createdAt: new Date(),
    updatedAt: new Date(),
    icon: null,
    color: null,
    description: null,
  };

  beforeEach(async () => {
    const mockPrismaService = {
      aIModel: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      userApiKey: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      keyAssignment: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      userModelConfig: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    const mockSecretsService = {
      getValueInternal: jest.fn(),
    };

    const mockUserApiKeysService = {
      getPersonalKey: jest.fn().mockResolvedValue(null),
      getAvailableProviders: jest.fn().mockResolvedValue([]),
      // 2026-05-11 P2: toAIModelConfigFromUserConfig 走 DB ai_providers 兜底
      resolveProviderDefaults: jest.fn().mockImplementation((slug: string) =>
        Promise.resolve(
          slug === "deepseek"
            ? {
                endpoint: "https://api.deepseek.com/v1",
                apiFormat: "openai",
                testModel: "deepseek-chat",
              }
            : slug === "openai"
              ? {
                  endpoint: "https://api.openai.com/v1",
                  apiFormat: "openai",
                  testModel: "gpt-4o-mini",
                }
              : null,
        ),
      ),
    };

    const mockUserModelConfigsService = {
      findByModelId: jest.fn().mockResolvedValue(null),
      findDefaultForType: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "umc-created" }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiModelConfigService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: SecretsService, useValue: mockSecretsService },
        { provide: UserApiKeysService, useValue: mockUserApiKeysService },
        {
          provide: UserModelConfigsService,
          useValue: mockUserModelConfigsService,
        },
      ],
    }).compile();

    service = module.get<AiModelConfigService>(AiModelConfigService);
    prismaService = module.get(PrismaService);
    secretsService = module.get(SecretsService);
    userApiKeysService = module.get(UserApiKeysService);

    // Mock initial cache load to avoid async initialization issues
    // Return empty array by default, specific tests will override
    (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("refreshModelConfigCache", () => {
    it("should load CHAT and CHAT_FAST models into cache", async () => {
      // Arrange
      const models = [mockChatModel, mockReasoningModel];
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue(models);

      // Act
      await service.refreshModelConfigCache();

      // Assert
      expect(prismaService.aIModel.findMany).toHaveBeenCalledWith({
        where: {
          isEnabled: true,
        },
      });

      // Verify cache can retrieve models
      const config = await service.getModelConfig("gpt-4o");
      expect(config).not.toBeNull();
      expect(config?.modelId).toBe("gpt-4o");
    });

    it("should cache models by both modelId and name", async () => {
      // Arrange
      const modelWithDifferentName = {
        ...mockChatModel,
        name: "gpt4",
        modelId: "gpt-4o",
      };
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        modelWithDifferentName,
      ]);

      // Act
      await service.refreshModelConfigCache();

      // Assert - should be retrievable by both keys
      const byModelId = await service.getModelConfig("gpt-4o");
      const byName = await service.getModelConfig("gpt4");

      expect(byModelId).not.toBeNull();
      expect(byName).not.toBeNull();
      expect(byModelId?.id).toBe(byName?.id);
    });

    it("should handle database error gracefully", async () => {
      // Arrange
      (prismaService.aIModel.findMany as jest.Mock).mockRejectedValue(
        new Error("Database error"),
      );

      // Act & Assert - should not throw
      await expect(service.refreshModelConfigCache()).resolves.toBeUndefined();
    });
  });

  describe("getModelConfig", () => {
    beforeEach(async () => {
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        mockChatModel,
        mockReasoningModel,
      ]);
      await service.refreshModelConfigCache();
    });

    it("should return model from cache on exact match", async () => {
      // Act
      const config = await service.getModelConfig("gpt-4o");

      // Assert
      expect(config).not.toBeNull();
      expect(config?.modelId).toBe("gpt-4o");
      expect(config?.provider).toBe("openai");
    });

    it("should normalize modelId by removing #N suffix", async () => {
      // Act
      const config = await service.getModelConfig("gpt-4o#2");

      // Assert
      expect(config).not.toBeNull();
      expect(config?.modelId).toBe("gpt-4o");
    });

    it("should perform case-insensitive search", async () => {
      // Act
      const config = await service.getModelConfig("GPT-4O");

      // Assert
      expect(config).not.toBeNull();
      expect(config?.modelId).toBe("gpt-4o");
    });

    it("should query database on cache miss", async () => {
      // Arrange
      (prismaService.aIModel.findFirst as jest.Mock).mockResolvedValue(
        mockGeminiModel,
      );

      // Act
      const config = await service.getModelConfig("gemini-2.0-flash");

      // Assert
      expect(prismaService.aIModel.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [
            { modelId: { equals: "gemini-2.0-flash", mode: "insensitive" } },
            { name: { equals: "gemini-2.0-flash", mode: "insensitive" } },
          ],
          isEnabled: true,
        },
      });
      expect(config?.modelId).toBe("gemini-2.0-flash");
    });

    it("should return null for non-existent model", async () => {
      // Arrange
      (prismaService.aIModel.findFirst as jest.Mock).mockResolvedValue(null);

      // Act
      const config = await service.getModelConfig("non-existent-model");

      // Assert
      expect(config).toBeNull();
    });

    it("should refresh cache if TTL expired", async () => {
      // Arrange - Clear initial calls and setup mock
      jest.clearAllMocks();
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        mockChatModel,
      ]);

      // Force cache refresh by calling refreshModelConfigCache
      await service.refreshModelConfigCache();
      const firstCallCount = (prismaService.aIModel.findMany as jest.Mock).mock
        .calls.length;

      // Fast-forward time by 6 minutes (cache TTL is 5 minutes)
      jest.spyOn(Date, "now").mockReturnValue(Date.now() + 6 * 60 * 1000);

      // Act - This should trigger a cache refresh
      await service.getModelConfig("gpt-4o");

      // Assert - Should have called findMany again due to TTL expiry
      expect(prismaService.aIModel.findMany).toHaveBeenCalledTimes(
        firstCallCount + 1,
      );
    });
  });

  describe("getApiKeyForModel", () => {
    it("should return API key from secretKey if available", async () => {
      // Arrange
      const modelWithSecret = mockGeminiModel;
      (secretsService.getValueInternal as jest.Mock).mockResolvedValue(
        "secret-api-key-value",
      );

      // Act
      const apiKey = await service.getApiKeyForModel(modelWithSecret as any);

      // Assert
      expect(secretsService.getValueInternal).toHaveBeenCalledWith(
        "GEMINI_API_KEY",
      );
      expect(apiKey).toBe("secret-api-key-value");
    });

    it("should trim API key value from secretKey", async () => {
      // Arrange - model with secretKey that returns a value with whitespace
      (secretsService.getValueInternal as jest.Mock).mockResolvedValue(
        "  sk-test-key  ",
      );
      const model = { ...mockGeminiModel }; // has secretKey: "GEMINI_API_KEY"

      // Act
      const apiKey = await service.getApiKeyForModel(model as any);

      // Assert
      expect(apiKey).toBe("sk-test-key");
    });

    it("should return null if secretKey not found (no apiKey fallback)", async () => {
      // Arrange
      const modelWithSecret = { ...mockGeminiModel, apiKey: "fallback-key" };
      (secretsService.getValueInternal as jest.Mock).mockResolvedValue(null);

      // Act
      const apiKey = await service.getApiKeyForModel(modelWithSecret as any);

      // Assert - Priority 4 (plain apiKey) removed; returns null when secret not found
      expect(apiKey).toBeNull();
    });

    it("should return null if no API key available", async () => {
      // Arrange
      const modelNoKey = { ...mockChatModel, apiKey: null, secretKey: null };

      // Act
      const apiKey = await service.getApiKeyForModel(modelNoKey as any);

      // Assert
      expect(apiKey).toBeNull();
    });
  });

  describe("inferModelType - isReasoningModel", () => {
    it("should identify o1 models as reasoning", () => {
      // Act & Assert
      expect(service.isReasoningModel("o1-preview")).toBe(true);
      expect(service.isReasoningModel("o1-mini")).toBe(true);
      expect(service.isReasoningModel("o1")).toBe(true);
    });

    it("should identify o3 models as reasoning", () => {
      // Act & Assert
      expect(service.isReasoningModel("o3-mini")).toBe(true);
    });

    it("should identify gemini thinking models as reasoning", () => {
      // Act & Assert
      expect(service.isReasoningModel("gemini-2.0-flash-thinking")).toBe(true);
      expect(service.isReasoningModel("gemini-exp-1206")).toBe(true);
    });

    it("should identify deepseek r1 as reasoning", () => {
      // Act & Assert
      expect(service.isReasoningModel("deepseek-r1")).toBe(true);
      expect(service.isReasoningModel("deepseek-reasoner")).toBe(true);
    });

    it("should identify regular chat models as non-reasoning", () => {
      // Act & Assert
      expect(service.isReasoningModel("gpt-4o")).toBe(false);
      expect(service.isReasoningModel("claude-3-opus")).toBe(false);
      expect(service.isReasoningModel("gemini-2.0-flash")).toBe(false);
    });

    it("should use database config for isReasoning when available", async () => {
      // Arrange
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        mockReasoningModel,
      ]);
      await service.refreshModelConfigCache();

      // Act
      const isReasoning = service.isReasoningModel("o1-preview");

      // Assert
      expect(isReasoning).toBe(true);
    });

    // v3.1 §D.2.1: 显式 fallback 语义 — DB 字段优先于启发式
    it("should honor DB isReasoning=false even when modelId name matches reasoning heuristic", async () => {
      // Arrange: DB 设定 o1-mini 为 isReasoning=false（虚拟管理员覆盖）
      const dbOverride = {
        ...mockChatModel,
        modelId: "o1-mini",
        name: "o1-mini",
        isReasoning: false,
      };
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        dbOverride,
      ]);
      await service.refreshModelConfigCache();

      // Act: 走 DB 缓存路径
      const isReasoning = service.isReasoningModel("o1-mini");

      // Assert（2026-06-10 契约变更）：isReasoning 列是 Boolean @default(false) NOT NULL，
      //   "漏标"与"显式 false"不可区分，且 isReasoning 同时驱动 tokenParamName /
      //   supportsTemperature / reasoning_effort —— 对 reasoning 名模型（o1-mini）若判
      //   false 会自相矛盾（发 max_tokens + temperature 双双触发 OpenAI INVALID_REQUEST）。
      //   故对 reasoning 名模型做启发式 OR 兜底：DB false 仍判 true。
      //   admin 若需把某 reasoning 名模型强制当普通模型，显式设 tokenParamName=max_tokens
      //   （该字段直读、不被本兜底覆盖）。
      expect(isReasoning).toBe(true);
    });

    it("should fall back to heuristic when DB cache has no match for modelId", async () => {
      // Arrange: 缓存里没有 'o1-mini'，但启发式可识别
      const unrelated = { ...mockChatModel, modelId: "gpt-4o", name: "gpt-4o" };
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        unrelated,
      ]);
      await service.refreshModelConfigCache();

      // Act: o1-mini 不在 DB 缓存里 → 落到启发式
      const isReasoning = service.isReasoningModel("o1-mini");

      // Assert: 启发式 fallback 生效
      expect(isReasoning).toBe(true);
    });
  });

  describe("getModelById", () => {
    beforeEach(async () => {
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        mockChatModel,
      ]);
      await service.refreshModelConfigCache();
    });

    it("should find model by modelId", async () => {
      // Act
      const config = await service.getModelById("gpt-4o");

      // Assert
      expect(config).not.toBeNull();
      expect(config?.modelId).toBe("gpt-4o");
    });

    it("should find model by database UUID", async () => {
      // Arrange
      const uuid = "550e8400-e29b-41d4-a716-446655440000";

      // Mock getModelConfig to return null (cache miss)
      (prismaService.aIModel.findFirst as jest.Mock)
        .mockResolvedValueOnce(null) // First call from getModelConfig
        .mockResolvedValueOnce(mockChatModel); // Second call for UUID lookup

      // Act
      const config = await service.getModelById(uuid);

      // Assert
      // Should have attempted getModelConfig first, then UUID lookup
      expect(config?.modelId).toBe("gpt-4o");
    });

    it("should return null for non-existent ID", async () => {
      // Arrange
      (prismaService.aIModel.findFirst as jest.Mock).mockResolvedValue(null);

      // Act
      const config = await service.getModelById("non-existent");

      // Assert
      expect(config).toBeNull();
    });
  });

  describe("getDefaultModelConfig", () => {
    it("should return default CHAT model", async () => {
      // Arrange
      (prismaService.aIModel.findFirst as jest.Mock).mockResolvedValue(
        mockChatModel,
      );

      // Act
      const config = await service.getDefaultModelConfig();

      // Assert
      expect(prismaService.aIModel.findFirst).toHaveBeenCalledWith({
        where: {
          modelType: "CHAT",
          isEnabled: true,
          isDefault: true,
        },
        orderBy: {
          priority: "desc",
        },
      });
      expect(config?.isDefault).toBe(true);
    });

    it("should fallback to first enabled model if no default", async () => {
      // Arrange
      (prismaService.aIModel.findFirst as jest.Mock)
        .mockResolvedValueOnce(null) // No default
        .mockResolvedValueOnce(mockChatModel); // First enabled

      // Act
      const config = await service.getDefaultModelConfig();

      // Assert
      expect(config).not.toBeNull();
      expect(config?.modelId).toBe("gpt-4o");
    });

    it("should return null if no models available", async () => {
      // Arrange
      (prismaService.aIModel.findFirst as jest.Mock).mockResolvedValue(null);

      // Act
      const config = await service.getDefaultModelConfig();

      // Assert
      expect(config).toBeNull();
    });
  });

  describe("getDefaultModelByType", () => {
    // 2026-05-25 严格 BYOK 收口（「BYOK 不要到 admin，除非授权」）：
    //   无 userId / 用户没配 BYOK → 返回 null，**绝不**回退 admin AIModel。
    it("returns null with no userId context — strict BYOK, NO admin fallback", async () => {
      const fullModel = { ...mockChatModel, modelType: AIModelType.CHAT };
      (prismaService.aIModel.findFirst as jest.Mock).mockResolvedValue(
        fullModel,
      );

      const config = await service.getDefaultModelByType(AIModelType.CHAT);

      expect(config).toBeNull();
      // must NOT query the admin AIModel table for a no-userId call
      expect(prismaService.aIModel.findFirst).not.toHaveBeenCalled();
    });

    it("returns null for a userId with no BYOK config — NO admin fallback", async () => {
      const { RequestContext } =
        await import("../../../../../../common/context/request-context");
      const spy = jest
        .spyOn(RequestContext, "getUserId")
        .mockReturnValue("user-no-byok");
      // user has no UserModelConfig rows (mock default findMany → [])
      const config = await service.getDefaultModelByType(AIModelType.CHAT);

      expect(config).toBeNull();
      expect(prismaService.aIModel.findFirst).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("getReasoningModelConfig", () => {
    it("should return model marked as reasoning in database", async () => {
      // Arrange
      (prismaService.aIModel.findFirst as jest.Mock).mockResolvedValue(
        mockReasoningModel,
      );

      // Act
      const config = await service.getReasoningModelConfig();

      // Assert
      expect(prismaService.aIModel.findFirst).toHaveBeenCalledWith({
        where: {
          modelType: "CHAT",
          isEnabled: true,
          isReasoning: true,
        },
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      });
      expect(config?.isReasoning).toBe(true);
    });

    it("should fallback to known reasoning models by name", async () => {
      // Arrange
      (prismaService.aIModel.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        mockReasoningModel,
      ]);

      // Act
      const config = await service.getReasoningModelConfig();

      // Assert
      expect(config?.modelId).toBe("o1-preview");
    });

    it("should return null if no reasoning model found", async () => {
      // Arrange
      (prismaService.aIModel.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([]);

      // Act
      const config = await service.getReasoningModelConfig();

      // Assert
      expect(config).toBeNull();
    });
  });

  describe("getTimeoutForModel", () => {
    it("should return higher timeout for reasoning models", () => {
      // Act
      const timeout = service.getTimeoutForModel("o1-preview", 8000);

      // Assert
      expect(timeout).toBeGreaterThanOrEqual(300000); // At least 5 minutes
    });

    it("should return standard timeout for regular models", () => {
      // Act
      const timeout = service.getTimeoutForModel("gpt-4o", 4000);

      // Assert
      expect(timeout).toBeGreaterThanOrEqual(120000); // At least 2 minutes
      expect(timeout).toBeLessThan(300000); // Less than 5 minutes
    });

    it("should increase timeout for higher token counts", () => {
      // Act
      const smallTimeout = service.getTimeoutForModel("gpt-4o", 1000);
      const largeTimeout = service.getTimeoutForModel("gpt-4o", 10000);

      // Assert
      expect(largeTimeout).toBeGreaterThan(smallTimeout);
    });

    it("should cap timeout at maximum values", () => {
      // Act
      const timeout = service.getTimeoutForModel("gpt-4o", 1000000);

      // Assert
      expect(timeout).toBeLessThanOrEqual(600000); // Max 10 minutes for regular
    });
  });

  describe("getEnabledModelsForFrontend", () => {
    it("should return models without API keys", async () => {
      // Arrange
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        mockChatModel,
        mockReasoningModel,
      ]);

      // Act
      const models = await service.getEnabledModelsForFrontend();

      // Assert
      expect(models).toHaveLength(2);
      expect(models[0]).not.toHaveProperty("apiKey");
      expect(models[0]).toHaveProperty("modelId");
      expect(models[0]).toHaveProperty("provider");
    });

    it("should filter by modelType when specified", async () => {
      // Arrange
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        mockChatModel,
      ]);

      // Act
      await service.getEnabledModelsForFrontend(AIModelType.CHAT);

      // Assert
      expect(prismaService.aIModel.findMany).toHaveBeenCalledWith({
        where: {
          isEnabled: true,
          modelType: AIModelType.CHAT,
        },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
        select: expect.any(Object),
      });
    });

    it("should include icon URLs", async () => {
      // Arrange
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        mockChatModel,
      ]);

      // Act
      const models = await service.getEnabledModelsForFrontend();

      // Assert
      expect(models[0]).toHaveProperty("iconUrl");
      expect(models[0].iconUrl).toContain("/icons/ai/");
    });

    // ─── BYOK isUserKey 严格语义（2026-05-10 §1 v3）──────────
    // 规则：admin AIModel 仅在 user 有 ACTIVE KeyAssignment 指向**这个具体
    // AIModel.id**时才标 isUserKey=true。仅有该 provider 的 PERSONAL key 不够
    //（PERSONAL key ≠ "被授权使用这个 admin model"，admin 模型对该用户应是
    // 系统 Key 标识，除非有 KeyAssignment）。

    it("PERSONAL key alone does NOT make admin AIModel isUserKey=true (严格语义)", async () => {
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        mockChatModel, // openai, id='model-1'
        mockGeminiModel, // google
      ]);
      (prismaService.userApiKey.findMany as jest.Mock).mockResolvedValue([
        { provider: "openai" }, // PERSONAL key for openai but no KeyAssignment
      ]);
      (prismaService.keyAssignment.findMany as jest.Mock).mockResolvedValue([]);

      const models = await service.getEnabledModelsForFrontend(
        undefined,
        "user-1",
      );

      const openai = models.find((m) => m.provider.toLowerCase() === "openai");
      const google = models.find((m) => m.provider.toLowerCase() === "google");
      // 都不该是 My Key——用户没专门被授权这俩 admin 模型
      expect(openai?.isUserKey).toBeUndefined();
      expect(google?.isUserKey).toBeUndefined();
    });

    it("ACTIVE KeyAssignment matching specific modelDbId → isUserKey=true", async () => {
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        mockChatModel, // id='model-1'
        mockGeminiModel,
      ]);
      (prismaService.userApiKey.findMany as jest.Mock).mockResolvedValue([]);
      (prismaService.keyAssignment.findMany as jest.Mock).mockResolvedValue([
        { provider: "openai", modelDbId: "model-1" }, // 专门授权 openai 这条
      ]);

      const models = await service.getEnabledModelsForFrontend(
        undefined,
        "user-1",
      );

      const openai = models.find((m) => m.provider.toLowerCase() === "openai");
      const google = models.find((m) => m.provider.toLowerCase() === "google");
      expect(openai?.isUserKey).toBe(true);
      expect(google?.isUserKey).toBeUndefined(); // 无 google KeyAssignment
    });

    it("no isUserKey when no userId passed (anonymous)", async () => {
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        mockChatModel,
      ]);

      const models = await service.getEnabledModelsForFrontend();

      // 没 userId → 不查 user keys → 全 false
      expect(models[0].isUserKey).toBeUndefined();
    });

    it("no isUserKey when user has no PERSONAL keys", async () => {
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        mockChatModel,
      ]);
      (prismaService.userApiKey.findMany as jest.Mock).mockResolvedValue([]);

      const models = await service.getEnabledModelsForFrontend(
        undefined,
        "user-1",
      );

      expect(models[0].isUserKey).toBeUndefined();
    });

    it("graceful degrade when user key DB lookup fails", async () => {
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        mockChatModel,
      ]);
      (prismaService.userApiKey.findMany as jest.Mock).mockRejectedValue(
        new Error("DB unreachable"),
      );

      // 不抛错，退回无 BYOK 模式
      const models = await service.getEnabledModelsForFrontend(
        undefined,
        "user-1",
      );

      expect(models).toHaveLength(1);
      expect(models[0].isUserKey).toBeUndefined();
    });

    it("does NOT synthesize phantom models when user has provider key but no AIModel/UserModelConfig row", async () => {
      // 2026-05-10：BYOK_DEFAULT_MODELS 兜底已删除（双源根治）。
      // 仅有 provider key 不再凭空生成模型 — 用户必须显式 UserModelConfig 或 admin 配 AIModel。
      (prismaService.aIModel.findMany as jest.Mock)
        .mockResolvedValueOnce([mockChatModel]) // enabled openai
        .mockResolvedValueOnce([]); // disabled xai (none)
      (prismaService.userApiKey.findMany as jest.Mock).mockResolvedValue([
        { provider: "xai" },
      ]);

      const models = await service.getEnabledModelsForFrontend(
        AIModelType.CHAT,
        "user-1",
      );

      // openai 仍在，但 xai 不应被幻觉出来（DB 无 row + UserModelConfig 无 row）
      expect(models).toHaveLength(1);
      expect(models[0].provider.toLowerCase()).toBe("openai");
      const xaiModels = models.filter((m) =>
        m.provider.toLowerCase().includes("xai"),
      );
      expect(xaiModels).toHaveLength(0);
    });

    it("preserves model ordering (admin isDefault first)", async () => {
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        { ...mockChatModel, isDefault: true, displayName: "GPT-5 Default" },
        { ...mockReasoningModel, isDefault: false, displayName: "O1 Sub" },
      ]);

      const models = await service.getEnabledModelsForFrontend();

      // findMany 已按 [{isDefault: 'desc'}, {name: 'asc'}] 排序，service 不应重排
      expect(models[0].isDefault).toBe(true);
      expect(models[1].isDefault).toBe(false);
    });

    it("user has multiple provider keys but only providers with AIModel/UserModelConfig rows show up", async () => {
      // 2026-05-10 v3：admin AIModel + PERSONAL provider key（无 KeyAssignment） →
      // 模型仍出现在 dropdown，但 isUserKey=undefined（系统 Key 而非 My Key）
      (prismaService.aIModel.findMany as jest.Mock)
        .mockResolvedValueOnce([mockChatModel])
        .mockResolvedValueOnce([]);
      (prismaService.userApiKey.findMany as jest.Mock).mockResolvedValue([
        { provider: "openai" },
        { provider: "xai" },
      ]);
      (prismaService.keyAssignment.findMany as jest.Mock).mockResolvedValue([]);

      const models = await service.getEnabledModelsForFrontend(
        AIModelType.CHAT,
        "user-1",
      );

      const openai = models.find((m) => m.provider.toLowerCase() === "openai");
      const xai = models.find((m) => m.provider.toLowerCase().includes("xai"));
      expect(openai).toBeDefined();
      expect(openai?.isUserKey).toBeUndefined(); // 严格：仅 PERSONAL 不算 My Key
      expect(xai).toBeUndefined();
    });

    it("returns empty array when DB throws on main findMany (defensive)", async () => {
      (prismaService.aIModel.findMany as jest.Mock).mockRejectedValue(
        new Error("DB down"),
      );

      const models = await service.getEnabledModelsForFrontend();

      expect(Array.isArray(models)).toBe(true);
      expect(models).toHaveLength(0);
    });

    // W4-byok 2026-05-05 K：ASSIGNED 路径联合查询（管理员分配的 key）

    it("isUserKey=true when user has ASSIGNED key matching specific modelDbId", async () => {
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        mockChatModel, // id='model-1'
      ]);
      (prismaService.userApiKey.findMany as jest.Mock).mockResolvedValue([]);
      (prismaService.keyAssignment.findMany as jest.Mock).mockResolvedValue([
        { provider: "openai", modelDbId: "model-1" }, // 严格匹配 modelDbId
      ]);

      const models = await service.getEnabledModelsForFrontend(
        undefined,
        "user-1",
      );

      expect(models[0].isUserKey).toBe(true);
    });

    it("ASSIGNED for different modelDbId does NOT cross-mark", async () => {
      // 严格语义：ACTIVE KeyAssignment 仅作用于其 modelDbId 指向的具体 model
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        mockChatModel, // id='model-1', openai
        mockGeminiModel, // id='model-3', google
      ]);
      (prismaService.userApiKey.findMany as jest.Mock).mockResolvedValue([]);
      (prismaService.keyAssignment.findMany as jest.Mock).mockResolvedValue([
        { provider: "openai", modelDbId: "model-1" }, // 仅授权 openai 这条
      ]);

      const models = await service.getEnabledModelsForFrontend(
        undefined,
        "user-1",
      );

      const openai = models.find((m) => m.provider.toLowerCase() === "openai");
      const google = models.find((m) => m.provider.toLowerCase() === "google");
      expect(openai?.isUserKey).toBe(true);
      expect(google?.isUserKey).toBeUndefined(); // 同 provider 名也不串
    });

    it("PERSONAL + ASSIGNED：仅被 ASSIGNED 的具体 model 标 My Key", async () => {
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        mockChatModel, // id='model-1', openai
        mockGeminiModel, // id='model-3', google
      ]);
      // PERSONAL 全有，ASSIGNED 仅 google 这条
      (prismaService.userApiKey.findMany as jest.Mock).mockResolvedValue([
        { provider: "openai" },
        { provider: "google" },
      ]);
      (prismaService.keyAssignment.findMany as jest.Mock).mockResolvedValue([
        { provider: "google", modelDbId: "model-3" },
      ]);

      const models = await service.getEnabledModelsForFrontend(
        undefined,
        "user-1",
      );

      const openai = models.find((m) => m.provider.toLowerCase() === "openai");
      const google = models.find((m) => m.provider.toLowerCase() === "google");
      // openai：仅 PERSONAL → 不算 My Key（严格语义）
      expect(openai?.isUserKey).toBeUndefined();
      // google：ACTIVE KeyAssignment 指向 model-3 → My Key
      expect(google?.isUserKey).toBe(true);
    });

    it("ASSIGNED query failure does NOT break main flow (defensive)", async () => {
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        mockChatModel,
      ]);
      (prismaService.userApiKey.findMany as jest.Mock).mockResolvedValue([
        { provider: "openai" },
      ]);
      (prismaService.keyAssignment.findMany as jest.Mock).mockRejectedValue(
        new Error("DB error"),
      );

      // Promise.all rejects when any rejects → catch fires → userProviders empty → 全 false
      const models = await service.getEnabledModelsForFrontend(
        undefined,
        "user-1",
      );

      expect(models).toHaveLength(1);
      // 因为 Promise.all reject 后整个 try/catch 触发 → userProviders 为空 set
      expect(models[0].isUserKey).toBeUndefined();
    });
  });

  describe("getApiFormatForProvider", () => {
    it("should return anthropic for Claude", () => {
      expect(service.getApiFormatForProvider("anthropic")).toBe("anthropic");
      expect(service.getApiFormatForProvider("claude")).toBe("anthropic");
    });

    it("should return google for Gemini", () => {
      expect(service.getApiFormatForProvider("google")).toBe("google");
      expect(service.getApiFormatForProvider("gemini")).toBe("google");
    });

    it("should return xai for Grok", () => {
      expect(service.getApiFormatForProvider("xai")).toBe("xai");
      expect(service.getApiFormatForProvider("grok")).toBe("xai");
    });

    it("should default to openai for unknown providers", () => {
      expect(service.getApiFormatForProvider("unknown")).toBe("openai");
      expect(service.getApiFormatForProvider("openai")).toBe("openai");
    });
  });

  describe("getAllModelsForDiagnostics", () => {
    it("should return model diagnostics with API key flags", async () => {
      // Arrange
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        mockChatModel,
        mockGeminiModel,
      ]);

      // Act
      const diagnostics = await service.getAllModelsForDiagnostics();

      // Assert
      expect(diagnostics).toHaveLength(2);
      expect(diagnostics[0]).toHaveProperty("hasApiKey", true);
      expect(diagnostics[0]).toHaveProperty("hasSecretKey", false);
      expect(diagnostics[1]).toHaveProperty("hasApiKey", false);
      expect(diagnostics[1]).toHaveProperty("hasSecretKey", true);
    });
  });

  // ==================== resolveApiKey - uncovered branches ====================

  describe("resolveApiKey - additional coverage", () => {
    // BYOK v2: 无 userId 时只保留系统 Secret 回退路径（过渡期，供旧定时任务使用）。
    // 捐赠共享池已退役（W4b），无 donated 优先级分支。
    it("falls back to system secret when userId is absent and model.secretKey exists", async () => {
      (secretsService.getValueInternal as jest.Mock).mockResolvedValue(
        "sys-secret-value",
      );
      const result = await service.resolveApiKey(mockGeminiModel as any);
      expect(result).toEqual({
        apiKey: "sys-secret-value",
        source: "system",
      });
    });

    it("returns null when userId is absent and secretKey is missing", async () => {
      (secretsService.getValueInternal as jest.Mock).mockResolvedValue(null);
      const modelWithNoSecret = { ...mockChatModel, secretKey: null };
      const result = await service.resolveApiKey(modelWithNoSecret as any);
      expect(result).toBeNull();
    });

    it("returns null when secretKey is configured but not found", async () => {
      (secretsService.getValueInternal as jest.Mock).mockResolvedValue(null);
      const result = await service.resolveApiKey(mockGeminiModel as any);
      expect(result).toBeNull();
    });
  });

  // ==================== getEnabledModelsForFrontend - BYOK paths ====================

  describe("getEnabledModelsForFrontend - BYOK coverage", () => {
    it("should NOT synthesize phantom models for providers absent from DB (双源根治)", async () => {
      // 2026-05-10：BYOK_DEFAULT_MODELS 兜底已删除 — provider key 存在但 DB 无 row
      // 时不再合成虚拟模型；用户必须显式 UserModelConfig 或 admin 配 AIModel 才能使用。
      (prismaService.aIModel.findMany as jest.Mock)
        .mockResolvedValueOnce([mockChatModel]) // enabled openai
        .mockResolvedValueOnce([]); // anthropic 在 DB 完全没 row
      (prismaService as any).userApiKey = {
        findMany: jest.fn().mockResolvedValue([{ provider: "anthropic" }]),
      };

      const result = await service.getEnabledModelsForFrontend(
        undefined,
        "user-with-anthropic",
      );

      // 仅 openai 入选，anthropic 被正确排除（不应被幻觉出来）
      const anthropic = result.filter(
        (m) => m.provider.toLowerCase() === "anthropic",
      );
      expect(anthropic).toHaveLength(0);
      const isByok = result.filter(
        (m) => (m as Record<string, unknown>).isByokGenerated,
      );
      expect(isByok).toHaveLength(0);
    });

    it("should NOT auto-revive disabled AIModel rows from user's provider key (双源根治 v2)", async () => {
      // 2026-05-10：删除 userExtraModels（disabled AIModel + provider key 自动捞回）
      // 路径。admin 主动禁用 = 真消失。用户想用必须显式 UserModelConfig。
      const disabledAnthropicModel = {
        ...mockChatModel,
        id: "disabled-model",
        provider: "anthropic",
        isEnabled: false,
        icon: null,
        color: null,
        description: null,
      };

      (prismaService.aIModel.findMany as jest.Mock)
        .mockResolvedValueOnce([mockChatModel]) // enabled openai
        .mockResolvedValueOnce([disabledAnthropicModel]); // disabled anthropic 即使存在也不再回显

      (prismaService as any).userApiKey = {
        findMany: jest.fn().mockResolvedValue([{ provider: "anthropic" }]),
      };

      const result = await service.getEnabledModelsForFrontend(
        undefined,
        "user-anthropic",
      );

      // anthropic 行被 admin 禁用 → 即使 user 有 provider key 也不回显
      const anthropicModels = result.filter(
        (m) => m.provider.toLowerCase() === "anthropic",
      );
      expect(anthropicModels).toHaveLength(0);
      // openai 仍在
      expect(result.some((m) => m.provider.toLowerCase() === "openai")).toBe(
        true,
      );
    });

    it("should handle user API key fetch error gracefully", async () => {
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValueOnce([
        mockChatModel,
      ]);
      (prismaService as any).userApiKey = {
        findMany: jest.fn().mockRejectedValue(new Error("Key fetch error")),
      };

      const result = await service.getEnabledModelsForFrontend(
        undefined,
        "user-123",
      );

      // Should still return enabled models even if user key fetch fails
      expect(result).toHaveLength(1);
    });

    it("returns empty when modelType filter has no AIModel/UserModelConfig matches even with provider key", async () => {
      // 2026-05-10：合成兜底已去除，单纯持有 provider key + modelType 过滤无任何真源 → 空。
      (prismaService.aIModel.findMany as jest.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      (prismaService as any).userApiKey = {
        findMany: jest.fn().mockResolvedValue([{ provider: "anthropic" }]),
      };

      const result = await service.getEnabledModelsForFrontend(
        "IMAGE" as any,
        "user-123",
      );

      expect(result).toHaveLength(0);
    });
  });

  // ==================== findDisabledModelForUser (via getModelConfig) ====================

  describe("findDisabledModelForUser - via getModelConfig", () => {
    it("should return disabled model config when user has provider key", async () => {
      const { RequestContext } =
        await import("../../../../../../common/context/request-context");
      const spy = jest
        .spyOn(RequestContext, "getUserId")
        .mockReturnValue("user-byok-123");

      // Cache miss, DB query for enabled models returns nothing
      (prismaService.aIModel.findFirst as jest.Mock)
        .mockResolvedValueOnce(null) // no enabled model found
        .mockResolvedValueOnce({
          ...mockChatModel,
          isEnabled: false,
          provider: "openai",
        }); // disabled model found

      // User has key for openai
      (userApiKeysService.getPersonalKey as jest.Mock).mockResolvedValue({
        apiKey: "user-openai-key",
        apiEndpoint: null,
      });

      const result = await service.getModelConfig("gpt-4o-disabled");

      spy.mockRestore();
      expect(result).not.toBeNull();
      expect(result?.provider).toBe("openai");
    });

    it("should return null when user has no key for provider", async () => {
      const { RequestContext } =
        await import("../../../../../../common/context/request-context");
      const spy = jest
        .spyOn(RequestContext, "getUserId")
        .mockReturnValue("user-no-key-123");

      (prismaService.aIModel.findFirst as jest.Mock)
        .mockResolvedValueOnce(null) // no enabled model
        .mockResolvedValueOnce({
          ...mockChatModel,
          isEnabled: false,
        }); // disabled model found

      // User has no key
      (userApiKeysService.getPersonalKey as jest.Mock).mockResolvedValue(null);

      const result = await service.getModelConfig("gpt-4o-disabled-no-key");

      spy.mockRestore();
      expect(result).toBeNull();
    });

    it("should return null when no user context", async () => {
      const { RequestContext } =
        await import("../../../../../../common/context/request-context");
      const spy = jest
        .spyOn(RequestContext, "getUserId")
        .mockReturnValue(undefined);

      (prismaService.aIModel.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.getModelConfig("some-disabled-model");
      spy.mockRestore();
      expect(result).toBeNull();
    });
  });

  // ============ synthesizeConfigForUserModel - 并行 key 取回 (via getModelConfig) ============

  describe("synthesizeConfigForUserModel - parallel key fetch", () => {
    it("synthesizes from the provider whose preferredModelId matches (others miss)", async () => {
      const { RequestContext } =
        await import("../../../../../../common/context/request-context");
      const spy = jest
        .spyOn(RequestContext, "getUserId")
        .mockReturnValue("user-byok-syn");

      // 1~5 全 miss：cache 空 + enabled/disabled AIModel.findFirst → null + UserModelConfig → null
      (prismaService.aIModel.findFirst as jest.Mock).mockResolvedValue(null);

      (userApiKeysService.getAvailableProviders as jest.Mock).mockResolvedValue(
        ["openai", "deepseek"],
      );
      (userApiKeysService.getPersonalKey as jest.Mock).mockImplementation(
        (_uid: string, provider: string) =>
          Promise.resolve(
            provider === "deepseek"
              ? {
                  apiEndpoint: "https://api.deepseek.com/v1",
                  preferredModelId: "agnes-2.0-flash",
                }
              : { apiEndpoint: null, preferredModelId: "gpt-4o" },
          ),
      );

      const result = await service.getModelConfig("agnes-2.0-flash");
      spy.mockRestore();

      expect(result).not.toBeNull();
      expect(result?.provider).toBe("deepseek");
      expect(result?.modelId).toBe("agnes-2.0-flash");
      expect(result?.apiEndpoint).toBe("https://api.deepseek.com/v1");
      // 并行取回：两个 provider 的 key 都被请求（不是命中即停的串行）
      expect(userApiKeysService.getPersonalKey).toHaveBeenCalledTimes(2);
    });

    it("lazily persists the synthesized model as a UserModelConfig (register once)", async () => {
      const { RequestContext } =
        await import("../../../../../../common/context/request-context");
      const spy = jest
        .spyOn(RequestContext, "getUserId")
        .mockReturnValue("user-byok-lazy");

      (prismaService.aIModel.findFirst as jest.Mock).mockResolvedValue(null);
      (userApiKeysService.getAvailableProviders as jest.Mock).mockResolvedValue(
        ["deepseek"],
      );
      (userApiKeysService.getPersonalKey as jest.Mock).mockResolvedValue({
        apiEndpoint: "https://api.deepseek.com/v1",
        preferredModelId: "agnes-2.0-flash",
      });

      const result = await service.getModelConfig("agnes-2.0-flash");
      spy.mockRestore();

      expect(result?.modelId).toBe("agnes-2.0-flash");
      // ★ 合成后惰性落库成 UserModelConfig —— 下次解析走 findByModelId 快路径，不再 synthesize
      const create = (
        service as unknown as { userModelConfigs: { create: jest.Mock } }
      ).userModelConfigs.create;
      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith(
        "user-byok-lazy",
        expect.objectContaining({
          provider: "deepseek",
          modelId: "agnes-2.0-flash",
          apiEndpoint: "https://api.deepseek.com/v1",
          isDefault: false,
          isEnabled: true,
        }),
      );
    });

    it("preserves provider order: picks the first match when several providers match", async () => {
      const { RequestContext } =
        await import("../../../../../../common/context/request-context");
      const spy = jest
        .spyOn(RequestContext, "getUserId")
        .mockReturnValue("user-byok-order");

      (prismaService.aIModel.findFirst as jest.Mock).mockResolvedValue(null);

      // openai 在数组首位 → 即便两者都匹配，也应选 openai（与原串行「首个匹配即返回」一致）
      (userApiKeysService.getAvailableProviders as jest.Mock).mockResolvedValue(
        ["openai", "deepseek"],
      );
      (userApiKeysService.getPersonalKey as jest.Mock).mockImplementation(
        (_uid: string, provider: string) =>
          Promise.resolve({
            apiEndpoint: `https://${provider}.example/v1`,
            preferredModelId: "shared-model",
          }),
      );

      const result = await service.getModelConfig("shared-model");
      spy.mockRestore();

      expect(result?.provider).toBe("openai");
      expect(result?.apiEndpoint).toBe("https://openai.example/v1");
    });

    it("returns null when no provider key matches the modelId", async () => {
      const { RequestContext } =
        await import("../../../../../../common/context/request-context");
      const spy = jest
        .spyOn(RequestContext, "getUserId")
        .mockReturnValue("user-byok-nomatch");

      (prismaService.aIModel.findFirst as jest.Mock).mockResolvedValue(null);
      (userApiKeysService.getAvailableProviders as jest.Mock).mockResolvedValue(
        ["openai"],
      );
      (userApiKeysService.getPersonalKey as jest.Mock).mockResolvedValue({
        apiEndpoint: null,
        preferredModelId: "some-other-model",
      });

      const result = await service.getModelConfig("agnes-2.0-flash");
      spy.mockRestore();

      expect(result).toBeNull();
    });
  });

  // ==================== getModelsByProvider + getFirstModelByProvider ====================

  describe("getModelsByProvider", () => {
    it("should return models matching provider name", async () => {
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        mockChatModel,
      ]);

      const result = await service.getModelsByProvider("openai");
      expect(result).toHaveLength(1);
      expect(result[0].provider).toBe("openai");
    });
  });

  describe("getFirstModelByProvider", () => {
    it("should return first model with apiKey for given provider", async () => {
      (prismaService.aIModel.findFirst as jest.Mock).mockResolvedValue(
        mockChatModel,
      );

      const result = await service.getFirstModelByProvider("openai");
      expect(result?.modelId).toBe("gpt-4o");
    });

    it("should return null when no matching model exists", async () => {
      (prismaService.aIModel.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.getFirstModelByProvider("nonexistent");
      expect(result).toBeNull();
    });
  });

  // ==================== getIconUrl (via getEnabledModelsForFrontend) ====================

  describe("getIconUrl - provider-based icon routing", () => {
    // getIconUrl checks name first then provider. Each case uses a unique combination
    // to ensure the expected icon branch fires correctly.
    const iconTestCases = [
      // Name-based detection (provider is neutral "custom" to avoid early matches)
      {
        name: "grok-model",
        provider: "custom",
        expectedIcon: "/icons/ai/grok.svg",
      },
      {
        name: "chatgpt-4",
        provider: "custom",
        expectedIcon: "/icons/ai/openai.svg",
      },
      {
        name: "claude-3",
        provider: "custom",
        expectedIcon: "/icons/ai/claude.svg",
      },
      {
        name: "gemini-flash",
        provider: "custom",
        expectedIcon: "/icons/ai/gemini.svg",
      },
      {
        name: "deepseek-chat",
        provider: "custom",
        expectedIcon: "/icons/ai/deepseek.svg",
      },
      {
        name: "qwen-max",
        provider: "custom",
        expectedIcon: "/icons/ai/qwen.svg",
      },
      {
        name: "kimi-v1",
        provider: "custom",
        expectedIcon: "/icons/ai/kimi.svg",
      },
      {
        name: "glm-4",
        provider: "custom",
        expectedIcon: "/icons/ai/zhipu.svg",
      },
      {
        name: "doubao-turbo",
        provider: "custom",
        expectedIcon: "/icons/ai/doubao.svg",
      },
      // Provider-based detection (name is neutral "unknown-model")
      {
        name: "unknown-model",
        provider: "xai",
        expectedIcon: "/icons/ai/grok.svg",
      },
      {
        name: "unknown-model",
        provider: "anthropic",
        expectedIcon: "/icons/ai/claude.svg",
      },
      {
        name: "unknown-model",
        provider: "google",
        expectedIcon: "/icons/ai/gemini.svg",
      },
      {
        name: "unknown-model",
        provider: "deepseek",
        expectedIcon: "/icons/ai/deepseek.svg",
      },
      {
        name: "unknown-model",
        provider: "alibaba",
        expectedIcon: "/icons/ai/qwen.svg",
      },
      {
        name: "unknown-model",
        provider: "moonshot",
        expectedIcon: "/icons/ai/kimi.svg",
      },
      {
        name: "unknown-model",
        provider: "zhipu",
        expectedIcon: "/icons/ai/zhipu.svg",
      },
      {
        name: "unknown-model",
        provider: "bytedance",
        expectedIcon: "/icons/ai/doubao.svg",
      },
      {
        name: "unknown-model",
        provider: "openai",
        expectedIcon: "/icons/ai/openai.svg",
      },
    ];

    it.each(iconTestCases)(
      "maps name='$name' provider='$provider' to '$expectedIcon'",
      async ({ name, provider, expectedIcon }) => {
        const modelRow = {
          ...mockChatModel,
          id: `test-${name}`,
          name,
          displayName: name,
          provider,
          modelId: name,
          icon: null,
          color: null,
          description: null,
        };
        (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
          modelRow,
        ]);

        const result = await service.getEnabledModelsForFrontend();
        expect(result[0].iconUrl).toBe(expectedIcon);
      },
    );

    it("returns empty string for unrecognized model/provider", async () => {
      const modelRow = {
        ...mockChatModel,
        name: "mystery-model",
        displayName: "Mystery",
        provider: "unknown-corp",
        modelId: "mystery-1",
        icon: null,
        color: null,
        description: null,
      };
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        modelRow,
      ]);

      const result = await service.getEnabledModelsForFrontend();
      expect(result[0].iconUrl).toBe("");
    });
  });

  // ==================== buildModelConfig - additional branches ====================

  describe("buildModelConfig - additional inference branches", () => {
    it("should use DB apiFormat when it does not conflict with provider", async () => {
      // xai provider with xai apiFormat - no conflict
      const row = {
        ...mockChatModel,
        provider: "xai",
        modelId: "grok-3",
        name: "grok-3",
        apiFormat: "xai",
      };
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([row]);
      await service.refreshModelConfigCache();

      const config = await service.getModelConfig("grok-3");
      expect(config?.apiFormat).toBe("xai");
    });

    it("should use 'max_tokens' tokenParamName for non-reasoning model without DB value", async () => {
      const row = {
        ...mockChatModel,
        modelId: "gpt-4o-mini",
        name: "gpt-4o-mini",
        isReasoning: false,
        tokenParamName: null,
      };
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([row]);
      await service.refreshModelConfigCache();

      const config = await service.getModelConfig("gpt-4o-mini");
      expect(config?.tokenParamName).toBe("max_tokens");
    });

    it("should use default 300000ms timeout for reasoning model without DB value", async () => {
      const row = {
        ...mockChatModel,
        modelId: "o1-mini",
        name: "o1-mini",
        isReasoning: true,
        defaultTimeoutMs: null,
      };
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([row]);
      await service.refreshModelConfigCache();

      const config = await service.getModelConfig("o1-mini");
      expect(config?.defaultTimeoutMs).toBe(300000);
    });

    it("should use default 120000ms timeout for non-reasoning model without DB value", async () => {
      const row = {
        ...mockChatModel,
        modelId: "gpt-4-standard",
        name: "gpt-4-standard",
        isReasoning: false,
        defaultTimeoutMs: null,
      };
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([row]);
      await service.refreshModelConfigCache();

      const config = await service.getModelConfig("gpt-4-standard");
      expect(config?.defaultTimeoutMs).toBe(120000);
    });

    it("should default priority to 50 when not set", async () => {
      const row = {
        ...mockChatModel,
        modelId: "gpt-no-priority",
        name: "gpt-no-priority",
        priority: null,
      };
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([row]);
      await service.refreshModelConfigCache();

      const config = await service.getModelConfig("gpt-no-priority");
      expect(config?.priority).toBe(50);
    });
  });

  // ==================== getModelById - additional path coverage ====================

  describe("getModelById - additional paths", () => {
    it("should find non-CHAT model by direct query when not in CHAT cache", async () => {
      // Cache has only CHAT models, but IMAGE model exists
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        mockChatModel,
      ]);
      await service.refreshModelConfigCache();

      const imageModel = {
        ...mockChatModel,
        modelId: "dall-e-3",
        name: "dall-e-3",
        modelType: "IMAGE_GENERATION",
      };

      // First findFirst (from getModelConfig cache miss) = null, then direct query
      (prismaService.aIModel.findFirst as jest.Mock)
        .mockResolvedValueOnce(null) // CHAT/CHAT_FAST query miss
        .mockResolvedValueOnce(imageModel); // direct all-types query

      const { RequestContext } = jest.requireMock(
        "../../../../../../common/context/request-context",
      );
      RequestContext.getUserId.mockReturnValue(null);

      const result = await service.getModelById("dall-e-3");
      expect(result?.modelId).toBe("dall-e-3");
    });

    // 2026-05-10：dropdown 选 UserModelConfig 时前端传 CUID（25 字符），
    // getModelById 需要按 CUID 查 UserModelConfig 表，否则 fallback default 抛
    // "No CHAT AI model is available"。
    it("should find UserModelConfig by CUID when admin AIModel lookup misses", async () => {
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([]);
      await service.refreshModelConfigCache();

      const cuid = "cmozx0oj600almv01iuogi49p"; // 25 字符 CUID
      const userCfg = {
        id: cuid,
        userId: "user-1",
        modelId: "deepseek-v4-flash",
        displayName: "deepseek-v4-flash",
        provider: "deepseek",
        modelType: "CHAT" as const,
        apiEndpoint: null,
        isEnabled: true,
        isDefault: false,
        isReasoning: false,
        maxTokens: 4096,
        temperature: 0.7,
        priority: 50,
      };

      // AIModel.findFirst 全部 miss（任何调用次数都返回 null）
      (prismaService.aIModel.findFirst as jest.Mock).mockResolvedValue(null);

      // UserModelConfig.findFirst 命中（CUID 查询）
      (prismaService.userModelConfig.findFirst as jest.Mock).mockResolvedValue(
        userCfg,
      );

      // RequestContext.run 真实运行上下文（jest.mock 没声明，requireMock 不工作）
      const { RequestContext } =
        await import("../../../../../../common/context/request-context");
      const result = await RequestContext.run({ userId: "user-1" }, async () =>
        service.getModelById(cuid),
      );
      expect(result).not.toBeNull();
      expect(result?.modelId).toBe("deepseek-v4-flash");
      expect(result?.provider).toBe("deepseek");
    });

    it("should handle UUID-based lookup error gracefully", async () => {
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([]);
      await service.refreshModelConfigCache();

      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      (prismaService.aIModel.findFirst as jest.Mock)
        .mockResolvedValueOnce(null) // getModelConfig miss
        .mockRejectedValueOnce(new Error("DB error on uuid")) // UUID lookup error
        .mockResolvedValueOnce(null); // direct query

      const { RequestContext } = jest.requireMock(
        "../../../../../../common/context/request-context",
      );
      RequestContext.getUserId.mockReturnValue(null);

      const result = await service.getModelById(uuid);
      expect(result).toBeNull();
    });
  });

  // ==================== getAllEnabledModelsByType - error path ====================

  describe("getAllEnabledModelsByType - additional coverage", () => {
    it("should not apply modelId filter when excludeModelIds is empty", async () => {
      (prismaService.aIModel.findMany as jest.Mock).mockResolvedValue([
        mockChatModel,
      ]);

      await service.getAllEnabledModelsByType("CHAT" as any);

      const callArg = (prismaService.aIModel.findMany as jest.Mock).mock
        .calls[0][0];
      // modelId filter should NOT be present when excludeModelIds is []
      expect(callArg.where.modelId).toBeUndefined();
    });
  });

  // ==================== getDefaultModelByType - error path ====================

  describe("getDefaultModelByType - error path", () => {
    it("should return null and log error on DB failure", async () => {
      (prismaService.aIModel.findFirst as jest.Mock).mockRejectedValue(
        new Error("DB failure"),
      );

      const result = await service.getDefaultModelByType("CHAT" as any);
      expect(result).toBeNull();
    });
  });

  // ====================================================================
  // BYOK 解析缓存（perf：per-(userId, modelId) 5min TTL + 主动失效）
  // ====================================================================
  describe("resolved-model cache", () => {
    let resolveSpy: jest.SpyInstance;
    let nowSpy: jest.SpyInstance;

    const T0 = 1_700_000_000_000;

    beforeEach(() => {
      // 桩掉串行 DB fallback 链，只观察它被调了几次（=是否命中缓存）
      resolveSpy = jest
        .spyOn(service as any, "resolveModelByIdUncached")
        .mockResolvedValue({ modelId: "gpt-4o", provider: "openai" });
      nowSpy = jest.spyOn(Date, "now").mockReturnValue(T0);
    });

    afterEach(() => {
      resolveSpy.mockRestore();
      nowSpy.mockRestore();
      service.clearResolvedModelCache(); // 清全局，避免跨用例污染
    });

    it("命中缓存：TTL 内第二次调用跳过 DB 解析链", async () => {
      await RequestContext.run({ userId: "u1" }, async () => {
        await service.getModelById("gpt-4o");
        await service.getModelById("gpt-4o");
      });
      expect(resolveSpy).toHaveBeenCalledTimes(1);
    });

    it("TTL 内（2min，旧 60s 已过、新 5min 未过）仍命中缓存", async () => {
      await RequestContext.run({ userId: "u1" }, async () => {
        await service.getModelById("gpt-4o");
        nowSpy.mockReturnValue(T0 + 120_000); // 旧 60s TTL 已过，但在新 5min TTL 内
        await service.getModelById("gpt-4o");
      });
      // BYOK 冷解析每 5min 才回源一次（而非每会话），这是 TTL 60s→5min 的核心收益
      expect(resolveSpy).toHaveBeenCalledTimes(1);
    });

    it("TTL 过期（>5min）后回源重新解析", async () => {
      await RequestContext.run({ userId: "u1" }, async () => {
        await service.getModelById("gpt-4o");
        nowSpy.mockReturnValue(T0 + 5 * 60 * 1000 + 1); // 越过 5min TTL
        await service.getModelById("gpt-4o");
      });
      expect(resolveSpy).toHaveBeenCalledTimes(2);
    });

    it("不同 userId 各自独立缓存（按用户隔离）", async () => {
      await RequestContext.run({ userId: "u1" }, () =>
        service.getModelById("gpt-4o"),
      );
      await RequestContext.run({ userId: "u2" }, () =>
        service.getModelById("gpt-4o"),
      );
      expect(resolveSpy).toHaveBeenCalledTimes(2);
    });

    it("clearResolvedModelCache(userId) 强制该用户回源", async () => {
      await RequestContext.run({ userId: "u1" }, async () => {
        await service.getModelById("gpt-4o");
        service.clearResolvedModelCache("u1");
        await service.getModelById("gpt-4o");
      });
      expect(resolveSpy).toHaveBeenCalledTimes(2);
    });

    it("clearResolvedModelCache(userId) 只清该用户、不动其他用户缓存", async () => {
      await RequestContext.run({ userId: "u1" }, () =>
        service.getModelById("gpt-4o"),
      );
      await RequestContext.run({ userId: "u2" }, () =>
        service.getModelById("gpt-4o"),
      );
      expect(resolveSpy).toHaveBeenCalledTimes(2);

      service.clearResolvedModelCache("u1");

      // u1 需回源（+1），u2 仍命中缓存（不变）
      await RequestContext.run({ userId: "u1" }, () =>
        service.getModelById("gpt-4o"),
      );
      await RequestContext.run({ userId: "u2" }, () =>
        service.getModelById("gpt-4o"),
      );
      expect(resolveSpy).toHaveBeenCalledTimes(3);
    });
  });
});
