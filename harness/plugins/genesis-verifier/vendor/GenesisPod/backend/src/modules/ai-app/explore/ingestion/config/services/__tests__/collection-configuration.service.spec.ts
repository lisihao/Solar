import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { ResourceType } from "@prisma/client";
import { CollectionConfigurationService } from "../collection-configuration.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";

// ============================================================================
// Helpers
// ============================================================================

function makePrismaMock() {
  return {
    collectionConfiguration: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: "cfg-1",
    resourceType: "BLOG" as ResourceType,
    name: "AI Blogs",
    description: "AI research blogs",
    keywords: ["ai", "ml"],
    excludeKeywords: ["spam"],
    urlPatterns: ["*openai.com*"],
    cronExpression: "0 */6 * * *",
    maxConcurrent: 3,
    timeout: 300,
    isActive: true,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    lastCollectedAt: null,
    totalCollected: 0,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("CollectionConfigurationService", () => {
  let service: CollectionConfigurationService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();

    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CollectionConfigurationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CollectionConfigurationService>(
      CollectionConfigurationService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------- createConfig ----------

  describe("createConfig", () => {
    it("creates a config with provided values", async () => {
      const created = makeConfig();
      prisma.collectionConfiguration.create.mockResolvedValue(created);

      const dto = {
        resourceType: "BLOG" as ResourceType,
        name: "AI Blogs",
        keywords: ["ai"],
      };

      const result = await service.createConfig(dto);

      expect(prisma.collectionConfiguration.create).toHaveBeenCalledTimes(1);
      expect(result).toBe(created);
    });

    it("applies defaults for optional fields", async () => {
      const created = makeConfig();
      prisma.collectionConfiguration.create.mockResolvedValue(created);

      await service.createConfig({
        resourceType: "NEWS" as ResourceType,
        name: "Tech News",
      });

      const { data } = prisma.collectionConfiguration.create.mock.calls[0][0];
      expect(data.keywords).toEqual([]);
      expect(data.excludeKeywords).toEqual([]);
      expect(data.urlPatterns).toEqual([]);
      expect(data.cronExpression).toBe("0 */6 * * *");
      expect(data.maxConcurrent).toBe(3);
      expect(data.timeout).toBe(300);
      expect(data.isActive).toBe(true);
    });

    it("respects isActive=false when explicitly passed", async () => {
      prisma.collectionConfiguration.create.mockResolvedValue(
        makeConfig({ isActive: false }),
      );

      await service.createConfig({
        resourceType: "BLOG" as ResourceType,
        name: "Inactive",
        isActive: false,
      });

      const { data } = prisma.collectionConfiguration.create.mock.calls[0][0];
      expect(data.isActive).toBe(false);
    });

    it("propagates prisma errors", async () => {
      prisma.collectionConfiguration.create.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(
        service.createConfig({
          resourceType: "BLOG" as ResourceType,
          name: "x",
        }),
      ).rejects.toThrow("DB error");
    });
  });

  // ---------- getConfigsByResourceType ----------

  describe("getConfigsByResourceType", () => {
    it("returns configs for the given resource type", async () => {
      const configs = [makeConfig(), makeConfig({ id: "cfg-2" })];
      prisma.collectionConfiguration.findMany.mockResolvedValue(configs);

      const result = await service.getConfigsByResourceType(
        "BLOG" as ResourceType,
      );

      expect(prisma.collectionConfiguration.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { resourceType: "BLOG" } }),
      );
      expect(result).toBe(configs);
    });

    it("propagates prisma errors", async () => {
      prisma.collectionConfiguration.findMany.mockRejectedValue(
        new Error("fail"),
      );
      await expect(
        service.getConfigsByResourceType("BLOG" as ResourceType),
      ).rejects.toThrow("fail");
    });
  });

  // ---------- getConfig ----------

  describe("getConfig", () => {
    it("returns the config for a valid id", async () => {
      const cfg = makeConfig();
      prisma.collectionConfiguration.findUnique.mockResolvedValue(cfg);

      const result = await service.getConfig("cfg-1");

      expect(result).toBe(cfg);
    });

    it("returns null when config is not found", async () => {
      prisma.collectionConfiguration.findUnique.mockResolvedValue(null);

      const result = await service.getConfig("nonexistent");

      expect(result).toBeNull();
    });

    it("propagates prisma errors", async () => {
      prisma.collectionConfiguration.findUnique.mockRejectedValue(
        new Error("db err"),
      );
      await expect(service.getConfig("x")).rejects.toThrow("db err");
    });
  });

  // ---------- getActiveConfigs ----------

  describe("getActiveConfigs", () => {
    it("queries with isActive=true", async () => {
      prisma.collectionConfiguration.findMany.mockResolvedValue([]);

      await service.getActiveConfigs();

      expect(prisma.collectionConfiguration.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it("propagates prisma errors", async () => {
      prisma.collectionConfiguration.findMany.mockRejectedValue(
        new Error("fail"),
      );
      await expect(service.getActiveConfigs()).rejects.toThrow("fail");
    });
  });

  // ---------- updateConfig ----------

  describe("updateConfig", () => {
    it("updates a config and returns the updated record", async () => {
      const updated = makeConfig({ name: "Updated" });
      prisma.collectionConfiguration.update.mockResolvedValue(updated);

      const result = await service.updateConfig("cfg-1", { name: "Updated" });

      expect(prisma.collectionConfiguration.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "cfg-1" } }),
      );
      expect(result).toBe(updated);
    });

    it("propagates prisma errors", async () => {
      prisma.collectionConfiguration.update.mockRejectedValue(
        new Error("upd fail"),
      );
      await expect(
        service.updateConfig("cfg-1", { name: "x" }),
      ).rejects.toThrow("upd fail");
    });
  });

  // ---------- deleteConfig ----------

  describe("deleteConfig", () => {
    it("calls prisma delete with the correct id", async () => {
      prisma.collectionConfiguration.delete.mockResolvedValue(makeConfig());

      await service.deleteConfig("cfg-1");

      expect(prisma.collectionConfiguration.delete).toHaveBeenCalledWith({
        where: { id: "cfg-1" },
      });
    });

    it("propagates prisma errors", async () => {
      prisma.collectionConfiguration.delete.mockRejectedValue(
        new Error("del fail"),
      );
      await expect(service.deleteConfig("cfg-1")).rejects.toThrow("del fail");
    });
  });

  // ---------- enableConfig / disableConfig ----------

  describe("enableConfig", () => {
    it("calls updateConfig with isActive=true", async () => {
      const updated = makeConfig({ isActive: true });
      prisma.collectionConfiguration.update.mockResolvedValue(updated);

      const result = await service.enableConfig("cfg-1");

      const { data } = prisma.collectionConfiguration.update.mock.calls[0][0];
      expect(data.isActive).toBe(true);
      expect(result).toBe(updated);
    });
  });

  describe("disableConfig", () => {
    it("calls updateConfig with isActive=false", async () => {
      const updated = makeConfig({ isActive: false });
      prisma.collectionConfiguration.update.mockResolvedValue(updated);

      const result = await service.disableConfig("cfg-1");

      const { data } = prisma.collectionConfiguration.update.mock.calls[0][0];
      expect(data.isActive).toBe(false);
      expect(result).toBe(updated);
    });
  });

  // ---------- updateCollectionStats ----------

  describe("updateCollectionStats", () => {
    it("increments totalCollected and sets lastCollectedAt", async () => {
      const updated = makeConfig({ totalCollected: 10 });
      prisma.collectionConfiguration.update.mockResolvedValue(updated);

      const result = await service.updateCollectionStats("cfg-1", 5);

      expect(prisma.collectionConfiguration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "cfg-1" },
          data: expect.objectContaining({
            totalCollected: { increment: 5 },
          }),
        }),
      );
      expect(result).toBe(updated);
    });

    it("propagates prisma errors", async () => {
      prisma.collectionConfiguration.update.mockRejectedValue(
        new Error("stats fail"),
      );
      await expect(service.updateCollectionStats("cfg-1", 1)).rejects.toThrow(
        "stats fail",
      );
    });
  });

  // ---------- matchesUrlPatterns ----------

  describe("matchesUrlPatterns", () => {
    it("returns true when patterns list is empty", () => {
      expect(service.matchesUrlPatterns("https://example.com", [])).toBe(true);
    });

    it("matches an exact URL", () => {
      expect(
        service.matchesUrlPatterns("https://example.com/page", [
          "https://example.com/page",
        ]),
      ).toBe(true);
    });

    it("matches a wildcard pattern", () => {
      expect(
        service.matchesUrlPatterns("https://openai.com/blog/article", [
          "*openai.com*",
        ]),
      ).toBe(true);
    });

    it("returns false when URL does not match any pattern", () => {
      expect(
        service.matchesUrlPatterns("https://google.com", ["*openai.com*"]),
      ).toBe(false);
    });

    it("returns true if at least one pattern matches", () => {
      expect(
        service.matchesUrlPatterns("https://openai.com/news", [
          "*anthropic.com*",
          "*openai.com*",
        ]),
      ).toBe(true);
    });
  });

  // ---------- matchesKeywords ----------

  describe("matchesKeywords", () => {
    it("returns true when both lists are empty", () => {
      expect(service.matchesKeywords("some content", [], [])).toBe(true);
    });

    it("returns false when content contains an excluded keyword", () => {
      expect(
        service.matchesKeywords("this is spam content", [], ["spam"]),
      ).toBe(false);
    });

    it("returns true when content matches an include keyword", () => {
      expect(
        service.matchesKeywords(
          "deep learning is amazing",
          ["deep learning"],
          [],
        ),
      ).toBe(true);
    });

    it("returns false when no include keyword is present", () => {
      expect(
        service.matchesKeywords(
          "unrelated content",
          ["ai", "machine learning"],
          [],
        ),
      ).toBe(false);
    });

    it("exclusion check takes priority over inclusion", () => {
      // Content has 'ai' (include) but also 'spam' (exclude) -> false
      expect(service.matchesKeywords("ai spam", ["ai"], ["spam"])).toBe(false);
    });

    it("is case-insensitive", () => {
      expect(
        service.matchesKeywords(
          "Deep Learning Research",
          ["deep learning"],
          [],
        ),
      ).toBe(true);
      expect(service.matchesKeywords("Contains SPAM text", [], ["spam"])).toBe(
        false,
      );
    });
  });
});
