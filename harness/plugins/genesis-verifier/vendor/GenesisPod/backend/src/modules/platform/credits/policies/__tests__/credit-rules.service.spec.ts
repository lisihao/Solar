import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { CreditRulesService } from "../credit-rules.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

describe("CreditRulesService", () => {
  let service: CreditRulesService;
  let mockPrisma: jest.Mocked<Partial<PrismaService>>;

  const makeRule = (overrides: Record<string, unknown> = {}) => ({
    id: "rule-1",
    moduleType: "ai-ask",
    operationType: "chat",
    name: "AI问答对话",
    baseCredits: 10,
    tokenMultiplier: 2.0,
    modelMultipliers: {},
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    mockPrisma = {
      creditRule: {
        upsert: jest.fn().mockResolvedValue(makeRule()),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      } as unknown as PrismaService["creditRule"],
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreditRulesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CreditRulesService>(CreditRulesService);
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==================== onModuleInit ====================

  describe("onModuleInit", () => {
    it("initializes default rules on module init", async () => {
      (mockPrisma.creditRule!.upsert as jest.Mock).mockResolvedValue(
        makeRule(),
      );
      (mockPrisma.creditRule!.findMany as jest.Mock).mockResolvedValue([
        makeRule(),
      ]);

      await service.onModuleInit();

      expect(mockPrisma.creditRule!.upsert).toHaveBeenCalled();
    });

    it("loads rules into cache after initialization", async () => {
      const rules = [
        makeRule({ moduleType: "ai-ask", operationType: "chat" }),
        makeRule({
          id: "rule-2",
          moduleType: "deep-research",
          operationType: "research-quick",
          baseCredits: 200,
        }),
      ];
      (mockPrisma.creditRule!.upsert as jest.Mock).mockResolvedValue(
        makeRule(),
      );
      (mockPrisma.creditRule!.findMany as jest.Mock).mockResolvedValue(rules);

      await service.onModuleInit();

      // After loading, cache hit should not call DB again
      const rule = await service.getRule("ai-ask", "chat");
      expect(rule).not.toBeNull();
      expect(rule!.baseCredits).toBe(10);
    });

    it("handles DB errors gracefully during initialization", async () => {
      (mockPrisma.creditRule!.upsert as jest.Mock).mockRejectedValue(
        new Error("DB error"),
      );
      (mockPrisma.creditRule!.findMany as jest.Mock).mockRejectedValue(
        new Error("DB error"),
      );

      // Should not throw
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });

  // ==================== getRule ====================

  describe("getRule", () => {
    it("returns null when rule not found in cache or DB", async () => {
      (mockPrisma.creditRule!.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getRule("nonexistent-module", "op");
      expect(result).toBeNull();
    });

    it("returns rule from DB when not in cache", async () => {
      const rule = makeRule({ moduleType: "ai-ask", operationType: "chat" });
      (mockPrisma.creditRule!.findUnique as jest.Mock).mockResolvedValue(rule);

      const result = await service.getRule("ai-ask", "chat");
      expect(result).not.toBeNull();
      expect(result!.baseCredits).toBe(10);
    });

    it("returns null for inactive rule", async () => {
      const inactiveRule = makeRule({ isActive: false });
      (mockPrisma.creditRule!.findUnique as jest.Mock).mockResolvedValue(
        inactiveRule,
      );

      const result = await service.getRule("ai-ask", "chat");
      expect(result).toBeNull();
    });

    it("returns cached rule on subsequent calls", async () => {
      const rule = makeRule();
      (mockPrisma.creditRule!.findUnique as jest.Mock).mockResolvedValue(rule);

      // First call — DB hit
      await service.getRule("ai-ask", "chat");
      // Second call — should use cache
      await service.getRule("ai-ask", "chat");

      expect(mockPrisma.creditRule!.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  // ==================== calculateCredits ====================

  describe("calculateCredits", () => {
    it("returns default 10 when rule not found", async () => {
      (mockPrisma.creditRule!.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.calculateCredits(
        "unknown-module",
        "unknown-op",
      );
      expect(result).toBe(10);
    });

    it("returns base credits when no token count provided", async () => {
      const rule = makeRule({ baseCredits: 50, tokenMultiplier: 2.0 });
      (mockPrisma.creditRule!.findUnique as jest.Mock).mockResolvedValue(rule);

      const result = await service.calculateCredits("ai-ask", "chat");
      expect(result).toBe(50);
    });

    it("applies token multiplier when tokenCount exceeds base", async () => {
      const rule = makeRule({ baseCredits: 10, tokenMultiplier: 2.0 });
      (mockPrisma.creditRule!.findUnique as jest.Mock).mockResolvedValue(rule);

      // 5000 tokens → (5000/1000) * 10 * 2.0 = 100 credits > base 10
      const result = await service.calculateCredits(
        "ai-ask",
        "chat",
        5000,
        undefined,
      );
      expect(result).toBe(100);
    });

    it("uses base credits when token calculation is lower", async () => {
      const rule = makeRule({ baseCredits: 200, tokenMultiplier: 2.0 });
      (mockPrisma.creditRule!.findUnique as jest.Mock).mockResolvedValue(rule);

      // 10 tokens → (10/1000) * 200 * 2.0 = 4 credits < base 200
      const result = await service.calculateCredits(
        "deep-research",
        "research-quick",
        10,
      );
      expect(result).toBe(200);
    });

    it("applies model multiplier on top of base credits", async () => {
      const rule = makeRule({
        baseCredits: 100,
        tokenMultiplier: 0,
        modelMultipliers: { "gpt-4o": 2.0 },
      });
      (mockPrisma.creditRule!.findUnique as jest.Mock).mockResolvedValue(rule);

      const result = await service.calculateCredits(
        "ai-image",
        "generate",
        undefined,
        "gpt-4o",
      );
      expect(result).toBe(200);
    });

    it("uses multiplier 1.0 for unknown model", async () => {
      const rule = makeRule({
        baseCredits: 100,
        tokenMultiplier: 0,
        modelMultipliers: { "gpt-4o": 2.0 },
      });
      (mockPrisma.creditRule!.findUnique as jest.Mock).mockResolvedValue(rule);

      const result = await service.calculateCredits(
        "ai-image",
        "generate",
        undefined,
        "unknown-model",
      );
      expect(result).toBe(100); // 100 * 1.0
    });
  });

  // ==================== updateRule ====================

  describe("updateRule", () => {
    it("updates rule and refreshes cache for active rule", async () => {
      const updatedRule = makeRule({ baseCredits: 20, isActive: true });
      (mockPrisma.creditRule!.update as jest.Mock).mockResolvedValue(
        updatedRule,
      );

      const result = await service.updateRule("ai-ask", "chat", {
        baseCredits: 20,
      });
      expect(result.baseCredits).toBe(20);
      expect(mockPrisma.creditRule!.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            moduleType_operationType: {
              moduleType: "ai-ask",
              operationType: "chat",
            },
          },
        }),
      );
    });

    it("removes inactive rule from cache", async () => {
      const inactiveRule = makeRule({ isActive: false });
      (mockPrisma.creditRule!.update as jest.Mock).mockResolvedValue(
        inactiveRule,
      );
      (mockPrisma.creditRule!.findUnique as jest.Mock).mockResolvedValue(null);

      await service.updateRule("ai-ask", "chat", { isActive: false });

      // After deactivation, rule should not be returned from cache
      const found = await service.getRule("ai-ask", "chat");
      expect(found).toBeNull();
    });
  });

  // ==================== getAllRules ====================

  describe("getAllRules", () => {
    it("returns all rules ordered by moduleType and operationType", async () => {
      const rules = [makeRule(), makeRule({ id: "rule-2" })];
      (mockPrisma.creditRule!.findMany as jest.Mock).mockResolvedValue(rules);

      const result = await service.getAllRules();
      expect(result).toHaveLength(2);
      expect(mockPrisma.creditRule!.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ moduleType: "asc" }, { operationType: "asc" }],
        }),
      );
    });
  });

  // ==================== refreshCache ====================

  describe("refreshCache", () => {
    it("reloads rules into cache", async () => {
      const rules = [makeRule()];
      (mockPrisma.creditRule!.findMany as jest.Mock).mockResolvedValue(rules);

      await service.refreshCache();

      expect(mockPrisma.creditRule!.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });
  });
});
