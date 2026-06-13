import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { AdminController } from "../admin.controller";
import { AdminService } from "../admin.service";
import { ChatFacade } from "../../../ai-harness/facade";
import { SecretsService } from "../../../platform/credentials/storage/secrets/secrets.service";
import { StorageInventoryService } from "../../../platform/storage/governance/storage-inventory.service";
import { StorageOffloadService } from "../../../platform/storage/governance/storage-offload.service";
import { SystemModelInventoryService } from "../../../ai-engine/llm/models/catalog/system-model-inventory.service";
import { CapabilityOverridesWriterService } from "../../../ai-engine/facade";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";

// ---------------------------------------------------------------------------
// Module-level mocks for heavy transitive deps
// ---------------------------------------------------------------------------
jest.mock("../../../../common/cache/cache.module", () => ({}));
jest.mock("../../../../common/cache/cache.service", () => ({
  CacheService: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Mock service factories
// ---------------------------------------------------------------------------
const mockAdminService = {
  getAllUsers: jest.fn(),
  getUserStats: jest.fn(),
  createUser: jest.fn(),
  getUserLoginHistory: jest.fn(),
  getSystemStats: jest.fn(),
  getOverviewStats: jest.fn(),
  deleteResource: jest.fn(),
  deleteResources: jest.fn(),
  updateUserRole: jest.fn(),
  toggleUserStatus: jest.fn(),
  updateUser: jest.fn(),
  deleteUser: jest.fn(),
  getUserCredits: jest.fn(),
  grantCredits: jest.fn(),
  toggleCreditFreeze: jest.fn(),
  getAllAIModels: jest.fn(),
  diagnoseAIModels: jest.fn(),
  getAIModel: jest.fn(),
  getAIModelApiKey: jest.fn(),
  createAIModel: jest.fn(),
  updateAIModel: jest.fn(),
  setDefaultAIModel: jest.fn(),
  deleteAIModel: jest.fn(),
  getSettings: jest.fn(),
  setSettings: jest.fn(),
  getSmtpSettings: jest.fn(),
  updateSmtpSettings: jest.fn(),
  testSmtpConnection: jest.fn(),
  getEmailSettingsUnified: jest.fn(),
  updateEmailSettingsUnified: jest.fn(),
  testEmailConnection: jest.fn(),
  getSiteSettings: jest.fn(),
  updateSiteSettings: jest.fn(),
  getAiSettings: jest.fn(),
  updateAiSettings: jest.fn(),
  getSecuritySettings: jest.fn(),
  updateSecuritySettings: jest.fn(),
  getStorageSettings: jest.fn(),
  updateStorageSettings: jest.fn(),
  getSearchConfig: jest.fn(),
  updateSearchConfig: jest.fn(),
  getContentExtractionConfig: jest.fn(),
  updateContentExtractionConfig: jest.fn(),
  getYoutubeConfig: jest.fn(),
  updateYoutubeConfig: jest.fn(),
  getTTSConfig: jest.fn(),
  updateTTSConfig: jest.fn(),
  getSkillsmpConfig: jest.fn(),
  updateSkillsmpConfig: jest.fn(),
  getSkillsmpApiKey: jest.fn(),
  getSetting: jest.fn(),
  setSetting: jest.fn(),
  installSkillFromMarketplace: jest.fn(),
};

const mockAIFacade = {
  fetchAvailableModels: jest.fn(),
  testModelConnectionWithKey: jest.fn(),
};

const mockSecretsService = {
  getValue: jest.fn(),
};

const mockStorageInventoryService = {
  getInventory: jest.fn(),
};

const mockStorageOffloadService = {
  runOnce: jest.fn(),
};

const mockSystemModelInventoryService = {
  getInventory: jest.fn(),
};

// v3.1 阶段 B 子片 2：capability_overrides 写入面 mock（admin.controller 注入要）
const mockCapabilityOverridesWriter = {
  applyOverrideTransactional: jest.fn(),
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe("AdminController", () => {
  let controller: AdminController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: mockAdminService },
        { provide: ChatFacade, useValue: mockAIFacade },
        { provide: SecretsService, useValue: mockSecretsService },
        {
          provide: StorageInventoryService,
          useValue: mockStorageInventoryService,
        },
        {
          provide: StorageOffloadService,
          useValue: mockStorageOffloadService,
        },
        {
          provide: SystemModelInventoryService,
          useValue: mockSystemModelInventoryService,
        },
        {
          provide: CapabilityOverridesWriterService,
          useValue: mockCapabilityOverridesWriter,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AdminController>(AdminController);
  });

  // ====================== User Management ======================

  describe("getUsers()", () => {
    it("should call getAllUsers with default pagination", async () => {
      mockAdminService.getAllUsers.mockResolvedValue({ users: [], total: 0 });

      const result = await controller.getUsers();

      expect(mockAdminService.getAllUsers).toHaveBeenCalledWith(
        1,
        20,
        undefined,
      );
      expect(result).toEqual({ users: [], total: 0 });
    });

    it("should parse page, limit, and search from query params", async () => {
      mockAdminService.getAllUsers.mockResolvedValue({ users: [], total: 0 });

      await controller.getUsers("2", "10", "john");

      expect(mockAdminService.getAllUsers).toHaveBeenCalledWith(2, 10, "john");
    });
  });

  describe("getUserStats()", () => {
    it("should return user statistics", async () => {
      const stats = { total: 100, active: 90 };
      mockAdminService.getUserStats.mockResolvedValue(stats);

      const result = await controller.getUserStats();

      expect(mockAdminService.getUserStats).toHaveBeenCalled();
      expect(result).toEqual(stats);
    });
  });

  describe("createUser()", () => {
    it("should call createUser with the provided dto", async () => {
      const dto = { email: "test@example.com", username: "test" } as any;
      mockAdminService.createUser.mockResolvedValue({ id: "user-1", ...dto });

      const result = await controller.createUser(dto);

      expect(mockAdminService.createUser).toHaveBeenCalledWith(dto);
      expect(result).toMatchObject({ id: "user-1" });
    });
  });

  describe("getUserLoginHistory()", () => {
    it("should return login history with default limit", async () => {
      const history = [{ id: "log-1" }];
      mockAdminService.getUserLoginHistory.mockResolvedValue(history);

      const result = await controller.getUserLoginHistory("user-1");

      expect(mockAdminService.getUserLoginHistory).toHaveBeenCalledWith(
        "user-1",
        10,
      );
      expect(result).toEqual(history);
    });

    it("should parse custom limit from query param", async () => {
      mockAdminService.getUserLoginHistory.mockResolvedValue([]);

      await controller.getUserLoginHistory("user-1", "25");

      expect(mockAdminService.getUserLoginHistory).toHaveBeenCalledWith(
        "user-1",
        25,
      );
    });
  });

  describe("updateUserRole()", () => {
    it("should update the user role to ADMIN", async () => {
      const updated = { id: "user-1", role: "ADMIN" };
      mockAdminService.updateUserRole.mockResolvedValue(updated);

      const result = await controller.updateUserRole("user-1", "ADMIN");

      expect(mockAdminService.updateUserRole).toHaveBeenCalledWith(
        "user-1",
        "ADMIN",
      );
      expect(result).toEqual(updated);
    });
  });

  describe("toggleUserStatus()", () => {
    it("should deactivate a user", async () => {
      mockAdminService.toggleUserStatus.mockResolvedValue({ id: "user-1" });

      await controller.toggleUserStatus("user-1", false);

      expect(mockAdminService.toggleUserStatus).toHaveBeenCalledWith(
        "user-1",
        false,
      );
    });
  });

  describe("updateUser()", () => {
    it("should pass body to adminService.updateUser", async () => {
      const body = { username: "newname" };
      mockAdminService.updateUser.mockResolvedValue({ id: "user-1", ...body });

      const result = await controller.updateUser("user-1", body);

      expect(mockAdminService.updateUser).toHaveBeenCalledWith("user-1", body);
      expect(result).toMatchObject({ username: "newname" });
    });
  });

  describe("deleteUser()", () => {
    it("should delete the user by id", async () => {
      mockAdminService.deleteUser.mockResolvedValue({ deleted: true });

      const result = await controller.deleteUser("user-1");

      expect(mockAdminService.deleteUser).toHaveBeenCalledWith("user-1");
      expect(result).toEqual({ deleted: true });
    });
  });

  // ====================== System Stats ======================

  describe("getStats()", () => {
    it("should return system stats", async () => {
      const stats = { users: 100, resources: 500 };
      mockAdminService.getSystemStats.mockResolvedValue(stats);

      const result = await controller.getStats();

      expect(mockAdminService.getSystemStats).toHaveBeenCalled();
      expect(result).toEqual(stats);
    });
  });

  describe("getOverviewStats()", () => {
    it("should return overview stats", async () => {
      const overview = { modules: {} };
      mockAdminService.getOverviewStats.mockResolvedValue(overview);

      const result = await controller.getOverviewStats();

      expect(mockAdminService.getOverviewStats).toHaveBeenCalled();
      expect(result).toEqual(overview);
    });
  });

  // ====================== Resource Management ======================

  describe("deleteResource()", () => {
    it("should delete a resource by id", async () => {
      mockAdminService.deleteResource.mockResolvedValue({ deleted: true });

      const result = await controller.deleteResource("res-1");

      expect(mockAdminService.deleteResource).toHaveBeenCalledWith("res-1");
      expect(result).toEqual({ deleted: true });
    });
  });

  describe("deleteResources()", () => {
    it("should batch delete resources", async () => {
      const ids = ["res-1", "res-2"];
      mockAdminService.deleteResources.mockResolvedValue({ deletedCount: 2 });

      const result = await controller.deleteResources(ids);

      expect(mockAdminService.deleteResources).toHaveBeenCalledWith(ids);
      expect(result).toEqual({ deletedCount: 2 });
    });
  });

  // ====================== Credits ======================

  describe("getUserCredits()", () => {
    it("should return credit info for a user", async () => {
      const credits = { balance: 1000 };
      mockAdminService.getUserCredits.mockResolvedValue(credits);

      const result = await controller.getUserCredits("user-1");

      expect(mockAdminService.getUserCredits).toHaveBeenCalledWith("user-1");
      expect(result).toEqual(credits);
    });
  });

  describe("grantCredits()", () => {
    it("should grant credits with reason", async () => {
      mockAdminService.grantCredits.mockResolvedValue({ balance: 1100 });

      const result = await controller.grantCredits("user-1", {
        amount: 100,
        reason: "Promo",
      });

      expect(mockAdminService.grantCredits).toHaveBeenCalledWith(
        "user-1",
        100,
        "Promo",
      );
      expect(result).toMatchObject({ balance: 1100 });
    });

    it("should grant credits without reason", async () => {
      mockAdminService.grantCredits.mockResolvedValue({ balance: 1100 });

      await controller.grantCredits("user-1", { amount: 100 });

      expect(mockAdminService.grantCredits).toHaveBeenCalledWith(
        "user-1",
        100,
        undefined,
      );
    });
  });

  describe("toggleCreditFreeze()", () => {
    it("should freeze credits for a user", async () => {
      mockAdminService.toggleCreditFreeze.mockResolvedValue({ frozen: true });

      const result = await controller.toggleCreditFreeze("user-1", {
        freeze: true,
        reason: "Abuse",
      });

      expect(mockAdminService.toggleCreditFreeze).toHaveBeenCalledWith(
        "user-1",
        true,
        "Abuse",
      );
      expect(result).toEqual({ frozen: true });
    });
  });

  // ====================== AI Models ======================

  describe("getAIModels()", () => {
    it("should return list of AI models", async () => {
      const models = [{ id: "m-1", name: "GPT-4" }];
      mockAdminService.getAllAIModels.mockResolvedValue(models);

      const result = await controller.getAIModels();

      expect(mockAdminService.getAllAIModels).toHaveBeenCalled();
      expect(result).toEqual(models);
    });
  });

  describe("diagnoseAIModels()", () => {
    it("should return diagnosis summary with counts", async () => {
      const models = [
        { isEnabled: true, hasApiKey: true },
        { isEnabled: false, hasApiKey: false },
        { isEnabled: true, hasApiKey: false },
      ];
      mockAdminService.diagnoseAIModels.mockResolvedValue(models);

      const result = await controller.diagnoseAIModels();

      expect(result).toMatchObject({
        models,
        summary: {
          total: 3,
          enabled: 2,
          withApiKey: 1,
          ready: 1,
        },
      });
      expect(result.timestamp).toBeDefined();
    });
  });

  describe("getAIModel()", () => {
    it("should fetch a model without full api key by default", async () => {
      const model = { id: "m-1", apiKey: "***" };
      mockAdminService.getAIModel.mockResolvedValue(model);

      const result = await controller.getAIModel("m-1");

      expect(mockAdminService.getAIModel).toHaveBeenCalledWith("m-1", false);
      expect(result).toEqual(model);
    });

    it("should pass includeFullApiKey=true when edit=true", async () => {
      mockAdminService.getAIModel.mockResolvedValue({ id: "m-1" });

      await controller.getAIModel("m-1", "true");

      expect(mockAdminService.getAIModel).toHaveBeenCalledWith("m-1", true);
    });
  });

  describe("createAIModel()", () => {
    it("should create a model and return result", async () => {
      const body = {
        name: "MyModel",
        displayName: "My Model",
        provider: "openai",
        modelId: "gpt-4",
        icon: "🤖",
        color: "#000",
        apiEndpoint: "https://api.openai.com/v1",
      };
      mockAdminService.createAIModel.mockResolvedValue({
        id: "m-new",
        ...body,
      });

      const result = await controller.createAIModel(body);

      expect(mockAdminService.createAIModel).toHaveBeenCalledWith(body);
      expect(result).toMatchObject({ id: "m-new" });
    });
  });

  describe("updateAIModel()", () => {
    it("should update an existing model", async () => {
      const body = { displayName: "Updated Name" };
      mockAdminService.updateAIModel.mockResolvedValue({ id: "m-1", ...body });

      const result = await controller.updateAIModel("m-1", body);

      expect(mockAdminService.updateAIModel).toHaveBeenCalledWith("m-1", body);
      expect(result).toMatchObject({ displayName: "Updated Name" });
    });
  });

  describe("setDefaultAIModel()", () => {
    it("should set the default AI model", async () => {
      mockAdminService.setDefaultAIModel.mockResolvedValue({
        id: "m-1",
        isDefault: true,
      });

      const result = await controller.setDefaultAIModel("m-1");

      expect(mockAdminService.setDefaultAIModel).toHaveBeenCalledWith("m-1");
      expect(result).toMatchObject({ isDefault: true });
    });
  });

  describe("deleteAIModel()", () => {
    it("should delete an AI model", async () => {
      mockAdminService.deleteAIModel.mockResolvedValue({ deleted: true });

      const result = await controller.deleteAIModel("m-1");

      expect(mockAdminService.deleteAIModel).toHaveBeenCalledWith("m-1");
      expect(result).toEqual({ deleted: true });
    });
  });

  describe("testAIModelConnection()", () => {
    it("should return failure message when no api key is configured", async () => {
      mockAdminService.getAIModel.mockResolvedValue({
        id: "m-1",
        name: "TestModel",
        displayName: "Test Model",
        provider: "openai",
        modelId: "gpt-4",
      });
      mockAdminService.getAIModelApiKey.mockResolvedValue(null);

      const result = await controller.testAIModelConnection("m-1");

      expect(result).toMatchObject({
        success: false,
        message: "API key is not configured for this model",
      });
      expect(mockAIFacade.testModelConnectionWithKey).not.toHaveBeenCalled();
    });

    it("should call facade.testModelConnectionWithKey when api key exists", async () => {
      const model = {
        id: "m-1",
        name: "TestModel",
        displayName: "Test Model",
        provider: "openai",
        modelId: "gpt-4",
        apiEndpoint: "https://api.openai.com/v1",
        modelType: "CHAT",
      };
      mockAdminService.getAIModel.mockResolvedValue(model);
      mockAdminService.getAIModelApiKey.mockResolvedValue("sk-test-key");
      mockAIFacade.testModelConnectionWithKey.mockResolvedValue({
        success: true,
        latency: 250,
      });

      const result = await controller.testAIModelConnection("m-1");

      expect(mockAIFacade.testModelConnectionWithKey).toHaveBeenCalledWith(
        "openai",
        "gpt-4",
        "sk-test-key",
        "https://api.openai.com/v1",
        "CHAT",
      );
      expect(result).toMatchObject({
        success: true,
        modelId: "m-1",
        modelName: "TestModel",
      });
    });
  });

  describe("fetchAvailableModels()", () => {
    it("should throw BadRequestException when no API key and no secretKey provided", async () => {
      await expect(
        controller.fetchAvailableModels({
          provider: "openai",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should resolve api key from secretsService when secretKey given", async () => {
      mockSecretsService.getValue.mockResolvedValue("sk-from-secret");
      mockAIFacade.fetchAvailableModels.mockResolvedValue(["gpt-4"]);

      const result = await controller.fetchAvailableModels({
        provider: "openai",
        secretKey: "MY_SECRET",
      });

      expect(mockSecretsService.getValue).toHaveBeenCalledWith("MY_SECRET");
      expect(mockAIFacade.fetchAvailableModels).toHaveBeenCalledWith(
        "openai",
        "sk-from-secret",
        undefined,
        undefined,
      );
      expect(result).toEqual(["gpt-4"]);
    });

    it("should use direct apiKey if provided", async () => {
      mockAIFacade.fetchAvailableModels.mockResolvedValue(["gpt-4"]);

      await controller.fetchAvailableModels({
        provider: "openai",
        apiKey: "sk-direct",
      });

      expect(mockSecretsService.getValue).not.toHaveBeenCalled();
      expect(mockAIFacade.fetchAvailableModels).toHaveBeenCalledWith(
        "openai",
        "sk-direct",
        undefined,
        undefined,
      );
    });

    it("should throw BadRequestException when secret key has no value", async () => {
      mockSecretsService.getValue.mockResolvedValue(null);

      await expect(
        controller.fetchAvailableModels({
          provider: "openai",
          secretKey: "MISSING_SECRET",
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ====================== Settings ======================

  describe("getSettings()", () => {
    it("should return settings, optionally filtered by category", async () => {
      const settings = [{ key: "smtp.host", value: "smtp.example.com" }];
      mockAdminService.getSettings.mockResolvedValue(settings);

      const result = await controller.getSettings("email");

      expect(mockAdminService.getSettings).toHaveBeenCalledWith("email");
      expect(result).toEqual(settings);
    });
  });

  describe("updateSettings()", () => {
    it("should call setSettings with the body array", async () => {
      const body = [{ key: "smtp.host", value: "mail.example.com" }];
      mockAdminService.setSettings.mockResolvedValue({ updated: 1 });

      const result = await controller.updateSettings(body);

      expect(mockAdminService.setSettings).toHaveBeenCalledWith(body);
      expect(result).toEqual({ updated: 1 });
    });
  });

  describe("getSmtpSettings()", () => {
    it("should return SMTP settings", async () => {
      const smtp = { host: "smtp.example.com", port: 587 };
      mockAdminService.getSmtpSettings.mockResolvedValue(smtp);

      const result = await controller.getSmtpSettings();

      expect(mockAdminService.getSmtpSettings).toHaveBeenCalled();
      expect(result).toEqual(smtp);
    });
  });

  describe("updateSmtpSettings()", () => {
    it("should update SMTP settings", async () => {
      const body = { host: "mail.new.com" };
      mockAdminService.updateSmtpSettings.mockResolvedValue({ ...body });

      const result = await controller.updateSmtpSettings(body);

      expect(mockAdminService.updateSmtpSettings).toHaveBeenCalledWith(body);
      expect(result).toEqual(body);
    });
  });

  describe("testSmtpConnection()", () => {
    it("should test smtp connection", async () => {
      mockAdminService.testSmtpConnection.mockResolvedValue({ success: true });

      const result = await controller.testSmtpConnection();

      expect(mockAdminService.testSmtpConnection).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });
  });

  describe("getEmailSettings()", () => {
    it("should return unified email settings", async () => {
      const emailSettings = { provider: "smtp" };
      mockAdminService.getEmailSettingsUnified.mockResolvedValue(emailSettings);

      const result = await controller.getEmailSettings();

      expect(mockAdminService.getEmailSettingsUnified).toHaveBeenCalled();
      expect(result).toEqual(emailSettings);
    });
  });

  describe("updateEmailSettings()", () => {
    it("should update unified email settings", async () => {
      const body = { provider: "resend" as const };
      mockAdminService.updateEmailSettingsUnified.mockResolvedValue(body);

      const result = await controller.updateEmailSettings(body);

      expect(mockAdminService.updateEmailSettingsUnified).toHaveBeenCalledWith(
        body,
      );
      expect(result).toEqual(body);
    });
  });

  describe("testEmailConnection()", () => {
    it("should test email connection", async () => {
      mockAdminService.testEmailConnection.mockResolvedValue({ success: true });

      const result = await controller.testEmailConnection();

      expect(mockAdminService.testEmailConnection).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });
  });

  describe("getSiteSettings()", () => {
    it("should return site settings", async () => {
      const site = { siteName: "GenesisPod" };
      mockAdminService.getSiteSettings.mockResolvedValue(site);

      const result = await controller.getSiteSettings();

      expect(mockAdminService.getSiteSettings).toHaveBeenCalled();
      expect(result).toEqual(site);
    });
  });

  describe("updateSiteSettings()", () => {
    it("should update site settings", async () => {
      const body = { siteName: "NewName" };
      mockAdminService.updateSiteSettings.mockResolvedValue(body);

      const result = await controller.updateSiteSettings(body);

      expect(mockAdminService.updateSiteSettings).toHaveBeenCalledWith(body);
      expect(result).toEqual(body);
    });
  });

  describe("getAiSettings()", () => {
    it("should return AI settings", async () => {
      const aiSettings = { defaultModel: "", maxTokens: 4000 };
      mockAdminService.getAiSettings.mockResolvedValue(aiSettings);

      const result = await controller.getAiSettings();

      expect(mockAdminService.getAiSettings).toHaveBeenCalled();
      expect(result).toEqual(aiSettings);
    });
  });

  describe("updateAiSettings()", () => {
    it("should update AI settings", async () => {
      const body = { maxTokens: 8000 };
      mockAdminService.updateAiSettings.mockResolvedValue(body);

      const result = await controller.updateAiSettings(body);

      expect(mockAdminService.updateAiSettings).toHaveBeenCalledWith(body);
      expect(result).toEqual(body);
    });
  });

  // ====================== Search & Extraction Config ======================

  describe("getSearchConfig()", () => {
    it("should return search config", async () => {
      const config = { provider: "tavily", enabled: true };
      mockAdminService.getSearchConfig.mockResolvedValue(config);

      const result = await controller.getSearchConfig();

      expect(mockAdminService.getSearchConfig).toHaveBeenCalled();
      expect(result).toEqual(config);
    });
  });

  describe("updateSearchConfig()", () => {
    it("should update search config", async () => {
      const body = { provider: "serper" };
      mockAdminService.updateSearchConfig.mockResolvedValue(body);

      const result = await controller.updateSearchConfig(body);

      expect(mockAdminService.updateSearchConfig).toHaveBeenCalledWith(body);
      expect(result).toEqual(body);
    });
  });

  describe("getContentExtractionConfig()", () => {
    it("should return content extraction config", async () => {
      const config = { enabled: true };
      mockAdminService.getContentExtractionConfig.mockResolvedValue(config);

      const result = await controller.getContentExtractionConfig();

      expect(mockAdminService.getContentExtractionConfig).toHaveBeenCalled();
      expect(result).toEqual(config);
    });
  });

  describe("updateContentExtractionConfig()", () => {
    it("should update content extraction config", async () => {
      const body = { enabled: false };
      mockAdminService.updateContentExtractionConfig.mockResolvedValue(body);

      const result = await controller.updateContentExtractionConfig(body);

      expect(
        mockAdminService.updateContentExtractionConfig,
      ).toHaveBeenCalledWith(body);
      expect(result).toEqual(body);
    });
  });

  describe("getYoutubeConfig()", () => {
    it("should return YouTube config", async () => {
      const config = { enabled: true, provider: "supadata" };
      mockAdminService.getYoutubeConfig.mockResolvedValue(config);

      const result = await controller.getYoutubeConfig();

      expect(mockAdminService.getYoutubeConfig).toHaveBeenCalled();
      expect(result).toEqual(config);
    });
  });

  describe("getTTSConfig()", () => {
    it("should return TTS config", async () => {
      const config = { enabled: false };
      mockAdminService.getTTSConfig.mockResolvedValue(config);

      const result = await controller.getTTSConfig();

      expect(mockAdminService.getTTSConfig).toHaveBeenCalled();
      expect(result).toEqual(config);
    });
  });

  describe("getSkillsmpConfig()", () => {
    it("should return SkillsMP config", async () => {
      const config = { enabled: true, syncInterval: "daily" };
      mockAdminService.getSkillsmpConfig.mockResolvedValue(config);

      const result = await controller.getSkillsmpConfig();

      expect(mockAdminService.getSkillsmpConfig).toHaveBeenCalled();
      expect(result).toEqual(config);
    });
  });

  describe("updateSkillsmpConfig()", () => {
    it("should update SkillsMP config", async () => {
      const body = { enabled: true, syncInterval: "weekly" as const };
      mockAdminService.updateSkillsmpConfig.mockResolvedValue(body);

      const result = await controller.updateSkillsmpConfig(body);

      expect(mockAdminService.updateSkillsmpConfig).toHaveBeenCalledWith(body);
      expect(result).toEqual(body);
    });
  });

  describe("getSkillsmpSkills()", () => {
    it("should return preset skills when no synced skills exist", async () => {
      mockAdminService.getSetting.mockImplementation((key: string) => {
        if (key === "skillsmp.syncedSkills") return Promise.resolve([]);
        if (key === "skillsmp.totalSkills") return Promise.resolve(null);
        if (key === "skillsmp.lastSync") return Promise.resolve(null);
        return Promise.resolve(null);
      });

      const result = await controller.getSkillsmpSkills();

      expect(result).toMatchObject({
        lastSync: null,
      });
      expect(Array.isArray(result.skills)).toBe(true);
      // Preset skills should be returned when syncedSkills is empty
      expect(result.skills.length).toBeGreaterThan(0);
    });

    it("should return synced skills when they exist", async () => {
      const syncedSkills = [{ id: "skill-custom", name: "custom-skill" }];
      mockAdminService.getSetting.mockImplementation((key: string) => {
        if (key === "skillsmp.syncedSkills")
          return Promise.resolve(syncedSkills);
        if (key === "skillsmp.totalSkills") return Promise.resolve(100);
        if (key === "skillsmp.lastSync")
          return Promise.resolve("2026-01-01T00:00:00Z");
        return Promise.resolve(null);
      });

      const result = await controller.getSkillsmpSkills();

      expect(result.skills).toEqual(syncedSkills);
      expect(result.totalSkills).toBe(100);
    });
  });

  describe("installSkillFromMarketplace()", () => {
    it("should return failure when skill not found in synced or preset skills", async () => {
      mockAdminService.getSetting.mockResolvedValue([]);

      const result =
        await controller.installSkillFromMarketplace("nonexistent-skill");

      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining("not found"),
      });
    });

    it("should install a preset skill successfully", async () => {
      mockAdminService.getSetting.mockResolvedValue([]);
      mockAdminService.installSkillFromMarketplace.mockResolvedValue({
        id: "skill-deep-research",
      });

      const result = await controller.installSkillFromMarketplace(
        "skill-deep-research",
      );

      expect(mockAdminService.installSkillFromMarketplace).toHaveBeenCalled();
      expect(result).toMatchObject({ success: true });
    });
  });

  // ====================== Security Settings ======================

  describe("getSecuritySettings()", () => {
    it("should return security settings", async () => {
      const security = { sessionTimeoutHours: 24 };
      mockAdminService.getSecuritySettings.mockResolvedValue(security);

      const result = await controller.getSecuritySettings();

      expect(mockAdminService.getSecuritySettings).toHaveBeenCalled();
      expect(result).toEqual(security);
    });
  });

  describe("updateSecuritySettings()", () => {
    it("should update security settings", async () => {
      const body = { maxLoginAttempts: 5 };
      mockAdminService.updateSecuritySettings.mockResolvedValue(body);

      const result = await controller.updateSecuritySettings(body);

      expect(mockAdminService.updateSecuritySettings).toHaveBeenCalledWith(
        body,
      );
      expect(result).toEqual(body);
    });
  });

  describe("getStorageSettings()", () => {
    it("should return storage settings", async () => {
      const storage = { maxUploadSizeMb: 100 };
      mockAdminService.getStorageSettings.mockResolvedValue(storage);

      const result = await controller.getStorageSettings();

      expect(mockAdminService.getStorageSettings).toHaveBeenCalled();
      expect(result).toEqual(storage);
    });
  });

  // ====================== Test Connection Endpoints (unit - no HTTP) ======================

  describe("testSearchConnection()", () => {
    it("should return failure when no api key is provided", async () => {
      const result = await controller.testSearchConnection({
        provider: "tavily",
      });

      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining("No API key"),
      });
    });

    it("should return failure when unknown provider is given with an api key", async () => {
      const result = await controller.testSearchConnection({
        provider: "unknown-provider",
        apiKey: "some-key",
      });

      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining("Unknown provider"),
      });
    });

    it("should resolve secret key from SecretsService", async () => {
      mockSecretsService.getValue.mockResolvedValue(null);

      const result = await controller.testSearchConnection({
        provider: "tavily",
        secretKey: "MISSING_KEY",
      });

      expect(mockSecretsService.getValue).toHaveBeenCalledWith("MISSING_KEY");
      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining("MISSING_KEY"),
      });
    });
  });

  describe("testExtractionConnection()", () => {
    it("should return failure when no api key is provided", async () => {
      const result = await controller.testExtractionConnection({
        provider: "jina",
      });

      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining("No API key"),
      });
    });

    it("should return failure for unknown provider", async () => {
      const result = await controller.testExtractionConnection({
        provider: "unknown" as any,
        apiKey: "some-key",
      });

      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining("Unknown provider"),
      });
    });
  });

  describe("testYoutubeConnection()", () => {
    it("should return failure when no api key is provided", async () => {
      const result = await controller.testYoutubeConnection({
        provider: "supadata",
      });

      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining("No API key"),
      });
    });

    it("should return failure for unknown provider", async () => {
      const result = await controller.testYoutubeConnection({
        provider: "unknown",
        apiKey: "some-key",
      });

      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining("未知的 provider"),
      });
    });
  });

  describe("testTTSConnection()", () => {
    it("should return failure when no api key is provided", async () => {
      const result = await controller.testTTSConnection({
        provider: "elevenlabs",
      });

      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining("No API key"),
      });
    });
  });
});
