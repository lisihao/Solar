import { Test, TestingModule } from "@nestjs/testing";
import { Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SecretsService } from "../secrets.service";
import { SecretKeysService } from "../secret-keys.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { EncryptionService } from "../../encryption/encryption.service";
import { AuditLogService } from "@/modules/platform/monitoring/audit/audit-log.service";
import { SecretCategory, SecretAction } from "@prisma/client";
import { classifySecret } from "../secret-name.catalog";

const buildEncryption = (): EncryptionService =>
  new EncryptionService({
    get: (key: string) =>
      key === "SETTINGS_ENCRYPTION_KEY"
        ? "test-encryption-key-32chars-ok!"
        : key === "NODE_ENV"
          ? "test"
          : undefined,
  } as unknown as ConfigService);

describe("SecretsService", () => {
  let service: SecretsService;
  let mockPrisma: jest.Mocked<Partial<PrismaService>>;

  const makeSecret = (overrides: Record<string, unknown> = {}) => ({
    id: "secret-1",
    name: "test-api-key",
    displayName: "Test API Key",
    category: "AI_MODEL" as SecretCategory,
    description: "A test secret",
    encryptedValue: "encrypted-data",
    iv: "abcd1234abcd1234abcd1234abcd1234",
    keyVersion: 1,
    provider: "openai",
    isActive: true,
    maskedValue: "****test****",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastAccessedAt: null,
    accessCount: 0,
    expiresAt: null,
    lastRotatedAt: null,
    currentVersion: 1,
    deletedAt: null,
    deletedBy: null,
    createdBy: null,
    updatedBy: null,
    ...overrides,
  });

  beforeEach(async () => {
    mockPrisma = {
      secret: {
        create: jest.fn().mockResolvedValue(makeSecret()),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(makeSecret()),
        count: jest.fn().mockResolvedValue(0),
      } as unknown as PrismaService["secret"],
      secretAccessLog: {
        create: jest.fn().mockResolvedValue({ id: "log-1" }),
        findMany: jest.fn().mockResolvedValue([]),
      } as unknown as PrismaService["secretAccessLog"],
      secretVersion: {
        create: jest.fn().mockResolvedValue({ id: "ver-1" }),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      } as unknown as PrismaService["secretVersion"],
      aIModel: {
        findMany: jest.fn().mockResolvedValue([]),
      } as unknown as PrismaService["aIModel"],
      // 2026-05-12 PR-5: getReferences 扩到 ToolConfig + MCPServerConfig
      toolConfig: {
        findMany: jest.fn().mockResolvedValue([]),
      } as unknown as PrismaService["toolConfig"],
      mCPServerConfig: {
        findMany: jest.fn().mockResolvedValue([]),
      } as unknown as PrismaService["mCPServerConfig"],
      systemSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
      } as unknown as PrismaService["systemSetting"],
      secretKey: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: "sk-1" }),
        update: jest.fn().mockResolvedValue({ id: "sk-1" }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        delete: jest.fn().mockResolvedValue({ id: "sk-1" }),
      } as unknown as PrismaService["secretKey"],
      // ★ $transaction(fn) 透传给 fn 整个 mockPrisma（行为像无回滚事务）
      $transaction: jest.fn().mockImplementation(async (arg: unknown) => {
        if (typeof arg === "function") {
          return (arg as (tx: typeof mockPrisma) => Promise<unknown>)(
            mockPrisma as unknown as typeof mockPrisma,
          );
        }
        return Promise.all(arg as Promise<unknown>[]);
      }),
    } as unknown as jest.Mocked<Partial<PrismaService>>;

    const mockSecretKeys = {
      addKey: jest.fn().mockResolvedValue({}),
      replaceKeyValue: jest.fn().mockResolvedValue({}),
      getSecretKey: jest.fn().mockResolvedValue(null),
      markSuccess: jest.fn().mockResolvedValue(undefined),
      markFailure: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecretsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EncryptionService, useValue: buildEncryption() },
        { provide: SecretKeysService, useValue: mockSecretKeys },
        {
          provide: AuditLogService,
          useValue: { record: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<SecretsService>(SecretsService);
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // 加密/密钥派生的边界用例已迁移到 encryption.service.spec.ts，此处不再重复。

  // ==================== create ====================

  describe("create", () => {
    it("creates a secret and logs access", async () => {
      (mockPrisma.secret!.create as jest.Mock).mockResolvedValue(makeSecret());

      const result = await service.create({
        name: "test-api-key",
        displayName: "Test API Key",
        value: "sk-secret-value",
        category: SecretCategory.AI_MODEL,
        provider: "openai",
      });

      expect(result.name).toBe("test-api-key");
      expect(result.isActive).toBe(true);
      expect(mockPrisma.secret!.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "test-api-key",
            isActive: true,
          }),
        }),
      );
      expect(mockPrisma.secretAccessLog!.create).toHaveBeenCalled();
    });

    it("encrypts the value before storing", async () => {
      const secret = makeSecret();
      (mockPrisma.secret!.create as jest.Mock).mockResolvedValue(secret);

      await service.create({
        name: "encrypted-secret",
        displayName: "Encrypted",
        value: "my-plain-text",
        category: SecretCategory.AI_MODEL,
      });

      const createCall = (mockPrisma.secret!.create as jest.Mock).mock
        .calls[0][0];
      // Value should be encrypted (not plain text)
      expect(createCall.data.encryptedValue).not.toBe("my-plain-text");
      expect(createCall.data.iv).toBeDefined();
    });

    it("stores audit context in access log", async () => {
      (mockPrisma.secret!.create as jest.Mock).mockResolvedValue(makeSecret());

      await service.create(
        {
          name: "audited-key",
          displayName: "Audited",
          value: "value",
          category: SecretCategory.AI_MODEL,
        },
        {
          userId: "admin-1",
          userEmail: "admin@test.com",
          ipAddress: "1.2.3.4",
        },
      );

      expect(mockPrisma.secretAccessLog!.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "admin-1",
            userEmail: "admin@test.com",
            ipAddress: "1.2.3.4",
            action: SecretAction.CREATE,
          }),
        }),
      );
    });
  });

  // ==================== getValue ====================

  describe("getValue", () => {
    it("returns null when secret not found", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.getValue("nonexistent");

      expect(result).toBeNull();
    });

    it("returns null for deleted secret", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(
        makeSecret({ deletedAt: new Date() }),
      );

      const result = await service.getValue("deleted-key");

      expect(result).toBeNull();
    });

    it("returns null for inactive secret", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(
        makeSecret({ isActive: false }),
      );

      const result = await service.getValue("inactive-key");

      expect(result).toBeNull();
    });

    it("returns null for expired secret", async () => {
      const pastDate = new Date(Date.now() - 1000);
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(
        makeSecret({ expiresAt: pastDate }),
      );

      const result = await service.getValue("expired-key");

      expect(result).toBeNull();
    });

    it("increments access count on successful retrieval", async () => {
      // Store and retrieve a real encrypted secret
      (mockPrisma.secret!.create as jest.Mock).mockResolvedValue(makeSecret());
      await service.create({
        name: "access-key",
        displayName: "Access",
        value: "plain-value",
        category: SecretCategory.AI_MODEL,
      });

      const createCall = (mockPrisma.secret!.create as jest.Mock).mock
        .calls[0][0];
      const realSecret = {
        ...makeSecret(),
        encryptedValue: createCall.data.encryptedValue,
        iv: createCall.data.iv,
        authTag: createCall.data.authTag,
        wrappedDek: createCall.data.wrappedDek,
        encVersion: createCall.data.encVersion,
        kekVersion: createCall.data.kekVersion,
      };

      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(realSecret);
      (mockPrisma.secret!.update as jest.Mock).mockResolvedValue(realSecret);

      await service.getValue("access-key");

      expect(mockPrisma.secret!.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            accessCount: { increment: 1 },
          }),
        }),
      );
    });

    it("decrypts the value for return", async () => {
      // Create a real secret so we have valid encrypted data
      (mockPrisma.secret!.create as jest.Mock).mockResolvedValue(makeSecret());
      await service.create({
        name: "decrypt-test",
        displayName: "Decrypt Test",
        value: "my-actual-value",
        category: SecretCategory.AI_MODEL,
      });

      const createCall = (mockPrisma.secret!.create as jest.Mock).mock
        .calls[0][0];

      const realEncrypted = makeSecret({
        encryptedValue: createCall.data.encryptedValue,
        iv: createCall.data.iv,
        authTag: createCall.data.authTag,
        wrappedDek: createCall.data.wrappedDek,
        encVersion: createCall.data.encVersion,
        kekVersion: createCall.data.kekVersion,
      });

      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(
        realEncrypted,
      );
      (mockPrisma.secret!.update as jest.Mock).mockResolvedValue(realEncrypted);

      const value = await service.getValue("decrypt-test");

      expect(value).toBe("my-actual-value");
    });

    it("logs access denied when secret is inactive", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(
        makeSecret({ isActive: false }),
      );

      await service.getValue("inactive-key", { userId: "user-1" });

      expect(mockPrisma.secretAccessLog!.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: SecretAction.ACCESS_DENIED,
          }),
        }),
      );
    });
  });

  // ==================== getValueInternal — multi-key delegation ====================

  describe("getValueInternal - multi-key delegation (P3)", () => {
    it("delegates to SecretKeysService.getSecretKey when injected", async () => {
      const sk = (
        service as unknown as {
          secretKeys: { getSecretKey: jest.Mock };
        }
      ).secretKeys;
      sk.getSecretKey.mockResolvedValue({
        value: "resolved-via-multi-key",
        keyId: "sk-1",
        label: "primary",
      });
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue({
        id: "secret-1",
      });

      const value = await service.getValueInternal("test-api-key");

      expect(value).toBe("resolved-via-multi-key");
      expect(sk.getSecretKey).toHaveBeenCalledWith("test-api-key");
    });

    // ★ 2026-05-07: 看护 Bug B 回归 —— 修复前 getValueInternal 完全不累加
    // SecretKey.accessCount，UI Hits 列只反映迁移种值（Secret.lifetime 拷贝），
    // 实时业务流量贡献为 0。修法：fire-and-forget increment，只动 count，
    // 不动 testStatus（避免 retrieval 后 upstream 401 的红绿闪烁）。
    it("increments SecretKey.accessCount on successful retrieve (per-key hit counter)", async () => {
      const sk = (
        service as unknown as {
          secretKeys: { getSecretKey: jest.Mock };
        }
      ).secretKeys;
      sk.getSecretKey.mockResolvedValue({
        value: "v",
        keyId: "sk-99",
        label: "primary",
      });
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue({
        id: "secret-1",
        name: "test-api-key",
      });

      await service.getValueInternal("test-api-key");

      // ★ 2026-05-12 (C方案): SecretKey.update 写入 accessCount + lastUsedAt 两字段.
      // admin UI "HITS" + "LAST USED" 列从此反映真实业务流量, 不再仅"上次手动 Test".
      const calls = (mockPrisma.secretKey!.update as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const firstCall = calls[0][0];
      expect(firstCall.where).toEqual({ id: "sk-99" });
      expect(firstCall.data.accessCount).toEqual({ increment: 1 });
      expect(firstCall.data.lastUsedAt).toBeInstanceOf(Date);
      // 关键：不能写 testStatus —— 那是 markSuccess/Failure 的职责
      const dataArgs = calls.map((c) => c[0]?.data ?? {});
      for (const d of dataArgs) {
        expect(d).not.toHaveProperty("testStatus");
      }
    });

    it("skips SecretKey.accessCount increment for legacy dual-track path (keyId=null)", async () => {
      const sk = (
        service as unknown as {
          secretKeys: { getSecretKey: jest.Mock };
        }
      ).secretKeys;
      sk.getSecretKey.mockResolvedValue({
        value: "legacy-v",
        keyId: null,
        label: "(legacy)",
      });
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue({
        id: "secret-1",
        name: "test-api-key",
      });

      await service.getValueInternal("test-api-key");

      // legacy 路径无 SecretKey 行可累加
      expect(mockPrisma.secretKey!.update).not.toHaveBeenCalled();
    });

    it("falls back to legacy path when multi-key returns null", async () => {
      const sk = (
        service as unknown as {
          secretKeys: { getSecretKey: jest.Mock };
        }
      ).secretKeys;
      sk.getSecretKey.mockResolvedValue(null);

      // create real secret so we have valid encrypted blob to decrypt
      (mockPrisma.secret!.create as jest.Mock).mockResolvedValue(makeSecret());
      await service.create({
        name: "legacy-key",
        displayName: "Legacy",
        value: "legacy-value",
        category: SecretCategory.AI_MODEL,
      });
      const createCall = (mockPrisma.secret!.create as jest.Mock).mock
        .calls[0][0];
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(
        makeSecret({
          encryptedValue: createCall.data.encryptedValue,
          iv: createCall.data.iv,
          authTag: createCall.data.authTag,
          wrappedDek: createCall.data.wrappedDek,
          encVersion: createCall.data.encVersion,
          kekVersion: createCall.data.kekVersion,
        }),
      );

      const value = await service.getValueInternal("legacy-key");

      expect(value).toBe("legacy-value");
      expect(sk.getSecretKey).toHaveBeenCalled();
    });
  });

  describe("markSecretSuccess / markSecretFailure", () => {
    it("calls SecretKeysService.markSuccess when keyId resolved", async () => {
      const sk = (
        service as unknown as {
          secretKeys: { getSecretKey: jest.Mock; markSuccess: jest.Mock };
        }
      ).secretKeys;
      sk.getSecretKey.mockResolvedValue({
        value: "v",
        keyId: "sk-42",
        label: "primary",
      });

      await service.markSecretSuccess("test-api-key");

      expect(sk.markSuccess).toHaveBeenCalledWith("sk-42");
    });

    it("no-ops when SecretKey resolution returns null keyId (legacy fallback)", async () => {
      const sk = (
        service as unknown as {
          secretKeys: { getSecretKey: jest.Mock; markFailure: jest.Mock };
        }
      ).secretKeys;
      sk.getSecretKey.mockResolvedValue({
        value: "v",
        keyId: null,
        label: "(legacy)",
      });

      await service.markSecretFailure("test-api-key", "rate limited");

      expect(sk.markFailure).not.toHaveBeenCalled();
    });
  });

  describe("create / update - dual-write to secret_keys", () => {
    it("create() mirrors initial value as 'primary' SecretKey via $transaction", async () => {
      (mockPrisma.secret!.create as jest.Mock).mockResolvedValue(makeSecret());

      await service.create({
        name: "new-key",
        displayName: "New",
        value: "sk-fresh-value",
        category: SecretCategory.AI_MODEL,
      });

      // 走 $transaction 路径：tx.secretKey.create 被调用且 label=primary
      expect(mockPrisma.secretKey!.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            label: "primary",
            secretId: "secret-1",
            priority: 0,
          }),
        }),
      );
    });

    it("update() with new value replaces existing 'primary' SecretKey via $transaction", async () => {
      const existing = makeSecret();
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(existing);
      (mockPrisma.secret!.update as jest.Mock).mockResolvedValue(existing);
      (mockPrisma.secretKey!.findUnique as jest.Mock).mockResolvedValue({
        id: "sk-primary-1",
      });

      await service.update("test-api-key", { value: "rotated-value" });

      // 走 $transaction 路径：tx.secretKey.update（不是 SecretKeysService.replaceKeyValue）
      // ★ 2026-05-12 (C方案): lastTestedAt 字段已删除并归一到 lastUsedAt.
      expect(mockPrisma.secretKey!.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "sk-primary-1" },
          data: expect.objectContaining({
            testStatus: null,
            lastUsedAt: null,
          }),
        }),
      );
    });

    it("update() adds 'primary' SecretKey via $transaction when none exists", async () => {
      const existing = makeSecret();
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(existing);
      (mockPrisma.secret!.update as jest.Mock).mockResolvedValue(existing);
      (mockPrisma.secretKey!.findUnique as jest.Mock).mockResolvedValue(null);

      await service.update("test-api-key", { value: "rotated-value" });

      // tx.secretKey.create 被调用（不是 SecretKeysService.addKey）
      expect(mockPrisma.secretKey!.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            label: "primary",
            secretId: existing.id,
          }),
        }),
      );
    });

    it("$transaction wraps create — secret + secretKey atomic", async () => {
      (mockPrisma.secret!.create as jest.Mock).mockResolvedValue(makeSecret());

      await service.create({
        name: "tx-key",
        displayName: "Tx",
        value: "v-1234567890",
        category: SecretCategory.AI_MODEL,
      });

      // $transaction 至少被调一次（create 走 tx）
      expect(
        (mockPrisma as unknown as { $transaction: jest.Mock }).$transaction,
      ).toHaveBeenCalled();
      expect(mockPrisma.secretAccessLog!.create).toHaveBeenCalled();
    });
  });

  // ==================== findAll ====================

  describe("findAll", () => {
    it("returns all active secrets", async () => {
      const secrets = [makeSecret(), makeSecret({ id: "secret-2" })];
      (mockPrisma.secret!.findMany as jest.Mock).mockResolvedValue(secrets);

      const result = await service.findAll();

      expect(result).toHaveLength(2);
      // 2026-05-27 BYOK：SecretsService 只列系统 Secret（userId: null），不泄露用户私有 BYOK Secret（D19）
      expect(mockPrisma.secret!.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null, userId: null },
        }),
      );
    });

    it("filters by category", async () => {
      (mockPrisma.secret!.findMany as jest.Mock).mockResolvedValue([]);

      await service.findAll(SecretCategory.AI_MODEL);

      expect(mockPrisma.secret!.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
            userId: null,
            category: SecretCategory.AI_MODEL,
          },
        }),
      );
    });
  });

  // ==================== update ====================

  describe("update", () => {
    it("throws NotFoundException when secret not found", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.update("nonexistent", { displayName: "New Name" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("creates a new version when value changes", async () => {
      const existing = makeSecret();
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(existing);
      (mockPrisma.secret!.update as jest.Mock).mockResolvedValue(existing);

      await service.update("test-api-key", { value: "new-value" });

      expect(mockPrisma.secretVersion!.create).toHaveBeenCalled();
    });

    it("does not create version when only metadata changes", async () => {
      const existing = makeSecret();
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(existing);
      (mockPrisma.secret!.update as jest.Mock).mockResolvedValue(existing);

      await service.update("test-api-key", { displayName: "New Name" });

      expect(mockPrisma.secretVersion!.create).not.toHaveBeenCalled();
    });
  });

  // ==================== delete ====================

  describe("delete", () => {
    it("soft deletes a secret without references", async () => {
      const existing = makeSecret();
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(existing);
      (mockPrisma.aIModel!.findMany as jest.Mock).mockResolvedValue([]); // no references
      (mockPrisma.secret!.update as jest.Mock).mockResolvedValue(existing);

      await service.delete("test-api-key");

      expect(mockPrisma.secret!.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deletedAt: expect.any(Date),
            isActive: false,
          }),
        }),
      );
    });

    it("throws when secret is referenced by AI models", async () => {
      const existing = makeSecret();
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(existing);
      (mockPrisma.aIModel!.findMany as jest.Mock).mockResolvedValue([
        { id: "model-1", displayName: "GPT-4" },
      ]);

      await expect(service.delete("test-api-key")).rejects.toThrow(
        "still referenced",
      );
    });
  });

  // ==================== exists ====================

  describe("exists", () => {
    it("returns true for active non-expired non-deleted secret", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue({
        isActive: true,
        deletedAt: null,
        expiresAt: null,
      });

      const result = await service.exists("active-key");

      expect(result).toBe(true);
    });

    it("returns false when secret is deleted", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue({
        isActive: true,
        deletedAt: new Date(),
        expiresAt: null,
      });

      const result = await service.exists("deleted-key");

      expect(result).toBe(false);
    });

    it("returns false when secret has expired", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue({
        isActive: true,
        deletedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });

      const result = await service.exists("expired-key");

      expect(result).toBe(false);
    });

    it("returns false when secret not found", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.exists("missing-key");

      expect(result).toBe(false);
    });
  });

  // ==================== getVersions ====================

  describe("getVersions", () => {
    it("throws NotFoundException when secret not found", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.getVersions("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("returns versions with isCurrent flag", async () => {
      const secret = makeSecret({ currentVersion: 2 });
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(secret);
      (mockPrisma.secretVersion!.findMany as jest.Mock).mockResolvedValue([
        {
          id: "ver-1",
          version: 1,
          checksum: "abc",
          createdBy: null,
          createdAt: new Date(),
          changeNote: null,
        },
        {
          id: "ver-2",
          version: 2,
          checksum: "def",
          createdBy: null,
          createdAt: new Date(),
          changeNote: null,
        },
      ]);

      const versions = await service.getVersions("test-api-key");

      expect(versions).toHaveLength(2);
      expect(versions.find((v) => v.version === 2)?.isCurrent).toBe(true);
      expect(versions.find((v) => v.version === 1)?.isCurrent).toBe(false);
    });
  });

  // ==================== getSecretNames ====================

  describe("getSecretNames", () => {
    it("returns list of active secret names", async () => {
      (mockPrisma.secret!.findMany as jest.Mock).mockResolvedValue([
        { name: "key-a" },
        { name: "key-b" },
      ]);

      const names = await service.getSecretNames();

      expect(names).toEqual(["key-a", "key-b"]);
    });

    it("filters by category", async () => {
      (mockPrisma.secret!.findMany as jest.Mock).mockResolvedValue([]);

      await service.getSecretNames(SecretCategory.SEARCH);

      expect(mockPrisma.secret!.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            category: SecretCategory.SEARCH,
          }),
        }),
      );
    });
  });

  // ==================== findByName ====================

  describe("findByName", () => {
    it("returns null when secret not found", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.findByName("nonexistent");

      expect(result).toBeNull();
    });

    it("returns null for soft-deleted secret", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(
        makeSecret({ deletedAt: new Date() }),
      );

      const result = await service.findByName("deleted-key");

      expect(result).toBeNull();
    });

    it("returns list item for active secret", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(
        makeSecret(),
      );

      const result = await service.findByName("test-api-key");

      expect(result).not.toBeNull();
      expect(result!.name).toBe("test-api-key");
    });
  });

  // ==================== getValueInternal ====================

  describe("getValueInternal", () => {
    it("returns null when secret not found", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.getValueInternal("nonexistent");

      expect(result).toBeNull();
    });

    it("returns null for inactive secret", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(
        makeSecret({ isActive: false }),
      );

      const result = await service.getValueInternal("inactive-key");

      expect(result).toBeNull();
    });

    it("returns null for soft-deleted secret", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(
        makeSecret({ deletedAt: new Date() }),
      );

      const result = await service.getValueInternal("deleted-key");

      expect(result).toBeNull();
    });

    it("returns null for expired secret", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(
        makeSecret({ expiresAt: new Date(Date.now() - 1000) }),
      );

      const result = await service.getValueInternal("expired-key");

      expect(result).toBeNull();
    });

    it("normalizes legacy SCREAMING_SNAKE_CASE names automatically", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(null);

      // TAVILY_API_KEY should be normalized to tavily-search-api-key
      await service.getValueInternal("TAVILY_API_KEY");

      expect(mockPrisma.secret!.findFirst).toHaveBeenCalledWith({
        where: { name: "tavily-search-api-key", userId: null },
      });
    });

    it("increments access count for internal calls", async () => {
      // Create a real encrypted value
      (mockPrisma.secret!.create as jest.Mock).mockResolvedValue(makeSecret());
      await service.create({
        name: "internal-key",
        displayName: "Internal",
        value: "internal-value",
        category: SecretCategory.AI_MODEL,
      });

      const createCall = (mockPrisma.secret!.create as jest.Mock).mock
        .calls[0][0];
      const realSecret = {
        ...makeSecret(),
        encryptedValue: createCall.data.encryptedValue,
        iv: createCall.data.iv,
        authTag: createCall.data.authTag,
        wrappedDek: createCall.data.wrappedDek,
        encVersion: createCall.data.encVersion,
        kekVersion: createCall.data.kekVersion,
      };

      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(realSecret);
      (mockPrisma.secret!.update as jest.Mock).mockResolvedValue(realSecret);

      await service.getValueInternal("internal-key");

      expect(mockPrisma.secret!.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            accessCount: { increment: 1 },
          }),
        }),
      );
    });
  });

  // ==================== getAccessLogs ====================

  describe("getAccessLogs", () => {
    it("returns access logs for existing secret", async () => {
      const secret = makeSecret();
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(secret);
      const fakeLogs = [
        { id: "log-1", action: SecretAction.VIEW, timestamp: new Date() },
      ];
      (mockPrisma.secretAccessLog!.findMany as jest.Mock).mockResolvedValue(
        fakeLogs,
      );

      const result = await service.getAccessLogs("test-api-key");

      expect(result).toHaveLength(1);
      expect(mockPrisma.secretAccessLog!.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([{ secretId: secret.id }]),
          }),
          take: 50,
        }),
      );
    });

    it("returns access logs with custom limit", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(
        makeSecret(),
      );
      (mockPrisma.secretAccessLog!.findMany as jest.Mock).mockResolvedValue([]);

      await service.getAccessLogs("test-api-key", 100);

      expect(mockPrisma.secretAccessLog!.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it("handles null secret by still querying by name", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.secretAccessLog!.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getAccessLogs("unknown-key");

      expect(result).toEqual([]);
      // Should still query by secretName
      expect(mockPrisma.secretAccessLog!.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [{ secretId: undefined }, { secretName: "unknown-key" }],
          },
        }),
      );
    });
  });

  // ==================== getReferences ====================

  describe("getReferences", () => {
    it("returns empty array when no AI models reference the secret", async () => {
      (mockPrisma.aIModel!.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getReferences("my-api-key");

      expect(result).toEqual([]);
    });

    it("returns reference for each AI model using the secret name", async () => {
      (mockPrisma.aIModel!.findMany as jest.Mock).mockResolvedValue([
        { id: "model-1", displayName: "GPT-4" },
        { id: "model-2", displayName: "Claude" },
      ]);

      const result = await service.getReferences("openai-api-key");

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        type: "ai_model",
        id: "model-1",
        name: "GPT-4",
      });
      expect(result[1]).toEqual({
        type: "ai_model",
        id: "model-2",
        name: "Claude",
      });
    });
  });

  // ==================== getVersionValue ====================

  describe("getVersionValue", () => {
    it("throws NotFoundException when secret not found", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.getVersionValue("missing", 1)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("returns current version value directly from secret", async () => {
      // Create real encrypted data
      (mockPrisma.secret!.create as jest.Mock).mockResolvedValue(makeSecret());
      await service.create({
        name: "vv-key",
        displayName: "VV Key",
        value: "my-value",
        category: SecretCategory.AI_MODEL,
      });

      const createCall = (mockPrisma.secret!.create as jest.Mock).mock
        .calls[0][0];
      const secret = {
        ...makeSecret({ currentVersion: 1 }),
        encryptedValue: createCall.data.encryptedValue,
        iv: createCall.data.iv,
        authTag: createCall.data.authTag,
        wrappedDek: createCall.data.wrappedDek,
        encVersion: createCall.data.encVersion,
        kekVersion: createCall.data.kekVersion,
      };

      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(secret);
      (mockPrisma.secret!.update as jest.Mock).mockResolvedValue(secret);

      const value = await service.getVersionValue("vv-key", 1);

      expect(value).toBe("my-value");
    });

    it("throws NotFoundException for non-existent version", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(
        makeSecret({ currentVersion: 1 }),
      );
      (mockPrisma.secretVersion!.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(service.getVersionValue("test-api-key", 99)).rejects.toThrow(
        "Version 99 not found",
      );
    });

    it("fetches value from version history for non-current version", async () => {
      // Create real encrypted data for a "version 0" scenario
      (mockPrisma.secret!.create as jest.Mock).mockResolvedValue(makeSecret());
      await service.create({
        name: "hist-key",
        displayName: "Hist Key",
        value: "old-value",
        category: SecretCategory.AI_MODEL,
      });
      const createCall = (mockPrisma.secret!.create as jest.Mock).mock
        .calls[0][0];

      const secret = makeSecret({ currentVersion: 3 });
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(secret);
      (mockPrisma.secretVersion!.findUnique as jest.Mock).mockResolvedValue({
        id: "ver-2",
        version: 2,
        encryptedValue: createCall.data.encryptedValue,
        iv: createCall.data.iv,
        authTag: createCall.data.authTag,
        wrappedDek: createCall.data.wrappedDek,
        encVersion: createCall.data.encVersion,
        kekVersion: createCall.data.kekVersion,
      });

      const value = await service.getVersionValue("hist-key", 2);

      expect(value).toBe("old-value");
    });
  });

  // ==================== rollback ====================

  describe("rollback", () => {
    it("throws NotFoundException when secret not found", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.rollback("missing", 1)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws BadRequestException when rolling back to current version", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(
        makeSecret({ currentVersion: 2 }),
      );

      await expect(service.rollback("test-api-key", 2)).rejects.toThrow(
        "Cannot rollback to current version",
      );
    });

    it("throws NotFoundException when target version not found", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(
        makeSecret({ currentVersion: 3 }),
      );
      (mockPrisma.secretVersion!.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(service.rollback("test-api-key", 1)).rejects.toThrow(
        "Version 1 not found",
      );
    });

    it("creates a new version and updates secret on successful rollback", async () => {
      // Setup real encryption for the target version
      (mockPrisma.secret!.create as jest.Mock).mockResolvedValue(makeSecret());
      await service.create({
        name: "rb-key",
        displayName: "RB Key",
        value: "rollback-value",
        category: SecretCategory.AI_MODEL,
      });
      const createCall = (mockPrisma.secret!.create as jest.Mock).mock
        .calls[0][0];

      const secret = makeSecret({ currentVersion: 3 });
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(secret);
      (mockPrisma.secretVersion!.findUnique as jest.Mock).mockResolvedValue({
        id: "ver-1",
        version: 1,
        encryptedValue: createCall.data.encryptedValue,
        iv: createCall.data.iv,
        authTag: createCall.data.authTag,
        wrappedDek: createCall.data.wrappedDek,
        encVersion: createCall.data.encVersion,
        kekVersion: createCall.data.kekVersion,
      });
      (mockPrisma.secretVersion!.create as jest.Mock).mockResolvedValue({
        id: "ver-4",
      });
      (mockPrisma.secret!.update as jest.Mock).mockResolvedValue(
        makeSecret({ currentVersion: 4 }),
      );

      const result = await service.rollback("test-api-key", 1, {
        userId: "admin",
      });

      expect(result).toBeDefined();
      expect(mockPrisma.secretVersion!.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            version: 4,
            changeNote: "Rollback from version 1",
          }),
        }),
      );
      expect(mockPrisma.secret!.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currentVersion: 4,
          }),
        }),
      );
    });
  });

  // ==================== createInitialVersion ====================

  describe("createInitialVersion", () => {
    it("throws NotFoundException when secret not found", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.createInitialVersion("missing")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("does nothing if version 1 already exists", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(
        makeSecret(),
      );
      (mockPrisma.secretVersion!.findUnique as jest.Mock).mockResolvedValue({
        id: "ver-1",
        version: 1,
      });

      await service.createInitialVersion("test-api-key");

      expect(mockPrisma.secretVersion!.create).not.toHaveBeenCalled();
    });

    it("creates initial version for secret without version history", async () => {
      // Need a secret with real encryption
      (mockPrisma.secret!.create as jest.Mock).mockResolvedValue(makeSecret());
      await service.create({
        name: "init-key",
        displayName: "Init Key",
        value: "initial-value",
        category: SecretCategory.AI_MODEL,
      });
      const createCall = (mockPrisma.secret!.create as jest.Mock).mock
        .calls[0][0];

      const secret = makeSecret({
        encryptedValue: createCall.data.encryptedValue,
        iv: createCall.data.iv,
        authTag: createCall.data.authTag,
        wrappedDek: createCall.data.wrappedDek,
        encVersion: createCall.data.encVersion,
        kekVersion: createCall.data.kekVersion,
        currentVersion: null,
      });
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(secret);
      // No existing version
      (mockPrisma.secretVersion!.findUnique as jest.Mock).mockResolvedValue(
        null,
      );
      (mockPrisma.secretVersion!.create as jest.Mock).mockResolvedValue({
        id: "ver-1",
      });
      (mockPrisma.secret!.update as jest.Mock).mockResolvedValue(secret);

      await service.createInitialVersion("init-key");

      expect(mockPrisma.secretVersion!.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            version: 1,
            changeNote: "Initial version",
          }),
        }),
      );
    });
  });

  // ==================== initializeAllVersions ====================

  describe("initializeAllVersions", () => {
    it("processes all non-deleted secrets", async () => {
      const secrets = [
        makeSecret(),
        makeSecret({ id: "secret-2", name: "key-2" }),
      ];
      (mockPrisma.secret!.findMany as jest.Mock).mockResolvedValue(secrets);
      // Both secrets already have version 1
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(
        makeSecret(),
      );
      (mockPrisma.secretVersion!.findUnique as jest.Mock).mockResolvedValue({
        id: "ver-1",
        version: 1,
      });

      const result = await service.initializeAllVersions();

      expect(result.processed).toBe(2);
      expect(result.skipped).toBe(0);
    });

    it("counts skipped when createInitialVersion throws", async () => {
      const secrets = [makeSecret()];
      (mockPrisma.secret!.findMany as jest.Mock).mockResolvedValue(secrets);
      // findUnique returns null (throws NotFoundException path)
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.initializeAllVersions();

      // createInitialVersion throws -> counted as skipped
      expect(result.skipped).toBe(1);
      expect(result.processed).toBe(0);
    });
  });

  // ==================== getExpectedSecrets ====================

  describe("getExpectedSecrets", () => {
    it("marks secrets as configured when they exist in DB and missing otherwise", async () => {
      (mockPrisma.secret!.findMany as jest.Mock).mockResolvedValue([
        {
          id: "s1",
          name: "tavily-search-api-key",
          displayName: "Tavily Search API Key",
          category: "SEARCH",
          provider: "Tavily",
        },
        {
          id: "s2",
          name: "perplexity-api-key",
          displayName: "Perplexity API Key",
          category: "SEARCH",
          provider: "Perplexity",
        },
      ]);

      const result = await service.getExpectedSecrets();

      const tavily = result.items.find(
        (i) => i.name === "tavily-search-api-key",
      );
      const perplexity = result.items.find(
        (i) => i.name === "perplexity-api-key",
      );
      const serper = result.items.find((i) => i.name === "serper-api-key");

      expect(tavily?.status).toBe("configured");
      expect(tavily?.secretId).toBe("s1");
      expect(perplexity?.status).toBe("configured");
      expect(perplexity?.secretId).toBe("s2");
      expect(serper?.status).toBe("missing");
      expect(serper?.secretId).toBeUndefined();

      expect(result.summary.configured).toBe(2);
      expect(result.summary.missing).toBe(result.summary.total - 2);
      expect(result.summary.total).toBe(result.items.length);
      expect(result.orphans).toEqual([]);
    });

    it("puts non-LLM non-preset unknown DB secrets into customSecrets (not orphans)", async () => {
      (mockPrisma.secret!.findMany as jest.Mock).mockResolvedValue([
        {
          id: "s1",
          name: "tavily-search-api-key",
          displayName: "Tavily Search API Key",
          category: "SEARCH",
          provider: "Tavily",
        },
        {
          id: "s99",
          name: "legacy-foo-key",
          displayName: "Legacy Foo Key",
          category: "OTHER",
          provider: null,
        },
      ]);

      const result = await service.getExpectedSecrets();

      // D class orphans must be empty — legacy-foo-key is C class (custom)
      expect(result.orphans).toHaveLength(0);
      expect(result.customSecrets).toHaveLength(1);
      expect(result.customSecrets[0]).toMatchObject({
        name: "legacy-foo-key",
        secretId: "s99",
      });
    });

    it("returns relatedToolIds for each item", async () => {
      (mockPrisma.secret!.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getExpectedSecrets();

      const tavily = result.items.find(
        (i) => i.name === "tavily-search-api-key",
      );
      expect(tavily?.relatedToolIds).toContain("tavily");
    });

    it("returns empty orphans when DB only has expected secrets", async () => {
      (mockPrisma.secret!.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getExpectedSecrets();

      expect(result.orphans).toEqual([]);
      expect(result.summary.configured).toBe(0);
      expect(result.summary.missing).toBe(result.summary.total);
    });

    // ---- New 4-block classification cases ----

    it("routes openai-api-key and claude-api-key into llmProviders (B class)", async () => {
      (mockPrisma.secret!.findMany as jest.Mock).mockResolvedValue([
        {
          id: "llm1",
          name: "openai-api-key",
          displayName: "OpenAI API Key",
          category: "AI_MODEL",
          provider: "openai",
        },
        {
          id: "llm2",
          name: "claude-api-key",
          displayName: "Claude API Key",
          category: "AI_MODEL",
          provider: "anthropic",
        },
      ]);

      const result = await service.getExpectedSecrets();

      expect(result.llmProviders).toHaveLength(2);
      expect(result.llmProviders.map((p) => p.name)).toContain(
        "openai-api-key",
      );
      expect(result.llmProviders.map((p) => p.name)).toContain(
        "claude-api-key",
      );
      expect(result.customSecrets).toHaveLength(0);
      expect(result.orphans).toHaveLength(0);
    });

    it("routes internal-rag-token into customSecrets (C class), not orphans", async () => {
      (mockPrisma.secret!.findMany as jest.Mock).mockResolvedValue([
        {
          id: "c1",
          name: "internal-rag-token",
          displayName: "Internal RAG Token",
          category: "OTHER",
          provider: null,
        },
      ]);

      const result = await service.getExpectedSecrets();

      expect(result.customSecrets).toHaveLength(1);
      expect(result.customSecrets[0].name).toBe("internal-rag-token");
      expect(result.llmProviders).toHaveLength(0);
      expect(result.orphans).toHaveLength(0);
    });

    it("routes tavily-search-api-key into presetTools with status=configured", async () => {
      (mockPrisma.secret!.findMany as jest.Mock).mockResolvedValue([
        {
          id: "pt1",
          name: "tavily-search-api-key",
          displayName: "Tavily Search API Key",
          category: "SEARCH",
          provider: "Tavily",
        },
      ]);

      const result = await service.getExpectedSecrets();

      const preset = result.presetTools.items.find(
        (i) => i.name === "tavily-search-api-key",
      );
      expect(preset).toBeDefined();
      expect(preset?.status).toBe("configured");
      expect(preset?.secretId).toBe("pt1");
      // Must NOT also appear in llmProviders or customSecrets
      expect(result.llmProviders.map((p) => p.name)).not.toContain(
        "tavily-search-api-key",
      );
      expect(result.customSecrets.map((c) => c.name)).not.toContain(
        "tavily-search-api-key",
      );
    });

    it("returns all 4 blocks empty (except presetTools missing items) when DB is empty", async () => {
      (mockPrisma.secret!.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getExpectedSecrets();

      expect(result.llmProviders).toHaveLength(0);
      expect(result.customSecrets).toHaveLength(0);
      expect(result.orphans).toHaveLength(0);
      expect(result.presetTools.summary.configured).toBe(0);
      expect(result.presetTools.summary.missing).toBeGreaterThan(0);
      // All preset items are missing
      expect(
        result.presetTools.items.every((i) => i.status === "missing"),
      ).toBe(true);
    });
  });

  // ==================== classifySecret (unit) ====================

  describe("classifySecret (unit)", () => {
    it("classifies openai-api-key as llm-provider", () => {
      expect(classifySecret("openai-api-key")).toBe("llm-provider");
    });

    it("classifies claude-prod-key as llm-provider", () => {
      expect(classifySecret("claude-prod-key")).toBe("llm-provider");
    });

    it("classifies some-random-key as custom", () => {
      expect(classifySecret("some-random-key")).toBe("custom");
    });

    it("classifies internal-rag-token as custom", () => {
      expect(classifySecret("internal-rag-token")).toBe("custom");
    });

    it("classifies tavily-search-api-key as preset-tool", () => {
      expect(classifySecret("tavily-search-api-key")).toBe("preset-tool");
    });

    it("classifies serper-api-key as preset-tool", () => {
      expect(classifySecret("serper-api-key")).toBe("preset-tool");
    });

    it("classifies deepseek-api-key as llm-provider", () => {
      expect(classifySecret("deepseek-api-key")).toBe("llm-provider");
    });

    it("classifies groq-inference-key as llm-provider", () => {
      expect(classifySecret("groq-inference-key")).toBe("llm-provider");
    });
  });

  // ==================== migrateExistingKeys ====================

  describe("migrateExistingKeys", () => {
    it("skips AI models with null apiKey", async () => {
      (mockPrisma.aIModel!.findMany as jest.Mock).mockResolvedValue([
        {
          id: "m1",
          name: "gpt4",
          displayName: "GPT-4",
          provider: "openai",
          apiKey: null,
        },
      ]);
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.systemSetting!.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.migrateExistingKeys();

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it("skips already-existing secrets", async () => {
      (mockPrisma.aIModel!.findMany as jest.Mock).mockResolvedValue([
        {
          id: "m1",
          name: "gpt4",
          displayName: "GPT-4",
          provider: "openai",
          apiKey: "some-plain-key",
        },
      ]);
      // secret already exists
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(
        makeSecret(),
      );
      (mockPrisma.systemSetting!.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.migrateExistingKeys();

      expect(result.skipped).toBeGreaterThan(0);
      expect(result.imported).toBe(0);
    });

    it("records error when legacy decryption fails", async () => {
      // Legacy format: "iv:encrypted" - provide something that will fail decryption
      (mockPrisma.aIModel!.findMany as jest.Mock).mockResolvedValue([
        {
          id: "m1",
          name: "gpt4",
          displayName: "GPT-4",
          provider: "openai",
          apiKey: "badhex:badhex", // two-part format triggers decryptLegacy
        },
      ]);
      // secret doesn't exist yet
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.systemSetting!.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.migrateExistingKeys();

      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("handles errors in individual model migration gracefully", async () => {
      (mockPrisma.aIModel!.findMany as jest.Mock).mockResolvedValue([
        {
          id: "m1",
          name: "gpt4",
          displayName: "GPT-4",
          provider: "openai",
          apiKey: "plain-key-value",
        },
      ]);
      // findUnique returns null (no existing), create throws
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.secret!.create as jest.Mock).mockRejectedValue(
        new Error("DB error"),
      );
      (mockPrisma.systemSetting!.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.migrateExistingKeys();

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("DB error");
    });
  });

  // ==================== update (additional branches) ====================

  describe("update (additional branches)", () => {
    it("skips version creation when value is empty string", async () => {
      const existing = makeSecret();
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(existing);
      (mockPrisma.secret!.update as jest.Mock).mockResolvedValue(existing);

      await service.update("test-api-key", { value: "" });

      expect(mockPrisma.secretVersion!.create).not.toHaveBeenCalled();
    });

    it("updates metadata fields without value change", async () => {
      const existing = makeSecret();
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(existing);
      (mockPrisma.secret!.update as jest.Mock).mockResolvedValue(existing);

      await service.update("test-api-key", {
        displayName: "Updated Name",
        description: "New desc",
        provider: "anthropic",
        isActive: false,
        category: SecretCategory.AI_MODEL,
      });

      const updateCall = (mockPrisma.secret!.update as jest.Mock).mock
        .calls[0][0];
      expect(updateCall.data.displayName).toBe("Updated Name");
      expect(updateCall.data.isActive).toBe(false);
    });

    it("throws NotFoundException for soft-deleted secret on update", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(
        makeSecret({ deletedAt: new Date() }),
      );

      await expect(
        service.update("deleted-key", { displayName: "X" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ==================== delete (additional branches) ====================

  describe("delete (additional branches)", () => {
    it("throws NotFoundException for soft-deleted secret", async () => {
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(
        makeSecret({ deletedAt: new Date() }),
      );

      await expect(service.delete("deleted-key")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("logs access with userEmail when context provided", async () => {
      const existing = makeSecret();
      (mockPrisma.secret!.findFirst as jest.Mock).mockResolvedValue(existing);
      (mockPrisma.aIModel!.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.secret!.update as jest.Mock).mockResolvedValue(existing);

      await service.delete("test-api-key", {
        userId: "u1",
        userEmail: "admin@test.com",
      });

      expect(mockPrisma.secretAccessLog!.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: SecretAction.DELETE,
          }),
        }),
      );
    });
  });
});
