/**
 * CreditsController & AdminCreditsController unit tests
 *
 * CreditsController (route: "credits", JwtAuthGuard):
 * - GET  /          → getAccount
 * - GET  /balance   → getBalance
 * - GET  /stats     → getStats
 * - GET  /transactions → getTransactions
 * - GET  /checkin/status → getCheckinStatus
 * - POST /checkin       → performCheckin
 * - GET  /checkin/history → getCheckinHistory
 * - GET  /rules         → getRules
 * - GET  /estimate      → estimateCredits
 *
 * AdminCreditsController (route: "admin/credits", JwtAuthGuard + AdminGuard):
 * - POST /grant          → grantCredits
 * - POST /grant/batch    → batchGrantCredits
 * - POST /freeze         → freezeAccount
 * - POST /unfreeze       → unfreezeAccount
 * - GET  /account/:userId → getUserAccount
 * - POST /rules/update   → updateRule
 * - POST /rules/refresh  → refreshRulesCache
 * - POST /init-all       → initAllUserAccounts
 */

// Module-level mocks to prevent transitive import failures
jest.mock("@nestjs/cache-manager", () => ({ CACHE_MANAGER: "CACHE_MANAGER" }));
jest.mock("cache-manager", () => ({}));
jest.mock("ioredis", () => ({}));

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { CreditTransactionType } from "@prisma/client";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { AdminGuard } from "@/common/guards/admin.guard";
import { CreditsController } from "../credits.controller";
import { AdminCreditsController } from "../../../admin/credits/admin-credits.controller";
import { CreditsService } from "@/modules/platform/credits/credits.service";
import { CheckinService } from "@/modules/platform/credits/rewards/checkin.service";
import { CreditRulesService } from "@/modules/platform/credits/policies/credit-rules.service";
import { TransactionQueryDto } from "../dto/transaction-query.dto";
import {
  AdminGrantCreditsDto,
  BatchGrantCreditsDto,
} from "../../../admin/credits/dto/grant-credits.dto";

// ---------------------------------------------------------------------------
// Mock service factories
// ---------------------------------------------------------------------------

const mockCreditsService = {
  getOrCreateAccount: jest.fn(),
  getBalance: jest.fn(),
  getCreditsStats: jest.fn(),
  getTransactions: jest.fn(),
  grantCredits: jest.fn(),
  freezeAccount: jest.fn(),
  unfreezeAccount: jest.fn(),
  estimateCredits: jest.fn(),
  initializeAllUserAccounts: jest.fn(),
  getAccount: jest.fn(),
};

const mockCheckinService = {
  getCheckinStatus: jest.fn(),
  performCheckin: jest.fn(),
  getCheckinHistory: jest.fn(),
};

