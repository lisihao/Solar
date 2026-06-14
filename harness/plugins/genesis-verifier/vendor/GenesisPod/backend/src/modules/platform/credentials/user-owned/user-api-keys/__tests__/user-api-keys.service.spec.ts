// Mock optional external packages that may not be installed in test environment
jest.mock("@nestjs/cache-manager", () => ({
  CacheModule: {
    registerAsync: jest.fn().mockReturnValue({ module: class {} }),
  },
  CACHE_MANAGER: "CACHE_MANAGER",
  Cache: jest.fn(),
}));
jest.mock("cache-manager-ioredis-yet", () => ({
  redisStore: jest.fn(),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UserApiKeysService } from "../user-api-keys.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { EncryptionService } from "../../../../../platform/credentials/storage/encryption/encryption.service";
import { ProviderProbeService } from "@/modules/platform/credentials/governance/key-health/provider-probe.service";
import { UserApiKeyMode } from "@prisma/client";
import { ApiKeyMode } from "@/modules/open-api/user/byok/dto/user-api-keys.dto";

const buildEncryption = (): EncryptionService =>
  new EncryptionService({
    get: (key: string) =>
      key === "SETTINGS_ENCRYPTION_KEY"
        ? "test-encryption-key-32chars-ok!"
        : key === "NODE_ENV"
          ? "test"
          : undefined,
  } as unknown as ConfigService);

describe("UserApiKeysService", () => {
  let service: UserApiKeysService;
  let mockPrisma: jest.Mocked<Partial<PrismaService>>;
  let probeMock: { probe: jest.Mock; probeByProvider: jest.Mock };

  const makeApiKey = (overrides: Record<string, unknown> = {}) => ({
    id: "key-1",
    userId: "user-1",
    provider: "openai",
    encryptedValue: "encrypted",
    iv: "abcd1234abcd1234abcd1234abcd1234",
    keyHint: "sk-t...est1",
    mode: UserApiKeyMode.PERSONAL,
    apiEndpoint: null,
    preferredModelId: null,
    isActive: true,
    lastUsedAt: null,
    testStatus: null,
    usageCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    // 2026-05-11 P2: 加 aIProvider mock，spec 覆盖 DB 真源场景
    const seedProviders = [
      {
        slug: "openai",
        name: "OpenAI",
        endpoint: "https://api.openai.com/v1",
        apiFormat: "openai",
        testModel: "gpt-4o-mini",
        capabilities: ["CHAT"],
        iconUrl: null,
        freeTierNote: null,
        docUrl: null,
        scope: "system",
      },
      {
        slug: "anthropic",
        name: "Anthropic",
        endpoint: "https://api.anthropic.com/v1",
        apiFormat: "anthropic",
        testModel: "claude-3-haiku-20240307",
        capabilities: ["CHAT"],
        iconUrl: null,
        freeTierNote: null,
        docUrl: null,
        scope: "system",
      },
    ];
    mockPrisma = {
      userApiKey: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(makeApiKey()),
        update: jest.fn().mockResolvedValue(makeApiKey()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        delete: jest.fn().mockResolvedValue(makeApiKey()),
      } as unknown as PrismaService["userApiKey"],
      aIProvider: {
        findMany: jest.fn().mockResolvedValue(seedProviders),
        findFirst: jest.fn(
          async ({ where }: { where: { slug: string } }) =>
            seedProviders.find((p) => p.slug === where.slug) ?? null,
        ),
      } as unknown as PrismaService["aIProvider"],
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserApiKeysService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EncryptionService, useValue: buildEncryption() },
        {
          provide: ProviderProbeService,
          useValue: (probeMock = {
            probe: jest.fn().mockResolvedValue({ ok: true }),
            probeByProvider: jest.fn().mockResolvedValue({ ok: true }),
          }),
        },
      ],
    }).compile();

    service = module.get<UserApiKeysService>(UserApiKeysService);
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==================== listUserApiKeys ====================

  describe("listUserApiKeys", () => {
    it("returns list of keys without exposing encrypted values", async () => {
      // Simulate what Prisma's select returns — only the selected fields, no encryptedValue/iv
      const keysFromSelect = [
        {
          id: "key-1",
          provider: "openai",
          mode: UserApiKeyMode.PERSONAL,
          keyHint: "sk-t...est1",
          apiEndpoint: null,
          preferredModelId: null,
          isActive: true,
          lastUsedAt: null,
          testStatus: null,
          usageCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "key-2",
          provider: "anthropic",
          mode: UserApiKeyMode.PERSONAL,
          keyHint: "sk-a...234",
          apiEndpoint: null,
          preferredModelId: null,
          isActive: true,
          lastUsedAt: null,
          testStatus: null,
          usageCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      (mockPrisma.userApiKey!.findMany as jest.Mock).mockResolvedValue(
        keysFromSelect,
      );

      const result = await service.listUserApiKeys("user-1");

      expect(result).toHaveLength(2);
      expect(result[0]).not.toHaveProperty("encryptedValue");
      expect(result[0]).not.toHaveProperty("iv");
    });

    it("normalizes mode to lowercase", async () => {
      const keys = [makeApiKey({ mode: UserApiKeyMode.PERSONAL })];
      (mockPrisma.userApiKey!.findMany as jest.Mock).mockResolvedValue(keys);

      const result = await service.listUserApiKeys("user-1");

      // 捐赠池退役后 mode 恒为 personal（W4b）
      expect(result[0].mode).toBe("personal");
    });

    it("returns empty array when no keys exist", async () => {
      (mockPrisma.userApiKey!.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.listUserApiKeys("user-1");

      expect(result).toEqual([]);
    });
  });

  // ==================== saveKey ====================

  describe("saveKey", () => {
    it("validates provider name format", async () => {
      await expect(
        service.saveKey(
          "user-1",
          "invalid provider!",
          "sk-test",
          ApiKeyMode.PERSONAL,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects too-long provider names", async () => {
      const longName = "a".repeat(51);
      await expect(
        service.saveKey("user-1", longName, "sk-test", ApiKeyMode.PERSONAL),
      ).rejects.toThrow(BadRequestException);
    });

    it("creates a new personal key when none exists", async () => {
      (mockPrisma.userApiKey!.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.userApiKey!.create as jest.Mock).mockResolvedValue(
        makeApiKey(),
      );

      const result = await service.saveKey(
        "user-1",
        "openai",
        "sk-test1234567890",
        ApiKeyMode.PERSONAL,
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe(ApiKeyMode.PERSONAL);
      expect(mockPrisma.userApiKey!.create).toHaveBeenCalled();
    });

    it("updates existing key", async () => {
      (mockPrisma.userApiKey!.findUnique as jest.Mock).mockResolvedValue(
        makeApiKey(),
      );
      (mockPrisma.userApiKey!.update as jest.Mock).mockResolvedValue(
        makeApiKey(),
      );

      const result = await service.saveKey(
        "user-1",
        "openai",
        "sk-new-key1234",
        ApiKeyMode.PERSONAL,
      );

      expect(result.success).toBe(true);
      expect(mockPrisma.userApiKey!.update).toHaveBeenCalled();
    });

    it("validates endpoint URL format", async () => {
      await expect(
        service.saveKey(
          "user-1",
          "openai",
          "sk-test",
          ApiKeyMode.PERSONAL,
          undefined,
          "not-a-url",
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("blocks private/internal endpoint URLs (SSRF protection)", async () => {
      await expect(
        service.saveKey(
          "user-1",
          "openai",
          "sk-test",
          ApiKeyMode.PERSONAL,
          undefined,
          "http://localhost:8080/api",
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==================== deleteKey ====================

  describe("deleteKey", () => {
    it("throws NotFoundException when key not found", async () => {
      (mockPrisma.userApiKey!.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.deleteKey("user-1", "openai")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("deletes the API key", async () => {
      const key = makeApiKey();
      (mockPrisma.userApiKey!.findUnique as jest.Mock).mockResolvedValue(key);
      (mockPrisma.userApiKey!.delete as jest.Mock).mockResolvedValue(key);

      const result = await service.deleteKey("user-1", "openai");

      expect(result.success).toBe(true);
      expect(mockPrisma.userApiKey!.delete).toHaveBeenCalledWith({
        where: { id: key.id },
      });
    });
  });

  // ==================== testKey ====================

  describe("testKey", () => {
    it("returns failure for unknown provider without endpoint", async () => {
      const result = await service.testKey("completely-unknown", "sk-test");

      expect(result.success).toBe(false);
      // 2026-05-11 P2: 消息文本改为指引 admin 维护页（保留 errorCode UNKNOWN 做契约断言）
      expect(result.errorCode).toBe("UNKNOWN");
    });

    it("validates endpoint URL before testing", async () => {
      await expect(
        service.testKey("openai", "sk-test", "http://localhost/evil"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==================== testKeyById (W3+ 能力对齐) ====================

  describe("testKeyById", () => {
    it("probes stored key and writes back success status", async () => {
      // 真实 v2 信封行，decryptAny 才能解出值（否则走 DECRYPTION_FAILED 分支）
      const env = await buildEncryption().encryptEnvelope("sk-stored");
      (mockPrisma.userApiKey!.findFirst as jest.Mock).mockResolvedValue(
        makeApiKey({
          id: "key-1",
          provider: "openai",
          encryptedValue: env.encryptedValue,
          iv: env.iv,
          authTag: env.authTag,
          wrappedDek: env.wrappedDek,
          encVersion: env.encVersion,
          kekVersion: env.kekVersion,
        }),
      );

      const result = await service.testKeyById("user-1", "key-1");

      expect(result.ok).toBe(true);
      const updateCall = (mockPrisma.userApiKey!.update as jest.Mock).mock
        .calls[0][0];
      expect(updateCall.where).toEqual({ id: "key-1" });
      expect(updateCall.data.testStatus).toBe("success");
      expect(updateCall.data.lastErrorCode).toBeNull();
    });

    it("throws NotFound for a key not owned by the user (owner isolation)", async () => {
      (mockPrisma.userApiKey!.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.testKeyById("user-1", "someone-elses-key"),
      ).rejects.toThrow("API Key not found");
    });

    // ★ 2026-06-11 修"Claude Key 测试始终失败"：provider slug 无匹配 ai_providers 行时
    //   apiFormat 必须按 slug/endpoint 推断为 anthropic，而非退回 openai（用错协议必失败）。
    it("infers anthropic apiFormat for a claude key with no DB provider row", async () => {
      const env = await buildEncryption().encryptEnvelope("sk-claude");
      (mockPrisma.userApiKey!.findFirst as jest.Mock).mockResolvedValue(
        makeApiKey({
          id: "key-claude",
          provider: "claude", // seed 里只有 "anthropic"，"claude" → resolveProviderDefaults 返回 null
          apiEndpoint: "https://api.anthropic.com/v1",
          encryptedValue: env.encryptedValue,
          iv: env.iv,
          authTag: env.authTag,
          wrappedDek: env.wrappedDek,
          encVersion: env.encVersion,
          kekVersion: env.kekVersion,
        }),
      );

      const result = await service.testKeyById("user-1", "key-claude");

      expect(result.ok).toBe(true);
      expect(probeMock.probe).toHaveBeenCalledWith(
        expect.objectContaining({ apiFormat: "anthropic" }),
      );
    });
  });

  // ==================== getPersonalKey ====================

  describe("getPersonalKey", () => {
    it("returns null when no personal key found", async () => {
      (mockPrisma.userApiKey!.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.getPersonalKey("user-1", "openai");

      expect(result).toBeNull();
    });

    it("decrypts and returns key data (envelope v2)", async () => {
      // 用同 key 的 EncryptionService 产出 v2 信封行，decryptAny 双读应可解。
      const env = await buildEncryption().encryptEnvelope("real-api-key");
      const key = makeApiKey({
        encryptedValue: env.encryptedValue,
        iv: env.iv,
        authTag: env.authTag,
        wrappedDek: env.wrappedDek,
        encVersion: env.encVersion,
        kekVersion: env.kekVersion,
      });
      (mockPrisma.userApiKey!.findFirst as jest.Mock).mockResolvedValue(key);

      const result = await service.getPersonalKey("user-1", "openai");

      expect(result).not.toBeNull();
      expect(result!.apiKey).toBe("real-api-key");
    });
  });

  // ==================== getSupportedProviders ====================

  describe("getSupportedProviders", () => {
    it("returns list of known providers", async () => {
      const providers = await service.getSupportedProviders();

      expect(providers.length).toBeGreaterThan(0);
      const ids = providers.map((p: { id: string }) => p.id);
      expect(ids).toContain("openai");
      expect(ids).toContain("anthropic");
    });

    it("includes endpoint for each provider", async () => {
      const providers = await service.getSupportedProviders();

      for (const provider of providers) {
        expect(provider.endpoint).toBeDefined();
        expect(provider.endpoint).toMatch(/^https?:\/\//);
      }
    });
  });
});
