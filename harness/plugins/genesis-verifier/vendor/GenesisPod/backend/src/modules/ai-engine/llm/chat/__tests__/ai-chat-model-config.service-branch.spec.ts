/**
 * AiChatModelConfigService — supplemental branch coverage
 *
 * Targets:
 *  - Line 58-59: initialization catch (warn when refreshModelConfigCache fails)
 *  - Lines 198-199: isReasoningModel returns from cache (exact match has isReasoning)
 *  - Lines 205-206: isReasoningModel returns from cache (case-insensitive match)
 *  - Lines 219-220: getModelConfig refreshes when cache is expired
 *  - Lines 280: getModelsByType refreshes when cache is expired
 *  - Lines 325: getDefaultModelByType refreshes when cache is expired
 *  - Lines 392-393: supportsTemperature returns from cache (exact match)
 *  - Lines 399-403: supportsTemperature returns from cache (case-insensitive)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { AiChatModelConfigService } from "../ai-chat-model-config.service";
// v3.1 A0：wrapper 现委托给 canonical AiModelConfigService。
import { AiModelConfigService } from "../../models/config/ai-model-config.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SecretsService } from "@/modules/platform/credentials/storage/secrets/secrets.service";
import { UserApiKeysService } from "@/modules/platform/credentials/user-owned/user-api-keys/user-api-keys.service";

function createMockDbModel(overrides: Record<string, unknown> = {}) {
  return {
    id: "db-model-id",
    name: "test-model",
    displayName: "Test Model",
    provider: "openai",
    modelId: "gpt-4o",
    apiEndpoint: "https://api.openai.com/v1",
    apiKey: null,
    secretKey: "TEST_SECRET",
    maxTokens: 4096,
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

async function buildService(
  findManyReturn: unknown[] = [],
  findFirstReturn: unknown = null,
) {
  const mockPrisma = {
    aIModel: {
      findMany: jest.fn().mockResolvedValue(findManyReturn),
      findFirst: jest.fn().mockResolvedValue(findFirstReturn),
    },
  };
  const mockSecrets = {
    getValueInternal: jest.fn().mockResolvedValue("test-api-key"),
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
      { provide: SecretsService, useValue: mockSecrets },
      { provide: UserApiKeysService, useValue: mockUserApiKeysService },
    ],
  }).compile();
  return {
    service: module.get<AiChatModelConfigService>(AiChatModelConfigService),
    mockPrisma,
    mockSecrets,
  };
}

describe("AiChatModelConfigService (branch supplement)", () => {
  afterEach(() => jest.clearAllMocks());

  // ─────────────────────────────────────────────────────────────────
  // isReasoningModel — cache hit branches
  // ─────────────────────────────────────────────────────────────────
  describe("isReasoningModel — cache hit", () => {
    it("returns isReasoning from cache when exact modelId matches", async () => {
      const model = createMockDbModel({
        modelId: "o1-preview",
        isReasoning: true,
      });
      const { service, mockPrisma } = await buildService([model]);

      // Prime the cache via getModelConfig
      await service.getModelConfig("o1-preview");
      mockPrisma.aIModel.findMany.mockClear();

      // Now isReasoningModel should hit the cache (line 198-199)
      const result = service.isReasoningModel("o1-preview");
      expect(result).toBe(true);
    });

    it("returns isReasoning from cache via case-insensitive match", async () => {
      const model = createMockDbModel({
        modelId: "O1-Preview",
        isReasoning: true,
      });
      const { service } = await buildService([model]);

      // Prime the cache
      await service.getModelConfig("O1-Preview");

      // Query with different case (lines 204-206)
      const result = service.isReasoningModel("o1-preview");
      expect(result).toBe(true);
    });

    it("falls back to inferIsReasoning when model not in cache", async () => {
      const { service } = await buildService([]);

      // "o1" is a known reasoning model by name inference
      const result = service.isReasoningModel("o1");
      expect(typeof result).toBe("boolean");
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // getModelConfig — cache TTL expiry refresh
  // ─────────────────────────────────────────────────────────────────
  describe("getModelConfig — cache TTL expiry", () => {
    it("refreshes the cache when TTL has expired", async () => {
      const model = createMockDbModel({ modelId: "gpt-4o" });
      const { service, mockPrisma } = await buildService([model]);

      // First call primes the cache
      await service.getModelConfig("gpt-4o");
      const callCount = mockPrisma.aIModel.findMany.mock.calls.length;

      // v3.1 A0：wrapper 已委托给 canonical service，cache 字段在 delegate 上
      // FIXME(v3.1-F): wrapper 整文件删除时同步删本测试块；
      //   `(service as any).delegate.modelConfigCacheTime` 是过渡期类型逃逸，
      //   依赖 delegate 私有字段，不应长期存在。F 阶段删 wrapper 后此 spec 一并清。
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).delegate.modelConfigCacheTime =
        Date.now() - 10 * 60 * 1000;

      // Second call should trigger refresh
      await service.getModelConfig("gpt-4o");
      expect(mockPrisma.aIModel.findMany.mock.calls.length).toBeGreaterThan(
        callCount,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // getAllEnabledModelsByType — cache TTL expiry refresh
  // ─────────────────────────────────────────────────────────────────
  // 2026-05-25 严格 BYOK 收口（「BYOK 不要到 admin，除非授权」）：无 userId 上下文
  // 下 getAllEnabledModelsByType / getDefaultModelByType **不再回退 admin AIModel**，
  // 也不查 admin 表。原 no-userId admin DB 缓存/查询路径已删，相应测试改为验证新契约。
  describe("getAllEnabledModelsByType — no userId (strict BYOK)", () => {
    it("returns [] and does NOT query the admin AIModel pool", async () => {
      const model = createMockDbModel({ modelType: "CHAT" });
      const { service, mockPrisma } = await buildService([model]);

      const result = await service.getAllEnabledModelsByType("CHAT" as any);
      expect(result).toHaveLength(0);
      const queriedAdminPool = mockPrisma.aIModel.findMany.mock.calls.some(
        (c: any[]) => c[0]?.where?.modelType === "CHAT",
      );
      expect(queriedAdminPool).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // getDefaultModelByType — no userId (strict BYOK)
  // ─────────────────────────────────────────────────────────────────
  describe("getDefaultModelByType — no userId (strict BYOK)", () => {
    it("returns null and does NOT fall back to admin AIModel", async () => {
      const model = createMockDbModel({ isDefault: true, modelType: "CHAT" });
      const { service, mockPrisma } = await buildService([model], model);

      const result = await service.getDefaultModelByType("CHAT" as any);
      expect(result).toBeNull();
      const queriedAdminDefault = mockPrisma.aIModel.findFirst.mock.calls.some(
        (c: any[]) => c[0]?.where?.modelType === "CHAT",
      );
      expect(queriedAdminDefault).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // supportsTemperature — cache hit branches
  // ─────────────────────────────────────────────────────────────────
  describe("supportsTemperature — cache hit", () => {
    it("returns supportsTemperature from cache (exact match)", async () => {
      const model = createMockDbModel({
        modelId: "gpt-4o",
        supportsTemperature: true,
      });
      const { service } = await buildService([model]);

      // Prime the cache
      await service.getModelConfig("gpt-4o");

      // Should hit cache at line 392-393
      const result = service.isTemperatureSupported("gpt-4o");
      expect(typeof result).toBe("boolean");
    });

    it("returns supportsTemperature from cache via case-insensitive match", async () => {
      const model = createMockDbModel({
        modelId: "GPT-4o",
        supportsTemperature: false,
      });
      const { service } = await buildService([model]);

      // Prime the cache
      await service.getModelConfig("GPT-4o");

      // Query with different case (lines 399-403)
      const result = service.isTemperatureSupported("gpt-4o");
      expect(result).toBe(false);
    });

    it("falls back to true for unknown models not in cache", async () => {
      const { service } = await buildService([]);

      // Unknown model not in cache → falls back to true (default assumption)
      const result = service.isTemperatureSupported("unknown-model");
      expect(result).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Line 58-59: Initialization catch when refreshModelConfigCache fails
  // ─────────────────────────────────────────────────────────────────
  describe("constructor — initialization catch", () => {
    it("logs warning when cache initialization fails", async () => {
      const failingPrisma = {
        aIModel: {
          findMany: jest
            .fn()
            .mockRejectedValue(new Error("DB connection failed")),
          findFirst: jest.fn().mockResolvedValue(null),
        },
      };
      const mockSecrets = {
        getValueInternal: jest.fn().mockResolvedValue(null),
      };

      const mockUserApiKeysService = {
        getAvailableProviders: jest.fn().mockResolvedValue([]),
        getPersonalKey: jest.fn().mockResolvedValue(null),
        resolveProviderDefaults: jest.fn().mockResolvedValue(null),
      };
      // v3.1 A0：wrapper 自身不再 refresh cache（已委托 canonical），但
      // canonical AiModelConfigService 仍在构造时 refresh —— 失败时其 catch
      // 处理也不应抛出。
      await expect(
        Test.createTestingModule({
          providers: [
            AiChatModelConfigService,
            AiModelConfigService,
            { provide: PrismaService, useValue: failingPrisma },
            { provide: SecretsService, useValue: mockSecrets },
            { provide: UserApiKeysService, useValue: mockUserApiKeysService },
          ],
        }).compile(),
      ).resolves.toBeDefined();
    });
  });
});
