import { Test, TestingModule } from "@nestjs/testing";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SecretKeysService } from "../secret-keys.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { EncryptionService } from "../../encryption/encryption.service";
import { ProviderProbeService } from "../../../governance/key-health/provider-probe.service";

const buildEncryption = (): EncryptionService =>
  new EncryptionService({
    get: (key: string) =>
      key === "SETTINGS_ENCRYPTION_KEY"
        ? "test-encryption-key-32chars-ok!"
        : key === "NODE_ENV"
          ? "test"
          : undefined,
  } as unknown as ConfigService);

const makeSecretRow = (overrides: Record<string, unknown> = {}) => ({
  id: "secret-1",
  name: "test-api-key",
  displayName: "Test API Key",
  category: "AI_MODEL",
  description: null,
  provider: "openai",
  isActive: true,
  encryptedValue: "legacy-enc",
  iv: "abcd1234abcd1234abcd1234abcd1234",
  keyVersion: 1,
  expiresAt: null,
  lastRotatedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: null,
  updatedBy: null,
  deletedAt: null,
  deletedBy: null,
  lastAccessedAt: null,
  accessCount: 0,
  currentVersion: 1,
  ...overrides,
});

const makeKeyRow = (overrides: Record<string, unknown> = {}) => ({
  id: "key-a",
  secretId: "secret-1",
  label: "primary",
  encryptedValue: "enc",
  iv: "abcd1234abcd1234abcd1234abcd1234",
  keyVersion: 1,
  keyHint: "sk-…1234",
  isActive: true,
  priority: 0,
  testStatus: null,
  lastUsedAt: null,
  lastErrorMessage: null,
  accessCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: null,
  updatedBy: null,
  ...overrides,
});

