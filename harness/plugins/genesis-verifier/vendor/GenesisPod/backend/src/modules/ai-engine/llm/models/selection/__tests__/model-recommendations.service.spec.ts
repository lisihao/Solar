/**
 * ModelRecommendationsService 单元测试
 */
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ModelRecommendationsService } from "../model-recommendations.service";
import { AIModelType } from "@prisma/client";

describe("ModelRecommendationsService", () => {
  let service: ModelRecommendationsService;

  const mockPrisma = {
    modelRecommendation: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ModelRecommendationsService(mockPrisma as never);
  });

  describe("onModuleInit", () => {
    it("should seed defaults when table is empty", async () => {
      mockPrisma.modelRecommendation.count.mockResolvedValue(0);
      mockPrisma.modelRecommendation.createMany.mockResolvedValue({ count: 5 });

      await service.onModuleInit();

      expect(mockPrisma.modelRecommendation.createMany).toHaveBeenCalled();
    });

    it("should not seed when table already has data", async () => {
      mockPrisma.modelRecommendation.count.mockResolvedValue(10);

      await service.onModuleInit();

      expect(mockPrisma.modelRecommendation.createMany).not.toHaveBeenCalled();
    });

    it("should handle DB errors gracefully (table may not exist)", async () => {
      mockPrisma.modelRecommendation.count.mockRejectedValue(
        new Error("relation does not exist"),
      );

      // Should not throw
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe("getForProvider", () => {
    it("should return DB rows for a provider", async () => {
      mockPrisma.modelRecommendation.findMany.mockResolvedValue([
        {
          provider: "openai",
          modelType: AIModelType.CHAT,
          patterns: ["gpt-4.*"],
          priority: 10,
        },
      ]);

      const result = await service.getForProvider("OpenAI");

      expect(mockPrisma.modelRecommendation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { provider: "openai" }, // normalized to lowercase
        }),
      );
      expect(result.length).toBeGreaterThanOrEqual(1);
      const chatRec = result.find(
        (r) => r.modelType === AIModelType.CHAT && r.source === "db",
      );
      expect(chatRec).toBeDefined();
      expect(chatRec?.patterns).toContain("gpt-4.*");
    });

    it("should normalize provider name to lowercase", async () => {
      mockPrisma.modelRecommendation.findMany.mockResolvedValue([]);

      await service.getForProvider("OPENAI");

      expect(mockPrisma.modelRecommendation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { provider: "openai" } }),
      );
    });

    it("should include fallback defaults for uncovered model types", async () => {
      // DB has no rows — all types come from defaults
      mockPrisma.modelRecommendation.findMany.mockResolvedValue([]);

      const result = await service.getForProvider("openai");

      // Result should include default fallbacks
      expect(Array.isArray(result)).toBe(true);
    });

    it("should parse array patterns from DB rows", async () => {
      mockPrisma.modelRecommendation.findMany.mockResolvedValue([
        {
          provider: "openai",
          modelType: AIModelType.CHAT,
          patterns: ["gpt-4.*", "gpt-3.*"],
          priority: 10,
        },
      ]);

      const result = await service.getForProvider("openai");
      const dbRow = result.find((r) => r.source === "db");
      expect(dbRow?.patterns).toContain("gpt-4.*");
      expect(dbRow?.patterns).toContain("gpt-3.*");
    });

    it("should return empty patterns for non-array patterns value", async () => {
      mockPrisma.modelRecommendation.findMany.mockResolvedValue([
        {
          provider: "test",
          modelType: AIModelType.CHAT,
          patterns: "invalid-not-array",
          priority: 10,
        },
      ]);

      const result = await service.getForProvider("test");
      const dbRow = result.find((r) => r.source === "db");
      expect(dbRow?.patterns).toEqual([]);
    });
  });

  describe("listAll", () => {
    it("should merge DB rows and defaults", async () => {
      mockPrisma.modelRecommendation.findMany.mockResolvedValue([
        {
          provider: "openai",
          modelType: AIModelType.CHAT,
          patterns: ["gpt-4.*"],
          priority: 10,
        },
      ]);

      const result = await service.listAll();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it("should mark DB rows with source db", async () => {
      mockPrisma.modelRecommendation.findMany.mockResolvedValue([
        {
          provider: "custom-provider",
          modelType: AIModelType.CHAT,
          patterns: ["custom.*"],
          priority: 5,
        },
      ]);

      const result = await service.listAll();
      const dbRow = result.find((r) => r.provider === "custom-provider");
      expect(dbRow?.source).toBe("db");
    });

    it("should sort results by provider then modelType", async () => {
      mockPrisma.modelRecommendation.findMany.mockResolvedValue([]);

      const result = await service.listAll();
      for (let i = 1; i < result.length; i++) {
        const cmp = result[i - 1].provider.localeCompare(result[i].provider);
        if (cmp === 0) {
          expect(
            result[i - 1].modelType.localeCompare(result[i].modelType),
          ).toBeLessThanOrEqual(0);
        } else {
          expect(cmp).toBeLessThanOrEqual(0);
        }
      }
    });
  });

  describe("listDbRows", () => {
    it("should return DB rows ordered by provider and modelType", async () => {
      const mockRows = [
        { id: "1", provider: "anthropic", modelType: AIModelType.CHAT },
        { id: "2", provider: "openai", modelType: AIModelType.CHAT },
      ];
      mockPrisma.modelRecommendation.findMany.mockResolvedValue(mockRows);

      const result = await service.listDbRows();

      expect(mockPrisma.modelRecommendation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ provider: "asc" }, { modelType: "asc" }],
        }),
      );
      expect(result).toBe(mockRows);
    });
  });

  describe("create", () => {
    it("should create a recommendation with valid data", async () => {
      mockPrisma.modelRecommendation.findUnique.mockResolvedValue(null);
      const mockCreated = {
        id: "new-id",
        provider: "openai",
        modelType: AIModelType.CHAT,
        patterns: ["gpt-4.*"],
        priority: 50,
      };
      mockPrisma.modelRecommendation.create.mockResolvedValue(mockCreated);

      const result = await service.create(
        {
          provider: "OpenAI",
          modelType: AIModelType.CHAT,
          patterns: ["gpt-4.*"],
        },
        "admin-user",
      );

      expect(result).toBe(mockCreated);
      expect(mockPrisma.modelRecommendation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            provider: "openai",
            priority: 50,
            updatedBy: "admin-user",
          }),
        }),
      );
    });

    it("should throw BadRequestException if provider is empty", async () => {
      await expect(
        service.create(
          { provider: "  ", modelType: AIModelType.CHAT, patterns: [".*"] },
          null,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException if recommendation already exists", async () => {
      mockPrisma.modelRecommendation.findUnique.mockResolvedValue({
        id: "existing",
      });

      await expect(
        service.create(
          { provider: "openai", modelType: AIModelType.CHAT, patterns: [".*"] },
          null,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for empty patterns array", async () => {
      mockPrisma.modelRecommendation.findUnique.mockResolvedValue(null);

      await expect(
        service.create(
          { provider: "openai", modelType: AIModelType.CHAT, patterns: [] },
          null,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for invalid regex pattern", async () => {
      mockPrisma.modelRecommendation.findUnique.mockResolvedValue(null);

      await expect(
        service.create(
          {
            provider: "openai",
            modelType: AIModelType.CHAT,
            patterns: ["[invalid regex"],
          },
          null,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for empty string pattern", async () => {
      mockPrisma.modelRecommendation.findUnique.mockResolvedValue(null);

      await expect(
        service.create(
          {
            provider: "openai",
            modelType: AIModelType.CHAT,
            patterns: ["   "],
          },
          null,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should use default priority of 50 when not provided", async () => {
      mockPrisma.modelRecommendation.findUnique.mockResolvedValue(null);
      mockPrisma.modelRecommendation.create.mockResolvedValue({});

      await service.create(
        { provider: "openai", modelType: AIModelType.CHAT, patterns: [".*"] },
        null,
      );

      expect(mockPrisma.modelRecommendation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ priority: 50 }),
        }),
      );
    });
  });

  describe("update", () => {
    it("should update an existing recommendation", async () => {
      const existing = { id: "rec-1", provider: "openai", patterns: ["old.*"] };
      mockPrisma.modelRecommendation.findUnique.mockResolvedValue(existing);
      const updated = { ...existing, patterns: ["new.*"] };
      mockPrisma.modelRecommendation.update.mockResolvedValue(updated);

      const result = await service.update(
        "rec-1",
        { patterns: ["new.*"] },
        "admin",
      );

      expect(result).toBe(updated);
    });

    it("should throw NotFoundException if recommendation not found", async () => {
      mockPrisma.modelRecommendation.findUnique.mockResolvedValue(null);

      await expect(
        service.update("nonexistent", { patterns: [".*"] }, null),
      ).rejects.toThrow(NotFoundException);
    });

    it("should update priority without requiring patterns", async () => {
      mockPrisma.modelRecommendation.findUnique.mockResolvedValue({ id: "1" });
      mockPrisma.modelRecommendation.update.mockResolvedValue({
        id: "1",
        priority: 30,
      });

      const result = await service.update("1", { priority: 30 }, null);

      expect(mockPrisma.modelRecommendation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ priority: 30 }),
        }),
      );
      expect(result).toBeDefined();
    });
  });

  describe("remove", () => {
    it("should delete a recommendation", async () => {
      mockPrisma.modelRecommendation.delete.mockResolvedValue({});

      await service.remove("rec-1");

      expect(mockPrisma.modelRecommendation.delete).toHaveBeenCalledWith({
        where: { id: "rec-1" },
      });
    });

    it("should throw NotFoundException when delete fails", async () => {
      mockPrisma.modelRecommendation.delete.mockRejectedValue(
        new Error("not found"),
      );

      await expect(service.remove("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("resetToDefaults", () => {
    it("should delete all and reseed defaults", async () => {
      mockPrisma.$transaction.mockResolvedValue([]);
      mockPrisma.modelRecommendation.deleteMany.mockResolvedValue({
        count: 10,
      });
      mockPrisma.modelRecommendation.createMany.mockResolvedValue({
        count: 15,
      });

      const result = await service.resetToDefaults("admin");

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.modelRecommendation.createMany).toHaveBeenCalled();
      expect(result.seeded).toBeGreaterThan(0);
    });
  });

  describe("seedMissingDefaults", () => {
    it("should return 0 when all defaults already in DB", async () => {
      // Return all defaults as "covered"
      // We mock findMany to return everything that's in DEFAULT_RECOMMENDATIONS
      // Actually easier to just test with an existing coverage
      const { DEFAULT_RECOMMENDATIONS } =
        await import("../default-recommendations.config");
      mockPrisma.modelRecommendation.findMany.mockResolvedValue(
        DEFAULT_RECOMMENDATIONS.map((d) => ({
          provider: d.provider,
          modelType: d.modelType,
        })),
      );

      const result = await service.seedMissingDefaults(null);
      expect(result.seeded).toBe(0);
    });

    it("should seed missing defaults", async () => {
      // No existing DB rows → all defaults are missing
      mockPrisma.modelRecommendation.findMany.mockResolvedValue([]);
      mockPrisma.modelRecommendation.createMany.mockResolvedValue({
        count: 10,
      });

      const result = await service.seedMissingDefaults(null);
      expect(result.seeded).toBeGreaterThan(0);
      expect(mockPrisma.modelRecommendation.createMany).toHaveBeenCalled();
    });
  });
});

