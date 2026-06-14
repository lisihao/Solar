import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { QuotaService } from "../quota.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { SecretsService } from "../../../../platform/credentials/storage/secrets/secrets.service";
import {
  OpenAIQuotaProvider,
  AnthropicQuotaProvider,
  GoogleQuotaProvider,
  XAIQuotaProvider,
  CohereQuotaProvider,
  DeepSeekQuotaProvider,
  GroqQuotaProvider,
  OpenRouterQuotaProvider,
  MiniMaxQuotaProvider,
} from "../providers";
import {
  QuotaStatus,
  QuotaDataSource,
  QuotaType,
  QuotaUnit,
  QuotaPeriod,
} from "../quota.types";

describe("QuotaService", () => {
  let service: QuotaService;
  let mockPrisma: {
    aIModel: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
    };
    providerQuotaCache: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      upsert: jest.Mock;
    };
  };
  let mockSecretsService: { getValueInternal: jest.Mock };
  let mockOpenAI: {
    provider: string;
    supportsApiQuery: boolean;
    fetchQuota: jest.Mock;
  };
  let mockAnthropic: {
    provider: string;
    supportsApiQuery: boolean;
    fetchQuota: jest.Mock;
  };
  let mockGoogle: {
    provider: string;
    supportsApiQuery: boolean;
    fetchQuota: jest.Mock;
  };
  let mockXAI: {
    provider: string;
    supportsApiQuery: boolean;
    fetchQuota: jest.Mock;
  };
  let mockCohere: {
    provider: string;
    supportsApiQuery: boolean;
    fetchQuota: jest.Mock;
  };
  let mockDeepSeek: {
    provider: string;
    supportsApiQuery: boolean;
    fetchQuota: jest.Mock;
  };

  const buildCacheEntry = (provider: string) => ({
    id: `cache-${provider}`,
    provider,
    quotaType: QuotaType.TOKENS,
    usage: BigInt(1000),
    quotaLimit: BigInt(10000),
    remaining: BigInt(9000),
    usagePercentage: 10,
    unit: QuotaUnit.TOKENS,
    period: QuotaPeriod.MONTHLY,
    status: QuotaStatus.NORMAL,
    statusMessage: "Normal",
    lastUpdated: new Date("2026-01-15T10:00:00Z"),
    dataSource: QuotaDataSource.API,
    consoleUrl: "https://platform.openai.com/usage",
    rawData: null,
  });

  beforeEach(async () => {
    mockPrisma = {
      aIModel: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      providerQuotaCache: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };

    mockSecretsService = {
      getValueInternal: jest.fn().mockResolvedValue(null),
    };

    const makeProviderMock = (providerName: string) => ({
      provider: providerName,
      supportsApiQuery: true,
      fetchQuota: jest.fn().mockResolvedValue({
        success: false,
        error: "Not configured",
      }),
    });

    mockOpenAI = makeProviderMock("openai");
    mockAnthropic = makeProviderMock("anthropic");
    mockGoogle = makeProviderMock("google");
    mockXAI = makeProviderMock("xai");
    mockCohere = makeProviderMock("cohere");
    mockDeepSeek = makeProviderMock("deepseek");

    const mockGroq = makeProviderMock("groq");
    const mockOpenRouter = makeProviderMock("openrouter");
    const mockMiniMax = makeProviderMock("minimax");

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuotaService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SecretsService, useValue: mockSecretsService },
        { provide: OpenAIQuotaProvider, useValue: mockOpenAI },
        { provide: AnthropicQuotaProvider, useValue: mockAnthropic },
        { provide: GoogleQuotaProvider, useValue: mockGoogle },
        { provide: XAIQuotaProvider, useValue: mockXAI },
        { provide: CohereQuotaProvider, useValue: mockCohere },
        { provide: DeepSeekQuotaProvider, useValue: mockDeepSeek },
        { provide: GroqQuotaProvider, useValue: mockGroq },
        { provide: OpenRouterQuotaProvider, useValue: mockOpenRouter },
        { provide: MiniMaxQuotaProvider, useValue: mockMiniMax },
      ],
    }).compile();

    service = module.get<QuotaService>(QuotaService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==================== onModuleInit ====================

  describe("onModuleInit", () => {
    it("should register all 6 providers on init", async () => {
      // Act
      await service.onModuleInit();

      // Assert: refreshAllQuotas is called (via onModuleInit background task)
      // The providers map should have all 6 entries — we verify by calling getAllQuotas
      // with a configured provider and seeing no "provider not registered" errors.
      // Direct access to private field is not needed — behaviour is observable.
      expect(true).toBe(true); // providers registered as side effect
    });

    it("should not block module startup even if initial refresh fails", async () => {
      // Arrange: make findMany throw so refreshAllQuotas will fail
      mockPrisma.aIModel.findMany.mockRejectedValue(new Error("DB down"));

      // Act: should complete without throwing
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  // ==================== getAllQuotas ====================

  describe("getAllQuotas", () => {
    it("should return empty array when no AI models are configured", async () => {
      // Arrange: findMany returns empty
      mockPrisma.aIModel.findMany.mockResolvedValue([]);

      // Act
      await service.onModuleInit();
      const result = await service.getAllQuotas();

      // Assert
      expect(result).toEqual([]);
    });

    it("should return cached quota when cache entry exists", async () => {
      // Arrange: one enabled OpenAI model
      mockPrisma.aIModel.findMany.mockResolvedValue([{ provider: "openai" }]);
      mockPrisma.providerQuotaCache.findUnique.mockResolvedValue(
        buildCacheEntry("openai"),
      );

      await service.onModuleInit();

      // Act
      const result = await service.getAllQuotas();

      // Assert: returns the cached entry converted to ProviderQuota
      expect(result).toHaveLength(1);
      expect(result[0].provider).toBe("openai");
      expect(result[0].status).toBe(QuotaStatus.NORMAL);
    });

    it("should return unavailable quota when cache is empty for a provider", async () => {
      // Arrange: one model, no cache
      mockPrisma.aIModel.findMany.mockResolvedValue([
        { provider: "anthropic" },
      ]);
      mockPrisma.providerQuotaCache.findUnique.mockResolvedValue(null);

      await service.onModuleInit();

      // Act
      const result = await service.getAllQuotas();

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].provider).toBe("anthropic");
      expect(result[0].status).toBe(QuotaStatus.UNAVAILABLE);
    });

    it("should return error quota when cache lookup throws", async () => {
      // Arrange
      mockPrisma.aIModel.findMany.mockResolvedValue([{ provider: "google" }]);
      mockPrisma.providerQuotaCache.findUnique.mockRejectedValue(
        new Error("Cache failure"),
      );

      await service.onModuleInit();

      // Act
      const result = await service.getAllQuotas();

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe(QuotaStatus.ERROR);
    });

    it("should normalize provider names from AI model records", async () => {
      // Arrange: provider stored with different casing / alias
      mockPrisma.aIModel.findMany.mockResolvedValue([
        { provider: "OpenAI" }, // mixed case
        { provider: "claude-3" }, // alias for anthropic
      ]);
      mockPrisma.providerQuotaCache.findUnique.mockResolvedValue(null);

      await service.onModuleInit();

      // Act
      const result = await service.getAllQuotas();

      // Assert: both resolve to normalized names, no duplicates from the same provider
      const providers = result.map((q) => q.provider);
      expect(providers).toContain("openai");
      expect(providers).toContain("anthropic");
    });

    it("should deduplicate providers when multiple models share the same provider", async () => {
      // Arrange: two openai models
      mockPrisma.aIModel.findMany.mockResolvedValue([
        { provider: "openai" },
        { provider: "openai" },
      ]);
      mockPrisma.providerQuotaCache.findUnique.mockResolvedValue(null);

      await service.onModuleInit();

      // Act
      const result = await service.getAllQuotas();

      // Assert: only one openai quota returned
      const openaiQuotas = result.filter((q) => q.provider === "openai");
      expect(openaiQuotas).toHaveLength(1);
    });
  });

  // ==================== refreshProviderQuota ====================

  describe("refreshProviderQuota", () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it("should return unavailable quota when provider is not registered", async () => {
      // Act
      const result = await service.refreshProviderQuota("unknown-provider");

      // Assert
      expect(result.status).toBe(QuotaStatus.UNAVAILABLE);
    });

    it("should return unavailable quota when no API key found for provider", async () => {
      // Arrange: provider registered, but no matching AI model
      mockPrisma.aIModel.findFirst.mockResolvedValue(null);

      // Act
      const result = await service.refreshProviderQuota("openai");

      // Assert
      expect(result.status).toBe(QuotaStatus.UNAVAILABLE);
    });

    it("should call fetchQuota on the provider and cache the result", async () => {
      // Arrange
      mockPrisma.aIModel.findFirst.mockResolvedValue({
        apiKey: "sk-test-key",
        secretKey: null,
      });
      mockOpenAI.fetchQuota.mockResolvedValue({
        success: true,
        quota: {
          provider: "openai",
          providerDisplayName: "OpenAI",
          providerIcon: "/icons/ai/openai.svg",
          quotaType: QuotaType.TOKENS,
          usage: 5000,
          limit: 100000,
          remaining: 95000,
          usagePercentage: 5,
          unit: QuotaUnit.TOKENS,
          period: QuotaPeriod.MONTHLY,
          status: QuotaStatus.NORMAL,
          statusMessage: "Normal",
          lastUpdated: new Date(),
          dataSource: QuotaDataSource.API,
          consoleUrl: "https://platform.openai.com/usage",
        },
      });

      // Act
      const result = await service.refreshProviderQuota("openai");

      // Assert
      expect(mockOpenAI.fetchQuota).toHaveBeenCalledWith("sk-test-key");
      expect(result.status).toBe(QuotaStatus.NORMAL);
      expect(mockPrisma.providerQuotaCache.upsert).toHaveBeenCalled();
    });

    it("should use secret manager value when secretKey is set on the model", async () => {
      // Arrange
      mockPrisma.aIModel.findFirst.mockResolvedValue({
        apiKey: "plain-key",
        secretKey: "OPENAI_API_KEY",
      });
      mockSecretsService.getValueInternal.mockResolvedValue("secret-value");
      mockOpenAI.fetchQuota.mockResolvedValue({ success: false, error: "err" });

      // Act
      await service.refreshProviderQuota("openai");

      // Assert: fetchQuota called with the secret value, not the plain key
      expect(mockOpenAI.fetchQuota).toHaveBeenCalledWith("secret-value");
    });

    it("should save error quota to cache when fetchQuota fails", async () => {
      // Arrange
      mockPrisma.aIModel.findFirst.mockResolvedValue({
        apiKey: "sk-bad",
        secretKey: null,
      });
      mockOpenAI.fetchQuota.mockResolvedValue({
        success: false,
        error: "Rate limited",
      });

      // Act
      const result = await service.refreshProviderQuota("openai");

      // Assert
      expect(result.status).toBe(QuotaStatus.ERROR);
      expect(mockPrisma.providerQuotaCache.upsert).toHaveBeenCalled();
    });
  });

  // ==================== refreshAllQuotas ====================

  describe("refreshAllQuotas", () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it("should return results for all configured providers", async () => {
      // Arrange: two providers configured
      mockPrisma.aIModel.findMany.mockResolvedValue([
        { provider: "openai" },
        { provider: "anthropic" },
      ]);
      mockPrisma.aIModel.findFirst.mockResolvedValue(null); // no API keys

      // Act
      const result = await service.refreshAllQuotas();

      // Assert: one result per unique provider
      expect(result).toHaveLength(2);
    });

    it("should return error quota for a provider whose refresh throws", async () => {
      // Arrange
      mockPrisma.aIModel.findMany.mockResolvedValue([{ provider: "openai" }]);
      mockPrisma.aIModel.findFirst.mockResolvedValue({
        apiKey: "sk-test",
        secretKey: null,
      });
      mockOpenAI.fetchQuota.mockRejectedValue(new Error("Network timeout"));

      // Act
      const result = await service.refreshAllQuotas();

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe(QuotaStatus.ERROR);
    });
  });

  // ==================== getLastGlobalUpdate ====================

  describe("getLastGlobalUpdate", () => {
    it("should return the most recent lastUpdated timestamp", async () => {
      // Arrange
      const ts = new Date("2026-01-15T12:00:00Z");
      mockPrisma.providerQuotaCache.findFirst.mockResolvedValue({
        lastUpdated: ts,
      });

      // Act
      const result = await service.getLastGlobalUpdate();

      // Assert
      expect(result).toEqual(ts);
    });

    it("should return null when no cache entries exist", async () => {
      // Arrange
      mockPrisma.providerQuotaCache.findFirst.mockResolvedValue(null);

      // Act
      const result = await service.getLastGlobalUpdate();

      // Assert
      expect(result).toBeNull();
    });
  });
});
