import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { CheckinService } from "../checkin.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { CreditsService } from "../../credits.service";
import { AlreadyCheckedInException } from "../../exceptions/insufficient-credits.exception";

describe("CheckinService", () => {
  let service: CheckinService;
  let mockPrisma: jest.Mocked<Partial<PrismaService>>;
  let mockCreditsService: jest.Mocked<Partial<CreditsService>>;

  const makeOldDate = (daysAgo: number): Date => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  };

  const makeTodayDate = (): Date => {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  };

  const makeAccount = (overrides: Record<string, unknown> = {}) => {
    const base: Record<string, unknown> = {
      id: "account-1",
      userId: "user-1",
      balance: 100,
      totalEarned: 500,
      createdAt: makeOldDate(30), // 30 days old — past the 24h wait
      checkins: [],
    };
    return { ...base, ...overrides };
  };

  beforeEach(async () => {
    mockPrisma = {
      creditAccount: {
        findUnique: jest.fn(),
      } as unknown as PrismaService["creditAccount"],
      dailyCheckin: {
        count: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
      } as unknown as PrismaService["dailyCheckin"],
      creditTransaction: {
        create: jest.fn(),
      } as unknown as PrismaService["creditTransaction"],
      $transaction: jest
        .fn()
        .mockImplementation((fn: (tx: unknown) => unknown) =>
          fn(mockPrisma as unknown),
        ),
    };

    mockCreditsService = {
      getOrCreateAccount: jest.fn().mockResolvedValue({ id: "account-1" }),
      addCredits: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckinService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CreditsService, useValue: mockCreditsService },
      ],
    }).compile();

    service = module.get<CheckinService>(CheckinService);
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==================== getCheckinStatus ====================

  describe("getCheckinStatus", () => {
    it("returns cannot-checkin for empty userId", async () => {
      const result = await service.getCheckinStatus("");
      expect(result.canCheckin).toBe(false);
      expect(result.message).toBe("User not authenticated");
    });

    it("creates account and returns wait status for brand-new user", async () => {
      (mockPrisma.creditAccount!.findUnique as jest.Mock).mockResolvedValueOnce(
        null,
      );

      const result = await service.getCheckinStatus("user-new");
      expect(result.canCheckin).toBe(false);
      expect(result.message).toContain("新账户需要等待");
      expect(mockCreditsService.getOrCreateAccount).toHaveBeenCalledWith(
        "user-new",
      );
    });

    it("returns wait status when account is less than 24h old", async () => {
      const newAccount = makeAccount({ createdAt: new Date() }); // just created
      newAccount.checkins = [];
      (mockPrisma.creditAccount!.findUnique as jest.Mock).mockResolvedValueOnce(
        newAccount,
      );

      const result = await service.getCheckinStatus("user-1");
      expect(result.canCheckin).toBe(false);
      expect(result.message).toContain("新账户需要等待");
    });

    it("returns canCheckin true when account has no prior checkins", async () => {
      const account = makeAccount({ checkins: [] });
      (mockPrisma.creditAccount!.findUnique as jest.Mock).mockResolvedValueOnce(
        account,
      );

      const result = await service.getCheckinStatus("user-1");
      expect(result.canCheckin).toBe(true);
      expect(result.hasCheckedInToday).toBe(false);
      expect(result.streakDays).toBe(0);
    });

    it("returns already-checked-in status when last checkin is today", async () => {
      const today = makeTodayDate();
      const account = makeAccount({
        checkins: [{ checkinDate: today, streakDays: 3 }],
      });
      (mockPrisma.creditAccount!.findUnique as jest.Mock).mockResolvedValueOnce(
        account,
      );

      const result = await service.getCheckinStatus("user-1");
      expect(result.canCheckin).toBe(false);
      expect(result.hasCheckedInToday).toBe(true);
      expect(result.streakDays).toBe(3);
    });

    it("returns canCheckin true with streak when last checkin was yesterday", async () => {
      const yesterday = makeOldDate(1);
      const account = makeAccount({
        checkins: [{ checkinDate: yesterday, streakDays: 5 }],
      });
      (mockPrisma.creditAccount!.findUnique as jest.Mock).mockResolvedValueOnce(
        account,
      );

      const result = await service.getCheckinStatus("user-1");
      expect(result.canCheckin).toBe(true);
      expect(result.streakDays).toBe(5);
    });

    it("returns canCheckin true with zero streak when last checkin was 2+ days ago", async () => {
      const twoDaysAgo = makeOldDate(2);
      const account = makeAccount({
        checkins: [{ checkinDate: twoDaysAgo, streakDays: 10 }],
      });
      (mockPrisma.creditAccount!.findUnique as jest.Mock).mockResolvedValueOnce(
        account,
      );

      const result = await service.getCheckinStatus("user-1");
      expect(result.canCheckin).toBe(true);
      expect(result.streakDays).toBe(0); // streak reset
    });

    it("returns cached status on second call within TTL", async () => {
      const account = makeAccount({ checkins: [] });
      (mockPrisma.creditAccount!.findUnique as jest.Mock).mockResolvedValue(
        account,
      );

      await service.getCheckinStatus("user-1");
      await service.getCheckinStatus("user-1");

      // Should only hit DB once due to caching
      expect(mockPrisma.creditAccount!.findUnique).toHaveBeenCalledTimes(1);
    });

    it("clears cache on clearUserCache call", async () => {
      const account = makeAccount({ checkins: [] });
      (mockPrisma.creditAccount!.findUnique as jest.Mock).mockResolvedValue(
        account,
      );

      await service.getCheckinStatus("user-1");
      service.clearUserCache("user-1");
      await service.getCheckinStatus("user-1");

      expect(mockPrisma.creditAccount!.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  // ==================== performCheckin ====================

  describe("performCheckin", () => {
    it("returns failure for empty userId", async () => {
      const result = await service.performCheckin("");
      expect(result.success).toBe(false);
      expect(result.message).toBe("User not authenticated");
    });

    it("throws AlreadyCheckedInException when already checked in today", async () => {
      const today = makeTodayDate();
      const account = makeAccount({
        checkins: [{ checkinDate: today, streakDays: 1 }],
      });
      (mockPrisma.creditAccount!.findUnique as jest.Mock).mockResolvedValue(
        account,
      );

      await expect(service.performCheckin("user-1")).rejects.toThrow(
        AlreadyCheckedInException,
      );
    });

    it("returns blocked result when IP limit exceeded", async () => {
      const account = makeAccount({ checkins: [] });
      (mockPrisma.creditAccount!.findUnique as jest.Mock).mockResolvedValue(
        account,
      );
      (mockPrisma.dailyCheckin!.count as jest.Mock).mockResolvedValue(3); // >= maxAccountsPerIp

      const result = await service.performCheckin("user-1", "10.0.0.1");
      expect(result.success).toBe(false);
      expect(result.message).toContain("Too many check-ins");
    });

    it("returns failure for new account under 24h restriction", async () => {
      // First call: getCheckinStatus — account with no checkins but old enough
      const oldAccount = makeAccount({ checkins: [] });
      // Second call: performCheckin direct account check — account just created
      const newAccount = makeAccount({ createdAt: new Date() });

      (mockPrisma.creditAccount!.findUnique as jest.Mock)
        .mockResolvedValueOnce(oldAccount) // status check
        .mockResolvedValueOnce(newAccount); // anti-abuse check
      (mockPrisma.dailyCheckin!.count as jest.Mock).mockResolvedValue(0);

      const result = await service.performCheckin("user-1");
      expect(result.success).toBe(false);
      expect(result.message).toContain("New accounts must wait");
    });

    it("executes successful base checkin (day 1)", async () => {
      const account = makeAccount({ checkins: [] });
      (mockPrisma.creditAccount!.findUnique as jest.Mock).mockResolvedValue(
        account,
      );
      (mockPrisma.dailyCheckin!.count as jest.Mock).mockResolvedValue(0);
      (mockPrisma.dailyCheckin!.create as jest.Mock).mockResolvedValue({
        id: "checkin-1",
      });
      (mockPrisma.creditTransaction!.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.creditAccount!.findUnique as jest.Mock).mockResolvedValue(
        account,
      );
      // For $transaction: return the mocked inner call
      (mockPrisma.$transaction as jest.Mock).mockImplementation(
        (fn: (tx: unknown) => unknown) => {
          const txMock = {
            creditAccount: {
              findUnique: jest.fn().mockResolvedValue(account),
              update: jest.fn().mockResolvedValue({ ...account, balance: 150 }),
            },
            dailyCheckin: {
              create: jest.fn().mockResolvedValue({ id: "checkin-1" }),
            },
            creditTransaction: {
              create: jest.fn().mockResolvedValue({}),
            },
          };
          return fn(txMock);
        },
      );

      const result = await service.performCheckin("user-1");
      expect(result.success).toBe(true);
      expect(result.creditsEarned).toBe(50); // base reward
      expect(result.streakDays).toBe(1);
      expect(result.isStreakBonus).toBe(false);
    });

    it("grants streak7 bonus on day 7", async () => {
      // Last checkin was yesterday, streak at 6 → will become 7
      const yesterday = makeOldDate(1);
      const account = makeAccount({
        checkins: [{ checkinDate: yesterday, streakDays: 6 }],
      });
      (mockPrisma.creditAccount!.findUnique as jest.Mock).mockResolvedValue(
        account,
      );
      (mockPrisma.dailyCheckin!.count as jest.Mock).mockResolvedValue(0);

      (mockPrisma.$transaction as jest.Mock).mockImplementation(
        (fn: (tx: unknown) => unknown) => {
          const txMock = {
            creditAccount: {
              findUnique: jest.fn().mockResolvedValue(account),
              update: jest.fn().mockResolvedValue(account),
            },
            dailyCheckin: {
              create: jest.fn().mockResolvedValue({ id: "checkin-7" }),
            },
            creditTransaction: {
              create: jest.fn().mockResolvedValue({}),
            },
          };
          return fn(txMock);
        },
      );

      const result = await service.performCheckin("user-1");
      expect(result.success).toBe(true);
      expect(result.creditsEarned).toBe(100); // streak7 reward
      expect(result.isStreakBonus).toBe(true);
      expect(result.bonusType).toBe("streak7");
    });

    it("grants streak30 bonus on day 30", async () => {
      const yesterday = makeOldDate(1);
      const account = makeAccount({
        checkins: [{ checkinDate: yesterday, streakDays: 29 }],
      });
      (mockPrisma.creditAccount!.findUnique as jest.Mock).mockResolvedValue(
        account,
      );
      (mockPrisma.dailyCheckin!.count as jest.Mock).mockResolvedValue(0);

      (mockPrisma.$transaction as jest.Mock).mockImplementation(
        (fn: (tx: unknown) => unknown) => {
          const txMock = {
            creditAccount: {
              findUnique: jest.fn().mockResolvedValue(account),
              update: jest.fn().mockResolvedValue(account),
            },
            dailyCheckin: {
              create: jest.fn().mockResolvedValue({ id: "checkin-30" }),
            },
            creditTransaction: {
              create: jest.fn().mockResolvedValue({}),
            },
          };
          return fn(txMock);
        },
      );

      const result = await service.performCheckin("user-1");
      expect(result.success).toBe(true);
      expect(result.creditsEarned).toBe(300); // streak30 reward
      expect(result.isStreakBonus).toBe(true);
      expect(result.bonusType).toBe("streak30");
    });
  });

  // ==================== getCheckinHistory ====================

  describe("getCheckinHistory", () => {
    it("returns empty array for empty userId", async () => {
      const result = await service.getCheckinHistory("");
      expect(result).toEqual([]);
    });

    it("returns empty array when account not found", async () => {
      (mockPrisma.creditAccount!.findUnique as jest.Mock).mockResolvedValue(
        null,
      );
      const result = await service.getCheckinHistory("user-1");
      expect(result).toEqual([]);
    });

    it("returns mapped checkin history", async () => {
      const account = makeAccount({});
      const checkins = [
        { checkinDate: makeOldDate(1), creditsEarned: 50, streakDays: 3 },
        { checkinDate: makeOldDate(2), creditsEarned: 50, streakDays: 2 },
      ];
      (mockPrisma.creditAccount!.findUnique as jest.Mock).mockResolvedValue(
        account,
      );
      (mockPrisma.dailyCheckin!.findMany as jest.Mock).mockResolvedValue(
        checkins,
      );

      const result = await service.getCheckinHistory("user-1");
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        date: checkins[0].checkinDate,
        credits: 50,
        streakDays: 3,
      });
    });

    it("respects limit parameter", async () => {
      const account = makeAccount({});
      (mockPrisma.creditAccount!.findUnique as jest.Mock).mockResolvedValue(
        account,
      );
      (mockPrisma.dailyCheckin!.findMany as jest.Mock).mockResolvedValue([]);

      await service.getCheckinHistory("user-1", 7);
      expect(mockPrisma.dailyCheckin!.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 7 }),
      );
    });
  });
});
