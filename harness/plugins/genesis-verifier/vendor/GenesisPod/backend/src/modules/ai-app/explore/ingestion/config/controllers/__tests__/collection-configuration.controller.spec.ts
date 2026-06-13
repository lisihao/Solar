import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { CollectionConfigurationController } from "../collection-configuration.controller";
import { CollectionConfigurationService } from "../../services/collection-configuration.service";

jest.mock("../../services/collection-configuration.service");

describe("CollectionConfigurationController", () => {
  let controller: CollectionConfigurationController;
  let mockService: jest.Mocked<CollectionConfigurationService>;

  const mockConfig = {
    id: "config-1",
    resourceType: "PAPER",
    name: "Test Config",
    description: "Test description",
    keywords: ["AI", "research"],
    excludeKeywords: ["spam"],
    urlPatterns: ["https://arxiv.org/*"],
    cronExpression: "0 0 * * *",
    maxConcurrent: 5,
    timeout: 30000,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CollectionConfigurationController],
      providers: [
        {
          provide: CollectionConfigurationService,
          useValue: {
            createConfig: jest.fn(),
            getConfigsByResourceType: jest.fn(),
            getActiveConfigs: jest.fn(),
            getConfig: jest.fn(),
            updateConfig: jest.fn(),
            deleteConfig: jest.fn(),
            enableConfig: jest.fn(),
            disableConfig: jest.fn(),
            matchesUrlPatterns: jest.fn(),
            matchesKeywords: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<CollectionConfigurationController>(
      CollectionConfigurationController,
    );
    mockService = module.get(CollectionConfigurationService);
  });

  // =========================================================================
  // createConfig
  // =========================================================================

  describe("createConfig", () => {
    it("should create config successfully", async () => {
      mockService.createConfig.mockResolvedValue(mockConfig as never);

      const result = await controller.createConfig({
        resourceType: "PAPER" as never,
        name: "Test Config",
      });

      expect(mockService.createConfig).toHaveBeenCalled();
      expect(result).toEqual(mockConfig);
    });

    it("should throw BadRequestException when resourceType is missing", async () => {
      await expect(
        controller.createConfig({
          resourceType: undefined as never,
          name: "Test",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when name is missing", async () => {
      await expect(
        controller.createConfig({
          resourceType: "PAPER" as never,
          name: "",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should rethrow errors from service", async () => {
      mockService.createConfig.mockRejectedValue(new Error("DB error"));

      await expect(
        controller.createConfig({
          resourceType: "PAPER" as never,
          name: "Test",
        }),
      ).rejects.toThrow("DB error");
    });
  });

  // =========================================================================
  // getConfigs
  // =========================================================================

  describe("getConfigs", () => {
    it("should get configs by resourceType when provided", async () => {
      const configs = [mockConfig];
      mockService.getConfigsByResourceType.mockResolvedValue(configs as never);

      const result = await controller.getConfigs("PAPER" as never);

      expect(mockService.getConfigsByResourceType).toHaveBeenCalledWith(
        "PAPER",
      );
      expect(result).toEqual(configs);
    });

    it("should get active configs when no resourceType provided", async () => {
      const configs = [mockConfig];
      mockService.getActiveConfigs.mockResolvedValue(configs as never);

      const result = await controller.getConfigs(undefined);

      expect(mockService.getActiveConfigs).toHaveBeenCalled();
      expect(result).toEqual(configs);
    });

    it("should rethrow errors from service", async () => {
      mockService.getActiveConfigs.mockRejectedValue(
        new Error("Service error"),
      );

      await expect(controller.getConfigs(undefined)).rejects.toThrow(
        "Service error",
      );
    });
  });

  // =========================================================================
  // getConfig
  // =========================================================================

  describe("getConfig", () => {
    it("should return config when found", async () => {
      mockService.getConfig.mockResolvedValue(mockConfig as never);

      const result = await controller.getConfig("config-1");
      expect(result).toEqual(mockConfig);
    });

    it("should throw NotFoundException when config not found", async () => {
      mockService.getConfig.mockResolvedValue(null as never);

      await expect(controller.getConfig("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should rethrow errors from service", async () => {
      mockService.getConfig.mockRejectedValue(new Error("DB error"));

      await expect(controller.getConfig("config-1")).rejects.toThrow(
        "DB error",
      );
    });
  });

  // =========================================================================
  // updateConfig
  // =========================================================================

  describe("updateConfig", () => {
    it("should update config successfully", async () => {
      const updatedConfig = { ...mockConfig, name: "Updated Config" };
      mockService.updateConfig.mockResolvedValue(updatedConfig as never);

      const result = await controller.updateConfig("config-1", {
        name: "Updated Config",
      });

      expect(mockService.updateConfig).toHaveBeenCalledWith("config-1", {
        name: "Updated Config",
      });
      expect(result).toEqual(updatedConfig);
    });

    it("should rethrow errors from service", async () => {
      mockService.updateConfig.mockRejectedValue(new Error("Update failed"));

      await expect(
        controller.updateConfig("config-1", { name: "New name" }),
      ).rejects.toThrow("Update failed");
    });
  });

  // =========================================================================
  // deleteConfig
  // =========================================================================

  describe("deleteConfig", () => {
    it("should delete config and return success message", async () => {
      mockService.deleteConfig.mockResolvedValue(undefined as never);

      const result = await controller.deleteConfig("config-1");

      expect(mockService.deleteConfig).toHaveBeenCalledWith("config-1");
      expect(result).toEqual({
        message: "Collection configuration deleted successfully",
      });
    });

    it("should rethrow errors from service", async () => {
      mockService.deleteConfig.mockRejectedValue(new Error("Delete failed"));

      await expect(controller.deleteConfig("config-1")).rejects.toThrow(
        "Delete failed",
      );
    });
  });

  // =========================================================================
  // enableConfig
  // =========================================================================

  describe("enableConfig", () => {
    it("should enable config successfully", async () => {
      const enabledConfig = { ...mockConfig, isActive: true };
      mockService.enableConfig.mockResolvedValue(enabledConfig as never);

      const result = await controller.enableConfig("config-1");
      expect(result).toEqual(enabledConfig);
    });

    it("should rethrow errors from service", async () => {
      mockService.enableConfig.mockRejectedValue(new Error("Enable failed"));

      await expect(controller.enableConfig("config-1")).rejects.toThrow(
        "Enable failed",
      );
    });
  });

  // =========================================================================
  // disableConfig
  // =========================================================================

  describe("disableConfig", () => {
    it("should disable config successfully", async () => {
      const disabledConfig = { ...mockConfig, isActive: false };
      mockService.disableConfig.mockResolvedValue(disabledConfig as never);

      const result = await controller.disableConfig("config-1");
      expect(result).toEqual(disabledConfig);
    });

    it("should rethrow errors from service", async () => {
      mockService.disableConfig.mockRejectedValue(new Error("Disable failed"));

      await expect(controller.disableConfig("config-1")).rejects.toThrow(
        "Disable failed",
      );
    });
  });

  // =========================================================================
  // validateContent
  // =========================================================================

  describe("validateContent", () => {
    it("should validate URL and content successfully", async () => {
      const configWithPatterns = {
        ...mockConfig,
        urlPatterns: ["https://arxiv.org/*"],
        keywords: ["AI"],
        excludeKeywords: ["spam"],
      };
      mockService.getConfig.mockResolvedValue(configWithPatterns as never);
      mockService.matchesUrlPatterns.mockReturnValue(true);
      mockService.matchesKeywords.mockReturnValue(true);

      const result = await controller.validateContent("config-1", {
        url: "https://arxiv.org/abs/1234",
        content: "This is about AI research",
      });

      expect(result).toEqual({
        urlMatches: true,
        contentMatches: true,
        overallMatch: true,
      });
    });

    it("should throw NotFoundException when config not found", async () => {
      mockService.getConfig.mockResolvedValue(null as never);

      await expect(
        controller.validateContent("nonexistent", {
          url: "https://example.com",
          content: "test",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should return false when URL does not match", async () => {
      mockService.getConfig.mockResolvedValue(mockConfig as never);
      mockService.matchesUrlPatterns.mockReturnValue(false);
      mockService.matchesKeywords.mockReturnValue(true);

      const result = await controller.validateContent("config-1", {
        url: "https://other.com/article",
        content: "AI content",
      });

      expect(result.urlMatches).toBe(false);
      expect(result.overallMatch).toBe(false);
    });

    it("should return false when content does not match keywords", async () => {
      mockService.getConfig.mockResolvedValue(mockConfig as never);
      mockService.matchesUrlPatterns.mockReturnValue(true);
      mockService.matchesKeywords.mockReturnValue(false);

      const result = await controller.validateContent("config-1", {
        url: "https://arxiv.org/abs/1234",
        content: "unrelated content",
      });

      expect(result.contentMatches).toBe(false);
      expect(result.overallMatch).toBe(false);
    });

    it("should handle config with null patterns gracefully", async () => {
      const configNullPatterns = {
        ...mockConfig,
        urlPatterns: null,
        keywords: null,
        excludeKeywords: null,
      };
      mockService.getConfig.mockResolvedValue(configNullPatterns as never);
      mockService.matchesUrlPatterns.mockReturnValue(true);
      mockService.matchesKeywords.mockReturnValue(true);

      const result = await controller.validateContent("config-1", {
        url: "https://arxiv.org",
        content: "content",
      });

      // Should pass empty arrays to service
      expect(mockService.matchesUrlPatterns).toHaveBeenCalledWith(
        "https://arxiv.org",
        [],
      );
      expect(result).toBeDefined();
    });

    it("should rethrow errors from service", async () => {
      mockService.getConfig.mockRejectedValue(new Error("DB error"));

      await expect(
        controller.validateContent("config-1", {
          url: "https://example.com",
          content: "test",
        }),
      ).rejects.toThrow("DB error");
    });
  });
});
