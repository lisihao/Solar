import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { ResourceType } from "@prisma/client";
import { CollectionRuleService } from "../collection-rule.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";

// ============================================================================
// Helpers
// ============================================================================

function makePrismaMock() {
  return {
    collectionRule: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
}

function makeRule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-1",
    resourceType: "BLOG" as ResourceType,
    cronExpression: "0 */6 * * *",
    maxConcurrent: 3,
    timeout: 300,
    filters: {},
    deduplicationStrategy: "CONTENT_HASH",
    minimumQualityScore: 0.6,
    priority: 2,
    description: "Blog rule",
    isActive: true,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    nextScheduledAt: null,
    lastExecutedAt: null,
    importTasks: [],
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("CollectionRuleService", () => {
  let service: CollectionRuleService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();

    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CollectionRuleService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CollectionRuleService>(CollectionRuleService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------- createRule ----------

  describe("createRule", () => {
    it("creates a new rule when none exists for the resource type", async () => {
      prisma.collectionRule.findFirst.mockResolvedValue(null);
      const rule = makeRule();
      prisma.collectionRule.create.mockResolvedValue(rule);

      const result = await service.createRule({
        resourceType: "BLOG" as ResourceType,
      });

      expect(prisma.collectionRule.create).toHaveBeenCalledTimes(1);
      expect(result).toBe(rule);
    });

    it("applies defaults for optional fields", async () => {
      prisma.collectionRule.findFirst.mockResolvedValue(null);
      prisma.collectionRule.create.mockResolvedValue(makeRule());

      await service.createRule({ resourceType: "BLOG" as ResourceType });

      const { data } = prisma.collectionRule.create.mock.calls[0][0];
      expect(data.cronExpression).toBe("0 */6 * * *");
      expect(data.maxConcurrent).toBe(3);
      expect(data.timeout).toBe(300);
      expect(data.deduplicationStrategy).toBe("CONTENT_HASH");
      expect(data.minimumQualityScore).toBe(0.5);
      expect(data.priority).toBe(0);
      expect(data.isActive).toBe(true);
    });

    it("updates instead of creating when a rule already exists", async () => {
      const existing = makeRule();
      prisma.collectionRule.findFirst.mockResolvedValue(existing);
      prisma.collectionRule.updateMany.mockResolvedValue({ count: 1 });

      await service.createRule({
        resourceType: "BLOG" as ResourceType,
        cronExpression: "0 0 * * *",
      });

      expect(prisma.collectionRule.create).not.toHaveBeenCalled();
      expect(prisma.collectionRule.updateMany).toHaveBeenCalledTimes(1);
    });

    it("propagates errors from prisma", async () => {
      prisma.collectionRule.findFirst.mockRejectedValue(new Error("db error"));
      await expect(
        service.createRule({ resourceType: "BLOG" as ResourceType }),
      ).rejects.toThrow("db error");
    });
  });

  // ---------- getRule ----------

  describe("getRule", () => {
    it("returns the rule for a resource type", async () => {
      const rule = makeRule();
      prisma.collectionRule.findFirst.mockResolvedValue(rule);

      const result = await service.getRule("BLOG" as ResourceType);

      expect(result).toBe(rule);
    });

    it("returns null when no rule is found", async () => {
      prisma.collectionRule.findFirst.mockResolvedValue(null);

      const result = await service.getRule("BLOG" as ResourceType);

      expect(result).toBeNull();
    });

    it("propagates errors", async () => {
      prisma.collectionRule.findFirst.mockRejectedValue(new Error("get fail"));
      await expect(service.getRule("BLOG" as ResourceType)).rejects.toThrow(
        "get fail",
      );
    });
  });

  // ---------- getAllRules ----------

  describe("getAllRules", () => {
    it("returns all rules ordered by priority and createdAt", async () => {
      const rules = [makeRule(), makeRule({ id: "rule-2" })];
      prisma.collectionRule.findMany.mockResolvedValue(rules);

      const result = await service.getAllRules();

      expect(result).toBe(rules);
      expect(prisma.collectionRule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
        }),
      );
    });

    it("propagates errors", async () => {
      prisma.collectionRule.findMany.mockRejectedValue(new Error("list fail"));
      await expect(service.getAllRules()).rejects.toThrow("list fail");
    });
  });

  // ---------- getActiveRules ----------

  describe("getActiveRules", () => {
    it("queries with isActive=true", async () => {
      prisma.collectionRule.findMany.mockResolvedValue([]);

      await service.getActiveRules();

      expect(prisma.collectionRule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it("propagates errors", async () => {
      prisma.collectionRule.findMany.mockRejectedValue(
        new Error("active fail"),
      );
      await expect(service.getActiveRules()).rejects.toThrow("active fail");
    });
  });

  // ---------- updateRule ----------

  describe("updateRule", () => {
    it("updates the rule for the resource type", async () => {
      prisma.collectionRule.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.updateRule("BLOG" as ResourceType, {
        cronExpression: "0 0 * * *",
      });

      expect(prisma.collectionRule.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { resourceType: "BLOG" } }),
      );
      expect(result).toEqual({ count: 1 });
    });

    it("propagates errors", async () => {
      prisma.collectionRule.updateMany.mockRejectedValue(
        new Error("update fail"),
      );
      await expect(
        service.updateRule("BLOG" as ResourceType, {
          cronExpression: "0 * * * *",
        }),
      ).rejects.toThrow("update fail");
    });
  });

  // ---------- deleteRule ----------

  describe("deleteRule", () => {
    it("calls deleteMany with the resource type", async () => {
      prisma.collectionRule.deleteMany.mockResolvedValue({ count: 1 });

      await service.deleteRule("BLOG" as ResourceType);

      expect(prisma.collectionRule.deleteMany).toHaveBeenCalledWith({
        where: { resourceType: "BLOG" },
      });
    });

    it("propagates errors", async () => {
      prisma.collectionRule.deleteMany.mockRejectedValue(new Error("del fail"));
      await expect(service.deleteRule("BLOG" as ResourceType)).rejects.toThrow(
        "del fail",
      );
    });
  });

  // ---------- enableRule / disableRule ----------

  describe("enableRule", () => {
    it("calls updateRule with isActive=true", async () => {
      prisma.collectionRule.updateMany.mockResolvedValue({ count: 1 });

      await service.enableRule("NEWS" as ResourceType);

      const { data } = prisma.collectionRule.updateMany.mock.calls[0][0];
      expect(data.isActive).toBe(true);
    });
  });

  describe("disableRule", () => {
    it("calls updateRule with isActive=false", async () => {
      prisma.collectionRule.updateMany.mockResolvedValue({ count: 1 });

      await service.disableRule("NEWS" as ResourceType);

      const { data } = prisma.collectionRule.updateMany.mock.calls[0][0];
      expect(data.isActive).toBe(false);
    });
  });

  // ---------- updateNextScheduledTime ----------

  describe("updateNextScheduledTime", () => {
    it("sets nextScheduledAt on the matching rule", async () => {
      prisma.collectionRule.updateMany.mockResolvedValue({ count: 1 });

      const nextTime = new Date("2026-06-01T00:00:00Z");
      const result = await service.updateNextScheduledTime(
        "PAPER" as ResourceType,
        nextTime,
      );

      expect(prisma.collectionRule.updateMany).toHaveBeenCalledWith({
        where: { resourceType: "PAPER" },
        data: { nextScheduledAt: nextTime },
      });
      expect(result).toEqual({ count: 1 });
    });

    it("propagates errors", async () => {
      prisma.collectionRule.updateMany.mockRejectedValue(
        new Error("sched fail"),
      );
      await expect(
        service.updateNextScheduledTime("PAPER" as ResourceType, new Date()),
      ).rejects.toThrow("sched fail");
    });
  });

  // ---------- updateLastExecutedTime ----------

  describe("updateLastExecutedTime", () => {
    it("sets lastExecutedAt on the matching rule", async () => {
      prisma.collectionRule.updateMany.mockResolvedValue({ count: 1 });

      const lastTime = new Date("2026-05-01T12:00:00Z");
      const result = await service.updateLastExecutedTime(
        "NEWS" as ResourceType,
        lastTime,
      );

      expect(prisma.collectionRule.updateMany).toHaveBeenCalledWith({
        where: { resourceType: "NEWS" },
        data: { lastExecutedAt: lastTime },
      });
      expect(result).toEqual({ count: 1 });
    });

    it("propagates errors", async () => {
      prisma.collectionRule.updateMany.mockRejectedValue(
        new Error("exec time fail"),
      );
      await expect(
        service.updateLastExecutedTime("NEWS" as ResourceType, new Date()),
      ).rejects.toThrow("exec time fail");
    });
  });

  // ---------- getFilters ----------

  describe("getFilters", () => {
    it("returns PAPER filters with minCitations", () => {
      const filters = service.getFilters("PAPER" as ResourceType);
      expect(filters).toHaveProperty("minCitations");
      expect(filters).toHaveProperty("keywords");
    });

    it("returns BLOG filters with domains", () => {
      const filters = service.getFilters("BLOG" as ResourceType);
      expect(filters).toHaveProperty("domains");
    });

    it("returns NEWS filters", () => {
      const filters = service.getFilters("NEWS" as ResourceType);
      expect(filters).toHaveProperty("sources");
    });

    it("returns YOUTUBE_VIDEO filters with duration fields", () => {
      const filters = service.getFilters("YOUTUBE_VIDEO" as ResourceType);
      expect(filters).toHaveProperty("minDuration");
      expect(filters).toHaveProperty("maxDuration");
    });

    it("returns REPORT filters with yearRange", () => {
      const filters = service.getFilters("REPORT" as ResourceType);
      expect(filters).toHaveProperty("yearRange");
    });

    it("returns PROJECT filters with minStars", () => {
      const filters = service.getFilters("PROJECT" as ResourceType);
      expect(filters).toHaveProperty("minStars");
    });

    it("returns empty object for unknown resource types", () => {
      const filters = service.getFilters("UNKNOWN_TYPE" as ResourceType);
      expect(filters).toEqual({});
    });
  });

  // ---------- initializeDefaultRules ----------

  describe("initializeDefaultRules", () => {
    it("creates rules for resource types that do not yet have one", async () => {
      // All findFirst calls return null (no existing rule)
      prisma.collectionRule.findFirst.mockResolvedValue(null);
      prisma.collectionRule.create.mockResolvedValue(makeRule());

      await service.initializeDefaultRules();

      // Default rules list has 6 entries
      expect(prisma.collectionRule.create).toHaveBeenCalledTimes(6);
    });

    it("skips creation when a rule already exists", async () => {
      // All findFirst calls return an existing rule
      prisma.collectionRule.findFirst.mockResolvedValue(makeRule());

      await service.initializeDefaultRules();

      expect(prisma.collectionRule.create).not.toHaveBeenCalled();
    });

    it("continues initializing remaining rules when one fails", async () => {
      prisma.collectionRule.findFirst.mockResolvedValue(null);
      prisma.collectionRule.create
        .mockRejectedValueOnce(new Error("first fails"))
        .mockResolvedValue(makeRule());

      // Should not throw; errors are caught per-rule
      await expect(service.initializeDefaultRules()).resolves.toBeUndefined();
      // At least one create call succeeded
      expect(prisma.collectionRule.create.mock.calls.length).toBeGreaterThan(0);
    });
  });
});
