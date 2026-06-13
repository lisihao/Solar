/**
 * AdminService Supplemental Tests 4
 *
 * Targets uncovered methods / branches not in supplemental, supplemental2,
 * or supplemental3:
 *
 * - getAIModelsByType()
 * - getDefaultModelByType() — default found / fallback to first / not found
 * - getDefaultModelByTypeInternal() — default found / fallback / not found
 * - setDefaultAIModelForType() — success / not found
 * - getAllModelTypeDefaults()
 * - resetCollectionData()
 * - getSmtpSettings() — configured / empty
 * - updateSmtpSettings() — all fields / masked password skip
 * - testSmtpConnection() — no host/user/pass → incomplete error
 * - getEmailSettingsUnified() — configured / env fallback
 * - updateEmailSettingsUnified() — provider/enabled/from/host/port/user/pass/resendKey
 *   masked password skip
 * - getContentExtractionApiKey()
 * - getYoutubeApiKey()
 * - getTTSApiKey()
 * - checkApiBalance private branches not in supplemental3:
 *   - firecrawl: remaining=undefined → "Active"
 *   - firecrawl: HTTP 500 → error
 *   - firecrawl: fetch throws
 *   - jina: balance undefined → "Active"
 *   - jina: balance=0 → hasBalance false
 *   - jina: balance check 401
 *   - jina: balance check non-ok → fallback test ok
 *   - jina: balance check non-ok → fallback test non-ok
 *   - jina: fetch throws
 *   - serper: credits undefined (no credits field) → "Active"
 *   - serper: 401
 *   - serper: non-ok non-401
 *   - serper: fetch throws
 *   - perplexity: 401
 *   - perplexity: 429
 *   - perplexity: other HTTP status
 *   - perplexity: fetch throws
 *   - checkApiBalance: outer catch wraps inner error
 * - deleteAIModel() — is default → throws error
 */

// Virtual module mocks — must appear before any imports
jest.mock("@nestjs/cache-manager", () => ({ CACHE_MANAGER: "CACHE_MANAGER" }), {
  virtual: true,
});
jest.mock("cache-manager", () => ({}), { virtual: true });
jest.mock("ioredis", () => ({}), { virtual: true });

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

