/**
 * CreditsService 单元测试
 *
 * 测试积分系统核心功能：
 * - getOrCreateAccount() 获取/创建账户
 * - checkBalance() 余额检查
 * - consumeCredits() 消费积分
 * - getTransactionHistory() 交易历史
 * - 低余额/冻结账户逻辑
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { CreditTransactionType, Prisma } from "@prisma/client";
import { CreditsService } from "../credits.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { CreditRulesService } from "../policies/credit-rules.service";
import { AuditLogService } from "../../monitoring/audit/audit-log.service";
import { InsufficientCreditsException } from "../exceptions/insufficient-credits.exception";
import { AccountFrozenException } from "../exceptions/insufficient-credits.exception";
import { ConsumeCreditsParams } from "../credits.types";
import { TransactionQueryDto } from "../../../open-api/user/credits/dto/transaction-query.dto";

describe("CreditsService", () => {
  let service: CreditsService;
  let mockPrisma: any;
  let mockRulesService: any;

  const mockAccount = {
    id: "acct-1",
    userId: "user-123",
    balance: 5000,
    totalEarned: 10000,
    totalSpent: 5000,
    giftBalance: 0,
    giftExpiresAt: null,
    isActive: true,
    isFrozen: false,
    todaySpent: 0,
    todayDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockPrisma = {
      creditAccount: {
        findUnique: jest.fn().mockResolvedValue(mockAccount),
        create: jest.fn().mockResolvedValue({
          ...mockAccount,
          id: "acct-new",
          balance: 10000,
          totalEarned: 10000,
          totalSpent: 0,
        }),
        update: jest.fn().mockImplementation(({ data }: any) => ({
          ...mockAccount,
          ...data,
        })),
        // 原子条件递减：默认成功（命中 1 行）。余额不足的测试会 override 为 { count: 0 }。
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        // 扣减后读回权威余额，供交易流水 balanceAfter。默认 5000 - 100 = 4900。
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...mockAccount,
          balance: 4900,
        }),
      },
      creditTransaction: {
        create: jest.fn().mockResolvedValue({
          id: "txn-1",
          accountId: "acct-1",
          type: "CONSUME",
          amount: -100,
          balanceAfter: 4900,
        }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue(null),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn().mockImplementation((fn: any) => fn(mockPrisma)),
    };

    mockRulesService = {
      getCreditsForOperation: jest.fn().mockReturnValue(100),
      isOperationAllowed: jest.fn().mockReturnValue(true),
      calculateCredits: jest.fn().mockResolvedValue(100),
      getRule: jest.fn().mockResolvedValue({ name: "AI问答对话" }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreditsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CreditRulesService, useValue: mockRulesService },
        {
          provide: AuditLogService,
          useValue: { record: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<CreditsService>(CreditsService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // getOrCreateAccount
  // =========================================================================

  describe("getOrCreateAccount", () => {
    it("should return existing account", async () => {
      const result = await service.getOrCreateAccount("user-123");

      expect(result).toBeDefined();
      expect(result.balance).toBe(5000);
      expect(mockPrisma.creditAccount.findUnique).toHaveBeenCalledWith({
        where: { userId: "user-123" },
      });
    });

    it("should create new account with welcome bonus when not exists", async () => {
      mockPrisma.creditAccount.findUnique.mockResolvedValue(null);

      await service.getOrCreateAccount("new-user");

      expect(mockPrisma.creditAccount.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "new-user",
          balance: 10000,
          totalEarned: 10000,
        }),
      });
      expect(mockPrisma.creditTransaction.create).toHaveBeenCalled();
    });

    it("should report low balance status", async () => {
      mockPrisma.creditAccount.findUnique.mockResolvedValue({
        ...mockAccount,
        balance: 200,
      });

      const result = await service.getOrCreateAccount("user-123");

      expect(result.isLow).toBe(true);
      expect(result.isCritical).toBe(false);
    });

    it("should report critical balance status", async () => {
      mockPrisma.creditAccount.findUnique.mockResolvedValue({
        ...mockAccount,
        balance: 50,
      });

      const result = await service.getOrCreateAccount("user-123");

      expect(result.isCritical).toBe(true);
    });

    it("should recover from P2002 race by re-fetching the winning account", async () => {
      // findUnique returns null (triggering create path), but create throws P2002 (concurrent pod won)
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed",
        { code: "P2002", clientVersion: "5.x" },
      );
      mockPrisma.creditAccount.findUnique
        .mockResolvedValueOnce(null) // initial check → no account
        .mockResolvedValueOnce({ ...mockAccount, balance: 10000 }); // re-fetch after P2002
      mockPrisma.creditAccount.create.mockRejectedValueOnce(p2002);

      const result = await service.getOrCreateAccount("new-user-race");

      expect(result.balance).toBe(10000);
      expect(mockPrisma.creditAccount.create).toHaveBeenCalledTimes(1);
      // Second findUnique fetches the existing account
      expect(mockPrisma.creditAccount.findUnique).toHaveBeenCalledTimes(2);
    });

    it("should rethrow non-P2002 errors from create", async () => {
      const dbErr = new Error("DB connection lost");
      mockPrisma.creditAccount.findUnique.mockResolvedValueOnce(null);
      mockPrisma.creditAccount.create.mockRejectedValueOnce(dbErr);

      await expect(service.getOrCreateAccount("err-user")).rejects.toThrow(
        "DB connection lost",
      );
    });
  });

  // =========================================================================
  // onModuleInit
  // =========================================================================

  describe("lifecycle", () => {
    it("should initialize without error", async () => {
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // getAccount
  // =========================================================================

  describe("getAccount", () => {
    it("should return formatted account info when account exists", async () => {
      const result = await service.getAccount("user-123");

      expect(result).not.toBeNull();
      expect(result!.balance).toBe(5000);
      expect(result!.totalEarned).toBe(10000);
      expect(result!.totalSpent).toBe(5000);
      expect(result!.isFrozen).toBe(false);
      expect(result!.isLow).toBe(false);
      expect(result!.isCritical).toBe(false);
      expect(mockPrisma.creditAccount.findUnique).toHaveBeenCalledWith({
        where: { userId: "user-123" },
      });
    });

    it("should return null when account does not exist", async () => {
      mockPrisma.creditAccount.findUnique.mockResolvedValue(null);

      const result = await service.getAccount("unknown-user");

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // getBalance
  // =========================================================================

  describe("getBalance", () => {
    it("should return balance with isLow false and isCritical false for healthy balance", async () => {
      mockPrisma.creditAccount.findUnique.mockResolvedValue({
        balance: 5000,
        todaySpent: 200,
        todayDate: new Date(),
      });

      const result = await service.getBalance("user-123");

      expect(result.balance).toBe(5000);
      expect(result.isLow).toBe(false);
      expect(result.isCritical).toBe(false);
      expect(result.todaySpent).toBe(200);
    });

    it("should return isLow true when balance is at low threshold", async () => {
      mockPrisma.creditAccount.findUnique.mockResolvedValue({
        balance: 500,
        todaySpent: 0,
        todayDate: null,
      });

      const result = await service.getBalance("user-123");

      expect(result.isLow).toBe(true);
      expect(result.isCritical).toBe(false);
    });

    it("should return isCritical true when balance is at critical threshold", async () => {
      mockPrisma.creditAccount.findUnique.mockResolvedValue({
        balance: 100,
        todaySpent: 0,
        todayDate: null,
      });

      const result = await service.getBalance("user-123");

      expect(result.isCritical).toBe(true);
    });

    it("should lazy-create account and return healthy balance when account does not exist", async () => {
      // First call (getBalance select) returns null; subsequent call (getOrCreateAccount) returns mock
      mockPrisma.creditAccount.findUnique
        .mockResolvedValueOnce(null) // getBalance select
        .mockResolvedValueOnce(null); // getOrCreateAccount findUnique → triggers create

      const result = await service.getBalance("no-account-user");

      // lazy-created account starts at 10000 — not critical
      expect(result.balance).toBe(10000);
      expect(result.isLow).toBe(false);
      expect(result.isCritical).toBe(false);
      expect(mockPrisma.creditAccount.create).toHaveBeenCalled();
    });

    it("should throw ServiceUnavailableException when DB query fails", async () => {
      mockPrisma.creditAccount.findUnique.mockRejectedValue(
        new Error("Connection refused"),
      );

      await expect(service.getBalance("user-123")).rejects.toThrow(
        "Credits service temporarily unavailable",
      );
    });

    it("should reset todaySpent to zero when todayDate is before today", async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      mockPrisma.creditAccount.findUnique.mockResolvedValue({
        balance: 3000,
        todaySpent: 500,
        todayDate: yesterday,
      });

      const result = await service.getBalance("user-123");

      expect(result.todaySpent).toBe(0);
    });

    it("should preserve todaySpent when todayDate is today", async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      mockPrisma.creditAccount.findUnique.mockResolvedValue({
        balance: 3000,
        todaySpent: 300,
        todayDate: today,
      });

      const result = await service.getBalance("user-123");

      expect(result.todaySpent).toBe(300);
    });
  });

  // =========================================================================
  // checkBalance
  // =========================================================================

  describe("checkBalance", () => {
    it("should return sufficient true when balance >= required", async () => {
      mockPrisma.creditAccount.findUnique.mockResolvedValue({
        balance: 5000,
        isFrozen: false,
      });

      const result = await service.checkBalance("user-123", 100);

      expect(result.sufficient).toBe(true);
      expect(result.balance).toBe(5000);
      expect(result.required).toBe(100);
      expect(result.deficit).toBe(0);
    });

    it("should return sufficient false and correct deficit when balance < required", async () => {
      mockPrisma.creditAccount.findUnique.mockResolvedValue({
        balance: 50,
        isFrozen: false,
      });

      const result = await service.checkBalance("user-123", 200);

      expect(result.sufficient).toBe(false);
      expect(result.balance).toBe(50);
      expect(result.required).toBe(200);
      expect(result.deficit).toBe(150);
    });

    it("should return sufficient false with balance 0 when account does not exist", async () => {
      mockPrisma.creditAccount.findUnique.mockResolvedValue(null);

      const result = await service.checkBalance("unknown-user", 100);

      expect(result.sufficient).toBe(false);
      expect(result.balance).toBe(0);
      expect(result.deficit).toBe(100);
    });

    it("should throw AccountFrozenException when account is frozen", async () => {
      mockPrisma.creditAccount.findUnique.mockResolvedValue({
        balance: 5000,
        isFrozen: true,
      });

      await expect(service.checkBalance("user-123", 100)).rejects.toThrow(
        AccountFrozenException,
      );
    });
  });

  // =========================================================================
  // estimateCredits
  // =========================================================================

  describe("estimateCredits", () => {
    it("should delegate to creditRulesService.calculateCredits with all params", async () => {
      mockRulesService.calculateCredits.mockResolvedValue(250);

      const result = await service.estimateCredits(
        "deep-research",
        "research-standard",
        2000,
        "gpt-4",
      );

      expect(result).toBe(250);
      expect(mockRulesService.calculateCredits).toHaveBeenCalledWith(
        "deep-research",
        "research-standard",
        2000,
        "gpt-4",
      );
    });

    it("should delegate with optional params undefined", async () => {
      mockRulesService.calculateCredits.mockResolvedValue(10);

      const result = await service.estimateCredits("ai-ask", "chat");

      expect(result).toBe(10);
      expect(mockRulesService.calculateCredits).toHaveBeenCalledWith(
        "ai-ask",
        "chat",
        undefined,
        undefined,
      );
    });
  });

  // =========================================================================
  // consumeCredits
  // =========================================================================

  describe("consumeCredits", () => {
    const baseParams: ConsumeCreditsParams = {
      userId: "user-123",
      moduleType: "ai-ask",
      operationType: "chat",
    };

    it("should deduct balance and create transaction on normal consumption", async () => {
      mockRulesService.calculateCredits.mockResolvedValue(100);
      mockPrisma.creditTransaction.create.mockResolvedValue({
        id: "txn-consume-1",
        amount: -100,
        balanceAfter: 4900,
      });

      const result = await service.consumeCredits(baseParams);

      expect(result.consumed).toBe(100);
      expect(result.balanceAfter).toBe(4900);
      expect(result.transactionId).toBe("txn-consume-1");
      // 原子条件递减：where 含 `balance >= cost` 守卫，data 用 decrement 而非绝对值。
      expect(mockPrisma.creditAccount.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ balance: { gte: 100 } }),
          data: expect.objectContaining({ balance: { decrement: 100 } }),
        }),
      );
    });

    it("should return existing transaction when idempotencyKey matches", async () => {
      mockPrisma.creditTransaction.findUnique.mockResolvedValue({
        id: "txn-existing",
        amount: -100,
        balanceAfter: 4900,
      });

      const result = await service.consumeCredits({
        ...baseParams,
        idempotencyKey: "key-abc",
      });

      expect(result.transactionId).toBe("txn-existing");
      expect(result.consumed).toBe(100);
      expect(result.balanceAfter).toBe(4900);
      // Should not enter the transaction block
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it("should throw InsufficientCreditsException when balance is too low", async () => {
      mockRulesService.calculateCredits.mockResolvedValue(9000);
      mockPrisma.creditAccount.findUnique.mockResolvedValue({
        ...mockAccount,
        balance: 500,
      });

      await expect(service.consumeCredits(baseParams)).rejects.toThrow(
        InsufficientCreditsException,
      );
    });

    it("should throw InsufficientCreditsException when a concurrent deduction wins the race (updateMany count=0)", async () => {
      // 快照显示余额充足（早检查通过），但原子 updateMany 因 `balance >= cost`
      // 守卫未命中任何行（并发扣减已抢先把余额用掉）→ count=0 → 必须抛错回滚，
      // 而不是写出负余额。这是 P0 lost-update 修复的核心保护。
      mockRulesService.calculateCredits.mockResolvedValue(100);
      mockPrisma.creditAccount.findUnique.mockResolvedValue({
        ...mockAccount,
        balance: 5000,
      });
      mockPrisma.creditAccount.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.consumeCredits(baseParams)).rejects.toThrow(
        InsufficientCreditsException,
      );
      // count=0 处已抛错：不应读回余额，也不应写交易流水。
      expect(mockPrisma.creditAccount.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(mockPrisma.creditTransaction.create).not.toHaveBeenCalled();
    });

    it("should throw AccountFrozenException when account is frozen", async () => {
      mockPrisma.creditAccount.findUnique.mockResolvedValue({
        ...mockAccount,
        isFrozen: true,
      });

      await expect(service.consumeCredits(baseParams)).rejects.toThrow(
        AccountFrozenException,
      );
    });

    it("should auto-create account if it does not exist and then consume", async () => {
      mockPrisma.creditAccount.findUnique.mockResolvedValue(null);
      mockRulesService.calculateCredits.mockResolvedValue(100);

      const newAccount = {
        ...mockAccount,
        id: "acct-new",
        balance: 10000,
        totalSpent: 0,
        todaySpent: 0,
        todayDate: null,
        isFrozen: false,
      };
      mockPrisma.creditAccount.create.mockResolvedValue(newAccount);
      // 新账户 10000 - 100 = 9900，读回权威余额。
      mockPrisma.creditAccount.findUniqueOrThrow.mockResolvedValue({
        ...newAccount,
        balance: 9900,
      });
      mockPrisma.creditTransaction.create.mockResolvedValue({
        id: "txn-auto",
        amount: -100,
        balanceAfter: 9900,
      });

      const result = await service.consumeCredits(baseParams);

      expect(mockPrisma.creditAccount.create).toHaveBeenCalled();
      expect(result.consumed).toBe(100);
      expect(result.balanceAfter).toBe(9900);
    });

    it("should accumulate todaySpent when todayDate is today", async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      mockPrisma.creditAccount.findUnique.mockResolvedValue({
        ...mockAccount,
        balance: 5000,
        todaySpent: 200,
        todayDate: today,
        isFrozen: false,
      });
      mockRulesService.calculateCredits.mockResolvedValue(100);
      mockPrisma.creditTransaction.create.mockResolvedValue({
        id: "txn-today",
        amount: -100,
        balanceAfter: 4900,
      });

      await service.consumeCredits(baseParams);

      // 同一天 → todaySpent 用 increment 累加（200 + 100，由 DB 原子完成）。
      expect(mockPrisma.creditAccount.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ todaySpent: { increment: 100 } }),
        }),
      );
    });

    it("should reset todaySpent when todayDate is in the past", async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      mockPrisma.creditAccount.findUnique.mockResolvedValue({
        ...mockAccount,
        balance: 5000,
        todaySpent: 999,
        todayDate: yesterday,
        isFrozen: false,
      });
      mockRulesService.calculateCredits.mockResolvedValue(100);
      mockPrisma.creditTransaction.create.mockResolvedValue({
        id: "txn-reset",
        amount: -100,
        balanceAfter: 4900,
      });

      await service.consumeCredits(baseParams);

      // 跨天 → todaySpent 重置为本次消费的绝对值。
      expect(mockPrisma.creditAccount.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ todaySpent: 100 }),
        }),
      );
    });

    it("should map moduleType to correct CreditTransactionType for ai-ask", async () => {
      mockRulesService.calculateCredits.mockResolvedValue(10);
      mockPrisma.creditTransaction.create.mockResolvedValue({
        id: "txn-type-test",
        amount: -10,
        balanceAfter: 4990,
      });

      await service.consumeCredits({ ...baseParams, moduleType: "ai-ask" });

      expect(mockPrisma.creditTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: CreditTransactionType.AI_ASK,
          }),
        }),
      );
    });

    it("should map unknown moduleType to ADJUSTMENT transaction type", async () => {
      mockRulesService.calculateCredits.mockResolvedValue(10);
      mockPrisma.creditTransaction.create.mockResolvedValue({
        id: "txn-adj",
        amount: -10,
        balanceAfter: 4990,
      });

      await service.consumeCredits({
        ...baseParams,
        moduleType: "completely-unknown-module",
      });

      expect(mockPrisma.creditTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: CreditTransactionType.ADJUSTMENT,
          }),
        }),
      );
    });
  });

  // =========================================================================
  // grantCredits
  // =========================================================================

  describe("grantCredits", () => {
    it("should increase balance for existing account and return transactionId", async () => {
      mockPrisma.creditTransaction.create.mockResolvedValue({
        id: "txn-grant-1",
        amount: 500,
        balanceAfter: 5500,
      });

      const result = await service.grantCredits(
        "user-123",
        500,
        CreditTransactionType.ADMIN_GRANT,
        "Top-up purchase",
      );

      expect(result.success).toBe(true);
      expect(result.balanceAfter).toBe(5500);
      expect(result.transactionId).toBe("txn-grant-1");
      expect(mockPrisma.creditAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ balance: 5500 }),
        }),
      );
    });

    it("should create account first when account does not exist before granting", async () => {
      mockPrisma.creditAccount.findUnique.mockResolvedValue(null);

      const newAccount = {
        ...mockAccount,
        id: "acct-grant-new",
        balance: 10000,
        totalEarned: 10000,
        totalSpent: 0,
      };
      mockPrisma.creditAccount.create.mockResolvedValue(newAccount);
      mockPrisma.creditTransaction.create
        .mockResolvedValueOnce({
          id: "txn-initial",
          amount: 10000,
          balanceAfter: 10000,
        })
        .mockResolvedValueOnce({
          id: "txn-grant-new",
          amount: 200,
          balanceAfter: 10200,
        });

      const result = await service.grantCredits(
        "brand-new-user",
        200,
        CreditTransactionType.TASK_REWARD,
        "Sign-up reward",
      );

      expect(mockPrisma.creditAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: "brand-new-user" }),
        }),
      );
      expect(result.success).toBe(true);
      expect(result.transactionId).toBe("txn-grant-new");
    });

    it("should pass referenceId to transaction when provided", async () => {
      mockPrisma.creditTransaction.create.mockResolvedValue({
        id: "txn-ref",
        amount: 100,
        balanceAfter: 5100,
      });

      await service.grantCredits(
        "user-123",
        100,
        CreditTransactionType.TASK_REWARD,
        "Bonus",
        "ref-order-99",
      );

      expect(mockPrisma.creditTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ referenceId: "ref-order-99" }),
        }),
      );
    });
  });

  // =========================================================================
  // refundCredits
  // =========================================================================

  describe("refundCredits", () => {
    it("should delegate to grantCredits with REFUND type and return success", async () => {
      mockPrisma.creditTransaction.create.mockResolvedValue({
        id: "txn-refund-1",
        amount: 300,
        balanceAfter: 5300,
      });

      const result = await service.refundCredits(
        "user-123",
        300,
        "ref-task-42",
        "Task failed",
      );

      expect(result.success).toBe(true);
      expect(result.balanceAfter).toBe(5300);
      expect(mockPrisma.creditTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: CreditTransactionType.REFUND,
            amount: 300,
            referenceId: "ref-task-42",
          }),
        }),
      );
    });
  });

  // =========================================================================
  // getTransactions
  // =========================================================================

  describe("getTransactions", () => {
    it("should return paginated results for existing account", async () => {
      const mockTxns = [
        {
          id: "t1",
          type: CreditTransactionType.AI_ASK,
          amount: -10,
          balanceAfter: 4990,
          description: "chat",
          moduleType: "ai-ask",
          operationType: "chat",
          tokenCount: null,
          modelName: null,
          createdAt: new Date("2026-01-01"),
        },
      ];
      mockPrisma.creditTransaction.findMany.mockResolvedValue(mockTxns);
      mockPrisma.creditTransaction.count.mockResolvedValue(1);

      const query: TransactionQueryDto = { limit: 20, offset: 0 };
      const result = await service.getTransactions("user-123", query);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe("t1");
      expect(result.total).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it("should return empty response when account does not exist", async () => {
      mockPrisma.creditAccount.findUnique.mockResolvedValue(null);

      const query: TransactionQueryDto = { limit: 20, offset: 0 };
      const result = await service.getTransactions("no-account", query);

      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it("should apply type filter to query", async () => {
      mockPrisma.creditTransaction.findMany.mockResolvedValue([]);
      mockPrisma.creditTransaction.count.mockResolvedValue(0);

      const query: TransactionQueryDto = {
        type: CreditTransactionType.ADMIN_GRANT,
        limit: 20,
        offset: 0,
      };
      await service.getTransactions("user-123", query);

      expect(mockPrisma.creditTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: CreditTransactionType.ADMIN_GRANT,
          }),
        }),
      );
    });

    it("should apply moduleType filter to query", async () => {
      mockPrisma.creditTransaction.findMany.mockResolvedValue([]);
      mockPrisma.creditTransaction.count.mockResolvedValue(0);

      const query: TransactionQueryDto = {
        moduleType: "deep-research",
        limit: 20,
        offset: 0,
      };
      await service.getTransactions("user-123", query);

      expect(mockPrisma.creditTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ moduleType: "deep-research" }),
        }),
      );
    });

    it("should apply startDate and endDate filters", async () => {
      mockPrisma.creditTransaction.findMany.mockResolvedValue([]);
      mockPrisma.creditTransaction.count.mockResolvedValue(0);

      const query: TransactionQueryDto = {
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        limit: 20,
        offset: 0,
      };
      await service.getTransactions("user-123", query);

      expect(mockPrisma.creditTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({
              gte: new Date("2026-01-01"),
              lte: new Date("2026-01-31"),
            }),
          }),
        }),
      );
    });

    it("should compute hasMore correctly when more results exist", async () => {
      const mockTxns = Array.from({ length: 10 }, (_, i) => ({
        id: `t${i}`,
        type: CreditTransactionType.AI_ASK,
        amount: -10,
        balanceAfter: 5000 - i * 10,
        description: "chat",
        moduleType: null,
        operationType: null,
        tokenCount: null,
        modelName: null,
        createdAt: new Date(),
      }));
      mockPrisma.creditTransaction.findMany.mockResolvedValue(mockTxns);
      mockPrisma.creditTransaction.count.mockResolvedValue(25);

      const query: TransactionQueryDto = { limit: 10, offset: 0 };
      const result = await service.getTransactions("user-123", query);

      expect(result.hasMore).toBe(true);
    });

    it("should compute hasMore false when on last page", async () => {
      const mockTxns = Array.from({ length: 5 }, (_, i) => ({
        id: `t${i}`,
        type: CreditTransactionType.AI_ASK,
        amount: -10,
        balanceAfter: 50 - i * 10,
        description: "chat",
        moduleType: null,
        operationType: null,
        tokenCount: null,
        modelName: null,
        createdAt: new Date(),
      }));
      mockPrisma.creditTransaction.findMany.mockResolvedValue(mockTxns);
      mockPrisma.creditTransaction.count.mockResolvedValue(15);

      const query: TransactionQueryDto = { limit: 10, offset: 10 };
      const result = await service.getTransactions("user-123", query);

      // offset(10) + fetched(5) = 15, which equals total(15) => hasMore false
      expect(result.hasMore).toBe(false);
    });
  });

  // =========================================================================
  // freezeAccount / unfreezeAccount
  // =========================================================================

  describe("freezeAccount", () => {
    it("should call prisma update with isFrozen true", async () => {
      await service.freezeAccount("user-123", "Suspicious activity");

      expect(mockPrisma.creditAccount.update).toHaveBeenCalledWith({
        where: { userId: "user-123" },
        data: { isFrozen: true },
      });
    });
  });

  describe("unfreezeAccount", () => {
    it("should call prisma update with isFrozen false", async () => {
      await service.unfreezeAccount("user-123");

      expect(mockPrisma.creditAccount.update).toHaveBeenCalledWith({
        where: { userId: "user-123" },
        data: { isFrozen: false },
      });
    });
  });

  // =========================================================================
  // getCreditsStats
  // =========================================================================

  describe("getCreditsStats", () => {
    it("should return stats for existing account", async () => {
      mockPrisma.creditTransaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: -800 } }) // weekSpent
        .mockResolvedValueOnce({ _sum: { amount: -3000 } }); // monthSpent
      mockPrisma.creditTransaction.groupBy.mockResolvedValue([
        { moduleType: "ai-ask", _sum: { amount: -400 } },
        { moduleType: "deep-research", _sum: { amount: -1500 } },
      ]);

      const result = await service.getCreditsStats("user-123");

      expect(result.totalEarned).toBe(10000);
      expect(result.totalSpent).toBe(5000);
      expect(result.currentBalance).toBe(5000);
      expect(result.todaySpent).toBe(0);
      expect(result.weekSpent).toBe(800);
      expect(result.monthSpent).toBe(3000);
      expect(result.topModules).toHaveLength(2);
      expect(result.topModules[0]).toEqual({ module: "ai-ask", spent: 400 });
      expect(result.topModules[1]).toEqual({
        module: "deep-research",
        spent: 1500,
      });
    });

    it("should return zeros when account does not exist", async () => {
      mockPrisma.creditAccount.findUnique.mockResolvedValue(null);

      const result = await service.getCreditsStats("no-account-user");

      expect(result.totalEarned).toBe(0);
      expect(result.totalSpent).toBe(0);
      expect(result.currentBalance).toBe(0);
      expect(result.weekSpent).toBe(0);
      expect(result.monthSpent).toBe(0);
      expect(result.topModules).toHaveLength(0);
    });

    it("should return zeros when userId is empty string", async () => {
      const result = await service.getCreditsStats("");

      expect(result.totalEarned).toBe(0);
      expect(result.totalSpent).toBe(0);
      expect(result.currentBalance).toBe(0);
      // Should not call findUnique at all
      expect(mockPrisma.creditAccount.findUnique).not.toHaveBeenCalled();
    });

    it("should handle null aggregate _sum gracefully", async () => {
      mockPrisma.creditTransaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: null } })
        .mockResolvedValueOnce({ _sum: { amount: null } });
      mockPrisma.creditTransaction.groupBy.mockResolvedValue([]);

      const result = await service.getCreditsStats("user-123");

      expect(result.weekSpent).toBe(0);
      expect(result.monthSpent).toBe(0);
    });
  });

  // =========================================================================
  // initializeAllUserAccounts
  // =========================================================================

  describe("initializeAllUserAccounts", () => {
    it("should create accounts for users without one", async () => {
      const usersWithoutAccount = [
        { id: "u1", username: "alice" },
        { id: "u2", username: "bob" },
      ];
      mockPrisma.user.findMany.mockResolvedValue(usersWithoutAccount);
      // Double-check inside transaction returns null (account does not exist)
      mockPrisma.creditAccount.findUnique.mockResolvedValue(null);
      mockPrisma.creditAccount.create.mockResolvedValue({
        ...mockAccount,
        id: "acct-init",
      });

      const result = await service.initializeAllUserAccounts();

      expect(result.total).toBe(2);
      expect(result.created).toBe(2);
      expect(result.skipped).toBe(0);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it("should skip users that already have accounts in the double-check", async () => {
      const usersWithoutAccount = [{ id: "u3", username: "charlie" }];
      mockPrisma.user.findMany.mockResolvedValue(usersWithoutAccount);
      // Double-check inside transaction finds existing account
      mockPrisma.creditAccount.findUnique.mockResolvedValue(mockAccount);

      const result = await service.initializeAllUserAccounts();

      expect(result.total).toBe(1);
      expect(result.created).toBe(0);
      expect(result.skipped).toBe(1);
      expect(mockPrisma.creditAccount.create).not.toHaveBeenCalled();
    });

    it("should return zeros when there are no users without accounts", async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      const result = await service.initializeAllUserAccounts();

      expect(result.total).toBe(0);
      expect(result.created).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it("should handle transaction errors gracefully and increment skipped", async () => {
      const usersWithoutAccount = [
        { id: "u4", username: "dave" },
        { id: "u5", username: "eve" },
      ];
      mockPrisma.user.findMany.mockResolvedValue(usersWithoutAccount);

      // First user transaction fails, second succeeds
      mockPrisma.$transaction
        .mockRejectedValueOnce(new Error("DB connection failed"))
        .mockImplementationOnce((fn: any) => fn(mockPrisma));

      mockPrisma.creditAccount.findUnique.mockResolvedValue(null);
      mockPrisma.creditAccount.create.mockResolvedValue({
        ...mockAccount,
        id: "acct-eve",
      });

      const result = await service.initializeAllUserAccounts();

      expect(result.total).toBe(2);
      expect(result.created).toBe(1);
      expect(result.skipped).toBe(1);
    });
  });

  // =========================================================================
  // getTransactionType (tested via consumeCredits)
  // =========================================================================

  describe("getTransactionType via consumeCredits", () => {
    const _runConsumeWithModule = async (moduleType: string) => {
      mockRulesService.calculateCredits.mockResolvedValue(10);
      mockPrisma.creditTransaction.findUnique.mockResolvedValue(null);
      mockPrisma.creditTransaction.create.mockResolvedValue({
        id: "txn-map",
        amount: -10,
        balanceAfter: 4990,
      });
      await service.consumeCredits({
        userId: "user-123",
        moduleType,
        operationType: "test-op",
      });
      const callArg = mockPrisma.creditTransaction.create.mock.calls[0][0];
      return callArg.data.type as CreditTransactionType;
    };

    it.each([
      ["ai-teams", CreditTransactionType.AI_TEAMS],
      ["ai-planning", CreditTransactionType.AI_PLANNING],
      ["explore", CreditTransactionType.EXPLORE],
      ["ai-office", CreditTransactionType.AI_OFFICE],
      ["ai-writing", CreditTransactionType.AI_WRITING],
      ["ai-image", CreditTransactionType.AI_IMAGE],
      ["ai-social", CreditTransactionType.AI_SOCIAL],
      ["deep-research", CreditTransactionType.AI_RESEARCH],
      ["topic-insights", CreditTransactionType.AI_INSIGHTS],
      ["notebook-research", CreditTransactionType.NOTEBOOK_RESEARCH],
      ["library", CreditTransactionType.LIBRARY],
      ["notes", CreditTransactionType.NOTES],
      ["collections", CreditTransactionType.COLLECTIONS],
      ["ai-engine", CreditTransactionType.ADJUSTMENT],
    ])(
      "should map moduleType '%s' to transaction type %s",
      async (moduleType, expectedType) => {
        jest.clearAllMocks();
        mockPrisma.creditAccount.findUnique.mockResolvedValue(mockAccount);
        mockPrisma.creditTransaction.findUnique.mockResolvedValue(null);
        mockRulesService.calculateCredits.mockResolvedValue(10);
        mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockPrisma));
        mockPrisma.creditTransaction.create.mockResolvedValue({
          id: "txn-map",
          amount: -10,
          balanceAfter: 4990,
        });

        await service.consumeCredits({
          userId: "user-123",
          moduleType,
          operationType: "op",
        });

        expect(mockPrisma.creditTransaction.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ type: expectedType }),
          }),
        );
      },
    );
  });
});
