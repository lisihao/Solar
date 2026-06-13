import { Test, TestingModule } from "@nestjs/testing";
import { Logger, NotFoundException } from "@nestjs/common";
import { UserManagementService } from "../user-management.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

describe("UserManagementService", () => {
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

  beforeEach(async () => {
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

  afterEach(() => {
    process.env.ADMIN_EMAILS = originalAdminEmails;
    jest.restoreAllMocks();
  });

  // ==================== getAllUsers ====================

  describe("getAllUsers", () => {
    const buildUser = (
      id: string,
      email: string,
      role = "USER",
      isActive = true,
    ) => ({
      id,
      email,
      username: `user_${id}`,
      fullName: `Full Name ${id}`,
      role,
      avatarUrl: null,
      isActive,
      isVerified: true,
      oauthProvider: null,
      subscriptionTier: "FREE",
      createdAt: new Date("2025-06-01T00:00:00Z"),
      lastLoginAt: new Date("2026-01-15T00:00:00Z"),
      creditAccount: {
        balance: 5000,
        totalEarned: 10000,
        totalSpent: 5000,
        isFrozen: false,
      },
      _count: { notes: 2, comments: 3, collections: 1 },
    });

    it("should return paginated users with pagination metadata", async () => {
      // Arrange
      const users = [
        buildUser("u1", "a@test.com"),
        buildUser("u2", "b@test.com"),
      ];
      mockPrisma.user.findMany.mockResolvedValue(users);
      mockPrisma.user.count.mockResolvedValue(2);

      // Act
      const result = await service.getAllUsers(1, 20);

      // Assert
      expect(result.users).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(20);
      expect(result.pagination.totalPages).toBe(1);
    });

    it("should mark users whose email is in ADMIN_EMAILS as isAdmin=true", async () => {
      // Arrange
      const users = [
        buildUser("u1", "superadmin@test.com", "USER"), // email in ADMIN_EMAILS
        buildUser("u2", "regular@test.com", "USER"),
      ];
      mockPrisma.user.findMany.mockResolvedValue(users);
      mockPrisma.user.count.mockResolvedValue(2);

      // Act
      const result = await service.getAllUsers();

      // Assert
      expect(result.users[0].isAdmin).toBe(true);
      expect(result.users[1].isAdmin).toBe(false);
    });

    it("should mark users with role=ADMIN as isAdmin=true", async () => {
      // Arrange
      const users = [buildUser("u1", "regular@test.com", "ADMIN")];
      mockPrisma.user.findMany.mockResolvedValue(users);
      mockPrisma.user.count.mockResolvedValue(1);

      // Act
      const result = await service.getAllUsers();

      // Assert
      expect(result.users[0].isAdmin).toBe(true);
    });

    it("should map isActive to status string (active/inactive)", async () => {
      // Arrange
      const users = [
        buildUser("u1", "active@test.com", "USER", true),
        buildUser("u2", "inactive@test.com", "USER", false),
      ];
      mockPrisma.user.findMany.mockResolvedValue(users);
      mockPrisma.user.count.mockResolvedValue(2);

      // Act
      const result = await service.getAllUsers();

      // Assert
      expect(result.users[0].status).toBe("active");
      expect(result.users[1].status).toBe("inactive");
    });

    it("should prefer fullName over username in name field", async () => {
      // Arrange
      const user = buildUser("u1", "test@test.com");
      mockPrisma.user.findMany.mockResolvedValue([user]);
      mockPrisma.user.count.mockResolvedValue(1);

      // Act
      const result = await service.getAllUsers();

      // Assert: fullName is set, so it should be used
      expect(result.users[0].name).toBe(`Full Name u1`);
    });

    it("should apply search filter to email, username, and fullName", async () => {
      // Arrange
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      // Act
      await service.getAllUsers(1, 20, "alice");

      // Assert
      const findManyCall = mockPrisma.user.findMany.mock.calls[0][0];
      const { OR } = findManyCall.where;
      expect(OR).toHaveLength(3);
      expect(OR[0].email.contains).toBe("alice");
      expect(OR[1].username.contains).toBe("alice");
      expect(OR[2].fullName.contains).toBe("alice");
    });

    it("should compute correct skip offset", async () => {
      // Arrange
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      // Act
      await service.getAllUsers(3, 10);

      // Assert
      const findManyCall = mockPrisma.user.findMany.mock.calls[0][0];
      expect(findManyCall.skip).toBe(20); // (3-1)*10
      expect(findManyCall.take).toBe(10);
    });

    it("should include creditAccount details in output when present", async () => {
      // Arrange
      const user = buildUser("u1", "rich@test.com");
      mockPrisma.user.findMany.mockResolvedValue([user]);
      mockPrisma.user.count.mockResolvedValue(1);

      // Act
      const result = await service.getAllUsers();

      // Assert
      expect(result.users[0].credits).toEqual({
        balance: 5000,
        totalEarned: 10000,
        totalSpent: 5000,
        isFrozen: false,
      });
    });

    it("should return null credits when user has no creditAccount", async () => {
      // Arrange
      const user = { ...buildUser("u1", "poor@test.com"), creditAccount: null };
      mockPrisma.user.findMany.mockResolvedValue([user]);
      mockPrisma.user.count.mockResolvedValue(1);

      // Act
      const result = await service.getAllUsers();

      // Assert
      expect(result.users[0].credits).toBeNull();
    });
  });

  // ==================== getUserLoginHistory ====================

  describe("getUserLoginHistory", () => {
    it("should return login history for existing user", async () => {
      // Arrange
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "test@test.com",
      });
      mockPrisma.loginHistory.findMany.mockResolvedValue([
        {
          id: "log-1",
          loginAt: new Date(),
          ipAddress: "1.2.3.4",
          device: "Mobile",
          browser: "Safari",
          os: "iOS",
          location: "CN",
        },
      ]);

      // Act
      const result = await service.getUserLoginHistory("user-1");

      // Assert
      expect(result.userId).toBe("user-1");
      expect(result.email).toBe("test@test.com");
      expect(result.history).toHaveLength(1);
    });

    it("should throw NotFoundException for non-existent user", async () => {
      // Arrange
      mockPrisma.user.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.getUserLoginHistory("ghost-id")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should respect the limit parameter", async () => {
      // Arrange
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "test@test.com",
      });
      mockPrisma.loginHistory.findMany.mockResolvedValue([]);

      // Act
      await service.getUserLoginHistory("user-1", 5);

      // Assert
      const findManyCall = mockPrisma.loginHistory.findMany.mock.calls[0][0];
      expect(findManyCall.take).toBe(5);
    });
  });

  // ==================== createUser ====================

  describe("createUser", () => {
    it("should create a user and credit account for new email", async () => {
      // Arrange
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null) // email check
        .mockResolvedValueOnce(null); // username check
      mockPrisma.user.create.mockResolvedValue({
        id: "new-user",
        email: "new@test.com",
        username: "newuser",
        role: "USER",
        isActive: true,
        createdAt: new Date(),
      });
      mockPrisma.creditAccount.create.mockResolvedValue({ balance: 10000 });

      // Act
      const result = await service.createUser({
        email: "new@test.com",
        username: "newuser",
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.email).toBe("new@test.com");
      expect(mockPrisma.creditAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            balance: 10000,
            totalEarned: 10000,
          }),
        }),
      );
    });

    it("should return error when email already exists", async () => {
      // Arrange
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "existing" });

      // Act
      const result = await service.createUser({ email: "taken@test.com" });

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe("Email already exists");
    });

    it("should return error when username already exists", async () => {
      // Arrange
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null) // email not taken
        .mockResolvedValueOnce({ id: "existing" }); // username taken

      // Act
      const result = await service.createUser({
        email: "new@test.com",
        username: "takenuser",
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe("Username already exists");
    });

    it("should default role to USER when not specified", async () => {
      // Arrange
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: "u",
        email: "x@test.com",
        username: null,
        role: "USER",
        isActive: true,
        createdAt: new Date(),
      });
      mockPrisma.creditAccount.create.mockResolvedValue({});

      // Act
      await service.createUser({ email: "x@test.com" });

      // Assert: create called with role USER
      const createCall = mockPrisma.user.create.mock.calls[0][0];
      expect(createCall.data.role).toBe("USER");
    });
  });

  // ==================== updateUserRole ====================

  describe("updateUserRole", () => {
    it("should update user role successfully", async () => {
      // Arrange
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "a@b.com",
      });
      mockPrisma.user.update.mockResolvedValue({
        id: "u1",
        email: "a@b.com",
        username: "user1",
        role: "ADMIN",
      });

      // Act
      const result = await service.updateUserRole("u1", "ADMIN");

      // Assert
      expect(result.role).toBe("ADMIN");
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "u1" },
          data: { role: "ADMIN" },
        }),
      );
    });

    it("should throw NotFoundException for non-existent user", async () => {
      // Arrange
      mockPrisma.user.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.updateUserRole("ghost", "ADMIN")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ==================== isUserAdmin ====================

  describe("isUserAdmin", () => {
    it("should return true for user with ADMIN role", async () => {
      // Arrange
      mockPrisma.user.findUnique.mockResolvedValue({
        email: "someone@test.com",
        role: "ADMIN",
      });

      // Act
      const result = await service.isUserAdmin("u1");

      // Assert
      expect(result).toBe(true);
    });

    it("should return true when email is in ADMIN_EMAILS", async () => {
      // Arrange
      mockPrisma.user.findUnique.mockResolvedValue({
        email: "superadmin@test.com",
        role: "USER",
      });

      // Act
      const result = await service.isUserAdmin("u1");

      // Assert
      expect(result).toBe(true);
    });

    it("should return false for regular user not in ADMIN_EMAILS", async () => {
      // Arrange
      mockPrisma.user.findUnique.mockResolvedValue({
        email: "regular@test.com",
        role: "USER",
      });

      // Act
      const result = await service.isUserAdmin("u1");

      // Assert
      expect(result).toBe(false);
    });

    it("should return false when user does not exist", async () => {
      // Arrange
      mockPrisma.user.findUnique.mockResolvedValue(null);

      // Act
      const result = await service.isUserAdmin("ghost");

      // Assert
      expect(result).toBe(false);
    });
  });

  // ==================== deleteUser ====================

  describe("deleteUser", () => {
    it("should delete user and credit account in a transaction", async () => {
      // Arrange
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "delete@test.com",
      });
      mockPrisma.creditAccount.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.user.delete.mockResolvedValue({ id: "u1" });

      // Act
      const result = await service.deleteUser("u1");

      // Assert
      expect(result.success).toBe(true);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it("should throw NotFoundException when user not found", async () => {
      // Arrange
      mockPrisma.user.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.deleteUser("ghost")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ==================== grantCredits ====================

  describe("grantCredits", () => {
    it("should upsert credit account with granted amount", async () => {
      // Arrange
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "rich@test.com",
        creditAccount: { balance: 5000 },
      });
      mockPrisma.creditAccount.upsert.mockResolvedValue({
        balance: 6000,
        totalEarned: 11000,
        totalSpent: 5000,
        isFrozen: false,
      });

      // Act
      const result = await service.grantCredits("u1", 1000, "Bonus");

      // Assert
      expect(result.success).toBe(true);
      expect(result.newBalance).toBe(6000);
    });

    it("should throw NotFoundException for non-existent user", async () => {
      // Arrange
      mockPrisma.user.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.grantCredits("ghost", 500)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
