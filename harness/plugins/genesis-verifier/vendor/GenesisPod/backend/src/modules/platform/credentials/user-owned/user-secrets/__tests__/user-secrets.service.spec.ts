import { Test } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { SecretCategory } from "@prisma/client";
import { UserSecretsService } from "../user-secrets.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { EncryptionService } from "@/modules/platform/credentials/storage/encryption/encryption.service";
import { UserApiKeysService } from "../../user-api-keys/user-api-keys.service";
import { SecretsService } from "@/modules/platform/credentials/storage/secrets/secrets.service";

// 2026-05-29 W5：user_credentials 过渡表已退役，工具/其它类统一落 user-scoped secrets。

describe("UserSecretsService", () => {
  let service: UserSecretsService;
  let prisma: {
    secret: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    userApiKey: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
  };
  let encryption: {
    encryptForUser: jest.Mock;
    decryptForUser: jest.Mock;
    decryptAny: jest.Mock;
    createKeyHint: jest.Mock;
    hashValue: jest.Mock;
  };
  let userApiKeys: { saveKey: jest.Mock; deleteKey: jest.Mock };
  let secrets: {
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    getByIdForUser: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      secret: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
      },
      userApiKey: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
    };
    encryption = {
      encryptForUser: jest
        .fn()
        .mockReturnValue({ encryptedValue: "enc", iv: "iv" }),
      decryptForUser: jest.fn().mockReturnValue("sk-plain-1234"),
      decryptAny: jest.fn().mockResolvedValue("sk-plain-1234"),
      createKeyHint: jest.fn().mockReturnValue("sk-...1234"),
      hashValue: jest.fn().mockReturnValue("abcd1234ef"),
    };
    userApiKeys = {
      saveKey: jest.fn().mockResolvedValue({ success: true, mode: "personal" }),
      deleteKey: jest.fn().mockResolvedValue({ success: true }),
    };
    // 工具类收敛到 user-scoped secrets，create/update/delete 走 SecretsService
    secrets = {
      create: jest.fn().mockResolvedValue({
        id: "sec-new",
        name: "tavily",
        displayName: "Tavily",
        category: SecretCategory.SEARCH,
        provider: "tavily",
        maskedValue: "tv-...1234",
        isActive: true,
        accessCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue(undefined),
      getByIdForUser: jest.fn().mockResolvedValue(null),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UserSecretsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EncryptionService, useValue: encryption },
        { provide: UserApiKeysService, useValue: userApiKeys },
        { provide: SecretsService, useValue: secrets },
      ],
    }).compile();
    service = moduleRef.get(UserSecretsService);
  });

  describe("create — 铁律 1：按 category 分流", () => {
    it("AI_MODEL 写 user_api_keys（不落工具表）", async () => {
      prisma.userApiKey.findUnique.mockResolvedValue({
        id: "uak-1",
        provider: "openai",
        keyHint: "sk-...1234",
        isActive: true,
        usageCount: 0,
        testStatus: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await service.create("user-1", {
        name: "openai",
        category: SecretCategory.AI_MODEL,
        provider: "openai",
        value: "sk-plain-1234",
      });

      expect(userApiKeys.saveKey).toHaveBeenCalledWith(
        "user-1",
        "openai",
        "sk-plain-1234",
        "personal",
      );
      expect(secrets.create).not.toHaveBeenCalled();
      expect(res.source).toBe("llm");
    });

    it("AI_MODEL 缺 provider → BadRequest", async () => {
      await expect(
        service.create("user-1", {
          name: "x",
          category: SecretCategory.AI_MODEL,
          value: "v",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("SEARCH 类收敛到 user-scoped secrets（含 primary key）", async () => {
      secrets.create.mockResolvedValue({
        id: "sec-new",
        name: "tavily-search-api-key",
        displayName: "Tavily",
        category: SecretCategory.SEARCH,
        provider: "tavily",
        maskedValue: "tv-...1234",
        isActive: true,
        accessCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await service.create("user-1", {
        name: "tavily-search-api-key",
        category: SecretCategory.SEARCH,
        provider: "tavily",
        value: "tvly-xyz",
      });

      // 走 SecretsService.create（user 作用域 ownerUserId）
      expect(secrets.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "tavily-search-api-key",
          value: "tvly-xyz",
        }),
        { userId: "user-1" },
        "user-1",
      );
      expect(userApiKeys.saveKey).not.toHaveBeenCalled();
      expect(res.source).toBe("secret");
      expect(res.id).toBe("sec-new");
    });
  });

  describe("list — UNION user_api_keys + user-scoped secrets", () => {
    it("聚合 LLM key 与工具 secrets 两来源", async () => {
      prisma.userApiKey.findMany.mockResolvedValue([
        {
          id: "uak-1",
          provider: "openai",
          label: "default",
          keyHint: "sk-...1234",
          isActive: true,
          usageCount: 0,
          testStatus: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      prisma.secret.findMany.mockResolvedValue([
        {
          id: "sec-1",
          name: "tavily",
          displayName: "Tavily",
          category: SecretCategory.SEARCH,
          provider: "tavily",
          keyHint: "sk-...bbbb",
          isActive: true,
          accessCount: 0,
          encryptedValue: "e",
          iv: "i",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const res = await service.list("user-1");

      expect(res).toHaveLength(2);
      expect(res.find((r) => r.source === "llm")?.provider).toBe("openai");
      expect(res.find((r) => r.source === "secret")?.id).toBe("sec-1");
    });

    it("maskedValue 用非泄露哈希脱敏（••••hash••••），不再回传明文头尾的 keyHint", async () => {
      prisma.userApiKey.findMany.mockResolvedValue([
        {
          id: "uak-1",
          provider: "openai",
          label: "default",
          keyHint: "sk-...1234", // 旧泄露式 hint：不应出现在 maskedValue
          encryptedValue: "enc-abcdefgh",
          isActive: true,
          usageCount: 0,
          testStatus: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const res = await service.list("user-1");
      const llm = res.find((r) => r.source === "llm");
      expect(llm?.maskedValue).toBe("••••abcd••••");
      expect(llm?.maskedValue).not.toContain("sk-...1234");
    });
  });

  describe("getValue — 揭示本人明文（owner 隔离 + 防 IDOR）", () => {
    it("缺 userId 抛 BadRequest", async () => {
      await expect(service.getValue("", "llm", "uak-1")).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("llm source: 命中本人 key → decryptAny 返回明文", async () => {
      const key = { id: "uak-1", userId: "user-1", encryptedValue: "enc" };
      prisma.userApiKey.findFirst.mockResolvedValue(key);
      const val = await service.getValue("user-1", "llm", "uak-1");
      expect(prisma.userApiKey.findFirst).toHaveBeenCalledWith({
        where: { id: "uak-1", userId: "user-1" },
      });
      expect(encryption.decryptAny).toHaveBeenCalledWith(key);
      expect(val).toBe("sk-plain-1234");
    });

    it("secret source: 命中本人 secret → decryptAny(secret,{userId}) 返回明文", async () => {
      const row = { id: "sec-1", userId: "user-1", encryptedValue: "enc" };
      prisma.secret.findFirst.mockResolvedValue(row);
      const val = await service.getValue("user-1", "secret", "sec-1");
      expect(encryption.decryptAny).toHaveBeenCalledWith(row, {
        userId: "user-1",
      });
      expect(val).toBe("sk-plain-1234");
    });

    it("非本人 / 不存在 → NotFound（不泄露他人 Key 存在性）", async () => {
      prisma.userApiKey.findFirst.mockResolvedValue(null);
      await expect(
        service.getValue("user-1", "llm", "uak-x"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("getUserSecretValue — owner 隔离（D6/安全关键-2）", () => {
    it("缺 userId 抛 BadRequest", async () => {
      await expect(
        service.getUserSecretValue("tavily-search-api-key", ""),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("读 user-scoped secrets 行（decryptAny 按 encVersion 分派，兼容 envelope v2 与 legacy HKDF）", async () => {
      const row = { encryptedValue: "enc", iv: "iv", expiresAt: null };
      prisma.secret.findFirst.mockResolvedValue(row);
      const val = await service.getUserSecretValue("tavily", "user-1");
      // 用 decryptAny（不写死 decryptForUser），envelope v2 行才能解开
      expect(encryption.decryptAny).toHaveBeenCalledWith(row, {
        userId: "user-1",
      });
      expect(val).toBe("sk-plain-1234");
    });

    it("未命中返回 null", async () => {
      prisma.secret.findFirst.mockResolvedValue(null);
      const val = await service.getUserSecretValue("tavily", "user-2");
      expect(val).toBeNull();
    });
  });

  describe("testKey — C8 Key 测试", () => {
    it("llm source: Key 存在 → success=true", async () => {
      prisma.userApiKey.findFirst.mockResolvedValue({
        id: "uak-1",
        provider: "openai",
        keyHint: "sk-...1234",
      });
      const res = await service.testKey("user-1", "llm", "uak-1");
      expect(res.success).toBe(true);
      expect(res.testedAt).toBeTruthy();
    });

    it("secret source: Key 存在且启用 → success=true", async () => {
      prisma.secret.findFirst.mockResolvedValue({
        id: "sec-1",
        name: "tavily-key",
        isActive: true,
      });
      const res = await service.testKey("user-1", "secret", "sec-1");
      expect(res.success).toBe(true);
    });

    it("secret source: Key 已禁用 → success=false", async () => {
      prisma.secret.findFirst.mockResolvedValue({
        id: "sec-1",
        name: "tavily-key",
        isActive: false,
      });
      const res = await service.testKey("user-1", "secret", "sec-1");
      expect(res.success).toBe(false);
      expect(res.message).toContain("禁用");
    });
  });

  describe("remove — owner 校验防 IDOR", () => {
    it("secret 不属于该用户 → NotFound", async () => {
      secrets.getByIdForUser.mockResolvedValue(null);
      await expect(
        service.remove("user-1", "secret", "sec-of-other-user"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("user-scoped secret 属于该用户 → 走 SecretsService.delete（软删+级联禁用子key）", async () => {
      secrets.getByIdForUser.mockResolvedValue({
        id: "sec-1",
        name: "tavily-search-api-key",
      });
      await service.remove("user-1", "secret", "sec-1");
      expect(secrets.delete).toHaveBeenCalledWith(
        "tavily-search-api-key",
        { userId: "user-1" },
        "user-1",
      );
    });
  });
});
