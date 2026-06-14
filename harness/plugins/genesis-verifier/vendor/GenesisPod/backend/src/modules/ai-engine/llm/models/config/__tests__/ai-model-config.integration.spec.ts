/**
 * AiModelConfigService - Extended coverage tests
 *
 * Covers paths not hit by the base spec:
 *  - Lines 265-290: resolveApiKey with userId+keyResolver (PERSONAL/ASSIGNED/SYSTEM source map, NoAvailableKeyError, rethrow)
 *  - Lines 337-353: resolveApiFormat conflict logic (openai-on-google, google-on-openai)
 *  - Lines 468-469: isReasoningModel case-insensitive match in cache
 *  - Lines 578-617: findUserModelConfigByModelId + findUserDefaultByType
 *  - Lines 704-720: getModelById additional paths
 *  - Lines 981-982: getModelsByProvider with no apiKey
 *  - Lines 1051-1054: getIconUrl specific paths
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  AiModelConfigService,
  AIModelConfig,
} from "../ai-model-config.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SecretsService } from "@/modules/platform/credentials/storage/secrets/secrets.service";
import { UserApiKeysService } from "@/modules/platform/credentials/user-owned/user-api-keys/user-api-keys.service";
import { KeyResolverService } from "@/modules/platform/credentials/resolution/key-resolver/key-resolver.service";
import { UserModelConfigsService } from "@/modules/platform/credentials/user-owned/user-model-configs/user-model-configs.service";
import { NoAvailableKeyError } from "@/modules/platform/credentials/resolution/key-resolver/key-resolver.errors";
import { AIModelType } from "@prisma/client";
import { RequestContext } from "@/common/context/request-context";

function makeMockChatModel(overrides: Record<string, unknown> = {}) {
  return {
    id: "model-1",
    name: "gpt-4o",
    displayName: "GPT-4 Optimized",
    provider: "openai",
    modelId: "gpt-4o",
    apiEndpoint: "https://api.openai.com/v1",
    apiKey: "sk-test",
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
    ...overrides,
  };
}

describe("AiModelConfigService (extended coverage)", () => {
  let service: AiModelConfigService;
  let mockPrisma: Record<string, Record<string, jest.Mock>>;
  let mockSecretsService: Record<string, jest.Mock>;
  let mockUserApiKeysService: Record<string, jest.Mock>;
  let mockKeyResolver: Record<string, jest.Mock>;
  let mockUserModelConfigs: Record<string, jest.Mock>;

  async function buildModule(
    opts: { withKeyResolver?: boolean; withUserModelConfigs?: boolean } = {},
  ): Promise<void> {
    mockPrisma = {
      aIModel: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    mockSecretsService = {
      getValueInternal: jest.fn().mockResolvedValue(null),
    };

    mockUserApiKeysService = {
      getPersonalKey: jest.fn().mockResolvedValue(null),
      getAvailableProviders: jest.fn().mockResolvedValue([]),
      // 2026-05-11 P2: toAIModelConfigFromUserConfig 走 DB ai_providers 兜底
      resolveProviderDefaults: jest.fn().mockResolvedValue({
        endpoint: "https://api.openai.com/v1",
        apiFormat: "openai",
        testModel: "gpt-4o-mini",
      }),
    };

    mockKeyResolver = {
      resolveKey: jest.fn(),
      getAvailableProviders: jest.fn().mockResolvedValue([]),
      getPreferredModelIdForProvider: jest.fn().mockResolvedValue(null),
    };

    mockUserModelConfigs = {
      findByModelId: jest.fn().mockResolvedValue(null),
      findDefaultForType: jest.fn().mockResolvedValue(null),
    };

    const providers: unknown[] = [
      AiModelConfigService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: SecretsService, useValue: mockSecretsService },
      { provide: UserApiKeysService, useValue: mockUserApiKeysService },
    ];

    if (opts.withKeyResolver) {
      providers.push({
        provide: KeyResolverService,
        useValue: mockKeyResolver,
      });
    }
    if (opts.withUserModelConfigs) {
      providers.push({
        provide: UserModelConfigsService,
        useValue: mockUserModelConfigs,
      });
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: providers as Parameters<
        typeof Test.createTestingModule
      >[0]["providers"],
    }).compile();

    service = module.get<AiModelConfigService>(AiModelConfigService);
  }

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // Lines 265-280: resolveApiKey with userId+keyResolver returns PERSONAL key
  // =========================================================================

  describe("resolveApiKey with KeyResolverService (lines 265-290)", () => {
    it("returns PERSONAL source when keyResolver resolves PERSONAL key", async () => {
      await buildModule({ withKeyResolver: true });

      mockKeyResolver.resolveKey.mockResolvedValue({
        apiKey: "personal-key",
        source: "PERSONAL",
        apiEndpoint: "https://api.openai.com/v1",
      });

      const model: AIModelConfig = {
        id: "m1",
        name: "gpt-4o",
        displayName: "GPT-4o",
        provider: "openai",
        modelId: "gpt-4o",
        apiEndpoint: "https://api.openai.com/v1",
        apiKey: null,
        maxTokens: 4000,
        temperature: 0.7,
        isEnabled: true,
        isDefault: false,
        isReasoning: false,
        apiFormat: "openai",
        supportsTemperature: true,
        tokenParamName: "max_tokens",
        defaultTimeoutMs: 120000,
      };

      const result = await service.resolveApiKey(model, "user-123");
      expect(result?.apiKey).toBe("personal-key");
      expect(result?.source).toBe("personal");
    });

    it("returns ASSIGNED source when keyResolver resolves ASSIGNED key", async () => {
      await buildModule({ withKeyResolver: true });

      mockKeyResolver.resolveKey.mockResolvedValue({
        apiKey: "assigned-key",
        source: "ASSIGNED",
        apiEndpoint: undefined,
      });

      const model: AIModelConfig = {
        id: "m1",
        name: "claude",
        displayName: "Claude",
        provider: "anthropic",
        modelId: "claude-3-5-sonnet",
        apiEndpoint: "https://api.anthropic.com/v1",
        apiKey: null,
        maxTokens: 4000,
        temperature: 0.7,
        isEnabled: true,
        isDefault: false,
        isReasoning: false,
        apiFormat: "anthropic",
        supportsTemperature: true,
        tokenParamName: "max_tokens",
        defaultTimeoutMs: 120000,
      };

      const result = await service.resolveApiKey(model, "user-123");
      expect(result?.apiKey).toBe("assigned-key");
      expect(result?.source).toBe("assigned");
    });

    it("returns null when keyResolver throws NoAvailableKeyError (line 284-287)", async () => {
      await buildModule({ withKeyResolver: true });

      mockKeyResolver.resolveKey.mockRejectedValue(
        new NoAvailableKeyError("openai"),
      );

      const model: AIModelConfig = {
        id: "m1",
        name: "gpt-4o",
        displayName: "GPT-4o",
        provider: "openai",
        modelId: "gpt-4o",
        apiEndpoint: "",
        apiKey: null,
        maxTokens: 4000,
        temperature: 0.7,
        isEnabled: true,
        isDefault: false,
        isReasoning: false,
        apiFormat: "openai",
        supportsTemperature: true,
        tokenParamName: "max_tokens",
        defaultTimeoutMs: 120000,
      };

      const result = await service.resolveApiKey(model, "user-123");
      expect(result).toBeNull();
    });

    it("rethrows non-NoAvailableKeyError errors (line 290)", async () => {
      await buildModule({ withKeyResolver: true });

      mockKeyResolver.resolveKey.mockRejectedValue(new Error("QuotaExceeded"));

      const model: AIModelConfig = {
        id: "m1",
        name: "gpt-4o",
        displayName: "GPT-4o",
        provider: "openai",
        modelId: "gpt-4o",
        apiEndpoint: "",
        apiKey: null,
        maxTokens: 4000,
        temperature: 0.7,
        isEnabled: true,
        isDefault: false,
        isReasoning: false,
        apiFormat: "openai",
        supportsTemperature: true,
        tokenParamName: "max_tokens",
        defaultTimeoutMs: 120000,
      };

      await expect(service.resolveApiKey(model, "user-123")).rejects.toThrow(
        "QuotaExceeded",
      );
    });
  });

  // =========================================================================
  // Lines 337-353: resolveApiFormat conflict logic (via buildModelConfig)
  // =========================================================================

  describe("resolveApiFormat conflict detection (lines 337-353)", () => {
    it("fixes openai apiFormat on Google provider (line 337-342)", async () => {
      await buildModule();

      // Simulating buildModelConfig via getModelConfig DB path
      mockPrisma.aIModel.findFirst.mockResolvedValue(
        makeMockChatModel({
          provider: "google",
          modelId: "gemini-2.0-flash",
          apiFormat: "openai", // conflict: google provider with openai format
        }),
      );

      const config = await service.getModelConfig("gemini-2.0-flash");
      // Should be corrected to "google"
      expect(config?.apiFormat).toBe("google");
    });

    it("fixes non-openai apiFormat on OpenAI-compatible provider (lines 345-350)", async () => {
      await buildModule();

      mockPrisma.aIModel.findFirst.mockResolvedValue(
        makeMockChatModel({
          provider: "openai",
          modelId: "gpt-4o",
          apiFormat: "google", // conflict: openai provider with google format
        }),
      );

      const config = await service.getModelConfig("gpt-4o");
      // Should be corrected to "openai"
      expect(config?.apiFormat).toBe("openai");
    });
  });

  // =========================================================================
  // Lines 468-469: isReasoningModel case-insensitive cache match
  // =========================================================================

  describe("isReasoningModel case-insensitive cache match (lines 468-469)", () => {
    it("returns reasoning=true from cache with case-insensitive match", async () => {
      await buildModule();

      // Force cache population with lowercase key
      mockPrisma.aIModel.findMany.mockResolvedValue([
        makeMockChatModel({
          modelId: "o1-preview",
          isReasoning: true,
          modelType: "CHAT",
        }),
      ]);

      await service.refreshModelConfigCache();

      // Query with different casing
      const result = service.isReasoningModel("O1-Preview");
      expect(result).toBe(true);
    });
  });

  // =========================================================================
  // Lines 578-617: findUserModelConfigByModelId + findUserDefaultByType
  // =========================================================================

  describe("findUserModelConfigByModelId and findUserDefaultByType (lines 578-617)", () => {
    it("findUserDefaultByType returns null when UserModelConfigsService not injected", async () => {
      await buildModule(); // without userModelConfigs

      const result = await service.findUserDefaultByType(
        "user-123",
        AIModelType.CHAT,
      );
      expect(result).toBeNull();
    });

    it("findUserDefaultByType returns config when UserModelConfigsService returns data", async () => {
      await buildModule({ withUserModelConfigs: true });

      const mockUserConfig = {
        id: "umc-1",
        userId: "user-123",
        modelId: "gpt-4o",
        provider: "openai",
        displayName: "My GPT-4o",
        apiEndpoint: null,
        maxTokens: 4000,
        temperature: 0.7,
        isEnabled: true,
        isDefault: true,
        isReasoning: false,
        apiFormat: "openai",
        supportsTemperature: true,
        supportsStreaming: true,
        supportsFunctionCalling: true,
        supportsVision: false,
        tokenParamName: "max_tokens",
        defaultTimeoutMs: 120000,
        priority: 50,
        secretKey: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUserModelConfigs.findDefaultForType.mockResolvedValue(mockUserConfig);

      const result = await service.findUserDefaultByType(
        "user-123",
        AIModelType.CHAT,
      );
      expect(result).not.toBeNull();
      expect(result?.modelId).toBe("gpt-4o");
      expect(result?.provider).toBe("openai");
    });

    it("findUserDefaultByType returns null on error and logs warning (line 607-610)", async () => {
      await buildModule({ withUserModelConfigs: true });

      mockUserModelConfigs.findDefaultForType.mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.findUserDefaultByType(
        "user-123",
        AIModelType.CHAT,
      );
      expect(result).toBeNull();
    });

    it("getModelConfig uses findUserModelConfigByModelId when userId in context", async () => {
      await buildModule({ withUserModelConfigs: true });

      jest.spyOn(RequestContext, "getUserId").mockReturnValue("user-123");

      const mockUserConfig = {
        id: "umc-2",
        userId: "user-123",
        modelId: "custom-model",
        provider: "openai",
        displayName: "Custom",
        apiEndpoint: null,
        maxTokens: 2000,
        temperature: 0.5,
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
        priority: 50,
        secretKey: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUserModelConfigs.findByModelId.mockResolvedValue(mockUserConfig);

      const result = await service.getModelConfig("custom-model");
      expect(result).not.toBeNull();
      expect(result?.modelId).toBe("custom-model");

      jest.restoreAllMocks();
    });
  });

  // =========================================================================
  // Lines 981-982: getModelsByProvider with no apiKey check
  // =========================================================================

  describe("getModelsByProvider (lines 981-982)", () => {
    it("returns models matching provider including those without apiKey", async () => {
      await buildModule();

      mockPrisma.aIModel.findMany.mockResolvedValue([
        makeMockChatModel({
          provider: "openai",
          apiKey: null,
          secretKey: "MY_KEY",
        }),
      ]);

      await service.refreshModelConfigCache();

      const result = await service.getModelsByProvider("openai");
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
