/**
 * AdminService Supplemental Tests
 *
 * Covers methods not tested in other spec files:
 * - resetCollectionData()
 * - getEmailSettingsUnified() / updateEmailSettingsUnified() / testEmailConnection()
 * - getSiteSettings() / updateSiteSettings()
 * - getAiSettings() / updateAiSettings()
 * - getSecuritySettings() / updateSecuritySettings()
 * - getStorageSettings() / updateStorageSettings()
 * - getOpenAIConfig() / updateOpenAIConfig()
 * - deleteAIModel() — default cannot delete, not found, success
 * - setDefaultAIModel() — not found, success
 * - getUserLoginHistory() / createUser() / updateUserRole() delegate paths
 * - getAIModelApiKey() — secretKey path, apiKey path, model not found
 * - getCreditAccounts() — with/without search
 * - getCreditsStats()
 * - getCreditTransactions() — not found, success
 */

// Module-level mocks must be before all imports
// virtual: true is needed for packages not installed in this environment
jest.mock("@nestjs/cache-manager", () => ({ CACHE_MANAGER: "CACHE_MANAGER" }), {
  virtual: true,
});
jest.mock("cache-manager", () => ({}), { virtual: true });
jest.mock("ioredis", () => ({}), { virtual: true });

// @prisma/client enums are not generated in this environment — provide them as plain objects
jest.mock("@prisma/client", () => ({
  PrismaClient: class {},
  AIModelType: {
    CHAT: "CHAT",
    CHAT_FAST: "CHAT_FAST",
    IMAGE_GENERATION: "IMAGE_GENERATION",
    IMAGE_EDITING: "IMAGE_EDITING",
    MULTIMODAL: "MULTIMODAL",
    EMBEDDING: "EMBEDDING",
    RERANK: "RERANK",
  },
  CreditTransactionType: {
    INITIAL: "INITIAL",
    DAILY_CHECKIN: "DAILY_CHECKIN",
    TASK_REWARD: "TASK_REWARD",
    REFERRAL_BONUS: "REFERRAL_BONUS",
    ADMIN_GRANT: "ADMIN_GRANT",
    COMPENSATION: "COMPENSATION",
    DONATION_REWARD: "DONATION_REWARD",
    DONATION_USAGE_REWARD: "DONATION_USAGE_REWARD",
    AI_ASK: "AI_ASK",
    AI_TEAMS: "AI_TEAMS",
    AI_OFFICE: "AI_OFFICE",
    AI_SIMULATION: "AI_SIMULATION",
    AI_WRITING: "AI_WRITING",
    AI_IMAGE: "AI_IMAGE",
    AI_SOCIAL: "AI_SOCIAL",
    AI_RESEARCH: "AI_RESEARCH",
    AI_INSIGHTS: "AI_INSIGHTS",
    NOTEBOOK_RESEARCH: "NOTEBOOK_RESEARCH",
    AI_PLANNING: "AI_PLANNING",
    EXPLORE: "EXPLORE",
    LIBRARY: "LIBRARY",
    NOTES: "NOTES",
    COLLECTIONS: "COLLECTIONS",
    EXPIRATION: "EXPIRATION",
    REFUND: "REFUND",
    ADJUSTMENT: "ADJUSTMENT",
  },
  CollectionTaskStatus: {
    PENDING: "PENDING",
    RUNNING: "RUNNING",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    CANCELLED: "CANCELLED",
    PAUSED: "PAUSED",
  },
  SecretCategory: {
    API_KEY: "API_KEY",
    DATABASE: "DATABASE",
    OAUTH: "OAUTH",
    WEBHOOK: "WEBHOOK",
    MCP: "MCP",
    OTHER: "OTHER",
  },
  SecretAction: {
    CREATE: "CREATE",
    VIEW: "VIEW",
    UPDATE: "UPDATE",
    DELETE: "DELETE",
    ACCESS_DENIED: "ACCESS_DENIED",
  },
  Prisma: {
    PrismaClientKnownRequestError: class extends Error {
      code: string;
      constructor(
        message: string,
        opts: { code: string; clientVersion: string },
      ) {
        super(message);
        this.code = opts.code;
      }
    },
  },
}));
jest.mock("../../../ai-engine/facade", () => ({
  inferIsReasoning: jest.fn().mockReturnValue(false),
  getKnownModelLimit: jest.fn().mockReturnValue(null),
  AIFacade: class {},
  ChatFacade: class {},
  GuardrailsPipelineService: class {},
}));
jest.mock("../../../ai-harness/facade", () => ({
  inferIsReasoning: jest.fn().mockReturnValue(false),
  getKnownModelLimit: jest.fn().mockReturnValue(null),
  AIFacade: class {},
  ChatFacade: class {},
  GuardrailsPipelineService: class {},
}));
jest.mock("../../../ai-engine/facade", () => ({
  KernelApiService: class {},
  MissionExecutorService: class {},
  EventJournalService: class {},
  WorkingMemoryManagerService: class {},
  ResourceManagerService: class {},
  EventBusService: class {},
  MissionContext: { run: jest.fn((_ctx: unknown, fn: () => unknown) => fn()) },
}));
jest.mock("../../../ai-harness/facade", () => ({
  KernelApiService: class {},
  MissionExecutorService: class {},
  EventJournalService: class {},
  WorkingMemoryManagerService: class {},
  ResourceManagerService: class {},
  EventBusService: class {},
  MissionContext: { run: jest.fn((_ctx: unknown, fn: () => unknown) => fn()) },
}));
jest.mock("../../external/mcp/mcp-server.service", () => ({
  MCPServerService: class {},
}));

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { AdminService } from "../admin.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { SecretsService } from "../../../platform/credentials/storage/secrets/secrets.service";
import { UserManagementService } from "../services/user-management.service";
import { ResourceManagementService } from "../services/resource-management.service";
import { StatisticsService } from "../services/statistics.service";

