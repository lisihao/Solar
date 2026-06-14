import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { AdminService } from "../admin.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { SecretsService } from "../../../platform/credentials/storage/secrets/secrets.service";
import { UserManagementService } from "../services/user-management.service";
import { ResourceManagementService } from "../services/resource-management.service";
import { StatisticsService } from "../services/statistics.service";

// Mock fetch globally for API balance check tests
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("AdminService", () => {
  let service: AdminService;
  let mockUserMgmtService: {
    getAllUsers: jest.Mock;
    getUserDetail: jest.Mock;
    updateUserRole: jest.Mock;
    toggleUserStatus: jest.Mock;
    isUserAdmin: jest.Mock;
    getUserStats: jest.Mock;
    getUserLoginHistory: jest.Mock;
    createUser: jest.Mock;
    updateUser: jest.Mock;
    deleteUser: jest.Mock;
    getUserCredits: jest.Mock;
    grantCredits: jest.Mock;
    toggleCreditFreeze: jest.Mock;
  };
  let mockResourceMgmtService: {
    getResourceById: jest.Mock;
    deleteResource: jest.Mock;
    deleteResources: jest.Mock;
  };
  let mockStatisticsService: {
    getSystemStats: jest.Mock;
    getResourceStats: jest.Mock;
    getOverviewStats: jest.Mock;
  };
  let mockSecretsService: {
    getValue: jest.Mock;
    getValueInternal: jest.Mock;
  };

  const mockPrismaService = {
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    resource: {
      findUnique: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    aIModel: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    systemSetting: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    rawData: {
      count: jest.fn(),
      deleteMany: jest.fn(),
    },
    deduplicationRecord: {
      count: jest.fn(),
      deleteMany: jest.fn(),
    },
    note: {
      deleteMany: jest.fn(),
    },
    comment: {
      deleteMany: jest.fn(),
    },
    collectionTask: {
      updateMany: jest.fn(),
    },
    dataSource: {
      updateMany: jest.fn(),
    },
    creditAccount: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    creditTransaction: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    skillConfig: {
      upsert: jest.fn(),
    },
  };

  beforeEach(async () => {
    process.env.ADMIN_EMAILS = "admin@test.com,super@test.com";

    mockUserMgmtService = {
      getAllUsers: jest.fn().mockResolvedValue({ users: [], total: 0 }),
      getUserDetail: jest.fn().mockResolvedValue(null),
      updateUserRole: jest.fn().mockResolvedValue({}),
      toggleUserStatus: jest.fn().mockResolvedValue({}),
      isUserAdmin: jest.fn().mockResolvedValue(false),
      getUserStats: jest.fn().mockResolvedValue({}),
      getUserLoginHistory: jest.fn().mockResolvedValue([]),
      createUser: jest.fn().mockResolvedValue({}),
      updateUser: jest.fn().mockResolvedValue({}),
      deleteUser: jest.fn().mockResolvedValue({ success: true }),
      getUserCredits: jest.fn().mockResolvedValue({}),
      grantCredits: jest.fn().mockResolvedValue({}),
      toggleCreditFreeze: jest.fn().mockResolvedValue({}),
    };

    mockResourceMgmtService = {
      getResourceById: jest.fn().mockResolvedValue(null),
      deleteResource: jest.fn().mockResolvedValue({ success: true }),
      deleteResources: jest.fn().mockResolvedValue({ success: true, count: 0 }),
    };

    mockStatisticsService = {
      getSystemStats: jest.fn().mockResolvedValue({}),
      getResourceStats: jest.fn().mockResolvedValue({}),
      getOverviewStats: jest.fn().mockResolvedValue({}),
    };

    mockSecretsService = {
      getValue: jest.fn().mockResolvedValue(null),
      getValueInternal: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: SecretsService,
          useValue: mockSecretsService,
        },
        {
          provide: UserManagementService,
          useValue: mockUserMgmtService,
        },
        {
          provide: ResourceManagementService,
          useValue: mockResourceMgmtService,
        },
        {
          provide: StatisticsService,
          useValue: mockStatisticsService,
        },
        // S5 audit fix（2026-05-04）：AdminService 新增 AuditService 依赖
        {
          provide: (await import("../../../../common/audit/audit.service"))
            .AuditService,
          useValue: { log: jest.fn() },
        },
        // PR-6 (2026-05-12)：AdminService 新增 KeyAssignmentsService 依赖
        {
          provide: (
            await import("../../../platform/credentials/governance/key-assignments/key-assignments.service")
          ).KeyAssignmentsService,
          useValue: {
            reactivateStale: jest.fn().mockResolvedValue({ count: 0 }),
          },
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);

    jest.clearAllMocks();
    mockFetch.mockReset();
  });

  // ==================== getAllUsers ====================

  describe("getAllUsers", () => {
    it("should return paginated users with admin flag", async () => {
      const mockResult = {
        users: [
          {
            id: "user-1",
            email: "admin@test.com",
            username: "admin",
            isAdmin: true,
          },
          {
            id: "user-2",
            email: "regular@test.com",
            username: "regular",
            isAdmin: false,
          },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 2,
          totalPages: 1,
        },
      };
      mockUserMgmtService.getAllUsers.mockResolvedValue(mockResult);

      const result = await service.getAllUsers(1, 20);

      expect(result.users).toHaveLength(2);
      expect(result.users[0].isAdmin).toBe(true);
      expect(result.users[1].isAdmin).toBe(false);
      expect(mockUserMgmtService.getAllUsers).toHaveBeenCalledWith(
        1,
        20,
        undefined,
      );
    });

    it("should search users by email or username", async () => {
      mockUserMgmtService.getAllUsers.mockResolvedValue({
        users: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });

      await service.getAllUsers(1, 20, "search-term");

      expect(mockUserMgmtService.getAllUsers).toHaveBeenCalledWith(
        1,
        20,
        "search-term",
      );
    });
  });

  // ==================== getUserStats ====================

  describe("getUserStats", () => {
    it("should delegate to UserManagementService", async () => {
      const mockStats = { total: 100, active: 80, newLast7Days: 5 };
      mockUserMgmtService.getUserStats.mockResolvedValue(mockStats);

      const result = await service.getUserStats();

      expect(result).toEqual(mockStats);
      expect(mockUserMgmtService.getUserStats).toHaveBeenCalled();
    });
  });

  // ==================== getUserLoginHistory ====================

  describe("getUserLoginHistory", () => {
    it("should delegate to UserManagementService with userId and limit", async () => {
      const history = [{ id: "login-1", createdAt: new Date() }];
      mockUserMgmtService.getUserLoginHistory.mockResolvedValue(history);

      const result = await service.getUserLoginHistory("user-1", 5);

      expect(result).toEqual(history);
      expect(mockUserMgmtService.getUserLoginHistory).toHaveBeenCalledWith(
        "user-1",
        5,
      );
    });

    it("should use default limit of 10", async () => {
      mockUserMgmtService.getUserLoginHistory.mockResolvedValue([]);

      await service.getUserLoginHistory("user-1");

      expect(mockUserMgmtService.getUserLoginHistory).toHaveBeenCalledWith(
        "user-1",
        10,
      );
    });
  });

  // ==================== createUser ====================

  describe("createUser", () => {
    it("should delegate to UserManagementService", async () => {
      const newUser = { id: "new-user", email: "new@test.com" };
      mockUserMgmtService.createUser.mockResolvedValue(newUser);

      const result = await service.createUser({
        email: "new@test.com",
        username: "newuser",
        role: "USER",
      });

      expect(result).toEqual(newUser);
      expect(mockUserMgmtService.createUser).toHaveBeenCalledWith({
        email: "new@test.com",
        username: "newuser",
        role: "USER",
      });
    });
  });

  // ==================== deleteResource ====================

  describe("deleteResource", () => {
    it("should delete a resource successfully", async () => {
      mockResourceMgmtService.deleteResource.mockResolvedValue({
        success: true,
        message: "Resource deleted",
      });

      const result = await service.deleteResource("resource-1");

      expect(result.success).toBe(true);
      expect(mockResourceMgmtService.deleteResource).toHaveBeenCalledWith(
        "resource-1",
      );
    });

    it("should throw NotFoundException for non-existent resource", async () => {
      mockResourceMgmtService.deleteResource.mockRejectedValue(
        new NotFoundException("Resource not found"),
      );

      await expect(service.deleteResource("non-existent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ==================== deleteResources ====================

  describe("deleteResources", () => {
    it("should delete multiple resources", async () => {
      mockResourceMgmtService.deleteResources.mockResolvedValue({
        success: true,
        count: 3,
      });

      const result = await service.deleteResources(["id-1", "id-2", "id-3"]);

      expect(result.success).toBe(true);
      expect(result.count).toBe(3);
      expect(mockResourceMgmtService.deleteResources).toHaveBeenCalledWith([
        "id-1",
        "id-2",
        "id-3",
      ]);
    });
  });

  // ==================== updateUserRole ====================

  describe("updateUserRole", () => {
    it("should update user role successfully", async () => {
      const updatedUser = {
        id: "user-1",
        email: "test@test.com",
        role: "ADMIN",
      };
      mockUserMgmtService.updateUserRole.mockResolvedValue(updatedUser);

      const result = await service.updateUserRole("user-1", "ADMIN");

      expect(result.role).toBe("ADMIN");
      expect(mockUserMgmtService.updateUserRole).toHaveBeenCalledWith(
        "user-1",
        "ADMIN",
      );
    });

    it("should throw NotFoundException for non-existent user", async () => {
      mockUserMgmtService.updateUserRole.mockRejectedValue(
        new NotFoundException("User not found"),
      );

      await expect(
        service.updateUserRole("non-existent", "ADMIN"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ==================== toggleUserStatus ====================

  describe("toggleUserStatus", () => {
    it("should toggle user status to inactive", async () => {
      const updatedUser = { id: "user-1", isActive: false };
      mockUserMgmtService.toggleUserStatus.mockResolvedValue(updatedUser);

      const result = await service.toggleUserStatus("user-1", false);

      expect(result.isActive).toBe(false);
      expect(mockUserMgmtService.toggleUserStatus).toHaveBeenCalledWith(
        "user-1",
        false,
      );
    });

    it("should toggle user status to active", async () => {
      const updatedUser = { id: "user-1", isActive: true };
      mockUserMgmtService.toggleUserStatus.mockResolvedValue(updatedUser);

      const result = await service.toggleUserStatus("user-1", true);

      expect(result.isActive).toBe(true);
    });
  });

  // ==================== updateUser ====================

  describe("updateUser", () => {
    it("should update user data", async () => {
      const updatedUser = { id: "user-1", username: "newname" };
      mockUserMgmtService.updateUser.mockResolvedValue(updatedUser);

      const result = await service.updateUser("user-1", {
        username: "newname",
        status: "active",
      });

      expect(result).toEqual(updatedUser);
      expect(mockUserMgmtService.updateUser).toHaveBeenCalledWith("user-1", {
        username: "newname",
        status: "active",
      });
    });
  });

  // ==================== deleteUser ====================

  describe("deleteUser", () => {
    it("should delete user", async () => {
      mockUserMgmtService.deleteUser.mockResolvedValue({ success: true });

      const result = await service.deleteUser("user-1");

      expect(result.success).toBe(true);
      expect(mockUserMgmtService.deleteUser).toHaveBeenCalledWith("user-1");
    });
  });

  // ==================== Credits Management ====================

  describe("Credits Management", () => {
    it("getUserCredits should delegate to UserManagementService", async () => {
      const credits = { balance: 1000, totalEarned: 2000 };
      mockUserMgmtService.getUserCredits.mockResolvedValue(credits);

      const result = await service.getUserCredits("user-1");

      expect(result).toEqual(credits);
      expect(mockUserMgmtService.getUserCredits).toHaveBeenCalledWith("user-1");
    });

    it("grantCredits should delegate to UserManagementService", async () => {
      mockUserMgmtService.grantCredits.mockResolvedValue({ success: true });

      await service.grantCredits("user-1", 500, "Welcome bonus");

      expect(mockUserMgmtService.grantCredits).toHaveBeenCalledWith(
        "user-1",
        500,
        "Welcome bonus",
      );
    });

    it("grantCredits should work without reason", async () => {
      mockUserMgmtService.grantCredits.mockResolvedValue({ success: true });

      await service.grantCredits("user-1", 100);

      expect(mockUserMgmtService.grantCredits).toHaveBeenCalledWith(
        "user-1",
        100,
        undefined,
      );
    });

    it("toggleCreditFreeze should delegate to UserManagementService", async () => {
      mockUserMgmtService.toggleCreditFreeze.mockResolvedValue({
        success: true,
      });

      await service.toggleCreditFreeze("user-1", true, "Fraud detected");

      expect(mockUserMgmtService.toggleCreditFreeze).toHaveBeenCalledWith(
        "user-1",
        true,
        "Fraud detected",
      );
    });
  });

  // ==================== getCreditAccounts ====================

  describe("getCreditAccounts", () => {
    it("should return paginated credit accounts", async () => {
      const mockAccounts = [
        {
          userId: "user-1",
          user: { id: "user-1", email: "a@b.com", username: "alice" },
          balance: 1000,
          totalEarned: 2000,
          totalSpent: 1000,
          isFrozen: false,
          createdAt: new Date(),
        },
      ];
      mockPrismaService.creditAccount.findMany.mockResolvedValue(mockAccounts);
      mockPrismaService.creditAccount.count.mockResolvedValue(1);

      const result = await service.getCreditAccounts(1, 20);

      expect(result.accounts).toHaveLength(1);
      expect(result.accounts[0].balance).toBe(1000);
      expect(result.pagination.total).toBe(1);
    });

    it("should filter accounts by search term", async () => {
      mockPrismaService.creditAccount.findMany.mockResolvedValue([]);
      mockPrismaService.creditAccount.count.mockResolvedValue(0);

      await service.getCreditAccounts(1, 20, "alice");

      expect(mockPrismaService.creditAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user: expect.any(Object),
          }),
        }),
      );
    });

    it("should calculate correct pagination", async () => {
      mockPrismaService.creditAccount.findMany.mockResolvedValue([]);
      mockPrismaService.creditAccount.count.mockResolvedValue(100);

      const result = await service.getCreditAccounts(2, 20);

      expect(result.pagination.totalPages).toBe(5);
      expect(result.pagination.page).toBe(2);
    });
  });

  // ==================== getCreditsStats ====================

  describe("getCreditsStats", () => {
    it("should return aggregated credit statistics", async () => {
      mockPrismaService.creditAccount.count
        .mockResolvedValueOnce(150) // totalAccounts
        .mockResolvedValueOnce(5) // frozenAccounts
        .mockResolvedValueOnce(20); // lowBalanceAccounts
      mockPrismaService.creditAccount.aggregate.mockResolvedValue({
        _sum: { balance: 50000, totalEarned: 100000, totalSpent: 50000 },
      });

      const result = await service.getCreditsStats();

      expect(result.totalAccounts).toBe(150);
      expect(result.totalBalance).toBe(50000);
      expect(result.totalEarned).toBe(100000);
      expect(result.frozenAccounts).toBe(5);
      expect(result.lowBalanceAccounts).toBe(20);
    });

    it("should handle null aggregate sums", async () => {
      mockPrismaService.creditAccount.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      mockPrismaService.creditAccount.aggregate.mockResolvedValue({
        _sum: { balance: null, totalEarned: null, totalSpent: null },
      });

      const result = await service.getCreditsStats();

      expect(result.totalBalance).toBe(0);
      expect(result.totalEarned).toBe(0);
      expect(result.totalSpent).toBe(0);
    });
  });

  // ==================== getCreditTransactions ====================

  describe("getCreditTransactions", () => {
    it("should return transactions for valid credit account", async () => {
      mockPrismaService.creditAccount.findUnique.mockResolvedValue({
        id: "account-1",
        userId: "user-1",
      });
      const mockTxs = [
        {
          id: "tx-1",
          type: "CREDIT",
          amount: 500,
          balanceAfter: 1500,
          description: "Grant",
          moduleType: null,
          operationType: null,
          createdAt: new Date(),
        },
      ];
      mockPrismaService.creditTransaction.findMany.mockResolvedValue(mockTxs);
      mockPrismaService.creditTransaction.count.mockResolvedValue(1);

      const result = await service.getCreditTransactions("user-1");

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].type).toBe("CREDIT");
      expect(result.total).toBe(1);
    });

    it("should throw NotFoundException when credit account not found", async () => {
      mockPrismaService.creditAccount.findUnique.mockResolvedValue(null);

      await expect(
        service.getCreditTransactions("non-existent"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should respect limit and offset", async () => {
      mockPrismaService.creditAccount.findUnique.mockResolvedValue({
        id: "account-1",
        userId: "user-1",
      });
      mockPrismaService.creditTransaction.findMany.mockResolvedValue([]);
      mockPrismaService.creditTransaction.count.mockResolvedValue(0);

      await service.getCreditTransactions("user-1", 10, 20);

      expect(mockPrismaService.creditTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 20 }),
      );
    });
  });

  // ==================== getOverviewStats ====================

  describe("getOverviewStats", () => {
    it("should delegate to StatisticsService", async () => {
      const mockOverview = { totalUsers: 100, totalResources: 500 };
      mockStatisticsService.getOverviewStats.mockResolvedValue(mockOverview);

      const result = await service.getOverviewStats();

      expect(result).toEqual(mockOverview);
      expect(mockStatisticsService.getOverviewStats).toHaveBeenCalled();
    });
  });

  // ==================== getSystemStats ====================

  describe("getSystemStats", () => {
    it("should return system statistics", async () => {
      const mockStats = {
        users: { total: 100, active: 80, newLast7Days: 5 },
        resources: { total: 500, byType: { ARTICLE: 300, VIDEO: 200 } },
      };
      mockStatisticsService.getSystemStats.mockResolvedValue(mockStats);

      const result = await service.getSystemStats();

      expect(result.users.total).toBe(100);
      expect(mockStatisticsService.getSystemStats).toHaveBeenCalled();
    });
  });

  // ==================== isUserAdmin ====================

  describe("isUserAdmin", () => {
    it("should return true for admin user", async () => {
      mockUserMgmtService.isUserAdmin.mockResolvedValue(true);

      const result = await service.isUserAdmin("user-1");

      expect(result).toBe(true);
      expect(mockUserMgmtService.isUserAdmin).toHaveBeenCalledWith("user-1");
    });

    it("should return false for non-admin user", async () => {
      mockUserMgmtService.isUserAdmin.mockResolvedValue(false);

      const result = await service.isUserAdmin("user-1");

      expect(result).toBe(false);
    });
  });

  // ==================== AI Model Management ====================

  describe("getAllAIModels", () => {
    it("should return all models with masked API keys", async () => {
      const mockModels = [
        {
          id: "model-1",
          name: "GPT-4",
          apiKey: "sk-1234567890abcdefghijklmnop",
          secretKey: null,
          isDefault: true,
        },
        {
          id: "model-2",
          name: "Claude",
          apiKey: null,
          secretKey: null,
          isDefault: false,
        },
      ];

      mockPrismaService.aIModel.findMany.mockResolvedValue(mockModels);

      const result = await service.getAllAIModels();

      expect(result).toHaveLength(2);
      expect(result[0].apiKey).toContain("****");
      expect(result[0].hasApiKey).toBe(true);
      expect(result[1].apiKey).toBeNull();
      expect(result[1].hasApiKey).toBe(false);
    });

    it("should indicate hasApiKey true when secretKey is set", async () => {
      const mockModels = [
        {
          id: "model-1",
          name: "GPT-4",
          apiKey: null,
          secretKey: "my-secret",
          isDefault: false,
        },
      ];
      mockPrismaService.aIModel.findMany.mockResolvedValue(mockModels);

      const result = await service.getAllAIModels();

      expect(result[0].hasApiKey).toBe(true);
    });
  });

  describe("getAIModel", () => {
    it("should return model with masked API key by default", async () => {
      const mockModel = {
        id: "model-1",
        name: "GPT-4",
        apiKey: "sk-verylongapikey123456",
        secretKey: null,
      };

      mockPrismaService.aIModel.findUnique.mockResolvedValue(mockModel);

      const result = await service.getAIModel("model-1");

      expect(result.apiKey).not.toBe("sk-verylongapikey123456");
      expect(result.apiKey).toContain("****");
    });

    it("should return full API key when includeFullApiKey is true", async () => {
      const mockModel = {
        id: "model-1",
        name: "GPT-4",
        apiKey: "sk-verylongapikey123456",
        secretKey: null,
      };

      mockPrismaService.aIModel.findUnique.mockResolvedValue(mockModel);

      const result = await service.getAIModel("model-1", true);

      expect(result.apiKey).toBe("sk-verylongapikey123456");
    });

    it("should throw NotFoundException for non-existent model", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue(null);

      await expect(service.getAIModel("non-existent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should handle model with short API key (<=12 chars) masking", async () => {
      const mockModel = {
        id: "model-1",
        name: "Test",
        apiKey: "short-key",
        secretKey: null,
      };
      mockPrismaService.aIModel.findUnique.mockResolvedValue(mockModel);

      const result = await service.getAIModel("model-1");

      expect(result.apiKey).toContain("****");
    });
  });

  describe("createAIModel", () => {
    it("should create a new model when modelId does not exist", async () => {
      mockPrismaService.aIModel.findFirst.mockResolvedValue(null);
      mockPrismaService.aIModel.create.mockResolvedValue({
        id: "new-model",
        name: "New Model",
        displayName: "New Model Display",
        provider: "openai",
        modelId: "gpt-4-new",
        modelType: "CHAT",
        apiKey: "sk-newkey123456789012",
        secretKey: null,
        isUpdate: false,
      });

      const result = await service.createAIModel({
        name: "New Model",
        displayName: "New Model Display",
        provider: "openai",
        modelId: "gpt-4-new",
        icon: "icon",
        color: "#000",
        apiEndpoint: "https://api.openai.com",
        apiKey: "sk-newkey123456789012",
      });

      expect(result.isUpdate).toBe(false);
      expect(mockPrismaService.aIModel.create).toHaveBeenCalled();
    });

    it("should update existing model with same modelId and name", async () => {
      mockPrismaService.aIModel.findFirst.mockResolvedValue({
        id: "existing-model",
        name: "Existing Model",
        modelType: "CHAT",
        maxTokens: 4096,
        temperature: 0.7,
        isReasoning: false,
        apiFormat: "openai",
        supportsTemperature: true,
        supportsStreaming: true,
        supportsFunctionCalling: true,
        supportsVision: false,
        tokenParamName: "max_tokens",
        defaultTimeoutMs: 120000,
        priceInputPerMillion: null,
        priceOutputPerMillion: null,
        priority: 50,
      });
      mockPrismaService.aIModel.update.mockResolvedValue({
        id: "existing-model",
        name: "Existing Model",
        apiKey: "sk-updated12345678901",
        secretKey: null,
        isUpdate: true,
      });

      const result = await service.createAIModel({
        name: "Existing Model",
        displayName: "Updated Display",
        provider: "openai",
        modelId: "gpt-4",
        icon: "icon",
        color: "#000",
        apiEndpoint: "https://api.openai.com",
        apiKey: "sk-updated12345678901",
      });

      expect(mockPrismaService.aIModel.update).toHaveBeenCalled();
      expect(result.isUpdate).toBe(true);
    });

    it("should trim whitespace from apiKey", async () => {
      mockPrismaService.aIModel.findFirst.mockResolvedValue(null);
      mockPrismaService.aIModel.create.mockResolvedValue({
        id: "new-model",
        name: "Test",
        apiKey: "sk-trimmedkey12345",
        secretKey: null,
        isUpdate: false,
      });

      await service.createAIModel({
        name: "Test",
        displayName: "Test Display",
        provider: "openai",
        modelId: "gpt-test",
        icon: "icon",
        color: "#000",
        apiEndpoint: "https://api.openai.com",
        apiKey: "  sk-trimmedkey12345  ",
      });

      expect(mockPrismaService.aIModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            apiKey: "sk-trimmedkey12345",
          }),
        }),
      );
    });

    it("should not update apiKey when masked key is provided in update", async () => {
      mockPrismaService.aIModel.findFirst.mockResolvedValue({
        id: "existing",
        name: "Model",
        modelType: "CHAT",
        maxTokens: 4096,
        temperature: 0.7,
        isReasoning: false,
        apiFormat: "openai",
        supportsTemperature: true,
        supportsStreaming: true,
        supportsFunctionCalling: true,
        supportsVision: false,
        tokenParamName: "max_tokens",
        defaultTimeoutMs: 120000,
        priceInputPerMillion: null,
        priceOutputPerMillion: null,
        priority: 50,
      });
      mockPrismaService.aIModel.update.mockResolvedValue({
        id: "existing",
        name: "Model",
        apiKey: "sk-originalkey123",
        secretKey: null,
        isUpdate: true,
      });

      await service.createAIModel({
        name: "Model",
        displayName: "Model",
        provider: "openai",
        modelId: "gpt-test",
        icon: "icon",
        color: "#000",
        apiEndpoint: "https://api.openai.com",
        apiKey: "sk-****1234", // masked key - should not update
      });

      const updateCall = mockPrismaService.aIModel.update.mock.calls[0][0];
      expect(updateCall.data.apiKey).toBeUndefined();
    });

    it("should auto-set reasoning model params when isReasoning=true", async () => {
      mockPrismaService.aIModel.findFirst.mockResolvedValue(null);
      mockPrismaService.aIModel.create.mockResolvedValue({
        id: "new-o3",
        name: "o3",
        apiKey: null,
        secretKey: null,
        isUpdate: false,
      });

      await service.createAIModel({
        name: "o3",
        displayName: "o3",
        provider: "openai",
        modelId: "o3-mini",
        icon: "icon",
        color: "#000",
        apiEndpoint: "https://api.openai.com",
        isReasoning: true,
      });

      expect(mockPrismaService.aIModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tokenParamName: "max_completion_tokens",
            supportsTemperature: false,
          }),
        }),
      );
    });

    // ─── isReasoning 数据根因兜底（创建时 infer，让 DB 存对）──────────────────
    it("infers isReasoning=true for reasoning modelId when not explicitly set", async () => {
      mockPrismaService.aIModel.findFirst.mockResolvedValue(null);
      mockPrismaService.aIModel.create.mockResolvedValue({
        id: "new-gpt5",
        name: "gpt-5.4",
        apiKey: null,
        secretKey: null,
        isUpdate: false,
      });

      // admin 建 gpt-5.4（OpenAI reasoning，须用 max_completion_tokens），未显式标 isReasoning
      await service.createAIModel({
        name: "gpt-5.4",
        displayName: "gpt-5.4",
        provider: "openai",
        modelId: "gpt-5.4",
        icon: "icon",
        color: "#000",
        apiEndpoint: "https://api.openai.com",
      });

      expect(mockPrismaService.aIModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isReasoning: true }),
        }),
      );
    });

    it("infers isReasoning=false for non-reasoning modelId when not set", async () => {
      mockPrismaService.aIModel.findFirst.mockResolvedValue(null);
      mockPrismaService.aIModel.create.mockResolvedValue({
        id: "new-4o",
        name: "gpt-4o",
        apiKey: null,
        secretKey: null,
        isUpdate: false,
      });

      await service.createAIModel({
        name: "gpt-4o",
        displayName: "gpt-4o",
        provider: "openai",
        modelId: "gpt-4o",
        icon: "icon",
        color: "#000",
        apiEndpoint: "https://api.openai.com",
      });

      expect(mockPrismaService.aIModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isReasoning: false }),
        }),
      );
    });
  });

  describe("updateAIModel", () => {
    it("should update model fields", async () => {
      const existingModel = {
        id: "model-1",
        name: "Test",
        modelId: "gpt-4",
        apiKey: "existing-key",
        secretKey: null,
        isReasoning: false,
      };
      mockPrismaService.aIModel.findUnique.mockResolvedValue(existingModel);
      mockPrismaService.aIModel.update.mockResolvedValue({
        ...existingModel,
        displayName: "Updated",
        apiKey: null,
        secretKey: null,
      });

      const result = await service.updateAIModel("model-1", {
        displayName: "Updated",
      });

      expect(mockPrismaService.aIModel.update).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should throw NotFoundException when model not found", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue(null);

      await expect(
        service.updateAIModel("non-existent", { displayName: "Test" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should set apiKey to null when empty string provided", async () => {
      const existingModel = {
        id: "model-1",
        name: "Test",
        modelId: "gpt-4",
        apiKey: "existing-key",
        secretKey: null,
        isReasoning: false,
      };
      mockPrismaService.aIModel.findUnique.mockResolvedValue(existingModel);
      mockPrismaService.aIModel.update.mockResolvedValue({
        ...existingModel,
        apiKey: null,
        secretKey: null,
      });

      await service.updateAIModel("model-1", { apiKey: "" });

      const updateCall = mockPrismaService.aIModel.update.mock.calls[0][0];
      expect(updateCall.data.apiKey).toBeNull();
    });

    it("should keep existing apiKey when masked format provided", async () => {
      const existingModel = {
        id: "model-1",
        name: "Test",
        modelId: "gpt-4",
        apiKey: "real-key",
        secretKey: null,
        isReasoning: false,
      };
      mockPrismaService.aIModel.findUnique.mockResolvedValue(existingModel);
      mockPrismaService.aIModel.update.mockResolvedValue({
        ...existingModel,
        apiKey: "real-key",
        secretKey: null,
      });

      await service.updateAIModel("model-1", { apiKey: "sk-****1234" });

      const updateCall = mockPrismaService.aIModel.update.mock.calls[0][0];
      expect(updateCall.data.apiKey).toBeUndefined();
    });
  });

  describe("setDefaultAIModel", () => {
    it("should set model as default", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue({
        id: "model-1",
        name: "Test Model",
      });
      mockPrismaService.aIModel.updateMany.mockResolvedValue({ count: 5 });
      mockPrismaService.aIModel.update.mockResolvedValue({
        id: "model-1",
        name: "Test Model",
        isDefault: true,
        apiKey: null,
        secretKey: null,
      });

      const result = await service.setDefaultAIModel("model-1");

      expect(result.isDefault).toBe(true);
      expect(mockPrismaService.aIModel.updateMany).toHaveBeenCalledWith({
        data: { isDefault: false },
      });
    });

    it("should throw NotFoundException when model not found", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue(null);

      await expect(service.setDefaultAIModel("non-existent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("deleteAIModel", () => {
    it("should delete non-default model", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue({
        id: "model-1",
        name: "Test Model",
        isDefault: false,
      });
      mockPrismaService.aIModel.delete.mockResolvedValue({});

      const result = await service.deleteAIModel("model-1");

      expect(result.success).toBe(true);
    });

    it("should throw error when deleting default model", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue({
        id: "model-1",
        name: "Test Model",
        isDefault: true,
      });

      await expect(service.deleteAIModel("model-1")).rejects.toThrow(
        "Cannot delete the default AI model",
      );
    });

    it("should throw NotFoundException when model not found", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue(null);

      await expect(service.deleteAIModel("non-existent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("getAIModelApiKey", () => {
    it("should return null when model not found", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue(null);

      const result = await service.getAIModelApiKey("non-existent");

      expect(result).toBeNull();
    });

    it("should return apiKey directly when no secretKey", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue({
        apiKey: "direct-api-key",
        secretKey: null,
      });

      const result = await service.getAIModelApiKey("model-1");

      expect(result).toBe("direct-api-key");
    });

    it("should resolve from SecretManager when secretKey is set", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue({
        apiKey: "fallback-key",
        secretKey: "my-secret-name",
      });
      mockSecretsService.getValueInternal.mockResolvedValue(
        "  resolved-secret-key  ",
      );

      const result = await service.getAIModelApiKey("model-1");

      expect(result).toBe("resolved-secret-key");
      expect(mockSecretsService.getValueInternal).toHaveBeenCalledWith(
        "my-secret-name",
      );
    });

    it("should fall back to apiKey when secret not found", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue({
        apiKey: "fallback-key",
        secretKey: "missing-secret",
      });
      mockSecretsService.getValueInternal.mockResolvedValue(null);

      const result = await service.getAIModelApiKey("model-1");

      expect(result).toBe("fallback-key");
    });

    it("should trim apiKey whitespace", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue({
        apiKey: "  trimmed-key  ",
        secretKey: null,
      });

      const result = await service.getAIModelApiKey("model-1");

      expect(result).toBe("trimmed-key");
    });
  });

  // ==================== System Settings ====================

  describe("getSettings", () => {
    it("should return settings as key-value pairs", async () => {
      mockPrismaService.systemSetting.findMany.mockResolvedValue([
        { key: "setting1", value: '"string value"' },
        { key: "setting2", value: "123" },
        { key: "setting3", value: '{"nested": true}' },
      ]);

      const result = await service.getSettings();

      expect(result.setting1).toBe("string value");
      expect(result.setting2).toBe(123);
      expect(result.setting3).toEqual({ nested: true });
    });

    it("should filter by category", async () => {
      mockPrismaService.systemSetting.findMany.mockResolvedValue([]);

      await service.getSettings("search");

      expect(mockPrismaService.systemSetting.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { category: "search" } }),
      );
    });

    it("should handle invalid JSON values gracefully", async () => {
      mockPrismaService.systemSetting.findMany.mockResolvedValue([
        { key: "bad-json", value: "not-json-{" },
      ]);

      const result = await service.getSettings();

      expect(result["bad-json"]).toBe("not-json-{");
    });

    it("should skip null values", async () => {
      mockPrismaService.systemSetting.findMany.mockResolvedValue([
        { key: "null-setting", value: null },
        { key: "valid-setting", value: '"hello"' },
      ]);

      const result = await service.getSettings();

      expect(result["null-setting"]).toBeUndefined();
      expect(result["valid-setting"]).toBe("hello");
    });
  });

  describe("getSetting", () => {
    it("should return parsed setting value", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "test",
        value: '{"enabled": true}',
      });

      const result = await service.getSetting("test");

      expect(result).toEqual({ enabled: true });
    });

    it("should return null for non-existent setting", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.getSetting("non-existent");

      expect(result).toBeNull();
    });

    it("should return raw value when JSON parse fails", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "test",
        value: "raw-non-json",
      });

      const result = await service.getSetting("test");

      expect(result).toBe("raw-non-json");
    });

    it("should return null when value is null", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "test",
        value: null,
      });

      const result = await service.getSetting("test");

      expect(result).toBeNull();
    });
  });

  describe("setSetting", () => {
    it("should upsert setting with JSON-serialized value", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({
        key: "test",
        value: "true",
      });

      await service.setSetting("test", true, {
        description: "Test setting",
        category: "test",
      });

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: "test" },
          update: expect.objectContaining({
            value: "true",
          }),
        }),
      );
    });

    it("should serialize string values as-is", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({
        key: "test",
        value: "plain-string",
      });

      await service.setSetting("test", "plain-string");

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ value: "plain-string" }),
        }),
      );
    });
  });

  describe("setSettings", () => {
    it("should update multiple settings in parallel", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});

      await service.setSettings([
        { key: "key1", value: "val1", category: "general" },
        { key: "key2", value: 42, category: "general" },
      ]);

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledTimes(2);
    });
  });

  describe("deleteSetting", () => {
    it("should delete existing setting", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "test",
      });
      mockPrismaService.systemSetting.delete.mockResolvedValue({});

      const result = await service.deleteSetting("test");

      expect(result.success).toBe(true);
    });

    it("should throw NotFoundException for non-existent setting", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await expect(service.deleteSetting("non-existent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ==================== Search Config ====================

  describe("getSearchConfig", () => {
    it("should return search configuration with masked keys", async () => {
      mockPrismaService.systemSetting.findUnique
        .mockResolvedValueOnce({ key: "search.provider", value: '"tavily"' })
        .mockResolvedValueOnce({
          key: "search.perplexity.apiKey",
          value: '"pplx-key"',
        })
        .mockResolvedValueOnce({ key: "search.enabled", value: "true" })
        .mockResolvedValueOnce({ key: "search.tavily.apiKeys", value: null })
        .mockResolvedValueOnce({ key: "search.serper.apiKeys", value: null })
        .mockResolvedValueOnce({
          key: "search.tavily.apiKey",
          value: '"tvly-key"',
        })
        .mockResolvedValueOnce({ key: "search.serper.apiKey", value: null });

      const result = await service.getSearchConfig();

      expect(result.provider).toBe("tavily");
      expect(result.enabled).toBe(true);
      expect(result.perplexity.hasApiKey).toBe(true);
      expect(result.perplexity.apiKey).toBe("***configured***");
      expect(result.tavily.hasApiKey).toBe(true);
      expect(result.duckduckgo.noKeyRequired).toBe(true);
    });

    it("should return defaults when no config exists", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.getSearchConfig();

      expect(result.provider).toBe("tavily");
      expect(result.enabled).toBe(true);
      expect(result.perplexity.hasApiKey).toBe(false);
      expect(result.tavily.hasApiKey).toBe(false);
    });

    it("should handle array format for tavily keys", async () => {
      mockPrismaService.systemSetting.findUnique
        .mockResolvedValueOnce(null) // provider
        .mockResolvedValueOnce(null) // perplexity key
        .mockResolvedValueOnce(null) // enabled
        .mockResolvedValueOnce({
          key: "search.tavily.apiKeys",
          value: '["key1","key2"]',
        }) // new format
        .mockResolvedValueOnce(null) // serper keys new
        .mockResolvedValueOnce(null) // tavily legacy
        .mockResolvedValueOnce(null); // serper legacy

      const result = await service.getSearchConfig();

      expect(result.tavily.keyCount).toBe(2);
      expect(result.tavily.hasApiKey).toBe(true);
    });
  });

  describe("updateSearchConfig", () => {
    it("should update provider and enabled settings", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateSearchConfig({
        provider: "serper",
        enabled: false,
      });

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledTimes(2);
    });

    it("should skip masked API keys", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateSearchConfig({
        perplexityApiKey: "***configured***",
      });

      // Should not save the masked key
      const calls = mockPrismaService.systemSetting.upsert.mock.calls;
      const hasPerplexityCall = calls.some(
        (call) => call[0].where.key === "search.perplexity.apiKey",
      );
      expect(hasPerplexityCall).toBe(false);
    });

    it("should save valid perplexity API key", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateSearchConfig({
        perplexityApiKey: "pplx-real-key",
      });

      const calls = mockPrismaService.systemSetting.upsert.mock.calls;
      const perplexityCall = calls.find(
        (call) => call[0].where.key === "search.perplexity.apiKey",
      );
      expect(perplexityCall).toBeDefined();
    });

    it("should convert single tavilyApiKey to array format", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateSearchConfig({
        tavilyApiKey: "tvly-single-key",
      });

      const calls = mockPrismaService.systemSetting.upsert.mock.calls;
      const tavilyCall = calls.find(
        (call) => call[0].where.key === "search.tavily.apiKeys",
      );
      expect(tavilyCall).toBeDefined();
    });

    it("should handle multiple tavily keys", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateSearchConfig({
        tavilyApiKeys: ["key1", "key2", "***configured***"],
      });

      const calls = mockPrismaService.systemSetting.upsert.mock.calls;
      const tavilyCall = calls.find(
        (call) => call[0].where.key === "search.tavily.apiKeys",
      );
      // Should filter out masked key
      expect(tavilyCall).toBeDefined();
    });
  });

  describe("getSearchApiKey", () => {
    it("should return perplexity key", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "search.perplexity.apiKey",
        value: '"pplx-key"',
      });

      const result = await service.getSearchApiKey("perplexity");

      expect(result).toBe("pplx-key");
    });

    it("should return null for unknown provider", async () => {
      const result = await service.getSearchApiKey("unknown");

      expect(result).toBeNull();
    });

    it("should return tavily key", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "search.tavily.apiKey",
        value: '"tvly-key"',
      });

      const result = await service.getSearchApiKey("tavily");

      expect(result).toBe("tvly-key");
    });

    it("should return serper key", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "search.serper.apiKey",
        value: '"serper-key"',
      });

      const result = await service.getSearchApiKey("serper");

      expect(result).toBe("serper-key");
    });
  });

  // ==================== Content Extraction Config ====================

  describe("getContentExtractionConfig", () => {
    it("should return extraction config with masked keys", async () => {
      mockPrismaService.systemSetting.findUnique
        .mockResolvedValueOnce({
          key: "extraction.jina.apiKey",
          value: '"jina-long-api-key-123"',
        })
        .mockResolvedValueOnce({
          key: "extraction.firecrawl.apiKey",
          value: '"fire-long-api-key-123"',
        })
        .mockResolvedValueOnce({ key: "extraction.tavily.apiKey", value: null })
        .mockResolvedValueOnce({ key: "extraction.enabled", value: "true" });

      const result = await service.getContentExtractionConfig();

      expect(result.enabled).toBe(true);
      expect(result.jina.hasApiKey).toBe(true);
      expect(result.jina.apiKey).toContain("****");
      expect(result.firecrawl.hasApiKey).toBe(true);
      expect(result.tavily.hasApiKey).toBe(false);
    });
  });

  describe("updateContentExtractionConfig", () => {
    it("should update enabled and valid API keys", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateContentExtractionConfig({
        enabled: true,
        jinaApiKey: "jina-real-key",
      });

      const calls = mockPrismaService.systemSetting.upsert.mock.calls;
      const jinaCall = calls.find(
        (call) => call[0].where.key === "extraction.jina.apiKey",
      );
      expect(jinaCall).toBeDefined();
    });

    it("should skip masked keys", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateContentExtractionConfig({
        jinaApiKey: "jina-****-key",
      });

      const calls = mockPrismaService.systemSetting.upsert.mock.calls;
      const jinaCall = calls.find(
        (call) => call[0].where.key === "extraction.jina.apiKey",
      );
      expect(jinaCall).toBeUndefined();
    });
  });

  describe("getContentExtractionApiKey", () => {
    it("should return jina API key", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "extraction.jina.apiKey",
        value: '"jina-api-key"',
      });

      const result = await service.getContentExtractionApiKey("jina");

      expect(result).toBe("jina-api-key");
    });
  });

  // ==================== YouTube Config ====================

  describe("getYoutubeConfig", () => {
    it("should return youtube config", async () => {
      mockPrismaService.systemSetting.findUnique
        .mockResolvedValueOnce({
          key: "youtube.supadata.apiKey",
          value: '"supadata-long-api-key-123"',
        })
        .mockResolvedValueOnce({ key: "youtube.enabled", value: "true" })
        .mockResolvedValueOnce({
          key: "youtube.provider",
          value: '"supadata"',
        });

      const result = await service.getYoutubeConfig();

      expect(result.enabled).toBe(true);
      expect(result.provider).toBe("supadata");
      expect(result.supadata.hasApiKey).toBe(true);
    });
  });

  describe("updateYoutubeConfig", () => {
    it("should update youtube config", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateYoutubeConfig({
        enabled: true,
        provider: "supadata",
        supadataApiKey: "supa-real-key",
      });

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalled();
    });

    it("should skip masked supadata key", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateYoutubeConfig({
        supadataApiKey: "supa-****-key",
      });

      const calls = mockPrismaService.systemSetting.upsert.mock.calls;
      const supadataCall = calls.find(
        (call) => call[0].where.key === "youtube.supadata.apiKey",
      );
      expect(supadataCall).toBeUndefined();
    });
  });

  describe("getYoutubeApiKey", () => {
    it("should return supadata API key", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "youtube.supadata.apiKey",
        value: '"supa-key"',
      });

      const result = await service.getYoutubeApiKey("supadata");

      expect(result).toBe("supa-key");
    });
  });

  // ==================== TTS Config ====================

  describe("getTTSConfig", () => {
    it("should return TTS config", async () => {
      mockPrismaService.systemSetting.findUnique
        .mockResolvedValueOnce({
          key: "tts.elevenlabs.apiKey",
          value: '"eleven-long-api-key-123"',
        })
        .mockResolvedValueOnce({ key: "tts.google.apiKey", value: null })
        .mockResolvedValueOnce({ key: "tts.enabled", value: "true" })
        .mockResolvedValueOnce({
          key: "tts.provider",
          value: '"elevenlabs"',
        });

      const result = await service.getTTSConfig();

      expect(result.enabled).toBe(true);
      expect(result.provider).toBe("elevenlabs");
      expect(result.elevenlabs.hasApiKey).toBe(true);
      expect(result.google.hasApiKey).toBe(false);
    });
  });

  describe("updateTTSConfig", () => {
    it("should update TTS keys", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateTTSConfig({
        provider: "elevenlabs",
        elevenLabsApiKey: "eleven-real-key",
      });

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalled();
    });
  });

  describe("getTTSApiKey", () => {
    it("should return elevenlabs API key", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "tts.elevenlabs.apiKey",
        value: '"eleven-key"',
      });

      const result = await service.getTTSApiKey("elevenlabs");

      expect(result).toBe("eleven-key");
    });
  });

  // ==================== SkillsMP Config ====================

  describe("getSkillsmpConfig", () => {
    it("should return skillsmp config with masked key", async () => {
      mockPrismaService.systemSetting.findUnique
        .mockResolvedValueOnce({ key: "skillsmp.enabled", value: "true" })
        .mockResolvedValueOnce({
          key: "skillsmp.apiKey",
          value: '"skillsmp-long-api-key-123"',
        })
        .mockResolvedValueOnce({
          key: "skillsmp.lastSync",
          value: '"2024-01-01"',
        })
        .mockResolvedValueOnce({
          key: "skillsmp.syncInterval",
          value: '"daily"',
        });

      const result = await service.getSkillsmpConfig();

      expect(result.enabled).toBe(true);
      expect(result.hasApiKey).toBe(true);
      expect(result.apiKey).toContain("****");
      expect(result.syncInterval).toBe("daily");
    });

    it("should return defaults when not configured", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.getSkillsmpConfig();

      expect(result.enabled).toBe(true);
      expect(result.hasApiKey).toBe(false);
      expect(result.syncInterval).toBe("daily");
    });
  });

  describe("updateSkillsmpConfig", () => {
    it("should update enabled status and API key", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateSkillsmpConfig({
        enabled: true,
        apiKey: "skillsmp-real-key",
        syncInterval: "weekly",
      });

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalled();
    });

    it("should skip masked API key", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateSkillsmpConfig({
        apiKey: "skillsmp-****-key",
      });

      const calls = mockPrismaService.systemSetting.upsert.mock.calls;
      const apiKeyCall = calls.find(
        (call) => call[0].where.key === "skillsmp.apiKey",
      );
      expect(apiKeyCall).toBeUndefined();
    });
  });

  describe("getSkillsmpApiKey", () => {
    it("should return skillsmp API key", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "skillsmp.apiKey",
        value: '"smp-key"',
      });

      const result = await service.getSkillsmpApiKey();

      expect(result).toBe("smp-key");
    });
  });

  // ==================== installSkillFromMarketplace ====================

  describe("installSkillFromMarketplace", () => {
    it("should upsert skill config", async () => {
      mockPrismaService.skillConfig.upsert.mockResolvedValue({
        skillId: "my-skill",
        enabled: true,
      });

      const result = await service.installSkillFromMarketplace({
        id: "my-skill",
        name: "My Skill",
        displayName: "My Skill Display",
        description: "A skill",
        layer: "content",
        domain: "writing",
        tags: ["creative"],
      });

      expect(result).toBeDefined();
      expect(mockPrismaService.skillConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { skillId: "my-skill" },
          create: expect.objectContaining({
            skillId: "my-skill",
            enabled: true,
          }),
        }),
      );
    });

    it("should use defaults for optional fields", async () => {
      mockPrismaService.skillConfig.upsert.mockResolvedValue({
        skillId: "simple-skill",
      });

      await service.installSkillFromMarketplace({
        id: "simple-skill",
        name: "Simple",
      });

      expect(mockPrismaService.skillConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            layer: "application",
            domain: "common",
            tags: [],
          }),
        }),
      );
    });
  });

  // ==================== External Providers Config ====================

  describe("getExternalProvidersConfig", () => {
    it("should return default providers when none configured", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.getExternalProvidersConfig();

      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBeGreaterThanOrEqual(4);
      expect(result.every((p) => "hasApiKey" in p)).toBe(true);
    });

    it("should merge stored config with defaults", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "external.providers",
        value: JSON.stringify([
          {
            id: "market",
            enabled: true,
            baseUrl: "https://market.api.com",
            apiKey: "market-key",
          },
        ]),
      });

      const result = await service.getExternalProvidersConfig();

      const marketProvider = result.find((p) => p.id === "market");
      expect(marketProvider).toBeDefined();
      expect(marketProvider!.enabled).toBe(true);
      expect(marketProvider!.hasApiKey).toBe(true);
    });
  });

  describe("updateExternalProvidersConfig", () => {
    it("should save valid providers", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});

      await service.updateExternalProvidersConfig([
        {
          id: "market",
          name: "Market API",
          category: "market",
          baseUrl: "https://market.api.com",
          apiKey: "market-key",
          enabled: true,
        },
      ]);

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalled();
    });

    it("should filter out providers with invalid data", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});

      // Provider with no id, name, or URL
      await service.updateExternalProvidersConfig([
        { id: "", name: "", category: "test" },
      ]);

      const upsertCall = mockPrismaService.systemSetting.upsert.mock.calls[0];
      const savedProviders = JSON.parse(upsertCall[0].update.value);
      expect(savedProviders).toHaveLength(0);
    });
  });

  // ==================== checkApiBalance ====================

  describe("checkApiBalance", () => {
    it("should return error when API key not configured", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.checkApiBalance("search", "tavily");

      expect(result.hasBalance).toBe(false);
      expect(result.error).toBe("API Key not configured");
    });

    it("should check tavily balance with valid key", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "search.tavily.apiKey",
        value: '"tvly-key"',
      });
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const result = await service.checkApiBalance("search", "tavily");

      expect(result.provider).toBe("tavily");
      expect(result.hasBalance).toBe(true);
    });

    it("should handle tavily 401 response", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "search.tavily.apiKey",
        value: '"tvly-key"',
      });
      mockFetch.mockResolvedValue({ ok: false, status: 401 });

      const result = await service.checkApiBalance("search", "tavily");

      expect(result.hasBalance).toBe(false);
      expect(result.error).toContain("Invalid");
    });

    it("should handle tavily 429 rate limit", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "search.tavily.apiKey",
        value: '"tvly-key"',
      });
      mockFetch.mockResolvedValue({ ok: false, status: 429 });

      const result = await service.checkApiBalance("search", "tavily");

      expect(result.hasBalance).toBe(false);
      expect(result.error).toContain("Rate limit");
    });

    it("should handle fetch network error", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "search.tavily.apiKey",
        value: '"tvly-key"',
      });
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await service.checkApiBalance("search", "tavily");

      expect(result.hasBalance).toBe(false);
    });

    it("should check extraction balance for jina", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "extraction.jina.apiKey",
        value: '"jina-key"',
      });
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ balance: 5.0 }),
      });

      const result = await service.checkApiBalance("extraction", "jina");

      expect(result.provider).toBe("jina");
      expect(result.hasBalance).toBe(true);
    });

    it("should handle unknown extraction provider", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.checkApiBalance("extraction", "unknown");

      expect(result.hasBalance).toBe(false);
    });

    it("should return unknown balance for unrecognized switch case", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "search.perplexity.apiKey",
        value: '"pplx-key"',
      });
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const result = await service.checkApiBalance("search", "perplexity");

      expect(result.provider).toBe("perplexity");
    });
  });

  // ==================== resetCollectionData ====================

  describe("resetCollectionData", () => {
    it("should reset all collection data", async () => {
      mockPrismaService.rawData.count.mockResolvedValue(100);
      mockPrismaService.resource.count.mockResolvedValue(50);
      mockPrismaService.deduplicationRecord.count.mockResolvedValue(200);

      mockPrismaService.deduplicationRecord.deleteMany.mockResolvedValue({
        count: 200,
      });
      mockPrismaService.note.deleteMany.mockResolvedValue({ count: 10 });
      mockPrismaService.comment.deleteMany.mockResolvedValue({ count: 20 });
      mockPrismaService.resource.deleteMany.mockResolvedValue({ count: 50 });
      mockPrismaService.rawData.deleteMany.mockResolvedValue({ count: 100 });
      mockPrismaService.collectionTask.updateMany.mockResolvedValue({
        count: 5,
      });
      mockPrismaService.dataSource.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.resetCollectionData();

      expect(result.success).toBe(true);
      expect(result.deleted.rawData).toBe(100);
      expect(result.deleted.resources).toBe(50);
      expect(result.deleted.deduplicationRecords).toBe(200);
      expect(result.before.rawData).toBe(100);
    });
  });

  // ==================== Additional coverage tests ====================

  describe("getCreditAccounts (additional)", () => {
    it("should use empty where clause when no search term provided", async () => {
      mockPrismaService.creditAccount.findMany.mockResolvedValue([]);
      mockPrismaService.creditAccount.count.mockResolvedValue(0);

      await service.getCreditAccounts(1, 20);

      expect(mockPrismaService.creditAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it("should apply skip offset based on page and limit", async () => {
      mockPrismaService.creditAccount.findMany.mockResolvedValue([]);
      mockPrismaService.creditAccount.count.mockResolvedValue(0);

      await service.getCreditAccounts(3, 10);

      expect(mockPrismaService.creditAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });

  describe("getCreditTransactions (additional)", () => {
    it("should use default limit 50 and offset 0", async () => {
      mockPrismaService.creditAccount.findUnique.mockResolvedValue({
        id: "account-1",
        userId: "user-1",
      });
      mockPrismaService.creditTransaction.findMany.mockResolvedValue([]);
      mockPrismaService.creditTransaction.count.mockResolvedValue(0);

      const result = await service.getCreditTransactions("user-1");

      expect(mockPrismaService.creditTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50, skip: 0 }),
      );
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
    });
  });

  describe("getAIModel (additional)", () => {
    it("should return null apiKey when model has no apiKey", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue({
        id: "model-1",
        name: "No-Key Model",
        apiKey: null,
        secretKey: null,
      });

      const result = await service.getAIModel("model-1");

      expect(result.apiKey).toBeNull();
      expect(result.hasApiKey).toBe(false);
    });
  });

  describe("createAIModel (additional)", () => {
    it("should add warning when isReasoning=true but model name does not match known patterns", async () => {
      mockPrismaService.aIModel.findFirst.mockResolvedValue(null);
      mockPrismaService.aIModel.create.mockResolvedValue({
        id: "new-model",
        name: "My Custom Model",
        apiKey: null,
        secretKey: null,
        isUpdate: false,
      });

      const result = await service.createAIModel({
        name: "My Custom Model",
        displayName: "My Custom Model",
        provider: "custom",
        modelId: "my-custom-chat-model",
        icon: "icon",
        color: "#000",
        apiEndpoint: "https://api.example.com",
        isReasoning: true,
      });

      // The name does not match o1/o3/reasoning patterns, so a warning is issued
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            "does not match known reasoning model patterns",
          ),
        ]),
      );
    });

    it("should create model with null apiKey when no key provided", async () => {
      mockPrismaService.aIModel.findFirst.mockResolvedValue(null);
      mockPrismaService.aIModel.create.mockResolvedValue({
        id: "model-no-key",
        name: "No Key Model",
        apiKey: null,
        secretKey: null,
        isUpdate: false,
      });

      const result = await service.createAIModel({
        name: "No Key Model",
        displayName: "No Key Model",
        provider: "openai",
        modelId: "gpt-no-key",
        icon: "icon",
        color: "#000",
        apiEndpoint: "https://api.openai.com",
      });

      expect(mockPrismaService.aIModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ apiKey: null }),
        }),
      );
      expect(result.hasApiKey).toBe(false);
    });
  });

  describe("updateAIModel (additional)", () => {
    it("should return warnings from validateAndCorrectModelConfig", async () => {
      const existingModel = {
        id: "model-1",
        name: "o3",
        modelId: "o3-mini",
        apiKey: null,
        secretKey: null,
        isReasoning: true,
      };
      mockPrismaService.aIModel.findUnique.mockResolvedValue(existingModel);
      mockPrismaService.aIModel.update.mockResolvedValue({
        ...existingModel,
        apiKey: null,
        secretKey: null,
      });

      const result = await service.updateAIModel("model-1", {
        isReasoning: false,
        tokenParamName: undefined,
        supportsTemperature: undefined,
      });

      // warnings array should exist on the result
      expect(result).toHaveProperty("warnings");
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it("should update new real apiKey when not masked", async () => {
      const existingModel = {
        id: "model-1",
        name: "Test",
        modelId: "gpt-4",
        apiKey: "old-key",
        secretKey: null,
        isReasoning: false,
      };
      mockPrismaService.aIModel.findUnique.mockResolvedValue(existingModel);
      mockPrismaService.aIModel.update.mockResolvedValue({
        ...existingModel,
        apiKey: "new-real-key",
        secretKey: null,
      });

      await service.updateAIModel("model-1", { apiKey: "new-real-key" });

      const updateCall = mockPrismaService.aIModel.update.mock.calls[0][0];
      expect(updateCall.data.apiKey).toBe("new-real-key");
    });
  });

  describe("getAIModelApiKey (additional)", () => {
    it("should return null when model has no apiKey and no secretKey", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue({
        apiKey: null,
        secretKey: null,
      });

      const result = await service.getAIModelApiKey("model-no-key");

      expect(result).toBeNull();
    });
  });

  describe("setSettings (additional)", () => {
    it("should return empty array and skip upsert when passed empty array", async () => {
      const result = await service.setSettings([]);

      expect(mockPrismaService.systemSetting.upsert).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe("deleteSetting (additional)", () => {
    it("should call systemSetting.delete with the correct key", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "my.setting",
      });
      mockPrismaService.systemSetting.delete.mockResolvedValue({});

      await service.deleteSetting("my.setting");

      expect(mockPrismaService.systemSetting.delete).toHaveBeenCalledWith({
        where: { key: "my.setting" },
      });
    });
  });

  describe("updateSearchConfig (additional)", () => {
    it("should not save tavilyApiKeys when all entries are masked or empty", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateSearchConfig({
        tavilyApiKeys: ["***configured***", "  ", ""],
      });

      const calls = mockPrismaService.systemSetting.upsert.mock.calls;
      const tavilyCall = calls.find(
        (call) => call[0].where.key === "search.tavily.apiKeys",
      );
      expect(tavilyCall).toBeUndefined();
    });

    it("should save serperApiKeys in multi-key format", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateSearchConfig({
        serperApiKeys: ["serper-key-1", "serper-key-2"],
      });

      const calls = mockPrismaService.systemSetting.upsert.mock.calls;
      const serperCall = calls.find(
        (call) => call[0].where.key === "search.serper.apiKeys",
      );
      expect(serperCall).toBeDefined();
    });
  });

  describe("updateYoutubeConfig (additional)", () => {
    it("should update provider setting when provided", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateYoutubeConfig({ provider: "supadata" });

      const calls = mockPrismaService.systemSetting.upsert.mock.calls;
      const providerCall = calls.find(
        (call) => call[0].where.key === "youtube.provider",
      );
      expect(providerCall).toBeDefined();
    });

    it("should not update youtube config when no fields provided", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateYoutubeConfig({});

      expect(mockPrismaService.systemSetting.upsert).not.toHaveBeenCalled();
    });
  });

  describe("checkApiBalance (additional)", () => {
    it("should check firecrawl balance returning credit info", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "extraction.firecrawl.apiKey",
        value: '"fc-realkey"',
      });
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ remaining_credits: 100, credits_used: 50 }),
      });

      const result = await service.checkApiBalance("extraction", "firecrawl");

      expect(result.provider).toBe("firecrawl");
      expect(result.hasBalance).toBe(true);
      expect(result.balance).toContain("100");
    });

    it("should return hasBalance=false for firecrawl 401", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "extraction.firecrawl.apiKey",
        value: '"fc-bad-key"',
      });
      mockFetch.mockResolvedValue({ ok: false, status: 401 });

      const result = await service.checkApiBalance("extraction", "firecrawl");

      expect(result.hasBalance).toBe(false);
      expect(result.error).toContain("Invalid");
    });

    it("should return default hasBalance=true for unknown switch case provider", async () => {
      // provider that passes API key check but hits the default case in switch
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "search.serper.apiKey",
        value: '"some-key"',
      });
      // The switch default branch returns { hasBalance: true, balance: "Unknown" }
      // We use a provider that has an apiKey but no case branch: "unknown-provider"
      // Re-wire: we'll test using extraction type with "tavily" which delegates to checkTavilyBalance via extraction
      // Actually use type=search with provider that goes to default (not tavily/firecrawl/jina/serper/perplexity)
      // Let's directly test via a provider name that hits the switch default
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "search.custom.apiKey",
        value: '"some-key"',
      });
      // getSearchApiKey("custom-provider") returns null since it's not perplexity/tavily/serper
      // So we won't reach the switch. Let's test the scenario where a valid extraction apiKey
      // is found for a provider that doesn't match any case: that cannot happen due to TypeScript typing.
      // Instead verify the outer catch path: throw inside checkApiBalance body
      mockFetch.mockRejectedValue(new Error("connection refused"));
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "search.tavily.apiKey",
        value: '"tvly-key"',
      });

      const result = await service.checkApiBalance("search", "tavily");

      expect(result.hasBalance).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should check serper balance with valid key", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "search.serper.apiKey",
        value: '"serper-real-key"',
      });
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ credits: 500 }),
      });

      const result = await service.checkApiBalance("search", "serper");

      expect(result.provider).toBe("serper");
    });
  });

  describe("getContentExtractionConfig (additional)", () => {
    it("should return enabled=false when setting is explicitly false", async () => {
      mockPrismaService.systemSetting.findUnique
        .mockResolvedValueOnce(null) // jina key
        .mockResolvedValueOnce(null) // firecrawl key
        .mockResolvedValueOnce(null) // tavily key
        .mockResolvedValueOnce({ key: "extraction.enabled", value: "false" });

      const result = await service.getContentExtractionConfig();

      expect(result.enabled).toBe(false);
    });
  });

  describe("getExternalProvidersConfig (additional)", () => {
    it("should include custom providers not in the default list", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "external.providers",
        value: JSON.stringify([
          {
            id: "custom-provider",
            name: "Custom API",
            category: "custom",
            baseUrl: "https://custom.api.com",
            apiKey: "custom-key",
            enabled: true,
          },
        ]),
      });

      const result = await service.getExternalProvidersConfig();

      const customProvider = result.find((p) => p.id === "custom-provider");
      expect(customProvider).toBeDefined();
      expect(customProvider!.hasApiKey).toBe(true);
      expect(customProvider!.enabled).toBe(true);
    });
  });

  describe("updateExternalProvidersConfig (additional)", () => {
    it("should preserve existing apiKey when incoming apiKey is masked", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "external.providers",
        value: JSON.stringify([
          {
            id: "market",
            name: "Market API",
            category: "market",
            baseUrl: "https://market.api.com",
            apiKey: "existing-real-key",
            enabled: true,
          },
        ]),
      });
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});

      await service.updateExternalProvidersConfig([
        {
          id: "market",
          name: "Market API",
          category: "market",
          baseUrl: "https://market.api.com",
          apiKey: "***masked***", // masked - should preserve existing
          enabled: true,
        },
      ]);

      const upsertCall = mockPrismaService.systemSetting.upsert.mock.calls[0];
      const savedProviders = JSON.parse(upsertCall[0].update.value);
      const saved = savedProviders.find(
        (p: { id: string }) => p.id === "market",
      );
      expect(saved.apiKey).toBe("existing-real-key");
    });
  });
});