describe("SecretKeysService", () => {
  let service: SecretKeysService;
  let prisma: {
    secret: {
      findUnique: jest.Mock;
    };
    secretKey: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let encryption: EncryptionService;

  beforeEach(async () => {
    prisma = {
      secret: { findUnique: jest.fn(), findFirst: jest.fn() },
      secretKey: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    encryption = buildEncryption();

    const probeMock: Pick<ProviderProbeService, "probe" | "probeByProvider"> = {
      probe: jest.fn().mockResolvedValue({ ok: true }),
      probeByProvider: jest.fn().mockResolvedValue({ ok: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecretKeysService,
        { provide: PrismaService, useValue: prisma },
        { provide: EncryptionService, useValue: encryption },
        { provide: ProviderProbeService, useValue: probeMock },
      ],
    }).compile();

    service = module.get(SecretKeysService);
  });

  describe("addKey", () => {
    it("rejects duplicate label for same secret", async () => {
      prisma.secret.findUnique.mockResolvedValue(makeSecretRow());
      prisma.secretKey.findUnique.mockResolvedValue({ id: "existing" });

      await expect(
        service.addKey("secret-1", { label: "primary", value: "sk-test123" }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("creates key with masked hint and increments default priority", async () => {
      prisma.secret.findUnique.mockResolvedValue(makeSecretRow());
      prisma.secretKey.findUnique.mockResolvedValue(null);
      prisma.secretKey.create.mockImplementation(async ({ data }) =>
        makeKeyRow({ ...data, id: "new-key" }),
      );

      const created = await service.addKey("secret-1", {
        label: "backup-1",
        value: "sk-abcdef1234567890",
      });

      expect(prisma.secretKey.create).toHaveBeenCalled();
      const callArg = prisma.secretKey.create.mock.calls[0][0].data;
      expect(callArg.label).toBe("backup-1");
      expect(callArg.encryptedValue).not.toBe("sk-abcdef1234567890");
      // PR-3.1：信封 v2 用 AES-256-GCM，iv = 12 bytes = 24 hex chars
      expect(callArg.iv).toMatch(/^[0-9a-f]{24}$/);
      expect(callArg.encVersion).toBe(2);
      expect(callArg.authTag).toMatch(/^[0-9a-f]{32}$/);
      expect(callArg.priority).toBe(0);
      expect(callArg.isActive).toBe(true);
      expect(created.keyHint).toContain("…");
    });
  });

  describe("getSecretKey - fallback chain", () => {
    it("returns null when secret not found", async () => {
      prisma.secret.findFirst.mockResolvedValue(null);
      const result = await service.getSecretKey("missing-secret");
      expect(result).toBeNull();
    });

    it("falls back to legacy Secret.encryptedValue when no SecretKey rows", async () => {
      const legacy = encryption.encrypt("legacy-plaintext");
      prisma.secret.findFirst.mockResolvedValue(
        makeSecretRow({
          encryptedValue: legacy.encryptedValue,
          iv: legacy.iv,
        }),
      );
      prisma.secretKey.findMany.mockResolvedValue([]);

      const result = await service.getSecretKey("test-api-key");
      expect(result).toEqual({
        value: "legacy-plaintext",
        keyId: null,
        label: "(legacy)",
      });
    });

    it("picks lowest priority active key", async () => {
      const enc1 = encryption.encrypt("primary-value");
      const enc2 = encryption.encrypt("backup-value");
      prisma.secret.findFirst.mockResolvedValue(makeSecretRow());
      prisma.secretKey.findMany.mockResolvedValue([
        makeKeyRow({
          id: "k1",
          label: "primary",
          priority: 0,
          encryptedValue: enc1.encryptedValue,
          iv: enc1.iv,
        }),
        makeKeyRow({
          id: "k2",
          label: "backup",
          priority: 1,
          encryptedValue: enc2.encryptedValue,
          iv: enc2.iv,
        }),
      ]);

      const result = await service.getSecretKey("test-api-key");
      expect(result?.value).toBe("primary-value");
      expect(result?.keyId).toBe("k1");
      expect(result?.label).toBe("primary");
    });

    // ★ 2026-06-12 round-robin：可用 key 间按 LRU 轮询，刚用过的不再被重复选中
    it("round-robin: 在可用 key 间选最久未用的一把（LRU 分散，优先级让位）", async () => {
      const enc1 = encryption.encrypt("just-used");
      const enc2 = encryption.encrypt("idle-longest");
      prisma.secret.findFirst.mockResolvedValue(makeSecretRow());
      prisma.secretKey.findMany.mockResolvedValue([
        makeKeyRow({
          id: "k1",
          label: "primary",
          priority: 0,
          lastUsedAt: new Date(Date.now() - 1_000), // 刚用过
          encryptedValue: enc1.encryptedValue,
          iv: enc1.iv,
        }),
        makeKeyRow({
          id: "k2",
          label: "backup",
          priority: 1,
          lastUsedAt: new Date(Date.now() - 60_000), // 更久没用
          encryptedValue: enc2.encryptedValue,
          iv: enc2.iv,
        }),
      ]);

      const result = await service.getSecretKey("test-api-key");
      // k1 优先级更高但刚用过 → 轮询到最久未用的 k2（负载分散）
      expect(result?.keyId).toBe("k2");
      expect(result?.value).toBe("idle-longest");
    });

    it("skips failed key inside circuit-break window and uses next", async () => {
      const enc1 = encryption.encrypt("dead-value");
      const enc2 = encryption.encrypt("alive-value");
      const recentFailure = new Date(Date.now() - 60_000); // 1 min ago
      prisma.secret.findFirst.mockResolvedValue(makeSecretRow());
      prisma.secretKey.findMany.mockResolvedValue([
        makeKeyRow({
          id: "k1",
          priority: 0,
          testStatus: "failed",
          lastUsedAt: recentFailure,
          encryptedValue: enc1.encryptedValue,
          iv: enc1.iv,
        }),
        makeKeyRow({
          id: "k2",
          priority: 1,
          testStatus: "success",
          encryptedValue: enc2.encryptedValue,
          iv: enc2.iv,
        }),
      ]);

      const result = await service.getSecretKey("test-api-key");
      expect(result?.keyId).toBe("k2");
      expect(result?.value).toBe("alive-value");
    });

    it("uses failed key once circuit-break window expires", async () => {
      const enc1 = encryption.encrypt("revived-value");
      const oldFailure = new Date(Date.now() - 10 * 60_000); // 10 min ago
      prisma.secret.findFirst.mockResolvedValue(makeSecretRow());
      prisma.secretKey.findMany.mockResolvedValue([
        makeKeyRow({
          id: "k1",
          priority: 0,
          testStatus: "failed",
          lastUsedAt: oldFailure,
          encryptedValue: enc1.encryptedValue,
          iv: enc1.iv,
        }),
      ]);

      const result = await service.getSecretKey("test-api-key");
      expect(result?.keyId).toBe("k1");
      expect(result?.value).toBe("revived-value");
    });

    // ★ W1 (2026-05-29) 动态熔断：AUTH_FAILED → 永久熔断，即使很久以前失败也跳过
    it("AUTH_FAILED key 永久熔断（10min 前失败仍跳过，用下一把）", async () => {
      const enc1 = encryption.encrypt("dead-key");
      const enc2 = encryption.encrypt("good-key");
      prisma.secret.findFirst.mockResolvedValue(makeSecretRow());
      prisma.secretKey.findMany.mockResolvedValue([
        makeKeyRow({
          id: "k1",
          priority: 0,
          testStatus: "failed",
          lastErrorCode: "AUTH_FAILED",
          lastUsedAt: new Date(Date.now() - 10 * 60_000),
          encryptedValue: enc1.encryptedValue,
          iv: enc1.iv,
        }),
        makeKeyRow({
          id: "k2",
          priority: 1,
          testStatus: "success",
          encryptedValue: enc2.encryptedValue,
          iv: enc2.iv,
        }),
      ]);

      const result = await service.getSecretKey("test-api-key");
      expect(result?.keyId).toBe("k2");
    });

    // ★ W1：RATE_LIMIT_KEY → 60s 短冷却，90s 前失败已过窗口 → 复用（旧固定 5min 会误跳过）
    it("RATE_LIMIT_KEY 90s 前失败 → 已过 60s 窗口，复用该 key", async () => {
      const enc1 = encryption.encrypt("rate-limited-then-ok");
      prisma.secret.findFirst.mockResolvedValue(makeSecretRow());
      prisma.secretKey.findMany.mockResolvedValue([
        makeKeyRow({
          id: "k1",
          priority: 0,
          testStatus: "failed",
          lastErrorCode: "RATE_LIMIT_KEY",
          lastUsedAt: new Date(Date.now() - 90_000),
          encryptedValue: enc1.encryptedValue,
          iv: enc1.iv,
        }),
      ]);

      const result = await service.getSecretKey("test-api-key");
      expect(result?.keyId).toBe("k1");
      expect(result?.value).toBe("rate-limited-then-ok");
    });

    it("returns null when secret is disabled", async () => {
      prisma.secret.findFirst.mockResolvedValue(
        makeSecretRow({ isActive: false }),
      );
      const result = await service.getSecretKey("test-api-key");
      expect(result).toBeNull();
    });

    it("returns null when secret is expired", async () => {
      prisma.secret.findFirst.mockResolvedValue(
        makeSecretRow({ expiresAt: new Date(Date.now() - 1000) }),
      );
      const result = await service.getSecretKey("test-api-key");
      expect(result).toBeNull();
    });
  });

  describe("markFailure", () => {
    it("trims long error messages to 500 chars", async () => {
      prisma.secretKey.update.mockResolvedValue(makeKeyRow());
      const longMsg = "x".repeat(2000);
      await service.markFailure("key-a", "AUTH_FAILED", longMsg);
      const call = prisma.secretKey.update.mock.calls[0][0];
      expect(call.data.lastErrorMessage.length).toBe(500);
      expect(call.data.testStatus).toBe("failed");
      expect(call.data.lastErrorCode).toBe("AUTH_FAILED");
    });

    it("trims errorCode to 40 chars", async () => {
      prisma.secretKey.update.mockResolvedValue(makeKeyRow());
      await service.markFailure("key-a", "X".repeat(80), "msg");
      const call = prisma.secretKey.update.mock.calls[0][0];
      expect(call.data.lastErrorCode.length).toBe(40);
    });

    // ★ 2026-05-12 (C方案): 失败也写 lastUsedAt (Test 也算 Used).
    it("writes lastUsedAt on failure (Test also counts as Used)", async () => {
      prisma.secretKey.update.mockResolvedValue(makeKeyRow());
      const before = Date.now();
      await service.markFailure("key-a", "AUTH_FAILED", "msg");
      const after = Date.now();
      const call = prisma.secretKey.update.mock.calls[0][0];
      expect(call.data.lastUsedAt).toBeInstanceOf(Date);
      const ts = (call.data.lastUsedAt as Date).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });

  // ★ 2026-05-12 (C方案): markSuccess 必须同时写入 accessCount + lastUsedAt,
  // 让 admin UI "HITS" + "LAST USED" 列反映真实业务调用而不仅"上次手动 Test".
  describe("markSuccess (Wave C accessCount + lastUsedAt)", () => {
    it("increments accessCount and sets lastUsedAt on success", async () => {
      prisma.secretKey.update.mockResolvedValue(makeKeyRow());
      const before = Date.now();
      await service.markSuccess("key-a");
      const after = Date.now();
      const call = prisma.secretKey.update.mock.calls[0][0];
      expect(call.data.testStatus).toBe("success");
      expect(call.data.lastErrorCode).toBeNull();
      expect(call.data.lastErrorMessage).toBeNull();
      expect(call.data.accessCount).toEqual({ increment: 1 });
      expect(call.data.lastUsedAt).toBeInstanceOf(Date);
      const ts = (call.data.lastUsedAt as Date).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it("does NOT increment accessCount when incrementAccessCount=false (manual probe)", async () => {
      prisma.secretKey.update.mockResolvedValue(makeKeyRow());
      await service.markSuccess("key-a", { incrementAccessCount: false });
      const call = prisma.secretKey.update.mock.calls[0][0];
      expect(call.data.accessCount).toBeUndefined();
      // 但 lastUsedAt 仍然写 — Test 也算 Used.
      expect(call.data.lastUsedAt).toBeInstanceOf(Date);
    });
  });

  describe("deleteKey", () => {
    it("throws NotFound when key missing", async () => {
      prisma.secretKey.findUnique.mockResolvedValue(null);
      await expect(service.deleteKey("missing-id")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("replaceKeyValue", () => {
    it("re-encrypts value and resets test status", async () => {
      prisma.secretKey.findUnique.mockResolvedValue(makeKeyRow());
      prisma.secretKey.update.mockImplementation(async ({ data }) =>
        makeKeyRow({ ...data }),
      );
      const updated = await service.replaceKeyValue("key-a", {
        value: "sk-new-secret-value",
      });
      const call = prisma.secretKey.update.mock.calls[0][0];
      expect(call.data.testStatus).toBeNull();
      expect(call.data.lastUsedAt).toBeNull();
      expect(call.data.encryptedValue).not.toBe("sk-new-secret-value");
      expect(updated.keyHint).toContain("…");
    });

    // ★ 2026-05-07: 看护 Bug C 回归 —— 替换 KEY value = 全新物理 key，旧
    // accessCount 不属于它，必须重置为 0；与 testStatus reset 同语义。
    it("resets accessCount to 0 (new physical key value, fresh hit counter)", async () => {
      prisma.secretKey.findUnique.mockResolvedValue(
        makeKeyRow({ accessCount: 12345 }),
      );
      prisma.secretKey.update.mockImplementation(async ({ data }) =>
        makeKeyRow({ ...data }),
      );
      await service.replaceKeyValue("key-a", { value: "sk-fresh-value" });
      const call = prisma.secretKey.update.mock.calls[0][0];
      expect(call.data.accessCount).toBe(0);
    });
  });
});
