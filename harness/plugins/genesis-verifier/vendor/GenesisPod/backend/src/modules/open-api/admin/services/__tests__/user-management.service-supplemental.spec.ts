import { Test, TestingModule } from "@nestjs/testing";
import { Logger, NotFoundException } from "@nestjs/common";
import { UserManagementService } from "../user-management.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import * as bcrypt from "bcrypt";

jest.mock("bcrypt");

describe("UserManagementService (supplemental)", () => {
  let service: UserManagementService;
  let mockPrisma: {
    user: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    loginHistory: {
      findMany: jest.Mock;
    };
    creditAccount: {
      create: jest.Mock;
      upsert: jest.Mock;
      update: jest.Mock;
      deleteMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const originalAdminEmails = process.env.ADMIN_EMAILS;

  beforeAll(async () => {
    process.env.ADMIN_EMAILS = "superadmin@test.com,cto@test.com";

    mockPrisma = {
      user: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      loginHistory: {
        findMany: jest.fn(),
      },
      creditAccount: {
        create: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      $transaction: jest
        .fn()
        .mockImplementation((ops: unknown[]) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserManagementService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<UserManagementService>(UserManagementService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterAll(() => {
    process.env.ADMIN_EMAILS = originalAdminEmails;
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==================== getUserStats (lines 133-176) ====================

  describe("getUserStats", () => {
    it("should return all user statistics in one call", async () => {
      // count is called 8 times
      mockPrisma.user.count
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(90) // active
        .mockResolvedValueOnce(50) // weekly active
        .mockResolvedValueOnce(80) // monthly active
        .mockResolvedValueOnce(5) // new today
        .mockResolvedValueOnce(20) // new this week
        .mockResolvedValueOnce(40) // new this month
        .mockResolvedValueOnce(3); // admin count

      const result = await service.getUserStats();

      expect(result.totalUsers).toBe(100);
      expect(result.activeUsers).toBe(90);
      expect(result.weeklyActiveUsers).toBe(50);
      expect(result.monthlyActiveUsers).toBe(80);
      expect(result.newUsersToday).toBe(5);
      expect(result.newUsersThisWeek).toBe(20);
      expect(result.newUsersThisMonth).toBe(40);
      expect(result.adminCount).toBe(3);
      expect(mockPrisma.user.count).toHaveBeenCalledTimes(8);
    });

    it("should query total users without a where clause", async () => {
      mockPrisma.user.count.mockResolvedValue(0);

      await service.getUserStats();

      // First call: total users - no where clause
      const firstCall = mockPrisma.user.count.mock.calls[0][0];
      expect(firstCall).toBeUndefined();
    });

    it("should query active users with isActive filter", async () => {
      mockPrisma.user.count.mockResolvedValue(0);

      await service.getUserStats();

      // Second call: active users
      const secondCall = mockPrisma.user.count.mock.calls[1][0];
      expect(secondCall?.where?.isActive).toBe(true);
    });

    it("should query admin count with role filter", async () => {
      mockPrisma.user.count.mockResolvedValue(0);

      await service.getUserStats();

      // Eighth call: admin count
      const eighthCall = mockPrisma.user.count.mock.calls[7][0];
      expect(eighthCall?.where?.role).toBe("ADMIN");
    });

    it("should use date ranges for weekly and monthly active queries", async () => {
      mockPrisma.user.count.mockResolvedValue(0);

      const before = Date.now();
      await service.getUserStats();
      const after = Date.now();

      // Third call: weekly active (lastLoginAt gte oneWeekAgo)
      const weeklyCall = mockPrisma.user.count.mock.calls[2][0];
      const weeklyDate = weeklyCall?.where?.lastLoginAt?.gte;
      expect(weeklyDate).toBeDefined();
      expect(weeklyDate.getTime()).toBeGreaterThanOrEqual(
        before - 7 * 24 * 60 * 60 * 1000 - 1000,
      );
      expect(weeklyDate.getTime()).toBeLessThanOrEqual(
        after - 7 * 24 * 60 * 60 * 1000 + 1000,
      );
    });

    it("should return zeros when all counts are zero", async () => {
      mockPrisma.user.count.mockResolvedValue(0);

      const result = await service.getUserStats();

      expect(result.totalUsers).toBe(0);
      expect(result.adminCount).toBe(0);
    });
  });

  // ==================== toggleUserStatus (lines 323-347) ====================

  describe("toggleUserStatus", () => {
    it("should activate a user successfully", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "inactive@test.com",
        isActive: false,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: "u1",
        email: "inactive@test.com",
        username: "user1",
        isActive: true,
      });

      const result = await service.toggleUserStatus("u1", true);

      expect(result.isActive).toBe(true);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "u1" },
          data: { isActive: true },
        }),
      );
    });

    it("should deactivate a user successfully", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "active@test.com",
        isActive: true,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: "u1",
        email: "active@test.com",
        username: "user1",
        isActive: false,
      });

      const result = await service.toggleUserStatus("u1", false);

      expect(result.isActive).toBe(false);
    });

    it("should throw NotFoundException when user not found", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.toggleUserStatus("ghost", true)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ==================== updateUser (lines 352-389) ====================

  describe("updateUser", () => {
    it("should update username only", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "user@test.com",
      });
      mockPrisma.user.update.mockResolvedValue({
        id: "u1",
        email: "user@test.com",
        username: "newname",
        role: "USER",
        isActive: true,
      });

      const result = await service.updateUser("u1", { username: "newname" });

      expect(result.username).toBe("newname");
      const updateCall = mockPrisma.user.update.mock.calls[0][0];
      expect(updateCall.data.username).toBe("newname");
    });

    it("should update role only", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "user@test.com",
      });
      mockPrisma.user.update.mockResolvedValue({
        id: "u1",
        email: "user@test.com",
        username: "user1",
        role: "ADMIN",
        isActive: true,
      });

      await service.updateUser("u1", { role: "ADMIN" });

      const updateCall = mockPrisma.user.update.mock.calls[0][0];
      expect(updateCall.data.role).toBe("ADMIN");
    });

    it("should map status 'active' to isActive=true", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "user@test.com",
      });
      mockPrisma.user.update.mockResolvedValue({
        id: "u1",
        email: "user@test.com",
        username: "user1",
        role: "USER",
        isActive: true,
      });

      await service.updateUser("u1", { status: "active" });

      const updateCall = mockPrisma.user.update.mock.calls[0][0];
      expect(updateCall.data.isActive).toBe(true);
    });

    it("should map status 'inactive' to isActive=false", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "user@test.com",
      });
      mockPrisma.user.update.mockResolvedValue({
        id: "u1",
        email: "user@test.com",
        username: "user1",
        role: "USER",
        isActive: false,
      });

      await service.updateUser("u1", { status: "inactive" });

      const updateCall = mockPrisma.user.update.mock.calls[0][0];
      expect(updateCall.data.isActive).toBe(false);
    });

    it("should map status 'banned' to isActive=false", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "user@test.com",
      });
      mockPrisma.user.update.mockResolvedValue({
        id: "u1",
        email: "user@test.com",
        username: "user1",
        role: "USER",
        isActive: false,
      });

      await service.updateUser("u1", { status: "banned" });

      const updateCall = mockPrisma.user.update.mock.calls[0][0];
      expect(updateCall.data.isActive).toBe(false);
    });

    it("should update multiple fields at once", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "user@test.com",
      });
      mockPrisma.user.update.mockResolvedValue({
        id: "u1",
        email: "user@test.com",
        username: "newname",
        role: "ADMIN",
        isActive: true,
      });

      await service.updateUser("u1", {
        username: "newname",
        role: "ADMIN",
        status: "active",
      });

      const updateCall = mockPrisma.user.update.mock.calls[0][0];
      expect(updateCall.data.username).toBe("newname");
      expect(updateCall.data.role).toBe("ADMIN");
      expect(updateCall.data.isActive).toBe(true);
    });

    it("should throw NotFoundException when user not found", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateUser("ghost", { username: "new" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ==================== getUserCredits (lines 433-451) ====================

  describe("getUserCredits", () => {
    it("should return user credits with credit account details", async () => {
      const creditAccount = {
        balance: 5000,
        totalEarned: 10000,
        totalSpent: 5000,
        isFrozen: false,
      };
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "user@test.com",
        username: "user1",
        creditAccount,
      });

      const result = await service.getUserCredits("u1");

      expect(result.userId).toBe("u1");
      expect(result.email).toBe("user@test.com");
      expect(result.username).toBe("user1");
      expect(result.credits).toEqual(creditAccount);
    });

    it("should return null credits when user has no credit account", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "user@test.com",
        username: "user1",
        creditAccount: null,
      });

      const result = await service.getUserCredits("u1");

      expect(result.credits).toBeNull();
    });

    it("should throw NotFoundException when user not found", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getUserCredits("ghost")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should call findUnique with include creditAccount", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "user@test.com",
        username: "user1",
        creditAccount: null,
      });

      await service.getUserCredits("u1");

      const call = mockPrisma.user.findUnique.mock.calls[0][0];
      expect(call.where).toEqual({ id: "u1" });
      expect(call.include).toBeDefined();
      expect(call.include.creditAccount).toBe(true);
    });
  });

  // ==================== toggleCreditFreeze (lines 497-521) ====================

  describe("toggleCreditFreeze", () => {
    const creditAccount = {
      id: "ca1",
      userId: "u1",
      balance: 5000,
      isFrozen: false,
    };

    it("should freeze a credit account", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "user@test.com",
        creditAccount,
      });
      const frozenAccount = { ...creditAccount, isFrozen: true };
      mockPrisma.creditAccount.update.mockResolvedValue(frozenAccount);

      const result = await service.toggleCreditFreeze("u1", true, "Fraud");

      expect(mockPrisma.creditAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "u1" },
          data: { isFrozen: true },
        }),
      );
      expect(result.isFrozen).toBe(true);
    });

    it("should unfreeze a credit account", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "user@test.com",
        creditAccount: { ...creditAccount, isFrozen: true },
      });
      mockPrisma.creditAccount.update.mockResolvedValue({
        ...creditAccount,
        isFrozen: false,
      });

      const result = await service.toggleCreditFreeze("u1", false);

      expect(result.isFrozen).toBe(false);
    });

    it("should throw NotFoundException when user not found", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.toggleCreditFreeze("ghost", true)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw NotFoundException when user has no credit account", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "user@test.com",
        creditAccount: null,
      });

      await expect(service.toggleCreditFreeze("u1", true)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should work without a reason", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "user@test.com",
        creditAccount,
      });
      mockPrisma.creditAccount.update.mockResolvedValue({
        ...creditAccount,
        isFrozen: true,
      });

      await expect(
        service.toggleCreditFreeze("u1", true),
      ).resolves.toBeDefined();
    });
  });

  // ==================== createUser with password hashing (line 261) ====================

  describe("createUser with password", () => {
    it("should hash password when provided", async () => {
      const mockedBcrypt = jest.mocked(bcrypt);
      (mockedBcrypt.hash as jest.Mock).mockResolvedValue("hashed-password");

      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: "new-user",
        email: "new@test.com",
        username: null,
        role: "USER",
        isActive: true,
        createdAt: new Date(),
      });
      mockPrisma.creditAccount.create.mockResolvedValue({ balance: 10000 });

      await service.createUser({
        email: "new@test.com",
        password: "secret123",
      });

      expect(mockedBcrypt.hash).toHaveBeenCalledWith("secret123", 10);
      const createCall = mockPrisma.user.create.mock.calls[0][0];
      expect(createCall.data.passwordHash).toBe("hashed-password");
    });

    it("should not call bcrypt.hash when no password provided", async () => {
      const mockedBcrypt = jest.mocked(bcrypt);

      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: "new-user",
        email: "nopw@test.com",
        username: null,
        role: "USER",
        isActive: true,
        createdAt: new Date(),
      });
      mockPrisma.creditAccount.create.mockResolvedValue({ balance: 10000 });

      await service.createUser({ email: "nopw@test.com" });

      expect(mockedBcrypt.hash).not.toHaveBeenCalled();
    });

    it("should create user with ADMIN role when specified", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: "admin-user",
        email: "admin@test.com",
        username: null,
        role: "ADMIN",
        isActive: true,
        createdAt: new Date(),
      });
      mockPrisma.creditAccount.create.mockResolvedValue({ balance: 10000 });

      const result = await service.createUser({
        email: "admin@test.com",
        role: "ADMIN",
      });

      expect(result.success).toBe(true);
      const createCall = mockPrisma.user.create.mock.calls[0][0];
      expect(createCall.data.role).toBe("ADMIN");
    });
  });
});
