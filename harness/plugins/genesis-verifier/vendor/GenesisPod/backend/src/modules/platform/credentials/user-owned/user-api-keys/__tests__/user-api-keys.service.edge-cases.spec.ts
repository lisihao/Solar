/**
 * UserApiKeysService – edge-case tests for uncovered methods/branches
 *
 * Covers (not in existing spec):
 * - getPersonalKey – cache hit, cache miss + store, null stored in cache, decrypt fail
 * - invalidateUserKeyCache – with and without cacheService
 * - testKey – fetch mocking for openai/anthropic/google/unknown provider
 * - saveKey – key hint generation
 * - isPrivateHost / validateEndpointUrl – various private IP ranges
 */

// Mock optional external packages
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
import { Logger, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UserApiKeysService } from "../user-api-keys.service";
import { ProviderProbeService } from "@/modules/platform/credentials/governance/key-health/provider-probe.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { EncryptionService } from "../../../../../platform/credentials/storage/encryption/encryption.service";
import { CacheService } from "../../../../../../common/cache";
import { UserApiKeyMode } from "@prisma/client";
import { ApiKeyMode } from "@/modules/open-api/user/byok/dto/user-api-keys.dto";

// ─── fetch mock ───────────────────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch;

// ─── helpers ─────────────────────────────────────────────────────────────────

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

// ─── tests ───────────────────────────────────────────────────────────────────

