/**
 * AdminService Supplemental Tests 2
 *
 * Covers methods NOT tested in admin.service.spec.ts or admin.service-supplemental.spec.ts:
 * - getCreditAccounts() — search filter, pagination
 * - getCreditsStats() — aggregate stats
 * - getCreditTransactions() — account not found, pagination
 * - getAllAIModels() — masked apiKey listing
 * - getAIModel() — found/not found, includeFullApiKey flag
 * - maskApiKey() — via getAllAIModels / getAIModel: short key, long key
 * - getAllUsers() — delegate to UserManagementService
 * - setDefaultAIModel() — clears all defaults, sets new one; not found
 * - deleteAIModel() — success and not found
 * - createAIModel() — upsert (existing by modelId+name path)
 * - getOverviewStats() / getSystemStats() — delegate paths
 * - isUserAdmin() — delegate
 * - toggleUserStatus(), updateUser(), deleteUser(), getUserCredits(), grantCredits(),
 *   toggleCreditFreeze() — delegate paths
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { AdminService } from "../admin.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { SecretsService } from "../../../platform/credentials/storage/secrets/secrets.service";
import { UserManagementService } from "../services/user-management.service";
import { ResourceManagementService } from "../services/resource-management.service";
import { StatisticsService } from "../services/statistics.service";

describe("AdminService (supplemental2)", () => {
  let service: AdminService;

  const mockPrismaService = {
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
    rawData: { count: jest.fn(), deleteMany: jest.fn() },
    deduplicationRecord: { count: jest.fn(), deleteMany: jest.fn() },
    note: { deleteMany: jest.fn() },
    comment: { deleteMany: jest.fn() },
    resource: { count: jest.fn(), deleteMany: jest.fn() },
    collectionTask: { updateMany: jest.fn() },
    dataSource: { updateMany: jest.fn() },
    creditAccount: {
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      findUnique: jest.fn(),
    },
    creditTransaction: { findMany: jest.fn(), count: jest.fn() },
    skillConfig: { upsert: jest.fn() },
  };

  const mockUserMgmtService = {
    getAllUsers: jest.fn(),
    getUserDetail: jest.fn(),
    updateUserRole: jest.fn(),
    toggleUserStatus: jest.fn(),
    isUserAdmin: jest.fn(),
    getUserStats: jest.fn(),
    getUserLoginHistory: jest.fn(),
    createUser: jest.fn(),
    updateUser: jest.fn(),
    deleteUser: jest.fn(),
    getUserCredits: jest.fn(),
    grantCredits: jest.fn(),
    toggleCreditFreeze: jest.fn(),
  };

  const mockResourceMgmtService = {
    getResourceById: jest.fn(),
    deleteResource: jest.fn(),
    deleteResources: jest.fn(),
  };

  const mockStatisticsService = {
    getSystemStats: jest.fn(),
    getResourceStats: jest.fn(),
    getOverviewStats: jest.fn(),
  };

  const mockSecretsService = {
    getValue: jest.fn(),
    getValueInternal: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: SecretsService, useValue: mockSecretsService },
        { provide: UserManagementService, useValue: mockUserMgmtService },
        {
          provide: ResourceManagementService,
          useValue: mockResourceMgmtService,
        },
        { provide: StatisticsService, useValue: mockStatisticsService },
        // S5 audit fix
        {
          provide: require("../../../../common/audit/audit.service")
            .AuditService,
          useValue: { log: jest.fn() },
        },
        // PR-6 (2026-05-12): AdminService 新增 KeyAssignmentsService 依赖
        {
          provide:
            require("../../../platform/credentials/governance/key-assignments/key-assignments.service")
              .KeyAssignmentsService,
          useValue: {
            reactivateStale: jest.fn().mockResolvedValue({ count: 0 }),
          },
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  // ==================== getCreditAccounts ====================

  describe("getCreditAccounts()", () => {
    const mockAccounts = [
      {
        userId: "user-1",
        balance: 1000,
        totalEarned: 2000,
        totalSpent: 1000,
        isFrozen: false,
        createdAt: new Date("2026-01-01"),
        user: { id: "user-1", email: "user1@example.com", username: "user1" },
      },
      {
        userId: "user-2",
        balance: 500,
        totalEarned: 500,
        totalSpent: 0,
        isFrozen: true,
        createdAt: new Date("2026-01-02"),
        user: { id: "user-2", email: "user2@example.com", username: "user2" },
      },
    ];

    it("should return paginated credit accounts with correct shape", async () => {
      mockPrismaService.creditAccount.findMany.mockResolvedValue(mockAccounts);
      mockPrismaService.creditAccount.count.mockResolvedValue(2);

      const result = await service.getCreditAccounts(1, 20);

      expect(result.accounts).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(20);
      expect(result.pagination.totalPages).toBe(1);

      // Check account shape
      expect(result.accounts[0].userId).toBe("user-1");
      expect(result.accounts[0].email).toBe("user1@example.com");
      expect(result.accounts[0].balance).toBe(1000);
      expect(result.accounts[0].isFrozen).toBe(false);
    });

    it("should pass search filter to prisma query", async () => {
      mockPrismaService.creditAccount.findMany.mockResolvedValue([]);
      mockPrismaService.creditAccount.count.mockResolvedValue(0);

      await service.getCreditAccounts(1, 20, "john");

      const findManyCall =
        mockPrismaService.creditAccount.findMany.mock.calls[0][0];
      expect(findManyCall.where).toMatchObject({
        user: {
          OR: expect.arrayContaining([
            expect.objectContaining({
              email: expect.objectContaining({ contains: "john" }),
            }),
            expect.objectContaining({
              username: expect.objectContaining({ contains: "john" }),
            }),
          ]),
        },
      });
    });

    it("should use empty where clause when no search provided", async () => {
      mockPrismaService.creditAccount.findMany.mockResolvedValue([]);
      mockPrismaService.creditAccount.count.mockResolvedValue(0);

      await service.getCreditAccounts(1, 10);

      const findManyCall =
        mockPrismaService.creditAccount.findMany.mock.calls[0][0];
      expect(findManyCall.where).toEqual({});
    });

    it("should calculate correct skip for page 3", async () => {
      mockPrismaService.creditAccount.findMany.mockResolvedValue([]);
      mockPrismaService.creditAccount.count.mockResolvedValue(0);

      await service.getCreditAccounts(3, 10);

      const findManyCall =
        mockPrismaService.creditAccount.findMany.mock.calls[0][0];
      expect(findManyCall.skip).toBe(20); // (3-1) * 10
      expect(findManyCall.take).toBe(10);
    });

    it("should calculate totalPages correctly for non-even division", async () => {
      mockPrismaService.creditAccount.findMany.mockResolvedValue([]);
      mockPrismaService.creditAccount.count.mockResolvedValue(25);

      const result = await service.getCreditAccounts(1, 10);
      expect(result.pagination.totalPages).toBe(3); // Math.ceil(25/10)
    });
  });

  // ==================== getCreditsStats ====================

  describe("getCreditsStats()", () => {
    it("should return aggregated credits stats", async () => {
      mockPrismaService.creditAccount.count
        .mockResolvedValueOnce(100) // totalAccounts
        .mockResolvedValueOnce(5) // frozenAccounts
        .mockResolvedValueOnce(20); // lowBalanceAccounts
      mockPrismaService.creditAccount.aggregate.mockResolvedValue({
        _sum: {
          balance: 150000,
          totalEarned: 300000,
          totalSpent: 150000,
        },
      });

      const result = await service.getCreditsStats();

      expect(result.totalAccounts).toBe(100);
      expect(result.totalBalance).toBe(150000);
      expect(result.totalEarned).toBe(300000);
      expect(result.totalSpent).toBe(150000);
      expect(result.frozenAccounts).toBe(5);
      expect(result.lowBalanceAccounts).toBe(20);
    });

    it("should handle null aggregate sums gracefully (return 0)", async () => {
      mockPrismaService.creditAccount.count.mockResolvedValue(0);
      mockPrismaService.creditAccount.aggregate.mockResolvedValue({
        _sum: {
          balance: null,
          totalEarned: null,
          totalSpent: null,
        },
      });

      const result = await service.getCreditsStats();

      expect(result.totalBalance).toBe(0);
      expect(result.totalEarned).toBe(0);
      expect(result.totalSpent).toBe(0);
    });
  });

  // ==================== getCreditTransactions ====================

  describe("getCreditTransactions()", () => {
    const mockAccount = { id: "account-1", userId: "user-1" };
    const mockTransactions = [
      {
        id: "tx-1",
        type: "DEBIT",
        amount: 100,
        balanceAfter: 900,
        description: "Used AI chat",
        moduleType: "AI_CHAT",
        operationType: "CONSUMPTION",
        createdAt: new Date("2026-01-10"),
      },
      {
        id: "tx-2",
        type: "CREDIT",
        amount: 500,
        balanceAfter: 1400,
        description: "Admin grant",
        moduleType: null,
        operationType: "GRANT",
        createdAt: new Date("2026-01-09"),
      },
    ];

    it("should return transactions with pagination info", async () => {
      mockPrismaService.creditAccount.findUnique.mockResolvedValue(mockAccount);
      mockPrismaService.creditTransaction.findMany.mockResolvedValue(
        mockTransactions,
      );
      mockPrismaService.creditTransaction.count.mockResolvedValue(2);

      const result = await service.getCreditTransactions("user-1", 50, 0);

      expect(result.transactions).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);

      // Verify transaction shape
      expect(result.transactions[0].id).toBe("tx-1");
      expect(result.transactions[0].type).toBe("DEBIT");
      expect(result.transactions[0].amount).toBe(100);
    });

    it("should throw NotFoundException when credit account not found", async () => {
      mockPrismaService.creditAccount.findUnique.mockResolvedValue(null);

      await expect(
        service.getCreditTransactions("nonexistent-user"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should use default limit=50 and offset=0", async () => {
      mockPrismaService.creditAccount.findUnique.mockResolvedValue(mockAccount);
      mockPrismaService.creditTransaction.findMany.mockResolvedValue([]);
      mockPrismaService.creditTransaction.count.mockResolvedValue(0);

      await service.getCreditTransactions("user-1");

      const findManyCall =
        mockPrismaService.creditTransaction.findMany.mock.calls[0][0];
      expect(findManyCall.take).toBe(50);
      expect(findManyCall.skip).toBe(0);
    });

    it("should query transactions by account id", async () => {
      mockPrismaService.creditAccount.findUnique.mockResolvedValue({
        id: "acct-xyz",
        userId: "user-1",
      });
      mockPrismaService.creditTransaction.findMany.mockResolvedValue([]);
      mockPrismaService.creditTransaction.count.mockResolvedValue(0);

      await service.getCreditTransactions("user-1");

      const findManyCall =
        mockPrismaService.creditTransaction.findMany.mock.calls[0][0];
      expect(findManyCall.where).toEqual({ accountId: "acct-xyz" });
    });
  });

  // ==================== getAllAIModels ====================

  describe("getAllAIModels()", () => {
    it("should return all models with masked apiKeys", async () => {
      mockPrismaService.aIModel.findMany.mockResolvedValue([
        {
          id: "m-1",
          name: "GPT-4",
          apiKey: "sk-abcdef1234567890",
          secretKey: null,
        },
        {
          id: "m-2",
          name: "Claude",
          apiKey: null,
          secretKey: "my-secret",
        },
        {
          id: "m-3",
          name: "No Key Model",
          apiKey: null,
          secretKey: null,
        },
      ]);

      const result = await service.getAllAIModels();

      expect(result).toHaveLength(3);

      // apiKey should be masked
      expect(result[0].apiKey).toContain("****");
      expect(result[0].apiKey).not.toBe("sk-abcdef1234567890");
      expect(result[0].hasApiKey).toBe(true);

      // secretKey model: apiKey is null but hasApiKey=true
      expect(result[1].apiKey).toBeNull();
      expect(result[1].hasApiKey).toBe(true);

      // No key model
      expect(result[2].apiKey).toBeNull();
      expect(result[2].hasApiKey).toBe(false);
    });

    it("should order models by default desc then name asc", async () => {
      mockPrismaService.aIModel.findMany.mockResolvedValue([]);

      await service.getAllAIModels();

      const findManyCall = mockPrismaService.aIModel.findMany.mock.calls[0][0];
      expect(findManyCall.orderBy).toEqual([
        { isDefault: "desc" },
        { name: "asc" },
      ]);
    });
  });

  // ==================== getAIModel ====================

  describe("getAIModel()", () => {
    const mockModel = {
      id: "m-1",
      name: "GPT-4o",
      apiKey: "sk-verylongapikey1234567890",
      secretKey: null,
      modelType: "CHAT",
    };

    it("should return model with masked apiKey by default", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue(mockModel);

      const result = await service.getAIModel("m-1");

      expect(result.id).toBe("m-1");
      expect(result.apiKey).toContain("****");
      expect(result.apiKey).not.toBe(mockModel.apiKey);
      expect(result.hasApiKey).toBe(true);
    });

    it("should return full apiKey when includeFullApiKey=true", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue(mockModel);

      const result = await service.getAIModel("m-1", true);

      expect(result.apiKey).toBe(mockModel.apiKey); // full key returned
    });

    it("should return null apiKey when no key configured (even with includeFullApiKey=true)", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue({
        ...mockModel,
        apiKey: null,
        secretKey: null,
      });

      const result = await service.getAIModel("m-1", true);

      expect(result.apiKey).toBeNull();
      expect(result.hasApiKey).toBe(false);
    });

    it("should throw NotFoundException when model not found", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue(null);

      await expect(service.getAIModel("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should set hasApiKey=true when secretKey is present (no apiKey)", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue({
        ...mockModel,
        apiKey: null,
        secretKey: "some-secret-name",
      });

      const result = await service.getAIModel("m-1");

      expect(result.apiKey).toBeNull();
      expect(result.hasApiKey).toBe(true);
    });
  });

  // ==================== maskApiKey behavior ====================

  describe("maskApiKey (via getAllAIModels)", () => {
    it("should use short mask format for keys <= 12 chars", async () => {
      mockPrismaService.aIModel.findMany.mockResolvedValue([
        { id: "m-1", name: "Model", apiKey: "sk-short123", secretKey: null },
      ]);

      const result = await service.getAllAIModels();
      // short key: "****" + last 4 chars of "sk-short123"
      expect(result[0].apiKey).toBe("****" + "t123");
    });

    it("should use long mask format for keys > 12 chars", async () => {
      mockPrismaService.aIModel.findMany.mockResolvedValue([
        {
          id: "m-1",
          name: "Model",
          apiKey: "sk-abcdef1234567890longkey",
          secretKey: null,
        },
      ]);

      const result = await service.getAllAIModels();
      // long key: first4 + "****" + last4
      const key = result[0].apiKey!;
      expect(key).toMatch(/^.{4}\*{4}.{4}$/);
    });
  });

  // ==================== setDefaultAIModel ====================

  describe("setDefaultAIModel()", () => {
    it("should clear ALL model defaults then set new one", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue({
        id: "m-1",
        name: "New Default",
        modelType: "CHAT",
      });
      mockPrismaService.aIModel.updateMany.mockResolvedValue({ count: 5 });
      mockPrismaService.aIModel.update.mockResolvedValue({
        id: "m-1",
        name: "New Default",
        apiKey: null,
        secretKey: null,
        isDefault: true,
      });

      await service.setDefaultAIModel("m-1");

      // updateMany called with no where (clears ALL types)
      const updateManyCall =
        mockPrismaService.aIModel.updateMany.mock.calls[0][0];
      expect(updateManyCall.data).toEqual({ isDefault: false });
      expect(updateManyCall.where).toBeUndefined();

      // then update sets isDefault: true
      const updateCall = mockPrismaService.aIModel.update.mock.calls[0][0];
      expect(updateCall.data.isDefault).toBe(true);
    });

    it("should throw NotFoundException when model not found", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue(null);

      await expect(service.setDefaultAIModel("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should return model with masked apiKey", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue({ id: "m-1" });
      mockPrismaService.aIModel.updateMany.mockResolvedValue({ count: 1 });
      mockPrismaService.aIModel.update.mockResolvedValue({
        id: "m-1",
        name: "Model",
        apiKey: "sk-1234567890abcdef",
        secretKey: null,
        isDefault: true,
      });

      const result = await service.setDefaultAIModel("m-1");

      expect(result.apiKey).toContain("****");
      expect(result.hasApiKey).toBe(true);
    });
  });

  // ==================== deleteAIModel ====================

  describe("deleteAIModel()", () => {
    it("should delete the model and return it", async () => {
      const mockModel = {
        id: "m-1",
        name: "To Delete",
        apiKey: "sk-12345678901234",
        secretKey: null,
      };
      mockPrismaService.aIModel.findUnique.mockResolvedValue(mockModel);
      mockPrismaService.aIModel.delete.mockResolvedValue(mockModel);

      const result = await service.deleteAIModel("m-1");

      expect(mockPrismaService.aIModel.delete).toHaveBeenCalledWith({
        where: { id: "m-1" },
      });
      expect(result).toBeDefined();
    });

    it("should throw NotFoundException when model not found", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue(null);

      await expect(service.deleteAIModel("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ==================== createAIModel — upsert path ====================

  describe("createAIModel() — update existing model (upsert path)", () => {
    const existingModel = {
      id: "existing-1",
      name: "GPT-4o",
      modelId: "gpt-4o",
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
      apiKey: "old-api-key-12345",
      secretKey: null,
    };

    it("should update existing model when modelId+name match", async () => {
      mockPrismaService.aIModel.findFirst.mockResolvedValue(existingModel);
      mockPrismaService.aIModel.update.mockResolvedValue({
        ...existingModel,
        description: "Updated description",
        apiKey: "old-api-key-12345",
        secretKey: null,
      });

      const result = await service.createAIModel({
        name: "GPT-4o",
        displayName: "GPT-4o",
        provider: "openai",
        modelId: "gpt-4o",
        icon: "icon",
        color: "#000",
        apiEndpoint: "https://api.openai.com",
        description: "Updated description",
      });

      expect(mockPrismaService.aIModel.update).toHaveBeenCalled();
      expect(mockPrismaService.aIModel.create).not.toHaveBeenCalled();
      expect(result.isUpdate).toBe(true);
    });

    it("should NOT update apiKey when masked apiKey provided on update", async () => {
      mockPrismaService.aIModel.findFirst.mockResolvedValue(existingModel);
      mockPrismaService.aIModel.update.mockResolvedValue({
        ...existingModel,
        apiKey: "old-api-key-12345",
        secretKey: null,
      });

      await service.createAIModel({
        name: "GPT-4o",
        displayName: "GPT-4o",
        provider: "openai",
        modelId: "gpt-4o",
        icon: "icon",
        color: "#000",
        apiEndpoint: "https://api.openai.com",
        apiKey: "sk-a****b123", // masked — should be skipped
      });

      const updateCall = mockPrismaService.aIModel.update.mock.calls[0][0];
      expect(updateCall.data.apiKey).toBeUndefined();
    });

    it("should update apiKey when valid unmasked key provided on update", async () => {
      mockPrismaService.aIModel.findFirst.mockResolvedValue(existingModel);
      mockPrismaService.aIModel.update.mockResolvedValue({
        ...existingModel,
        apiKey: "new-real-api-key-xyz",
        secretKey: null,
      });

      await service.createAIModel({
        name: "GPT-4o",
        displayName: "GPT-4o",
        provider: "openai",
        modelId: "gpt-4o",
        icon: "icon",
        color: "#000",
        apiEndpoint: "https://api.openai.com",
        apiKey: "new-real-api-key-xyz",
      });

      const updateCall = mockPrismaService.aIModel.update.mock.calls[0][0];
      expect(updateCall.data.apiKey).toBe("new-real-api-key-xyz");
    });

    it("should create new model when modelId+name don't match existing", async () => {
      mockPrismaService.aIModel.findFirst.mockResolvedValue(null);
      mockPrismaService.aIModel.create.mockResolvedValue({
        id: "new-1",
        name: "Brand New Model",
        modelId: "brand-new-v1",
        apiKey: null,
        secretKey: null,
      });

      const result = await service.createAIModel({
        name: "Brand New Model",
        displayName: "Brand New Model",
        provider: "openai",
        modelId: "brand-new-v1",
        icon: "icon",
        color: "#000",
        apiEndpoint: "https://api.example.com",
      });

      expect(mockPrismaService.aIModel.create).toHaveBeenCalled();
      expect(mockPrismaService.aIModel.update).not.toHaveBeenCalled();
      expect(result.isUpdate).toBe(false);
    });
  });

  // ==================== updateAIModel — apiKey handling ====================

  describe("updateAIModel() — apiKey handling", () => {
    const existingModel = {
      id: "m-1",
      name: "Model",
      modelId: "gpt-4",
      apiKey: "existing-key",
      secretKey: null,
      isReasoning: false,
    };

    it("should set apiKey to null when empty string provided", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue(existingModel);
      mockPrismaService.aIModel.update.mockResolvedValue({
        ...existingModel,
        apiKey: null,
        secretKey: null,
      });

      await service.updateAIModel("m-1", { apiKey: "" });

      const updateCall = mockPrismaService.aIModel.update.mock.calls[0][0];
      expect(updateCall.data.apiKey).toBeNull();
    });

    it("should not change apiKey when masked value provided", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue(existingModel);
      mockPrismaService.aIModel.update.mockResolvedValue({
        ...existingModel,
        apiKey: null,
        secretKey: null,
      });

      await service.updateAIModel("m-1", { apiKey: "sk-ab****cd1234" });

      const updateCall = mockPrismaService.aIModel.update.mock.calls[0][0];
      // apiKey should be undefined (no update) when masked
      expect(updateCall.data.apiKey).toBeUndefined();
    });

    it("should throw NotFoundException when model not found", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue(null);

      await expect(
        service.updateAIModel("nonexistent", { displayName: "Updated" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ==================== Delegate methods ====================

  describe("getAllUsers() — delegate", () => {
    it("should delegate to UserManagementService", async () => {
      const mockResult = { users: [], total: 0 };
      mockUserMgmtService.getAllUsers.mockResolvedValue(mockResult);

      const result = await service.getAllUsers(1, 10, "search");

      expect(mockUserMgmtService.getAllUsers).toHaveBeenCalledWith(
        1,
        10,
        "search",
      );
      expect(result).toBe(mockResult);
    });
  });

  describe("isUserAdmin() — delegate", () => {
    it("should delegate to UserManagementService", async () => {
      mockUserMgmtService.isUserAdmin.mockResolvedValue(true);

      const result = await service.isUserAdmin("user-1");

      expect(mockUserMgmtService.isUserAdmin).toHaveBeenCalledWith("user-1");
      expect(result).toBe(true);
    });
  });

  describe("toggleUserStatus() — delegate", () => {
    it("should delegate to UserManagementService", async () => {
      mockUserMgmtService.toggleUserStatus.mockResolvedValue({ success: true });

      const result = await service.toggleUserStatus("user-1", false);

      expect(mockUserMgmtService.toggleUserStatus).toHaveBeenCalledWith(
        "user-1",
        false,
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe("updateUser() — delegate", () => {
    it("should delegate to UserManagementService", async () => {
      mockUserMgmtService.updateUser.mockResolvedValue({ id: "user-1" });

      const result = await service.updateUser("user-1", {
        username: "new-name",
      });

      expect(mockUserMgmtService.updateUser).toHaveBeenCalledWith("user-1", {
        username: "new-name",
      });
      expect(result).toEqual({ id: "user-1" });
    });
  });

  describe("deleteUser() — delegate", () => {
    it("should delegate to UserManagementService", async () => {
      mockUserMgmtService.deleteUser.mockResolvedValue({ success: true });

      await service.deleteUser("user-1");

      expect(mockUserMgmtService.deleteUser).toHaveBeenCalledWith("user-1");
    });
  });

  describe("getUserCredits() — delegate", () => {
    it("should delegate to UserManagementService", async () => {
      const mockCredits = {
        balance: 1000,
        totalEarned: 2000,
        totalSpent: 1000,
      };
      mockUserMgmtService.getUserCredits.mockResolvedValue(mockCredits);

      const result = await service.getUserCredits("user-1");

      expect(mockUserMgmtService.getUserCredits).toHaveBeenCalledWith("user-1");
      expect(result).toBe(mockCredits);
    });
  });

  describe("grantCredits() — delegate", () => {
    it("should delegate to UserManagementService with optional reason", async () => {
      mockUserMgmtService.grantCredits.mockResolvedValue({ success: true });

      await service.grantCredits("user-1", 500, "Admin bonus");

      expect(mockUserMgmtService.grantCredits).toHaveBeenCalledWith(
        "user-1",
        500,
        "Admin bonus",
      );
    });
  });

  describe("toggleCreditFreeze() — delegate", () => {
    it("should delegate to UserManagementService", async () => {
      mockUserMgmtService.toggleCreditFreeze.mockResolvedValue({
        success: true,
      });

      await service.toggleCreditFreeze("user-1", true, "Suspicious activity");

      expect(mockUserMgmtService.toggleCreditFreeze).toHaveBeenCalledWith(
        "user-1",
        true,
        "Suspicious activity",
      );
    });
  });

  describe("getOverviewStats() — delegate", () => {
    it("should delegate to StatisticsService", async () => {
      const mockStats = { resources: 100, users: 50 };
      mockStatisticsService.getOverviewStats.mockResolvedValue(mockStats);

      const result = await service.getOverviewStats();

      expect(mockStatisticsService.getOverviewStats).toHaveBeenCalled();
      expect(result).toBe(mockStats);
    });
  });

  describe("getSystemStats() — delegate", () => {
    it("should delegate to StatisticsService", async () => {
      const mockStats = { cpu: "12%", memory: "45%" };
      mockStatisticsService.getSystemStats.mockResolvedValue(mockStats);

      const result = await service.getSystemStats();

      expect(mockStatisticsService.getSystemStats).toHaveBeenCalled();
      expect(result).toBe(mockStats);
    });
  });

  describe("deleteResource() — delegate", () => {
    it("should delegate to ResourceManagementService", async () => {
      mockResourceMgmtService.deleteResource.mockResolvedValue({
        success: true,
      });

      await service.deleteResource("resource-1");

      expect(mockResourceMgmtService.deleteResource).toHaveBeenCalledWith(
        "resource-1",
      );
    });
  });

  describe("deleteResources() — delegate", () => {
    it("should delegate to ResourceManagementService with array", async () => {
      mockResourceMgmtService.deleteResources.mockResolvedValue({ count: 3 });

      await service.deleteResources(["r-1", "r-2", "r-3"]);

      expect(mockResourceMgmtService.deleteResources).toHaveBeenCalledWith([
        "r-1",
        "r-2",
        "r-3",
      ]);
    });
  });

  describe("updateUserRole() — delegate", () => {
    it("should delegate to UserManagementService", async () => {
      mockUserMgmtService.updateUserRole.mockResolvedValue({ success: true });

      await service.updateUserRole("user-1", "ADMIN");

      expect(mockUserMgmtService.updateUserRole).toHaveBeenCalledWith(
        "user-1",
        "ADMIN",
      );
    });
  });
});