const mockFetch = jest.fn();
global.fetch = mockFetch;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeModel(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    name: "GPT-4",
    displayName: "GPT-4 Display",
    provider: "openai",
    modelId: "gpt-4",
    modelType: "CHAT",
    apiEndpoint: "https://api.openai.com/v1",
    apiKey: "sk-abcdef123456789",
    secretKey: null,
    maxTokens: 4096,
    temperature: 0.7,
    isEnabled: true,
    isDefault: false,
    isReasoning: false,
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

describe("AdminService (supplemental4)", () => {
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
    creditAccount: {
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      findUnique: jest.fn(),
    },
    creditTransaction: { findMany: jest.fn(), count: jest.fn() },
    skillConfig: { upsert: jest.fn() },
    rawData: { count: jest.fn(), deleteMany: jest.fn() },
    deduplicationRecord: { count: jest.fn(), deleteMany: jest.fn() },
    note: { deleteMany: jest.fn() },
    comment: { deleteMany: jest.fn() },
    resource: { count: jest.fn(), deleteMany: jest.fn() },
    collectionTask: { updateMany: jest.fn() },
    dataSource: { updateMany: jest.fn() },
  };

  const mockSecretsService = { getValueInternal: jest.fn() };

  const mockUserMgmtService = {
    getAllUsers: jest.fn(),
    getUserStats: jest.fn(),
    getUserLoginHistory: jest.fn(),
    createUser: jest.fn(),
    updateUserRole: jest.fn(),
    toggleUserStatus: jest.fn(),
    updateUser: jest.fn(),
    deleteUser: jest.fn(),
    getUserCredits: jest.fn(),
    grantCredits: jest.fn(),
    toggleCreditFreeze: jest.fn(),
    isUserAdmin: jest.fn(),
  };

  const mockResourceMgmtService = {
    deleteResource: jest.fn(),
    deleteResources: jest.fn(),
  };

  const mockStatisticsService = {
    getOverviewStats: jest.fn(),
    getSystemStats: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockFetch.mockReset();

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

  // =========================================================================
  // getAIModelsByType
  // =========================================================================

  describe("getAIModelsByType", () => {
    it("returns enabled models of requested type with masked apiKey", async () => {
      mockPrismaService.aIModel.findMany.mockResolvedValue([
        makeModel({ apiKey: "sk-abcdefghijklmnop" }),
        makeModel({ id: "m2", apiKey: null, secretKey: "sec-ref" }),
      ]);

      const result = await service.getAIModelsByType("CHAT" as never);

      expect(mockPrismaService.aIModel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { modelType: "CHAT", isEnabled: true },
        }),
      );
      expect(result[0].apiKey).toContain("****");
      expect(result[1].hasApiKey).toBe(true);
    });

    it("returns empty array when no models of type exist", async () => {
      mockPrismaService.aIModel.findMany.mockResolvedValue([]);

      const result = await service.getAIModelsByType("EMBEDDING" as never);
      expect(result).toHaveLength(0);
    });
  });

  // =========================================================================
  // getDefaultModelByType
  // =========================================================================

  describe("getDefaultModelByType", () => {
    it("returns the default model when one exists", async () => {
      const defaultModel = makeModel({
        isDefault: true,
        apiKey: "sk-key12345678",
      });
      mockPrismaService.aIModel.findFirst.mockResolvedValueOnce(defaultModel);

      const result = await service.getDefaultModelByType("CHAT" as never);

      expect(result).not.toBeNull();
      expect(result!.apiKey).toContain("****");
      expect(result!.hasApiKey).toBe(true);
    });

    it("falls back to first enabled model when no default set", async () => {
      const fallbackModel = makeModel({ isDefault: false });
      mockPrismaService.aIModel.findFirst
        .mockResolvedValueOnce(null) // no default
        .mockResolvedValueOnce(fallbackModel); // first enabled

      const result = await service.getDefaultModelByType("CHAT" as never);

      expect(result).not.toBeNull();
      expect(mockPrismaService.aIModel.findFirst).toHaveBeenCalledTimes(2);
    });

    it("returns null when no models exist for the type", async () => {
      mockPrismaService.aIModel.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.getDefaultModelByType("RERANK" as never);

      expect(result).toBeNull();
    });

    it("returns null apiKey when model has no apiKey", async () => {
      const modelNoKey = makeModel({ apiKey: null, secretKey: null });
      mockPrismaService.aIModel.findFirst.mockResolvedValueOnce(modelNoKey);

      const result = await service.getDefaultModelByType("CHAT" as never);

      expect(result!.apiKey).toBeNull();
      expect(result!.hasApiKey).toBe(false);
    });
  });

  // =========================================================================
  // getDefaultModelByTypeInternal
  // =========================================================================

  describe("getDefaultModelByTypeInternal", () => {
    it("returns default model directly without masking", async () => {
      const model = makeModel({ isDefault: true });
      mockPrismaService.aIModel.findFirst.mockResolvedValueOnce(model);

      const result = await service.getDefaultModelByTypeInternal(
        "CHAT" as never,
      );

      expect(result).toEqual(model);
      // Returns raw model (no masking)
      expect(result!.apiKey).toBe("sk-abcdef123456789");
    });

    it("falls back to first enabled model when no default", async () => {
      const fallback = makeModel({ isDefault: false });
      mockPrismaService.aIModel.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(fallback);

      const result = await service.getDefaultModelByTypeInternal(
        "CHAT" as never,
      );
      expect(result).toEqual(fallback);
    });

    it("returns null when no model found", async () => {
      mockPrismaService.aIModel.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.getDefaultModelByTypeInternal(
        "IMAGE_GENERATION" as never,
      );
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // setDefaultAIModelForType
  // =========================================================================

  describe("setDefaultAIModelForType", () => {
    it("clears defaults for model type and sets new one", async () => {
      const model = makeModel({ modelType: "EMBEDDING" });
      const updatedModel = { ...model, isDefault: true };
      mockPrismaService.aIModel.findUnique.mockResolvedValue(model);
      mockPrismaService.aIModel.updateMany.mockResolvedValue({ count: 2 });
      mockPrismaService.aIModel.update.mockResolvedValue(updatedModel);

      const result = await service.setDefaultAIModelForType("m1");

      expect(mockPrismaService.aIModel.updateMany).toHaveBeenCalledWith({
        where: { modelType: "EMBEDDING" },
        data: { isDefault: false },
      });
      expect(result.hasApiKey).toBe(true);
      expect(result.apiKey).toContain("****");
    });

    it("throws NotFoundException when model not found", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue(null);

      await expect(
        service.setDefaultAIModelForType("nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });

    it("returns null apiKey when updated model has no key", async () => {
      const model = makeModel({ modelType: "CHAT" });
      const updatedModel = {
        ...model,
        isDefault: true,
        apiKey: null,
        secretKey: null,
      };
      mockPrismaService.aIModel.findUnique.mockResolvedValue(model);
      mockPrismaService.aIModel.updateMany.mockResolvedValue({ count: 1 });
      mockPrismaService.aIModel.update.mockResolvedValue(updatedModel);

      const result = await service.setDefaultAIModelForType("m1");
      expect(result.apiKey).toBeNull();
      expect(result.hasApiKey).toBe(false);
    });
  });

  // =========================================================================
  // getAllModelTypeDefaults
  // =========================================================================

  describe("getAllModelTypeDefaults", () => {
    it("returns an entry per model type with count and default model info", async () => {
      const chatModel = makeModel({ modelType: "CHAT", isDefault: true });
      mockPrismaService.aIModel.findFirst.mockResolvedValue(chatModel); // all findFirst calls return chatModel
      mockPrismaService.aIModel.count.mockResolvedValue(3);

      const result = await service.getAllModelTypeDefaults();

      expect(typeof result).toBe("object");
      expect(result["CHAT"]).toBeDefined();
      expect(result["CHAT"].availableModels).toBe(3);
      expect(result["CHAT"].defaultModel).not.toBeNull();
    });

    it("sets defaultModel=null for types with no models", async () => {
      mockPrismaService.aIModel.findFirst.mockResolvedValue(null);
      mockPrismaService.aIModel.count.mockResolvedValue(0);

      const result = await service.getAllModelTypeDefaults();

      expect(result["EMBEDDING"].defaultModel).toBeNull();
    });
  });

  // =========================================================================
  // deleteAIModel — default model protection
  // =========================================================================

  describe("deleteAIModel — default model", () => {
    it("throws error when trying to delete the default model", async () => {
      const defaultModel = makeModel({ isDefault: true });
      mockPrismaService.aIModel.findUnique.mockResolvedValue(defaultModel);

      await expect(service.deleteAIModel("m1")).rejects.toThrow(
        "Cannot delete the default AI model",
      );
      expect(mockPrismaService.aIModel.delete).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // resetCollectionData
  // =========================================================================

  describe("resetCollectionData", () => {
    it("deletes all collection data and returns counts", async () => {
      mockPrismaService.rawData.count.mockResolvedValue(100);
      mockPrismaService.resource.count.mockResolvedValue(50);
      mockPrismaService.deduplicationRecord.count.mockResolvedValue(200);
      mockPrismaService.deduplicationRecord.deleteMany.mockResolvedValue({
        count: 200,
      });
      mockPrismaService.note.deleteMany.mockResolvedValue({ count: 10 });
      mockPrismaService.comment.deleteMany.mockResolvedValue({ count: 5 });
      mockPrismaService.resource.deleteMany.mockResolvedValue({ count: 50 });
      mockPrismaService.rawData.deleteMany.mockResolvedValue({ count: 100 });
      mockPrismaService.collectionTask.updateMany.mockResolvedValue({
        count: 3,
      });
      mockPrismaService.dataSource.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.resetCollectionData();

      expect(result.success).toBe(true);
      expect(result.deleted.rawData).toBe(100);
      expect(result.deleted.resources).toBe(50);
      expect(result.deleted.deduplicationRecords).toBe(200);
      expect(result.before.rawData).toBe(100);
    });

    it("resets task stats and data source stats", async () => {
      mockPrismaService.rawData.count.mockResolvedValue(0);
      mockPrismaService.resource.count.mockResolvedValue(0);
      mockPrismaService.deduplicationRecord.count.mockResolvedValue(0);
      mockPrismaService.deduplicationRecord.deleteMany.mockResolvedValue({
        count: 0,
      });
      mockPrismaService.note.deleteMany.mockResolvedValue({ count: 0 });
      mockPrismaService.comment.deleteMany.mockResolvedValue({ count: 0 });
      mockPrismaService.resource.deleteMany.mockResolvedValue({ count: 0 });
      mockPrismaService.rawData.deleteMany.mockResolvedValue({ count: 0 });
      mockPrismaService.collectionTask.updateMany.mockResolvedValue({
        count: 0,
      });
      mockPrismaService.dataSource.updateMany.mockResolvedValue({ count: 0 });

      await service.resetCollectionData();

      expect(mockPrismaService.collectionTask.updateMany).toHaveBeenCalledWith({
        data: expect.objectContaining({
          totalItems: 0,
          processedItems: 0,
        }),
      });
      expect(mockPrismaService.dataSource.updateMany).toHaveBeenCalledWith({
        data: expect.objectContaining({ totalCollected: 0 }),
      });
    });
  });

  // =========================================================================
  // getSmtpSettings
  // =========================================================================

  describe("getSmtpSettings", () => {
    it("returns settings with masked password when configured", async () => {
      mockPrismaService.systemSetting.findUnique.mockImplementation(
        (args: { where: { key: string } }) => {
          const map: Record<string, string> = {
            "smtp.host": '"smtp.example.com"',
            "smtp.port": "587",
            "smtp.user": '"user@example.com"',
            "smtp.pass": '"secret-pass"',
            "smtp.from": '"from@example.com"',
            "smtp.enabled": "true",
            "smtp.adminEmail": '"admin@example.com"',
          };
          const v = map[args.where.key];
          if (!v) return Promise.resolve(null);
          return Promise.resolve({ key: args.where.key, value: v });
        },
      );

      const result = await service.getSmtpSettings();

      expect(result.host).toBe("smtp.example.com");
      expect(result.user).toBe("user@example.com");
      expect(result.pass).toBe("********"); // masked
      expect(result.enabled).toBe(true);
      expect(result.adminEmail).toBe("admin@example.com");
    });

    it("returns null host and default port when not configured", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.getSmtpSettings();

      expect(result.host).toBeNull();
      expect(result.port).toBe(587);
      expect(result.pass).toBeNull();
      expect(result.enabled).toBe(false);
    });
  });

  // =========================================================================
  // updateSmtpSettings
  // =========================================================================

  describe("updateSmtpSettings", () => {
    beforeEach(() => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({
        key: "k",
        value: "v",
      });
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);
    });

    it("saves all provided fields including password", async () => {
      await service.updateSmtpSettings({
        host: "smtp.test.com",
        port: 465,
        user: "user@test.com",
        pass: "real-pass",
        from: "from@test.com",
        enabled: true,
        adminEmail: "admin@test.com",
      });

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledTimes(7);
    });

    it("skips password when it is the masked value '********'", async () => {
      await service.updateSmtpSettings({
        host: "smtp.test.com",
        pass: "********",
      });

      const calls = mockPrismaService.systemSetting.upsert.mock.calls;
      const passCall = calls.find(
        (c: Array<{ where: { key: string } }>) =>
          c[0].where.key === "smtp.pass",
      );
      expect(passCall).toBeUndefined();
    });

    it("returns success true", async () => {
      const result = await service.updateSmtpSettings({
        host: "smtp.test.com",
      });
      expect(result.success).toBe(true);
    });
  });

  // =========================================================================
  // testSmtpConnection
  // =========================================================================

  describe("testSmtpConnection", () => {
    it("returns incomplete error when host is missing", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.testSmtpConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain("incomplete");
    });

    it("returns incomplete error when user is missing", async () => {
      mockPrismaService.systemSetting.findUnique.mockImplementation(
        (args: { where: { key: string } }) => {
          if (args.where.key === "smtp.host")
            return Promise.resolve({
              key: "smtp.host",
              value: '"smtp.test.com"',
            });
          return Promise.resolve(null);
        },
      );

      const result = await service.testSmtpConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain("incomplete");
    });
  });

  // =========================================================================
  // getEmailSettingsUnified
  // =========================================================================

  describe("getEmailSettingsUnified", () => {
    it("returns configured values from settings", async () => {
      mockPrismaService.systemSetting.findUnique.mockImplementation(
        (args: { where: { key: string } }) => {
          const map: Record<string, string> = {
            email_provider: '"smtp"',
            email_enabled: '"true"',
            email_from: '"noreply@example.com"',
            admin_email: '"admin@example.com"',
            smtp_host: '"smtp.example.com"',
            smtp_port: '"465"',
            smtp_user: '"user@example.com"',
            smtp_pass: '"secret"',
            resend_api_key: null as unknown as string,
          };
          const v = map[args.where.key];
          if (v === null) return Promise.resolve(null);
          if (!v) return Promise.resolve(null);
          return Promise.resolve({ key: args.where.key, value: v });
        },
      );

      const result = await service.getEmailSettingsUnified();

      expect(result.provider).toBe("smtp");
      expect(result.from).toBe("noreply@example.com");
      expect(result.host).toBe("smtp.example.com");
      expect(result.port).toBe(465);
      expect(result.hasPassword).toBe(true);
      expect(result.hasResendKey).toBe(false);
    });

    it("returns defaults when settings are not configured", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.getEmailSettingsUnified();

      expect(result.port).toBe(587); // default
      expect(result.hasPassword).toBe(false);
      expect(result.hasResendKey).toBe(false);
    });

    it("reports enabled=true when email_enabled is boolean true", async () => {
      mockPrismaService.systemSetting.findUnique.mockImplementation(
        (args: { where: { key: string } }) => {
          if (args.where.key === "email_enabled") {
            return Promise.resolve({ key: "email_enabled", value: "true" });
          }
          return Promise.resolve(null);
        },
      );

      const result = await service.getEmailSettingsUnified();
      expect(result.enabled).toBe(true);
    });
  });

  // =========================================================================
  // updateEmailSettingsUnified
  // =========================================================================

  describe("updateEmailSettingsUnified", () => {
    beforeEach(() => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({
        key: "k",
        value: "v",
      });
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);
    });

    it("saves provider, enabled, from, adminEmail", async () => {
      await service.updateEmailSettingsUnified({
        provider: "resend",
        enabled: true,
        from: "noreply@test.com",
        adminEmail: "admin@test.com",
      });

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledTimes(4);
    });

    it("saves SMTP host, port, user", async () => {
      await service.updateEmailSettingsUnified({
        host: "smtp.test.com",
        port: 587,
        user: "user@test.com",
      });

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledTimes(3);
    });

    it("saves password when not containing bullet char", async () => {
      await service.updateEmailSettingsUnified({ pass: "real-password" });

      const calls = mockPrismaService.systemSetting.upsert.mock.calls;
      const passCall = calls.find(
        (c: Array<{ where: { key: string } }>) =>
          c[0].where.key === "smtp_pass",
      );
      expect(passCall).toBeDefined();
    });

    it("skips password when it contains bullet char (masked)", async () => {
      await service.updateEmailSettingsUnified({ pass: "•••••••••" });

      const calls = mockPrismaService.systemSetting.upsert.mock.calls;
      const passCall = calls.find(
        (c: Array<{ where: { key: string } }>) =>
          c[0].where.key === "smtp_pass",
      );
      expect(passCall).toBeUndefined();
    });

    it("saves resendApiKey when not masked", async () => {
      await service.updateEmailSettingsUnified({
        resendApiKey: "re_live_abc123",
      });

      const calls = mockPrismaService.systemSetting.upsert.mock.calls;
      const resendCall = calls.find(
        (c: Array<{ where: { key: string } }>) =>
          c[0].where.key === "resend_api_key",
      );
      expect(resendCall).toBeDefined();
    });

    it("skips resendApiKey when masked", async () => {
      await service.updateEmailSettingsUnified({ resendApiKey: "re_•••••" });

      const calls = mockPrismaService.systemSetting.upsert.mock.calls;
      const resendCall = calls.find(
        (c: Array<{ where: { key: string } }>) =>
          c[0].where.key === "resend_api_key",
      );
      expect(resendCall).toBeUndefined();
    });
  });

  // =========================================================================
  // getContentExtractionApiKey / getYoutubeApiKey / getTTSApiKey
  // =========================================================================

  describe("getContentExtractionApiKey", () => {
    it("delegates to getSetting for jina", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "extraction.jina.apiKey",
        value: '"jina-key"',
      });
      const result = await service.getContentExtractionApiKey("jina");
      expect(result).toBe("jina-key");
    });

    it("delegates to getSetting for firecrawl", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "extraction.firecrawl.apiKey",
        value: '"fc-key"',
      });
      const result = await service.getContentExtractionApiKey("firecrawl");
      expect(result).toBe("fc-key");
    });

    it("returns null when setting not found for tavily", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);
      const result = await service.getContentExtractionApiKey("tavily");
      expect(result).toBeNull();
    });
  });

  describe("getYoutubeApiKey", () => {
    it("returns supadata apiKey from settings", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "youtube.supadata.apiKey",
        value: '"supa-key"',
      });
      const result = await service.getYoutubeApiKey("supadata");
      expect(result).toBe("supa-key");
    });
  });

  describe("getTTSApiKey", () => {
    it("returns elevenlabs apiKey", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "tts.elevenlabs.apiKey",
        value: '"el-key"',
      });
      const result = await service.getTTSApiKey("elevenlabs");
      expect(result).toBe("el-key");
    });

    it("returns google apiKey", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "tts.google.apiKey",
        value: '"goog-key"',
      });
      const result = await service.getTTSApiKey("google");
      expect(result).toBe("goog-key");
    });
  });

  // =========================================================================
  // checkApiBalance — remaining uncovered private branches
  // =========================================================================

  describe("checkApiBalance — firecrawl branches", () => {
    function setupExtractionKey(key: string) {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "extraction.firecrawl.apiKey",
        value: JSON.stringify(key),
      });
    }

    it("returns Active when firecrawl response has no remaining credits field", async () => {
      setupExtractionKey("fc-key");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({}), // no remaining_credits field
      });

      const result = await service.checkApiBalance("extraction", "firecrawl");
      expect(result.hasBalance).toBe(true);
      expect(result.balance).toBe("Active");
    });

    it("returns HTTP 500 error for firecrawl non-401 failure", async () => {
      setupExtractionKey("fc-key");
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const result = await service.checkApiBalance("extraction", "firecrawl");
      expect(result.hasBalance).toBe(false);
      expect(result.error).toContain("500");
    });

    it("handles firecrawl network error gracefully", async () => {
      setupExtractionKey("fc-key");
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const result = await service.checkApiBalance("extraction", "firecrawl");
      expect(result.hasBalance).toBe(false);
      expect(result.error).toBe("Connection refused");
    });

    it("returns credits quota when remaining_credits is 0 (no balance)", async () => {
      setupExtractionKey("fc-key");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          remaining_credits: 0,
          credits_used: 1000,
          credits_limit: 1000,
        }),
      });

      const result = await service.checkApiBalance("extraction", "firecrawl");
      expect(result.hasBalance).toBe(false);
      expect(result.balance).toContain("0");
    });
  });

  describe("checkApiBalance — jina branches", () => {
    function setupJinaKey(key: string) {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "extraction.jina.apiKey",
        value: JSON.stringify(key),
      });
    }

    it("returns Active when jina response has no balance field", async () => {
      setupJinaKey("jina-key");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({}), // no balance/credits/remaining
      });

      const result = await service.checkApiBalance("extraction", "jina");
      expect(result.hasBalance).toBe(true);
      expect(result.balance).toBe("Active");
    });

    it("returns hasBalance=false when jina balance is 0", async () => {
      setupJinaKey("jina-key");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ balance: 0 }),
      });

      const result = await service.checkApiBalance("extraction", "jina");
      expect(result.hasBalance).toBe(false);
      expect(result.balance).toBe("$0.00");
    });

    it("returns invalid key error for jina 401", async () => {
      setupJinaKey("jina-key");
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

      const result = await service.checkApiBalance("extraction", "jina");
      expect(result.hasBalance).toBe(false);
      expect(result.error).toBe("Invalid API key");
    });

    it("falls back to reader API test when balance API returns non-ok non-401", async () => {
      setupJinaKey("jina-key");
      // balance check returns 404 (non-ok, non-401)
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      // fallback reader API test succeeds
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await service.checkApiBalance("extraction", "jina");
      expect(result.hasBalance).toBe(true);
      expect(result.balance).toContain("Active");
    });

    it("falls back to reader API test but reader also fails", async () => {
      setupJinaKey("jina-key");
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });

      const result = await service.checkApiBalance("extraction", "jina");
      expect(result.hasBalance).toBe(false);
      expect(result.error).toContain("403");
    });

    it("handles jina fetch error gracefully", async () => {
      setupJinaKey("jina-key");
      mockFetch.mockRejectedValueOnce(new Error("DNS failure"));

      const result = await service.checkApiBalance("extraction", "jina");
      expect(result.hasBalance).toBe(false);
      expect(result.error).toBe("DNS failure");
    });

    it("returns non-number balance as string", async () => {
      setupJinaKey("jina-key");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ balance: "unlimited" }),
      });

      const result = await service.checkApiBalance("extraction", "jina");
      expect(result.balance).toBe("unlimited");
    });
  });

  describe("checkApiBalance — serper branches", () => {
    function setupSerperKey(key: string) {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "search.serper.apiKey",
        value: JSON.stringify(key),
      });
    }

    it("returns Active when serper response has no credits field", async () => {
      setupSerperKey("serper-key");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({}), // no credits
      });

      const result = await service.checkApiBalance("search", "serper");
      expect(result.hasBalance).toBe(true);
      expect(result.balance).toBe("Active");
    });

    it("returns invalid key error for serper 401", async () => {
      setupSerperKey("serper-key");
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

      const result = await service.checkApiBalance("search", "serper");
      expect(result.hasBalance).toBe(false);
      expect(result.error).toBe("Invalid API key");
    });

    it("returns HTTP error for serper non-ok non-401 status", async () => {
      setupSerperKey("serper-key");
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

      const result = await service.checkApiBalance("search", "serper");
      expect(result.hasBalance).toBe(false);
      expect(result.error).toContain("503");
    });

    it("handles serper network error gracefully", async () => {
      setupSerperKey("serper-key");
      mockFetch.mockRejectedValueOnce(new Error("Timeout"));

      const result = await service.checkApiBalance("search", "serper");
      expect(result.hasBalance).toBe(false);
      expect(result.error).toBe("Timeout");
    });

    it("returns hasBalance=false when credits is 0", async () => {
      setupSerperKey("serper-key");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ credits: 0, requests: 500 }),
      });

      const result = await service.checkApiBalance("search", "serper");
      expect(result.hasBalance).toBe(false);
    });
  });

  describe("checkApiBalance — perplexity branches", () => {
    function setupPerplexityKey(key: string) {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "search.perplexity.apiKey",
        value: JSON.stringify(key),
      });
    }

    it("returns invalid key error for perplexity 401", async () => {
      setupPerplexityKey("perp-key");
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

      const result = await service.checkApiBalance("search", "perplexity");
      expect(result.hasBalance).toBe(false);
      expect(result.error).toBe("Invalid API key");
    });

    it("returns rate limit error for perplexity 429", async () => {
      setupPerplexityKey("perp-key");
      mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });

      const result = await service.checkApiBalance("search", "perplexity");
      expect(result.hasBalance).toBe(false);
      expect(result.error).toContain("Rate limit");
    });

    it("returns HTTP error for perplexity other non-ok status", async () => {
      setupPerplexityKey("perp-key");
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const result = await service.checkApiBalance("search", "perplexity");
      expect(result.hasBalance).toBe(false);
      expect(result.error).toContain("500");
    });

    it("handles perplexity network error gracefully", async () => {
      setupPerplexityKey("perp-key");
      mockFetch.mockRejectedValueOnce(new Error("Connection failed"));

      const result = await service.checkApiBalance("search", "perplexity");
      expect(result.hasBalance).toBe(false);
      expect(result.error).toBe("Connection failed");
    });
  });

  describe("checkApiBalance — outer catch", () => {
    it("wraps non-Error thrown values in error response", async () => {
      // getSearchApiKey will throw a non-Error
      mockPrismaService.systemSetting.findUnique.mockRejectedValue(
        "unexpected string error",
      );

      const result = await service.checkApiBalance("search", "tavily");
      expect(result.hasBalance).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // =========================================================================
  // updateExternalProvidersConfig additional branches
  // =========================================================================

  describe("updateExternalProvidersConfig — additional branches", () => {
    it("creates new provider entry when not in existing stored config", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "external.providers",
        value: JSON.stringify([]),
      });
      mockPrismaService.systemSetting.upsert.mockResolvedValue({
        key: "external.providers",
        value: "[]",
      });

      await service.updateExternalProvidersConfig([
        {
          id: "custom-new",
          name: "Custom New",
          apiKey: "new-key-abc",
          baseUrl: "https://custom.new",
        },
      ]);

      const upsertCall =
        mockPrismaService.systemSetting.upsert.mock.calls[0][0];
      const saved = JSON.parse(upsertCall.create.value);
      expect(saved).toHaveLength(1);
      expect(saved[0].apiKey).toBe("new-key-abc");
    });

    it("uses prev apiKey when incoming is empty string", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "external.providers",
        value: JSON.stringify([
          { id: "finance", name: "Finance", apiKey: "finance-key" },
        ]),
      });
      mockPrismaService.systemSetting.upsert.mockResolvedValue({
        key: "external.providers",
        value: "[]",
      });

      await service.updateExternalProvidersConfig([
        {
          id: "finance",
          name: "Finance",
          apiKey: "", // empty — should keep existing
          baseUrl: "https://finance.api",
        },
      ]);

      const upsertCall =
        mockPrismaService.systemSetting.upsert.mock.calls[0][0];
      const saved = JSON.parse(upsertCall.create.value);
      expect(saved[0].apiKey).toBe("finance-key");
    });
  });
});
