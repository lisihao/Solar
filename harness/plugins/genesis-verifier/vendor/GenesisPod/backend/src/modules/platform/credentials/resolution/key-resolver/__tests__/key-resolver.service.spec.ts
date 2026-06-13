import { Test, TestingModule } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { KeyResolverService } from "../key-resolver.service";
import { KeyAssignmentsService } from "../../../governance/key-assignments/key-assignments.service";
import { UserApiKeysService } from "../../../user-owned/user-api-keys/user-api-keys.service";
import { SecretsService } from "../../../../../platform/credentials/storage/secrets/secrets.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import {
  NoAvailableKeyError,
  QuotaExceededError,
} from "../key-resolver.errors";

describe("KeyResolverService", () => {
  let service: KeyResolverService;
  let prisma: any;
  let userApiKeys: jest.Mocked<Partial<UserApiKeysService>>;
  let assignments: jest.Mocked<Partial<KeyAssignmentsService>>;
  let secrets: jest.Mocked<Partial<SecretsService>>;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ role: UserRole.USER }),
      },
    };
    userApiKeys = {
      getPersonalKey: jest.fn().mockResolvedValue(null),
      getPersonalKeyById: jest.fn().mockResolvedValue(null),
      getAvailableProviders: jest.fn().mockResolvedValue([]),
    };
    assignments = {
      resolveActive: jest.fn().mockResolvedValue(null),
      getAvailableProviders: jest.fn().mockResolvedValue([]),
      incrementSpend: jest.fn().mockResolvedValue(undefined),
    };
    secrets = {
      getValueInternal: jest.fn().mockResolvedValue(null),
      listAvailableProviders: jest.fn().mockResolvedValue([]),
      findByProviderAlias: jest.fn().mockResolvedValue(null),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KeyResolverService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserApiKeysService, useValue: userApiKeys },
        { provide: KeyAssignmentsService, useValue: assignments },
        { provide: SecretsService, useValue: secrets },
      ],
    }).compile();
    service = module.get(KeyResolverService);
  });

  describe("resolveKey", () => {
    it("rejects missing userId", async () => {
      await expect(service.resolveKey("", "openai")).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("rejects unknown user", async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.resolveKey("ghost", "openai")).rejects.toThrow(
        UnauthorizedException,
      );
    });

    // ★ 2026-05-05 严格 BYOK：ADMIN 不再 fallback SYSTEM。所有 ADMIN spec 改
    //   验证"PERSONAL/ASSIGNED 都无时也抛 NoAvailableKeyError"（与 USER 一致）。
    describe("ADMIN（严格 BYOK，与 USER 行为一致）", () => {
      beforeEach(() => {
        prisma.user.findUnique.mockResolvedValue({ role: UserRole.ADMIN });
      });

      it("returns PERSONAL when ADMIN has BYOK Personal Key", async () => {
        (userApiKeys.getPersonalKey as jest.Mock).mockResolvedValue({
          apiKey: "admin-byok-key",
          apiEndpoint: null,
          preferredModelId: null,
        });
        const r = await service.resolveKey("admin", "openai");
        expect(r.source).toBe("PERSONAL");
        expect(r.apiKey).toBe("admin-byok-key");
      });

      it("throws NoAvailableKeyError when ADMIN has no BYOK (no SYSTEM fallback)", async () => {
        (userApiKeys.getPersonalKey as jest.Mock).mockResolvedValue(null);
        (assignments.resolveActive as jest.Mock).mockResolvedValue(null);
        await expect(service.resolveKey("admin", "openai")).rejects.toThrow(
          NoAvailableKeyError,
        );
      });

      it("falls through to ASSIGNED when ADMIN has no Personal", async () => {
        (userApiKeys.getPersonalKey as jest.Mock).mockResolvedValue(null);
        (assignments.resolveActive as jest.Mock).mockResolvedValue({
          assignmentId: "a-admin",
          keyId: "k-admin",
          apiKey: "admin-assigned",
          apiEndpoint: null,
          userQuotaCents: 500,
          userSpendCents: 0,
        });
        const r = await service.resolveKey("admin", "openai");
        expect(r.source).toBe("ASSIGNED");
      });
    });

    // ★ 2026-05-28 BYOK：UserModelConfig.apiKeyId honoring（preferredKeyId）
    describe("preferredKeyId（用户为模型选定的具体 Key）", () => {
      it("uses the specific key when preferredKeyId resolves", async () => {
        (userApiKeys.getPersonalKeyById as jest.Mock).mockResolvedValueOnce({
          apiKey: "sk-specific",
          apiEndpoint: "https://ep",
          label: "prod",
          provider: "openai",
          preferredModelId: null,
        });
        const r = await service.resolveKey("u", "openai", {
          preferredKeyId: "uak-123",
        });
        expect(r.source).toBe("PERSONAL");
        expect(r.apiKey).toBe("sk-specific");
        expect(r.label).toBe("prod");
        // 命中具体 key 时不再走 provider 级默认挑选
        expect(userApiKeys.getPersonalKey).not.toHaveBeenCalled();
      });

      it("falls back to provider-level personal key when preferredKeyId not resolvable", async () => {
        (userApiKeys.getPersonalKeyById as jest.Mock).mockResolvedValueOnce(
          null,
        );
        (userApiKeys.getPersonalKey as jest.Mock).mockResolvedValueOnce({
          apiKey: "sk-fallback",
          apiEndpoint: null,
          label: "default",
        });
        const r = await service.resolveKey("u", "openai", {
          preferredKeyId: "deleted-key",
        });
        expect(r.source).toBe("PERSONAL");
        expect(r.apiKey).toBe("sk-fallback");
        expect(userApiKeys.getPersonalKey).toHaveBeenCalled();
      });
    });

    describe("USER", () => {
      it("returns PERSONAL when user has Personal Key", async () => {
        (userApiKeys.getPersonalKey as jest.Mock).mockResolvedValueOnce({
          apiKey: "sk-personal",
          apiEndpoint: null,
        });
        const r = await service.resolveKey("u", "openai");
        expect(r.source).toBe("PERSONAL");
        expect(r.apiKey).toBe("sk-personal");
        expect(assignments.resolveActive).not.toHaveBeenCalled();
      });

      it("falls through to Assignment when no Personal Key", async () => {
        (assignments.resolveActive as jest.Mock).mockResolvedValueOnce({
          assignmentId: "a-1",
          keyId: "k-1",
          apiKey: "sk-assigned",
          apiEndpoint: null,
          userQuotaCents: 500,
          userSpendCents: 0,
        });
        const r = await service.resolveKey("u", "openai");
        expect(r.source).toBe("ASSIGNED");
        expect(r.assignmentId).toBe("a-1");
      });

      it("propagates QuotaExceededError from assignment resolver", async () => {
        (assignments.resolveActive as jest.Mock).mockRejectedValueOnce(
          new QuotaExceededError("openai", "ASSIGNED"),
        );
        await expect(service.resolveKey("u", "openai")).rejects.toThrow(
          QuotaExceededError,
        );
      });

      it("throws NoAvailableKeyError when neither personal nor assignment exist", async () => {
        await expect(service.resolveKey("u", "openai")).rejects.toThrow(
          NoAvailableKeyError,
        );
      });

      it("normalizes provider casing", async () => {
        (userApiKeys.getPersonalKey as jest.Mock).mockImplementation(
          async (_u, p) => (p === "openai" ? { apiKey: "k" } : null),
        );
        const r = await service.resolveKey("u", "OpenAI");
        expect(r.provider).toBe("openai");
      });
    });
  });

  describe("getAvailableProviders", () => {
    it("returns empty for unknown user", async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      expect(await service.getAvailableProviders("ghost")).toEqual([]);
    });

    it("[严格 BYOK] ADMIN 不再额外加 SYSTEM provider — 与 USER 行为一致", async () => {
      prisma.user.findUnique.mockResolvedValue({ role: UserRole.ADMIN });
      (userApiKeys.getAvailableProviders as jest.Mock).mockResolvedValue([
        "openai",
      ]);
      (assignments.getAvailableProviders as jest.Mock).mockResolvedValue([]);
      // 即使 secrets 有更多 provider 也不再添加（严格 BYOK）
      const result = await service.getAvailableProviders("admin");
      expect(result).toEqual(["openai"]);
    });

    it("merges personal and assigned for user (dedup)", async () => {
      (userApiKeys.getAvailableProviders as jest.Mock).mockResolvedValue([
        "openai",
      ]);
      (assignments.getAvailableProviders as jest.Mock).mockResolvedValue([
        "openai",
        "anthropic",
      ]);
      const ps = await service.getAvailableProviders("u");
      expect([...ps].sort()).toEqual(["anthropic", "openai"]);
    });
  });

  // 2026-05-12 BYOK fix: getHealthyProviders 叠 KeyHealthStore.filterUsable，
  //   provider 的所有 key 都 quota-exhausted/dead 时整条剔除。election Step 3
  //   现在用这个方法过滤候选池，防止"用户配过但 key 全坏的 provider 又中选"。
  describe("getHealthyProviders", () => {
    it("falls back to getAvailableProviders when KeyHealthStore is not injected", async () => {
      // 当前 service 构造时没传 keyHealthStore → 退化为 getAvailableProviders
      (userApiKeys.getAvailableProviders as jest.Mock).mockResolvedValue([
        "xai",
      ]);
      (assignments.getAvailableProviders as jest.Mock).mockResolvedValue([]);
      const ps = await service.getHealthyProviders("u");
      expect(ps).toEqual(["xai"]);
    });

    it("excludes a provider when all its keys are unhealthy (filterUsable empty)", async () => {
      // 重新构造 service 注入 keyHealthStore + 扩展 prisma mock
      const filterUsable = jest.fn().mockResolvedValue([
        // grok 那把 key 健康（保留），deepseek 那把 key 被剔除
        "personal:u:xai:default",
      ]);
      const healthStore = { filterUsable };
      const extPrisma = {
        ...prisma,
        userApiKey: {
          findMany: jest.fn().mockResolvedValue([
            { provider: "xai", label: "default" },
            { provider: "deepseek", label: "default" },
          ]),
        },
        keyAssignment: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      };
      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          KeyResolverService,
          { provide: PrismaService, useValue: extPrisma },
          { provide: UserApiKeysService, useValue: userApiKeys },
          { provide: KeyAssignmentsService, useValue: assignments },
          { provide: SecretsService, useValue: secrets },
          // KeyHealthStore 是 @Optional 注入；symbol 用 require 避免循环 import
          {
            provide:
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              require("@/modules/platform/credentials/governance/key-health")
                .KeyHealthStore,
            useValue: healthStore,
          },
        ],
      }).compile();
      const svc = mod.get(KeyResolverService);

      const ps = await svc.getHealthyProviders("u");
      expect(ps).toEqual(["xai"]); // deepseek 整条剔除
      // 验证传给 filterUsable 的 healthKeyIds 涵盖两把 personal key
      expect(filterUsable).toHaveBeenCalledWith([
        "personal:u:xai:default",
        "personal:u:deepseek:default",
      ]);
    });

    it("returns multiple providers when at least one key per provider is usable", async () => {
      const filterUsable = jest
        .fn()
        .mockResolvedValue(["personal:u:xai:default", "assigned:asg-1"]);
      const healthStore = { filterUsable };
      const extPrisma = {
        ...prisma,
        userApiKey: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ provider: "xai", label: "default" }]),
        },
        keyAssignment: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: "asg-1", provider: "anthropic" }]),
        },
      };
      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          KeyResolverService,
          { provide: PrismaService, useValue: extPrisma },
          { provide: UserApiKeysService, useValue: userApiKeys },
          { provide: KeyAssignmentsService, useValue: assignments },
          { provide: SecretsService, useValue: secrets },
          {
            provide:
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              require("@/modules/platform/credentials/governance/key-health")
                .KeyHealthStore,
            useValue: healthStore,
          },
        ],
      }).compile();
      const svc = mod.get(KeyResolverService);

      const ps = await svc.getHealthyProviders("u");
      expect([...ps].sort()).toEqual(["anthropic", "xai"]);
    });

    it("returns empty when user has no keys at all", async () => {
      const filterUsable = jest.fn().mockResolvedValue([]);
      const healthStore = { filterUsable };
      const extPrisma = {
        ...prisma,
        userApiKey: { findMany: jest.fn().mockResolvedValue([]) },
        keyAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          KeyResolverService,
          { provide: PrismaService, useValue: extPrisma },
          { provide: UserApiKeysService, useValue: userApiKeys },
          { provide: KeyAssignmentsService, useValue: assignments },
          { provide: SecretsService, useValue: secrets },
          {
            provide:
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              require("@/modules/platform/credentials/governance/key-health")
                .KeyHealthStore,
            useValue: healthStore,
          },
        ],
      }).compile();
      const svc = mod.get(KeyResolverService);

      const ps = await svc.getHealthyProviders("u");
      expect(ps).toEqual([]);
      // filterUsable 不应被调用，因为 pairs 为空
      expect(filterUsable).not.toHaveBeenCalled();
    });
  });

  describe("recordSpend", () => {
    it("is a no-op for non-ASSIGNED sources", async () => {
      await service.recordSpend(
        {
          source: "PERSONAL",
          apiKey: "k",
          apiEndpoint: null,
          provider: "openai",
          userId: "u",
        },
        100,
      );
      expect(assignments.incrementSpend).not.toHaveBeenCalled();
    });

    it("calls incrementSpend for ASSIGNED source", async () => {
      await service.recordSpend(
        {
          source: "ASSIGNED",
          apiKey: "k",
          apiEndpoint: null,
          provider: "openai",
          userId: "u",
          assignmentId: "a-1",
        },
        150,
      );
      expect(assignments.incrementSpend).toHaveBeenCalledWith("a-1", 150);
    });
  });
});