describe("AdminService (supplemental)", () => {
  let service: AdminService;

  const mockPrismaService = {
    aIModel: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    systemSetting: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    rawData: {
      count: jest.fn().mockResolvedValue(0),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    deduplicationRecord: {
      count: jest.fn().mockResolvedValue(0),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    note: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    comment: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    resource: {
      count: jest.fn().mockResolvedValue(0),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    collectionTask: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    dataSource: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    creditAccount: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({
        _sum: { balance: 0, totalEarned: 0, totalSpent: 0 },
      }),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    creditTransaction: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    skillConfig: { upsert: jest.fn().mockResolvedValue({}) },
  };

  const mockUserMgmtService = {
    getAllUsers: jest.fn().mockResolvedValue({ users: [], total: 0 }),
    getUserStats: jest.fn().mockResolvedValue({}),
    getUserLoginHistory: jest.fn().mockResolvedValue([]),
    createUser: jest.fn().mockResolvedValue({ id: "new-user" }),
    updateUserRole: jest.fn().mockResolvedValue({}),
    toggleUserStatus: jest.fn().mockResolvedValue({}),
    updateUser: jest.fn().mockResolvedValue({}),
    deleteUser: jest.fn().mockResolvedValue({}),
    getUserCredits: jest.fn().mockResolvedValue({}),
    grantCredits: jest.fn().mockResolvedValue({}),
    toggleCreditFreeze: jest.fn().mockResolvedValue({}),
    isUserAdmin: jest.fn().mockResolvedValue(false),
  };

  const mockResourceMgmtService = {
    getResourceById: jest.fn().mockResolvedValue({}),
    deleteResource: jest.fn().mockResolvedValue({}),
    deleteResources: jest.fn().mockResolvedValue({}),
  };

  const mockStatisticsService = {
    getSystemStats: jest.fn().mockResolvedValue({}),
    getResourceStats: jest.fn().mockResolvedValue({}),
    getOverviewStats: jest.fn().mockResolvedValue({}),
  };

  const mockSecretsService = {
    getValue: jest.fn().mockResolvedValue(null),
    getValueInternal: jest.fn().mockResolvedValue(null),
  };

  beforeAll(async () => {
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

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-set defaults after clearAllMocks
    mockPrismaService.aIModel.findMany.mockResolvedValue([]);
    mockPrismaService.aIModel.findUnique.mockResolvedValue(null);
    mockPrismaService.aIModel.findFirst.mockResolvedValue(null);
    mockPrismaService.aIModel.create.mockResolvedValue({});
    mockPrismaService.aIModel.update.mockResolvedValue({});
    mockPrismaService.aIModel.updateMany.mockResolvedValue({ count: 0 });
    mockPrismaService.aIModel.delete.mockResolvedValue({});
    mockPrismaService.aIModel.count.mockResolvedValue(0);
    mockPrismaService.systemSetting.findMany.mockResolvedValue([]);
    mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);
    mockPrismaService.systemSetting.upsert.mockResolvedValue({});
    mockPrismaService.systemSetting.delete.mockResolvedValue({});
    mockPrismaService.rawData.count.mockResolvedValue(0);
    mockPrismaService.rawData.deleteMany.mockResolvedValue({ count: 0 });
    mockPrismaService.resource.count.mockResolvedValue(0);
    mockPrismaService.resource.deleteMany.mockResolvedValue({ count: 0 });
    mockPrismaService.deduplicationRecord.count.mockResolvedValue(0);
    mockPrismaService.deduplicationRecord.deleteMany.mockResolvedValue({
      count: 0,
    });
    mockPrismaService.note.deleteMany.mockResolvedValue({ count: 0 });
    mockPrismaService.comment.deleteMany.mockResolvedValue({ count: 0 });
    mockPrismaService.collectionTask.updateMany.mockResolvedValue({ count: 0 });
    mockPrismaService.dataSource.updateMany.mockResolvedValue({ count: 0 });
    mockPrismaService.creditAccount.findMany.mockResolvedValue([]);
    mockPrismaService.creditAccount.count.mockResolvedValue(0);
    mockPrismaService.creditAccount.aggregate.mockResolvedValue({
      _sum: { balance: 0, totalEarned: 0, totalSpent: 0 },
    });
    mockPrismaService.creditAccount.findUnique.mockResolvedValue(null);
    mockPrismaService.creditTransaction.findMany.mockResolvedValue([]);
    mockPrismaService.creditTransaction.count.mockResolvedValue(0);
    mockSecretsService.getValueInternal.mockResolvedValue(null);
    mockUserMgmtService.getUserLoginHistory.mockResolvedValue([]);
    mockUserMgmtService.createUser.mockResolvedValue({ id: "new-user" });
    mockUserMgmtService.updateUserRole.mockResolvedValue({});
  });

  // ==================== resetCollectionData ====================

  describe("resetCollectionData()", () => {
    it("should delete all collection data and return counts", async () => {
      mockPrismaService.rawData.count.mockResolvedValue(10);
      mockPrismaService.resource.count.mockResolvedValue(5);
      mockPrismaService.deduplicationRecord.count.mockResolvedValue(3);
      mockPrismaService.deduplicationRecord.deleteMany.mockResolvedValue({
        count: 3,
      });
      mockPrismaService.note.deleteMany.mockResolvedValue({ count: 2 });
      mockPrismaService.comment.deleteMany.mockResolvedValue({ count: 1 });
      mockPrismaService.resource.deleteMany.mockResolvedValue({ count: 5 });
      mockPrismaService.rawData.deleteMany.mockResolvedValue({ count: 10 });

      const result = await service.resetCollectionData();

      expect(result.success).toBe(true);
      expect(result.deleted.rawData).toBe(10);
      expect(result.deleted.resources).toBe(5);
      expect(result.deleted.deduplicationRecords).toBe(3);
      expect(result.deleted.notes).toBe(2);
      expect(result.deleted.comments).toBe(1);
      expect(mockPrismaService.collectionTask.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ totalItems: 0 }),
        }),
      );
      expect(mockPrismaService.dataSource.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ totalCollected: 0 }),
        }),
      );
    });

    it("should return success with zero counts when no data exists", async () => {
      const result = await service.resetCollectionData();

      expect(result.success).toBe(true);
      expect(result.deleted.rawData).toBe(0);
      expect(result.before.rawData).toBe(0);
    });
  });

  // ==================== deleteAIModel ====================

  describe("deleteAIModel()", () => {
    it("should throw NotFoundException when model not found", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue(null);

      await expect(service.deleteAIModel("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw Error when trying to delete default model", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue({
        id: "model-1",
        name: "Default GPT-4",
        isDefault: true,
      });

      await expect(service.deleteAIModel("model-1")).rejects.toThrow(
        "Cannot delete the default AI model",
      );
    });

    it("should delete non-default model successfully", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue({
        id: "model-2",
        name: "GPT-3.5",
        isDefault: false,
      });
      mockPrismaService.aIModel.delete.mockResolvedValue({ id: "model-2" });

      const result = await service.deleteAIModel("model-2");

      expect(result.success).toBe(true);
      expect(mockPrismaService.aIModel.delete).toHaveBeenCalledWith({
        where: { id: "model-2" },
      });
    });
  });

  // ==================== setDefaultAIModel ====================

  describe("setDefaultAIModel()", () => {
    it("should throw NotFoundException when model not found", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue(null);

      await expect(service.setDefaultAIModel("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should clear all defaults and set model as default", async () => {
      const existingModel = { id: "model-1", name: "GPT-4", isDefault: false };
      mockPrismaService.aIModel.findUnique.mockResolvedValue(existingModel);
      mockPrismaService.aIModel.updateMany.mockResolvedValue({ count: 3 });
      mockPrismaService.aIModel.update.mockResolvedValue({
        ...existingModel,
        isDefault: true,
        apiKey: null,
        secretKey: null,
      });

      const result = await service.setDefaultAIModel("model-1");

      // Should clear ALL models (no where clause on type)
      expect(mockPrismaService.aIModel.updateMany).toHaveBeenCalledWith({
        data: { isDefault: false },
      });
      expect(mockPrismaService.aIModel.update).toHaveBeenCalledWith({
        where: { id: "model-1" },
        data: { isDefault: true },
      });
      expect(result.hasApiKey).toBe(false);
    });

    it("should return masked apiKey when model has one", async () => {
      const existingModel = { id: "model-1", name: "GPT-4", isDefault: false };
      mockPrismaService.aIModel.findUnique.mockResolvedValue(existingModel);
      mockPrismaService.aIModel.updateMany.mockResolvedValue({ count: 1 });
      mockPrismaService.aIModel.update.mockResolvedValue({
        ...existingModel,
        isDefault: true,
        apiKey: "sk-longkey1234567890",
        secretKey: null,
      });

      const result = await service.setDefaultAIModel("model-1");

      expect(result.hasApiKey).toBe(true);
      expect(result.apiKey).toContain("****");
    });
  });

  // ==================== getAIModelApiKey ====================

  describe("getAIModelApiKey()", () => {
    it("should return null when model not found", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue(null);

      const result = await service.getAIModelApiKey("nonexistent");

      expect(result).toBeNull();
    });

    it("should return apiKey trimmed when no secretKey", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue({
        apiKey: "  sk-testkey  ",
        secretKey: null,
      });

      const result = await service.getAIModelApiKey("model-1");

      expect(result).toBe("sk-testkey");
    });

    it("should resolve from secretKey via SecretsService when secretKey is set", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue({
        apiKey: "fallback-key",
        secretKey: "my-secret-name",
      });
      mockSecretsService.getValueInternal.mockResolvedValue("  secret-value  ");

      const result = await service.getAIModelApiKey("model-1");

      expect(result).toBe("secret-value");
      expect(mockSecretsService.getValueInternal).toHaveBeenCalledWith(
        "my-secret-name",
      );
    });

    it("should fall back to apiKey when secretKey resolution returns null", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue({
        apiKey: "fallback-key",
        secretKey: "missing-secret",
      });
      mockSecretsService.getValueInternal.mockResolvedValue(null);

      const result = await service.getAIModelApiKey("model-1");

      expect(result).toBe("fallback-key");
    });

    it("should return null when both apiKey and secretKey are null", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue({
        apiKey: null,
        secretKey: null,
      });

      const result = await service.getAIModelApiKey("model-1");

      expect(result).toBeNull();
    });
  });

  // ==================== getCreditAccounts ====================

  describe("getCreditAccounts()", () => {
    it("should return paginated accounts without search", async () => {
      const mockAccounts = [
        {
          userId: "user-1",
          user: { id: "user-1", email: "a@test.com", username: "alice" },
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
      expect(result.accounts[0].email).toBe("a@test.com");
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.totalPages).toBe(1);
    });

    it("should apply search filter when search param provided", async () => {
      mockPrismaService.creditAccount.findMany.mockResolvedValue([]);
      mockPrismaService.creditAccount.count.mockResolvedValue(0);

      await service.getCreditAccounts(1, 20, "alice");

      const findCall =
        mockPrismaService.creditAccount.findMany.mock.calls[0][0];
      expect(findCall.where).toHaveProperty("user");
    });

    it("should calculate pagination correctly for multiple pages", async () => {
      mockPrismaService.creditAccount.findMany.mockResolvedValue([]);
      mockPrismaService.creditAccount.count.mockResolvedValue(100);

      const result = await service.getCreditAccounts(2, 20);

      expect(result.pagination.totalPages).toBe(5);
      expect(result.pagination.page).toBe(2);
    });
  });

  // ==================== getCreditsStats ====================

  describe("getCreditsStats()", () => {
    it("should return aggregated credit statistics", async () => {
      mockPrismaService.creditAccount.count
        .mockResolvedValueOnce(10) // totalAccounts
        .mockResolvedValueOnce(2) // frozenAccounts
        .mockResolvedValueOnce(3); // lowBalanceAccounts
      mockPrismaService.creditAccount.aggregate.mockResolvedValue({
        _sum: { balance: 5000, totalEarned: 10000, totalSpent: 5000 },
      });

      const result = await service.getCreditsStats();

      expect(result.totalAccounts).toBe(10);
      expect(result.totalBalance).toBe(5000);
      expect(result.totalEarned).toBe(10000);
      expect(result.totalSpent).toBe(5000);
      expect(result.frozenAccounts).toBe(2);
      expect(result.lowBalanceAccounts).toBe(3);
    });

    it("should use 0 when aggregate sums are null", async () => {
      mockPrismaService.creditAccount.count.mockResolvedValue(0);
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

  describe("getCreditTransactions()", () => {
    it("should throw NotFoundException when credit account not found", async () => {
      mockPrismaService.creditAccount.findUnique.mockResolvedValue(null);

      await expect(
        service.getCreditTransactions("nonexistent-user"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should return transactions with pagination", async () => {
      mockPrismaService.creditAccount.findUnique.mockResolvedValue({
        id: "account-1",
        userId: "user-1",
      });
      const mockTx = [
        {
          id: "tx-1",
          type: "CREDIT",
          amount: 100,
          balanceAfter: 1100,
          description: "Grant",
          moduleType: "ADMIN",
          operationType: "GRANT",
          createdAt: new Date(),
        },
      ];
      mockPrismaService.creditTransaction.findMany.mockResolvedValue(mockTx);
      mockPrismaService.creditTransaction.count.mockResolvedValue(1);

      const result = await service.getCreditTransactions("user-1", 50, 0);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].type).toBe("CREDIT");
      expect(result.total).toBe(1);
      expect(result.limit).toBe(50);
    });
  });

  // ==================== getUserLoginHistory ====================

  describe("getUserLoginHistory() delegate", () => {
    it("should delegate to UserManagementService", async () => {
      const history = [{ loginAt: new Date(), ip: "127.0.0.1" }];
      mockUserMgmtService.getUserLoginHistory.mockResolvedValue(history);

      const result = await service.getUserLoginHistory("user-1", 10);

      expect(mockUserMgmtService.getUserLoginHistory).toHaveBeenCalledWith(
        "user-1",
        10,
      );
      expect(result).toEqual(history);
    });
  });

  // ==================== createUser ====================

  describe("createUser() delegate", () => {
    it("should delegate to UserManagementService", async () => {
      const newUser = { id: "new-user", email: "new@test.com" };
      mockUserMgmtService.createUser.mockResolvedValue(newUser);

      const result = await service.createUser({
        email: "new@test.com",
        username: "newuser",
        role: "USER",
      });

      expect(mockUserMgmtService.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ email: "new@test.com" }),
      );
      expect(result).toEqual(newUser);
    });
  });

  // ==================== updateUserRole ====================

  describe("updateUserRole() delegate", () => {
    it("should delegate to UserManagementService", async () => {
      const updatedUser = { id: "user-1", role: "ADMIN" };
      mockUserMgmtService.updateUserRole.mockResolvedValue(updatedUser);

      const result = await service.updateUserRole("user-1", "ADMIN");

      expect(mockUserMgmtService.updateUserRole).toHaveBeenCalledWith(
        "user-1",
        "ADMIN",
      );
      expect(result).toEqual(updatedUser);
    });
  });

  // ==================== getSiteSettings ====================

  describe("getSiteSettings()", () => {
    it("should return site settings with defaults when not configured", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.getSiteSettings();

      expect(result.siteName).toBeDefined();
      expect(result.maintenanceMode).toBe(false);
      expect(result.allowRegistration).toBe(true); // !== false
      expect(result.requireEmailVerification).toBe(false);
    });

    it("should return configured site settings", async () => {
      mockPrismaService.systemSetting.findUnique
        .mockResolvedValueOnce({ key: "site.name", value: '"My Site"' })
        .mockResolvedValueOnce({ key: "site.description", value: '"My Desc"' })
        .mockResolvedValueOnce({ key: "site.maintenanceMode", value: "true" })
        .mockResolvedValueOnce({
          key: "site.maintenanceMessage",
          value: '"Down for maintenance"',
        })
        .mockResolvedValueOnce({
          key: "site.allowRegistration",
          value: "false",
        })
        .mockResolvedValueOnce({
          key: "site.requireEmailVerification",
          value: "true",
        });

      const result = await service.getSiteSettings();

      expect(result.siteName).toBe("My Site");
      expect(result.maintenanceMode).toBe(true);
      expect(result.allowRegistration).toBe(false);
    });
  });

  // ==================== updateSiteSettings ====================

  describe("updateSiteSettings()", () => {
    it("should save all site settings fields", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});

      const result = await service.updateSiteSettings({
        siteName: "New Site",
        siteDescription: "New Desc",
        maintenanceMode: true,
        maintenanceMessage: "Under maintenance",
        allowRegistration: false,
        requireEmailVerification: true,
      });

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledTimes(6);
      expect(result.success).toBe(true);
    });

    it("should do nothing when no fields provided", async () => {
      const result = await service.updateSiteSettings({});

      expect(mockPrismaService.systemSetting.upsert).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  // ==================== getAiSettings ====================

  describe("getAiSettings()", () => {
    it("should return AI settings with defaults when not configured", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.getAiSettings();

      expect(result.defaultModel).toBe("");
      expect(result.maxTokens).toBe(4096);
      expect(result.temperature).toBe(0.7);
      expect(result.rateLimitPerMinute).toBe(20);
      expect(result.rateLimitPerDay).toBe(500);
    });

    it("should return configured AI settings", async () => {
      mockPrismaService.systemSetting.findUnique
        .mockResolvedValueOnce({ key: "ai.defaultModel", value: '"gpt-4o"' })
        .mockResolvedValueOnce({ key: "ai.maxTokens", value: "8192" })
        .mockResolvedValueOnce({ key: "ai.temperature", value: "0.5" })
        .mockResolvedValueOnce({ key: "ai.rateLimitPerMinute", value: "30" })
        .mockResolvedValueOnce({ key: "ai.rateLimitPerDay", value: "1000" });

      const result = await service.getAiSettings();

      expect(result.defaultModel).toBe("gpt-4o");
    });
  });

  // ==================== updateAiSettings ====================

  describe("updateAiSettings()", () => {
    it("should save AI settings and return success", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});

      const result = await service.updateAiSettings({
        defaultModel: "gpt-4o",
        maxTokens: 8192,
        temperature: 0.5,
        rateLimitPerMinute: 30,
        rateLimitPerDay: 1000,
      });

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledTimes(5);
      expect(result.success).toBe(true);
    });

    it("should only update provided fields", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});

      await service.updateAiSettings({ maxTokens: 8192 });

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledTimes(1);
    });
  });

  // ==================== getSecuritySettings ====================

  describe("getSecuritySettings()", () => {
    it("should return security settings with defaults", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.getSecuritySettings();

      expect(result.sessionTimeoutHours).toBe(24);
      expect(result.maxLoginAttempts).toBe(5);
      expect(result.lockoutDurationMinutes).toBe(15);
    });
  });

  // ==================== updateSecuritySettings ====================

  describe("updateSecuritySettings()", () => {
    it("should save security settings", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});

      const result = await service.updateSecuritySettings({
        sessionTimeoutHours: 48,
        maxLoginAttempts: 10,
        lockoutDurationMinutes: 30,
      });

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledTimes(3);
      expect(result.success).toBe(true);
    });
  });

  // ==================== getStorageSettings ====================

  describe("getStorageSettings()", () => {
    it("should return storage settings with defaults", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.getStorageSettings();

      expect(result.maxUploadSizeMb).toBe(10);
      expect(result.allowedFileTypes).toBe(
        "image/*,application/pdf,.doc,.docx",
      );
    });
  });

  // ==================== updateStorageSettings ====================

  describe("updateStorageSettings()", () => {
    it("should save storage settings", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});

      const result = await service.updateStorageSettings({
        maxUploadSizeMb: 50,
        allowedFileTypes: "image/*,.pdf",
      });

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
    });
  });

  // ==================== getOpenAIConfig ====================

  describe("getOpenAIConfig()", () => {
    it("should return hasApiKey=false when not configured", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.getOpenAIConfig();

      expect(result.hasApiKey).toBe(false);
      expect(result.apiKey).toBeNull();
      expect(result.enabled).toBe(true); // enabled !== false when null
    });

    it("should return masked apiKey when configured", async () => {
      mockPrismaService.systemSetting.findUnique
        .mockResolvedValueOnce({
          key: "openai.apiKey",
          value: '"sk-longopenaikey1234567890"',
        })
        .mockResolvedValueOnce({ key: "openai.enabled", value: "true" });

      const result = await service.getOpenAIConfig();

      expect(result.hasApiKey).toBe(true);
      expect(result.apiKey).toContain("****");
    });
  });

  // ==================== updateOpenAIConfig ====================

  describe("updateOpenAIConfig()", () => {
    it("should save enabled flag", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateOpenAIConfig({ enabled: false });

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: "openai.enabled" },
        }),
      );
    });

    it("should save apiKey when provided and not masked", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateOpenAIConfig({ apiKey: "sk-newkey123456789" });

      const calls = mockPrismaService.systemSetting.upsert.mock.calls;
      const apiKeyCall = calls.find(
        (
          call: Parameters<typeof mockPrismaService.systemSetting.upsert>[0][],
        ) =>
          (call[0] as { where?: { key?: string } }).where?.key ===
          "openai.apiKey",
      );
      expect(apiKeyCall).toBeDefined();
    });

    it("should skip apiKey update when masked value provided", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateOpenAIConfig({ apiKey: "****masked****" });

      const calls = mockPrismaService.systemSetting.upsert.mock.calls;
      const apiKeyCall = calls.find(
        (
          call: Parameters<typeof mockPrismaService.systemSetting.upsert>[0][],
        ) =>
          (call[0] as { where?: { key?: string } }).where?.key ===
          "openai.apiKey",
      );
      expect(apiKeyCall).toBeUndefined();
    });
  });

  // ==================== getEmailSettingsUnified ====================

  describe("getEmailSettingsUnified()", () => {
    it("should return email settings from database with defaults", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.getEmailSettingsUnified();

      expect(result.provider).toBeDefined();
      expect(result.hasPassword).toBe(false);
      expect(result.hasResendKey).toBe(false);
    });

    it("should return email settings from database when configured", async () => {
      mockPrismaService.systemSetting.findUnique
        .mockResolvedValueOnce({ key: "email_provider", value: '"resend"' })
        .mockResolvedValueOnce({ key: "email_enabled", value: '"true"' })
        .mockResolvedValueOnce({
          key: "email_from",
          value: '"noreply@test.com"',
        })
        .mockResolvedValueOnce({
          key: "admin_email",
          value: '"admin@test.com"',
        })
        .mockResolvedValueOnce(null) // smtp_host
        .mockResolvedValueOnce(null) // smtp_port
        .mockResolvedValueOnce(null) // smtp_user
        .mockResolvedValueOnce(null) // smtp_pass
        .mockResolvedValueOnce({
          key: "resend_api_key",
          value: '"re-key-123"',
        });

      const result = await service.getEmailSettingsUnified();

      expect(result.provider).toBe("resend");
      expect(result.hasResendKey).toBe(true);
      expect(result.adminEmail).toBe("admin@test.com");
    });
  });

  // ==================== updateEmailSettingsUnified ====================

  describe("updateEmailSettingsUnified()", () => {
    it("should save email settings and call getEmailSettingsUnified", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateEmailSettingsUnified({
        provider: "smtp",
        enabled: true,
        from: "noreply@test.com",
        adminEmail: "admin@test.com",
        host: "smtp.test.com",
        port: 587,
        user: "smtp-user",
        pass: "plainpass",
        resendApiKey: "re-key-123",
      });

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalled();
    });

    it("should skip masked password update", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({});
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateEmailSettingsUnified({ pass: "•••masked•••" });

      const calls = mockPrismaService.systemSetting.upsert.mock.calls;
      const passCall = calls.find(
        (
          call: Parameters<typeof mockPrismaService.systemSetting.upsert>[0][],
        ) =>
          (call[0] as { where?: { key?: string } }).where?.key === "smtp_pass",
      );
      expect(passCall).toBeUndefined();
    });

    it("should do nothing when no updates provided", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateEmailSettingsUnified({});

      expect(mockPrismaService.systemSetting.upsert).not.toHaveBeenCalled();
    });
  });

  // ==================== testEmailConnection ====================

  describe("testEmailConnection()", () => {
    it("should return failure when admin email not configured", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.testEmailConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain("Admin email");
    });

    it("should return failure for resend when no api key configured", async () => {
      mockPrismaService.systemSetting.findUnique
        .mockResolvedValueOnce({ key: "email_provider", value: '"resend"' })
        .mockResolvedValueOnce({
          key: "admin_email",
          value: '"admin@test.com"',
        })
        .mockResolvedValueOnce({ key: "email_from", value: '"from@test.com"' })
        .mockResolvedValueOnce(null) // resend_api_key
        .mockResolvedValue(null);

      const result = await service.testEmailConnection();

      expect(result.success).toBe(false);
    });

    it("should return failure for smtp when not configured", async () => {
      // provider defaults to smtp, no smtp config
      mockPrismaService.systemSetting.findUnique
        .mockResolvedValueOnce(null) // email_provider → null → "smtp"
        .mockResolvedValueOnce({
          key: "admin_email",
          value: '"admin@test.com"',
        })
        .mockResolvedValueOnce(null) // email_from
        .mockResolvedValueOnce(null) // smtp_host
        .mockResolvedValueOnce(null) // smtp_port
        .mockResolvedValueOnce(null) // smtp_user
        .mockResolvedValueOnce(null); // smtp_pass

      const result = await service.testEmailConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain("incomplete");
    });
  });

  // ==================== getAllUsers ====================

  describe("getAllUsers() delegate", () => {
    it("should delegate to UserManagementService", async () => {
      const users = { users: [{ id: "u1" }], total: 1 };
      mockUserMgmtService.getAllUsers.mockResolvedValue(users);

      const result = await service.getAllUsers(1, 20, "search");

      expect(mockUserMgmtService.getAllUsers).toHaveBeenCalledWith(
        1,
        20,
        "search",
      );
      expect(result).toEqual(users);
    });
  });

  // ==================== deleteResource delegates ====================

  describe("deleteResource() / deleteResources() delegates", () => {
    it("deleteResource should delegate to ResourceManagementService", async () => {
      mockResourceMgmtService.deleteResource.mockResolvedValue({
        success: true,
      });

      const result = await service.deleteResource("res-1");

      expect(mockResourceMgmtService.deleteResource).toHaveBeenCalledWith(
        "res-1",
      );
      expect(result).toEqual({ success: true });
    });

    it("deleteResources should delegate to ResourceManagementService", async () => {
      mockResourceMgmtService.deleteResources.mockResolvedValue({ deleted: 3 });

      const result = await service.deleteResources(["r1", "r2", "r3"]);

      expect(mockResourceMgmtService.deleteResources).toHaveBeenCalledWith([
        "r1",
        "r2",
        "r3",
      ]);
      expect(result).toEqual({ deleted: 3 });
    });
  });
});
