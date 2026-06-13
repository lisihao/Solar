/**
 * AdminService Supplemental Tests 3
 *
 * Covers uncovered methods NOT in supplemental or supplemental2:
 * - validateAndCorrectModelConfig() — via createAIModel / updateAIModel
 * - updateAIModel() — apiKey update scenarios (empty, masked, new key)
 * - getAIModelApiKey() — secretKey resolution, fallback to apiKey, model not found
 * - getSettings() — with category, JSON parse, parse error fallback
 * - getSetting() — found (JSON), found (plain string), not found
 * - setSetting() — string value, non-string value
 * - setSettings() — batch update
 * - deleteSetting() — found, not found
 * - getSearchConfig() — multi-key logic, legacy single key
 * - updateSearchConfig() — tavilyApiKeys array, serperApiKeys array, perplexityApiKey
 * - getSearchApiKey() — all provider branches
 * - getContentExtractionConfig() / updateContentExtractionConfig()
 * - getYoutubeConfig() / updateYoutubeConfig()
 * - getTTSConfig() / updateTTSConfig()
 * - getSkillsmpConfig() / updateSkillsmpConfig()
 * - installSkillFromMarketplace()
 * - getExternalProvidersConfig() / updateExternalProvidersConfig()
 * - checkApiBalance() — all provider branches + no key + error
 * - diagnoseAIModels()
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { AdminService } from "../admin.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { SecretsService } from "../../../platform/credentials/storage/secrets/secrets.service";
import { UserManagementService } from "../services/user-management.service";
import { ResourceManagementService } from "../services/resource-management.service";
import { StatisticsService } from "../services/statistics.service";

// Mock the facade imports to prevent module resolution issues
jest.mock("../../../ai-engine/facade", () => ({
  inferIsReasoning: jest.fn().mockReturnValue(false),
  getKnownModelLimit: jest.fn().mockReturnValue(null),
}));
jest.mock("../../../ai-harness/facade", () => ({
  inferIsReasoning: jest.fn().mockReturnValue(false),
  getKnownModelLimit: jest.fn().mockReturnValue(null),
}));

import {
  inferIsReasoning,
  getKnownModelLimit,
} from "../../../ai-engine/facade";

// Mock global fetch for balance check tests
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("AdminService (supplemental3)", () => {
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
  };

  const mockSecretsService = {
    getValueInternal: jest.fn(),
  };

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
    (inferIsReasoning as jest.Mock).mockReturnValue(false);
    (getKnownModelLimit as jest.Mock).mockReturnValue(null);

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
  // updateAIModel — apiKey update branches
  // =========================================================================

  describe("updateAIModel", () => {
    const existingModel = {
      id: "model-1",
      name: "GPT-4",
      modelId: "gpt-4",
      displayName: "GPT-4",
      apiKey: "sk-existing-key-abcd",
      secretKey: null,
      maxTokens: 4096,
      temperature: 0.7,
      isReasoning: false,
      supportsTemperature: true,
      tokenParamName: "max_tokens",
    };

    const updatedModel = {
      ...existingModel,
      apiKey: null,
      secretKey: null,
    };

    it("sets apiKey to null when empty string provided", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue(existingModel);
      mockPrismaService.aIModel.update.mockResolvedValue(updatedModel);

      await service.updateAIModel("model-1", { apiKey: "" });

      expect(mockPrismaService.aIModel.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ apiKey: null }),
        }),
      );
    });

    it("keeps existing apiKey when masked value provided", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue(existingModel);
      mockPrismaService.aIModel.update.mockResolvedValue(existingModel);

      await service.updateAIModel("model-1", { apiKey: "sk-1****abcd" });

      // apiKeyUpdate should be undefined (not overwrite)
      const updateCall = mockPrismaService.aIModel.update.mock.calls[0][0];
      expect(updateCall.data.apiKey).toBeUndefined();
    });

    it("sets new apiKey when valid non-masked value provided", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue(existingModel);
      mockPrismaService.aIModel.update.mockResolvedValue({
        ...existingModel,
        apiKey: "sk-newkey-1234",
      });

      await service.updateAIModel("model-1", { apiKey: "sk-newkey-1234" });

      expect(mockPrismaService.aIModel.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ apiKey: "sk-newkey-1234" }),
        }),
      );
    });

    it("throws NotFoundException when model not found", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue(null);

      await expect(
        service.updateAIModel("nonexistent", { displayName: "New Name" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("trims whitespace from provided apiKey", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue(existingModel);
      mockPrismaService.aIModel.update.mockResolvedValue({
        ...existingModel,
        apiKey: "sk-trimmed",
      });

      await service.updateAIModel("model-1", { apiKey: "  sk-trimmed  " });

      const updateCall = mockPrismaService.aIModel.update.mock.calls[0][0];
      expect(updateCall.data.apiKey).toBe("sk-trimmed");
    });

    it("auto-sets tokenParamName for reasoning model update", async () => {
      (inferIsReasoning as jest.Mock).mockReturnValue(false);
      const reasoningModel = {
        ...existingModel,
        modelId: "o1-preview",
        isReasoning: false,
        tokenParamName: "max_tokens",
        supportsTemperature: true,
      };
      mockPrismaService.aIModel.findUnique.mockResolvedValue(reasoningModel);
      mockPrismaService.aIModel.update.mockResolvedValue(reasoningModel);

      await service.updateAIModel("model-1", {
        isReasoning: true,
      });

      const updateCall = mockPrismaService.aIModel.update.mock.calls[0][0];
      expect(updateCall.data.tokenParamName).toBe("max_completion_tokens");
      expect(updateCall.data.supportsTemperature).toBe(false);
    });

    it("returns masked apiKey in response", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue(existingModel);
      mockPrismaService.aIModel.update.mockResolvedValue({
        ...existingModel,
        apiKey: "sk-newkey123456789",
        secretKey: null,
      });

      const result = await service.updateAIModel("model-1", {
        displayName: "Updated",
      });

      expect(result.apiKey).toMatch(/\*\*\*\*/);
      expect(result.hasApiKey).toBe(true);
    });
  });

  // =========================================================================
  // validateAndCorrectModelConfig — via createAIModel
  // =========================================================================

  describe("validateAndCorrectModelConfig (via createAIModel)", () => {
    it("auto-corrects maxTokens exceeding known limit", async () => {
      (getKnownModelLimit as jest.Mock).mockReturnValue(8192);
      mockPrismaService.aIModel.findFirst.mockResolvedValue(null);
      mockPrismaService.aIModel.create.mockResolvedValue({
        id: "new-model",
        name: "GPT-4",
        displayName: "GPT-4",
        apiKey: null,
        secretKey: null,
        modelId: "gpt-4",
        maxTokens: 8192,
        isReasoning: false,
        tokenParamName: "max_tokens",
        supportsTemperature: true,
      });

      const result = await service.createAIModel({
        name: "GPT-4",
        displayName: "GPT-4",
        provider: "openai",
        modelId: "gpt-4",
        icon: "icon",
        color: "#000",
        apiEndpoint: "https://api.openai.com",
        maxTokens: 999999, // exceeds limit
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("auto-corrected");
    });

    it("warns when isReasoning=true but model name does not match patterns", async () => {
      (inferIsReasoning as jest.Mock).mockReturnValue(false);
      (getKnownModelLimit as jest.Mock).mockReturnValue(null);
      mockPrismaService.aIModel.findFirst.mockResolvedValue(null);
      mockPrismaService.aIModel.create.mockResolvedValue({
        id: "new-model",
        name: "Non-Reasoning",
        displayName: "Non-Reasoning",
        apiKey: null,
        secretKey: null,
        modelId: "non-reasoning-model",
        isReasoning: true,
        tokenParamName: "max_completion_tokens",
        supportsTemperature: false,
        maxTokens: 4096,
      });

      const result = await service.createAIModel({
        name: "Non-Reasoning",
        displayName: "Non-Reasoning",
        provider: "custom",
        modelId: "non-reasoning-model",
        icon: "icon",
        color: "#000",
        apiEndpoint: "https://api.custom.com",
        isReasoning: true,
      });

      expect(result.warnings.some((w) => w.includes("isReasoning=true"))).toBe(
        true,
      );
    });

    it("auto-sets tokenParamName=max_tokens for non-reasoning model", async () => {
      mockPrismaService.aIModel.findFirst.mockResolvedValue(null);
      mockPrismaService.aIModel.create.mockResolvedValue({
        id: "new-model",
        name: "Chat Model",
        displayName: "Chat Model",
        apiKey: null,
        secretKey: null,
        modelId: "chat-model",
        isReasoning: false,
        tokenParamName: "max_tokens",
        supportsTemperature: true,
        maxTokens: 4096,
      });

      const result = await service.createAIModel({
        name: "Chat Model",
        displayName: "Chat Model",
        provider: "openai",
        modelId: "chat-model",
        icon: "icon",
        color: "#000",
        apiEndpoint: "https://api.openai.com",
        isReasoning: false,
      });

      expect(result.warnings).toHaveLength(0);
    });
  });

  // =========================================================================
  // getAIModelApiKey
  // =========================================================================

  describe("getAIModelApiKey", () => {
    it("returns null when model not found", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue(null);
      const result = await service.getAIModelApiKey("nonexistent");
      expect(result).toBeNull();
    });

    it("resolves apiKey from Secret Manager when secretKey is set", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue({
        apiKey: "direct-key",
        secretKey: "my-secret-key",
      });
      mockSecretsService.getValueInternal.mockResolvedValue("  secret-value  ");

      const result = await service.getAIModelApiKey("model-1");
      expect(result).toBe("secret-value");
      expect(mockSecretsService.getValueInternal).toHaveBeenCalledWith(
        "my-secret-key",
      );
    });

    it("falls back to apiKey when Secret Manager returns null", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue({
        apiKey: "  fallback-key  ",
        secretKey: "missing-secret",
      });
      mockSecretsService.getValueInternal.mockResolvedValue(null);

      const result = await service.getAIModelApiKey("model-1");
      expect(result).toBe("fallback-key");
    });

    it("returns trimmed apiKey when no secretKey configured", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue({
        apiKey: "  direct-key  ",
        secretKey: null,
      });

      const result = await service.getAIModelApiKey("model-1");
      expect(result).toBe("direct-key");
    });

    it("returns null when both apiKey and secretKey are null", async () => {
      mockPrismaService.aIModel.findUnique.mockResolvedValue({
        apiKey: null,
        secretKey: null,
      });

      const result = await service.getAIModelApiKey("model-1");
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // getSettings / getSetting / setSetting / setSettings / deleteSetting
  // =========================================================================

  describe("getSettings", () => {
    it("returns all settings as key-value pairs without category", async () => {
      mockPrismaService.systemSetting.findMany.mockResolvedValue([
        { key: "site.name", value: '"My Site"' },
        { key: "site.enabled", value: "true" },
      ]);

      const result = await service.getSettings();
      expect(result["site.name"]).toBe("My Site");
      expect(result["site.enabled"]).toBe(true);
    });

    it("filters by category when provided", async () => {
      mockPrismaService.systemSetting.findMany.mockResolvedValue([
        { key: "search.provider", value: '"tavily"' },
      ]);

      await service.getSettings("search");

      expect(mockPrismaService.systemSetting.findMany).toHaveBeenCalledWith({
        where: { category: "search" },
        orderBy: { key: "asc" },
      });
    });

    it("falls back to raw string when JSON parse fails", async () => {
      mockPrismaService.systemSetting.findMany.mockResolvedValue([
        { key: "some.key", value: "not-valid-json{" },
      ]);

      const result = await service.getSettings();
      expect(result["some.key"]).toBe("not-valid-json{");
    });

    it("skips null values", async () => {
      mockPrismaService.systemSetting.findMany.mockResolvedValue([
        { key: "null.key", value: null },
      ]);

      const result = await service.getSettings();
      expect(result["null.key"]).toBeUndefined();
    });
  });

  describe("getSetting", () => {
    it("returns null when setting not found", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);
      const result = await service.getSetting("missing.key");
      expect(result).toBeNull();
    });

    it("returns parsed JSON value", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "test.key",
        value: '{"foo": "bar"}',
      });

      const result = await service.getSetting("test.key");
      expect(result).toEqual({ foo: "bar" });
    });

    it("returns raw string when JSON parse fails", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "test.key",
        value: "plain-string",
      });

      const result = await service.getSetting("test.key");
      expect(result).toBe("plain-string");
    });

    it("returns null for null value", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "test.key",
        value: null,
      });

      const result = await service.getSetting("test.key");
      expect(result).toBeNull();
    });
  });

  describe("setSetting", () => {
    it("serializes non-string value to JSON", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({
        key: "test",
        value: "42",
      });

      await service.setSetting("test", 42, {
        description: "a number",
        category: "general",
      });

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ value: "42" }),
        }),
      );
    });

    it("stores string value directly", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({
        key: "test",
        value: "hello",
      });

      await service.setSetting("test", "hello");

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ value: "hello" }),
        }),
      );
    });
  });

  describe("setSettings", () => {
    it("updates multiple settings concurrently", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({
        key: "k",
        value: "v",
      });

      await service.setSettings([
        { key: "k1", value: "v1", category: "cat1" },
        { key: "k2", value: "v2", category: "cat2" },
      ]);

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledTimes(2);
    });
  });

  describe("deleteSetting", () => {
    it("deletes existing setting successfully", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "test",
        value: "v",
      });
      mockPrismaService.systemSetting.delete.mockResolvedValue({});

      const result = await service.deleteSetting("test");
      expect(result.success).toBe(true);
    });

    it("throws NotFoundException when setting not found", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await expect(service.deleteSetting("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // =========================================================================
  // getSearchConfig
  // =========================================================================

  describe("getSearchConfig", () => {
    it("returns config with multi-key format (tavilyApiKeys array)", async () => {
      const settingsMap: Record<string, unknown> = {
        "search.provider": "tavily",
        "search.enabled": true,
        "search.perplexity.apiKey": null,
        "search.tavily.apiKeys": ["key1", "key2"],
        "search.serper.apiKeys": null,
        "search.tavily.apiKey": null,
        "search.serper.apiKey": null,
      };

      mockPrismaService.systemSetting.findUnique.mockImplementation(
        (args: { where: { key: string } }) => {
          const val = settingsMap[args.where.key];
          if (val === undefined) return Promise.resolve(null);
          return Promise.resolve({
            key: args.where.key,
            value: JSON.stringify(val),
          });
        },
      );

      const result = await service.getSearchConfig();
      expect(result.tavily.keyCount).toBe(2);
      expect(result.tavily.hasApiKey).toBe(true);
    });

    it("falls back to legacy single key format", async () => {
      const settingsMap: Record<string, unknown> = {
        "search.provider": "tavily",
        "search.enabled": null,
        "search.perplexity.apiKey": null,
        "search.tavily.apiKeys": null,
        "search.serper.apiKeys": null,
        "search.tavily.apiKey": "legacy-key",
        "search.serper.apiKey": null,
      };

      mockPrismaService.systemSetting.findUnique.mockImplementation(
        (args: { where: { key: string } }) => {
          const val = settingsMap[args.where.key];
          if (val === null) return Promise.resolve(null);
          return Promise.resolve({
            key: args.where.key,
            value: JSON.stringify(val),
          });
        },
      );

      const result = await service.getSearchConfig();
      expect(result.tavily.keyCount).toBe(1);
    });

    it("returns empty key lists when no keys configured", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.getSearchConfig();
      expect(result.tavily.keyCount).toBe(0);
      expect(result.tavily.hasApiKey).toBe(false);
      expect(result.duckduckgo.hasApiKey).toBe(true); // always configured
    });
  });

  // =========================================================================
  // updateSearchConfig
  // =========================================================================

  describe("updateSearchConfig", () => {
    beforeEach(() => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({
        key: "k",
        value: "v",
      });
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);
    });

    it("updates provider and enabled", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({
        key: "k",
        value: "v",
      });
      await service.updateSearchConfig({
        provider: "serper",
        enabled: false,
      });
      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledTimes(2);
    });

    it("saves tavilyApiKeys array (new format)", async () => {
      await service.updateSearchConfig({
        tavilyApiKeys: ["key1", "key2"],
      });
      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: "search.tavily.apiKeys" },
        }),
      );
    });

    it("ignores masked and empty tavilyApiKeys entries", async () => {
      await service.updateSearchConfig({
        tavilyApiKeys: ["***configured***", "", "valid-key"],
      });
      const calls = mockPrismaService.systemSetting.upsert.mock.calls;
      const tavillyCall = calls.find(
        (c: Array<{ where: { key: string } }>) =>
          c[0].where.key === "search.tavily.apiKeys",
      );
      // Only valid-key should be saved
      expect(JSON.parse(tavillyCall[0].create.value)).toEqual(["valid-key"]);
    });

    it("converts legacy tavilyApiKey to array format", async () => {
      await service.updateSearchConfig({
        tavilyApiKey: "single-key",
      });
      const calls = mockPrismaService.systemSetting.upsert.mock.calls;
      const tavillyCall = calls.find(
        (c: Array<{ where: { key: string } }>) =>
          c[0].where.key === "search.tavily.apiKeys",
      );
      expect(JSON.parse(tavillyCall[0].create.value)).toEqual(["single-key"]);
    });

    it("skips perplexityApiKey if masked", async () => {
      await service.updateSearchConfig({
        perplexityApiKey: "***configured***",
      });
      expect(mockPrismaService.systemSetting.upsert).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getSearchApiKey
  // =========================================================================

  describe("getSearchApiKey", () => {
    it("returns perplexity key", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "search.perplexity.apiKey",
        value: '"perp-key"',
      });
      const result = await service.getSearchApiKey("perplexity");
      expect(result).toBe("perp-key");
    });

    it("returns tavily key", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "search.tavily.apiKey",
        value: '"tav-key"',
      });
      const result = await service.getSearchApiKey("tavily");
      expect(result).toBe("tav-key");
    });

    it("returns serper key", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "search.serper.apiKey",
        value: '"serp-key"',
      });
      const result = await service.getSearchApiKey("serper");
      expect(result).toBe("serp-key");
    });

    it("returns null for unknown provider", async () => {
      const result = await service.getSearchApiKey("unknown");
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // getContentExtractionConfig / updateContentExtractionConfig
  // =========================================================================

  describe("getContentExtractionConfig", () => {
    it("returns masked keys for configured providers", async () => {
      mockPrismaService.systemSetting.findUnique.mockImplementation(
        (args: { where: { key: string } }) => {
          const keys: Record<string, string> = {
            "extraction.jina.apiKey": '"jina123456789012"',
            "extraction.firecrawl.apiKey": '"fc-abcdef"',
            "extraction.tavily.apiKey": null as unknown as string,
            "extraction.enabled": '"true"',
          };
          const v = keys[args.where.key];
          return v
            ? Promise.resolve({ key: args.where.key, value: v })
            : Promise.resolve(null);
        },
      );

      const result = await service.getContentExtractionConfig();
      expect(result.jina.hasApiKey).toBe(true);
      expect(result.jina.apiKey).toContain("****");
      expect(result.tavily.hasApiKey).toBe(false);
    });
  });

  describe("updateContentExtractionConfig", () => {
    it("saves non-masked jinaApiKey", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({
        key: "k",
        value: "v",
      });
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateContentExtractionConfig({
        jinaApiKey: "jina-real-key",
      });

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: "extraction.jina.apiKey" },
        }),
      );
    });

    it("skips masked keys", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({
        key: "k",
        value: "v",
      });

      await service.updateContentExtractionConfig({
        jinaApiKey: "abc****def",
        firecrawlApiKey: "fc****abc",
      });

      expect(mockPrismaService.systemSetting.upsert).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getYoutubeConfig / updateYoutubeConfig
  // =========================================================================

  describe("getYoutubeConfig", () => {
    it("returns config with masked key", async () => {
      mockPrismaService.systemSetting.findUnique.mockImplementation(
        (args: { where: { key: string } }) => {
          if (args.where.key === "youtube.supadata.apiKey") {
            return Promise.resolve({
              key: "youtube.supadata.apiKey",
              value: '"supa123456789"',
            });
          }
          return Promise.resolve(null);
        },
      );

      const result = await service.getYoutubeConfig();
      expect(result.supadata.hasApiKey).toBe(true);
      expect(result.supadata.apiKey).toContain("****");
    });
  });

  describe("updateYoutubeConfig", () => {
    it("saves enabled flag and provider", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({
        key: "k",
        value: "v",
      });
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateYoutubeConfig({
        enabled: false,
        provider: "supadata",
      });

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledTimes(2);
    });

    it("saves supadataApiKey when not masked", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({
        key: "k",
        value: "v",
      });
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateYoutubeConfig({ supadataApiKey: "real-key-123" });

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: "youtube.supadata.apiKey" },
        }),
      );
    });

    it("skips masked supadataApiKey", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({
        key: "k",
        value: "v",
      });

      await service.updateYoutubeConfig({ supadataApiKey: "abc****xyz" });

      expect(mockPrismaService.systemSetting.upsert).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getTTSConfig / updateTTSConfig
  // =========================================================================

  describe("getTTSConfig", () => {
    it("returns config with default provider when not set", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.getTTSConfig();
      expect(result.provider).toBe("elevenlabs");
      expect(result.elevenlabs.hasApiKey).toBe(false);
    });
  });

  describe("updateTTSConfig", () => {
    it("saves non-starred elevenLabsApiKey", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({
        key: "k",
        value: "v",
      });
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateTTSConfig({ elevenLabsApiKey: "elevenlabs-key" });

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: "tts.elevenlabs.apiKey" },
        }),
      );
    });

    it("skips starred elevenLabsApiKey", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({
        key: "k",
        value: "v",
      });

      await service.updateTTSConfig({ elevenLabsApiKey: "***some***" });

      expect(mockPrismaService.systemSetting.upsert).not.toHaveBeenCalled();
    });

    it("saves googleTTSApiKey", async () => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({
        key: "k",
        value: "v",
      });
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      await service.updateTTSConfig({ googleTTSApiKey: "google-key" });

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: "tts.google.apiKey" },
        }),
      );
    });
  });

  // =========================================================================
  // getSkillsmpConfig / updateSkillsmpConfig / getSkillsmpApiKey
  // =========================================================================

  describe("getSkillsmpConfig", () => {
    it("returns default enabled=true when not configured", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.getSkillsmpConfig();
      expect(result.enabled).toBe(true);
      expect(result.hasApiKey).toBe(false);
    });

    it("returns masked apiKey when configured", async () => {
      mockPrismaService.systemSetting.findUnique.mockImplementation(
        (args: { where: { key: string } }) => {
          if (args.where.key === "skillsmp.apiKey") {
            return Promise.resolve({
              key: "skillsmp.apiKey",
              value: '"skills123456789"',
            });
          }
          return Promise.resolve(null);
        },
      );

      const result = await service.getSkillsmpConfig();
      expect(result.hasApiKey).toBe(true);
      expect(result.apiKey).toContain("****");
    });
  });

  describe("updateSkillsmpConfig", () => {
    beforeEach(() => {
      mockPrismaService.systemSetting.upsert.mockResolvedValue({
        key: "k",
        value: "v",
      });
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);
    });

    it("saves apiKey when not masked", async () => {
      await service.updateSkillsmpConfig({ apiKey: "smp-key-12345" });

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: "skillsmp.apiKey" },
        }),
      );
    });

    it("skips masked apiKey", async () => {
      await service.updateSkillsmpConfig({ apiKey: "abc****def" });

      expect(mockPrismaService.systemSetting.upsert).not.toHaveBeenCalled();
    });

    it("saves enabled and syncInterval", async () => {
      await service.updateSkillsmpConfig({
        enabled: false,
        syncInterval: "weekly",
      });

      expect(mockPrismaService.systemSetting.upsert).toHaveBeenCalledTimes(2);
    });
  });

  describe("getSkillsmpApiKey", () => {
    it("delegates to getSetting", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "skillsmp.apiKey",
        value: '"smp-key"',
      });

      const result = await service.getSkillsmpApiKey();
      expect(result).toBe("smp-key");
    });
  });

  // =========================================================================
  // installSkillFromMarketplace
  // =========================================================================

  describe("installSkillFromMarketplace", () => {
    it("upserts skill config with defaults", async () => {
      mockPrismaService.skillConfig.upsert.mockResolvedValue({
        skillId: "test-skill",
      });

      await service.installSkillFromMarketplace({
        id: "test-skill",
        name: "Test Skill",
      });

      expect(mockPrismaService.skillConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { skillId: "test-skill" },
          create: expect.objectContaining({
            skillId: "test-skill",
            displayName: "Test Skill",
            enabled: true,
          }),
        }),
      );
    });

    it("uses provided displayName and description", async () => {
      mockPrismaService.skillConfig.upsert.mockResolvedValue({});

      await service.installSkillFromMarketplace({
        id: "skill-2",
        name: "Skill Name",
        displayName: "Custom Display",
        description: "My skill",
        layer: "application",
        domain: "research",
        tags: ["tag1"],
      });

      expect(mockPrismaService.skillConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            displayName: "Custom Display",
            description: "My skill",
            tags: ["tag1"],
          }),
        }),
      );
    });
  });

  // =========================================================================
  // getExternalProvidersConfig / updateExternalProvidersConfig
  // =========================================================================

  describe("getExternalProvidersConfig", () => {
    it("returns default providers when no stored config", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.getExternalProvidersConfig();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      const market = result.find((p) => p.id === "market");
      expect(market).toBeDefined();
      expect(market?.hasApiKey).toBe(false);
    });

    it("merges stored config with defaults", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "external.providers",
        value: JSON.stringify([
          { id: "market", apiKey: "market-key", enabled: true },
        ]),
      });

      const result = await service.getExternalProvidersConfig();
      const market = result.find((p) => p.id === "market");
      expect(market?.hasApiKey).toBe(true);
      expect(market?.enabled).toBe(true);
    });

    it("includes custom providers not in defaults", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "external.providers",
        value: JSON.stringify([
          {
            id: "custom-provider",
            name: "Custom",
            apiKey: "custom-key",
            enabled: true,
            baseUrl: "https://custom.com",
          },
        ]),
      });

      const result = await service.getExternalProvidersConfig();
      const custom = result.find((p) => p.id === "custom-provider");
      expect(custom).toBeDefined();
    });
  });

  describe("updateExternalProvidersConfig", () => {
    it("filters out providers without required fields", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);
      mockPrismaService.systemSetting.upsert.mockResolvedValue({
        key: "external.providers",
        value: "[]",
      });

      await service.updateExternalProvidersConfig([
        { id: "", name: "Invalid", apiKey: "key" }, // no id
        { id: "valid", name: "Valid", baseUrl: "https://valid.com" },
      ]);

      const upsertCall = mockPrismaService.systemSetting.upsert.mock.calls[0];
      const saved = JSON.parse(upsertCall[0].create.value);
      expect(saved).toHaveLength(1);
      expect(saved[0].id).toBe("valid");
    });

    it("preserves existing apiKey when incoming is masked", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "external.providers",
        value: JSON.stringify([
          { id: "market", name: "Market", apiKey: "existing-key" },
        ]),
      });
      mockPrismaService.systemSetting.upsert.mockResolvedValue({ key: "k" });

      await service.updateExternalProvidersConfig([
        {
          id: "market",
          name: "Market",
          apiKey: "***masked***",
          baseUrl: "https://market.com",
        },
      ]);

      const upsertCall = mockPrismaService.systemSetting.upsert.mock.calls[0];
      const saved = JSON.parse(upsertCall[0].create.value);
      expect(saved[0].apiKey).toBe("existing-key");
    });
  });

  // =========================================================================
  // checkApiBalance
  // =========================================================================

  describe("checkApiBalance", () => {
    it("returns no-key error when API key not configured", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.checkApiBalance("search", "tavily");
      expect(result.hasBalance).toBe(false);
      expect(result.error).toBe("API Key not configured");
    });

    it("returns tavily balance on successful response", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "search.tavily.apiKey",
        value: '"tav-key"',
      });
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await service.checkApiBalance("search", "tavily");
      expect(result.hasBalance).toBe(true);
      expect(result.balance).toBe("Active");
    });

    it("returns invalid key error for tavily 401", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "search.tavily.apiKey",
        value: '"tav-key"',
      });
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

      const result = await service.checkApiBalance("search", "tavily");
      expect(result.hasBalance).toBe(false);
      expect(result.error).toBe("Invalid API key");
    });

    it("returns rate limit error for tavily 429", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "search.tavily.apiKey",
        value: '"tav-key"',
      });
      mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });

      const result = await service.checkApiBalance("search", "tavily");
      expect(result.hasBalance).toBe(false);
      expect(result.error).toContain("Rate limit");
    });

    it("handles fetch error gracefully", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "search.tavily.apiKey",
        value: '"tav-key"',
      });
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await service.checkApiBalance("search", "tavily");
      expect(result.hasBalance).toBe(false);
      expect(result.error).toBe("Network error");
    });

    it("returns default unknown balance for unknown provider", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "search.custom.apiKey",
        value: '"custom-key"',
      });

      // getSearchApiKey returns null for unknown provider
      const result = await service.checkApiBalance("search", "custom");
      expect(result.hasBalance).toBe(false);
      expect(result.error).toBe("API Key not configured");
    });

    it("checks firecrawl balance", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "extraction.firecrawl.apiKey",
        value: '"fc-key"',
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest
          .fn()
          .mockResolvedValue({ remaining_credits: 500, credits_used: 100 }),
      });

      const result = await service.checkApiBalance("extraction", "firecrawl");
      expect(result.hasBalance).toBe(true);
      expect(result.balance).toContain("500");
    });

    it("handles firecrawl 401", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "extraction.firecrawl.apiKey",
        value: '"fc-key"',
      });
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

      const result = await service.checkApiBalance("extraction", "firecrawl");
      expect(result.hasBalance).toBe(false);
      expect(result.error).toBe("Invalid API key");
    });

    it("checks perplexity balance", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "search.perplexity.apiKey",
        value: '"perp-key"',
      });
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await service.checkApiBalance("search", "perplexity");
      expect(result.hasBalance).toBe(true);
    });

    it("checks serper balance with credits", async () => {
      mockPrismaService.systemSetting.findUnique.mockResolvedValue({
        key: "search.serper.apiKey",
        value: '"serper-key"',
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ credits: 1000, requests: 50 }),
      });

      const result = await service.checkApiBalance("search", "serper");
      expect(result.hasBalance).toBe(true);
      expect(result.balance).toContain("1000");
    });
  });

  // =========================================================================
  // diagnoseAIModels
  // =========================================================================

  describe("diagnoseAIModels", () => {
    it("returns diagnostic info for all models", async () => {
      mockPrismaService.aIModel.findMany.mockResolvedValue([
        {
          id: "model-1",
          name: "GPT-4",
          modelId: "gpt-4",
          provider: "openai",
          apiKey: "sk-key",
          secretKey: null,
          isEnabled: true,
          isDefault: true,
          isReasoning: false,
          apiEndpoint: "https://api.openai.com/v1/chat/completions",
          displayName: "GPT-4",
          maxTokens: 4096,
          temperature: 0.7,
        },
        {
          id: "model-2",
          name: "GPT-4-Free",
          modelId: "gpt-4-free",
          provider: "openai",
          apiKey: null,
          secretKey: null,
          isEnabled: false,
          isDefault: false,
          isReasoning: false,
          apiEndpoint: "https://api.openai.com/v1/chat/completions",
          displayName: "GPT-4 Free",
          maxTokens: 4096,
          temperature: 0.7,
        },
      ]);

      const result = await service.diagnoseAIModels();
      expect(result).toHaveLength(2);
      const model1 = result[0];
      expect(model1.hasApiKey).toBe(true);
    });
  });
});
