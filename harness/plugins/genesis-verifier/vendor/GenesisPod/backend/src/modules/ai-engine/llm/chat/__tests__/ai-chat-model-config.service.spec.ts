import { Test, TestingModule } from "@nestjs/testing";
import { AiChatModelConfigService } from "../ai-chat-model-config.service";
// v3.1 A0：wrapper 现委托给 canonical AiModelConfigService，测试通过 DI 容器
// 同时提供两者，验证 wrapper API surface 与底层等价行为。
import { AiModelConfigService } from "../../models/config/ai-model-config.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SecretsService } from "@/modules/platform/credentials/storage/secrets/secrets.service";
import { UserApiKeysService } from "@/modules/platform/credentials/user-owned/user-api-keys/user-api-keys.service";
import { AIModelType } from "@prisma/client";

function createMockDbModel(overrides: Record<string, unknown> = {}) {
  return {
    id: "db-model-id",
    name: "gpt-4o",
    displayName: "GPT-4o",
    provider: "openai",
    modelId: "gpt-4o",
    apiEndpoint: "https://api.openai.com/v1",
    apiKey: "test-api-key",
    secretKey: null,
    maxTokens: 4000,
    temperature: 0.7,
    isEnabled: true,
    isDefault: false,
    isReasoning: false,
    apiFormat: "openai",
    supportsTemperature: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsVision: false,
    tokenParamName: "max_tokens",
    defaultTimeoutMs: 120000,
    priceInputPerMillion: null,
    priceOutputPerMillion: null,
    priority: 50,
    modelType: "CHAT",
    ...overrides,
  };
}

