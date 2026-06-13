import { Test, TestingModule } from "@nestjs/testing";
import { AIModelType } from "@prisma/client";
import { UserByokService } from "../user-byok.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  KeyResolverService,
  UserApiKeysService,
} from "@/modules/ai-harness/facade";

// 逻辑已从 UserByokController（薄网关）下沉到 UserByokService —— 测试随之测 service。
describe("UserByokService", () => {
  let service: UserByokService;
  let prisma: {
    aIModel: { findMany: jest.Mock };
    user: { findUnique: jest.Mock };
  };
  let keyResolver: { getAvailableProviders: jest.Mock };
  let userApiKeys: { markOnboardedIfNeeded: jest.Mock };

  beforeEach(async () => {
    prisma = {
      aIModel: { findMany: jest.fn() },
      user: { findUnique: jest.fn() },
    };
    keyResolver = { getAvailableProviders: jest.fn() };
    userApiKeys = { markOnboardedIfNeeded: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserByokService,
        { provide: PrismaService, useValue: prisma },
        { provide: KeyResolverService, useValue: keyResolver },
        { provide: UserApiKeysService, useValue: userApiKeys },
      ],
    }).compile();

    service = module.get(UserByokService);
  });

  describe("getAvailableModels", () => {
    it("returns empty model list and CHAT default when user has no providers", async () => {
      keyResolver.getAvailableProviders.mockResolvedValue([]);

      const result = await service.getAvailableModels("user-1");

      expect(keyResolver.getAvailableProviders).toHaveBeenCalledWith("user-1");
      expect(prisma.aIModel.findMany).not.toHaveBeenCalled();
      expect(result).toEqual({
        availableProviders: [],
        modelType: AIModelType.CHAT,
        models: [],
      });
    });

    it("queries AIModel filtered by valid modelType and lowercased providers", async () => {
      keyResolver.getAvailableProviders.mockResolvedValue([
        "OpenAI",
        "Anthropic",
      ]);
      const dbRows = [
        {
          id: "m1",
          name: "gpt-4o",
          displayName: "GPT-4o",
          modelId: "gpt-4o",
          provider: "openai",
          modelType: AIModelType.CHAT,
          isReasoning: false,
          maxTokens: 4096,
          priority: 100,
        },
      ];
      prisma.aIModel.findMany.mockResolvedValue(dbRows);

      const result = await service.getAvailableModels("user-1", "CHAT");

      expect(prisma.aIModel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isEnabled: true,
            modelType: AIModelType.CHAT,
            provider: expect.objectContaining({
              in: ["openai", "anthropic"],
              mode: "insensitive",
            }),
          }),
        }),
      );
      expect(result).toEqual({
        availableProviders: ["OpenAI", "Anthropic"],
        modelType: AIModelType.CHAT,
        models: dbRows,
      });
    });

    it("falls back to CHAT when modelType is invalid", async () => {
      keyResolver.getAvailableProviders.mockResolvedValue(["openai"]);
      prisma.aIModel.findMany.mockResolvedValue([]);

      const result = await service.getAvailableModels("user-1", "BOGUS");

      expect(result.modelType).toBe(AIModelType.CHAT);
      expect(prisma.aIModel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ modelType: AIModelType.CHAT }),
        }),
      );
    });

    it("uses provided EMBEDDING modelType when valid", async () => {
      keyResolver.getAvailableProviders.mockResolvedValue(["openai"]);
      prisma.aIModel.findMany.mockResolvedValue([]);

      const result = await service.getAvailableModels("user-1", "EMBEDDING");

      expect(result.modelType).toBe(AIModelType.EMBEDDING);
    });

    it("falls back to CHAT when modelType is undefined", async () => {
      keyResolver.getAvailableProviders.mockResolvedValue(["openai"]);
      prisma.aIModel.findMany.mockResolvedValue([]);

      const result = await service.getAvailableModels("user-1");

      expect(result.modelType).toBe(AIModelType.CHAT);
    });
  });

  describe("completeOnboarding", () => {
    it("marks onboarded then returns the persisted byokOnboardedAt", async () => {
      userApiKeys.markOnboardedIfNeeded.mockResolvedValue(undefined);
      const onboardedAt = new Date("2026-01-01T00:00:00Z");
      prisma.user.findUnique.mockResolvedValue({
        byokOnboardedAt: onboardedAt,
      });

      const result = await service.completeOnboarding("user-1");

      expect(userApiKeys.markOnboardedIfNeeded).toHaveBeenCalledWith("user-1");
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "user-1" },
          select: { byokOnboardedAt: true },
        }),
      );
      expect(result).toEqual({ byokOnboardedAt: onboardedAt });
    });

    it("returns null when user not found", async () => {
      userApiKeys.markOnboardedIfNeeded.mockResolvedValue(undefined);
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.completeOnboarding("user-1");

      expect(result).toEqual({ byokOnboardedAt: null });
    });
  });

  describe("getOnboardingStatus", () => {
    it("returns requiresOnboarding=true for new non-admin user", async () => {
      prisma.user.findUnique.mockResolvedValue({
        byokOnboardedAt: null,
        role: "USER",
      });

      const result = await service.getOnboardingStatus("user-1");

      expect(result).toEqual({
        byokOnboardedAt: null,
        isAdmin: false,
        requiresOnboarding: true,
      });
    });

    it("returns isAdmin=true and requiresOnboarding=false for admin", async () => {
      prisma.user.findUnique.mockResolvedValue({
        byokOnboardedAt: null,
        role: "ADMIN",
      });

      const result = await service.getOnboardingStatus("user-1");

      expect(result).toEqual({
        byokOnboardedAt: null,
        isAdmin: true,
        requiresOnboarding: false,
      });
    });

    it("returns requiresOnboarding=false when already onboarded", async () => {
      const at = new Date("2026-01-01");
      prisma.user.findUnique.mockResolvedValue({
        byokOnboardedAt: at,
        role: "USER",
      });

      const result = await service.getOnboardingStatus("user-1");

      expect(result).toEqual({
        byokOnboardedAt: at,
        isAdmin: false,
        requiresOnboarding: false,
      });
    });

    it("handles missing user record gracefully", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.getOnboardingStatus("user-1");

      expect(result).toEqual({
        byokOnboardedAt: null,
        isAdmin: false,
        requiresOnboarding: false,
      });
    });
  });
});