describe("UserApiKeysService (additional coverage)", () => {
  let service: UserApiKeysService;
  let mockPrisma: jest.Mocked<Partial<PrismaService>>;
  let mockCacheService: jest.Mocked<Partial<CacheService>>;

  const buildEncryption = (): EncryptionService =>
    new EncryptionService({
      get: (key: string) =>
        key === "SETTINGS_ENCRYPTION_KEY"
          ? "test-encryption-key-32chars-ok!"
          : key === "NODE_ENV"
            ? "test"
            : undefined,
    } as unknown as ConfigService);

  beforeEach(async () => {
    // 2026-05-11 P2: ProviderProbeService.probeByProvider 现在走 DB ai_providers
    const seedProviders = [
      {
        slug: "openai",
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
        endpoint: "https://api.anthropic.com/v1",
        apiFormat: "anthropic",
        testModel: "claude-3-haiku-20240307",
        capabilities: ["CHAT"],
        iconUrl: null,
        freeTierNote: null,
        docUrl: null,
        scope: "system",
      },
      {
        slug: "google",
        endpoint: "https://generativelanguage.googleapis.com/v1beta",
        apiFormat: "google",
        testModel: "gemini-2.0-flash-lite",
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

    mockCacheService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      invalidateUserCache: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserApiKeysService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EncryptionService, useValue: buildEncryption() },
        { provide: CacheService, useValue: mockCacheService },
        // 用真 ProviderProbeService 让 testKey - provider-specific paths 那批测试
        // 仍能通过 mockFetch 触达分支（probe 内部用 global fetch）
        ProviderProbeService,
      ],
    }).compile();

    service = module.get<UserApiKeysService>(UserApiKeysService);
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    mockFetch.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getPersonalKey – cache layer
  // ──────────────────────────────────────────────────────────────────────────

  describe("getPersonalKey with cache", () => {
    it("returns cached result without DB query (含 label 字段)", async () => {
      const cached = {
        apiKey: "cached-key",
        apiEndpoint: null,
        label: "default",
      };
      (mockCacheService.get as jest.Mock).mockResolvedValue(cached);

      const result = await service.getPersonalKey("user-1", "openai");

      expect(result).toEqual(cached);
      expect(mockPrisma.userApiKey!.findFirst).not.toHaveBeenCalled();
    });

    it("treats legacy cache without label as stale → DB fallback", async () => {
      // 2026-05-12 fix: 修复前的 cache shape 没 label 字段，必须走 DB 重拉
      // 让 KeyResolver 构造 healthKeyId 时拿到真实 label
      const staleCached = { apiKey: "cached-key", apiEndpoint: null };
      (mockCacheService.get as jest.Mock).mockResolvedValue(staleCached);

      await service.getPersonalKey("user-1", "openai");

      expect(mockPrisma.userApiKey!.findFirst).toHaveBeenCalled();
    });

    it("queries DB and caches result when cache misses", async () => {
      (mockCacheService.get as jest.Mock).mockResolvedValue(null);

      const env = await buildEncryption().encryptEnvelope("db-api-key");
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
      expect(result!.apiKey).toBe("db-api-key");
      expect(mockCacheService.set).toHaveBeenCalled();
    });

    it("caches null result with SHORT TTL when no key found", async () => {
      (mockCacheService.get as jest.Mock).mockResolvedValue(null);
      (mockPrisma.userApiKey!.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.getPersonalKey("user-1", "openai");

      expect(result).toBeNull();
      expect(mockCacheService.set).toHaveBeenCalledWith(
        expect.stringContaining("openai"),
        null,
        60, // CacheTTL.SHORT
      );
    });

    it("returns null when decryption fails", async () => {
      (mockCacheService.get as jest.Mock).mockResolvedValue(null);
      const key = makeApiKey({ encryptedValue: "bad-data", iv: "bad-iv" });
      (mockPrisma.userApiKey!.findFirst as jest.Mock).mockResolvedValue(key);

      const result = await service.getPersonalKey("user-1", "openai");

      expect(result).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // invalidateUserKeyCache
  // ──────────────────────────────────────────────────────────────────────────

  describe("invalidateUserKeyCache", () => {
    it("calls cacheService.invalidateUserCache when cacheService is present", async () => {
      await service.invalidateUserKeyCache("user-1");

      expect(mockCacheService.invalidateUserCache).toHaveBeenCalledWith(
        "user-1",
      );
    });

    it("does nothing when cacheService is not present", async () => {
      // Create service without cacheService
      const moduleWithoutCache: TestingModule = await Test.createTestingModule({
        providers: [
          UserApiKeysService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: EncryptionService, useValue: buildEncryption() },
          ProviderProbeService,
        ],
      }).compile();

      const serviceWithoutCache =
        moduleWithoutCache.get<UserApiKeysService>(UserApiKeysService);

      await expect(
        serviceWithoutCache.invalidateUserKeyCache("user-1"),
      ).resolves.not.toThrow();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // testKey – provider-specific fetch paths
  // ──────────────────────────────────────────────────────────────────────────

  describe("testKey - provider-specific paths", () => {
    it("tests openai provider using /models endpoint", async () => {
      mockFetch.mockResolvedValue({ status: 200 });

      const result = await service.testKey("openai", "sk-test");

      expect(result.success).toBe(true);
      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain("/models");
    });

    it("returns failure for openai when status is 401", async () => {
      mockFetch.mockResolvedValue({ status: 401 });

      const result = await service.testKey("openai", "sk-invalid");

      expect(result.success).toBe(false);
    });

    it("returns failure for openai when status is 403", async () => {
      mockFetch.mockResolvedValue({ status: 403 });

      const result = await service.testKey("openai", "sk-forbidden");

      expect(result.success).toBe(false);
    });

    it("tests anthropic provider using /messages endpoint", async () => {
      mockFetch.mockResolvedValue({ status: 200 });

      const result = await service.testKey("anthropic", "sk-ant-test");

      expect(result.success).toBe(true);
      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain("/messages");
    });

    it("tests google provider using /models?key= endpoint", async () => {
      mockFetch.mockResolvedValue({ status: 200 });

      const result = await service.testKey("google", "AIza-test");

      expect(result.success).toBe(true);
      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain("models?key=");
    });

    it("returns failure when fetch throws", async () => {
      mockFetch.mockRejectedValue(new Error("Timeout"));

      const result = await service.testKey("openai", "sk-timeout");

      // testProviderKey catches internally and returns false → "API Key validation failed"
      expect(result.success).toBe(false);
      expect(result.message).toBeDefined();
    });

    it("tests custom provider with provided endpoint", async () => {
      mockFetch.mockResolvedValue({ status: 200 });

      const result = await service.testKey(
        "custom",
        "key-123",
        "https://custom-api.example.com/v1",
      );

      expect(result.success).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // validateEndpointUrl / isPrivateHost SSRF protection
  // ──────────────────────────────────────────────────────────────────────────

  describe("SSRF protection via validateEndpointUrl", () => {
    const blockedUrls = [
      "http://localhost/api",
      "http://127.0.0.1/api",
      "http://0.0.0.0/api",
      "http://::1/api",
      "http://[::1]/api",
      "http://10.0.0.1/api",
      "http://10.255.255.255/api",
      "http://192.168.1.1/api",
      "http://192.168.0.100/api",
      "http://172.16.0.1/api",
      "http://172.31.255.255/api",
      "http://169.254.1.1/api",
    ];

    blockedUrls.forEach((url) => {
      it(`blocks private URL: ${url}`, async () => {
        await expect(
          service.saveKey(
            "user-1",
            "openai",
            "sk-test",
            ApiKeyMode.PERSONAL,
            undefined,
            url,
          ),
        ).rejects.toThrow(BadRequestException);
      });
    });

    it("allows public endpoint URL", async () => {
      (mockPrisma.userApiKey!.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.userApiKey!.create as jest.Mock).mockResolvedValue(
        makeApiKey(),
      );

      // Should not throw
      await service.saveKey(
        "user-1",
        "openai",
        "sk-test1234567890",
        ApiKeyMode.PERSONAL,
        undefined,
        "https://external-api.example.com/v1",
      );

      expect(mockPrisma.userApiKey!.create).toHaveBeenCalled();
    });

    it("blocks non-http/https protocol", async () => {
      await expect(
        service.saveKey(
          "user-1",
          "openai",
          "sk-test",
          ApiKeyMode.PERSONAL,
          undefined,
          "ftp://example.com/api",
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("allows 172.15 (not in private range)", async () => {
      (mockPrisma.userApiKey!.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.userApiKey!.create as jest.Mock).mockResolvedValue(
        makeApiKey(),
      );

      // 172.15.x.x is NOT in the private range (172.16-172.31 is private)
      await service.saveKey(
        "user-1",
        "openai",
        "sk-test1234567890",
        ApiKeyMode.PERSONAL,
        undefined,
        "https://172.15.0.1/api",
      );

      expect(mockPrisma.userApiKey!.create).toHaveBeenCalled();
    });

    it("blocks 172.32+ (just outside private range, but 172.16-172.31 is private)", async () => {
      (mockPrisma.userApiKey!.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.userApiKey!.create as jest.Mock).mockResolvedValue(
        makeApiKey(),
      );

      // 172.32.x.x is outside private range, should be allowed
      await service.saveKey(
        "user-1",
        "openai",
        "sk-test1234567890",
        ApiKeyMode.PERSONAL,
        undefined,
        "https://172.32.0.1/api",
      );

      expect(mockPrisma.userApiKey!.create).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // generateKeyHint
  // ──────────────────────────────────────────────────────────────────────────

  describe("key hint generation (indirectly via saveKey)", () => {
    it("generates hint with prefix...suffix format for long keys", async () => {
      (mockPrisma.userApiKey!.findUnique as jest.Mock).mockResolvedValue(null);

      let createdData: Record<string, unknown> = {};
      (mockPrisma.userApiKey!.create as jest.Mock).mockImplementation(
        (args: { data: Record<string, unknown> }) => {
          createdData = args.data;
          return Promise.resolve(makeApiKey());
        },
      );

      await service.saveKey(
        "user-1",
        "openai",
        "sk-test-abc123xyz",
        ApiKeyMode.PERSONAL,
      );

      expect(createdData.keyHint).toMatch(/^.{4}\.\.\.+.{4}$/);
    });

    it("returns **** for very short keys (<=8 chars)", async () => {
      (mockPrisma.userApiKey!.findUnique as jest.Mock).mockResolvedValue(null);

      let createdData: Record<string, unknown> = {};
      (mockPrisma.userApiKey!.create as jest.Mock).mockImplementation(
        (args: { data: Record<string, unknown> }) => {
          createdData = args.data;
          return Promise.resolve(makeApiKey());
        },
      );

      await service.saveKey("user-1", "openai", "short1", ApiKeyMode.PERSONAL);

      expect(createdData.keyHint).toBe("****");
    });
  });
});