describe("AiChatModelConfigService", () => {
  let service: AiChatModelConfigService;
  let mockPrisma: any;
  let mockSecretsService: any;

  beforeEach(async () => {
    mockPrisma = {
      aIModel: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    mockSecretsService = {
      getValueInternal: jest.fn().mockResolvedValue(null),
    };

    const mockUserApiKeysService = {
      getAvailableProviders: jest.fn().mockResolvedValue([]),
      getPersonalKey: jest.fn().mockResolvedValue(null),
      resolveProviderDefaults: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiChatModelConfigService,
        AiModelConfigService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SecretsService, useValue: mockSecretsService },
        { provide: UserApiKeysService, useValue: mockUserApiKeysService },
      ],
    }).compile();

    service = module.get<AiChatModelConfigService>(AiChatModelConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== getApiKeyForModel ====================

  describe("getApiKeyForModel", () => {
    it("should return null when no secretKey (direct apiKey no longer supported)", async () => {
      const model = {
        id: "test-id",
        name: "test",
        displayName: "Test",
        provider: "openai",
        modelId: "gpt-4o",
        apiEndpoint: "https://api.openai.com/v1",
        apiKey: "direct-api-key",
        secretKey: null,
        maxTokens: 4000,
        temperature: 0.7,
        isEnabled: true,
        isDefault: false,
      } as any;

      const key = await service.getApiKeyForModel(model);
      expect(key).toBeNull();
    });

    it("should trim whitespace from secretKey value", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue(
        "  key-with-spaces  ",
      );

      const model = {
        id: "test-id",
        name: "test",
        displayName: "Test",
        provider: "openai",
        modelId: "gpt-4o",
        apiEndpoint: "",
        apiKey: null,
        secretKey: "MY_API_KEY",
        maxTokens: 4000,
        temperature: 0.7,
        isEnabled: true,
        isDefault: false,
      } as any;

      const key = await service.getApiKeyForModel(model);
      expect(key).toBe("key-with-spaces");
    });

    it("should use secretKey from secrets service", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue("secret-api-key");

      const model = {
        id: "test-id",
        name: "test",
        displayName: "Test",
        provider: "openai",
        modelId: "gpt-4o",
        apiEndpoint: "",
        apiKey: "fallback-key",
        secretKey: "MY_API_KEY_SECRET",
        maxTokens: 4000,
        temperature: 0.7,
        isEnabled: true,
        isDefault: false,
      } as any;

      const key = await service.getApiKeyForModel(model);
      expect(key).toBe("secret-api-key");
      expect(mockSecretsService.getValueInternal).toHaveBeenCalledWith(
        "MY_API_KEY_SECRET",
      );
    });

    it("should return null if secretKey configured but not found in secrets manager", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue(null);

      const model = {
        id: "test-id",
        name: "test",
        displayName: "Test",
        provider: "openai",
        modelId: "gpt-4o",
        apiEndpoint: "",
        apiKey: "fallback-key",
        secretKey: "MISSING_SECRET",
        maxTokens: 4000,
        temperature: 0.7,
        isEnabled: true,
        isDefault: false,
      } as any;

      const key = await service.getApiKeyForModel(model);
      expect(key).toBeNull();
    });

    it("should return null when no key available", async () => {
      const model = {
        id: "test-id",
        name: "test",
        displayName: "Test",
        provider: "openai",
        modelId: "gpt-4o",
        apiEndpoint: "",
        apiKey: null,
        secretKey: null,
        maxTokens: 4000,
        temperature: 0.7,
        isEnabled: true,
        isDefault: false,
      } as any;

      const key = await service.getApiKeyForModel(model);
      expect(key).toBeNull();
    });
  });

  // ==================== inferApiFormat ====================

  describe("inferApiFormat", () => {
    it("should return anthropic for anthropic provider", () => {
      expect(service.inferApiFormat("anthropic")).toBe("anthropic");
    });

    it("should return anthropic for claude provider", () => {
      expect(service.inferApiFormat("claude")).toBe("anthropic");
    });

    it("should return google for google provider", () => {
      expect(service.inferApiFormat("google")).toBe("google");
    });

    it("should return google for gemini provider", () => {
      expect(service.inferApiFormat("gemini")).toBe("google");
    });

    it("should return xai for xai provider", () => {
      expect(service.inferApiFormat("xai")).toBe("xai");
    });

    it("should return xai for grok provider", () => {
      expect(service.inferApiFormat("grok")).toBe("xai");
    });

    it("should return cohere for cohere provider", () => {
      expect(service.inferApiFormat("cohere")).toBe("cohere");
    });

    it("should return openai for unknown provider", () => {
      expect(service.inferApiFormat("deepseek")).toBe("openai");
    });

    it("should be case-insensitive", () => {
      expect(service.inferApiFormat("ANTHROPIC")).toBe("anthropic");
      expect(service.inferApiFormat("Google")).toBe("google");
    });
  });

  // ==================== isReasoningModel ====================

  describe("isReasoningModel", () => {
    it("should return true for o1 models", () => {
      expect(service.isReasoningModel("o1-mini")).toBe(true);
      expect(service.isReasoningModel("o1-preview")).toBe(true);
    });

    it("should return true for o3 models", () => {
      expect(service.isReasoningModel("o3-mini")).toBe(true);
    });

    it("should return true for gpt-5 models", () => {
      expect(service.isReasoningModel("gpt-5")).toBe(true);
    });

    it("should return true for deepseek-r1", () => {
      expect(service.isReasoningModel("deepseek-r1")).toBe(true);
    });

    it("should return true for models with 'thinking'", () => {
      expect(service.isReasoningModel("gemini-2.0-flash-thinking")).toBe(true);
    });

    it("should return true for gemini-2.5", () => {
      expect(service.isReasoningModel("gemini-2.5-pro")).toBe(true);
    });

    it("should return false for gpt-4o", () => {
      expect(service.isReasoningModel("gpt-4o")).toBe(false);
    });

    it("should return false for gemini-2.0-flash", () => {
      expect(service.isReasoningModel("gemini-2.0-flash")).toBe(false);
    });

    it("should return false for claude-3-5-sonnet", () => {
      expect(service.isReasoningModel("claude-3-5-sonnet-20241022")).toBe(
        false,
      );
    });
  });

  // ==================== isTemperatureSupported ====================

  describe("isTemperatureSupported", () => {
    it("should return false for o1 models", () => {
      expect(service.isTemperatureSupported("o1-mini")).toBe(false);
    });

    it("should return false for o3 models", () => {
      expect(service.isTemperatureSupported("o3-mini")).toBe(false);
    });

    it("should return false for gpt-5 models", () => {
      expect(service.isTemperatureSupported("gpt-5")).toBe(false);
    });

    it("should return true for gpt-4o", () => {
      expect(service.isTemperatureSupported("gpt-4o")).toBe(true);
    });

    it("should return true for claude models", () => {
      expect(service.isTemperatureSupported("claude-3-5-sonnet-20241022")).toBe(
        true,
      );
    });

    it("should return true for gemini models", () => {
      expect(service.isTemperatureSupported("gemini-2.0-flash")).toBe(true);
    });
  });

  // getTimeoutForModel 已迁移到单源 AiModelConfigService.getTimeoutForModel
  // （见 ai-model-config.service.spec.ts:630）；本 service 不再保留重复实现。

  // ==================== refreshModelConfigCache ====================

  describe("refreshModelConfigCache", () => {
    it("should load models from database", async () => {
      const mockModel = createMockDbModel();
      mockPrisma.aIModel.findMany.mockResolvedValue([mockModel]);

      await service.refreshModelConfigCache();

      // Should now be in cache
      const config = await service.getModelConfig("gpt-4o");
      expect(config).toBeDefined();
      expect(config!.modelId).toBe("gpt-4o");
    });

    it("should handle database errors gracefully", async () => {
      mockPrisma.aIModel.findMany.mockRejectedValue(
        new Error("DB connection failed"),
      );

      // Should not throw
      await expect(service.refreshModelConfigCache()).resolves.not.toThrow();
    });

    it("should index by both modelId and name", async () => {
      const mockModel = createMockDbModel({
        name: "my-model",
        modelId: "gpt-4o-my",
      });
      mockPrisma.aIModel.findMany.mockResolvedValue([mockModel]);

      await service.refreshModelConfigCache();

      // Should find by modelId
      const byModelId = await service.getModelConfig("gpt-4o-my");
      expect(byModelId).toBeDefined();
    });
  });

  // ==================== getModelConfig ====================

  describe("getModelConfig", () => {
    it("should return null for unknown model", async () => {
      mockPrisma.aIModel.findFirst.mockResolvedValue(null);
      const config = await service.getModelConfig("unknown-model");
      expect(config).toBeNull();
    });

    it("should normalize #N suffix from modelId", async () => {
      const mockModel = createMockDbModel({ modelId: "gpt-4o" });
      mockPrisma.aIModel.findMany.mockResolvedValue([mockModel]);
      await service.refreshModelConfigCache();

      // Should strip #1 suffix and find the model
      const config = await service.getModelConfig("gpt-4o#1");
      expect(config).toBeDefined();
    });

    it("should do case-insensitive lookup", async () => {
      const mockModel = createMockDbModel({ modelId: "gpt-4o" });
      mockPrisma.aIModel.findMany.mockResolvedValue([mockModel]);
      await service.refreshModelConfigCache();

      const config = await service.getModelConfig("GPT-4O");
      expect(config).toBeDefined();
    });

    it("should query database when not in cache", async () => {
      const mockModel = createMockDbModel({ modelId: "gemini-pro" });
      mockPrisma.aIModel.findFirst.mockResolvedValue(mockModel);

      const config = await service.getModelConfig("gemini-pro");
      expect(config).toBeDefined();
      expect(config!.modelId).toBe("gemini-pro");
    });

    it("should handle database query failure gracefully", async () => {
      mockPrisma.aIModel.findFirst.mockRejectedValue(new Error("DB error"));

      const config = await service.getModelConfig("unknown-model");
      expect(config).toBeNull();
    });

    it("should infer isReasoning from modelId when not set in DB", async () => {
      const mockModel = createMockDbModel({
        modelId: "o1-mini",
        isReasoning: undefined,
      });
      mockPrisma.aIModel.findMany.mockResolvedValue([mockModel]);
      await service.refreshModelConfigCache();

      const config = await service.getModelConfig("o1-mini");
      expect(config!.isReasoning).toBe(true);
    });

    it("should build config with price values as numbers", async () => {
      const mockModel = createMockDbModel({
        priceInputPerMillion: "5.00",
        priceOutputPerMillion: "15.00",
      });
      mockPrisma.aIModel.findMany.mockResolvedValue([mockModel]);
      await service.refreshModelConfigCache();

      const config = await service.getModelConfig("gpt-4o");
      expect(config!.priceInputPerMillion).toBe(5);
      expect(config!.priceOutputPerMillion).toBe(15);
    });
  });

  // ==================== getDefaultModelConfig ====================

  describe("getDefaultModelConfig", () => {
    it("should return default model (DB-driven via canonical service)", async () => {
      // v3.1 A0：canonical AiModelConfigService.getDefaultModelConfig 直接走
      // findFirst({ where: isDefault: true })，不读 modelConfigCache。Mock 须
      // 同时提供 findFirst 数据（旧 wrapper 走 cache 短路；现在统一走 DB）。
      const mockModel = createMockDbModel({ isDefault: true });
      mockPrisma.aIModel.findMany.mockResolvedValue([mockModel]);
      mockPrisma.aIModel.findFirst.mockResolvedValue(mockModel);
      await service.refreshModelConfigCache();

      const config = await service.getDefaultModelConfig();
      expect(config).toBeDefined();
      expect(config!.isDefault).toBe(true);
    });

    it("should query DB when cache empty", async () => {
      const mockModel = createMockDbModel({ isDefault: true });
      mockPrisma.aIModel.findFirst.mockResolvedValue(mockModel);

      const config = await service.getDefaultModelConfig();
      expect(config).toBeDefined();
    });

    it("should return first enabled model if no default", async () => {
      mockPrisma.aIModel.findFirst
        .mockResolvedValueOnce(null) // no default
        .mockResolvedValueOnce(createMockDbModel()); // any enabled

      const config = await service.getDefaultModelConfig();
      expect(config).toBeDefined();
    });

    it("should return null if no models configured", async () => {
      mockPrisma.aIModel.findFirst.mockResolvedValue(null);

      const config = await service.getDefaultModelConfig();
      expect(config).toBeNull();
    });
  });

  // ==================== getDefaultModelByType ====================

  describe("getDefaultModelByType", () => {
    it("should return default model of specified type", async () => {
      const mockModel = createMockDbModel({
        isDefault: true,
        modelType: "EMBEDDING",
      });
      mockPrisma.aIModel.findFirst.mockResolvedValue(mockModel);

      const config = await service.getDefaultModelByType(AIModelType.EMBEDDING);
      expect(config).toBeDefined();
    });

    it("should return first model of type when no default", async () => {
      mockPrisma.aIModel.findFirst
        .mockResolvedValueOnce(null) // no default embedding
        .mockResolvedValueOnce(createMockDbModel()); // first embedding

      const config = await service.getDefaultModelByType(AIModelType.EMBEDDING);
      expect(config).toBeDefined();
    });

    it("should return null when no models of type", async () => {
      mockPrisma.aIModel.findFirst.mockResolvedValue(null);

      const config = await service.getDefaultModelByType(
        AIModelType.IMAGE_GENERATION,
      );
      expect(config).toBeNull();
    });
  });

  // ==================== getAllEnabledModelsByType ====================

  describe("getAllEnabledModelsByType", () => {
    // 2026-05-25 严格 BYOK 收口（「BYOK 不要到 admin，除非授权」）：
    //   无 userId 上下文 → 返回 []，**绝不**回退 admin AIModel，也不查 admin 表。
    it("returns [] with no userId — strict BYOK, NO admin fallback", async () => {
      const models = [
        createMockDbModel(),
        createMockDbModel({ modelId: "gpt-4o-mini" }),
      ];
      mockPrisma.aIModel.findMany.mockResolvedValue(models);

      const configs = await service.getAllEnabledModelsByType(AIModelType.CHAT);
      expect(configs).toHaveLength(0);
      // must NOT query the admin AIModel pool for a no-userId call
      const queriedAdminPool = mockPrisma.aIModel.findMany.mock.calls.some(
        (call: any[]) => call[0]?.where?.modelType === AIModelType.CHAT,
      );
      expect(queriedAdminPool).toBe(false);
    });

    it("returns [] for no userId even with excludeModelIds (no admin fallback)", async () => {
      const configs = await service.getAllEnabledModelsByType(
        AIModelType.CHAT,
        ["gpt-4o"],
      );
      expect(configs).toHaveLength(0);
      const queriedWithExclude = mockPrisma.aIModel.findMany.mock.calls.some(
        (call: any[]) => call[0]?.where?.modelId?.notIn !== undefined,
      );
      expect(queriedWithExclude).toBe(false);
    });
  });
});