const mockCreditRulesService = {
  getAllRules: jest.fn(),
  updateRule: jest.fn(),
  refreshCache: jest.fn(),
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const USER_ID = "user-1";

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: USER_ID, email: "test@example.com" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CreditsController
// ---------------------------------------------------------------------------

describe("CreditsController", () => {
  let controller: CreditsController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ limit: 100, ttl: 60000 }])],
      controllers: [CreditsController],
      providers: [
        { provide: CreditsService, useValue: mockCreditsService },
        { provide: CheckinService, useValue: mockCheckinService },
        { provide: CreditRulesService, useValue: mockCreditRulesService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CreditsController>(CreditsController);
  });

  // -------------------------------------------------------------------------
  // GET / → getAccount
  // -------------------------------------------------------------------------

  describe("getAccount()", () => {
    it("returns the credit account for the authenticated user", async () => {
      const account = { id: "acct-1", userId: USER_ID, balance: 5000 };
      mockCreditsService.getOrCreateAccount.mockResolvedValue(account);

      const result = await controller.getAccount(makeRequest());

      expect(mockCreditsService.getOrCreateAccount).toHaveBeenCalledWith(
        USER_ID,
      );
      expect(result).toEqual(account);
    });

    it("propagates errors from CreditsService", async () => {
      mockCreditsService.getOrCreateAccount.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(controller.getAccount(makeRequest())).rejects.toThrow(
        "DB error",
      );
    });
  });

  // -------------------------------------------------------------------------
  // GET /balance → getBalance
  // -------------------------------------------------------------------------

  describe("getBalance()", () => {
    it("returns the balance for the authenticated user", async () => {
      mockCreditsService.getBalance.mockResolvedValue(1234);

      const result = await controller.getBalance(makeRequest());

      expect(mockCreditsService.getBalance).toHaveBeenCalledWith(USER_ID);
      expect(result).toBe(1234);
    });

    it("propagates service errors", async () => {
      mockCreditsService.getBalance.mockRejectedValue(new Error("not found"));

      await expect(controller.getBalance(makeRequest())).rejects.toThrow(
        "not found",
      );
    });
  });

  // -------------------------------------------------------------------------
  // GET /stats → getStats
  // -------------------------------------------------------------------------

  describe("getStats()", () => {
    it("returns credit stats for the authenticated user", async () => {
      const stats = { totalEarned: 10000, totalSpent: 5000 };
      mockCreditsService.getCreditsStats.mockResolvedValue(stats);

      const result = await controller.getStats(makeRequest());

      expect(mockCreditsService.getCreditsStats).toHaveBeenCalledWith(USER_ID);
      expect(result).toEqual(stats);
    });

    it("propagates service errors", async () => {
      mockCreditsService.getCreditsStats.mockRejectedValue(
        new Error("stats error"),
      );

      await expect(controller.getStats(makeRequest())).rejects.toThrow(
        "stats error",
      );
    });
  });

  // -------------------------------------------------------------------------
  // GET /transactions → getTransactions
  // -------------------------------------------------------------------------

  describe("getTransactions()", () => {
    it("returns paginated transactions with query params", async () => {
      const paginated = { data: [], total: 0, limit: 20, offset: 0 };
      mockCreditsService.getTransactions.mockResolvedValue(paginated);

      const query: TransactionQueryDto = { limit: 20, offset: 0 };
      const result = await controller.getTransactions(makeRequest(), query);

      expect(mockCreditsService.getTransactions).toHaveBeenCalledWith(
        USER_ID,
        query,
      );
      expect(result).toEqual(paginated);
    });

    it("forwards type filter in query", async () => {
      const paginated = { data: [{ id: "txn-1" }], total: 1 };
      mockCreditsService.getTransactions.mockResolvedValue(paginated);

      const query: TransactionQueryDto = {
        type: CreditTransactionType.ADMIN_GRANT,
        limit: 10,
        offset: 0,
      };
      await controller.getTransactions(makeRequest(), query);

      expect(mockCreditsService.getTransactions).toHaveBeenCalledWith(
        USER_ID,
        query,
      );
    });

    it("propagates service errors", async () => {
      mockCreditsService.getTransactions.mockRejectedValue(
        new Error("query error"),
      );

      await expect(
        controller.getTransactions(makeRequest(), {}),
      ).rejects.toThrow("query error");
    });
  });

  // -------------------------------------------------------------------------
  // GET /checkin/status → getCheckinStatus
  // -------------------------------------------------------------------------

  describe("getCheckinStatus()", () => {
    it("returns check-in status for the authenticated user", async () => {
      const status = { checkedIn: false, streak: 3 };
      mockCheckinService.getCheckinStatus.mockResolvedValue(status);

      const result = await controller.getCheckinStatus(makeRequest());

      expect(mockCheckinService.getCheckinStatus).toHaveBeenCalledWith(USER_ID);
      expect(result).toEqual(status);
    });

    it("propagates service errors", async () => {
      mockCheckinService.getCheckinStatus.mockRejectedValue(
        new Error("checkin error"),
      );

      await expect(controller.getCheckinStatus(makeRequest())).rejects.toThrow(
        "checkin error",
      );
    });
  });

  // -------------------------------------------------------------------------
  // POST /checkin → performCheckin
  // -------------------------------------------------------------------------

  describe("performCheckin()", () => {
    it("performs check-in and returns result", async () => {
      const checkinResult = { success: true, creditsEarned: 50, streak: 4 };
      mockCheckinService.performCheckin.mockResolvedValue(checkinResult);

      const result = await controller.performCheckin(
        makeRequest(),
        "127.0.0.1",
      );

      expect(mockCheckinService.performCheckin).toHaveBeenCalledWith(
        USER_ID,
        "127.0.0.1",
      );
      expect(result).toEqual(checkinResult);
    });

    it("propagates already-checked-in error", async () => {
      mockCheckinService.performCheckin.mockRejectedValue(
        new Error("Already checked in today"),
      );

      await expect(
        controller.performCheckin(makeRequest(), "127.0.0.1"),
      ).rejects.toThrow("Already checked in today");
    });
  });

  // -------------------------------------------------------------------------
  // GET /checkin/history → getCheckinHistory
  // -------------------------------------------------------------------------

  describe("getCheckinHistory()", () => {
    it("returns check-in history with default limit 30", async () => {
      const history = [{ date: "2026-03-01", credits: 50 }];
      mockCheckinService.getCheckinHistory.mockResolvedValue(history);

      const result = await controller.getCheckinHistory(makeRequest());

      expect(mockCheckinService.getCheckinHistory).toHaveBeenCalledWith(
        USER_ID,
        30,
      );
      expect(result).toEqual(history);
    });

    it("uses provided limit when supplied", async () => {
      mockCheckinService.getCheckinHistory.mockResolvedValue([]);

      await controller.getCheckinHistory(makeRequest(), 7);

      expect(mockCheckinService.getCheckinHistory).toHaveBeenCalledWith(
        USER_ID,
        7,
      );
    });

    it("propagates service errors", async () => {
      mockCheckinService.getCheckinHistory.mockRejectedValue(
        new Error("history error"),
      );

      await expect(controller.getCheckinHistory(makeRequest())).rejects.toThrow(
        "history error",
      );
    });
  });

  // -------------------------------------------------------------------------
  // GET /rules → getRules
  // -------------------------------------------------------------------------

  describe("getRules()", () => {
    it("returns mapped active rules", async () => {
      const rawRules = [
        {
          moduleType: "RESEARCH",
          operationType: "SEARCH",
          baseCredits: 10,
          name: "Research Search",
          isActive: true,
          internalField: "should-be-stripped",
        },
      ];
      mockCreditRulesService.getAllRules.mockResolvedValue(rawRules);

      const result = await controller.getRules();

      expect(mockCreditRulesService.getAllRules).toHaveBeenCalled();
      expect(result).toEqual([
        {
          moduleType: "RESEARCH",
          operationType: "SEARCH",
          baseCredits: 10,
          name: "Research Search",
          isActive: true,
        },
      ]);
    });

    it("returns an empty array when no rules exist", async () => {
      mockCreditRulesService.getAllRules.mockResolvedValue([]);

      const result = await controller.getRules();

      expect(result).toEqual([]);
    });

    it("propagates service errors", async () => {
      mockCreditRulesService.getAllRules.mockRejectedValue(
        new Error("rules error"),
      );

      await expect(controller.getRules()).rejects.toThrow("rules error");
    });
  });

  // -------------------------------------------------------------------------
  // GET /estimate → estimateCredits
  // -------------------------------------------------------------------------

  describe("estimateCredits()", () => {
    it("returns estimated credits with parsed numeric tokenCount", async () => {
      mockCreditsService.estimateCredits.mockResolvedValue(25);

      const result = await controller.estimateCredits(
        "RESEARCH",
        "SEARCH",
        1000,
        "gpt-4",
      );

      expect(mockCreditsService.estimateCredits).toHaveBeenCalledWith(
        "RESEARCH",
        "SEARCH",
        1000,
        "gpt-4",
      );
      expect(result).toEqual({
        estimatedCredits: 25,
        moduleType: "RESEARCH",
        operationType: "SEARCH",
      });
    });

    it("passes undefined tokenCount and modelName when omitted", async () => {
      mockCreditsService.estimateCredits.mockResolvedValue(5);

      const result = await controller.estimateCredits("ASK", "CHAT");

      expect(mockCreditsService.estimateCredits).toHaveBeenCalledWith(
        "ASK",
        "CHAT",
        undefined,
        undefined,
      );
      expect(result).toEqual({
        estimatedCredits: 5,
        moduleType: "ASK",
        operationType: "CHAT",
      });
    });

    it("propagates service errors", async () => {
      mockCreditsService.estimateCredits.mockRejectedValue(
        new Error("estimate error"),
      );

      await expect(controller.estimateCredits("UNKNOWN", "OP")).rejects.toThrow(
        "estimate error",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// AdminCreditsController
// ---------------------------------------------------------------------------

describe("AdminCreditsController", () => {
  let controller: AdminCreditsController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ limit: 100, ttl: 60000 }])],
      controllers: [AdminCreditsController],
      providers: [
        { provide: CreditsService, useValue: mockCreditsService },
        { provide: CreditRulesService, useValue: mockCreditRulesService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AdminCreditsController>(AdminCreditsController);
  });

  // -------------------------------------------------------------------------
  // POST /grant → grantCredits
  // -------------------------------------------------------------------------

  describe("grantCredits()", () => {
    it("grants credits and returns transaction result", async () => {
      const txResult = { id: "txn-1", balance: 6000 };
      mockCreditsService.grantCredits.mockResolvedValue(txResult);

      const dto: AdminGrantCreditsDto = {
        userId: "user-2",
        amount: 1000,
        description: "Welcome bonus",
        type: CreditTransactionType.ADMIN_GRANT,
      };
      const result = await controller.grantCredits(dto);

      expect(mockCreditsService.grantCredits).toHaveBeenCalledWith(
        "user-2",
        1000,
        CreditTransactionType.ADMIN_GRANT,
        "Welcome bonus",
      );
      expect(result).toEqual(txResult);
    });

    it("defaults type to ADMIN_GRANT when not provided", async () => {
      mockCreditsService.grantCredits.mockResolvedValue({ id: "txn-2" });

      const dto: AdminGrantCreditsDto = {
        userId: "user-3",
        amount: 500,
        description: "Top-up",
        type: CreditTransactionType.ADMIN_GRANT,
      };
      await controller.grantCredits(dto);

      expect(mockCreditsService.grantCredits).toHaveBeenCalledWith(
        "user-3",
        500,
        CreditTransactionType.ADMIN_GRANT,
        "Top-up",
      );
    });

    it("propagates service errors", async () => {
      mockCreditsService.grantCredits.mockRejectedValue(
        new NotFoundException("User not found"),
      );

      const dto: AdminGrantCreditsDto = {
        userId: "ghost",
        amount: 100,
        description: "test",
        type: CreditTransactionType.ADMIN_GRANT,
      };

      await expect(controller.grantCredits(dto)).rejects.toThrow(
        "User not found",
      );
    });
  });

  // -------------------------------------------------------------------------
  // POST /grant/batch → batchGrantCredits
  // -------------------------------------------------------------------------

  describe("batchGrantCredits()", () => {
    it("grants credits to all users and returns counts", async () => {
      mockCreditsService.grantCredits.mockResolvedValue({ balance: 5000 });

      const dto: BatchGrantCreditsDto = {
        userIds: ["user-a", "user-b"],
        amount: 200,
        description: "Batch promo",
      };
      const result = await controller.batchGrantCredits(dto);

      expect(mockCreditsService.grantCredits).toHaveBeenCalledTimes(2);
      expect(result.total).toBe(2);
      expect(result.successCount).toBe(2);
      expect(result.failedCount).toBe(0);
      expect(result.results).toHaveLength(2);
    });

    it("counts partial failures correctly", async () => {
      mockCreditsService.grantCredits
        .mockResolvedValueOnce({ balance: 5000 })
        .mockRejectedValueOnce(new Error("Account frozen"));

      const dto: BatchGrantCreditsDto = {
        userIds: ["user-ok", "user-frozen"],
        amount: 100,
        description: "Partial batch",
      };
      const result = await controller.batchGrantCredits(dto);

      expect(result.total).toBe(2);
      expect(result.successCount).toBe(1);
      expect(result.failedCount).toBe(1);

      const failed = result.results.find((r) => r.userId === "user-frozen");
      expect(failed?.success).toBe(false);
      expect(
        (failed as { success: false; userId: string; error: string }).error,
      ).toBe("Account frozen");
    });

    it("handles all failures gracefully", async () => {
      mockCreditsService.grantCredits.mockRejectedValue(new Error("DB down"));

      const dto: BatchGrantCreditsDto = {
        userIds: ["u1", "u2", "u3"],
        amount: 50,
        description: "Failed batch",
      };
      const result = await controller.batchGrantCredits(dto);

      expect(result.successCount).toBe(0);
      expect(result.failedCount).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // POST /freeze → freezeAccount
  // -------------------------------------------------------------------------

  describe("freezeAccount()", () => {
    it("freezes account and returns success message", async () => {
      mockCreditsService.freezeAccount.mockResolvedValue(undefined);

      const result = await controller.freezeAccount({
        userId: "user-2",
        reason: "Suspicious activity",
      });

      expect(mockCreditsService.freezeAccount).toHaveBeenCalledWith(
        "user-2",
        "Suspicious activity",
      );
      expect(result).toEqual({ message: "Account frozen successfully" });
    });

    it("propagates service errors", async () => {
      mockCreditsService.freezeAccount.mockRejectedValue(
        new NotFoundException("Account not found"),
      );

      await expect(
        controller.freezeAccount({ userId: "ghost", reason: "test" }),
      ).rejects.toThrow("Account not found");
    });
  });

  // -------------------------------------------------------------------------
  // POST /unfreeze → unfreezeAccount
  // -------------------------------------------------------------------------

  describe("unfreezeAccount()", () => {
    it("unfreezes account and returns success message", async () => {
      mockCreditsService.unfreezeAccount.mockResolvedValue(undefined);

      const result = await controller.unfreezeAccount({ userId: "user-2" });

      expect(mockCreditsService.unfreezeAccount).toHaveBeenCalledWith("user-2");
      expect(result).toEqual({ message: "Account unfrozen successfully" });
    });

    it("propagates service errors", async () => {
      mockCreditsService.unfreezeAccount.mockRejectedValue(
        new Error("unfreeze error"),
      );

      await expect(
        controller.unfreezeAccount({ userId: "user-2" }),
      ).rejects.toThrow("unfreeze error");
    });
  });

  // -------------------------------------------------------------------------
  // GET /account/:userId → getUserAccount
  // -------------------------------------------------------------------------

  describe("getUserAccount()", () => {
    it("returns account and stats for given userId", async () => {
      const account = { id: "acct-1", userId: "user-2", balance: 3000 };
      const stats = { totalEarned: 8000, totalSpent: 5000 };
      mockCreditsService.getAccount.mockResolvedValue(account);
      mockCreditsService.getCreditsStats.mockResolvedValue(stats);

      const result = await controller.getUserAccount("user-2");

      expect(mockCreditsService.getAccount).toHaveBeenCalledWith("user-2");
      expect(mockCreditsService.getCreditsStats).toHaveBeenCalledWith("user-2");
      expect(result).toEqual({ account, stats });
    });

    it("propagates not-found error from getAccount", async () => {
      mockCreditsService.getAccount.mockRejectedValue(
        new NotFoundException("Account not found"),
      );

      await expect(controller.getUserAccount("ghost")).rejects.toThrow(
        "Account not found",
      );
    });

    it("propagates not-found error from getCreditsStats", async () => {
      mockCreditsService.getAccount.mockResolvedValue({ id: "acct-1" });
      mockCreditsService.getCreditsStats.mockRejectedValue(
        new NotFoundException("Stats not found"),
      );

      await expect(controller.getUserAccount("user-2")).rejects.toThrow(
        "Stats not found",
      );
    });
  });

  // -------------------------------------------------------------------------
  // POST /rules/update → updateRule
  // -------------------------------------------------------------------------

  describe("updateRule()", () => {
    it("updates a credit rule and returns updated rule", async () => {
      const updatedRule = {
        moduleType: "RESEARCH",
        operationType: "SEARCH",
        baseCredits: 15,
        isActive: true,
      };
      mockCreditRulesService.updateRule.mockResolvedValue(updatedRule);

      const result = await controller.updateRule({
        moduleType: "RESEARCH",
        operationType: "SEARCH",
        baseCredits: 15,
        isActive: true,
      });

      expect(mockCreditRulesService.updateRule).toHaveBeenCalledWith(
        "RESEARCH",
        "SEARCH",
        { baseCredits: 15, isActive: true },
      );
      expect(result).toEqual(updatedRule);
    });

    it("passes only provided optional fields", async () => {
      mockCreditRulesService.updateRule.mockResolvedValue({});

      await controller.updateRule({
        moduleType: "ASK",
        operationType: "CHAT",
        tokenMultiplier: 0.5,
      });

      expect(mockCreditRulesService.updateRule).toHaveBeenCalledWith(
        "ASK",
        "CHAT",
        { tokenMultiplier: 0.5 },
      );
    });

    it("propagates service errors", async () => {
      mockCreditRulesService.updateRule.mockRejectedValue(
        new NotFoundException("Rule not found"),
      );

      await expect(
        controller.updateRule({
          moduleType: "UNKNOWN",
          operationType: "OP",
        }),
      ).rejects.toThrow("Rule not found");
    });
  });

  // -------------------------------------------------------------------------
  // POST /rules/refresh → refreshRulesCache
  // -------------------------------------------------------------------------

  describe("refreshRulesCache()", () => {
    it("refreshes cache and returns confirmation message", async () => {
      mockCreditRulesService.refreshCache.mockResolvedValue(undefined);

      const result = await controller.refreshRulesCache();

      expect(mockCreditRulesService.refreshCache).toHaveBeenCalled();
      expect(result).toEqual({ message: "Rules cache refreshed" });
    });

    it("propagates service errors", async () => {
      mockCreditRulesService.refreshCache.mockRejectedValue(
        new Error("cache error"),
      );

      await expect(controller.refreshRulesCache()).rejects.toThrow(
        "cache error",
      );
    });
  });

  // -------------------------------------------------------------------------
  // POST /init-all → initAllUserAccounts
  // -------------------------------------------------------------------------

  describe("initAllUserAccounts()", () => {
    it("initializes all user accounts and returns result", async () => {
      const initResult = { initialized: 150, skipped: 3 };
      mockCreditsService.initializeAllUserAccounts.mockResolvedValue(
        initResult,
      );

      const result = await controller.initAllUserAccounts();

      expect(mockCreditsService.initializeAllUserAccounts).toHaveBeenCalled();
      expect(result).toEqual(initResult);
    });

    it("propagates service errors", async () => {
      mockCreditsService.initializeAllUserAccounts.mockRejectedValue(
        new Error("init error"),
      );

      await expect(controller.initAllUserAccounts()).rejects.toThrow(
        "init error",
      );
    });
  });
});
