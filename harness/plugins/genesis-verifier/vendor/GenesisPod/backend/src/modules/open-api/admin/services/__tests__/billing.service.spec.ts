import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { BillingService } from "../billing.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

describe("BillingService", () => {
  let service: BillingService;
  let mockPrisma: {
    creditTransaction: {
      aggregate: jest.Mock;
      groupBy: jest.Mock;
      findMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    mockPrisma = {
      creditTransaction: {
        aggregate: jest.fn(),
        groupBy: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getBillingOverview", () => {
    it("should return billing overview with correct totals", async () => {
      // Arrange
      mockPrisma.creditTransaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: -500 } }) // totalSpent
        .mockResolvedValueOnce({ _sum: { amount: -50 } }) // todaySpent
        .mockResolvedValueOnce({ _sum: { amount: -200 } }); // monthSpent

      mockPrisma.creditTransaction.groupBy
        .mockResolvedValueOnce([
          { accountId: "acc-1" },
          { accountId: "acc-2" },
          { accountId: "acc-3" },
        ]) // activeSpenders
        .mockResolvedValueOnce([
          {
            moduleType: "AI_RESEARCH",
            _sum: { amount: -100 },
            _count: 10,
          },
        ]) // byModule
        .mockResolvedValueOnce([
          {
            modelName: "gpt-4",
            _sum: { amount: -300, tokenCount: 5000 },
            _count: 5,
          },
        ]); // byModel

      mockPrisma.creditTransaction.findMany.mockResolvedValue([]);

      // Act
      const result = await service.getBillingOverview();

      // Assert
      expect(result.totalSpent).toBe(500);
      expect(result.todaySpent).toBe(50);
      expect(result.monthSpent).toBe(200);
      expect(result.activeSpenders).toBe(3);
    });

    it("should negate negative amounts to produce positive spend values", async () => {
      // Arrange: amounts are negative (representing spend)
      mockPrisma.creditTransaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: -1234.56 } })
        .mockResolvedValueOnce({ _sum: { amount: -99.99 } })
        .mockResolvedValueOnce({ _sum: { amount: -499.5 } });

      mockPrisma.creditTransaction.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      mockPrisma.creditTransaction.findMany.mockResolvedValue([]);

      // Act
      const result = await service.getBillingOverview();

      // Assert
      expect(result.totalSpent).toBeCloseTo(1234.56);
      expect(result.todaySpent).toBeCloseTo(99.99);
      expect(result.monthSpent).toBeCloseTo(499.5);
    });

    it("should handle null sum amounts gracefully (zero spend)", async () => {
      // Arrange: no transactions exist
      mockPrisma.creditTransaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: null } })
        .mockResolvedValueOnce({ _sum: { amount: null } })
        .mockResolvedValueOnce({ _sum: { amount: null } });

      mockPrisma.creditTransaction.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      mockPrisma.creditTransaction.findMany.mockResolvedValue([]);

      // Act
      const result = await service.getBillingOverview();

      // Assert
      expect(result.totalSpent).toBe(0);
      expect(result.todaySpent).toBe(0);
      expect(result.monthSpent).toBe(0);
      expect(result.activeSpenders).toBe(0);
    });

    it("should build byModule breakdown with correct mapping", async () => {
      // Arrange
      mockPrisma.creditTransaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: -1000 } })
        .mockResolvedValueOnce({ _sum: { amount: -100 } })
        .mockResolvedValueOnce({ _sum: { amount: -400 } });

      mockPrisma.creditTransaction.groupBy
        .mockResolvedValueOnce([{ accountId: "acc-1" }]) // activeSpenders
        .mockResolvedValueOnce([
          { moduleType: "AI_ASK", _sum: { amount: -300 }, _count: 15 },
          { moduleType: "AI_RESEARCH", _sum: { amount: -700 }, _count: 5 },
        ]) // byModule
        .mockResolvedValueOnce([]); // byModel

      mockPrisma.creditTransaction.findMany.mockResolvedValue([]);

      // Act
      const result = await service.getBillingOverview();

      // Assert
      expect(result.byModule).toHaveLength(2);
      expect(result.byModule[0]).toEqual({
        module: "AI_ASK",
        spent: 300,
        count: 15,
      });
      expect(result.byModule[1]).toEqual({
        module: "AI_RESEARCH",
        spent: 700,
        count: 5,
      });
    });

    it("should build byModel breakdown with token counts", async () => {
      // Arrange
      mockPrisma.creditTransaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: -500 } })
        .mockResolvedValueOnce({ _sum: { amount: -50 } })
        .mockResolvedValueOnce({ _sum: { amount: -200 } });

      mockPrisma.creditTransaction.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]) // byModule
        .mockResolvedValueOnce([
          {
            modelName: "claude-3",
            _sum: { amount: -500, tokenCount: 12000 },
            _count: 20,
          },
          {
            modelName: "gpt-4o",
            _sum: { amount: null, tokenCount: null },
            _count: 3,
          },
        ]); // byModel

      mockPrisma.creditTransaction.findMany.mockResolvedValue([]);

      // Act
      const result = await service.getBillingOverview();

      // Assert
      expect(result.byModel).toHaveLength(2);
      expect(result.byModel[0]).toEqual({
        model: "claude-3",
        spent: 500,
        tokens: 12000,
        count: 20,
      });
      // null tokenCount falls back to 0
      expect(result.byModel[1].tokens).toBe(0);
    });

    it("should build 30-day daily trend with entries for all 30 days", async () => {
      // Use fixed date at noon UTC to avoid timezone-induced duplicate date keys
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-03-15T12:00:00Z"));

      // Arrange
      mockPrisma.creditTransaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 0 } })
        .mockResolvedValueOnce({ _sum: { amount: 0 } })
        .mockResolvedValueOnce({ _sum: { amount: 0 } });

      mockPrisma.creditTransaction.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      mockPrisma.creditTransaction.findMany.mockResolvedValue([]);

      // Act
      const result = await service.getBillingOverview();

      // Assert: daily trend has exactly 30 entries
      expect(result.dailyTrend).toHaveLength(30);
      result.dailyTrend.forEach((entry) => {
        expect(entry).toHaveProperty("date");
        expect(entry).toHaveProperty("spent");
        expect(typeof entry.date).toBe("string");
        expect(typeof entry.spent).toBe("number");
      });

      jest.useRealTimers();
    });

    it("should aggregate daily transaction amounts into the trend map", async () => {
      // Arrange
      const today = new Date();
      const todayKey = today.toISOString().split("T")[0];

      mockPrisma.creditTransaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: -300 } })
        .mockResolvedValueOnce({ _sum: { amount: -300 } })
        .mockResolvedValueOnce({ _sum: { amount: -300 } });

      mockPrisma.creditTransaction.groupBy
        .mockResolvedValueOnce([{ accountId: "a1" }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      // Two transactions on today
      mockPrisma.creditTransaction.findMany.mockResolvedValue([
        { amount: -100, createdAt: today },
        { amount: -200, createdAt: today },
      ]);

      // Act
      const result = await service.getBillingOverview();

      // Assert: today's entry should sum both transactions
      const todayEntry = result.dailyTrend.find((e) => e.date === todayKey);
      expect(todayEntry?.spent).toBe(300);
    });

    it("should call aggregate with spend type filters", async () => {
      // Arrange
      mockPrisma.creditTransaction.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      });
      mockPrisma.creditTransaction.groupBy.mockResolvedValue([]);
      mockPrisma.creditTransaction.findMany.mockResolvedValue([]);

      // Act
      await service.getBillingOverview();

      // Assert: all aggregate calls use the type filter
      const calls = mockPrisma.creditTransaction.aggregate.mock.calls;
      expect(calls.length).toBe(3);
      calls.forEach((call) => {
        expect(call[0].where.type.in).toBeDefined();
        expect(Array.isArray(call[0].where.type.in)).toBe(true);
        expect(call[0].where.type.in.length).toBeGreaterThan(0);
      });
    });

    it("should call groupBy for active spenders with month filter", async () => {
      // Arrange
      mockPrisma.creditTransaction.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      });
      mockPrisma.creditTransaction.groupBy.mockResolvedValue([]);
      mockPrisma.creditTransaction.findMany.mockResolvedValue([]);

      // Act
      await service.getBillingOverview();

      // Assert: first groupBy call (activeSpenders) groups by accountId
      const firstGroupByCall =
        mockPrisma.creditTransaction.groupBy.mock.calls[0][0];
      expect(firstGroupByCall.by).toContain("accountId");
      expect(firstGroupByCall.where.createdAt.gte).toBeDefined();
    });

    it("should return all required top-level keys in the result", async () => {
      // Arrange
      mockPrisma.creditTransaction.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      });
      mockPrisma.creditTransaction.groupBy.mockResolvedValue([]);
      mockPrisma.creditTransaction.findMany.mockResolvedValue([]);

      // Act
      const result = await service.getBillingOverview();

      // Assert
      expect(result).toHaveProperty("totalSpent");
      expect(result).toHaveProperty("todaySpent");
      expect(result).toHaveProperty("monthSpent");
      expect(result).toHaveProperty("activeSpenders");
      expect(result).toHaveProperty("byModule");
      expect(result).toHaveProperty("byModel");
      expect(result).toHaveProperty("dailyTrend");
    });
  });

  describe("getDailyDetail", () => {
    const setupDailyDetailMocks = (
      transactions: object[],
      byModule: object[] = [],
      byModel: object[] = [],
    ) => {
      mockPrisma.creditTransaction.findMany.mockResolvedValue(transactions);
      mockPrisma.creditTransaction.groupBy
        .mockResolvedValueOnce(byModule)
        .mockResolvedValueOnce(byModel);
    };

    it("should return formatted daily detail for a valid date", async () => {
      // Arrange
      const createdAt = new Date("2025-06-15T10:00:00.000Z");
      setupDailyDetailMocks(
        [
          {
            id: "tx-1",
            amount: -100,
            moduleType: "AI_RESEARCH",
            modelName: "gpt-4",
            description: "Research run",
            createdAt,
            account: { user: { email: "user@test.com", username: "tester" } },
          },
        ],
        [{ moduleType: "AI_RESEARCH", _sum: { amount: -100 }, _count: 1 }],
        [{ modelName: "gpt-4", _sum: { amount: -100 }, _count: 1 }],
      );

      // Act
      const result = await service.getDailyDetail("2025-06-15");

      // Assert
      expect(result.date).toBe("2025-06-15");
      expect(result.transactionCount).toBe(1);
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].id).toBe("tx-1");
    });

    it("should throw BadRequestException for invalid date format", async () => {
      await expect(service.getDailyDetail("15-06-2025")).rejects.toThrow(
        "Invalid date format. Use YYYY-MM-DD",
      );
    });

    it("should throw BadRequestException for a non-ISO string without dashes", async () => {
      await expect(service.getDailyDetail("20250615")).rejects.toThrow(
        "Invalid date format. Use YYYY-MM-DD",
      );
    });

    it("should throw BadRequestException for invalid calendar date like 2025-13-45", async () => {
      // Matches regex but produces an invalid Date
      // new Date("2025-13-45T00:00:00.000Z") → NaN
      await expect(service.getDailyDetail("2025-13-45")).rejects.toThrow(
        "Invalid date",
      );
    });

    it("should compute totalSpent as sum of absolute amounts", async () => {
      // Arrange: three transactions with negative amounts
      const createdAt = new Date("2025-06-15T10:00:00.000Z");
      setupDailyDetailMocks([
        {
          id: "tx-1",
          amount: -50,
          moduleType: null,
          modelName: null,
          description: null,
          createdAt,
          account: { user: { email: "a@a.com", username: "a" } },
        },
        {
          id: "tx-2",
          amount: -75,
          moduleType: null,
          modelName: null,
          description: null,
          createdAt,
          account: { user: { email: "b@b.com", username: "b" } },
        },
        {
          id: "tx-3",
          amount: -25,
          moduleType: null,
          modelName: null,
          description: null,
          createdAt,
          account: { user: { email: "c@c.com", username: "c" } },
        },
      ]);

      // Act
      const result = await service.getDailyDetail("2025-06-15");

      // Assert: 50 + 75 + 25 = 150
      expect(result.totalSpent).toBe(150);
    });

    it("should map transactions with user email and username", async () => {
      // Arrange
      const createdAt = new Date("2025-06-15T12:00:00.000Z");
      setupDailyDetailMocks([
        {
          id: "tx-42",
          amount: -200,
          moduleType: "AI_ASK",
          modelName: "claude-3",
          description: "Ask query",
          createdAt,
          account: {
            user: { email: "alice@example.com", username: "alice" },
          },
        },
      ]);

      // Act
      const result = await service.getDailyDetail("2025-06-15");

      // Assert
      expect(result.transactions[0].userEmail).toBe("alice@example.com");
      expect(result.transactions[0].userName).toBe("alice");
      expect(result.transactions[0].amount).toBe(200);
      expect(result.transactions[0].module).toBe("AI_ASK");
      expect(result.transactions[0].model).toBe("claude-3");
    });

    it("should fall back to '-' for null user email", async () => {
      // Arrange: account exists but user email is null
      const createdAt = new Date("2025-06-15T08:00:00.000Z");
      setupDailyDetailMocks([
        {
          id: "tx-5",
          amount: -10,
          moduleType: null,
          modelName: null,
          description: null,
          createdAt,
          account: { user: { email: null, username: "ghost" } },
        },
      ]);

      // Act
      const result = await service.getDailyDetail("2025-06-15");

      // Assert
      expect(result.transactions[0].userEmail).toBe("-");
      expect(result.transactions[0].userName).toBe("ghost");
    });

    it("should fall back to null for null username", async () => {
      // Arrange
      const createdAt = new Date("2025-06-15T09:00:00.000Z");
      setupDailyDetailMocks([
        {
          id: "tx-6",
          amount: -15,
          moduleType: null,
          modelName: null,
          description: null,
          createdAt,
          account: { user: { email: "anon@test.com", username: null } },
        },
      ]);

      // Act
      const result = await service.getDailyDetail("2025-06-15");

      // Assert
      expect(result.transactions[0].userEmail).toBe("anon@test.com");
      expect(result.transactions[0].userName).toBeNull();
    });

    it("should return byModule and byModel breakdowns", async () => {
      // Arrange
      setupDailyDetailMocks(
        [],
        [
          { moduleType: "AI_WRITING", _sum: { amount: -300 }, _count: 3 },
          { moduleType: "AI_TEAMS", _sum: { amount: -200 }, _count: 2 },
        ],
        [{ modelName: "gpt-4o", _sum: { amount: -500 }, _count: 5 }],
      );

      // Act
      const result = await service.getDailyDetail("2025-06-15");

      // Assert byModule
      expect(result.byModule).toHaveLength(2);
      expect(result.byModule[0]).toEqual({
        module: "AI_WRITING",
        spent: 300,
        count: 3,
      });
      expect(result.byModule[1]).toEqual({
        module: "AI_TEAMS",
        spent: 200,
        count: 2,
      });

      // Assert byModel
      expect(result.byModel).toHaveLength(1);
      expect(result.byModel[0]).toEqual({
        model: "gpt-4o",
        spent: 500,
        count: 5,
      });
    });

    it("should pass take: 200 to findMany to limit transactions", async () => {
      // Arrange
      setupDailyDetailMocks([]);

      // Act
      await service.getDailyDetail("2025-06-15");

      // Assert: findMany was called with take: 200
      const findManyCall =
        mockPrisma.creditTransaction.findMany.mock.calls[0][0];
      expect(findManyCall.take).toBe(200);
    });

    it("should return empty result when no transactions exist on that date", async () => {
      // Arrange: no transactions, no groupBy entries
      setupDailyDetailMocks([]);

      // Act
      const result = await service.getDailyDetail("2025-06-15");

      // Assert
      expect(result.date).toBe("2025-06-15");
      expect(result.totalSpent).toBe(0);
      expect(result.transactionCount).toBe(0);
      expect(result.transactions).toHaveLength(0);
      expect(result.byModule).toHaveLength(0);
      expect(result.byModel).toHaveLength(0);
    });

    it("should query with the correct date range (dayStart and dayEnd)", async () => {
      // Arrange
      setupDailyDetailMocks([]);

      // Act
      await service.getDailyDetail("2025-06-15");

      // Assert: the findMany where clause has the correct UTC range
      const findManyCall =
        mockPrisma.creditTransaction.findMany.mock.calls[0][0];
      const { gte, lte } = findManyCall.where.createdAt;
      expect(gte.toISOString()).toBe("2025-06-15T00:00:00.000Z");
      expect(lte.toISOString()).toBe("2025-06-15T23:59:59.999Z");
    });
  });
});
